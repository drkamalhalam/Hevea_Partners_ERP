import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, isNull, or } from "drizzle-orm";
import { createImbalanceLedgerPair } from "./burden_imbalances";
import {
  db,
  usersTable,
  projectsTable,
  expendituresTable,
  burdenRulesTable,
  burdenRecordsTable,
  userProjectAssignmentsTable,
  agreementsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function resolveActingUser(clerkUserId: string) {
  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.clerkUserId, clerkUserId),
        eq(usersTable.isActive, true),
      ),
    )
    .limit(1);
  return user ?? null;
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(
      and(
        eq(userProjectAssignmentsTable.userId, userId),
        isNull(userProjectAssignmentsTable.revokedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}

function formatRule(r: typeof burdenRulesTable.$inferSelect) {
  return {
    id: r.id,
    projectId: r.projectId,
    category: r.category ?? null,
    bearerType: r.bearerType,
    developerPct: r.developerPct !== null ? Number(r.developerPct) : null,
    landownerPct: r.landownerPct !== null ? Number(r.landownerPct) : null,
    lifecyclePhase: r.lifecyclePhase,
    description: r.description ?? null,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null,
    isActive: r.isActive,
    createdById: r.createdById ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function formatRecord(
  r: typeof burdenRecordsTable.$inferSelect,
  extras?: { projectName?: string | null; expenditureDescription?: string | null },
) {
  return {
    id: r.id,
    expenditureId: r.expenditureId,
    projectId: r.projectId ?? null,
    projectName: extras?.projectName ?? null,
    expenditureDescription: extras?.expenditureDescription ?? null,
    ruleId: r.ruleId ?? null,
    category: r.category,
    totalAmount: Number(r.totalAmount),
    lifecyclePhaseSnapshot: r.lifecyclePhaseSnapshot,
    expectedBearerType: r.expectedBearerType,
    expectedDeveloperAmount: Number(r.expectedDeveloperAmount),
    expectedLandownerAmount: Number(r.expectedLandownerAmount),
    actualPayerRole: r.actualPayerRole ?? null,
    actualPayerName: r.actualPayerName ?? null,
    actualPayerId: r.actualPayerId ?? null,
    actualDeveloperAmount: Number(r.actualDeveloperAmount),
    actualLandownerAmount: Number(r.actualLandownerAmount),
    developerImbalanceAmount: Number(r.developerImbalanceAmount),
    landownerImbalanceAmount: Number(r.landownerImbalanceAmount),
    adjustmentStatus: r.adjustmentStatus,
    recoverableAmount: Number(r.recoverableAmount),
    recoveredAmount: Number(r.recoveredAmount),
    recoveryStatus: r.recoveryStatus,
    recoveryNotes: r.recoveryNotes ?? null,
    notes: r.notes ?? null,
    isActive: r.isActive,
    createdById: r.createdById ?? null,
    createdByName: r.createdByName ?? null,
    adjustedAt: r.adjustedAt?.toISOString() ?? null,
    adjustedById: r.adjustedById ?? null,
    adjustedByName: r.adjustedByName ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Find the best matching active burden rule for a given project + category
 * + lifecycle phase. Category-specific rules beat null=all rules.
 */
async function findMatchingRule(
  projectId: string,
  category: string,
  lifecyclePhase: string,
  today: string,
): Promise<typeof burdenRulesTable.$inferSelect | null> {
  const rules = await db
    .select()
    .from(burdenRulesTable)
    .where(
      and(
        eq(burdenRulesTable.projectId, projectId),
        eq(burdenRulesTable.isActive, true),
      ),
    )
    .orderBy(desc(burdenRulesTable.createdAt));

  // Filter by date and lifecycle phase
  const eligible = rules.filter((r) => {
    if (r.effectiveFrom > today) return false;
    if (r.effectiveTo && r.effectiveTo < today) return false;
    if (r.lifecyclePhase !== "all" && r.lifecyclePhase !== lifecyclePhase)
      return false;
    return true;
  });

  // Prefer category-specific rule, fall back to all-category rule
  const specific = eligible.find((r) => r.category === category);
  if (specific) return specific;
  const general = eligible.find((r) => r.category === null);
  return general ?? null;
}

/**
 * Compute expected amounts from a rule and total.
 * For `proportional`, we fetch the project's ownership data from agreements
 * (developer ownership share) and fall back to 50/50 if unavailable.
 */
async function computeExpectedAmounts(
  rule: typeof burdenRulesTable.$inferSelect,
  projectId: string,
  totalAmount: number,
): Promise<{ expectedDeveloperAmount: number; expectedLandownerAmount: number; bearerType: string }> {
  const bearerType = rule.bearerType;

  if (bearerType === "developer") {
    return { expectedDeveloperAmount: totalAmount, expectedLandownerAmount: 0, bearerType };
  }
  if (bearerType === "landowner") {
    return { expectedDeveloperAmount: 0, expectedLandownerAmount: totalAmount, bearerType };
  }
  if (bearerType === "shared") {
    const devPct = Number(rule.developerPct ?? 50);
    const landownerPct = Number(rule.landownerPct ?? 50);
    return {
      expectedDeveloperAmount: Math.round((totalAmount * devPct) / 100 * 100) / 100,
      expectedLandownerAmount: Math.round((totalAmount * landownerPct) / 100 * 100) / 100,
      bearerType,
    };
  }
  // proportional — look up developer ownership share from agreement
  const [agreement] = await db
    .select({ ownershipShareDeveloper: agreementsTable.ownershipShareDeveloper })
    .from(agreementsTable)
    .where(
      and(
        eq(agreementsTable.projectId, projectId),
        eq(agreementsTable.status, "active"),
      ),
    )
    .limit(1);

  const devSharePct = agreement ? Number(agreement.ownershipShareDeveloper ?? 50) : 50;
  const landownerSharePct = 100 - devSharePct;
  return {
    expectedDeveloperAmount: Math.round((totalAmount * devSharePct) / 100 * 100) / 100,
    expectedLandownerAmount: Math.round((totalAmount * landownerSharePct) / 100 * 100) / 100,
    bearerType,
  };
}

/**
 * Derive actual amounts from the expenditure record's payer role.
 * Employee / staff / admin → treated as developer-side (they operate under developer direction).
 */
function computeActualAmounts(
  payerRole: string | null,
  totalAmount: number,
): { actualDeveloperAmount: number; actualLandownerAmount: number } {
  if (payerRole === "landowner") {
    return { actualDeveloperAmount: 0, actualLandownerAmount: totalAmount };
  }
  return { actualDeveloperAmount: totalAmount, actualLandownerAmount: 0 };
}

/**
 * Compute imbalance, adjustment status, and recoverable amount from expected + actual.
 */
function computeImbalance(
  expectedDeveloperAmount: number,
  expectedLandownerAmount: number,
  actualDeveloperAmount: number,
  actualLandownerAmount: number,
) {
  const developerImbalanceAmount =
    Math.round((actualDeveloperAmount - expectedDeveloperAmount) * 100) / 100;
  const landownerImbalanceAmount =
    Math.round((actualLandownerAmount - expectedLandownerAmount) * 100) / 100;

  let adjustmentStatus: "balanced" | "developer_advance" | "landowner_advance" | "waived" = "balanced";
  let recoverableAmount = 0;

  if (Math.abs(developerImbalanceAmount) < 0.01) {
    adjustmentStatus = "balanced";
  } else if (developerImbalanceAmount > 0) {
    adjustmentStatus = "developer_advance";
    recoverableAmount = developerImbalanceAmount;
  } else {
    adjustmentStatus = "landowner_advance";
    recoverableAmount = landownerImbalanceAmount;
  }

  const recoveryStatus: "none" | "pending" = adjustmentStatus === "balanced" ? "none" : "pending";

  return {
    developerImbalanceAmount,
    landownerImbalanceAmount,
    adjustmentStatus,
    recoverableAmount,
    recoveryStatus,
  };
}

// ── GET /burden/summary ───────────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  // Burden data is inter-party financial — restrict to roles that need it
  if (
    actor.role === "employee" ||
    actor.role === "operational_staff" ||
    actor.role === "investor"
  ) {
    return res.status(403).json({
      error: "Burden analytics are not accessible to your role.",
    });
  }

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({
        totals: { totalAmount: 0, developerAdvanceAmount: 0, landownerAdvanceAmount: 0, recoverableAmount: 0, recoveredAmount: 0, waivedAmount: 0, balancedAmount: 0, recordCount: 0 },
        projects: [],
      });
    }
  }

  const { projectId: filterProjectId } = req.query as { projectId?: string };

  // Build where conditions for records
  const conditions = [eq(burdenRecordsTable.isActive, true)];
  if (filterProjectId) {
    conditions.push(eq(burdenRecordsTable.projectId, filterProjectId));
  } else if (visibleProjectIds !== null) {
    conditions.push(inArray(burdenRecordsTable.projectId, visibleProjectIds));
  }

  const records = await db
    .select({
      record: burdenRecordsTable,
      projectName: projectsTable.name,
    })
    .from(burdenRecordsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, burdenRecordsTable.projectId))
    .where(and(...conditions))
    .orderBy(desc(burdenRecordsTable.createdAt));

  // Aggregate totals
  let totalAmount = 0;
  let developerAdvanceAmount = 0;
  let landownerAdvanceAmount = 0;
  let recoverableAmount = 0;
  let recoveredAmount = 0;
  let waivedAmount = 0;
  let balancedAmount = 0;

  // Per-project aggregation
  const byProject = new Map<string, {
    projectId: string;
    projectName: string;
    totalAmount: number;
    developerAdvanceAmount: number;
    landownerAdvanceAmount: number;
    recoverableAmount: number;
    recoveredAmount: number;
    waivedAmount: number;
    balancedCount: number;
    pendingCount: number;
    recordCount: number;
  }>();

  for (const { record: r, projectName } of records) {
    const amt = Number(r.totalAmount);
    const recoverable = Number(r.recoverableAmount);
    const recovered = Number(r.recoveredAmount);

    totalAmount += amt;
    if (r.adjustmentStatus === "developer_advance") developerAdvanceAmount += recoverable;
    if (r.adjustmentStatus === "landowner_advance") landownerAdvanceAmount += recoverable;
    if (r.adjustmentStatus === "waived") waivedAmount += recoverable;
    if (r.adjustmentStatus === "balanced") balancedAmount += amt;
    if (r.recoveryStatus !== "waived") {
      recoverableAmount += Math.max(0, recoverable - recovered);
    }
    recoveredAmount += recovered;

    const pid = r.projectId ?? "unknown";
    if (!byProject.has(pid)) {
      byProject.set(pid, {
        projectId: pid,
        projectName: projectName ?? "Unknown",
        totalAmount: 0,
        developerAdvanceAmount: 0,
        landownerAdvanceAmount: 0,
        recoverableAmount: 0,
        recoveredAmount: 0,
        waivedAmount: 0,
        balancedCount: 0,
        pendingCount: 0,
        recordCount: 0,
      });
    }
    const pg = byProject.get(pid)!;
    pg.totalAmount += amt;
    pg.recoveredAmount += recovered;
    pg.recordCount += 1;
    if (r.adjustmentStatus === "developer_advance") pg.developerAdvanceAmount += recoverable;
    if (r.adjustmentStatus === "landowner_advance") pg.landownerAdvanceAmount += recoverable;
    if (r.adjustmentStatus === "waived") pg.waivedAmount += recoverable;
    if (r.adjustmentStatus === "balanced") pg.balancedCount += 1;
    if (r.recoveryStatus === "pending" || r.recoveryStatus === "in_recovery") pg.pendingCount += 1;
    if (r.recoveryStatus !== "waived") {
      pg.recoverableAmount += Math.max(0, recoverable - recovered);
    }
  }

  return res.json({
    totals: {
      totalAmount: Math.round(totalAmount * 100) / 100,
      developerAdvanceAmount: Math.round(developerAdvanceAmount * 100) / 100,
      landownerAdvanceAmount: Math.round(landownerAdvanceAmount * 100) / 100,
      recoverableAmount: Math.round(recoverableAmount * 100) / 100,
      recoveredAmount: Math.round(recoveredAmount * 100) / 100,
      waivedAmount: Math.round(waivedAmount * 100) / 100,
      balancedAmount: Math.round(balancedAmount * 100) / 100,
      recordCount: records.length,
    },
    projects: Array.from(byProject.values()),
  });
});

// ── GET /burden/rules ─────────────────────────────────────────────────────────

router.get("/rules", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId: filterProjectId, includeInactive } = req.query as {
    projectId?: string;
    includeInactive?: string;
  };

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const conditions = [];
  if (filterProjectId) {
    conditions.push(eq(burdenRulesTable.projectId, filterProjectId));
  } else if (visibleProjectIds !== null) {
    conditions.push(inArray(burdenRulesTable.projectId, visibleProjectIds));
  }
  if (!includeInactive || includeInactive !== "true") {
    conditions.push(eq(burdenRulesTable.isActive, true));
  }

  const rules = await db
    .select()
    .from(burdenRulesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(burdenRulesTable.createdAt));

  return res.json({ rules: rules.map(formatRule) });
});

// ── POST /burden/rules ────────────────────────────────────────────────────────

router.post(
  "/rules",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const {
      projectId,
      category,
      bearerType,
      developerPct,
      landownerPct,
      lifecyclePhase = "all",
      description,
      effectiveFrom,
      effectiveTo,
    } = req.body as {
      projectId?: string;
      category?: string;
      bearerType?: string;
      developerPct?: number;
      landownerPct?: number;
      lifecyclePhase?: string;
      description?: string;
      effectiveFrom?: string;
      effectiveTo?: string;
    };

    if (!projectId || !bearerType || !effectiveFrom) {
      return res
        .status(400)
        .json({ error: "projectId, bearerType, and effectiveFrom are required." });
    }

    const validBearerTypes = ["developer", "landowner", "shared", "proportional"];
    if (!validBearerTypes.includes(bearerType)) {
      return res.status(400).json({
        error: `Invalid bearerType. Must be one of: ${validBearerTypes.join(", ")}`,
      });
    }

    if (bearerType === "shared") {
      if (developerPct === undefined || landownerPct === undefined) {
        return res
          .status(400)
          .json({ error: "developerPct and landownerPct are required for shared bearer type." });
      }
      const sum = Number(developerPct) + Number(landownerPct);
      if (Math.abs(sum - 100) > 0.01) {
        return res
          .status(400)
          .json({ error: `developerPct + landownerPct must equal 100 (got ${sum}).` });
      }
    }

    // Verify project access
    if (!canAccessAllProjects(actor.role)) {
      const assigned = await getAssignedProjectIds(actor.id);
      if (!assigned.includes(projectId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const [rule] = await db
      .insert(burdenRulesTable)
      .values({
        projectId,
        category: category ?? null,
        bearerType: bearerType as typeof burdenRulesTable.$inferInsert["bearerType"],
        developerPct: developerPct !== undefined ? String(developerPct) : null,
        landownerPct: landownerPct !== undefined ? String(landownerPct) : null,
        lifecyclePhase,
        description: description ?? null,
        effectiveFrom,
        effectiveTo: effectiveTo ?? null,
        createdById: actor.id,
      })
      .returning();

    req.log.info({ ruleId: rule.id, projectId }, "Burden rule created");
    return res.status(201).json(formatRule(rule));
  },
);

// ── PATCH /burden/rules/:id ───────────────────────────────────────────────────

router.patch(
  "/rules/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const ruleId = String(req.params.id);
    const [existing] = await db
      .select()
      .from(burdenRulesTable)
      .where(eq(burdenRulesTable.id, ruleId))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Rule not found" });

    if (!canAccessAllProjects(actor.role)) {
      const assigned = await getAssignedProjectIds(actor.id);
      if (!assigned.includes(existing.projectId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const {
      category,
      bearerType,
      developerPct,
      landownerPct,
      lifecyclePhase,
      description,
      effectiveFrom,
      effectiveTo,
      isActive,
    } = req.body as {
      category?: string | null;
      bearerType?: string;
      developerPct?: number | null;
      landownerPct?: number | null;
      lifecyclePhase?: string;
      description?: string | null;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      isActive?: boolean;
    };

    const updates: Partial<typeof burdenRulesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (category !== undefined) updates.category = category;
    if (bearerType !== undefined)
      updates.bearerType = bearerType as typeof burdenRulesTable.$inferInsert["bearerType"];
    if (developerPct !== undefined)
      updates.developerPct = developerPct !== null ? String(developerPct) : null;
    if (landownerPct !== undefined)
      updates.landownerPct = landownerPct !== null ? String(landownerPct) : null;
    if (lifecyclePhase !== undefined) updates.lifecyclePhase = lifecyclePhase;
    if (description !== undefined) updates.description = description;
    if (effectiveFrom !== undefined) updates.effectiveFrom = effectiveFrom;
    if (effectiveTo !== undefined) updates.effectiveTo = effectiveTo;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(burdenRulesTable)
      .set(updates)
      .where(eq(burdenRulesTable.id, ruleId))
      .returning();

    return res.json(formatRule(updated));
  },
);

// ── GET /burden/records ───────────────────────────────────────────────────────

router.get("/records", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  // Burden records contain inter-party cost allocation — restricted to parties who need them
  if (
    actor.role === "employee" ||
    actor.role === "operational_staff" ||
    actor.role === "investor"
  ) {
    return res.status(403).json({
      error: "Burden records are not accessible to your role.",
    });
  }

  const {
    projectId: filterProjectId,
    adjustmentStatus: filterAdjustmentStatus,
    recoveryStatus: filterRecoveryStatus,
    expenditureId: filterExpenditureId,
  } = req.query as {
    projectId?: string;
    adjustmentStatus?: string;
    recoveryStatus?: string;
    expenditureId?: string;
  };

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) return res.json({ records: [] });
  }

  const conditions = [eq(burdenRecordsTable.isActive, true)];
  if (filterProjectId) {
    conditions.push(eq(burdenRecordsTable.projectId, filterProjectId));
  } else if (visibleProjectIds !== null) {
    conditions.push(inArray(burdenRecordsTable.projectId, visibleProjectIds));
  }
  if (filterAdjustmentStatus) {
    conditions.push(
      eq(
        burdenRecordsTable.adjustmentStatus,
        filterAdjustmentStatus as typeof burdenRecordsTable.$inferSelect["adjustmentStatus"],
      ),
    );
  }
  if (filterRecoveryStatus) {
    conditions.push(
      eq(
        burdenRecordsTable.recoveryStatus,
        filterRecoveryStatus as typeof burdenRecordsTable.$inferSelect["recoveryStatus"],
      ),
    );
  }
  if (filterExpenditureId) {
    conditions.push(eq(burdenRecordsTable.expenditureId, filterExpenditureId));
  }

  const rows = await db
    .select({
      record: burdenRecordsTable,
      projectName: projectsTable.name,
      expenditureDescription: expendituresTable.description,
    })
    .from(burdenRecordsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, burdenRecordsTable.projectId))
    .leftJoin(
      expendituresTable,
      eq(expendituresTable.id, burdenRecordsTable.expenditureId),
    )
    .where(and(...conditions))
    .orderBy(desc(burdenRecordsTable.createdAt));

  return res.json({
    records: rows.map((r) =>
      formatRecord(r.record, {
        projectName: r.projectName,
        expenditureDescription: r.expenditureDescription,
      }),
    ),
  });
});

// ── POST /burden/records ──────────────────────────────────────────────────────

router.post(
  "/records",
  requireRole("admin", "developer", "landowner"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const {
      expenditureId,
      // Optional overrides — if not provided, auto-computed from the expenditure + rules
      expectedBearerType: overrideBearerType,
      expectedDeveloperAmount: overrideDevAmount,
      expectedLandownerAmount: overrideLandownerAmount,
      notes,
    } = req.body as {
      expenditureId?: string;
      expectedBearerType?: string;
      expectedDeveloperAmount?: number;
      expectedLandownerAmount?: number;
      notes?: string;
    };

    if (!expenditureId) {
      return res.status(400).json({ error: "expenditureId is required." });
    }

    // Check existing record for this expenditure
    const [existing] = await db
      .select()
      .from(burdenRecordsTable)
      .where(
        and(
          eq(burdenRecordsTable.expenditureId, expenditureId),
          eq(burdenRecordsTable.isActive, true),
        ),
      )
      .limit(1);

    if (existing) {
      return res.status(409).json({
        error: "A burden record already exists for this expenditure. Use PATCH to update it.",
        existingId: existing.id,
      });
    }

    // Load the expenditure
    const [expRow] = await db
      .select({ exp: expendituresTable, projectName: projectsTable.name })
      .from(expendituresTable)
      .leftJoin(projectsTable, eq(projectsTable.id, expendituresTable.projectId))
      .where(
        and(
          eq(expendituresTable.id, expenditureId),
          eq(expendituresTable.isActive, true),
        ),
      )
      .limit(1);

    if (!expRow) return res.status(404).json({ error: "Expenditure not found" });

    const exp = expRow.exp;

    // Access check
    if (!canAccessAllProjects(actor.role)) {
      const assigned = await getAssignedProjectIds(actor.id);
      if (!assigned.includes(exp.projectId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const totalAmount = Number(exp.amount);
    const today = new Date().toISOString().slice(0, 10);

    // Find matching rule
    const rule = await findMatchingRule(
      exp.projectId,
      exp.category,
      exp.lifecyclePhaseSnapshot,
      today,
    );

    // Compute expected amounts
    let expectedDeveloperAmount: number;
    let expectedLandownerAmount: number;
    let bearerType: string;
    let ruleId: string | null = null;

    if (overrideBearerType !== undefined) {
      // Manual override provided
      bearerType = overrideBearerType;
      expectedDeveloperAmount = overrideDevAmount ?? totalAmount;
      expectedLandownerAmount = overrideLandownerAmount ?? 0;
    } else if (rule) {
      ruleId = rule.id;
      const computed = await computeExpectedAmounts(rule, exp.projectId, totalAmount);
      expectedDeveloperAmount = computed.expectedDeveloperAmount;
      expectedLandownerAmount = computed.expectedLandownerAmount;
      bearerType = computed.bearerType;
    } else {
      // No rule — default to developer bears all
      bearerType = "developer";
      expectedDeveloperAmount = totalAmount;
      expectedLandownerAmount = 0;
    }

    // Compute actual amounts
    const payerRole = exp.paidById
      ? (
          await db
            .select({ role: usersTable.role })
            .from(usersTable)
            .where(eq(usersTable.id, exp.paidById))
            .limit(1)
        )[0]?.role ?? exp.recordedByName
      : null;

    // Determine actual payer role: use paidById's role if available, else recordedById's role
    let actualPayerRole = (payerRole as string | null) ?? null;
    let actualPayerName = exp.paidByName ?? exp.recordedByName ?? null;
    let actualPayerId = exp.paidById ?? exp.recordedById ?? null;

    if (!actualPayerRole && exp.recordedById) {
      const [recorder] = await db
        .select({ role: usersTable.role, displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, exp.recordedById))
        .limit(1);
      if (recorder) {
        actualPayerRole = recorder.role;
        actualPayerName = recorder.displayName ?? actualPayerName;
        actualPayerId = exp.recordedById;
      }
    }

    const { actualDeveloperAmount, actualLandownerAmount } = computeActualAmounts(
      actualPayerRole,
      totalAmount,
    );

    const imbalance = computeImbalance(
      expectedDeveloperAmount,
      expectedLandownerAmount,
      actualDeveloperAmount,
      actualLandownerAmount,
    );

    const [record] = await db
      .insert(burdenRecordsTable)
      .values({
        expenditureId,
        projectId: exp.projectId,
        ruleId,
        category: exp.category,
        totalAmount: String(totalAmount),
        lifecyclePhaseSnapshot: exp.lifecyclePhaseSnapshot,
        expectedBearerType: bearerType,
        expectedDeveloperAmount: String(expectedDeveloperAmount),
        expectedLandownerAmount: String(expectedLandownerAmount),
        actualPayerRole: actualPayerRole ?? null,
        actualPayerName: actualPayerName ?? null,
        actualPayerId: actualPayerId ?? null,
        actualDeveloperAmount: String(actualDeveloperAmount),
        actualLandownerAmount: String(actualLandownerAmount),
        developerImbalanceAmount: String(imbalance.developerImbalanceAmount),
        landownerImbalanceAmount: String(imbalance.landownerImbalanceAmount),
        adjustmentStatus: imbalance.adjustmentStatus,
        recoverableAmount: String(imbalance.recoverableAmount),
        recoveredAmount: "0",
        recoveryStatus: imbalance.recoveryStatus,
        notes: notes ?? null,
        createdById: actor.id,
        createdByName: actor.displayName ?? null,
      })
      .returning();

    req.log.info({ recordId: record.id, expenditureId }, "Burden record created");

    // Auto-create imbalance ledger entries when an imbalance exists
    if (record.adjustmentStatus !== "balanced" && record.projectId) {
      const isDevAdvance = record.adjustmentStatus === "developer_advance";
      const imbalanceAmt = Number(record.recoverableAmount);
      createImbalanceLedgerPair({
        projectId: record.projectId,
        burdenRecordId: record.id,
        entryType: "burden_imbalance",
        developerAmount: isDevAdvance ? imbalanceAmt : -imbalanceAmt,
        landownerAmount: isDevAdvance ? -imbalanceAmt : imbalanceAmt,
        description: `Burden imbalance from expenditure`,
        period: new Date().toISOString().slice(0, 7),
        createdById: actor.id,
        createdByName: actor.displayName ?? null,
      }).catch((err: unknown) => {
        req.log.warn({ err }, "Failed to create imbalance ledger entry (non-fatal)");
      });
    }

    return res
      .status(201)
      .json(formatRecord(record, { projectName: expRow.projectName }));
  },
);

// ── PATCH /burden/records/:id ─────────────────────────────────────────────────

router.patch(
  "/records/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const recordId = String(req.params.id);
    const [row] = await db
      .select({ record: burdenRecordsTable, projectName: projectsTable.name })
      .from(burdenRecordsTable)
      .leftJoin(projectsTable, eq(projectsTable.id, burdenRecordsTable.projectId))
      .where(
        and(
          eq(burdenRecordsTable.id, recordId),
          eq(burdenRecordsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!row) return res.status(404).json({ error: "Burden record not found" });

    if (!canAccessAllProjects(actor.role) && row.record.projectId) {
      const assigned = await getAssignedProjectIds(actor.id);
      if (!assigned.includes(row.record.projectId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const { notes, recoveryNotes } = req.body as {
      notes?: string | null;
      recoveryNotes?: string | null;
    };

    const updates: Partial<typeof burdenRecordsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (notes !== undefined) updates.notes = notes;
    if (recoveryNotes !== undefined) updates.recoveryNotes = recoveryNotes;

    const [updated] = await db
      .update(burdenRecordsTable)
      .set(updates)
      .where(eq(burdenRecordsTable.id, recordId))
      .returning();

    return res.json(formatRecord(updated, { projectName: row.projectName }));
  },
);

// ── POST /burden/records/:id/waive ────────────────────────────────────────────

router.post(
  "/records/:id/waive",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const recordId = String(req.params.id);
    const [row] = await db
      .select({ record: burdenRecordsTable, projectName: projectsTable.name })
      .from(burdenRecordsTable)
      .leftJoin(projectsTable, eq(projectsTable.id, burdenRecordsTable.projectId))
      .where(
        and(
          eq(burdenRecordsTable.id, recordId),
          eq(burdenRecordsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!row) return res.status(404).json({ error: "Burden record not found" });

    if (row.record.adjustmentStatus === "balanced") {
      return res
        .status(400)
        .json({ error: "This record is already balanced — nothing to waive." });
    }

    const notes =
      typeof req.body?.notes === "string" ? req.body.notes : null;

    const [updated] = await db
      .update(burdenRecordsTable)
      .set({
        adjustmentStatus: "waived",
        recoveryStatus: "waived",
        recoveryNotes: notes,
        adjustedAt: new Date(),
        adjustedById: actor.id,
        adjustedByName: actor.displayName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(burdenRecordsTable.id, recordId))
      .returning();

    req.log.info({ recordId }, "Burden record waived");

    // Zero out the remaining imbalance in the ledger
    const remaining =
      Math.round(
        (Number(row.record.recoverableAmount) - Number(row.record.recoveredAmount)) * 100,
      ) / 100;
    if (remaining > 0 && row.record.projectId) {
      const isDevAdvance = row.record.adjustmentStatus === "developer_advance";
      createImbalanceLedgerPair({
        projectId: row.record.projectId,
        burdenRecordId: recordId,
        entryType: "waiver",
        developerAmount: isDevAdvance ? -remaining : remaining,
        landownerAmount: isDevAdvance ? remaining : -remaining,
        description: `Burden imbalance waived`,
        period: new Date().toISOString().slice(0, 7),
        createdById: actor.id,
        createdByName: actor.displayName ?? null,
      }).catch((err: unknown) => {
        req.log.warn({ err }, "Failed to create waiver ledger entry (non-fatal)");
      });
    }

    return res.json(formatRecord(updated, { projectName: row.projectName }));
  },
);

// ── POST /burden/records/:id/recover ─────────────────────────────────────────

router.post(
  "/records/:id/recover",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const recordId = String(req.params.id);
    const [row] = await db
      .select({ record: burdenRecordsTable, projectName: projectsTable.name })
      .from(burdenRecordsTable)
      .leftJoin(projectsTable, eq(projectsTable.id, burdenRecordsTable.projectId))
      .where(
        and(
          eq(burdenRecordsTable.id, recordId),
          eq(burdenRecordsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!row) return res.status(404).json({ error: "Burden record not found" });

    const r = row.record;

    if (r.adjustmentStatus === "balanced" || r.adjustmentStatus === "waived") {
      return res.status(400).json({
        error: `Cannot record recovery for a ${r.adjustmentStatus} record.`,
      });
    }

    const { amount, notes } = req.body as { amount?: number; notes?: string };

    if (typeof amount !== "number" || amount <= 0) {
      return res
        .status(400)
        .json({ error: "A positive recovery amount is required." });
    }

    const newRecoveredAmount =
      Math.round((Number(r.recoveredAmount) + amount) * 100) / 100;
    const recoverableAmount = Number(r.recoverableAmount);

    if (newRecoveredAmount > recoverableAmount + 0.01) {
      return res.status(400).json({
        error: `Recovery amount ${newRecoveredAmount} exceeds recoverable amount ${recoverableAmount}.`,
      });
    }

    const isFullyRecovered = newRecoveredAmount >= recoverableAmount - 0.01;
    const newRecoveryStatus: "in_recovery" | "recovered" = isFullyRecovered
      ? "recovered"
      : "in_recovery";

    const [updated] = await db
      .update(burdenRecordsTable)
      .set({
        recoveredAmount: String(newRecoveredAmount),
        recoveryStatus: newRecoveryStatus,
        recoveryNotes: notes ?? r.recoveryNotes,
        adjustedAt: new Date(),
        adjustedById: actor.id,
        adjustedByName: actor.displayName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(burdenRecordsTable.id, recordId))
      .returning();

    req.log.info({ recordId, amount, newRecoveryStatus }, "Burden record recovery payment recorded");

    // Record the recovery offset in the imbalance ledger
    if (r.projectId) {
      const isDevAdvance = r.adjustmentStatus === "developer_advance";
      createImbalanceLedgerPair({
        projectId: r.projectId,
        burdenRecordId: recordId,
        entryType: "recovery",
        // Recovery reduces the overpaying party's credit and reduces the underpaying party's debit
        developerAmount: isDevAdvance ? -amount : amount,
        landownerAmount: isDevAdvance ? amount : -amount,
        description: `Recovery payment of ₹${amount.toLocaleString("en-IN")}`,
        period: new Date().toISOString().slice(0, 7),
        createdById: actor.id,
        createdByName: actor.displayName ?? null,
      }).catch((err: unknown) => {
        req.log.warn({ err }, "Failed to create recovery ledger entry (non-fatal)");
      });
    }

    return res.json(formatRecord(updated, { projectName: row.projectName }));
  },
);

export default router;
