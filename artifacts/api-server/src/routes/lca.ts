import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, isNull, asc } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  agreementsTable,
  lcaConfigsTable,
  lcaLedgerTable,
  lcaPaymentEventsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
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

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function formatConfig(row: typeof lcaConfigsTable.$inferSelect & { projectName?: string | null; agreementRef?: string | null }) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    agreementId: row.agreementId ?? undefined,
    agreementRef: row.agreementRef ?? undefined,
    baseAmount: Number(row.baseAmount),
    escalationPct: Number(row.escalationPct),
    effectiveStartDate: row.effectiveStartDate,
    startYear: row.startYear,
    notes: row.notes ?? undefined,
    isActive: row.isActive,
    createdById: row.createdById ?? undefined,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatEntry(row: typeof lcaLedgerTable.$inferSelect & { projectName?: string | null }) {
  return {
    id: row.id,
    configId: row.configId,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    year: row.year,
    baseAmount: Number(row.baseAmount),
    escalationFactor: Number(row.escalationFactor),
    grossDue: Number(row.grossDue),
    carryForward: Number(row.carryForward),
    totalDue: Number(row.totalDue),
    amountPaid: Number(row.amountPaid),
    balance: Number(row.balance),
    status: row.status,
    paidAt: row.paidAt ?? undefined,
    notes: row.notes ?? undefined,
    isActive: row.isActive,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Compute escalated gross due for a given year offset.
 * n = 0 → base amount (no escalation)
 * n = 1 → base * (1 + pct/100)^1, etc.
 */
function computeGrossDue(baseAmount: number, escalationPct: number, yearOffset: number): number {
  if (yearOffset <= 0 || escalationPct === 0) return baseAmount;
  return baseAmount * Math.pow(1 + escalationPct / 100, yearOffset);
}

// ── GET /lca/configs ─────────────────────────────────────────────────────────

router.get("/configs", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, includeInactive } = req.query as Record<string, string>;
  const showInactive = includeInactive === "true";

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const rows = await db
    .select({
      config: lcaConfigsTable,
      projectName: projectsTable.name,
    })
    .from(lcaConfigsTable)
    .leftJoin(projectsTable, eq(lcaConfigsTable.projectId, projectsTable.id))
    .where(
      and(
        showInactive ? undefined : eq(lcaConfigsTable.isActive, true),
        projectId ? eq(lcaConfigsTable.projectId, String(projectId)) : undefined,
        visibleProjectIds
          ? inArray(lcaConfigsTable.projectId, visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"])
          : undefined,
      ),
    )
    .orderBy(desc(lcaConfigsTable.createdAt));

  return res.json(
    rows.map((r) => formatConfig({ ...r.config, projectName: r.projectName })),
  );
});

// ── POST /lca/configs ────────────────────────────────────────────────────────

router.post(
  "/configs",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const body = req.body as {
      projectId: string;
      agreementId?: string;
      baseAmount: number;
      escalationPct?: number;
      effectiveStartDate: string;
      notes?: string;
    };

    if (!body.projectId || typeof body.baseAmount !== "number" || body.baseAmount <= 0) {
      return res.status(400).json({ error: "projectId and baseAmount (> 0) are required" });
    }
    if (!body.effectiveStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveStartDate)) {
      return res.status(400).json({ error: "effectiveStartDate must be YYYY-MM-DD" });
    }

    // Validate project
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, String(body.projectId)), eq(projectsTable.isActive, true)))
      .limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (project.lifecycleStatus !== "mature_production") {
      return res.status(400).json({
        error: "LCA can only be configured for projects in mature_production phase",
        lifecycleStatus: project.lifecycleStatus,
      });
    }

    // Validate agreement if provided
    let agreementRef: string | null = null;
    if (body.agreementId) {
      const [agreement] = await db
        .select()
        .from(agreementsTable)
        .where(and(eq(agreementsTable.id, String(body.agreementId)), isNull(agreementsTable.deletedAt)))
        .limit(1);
      if (!agreement) return res.status(404).json({ error: "Agreement not found" });
      if (agreement.revenueModel !== "contribution") {
        return res.status(400).json({
          error: "LCA applies only to contribution-model agreements, not fifty_percent_revenue",
          revenueModel: agreement.revenueModel,
        });
      }
      agreementRef = agreement.id;
    }

    // Enforce one active config per project
    const [existing] = await db
      .select({ id: lcaConfigsTable.id })
      .from(lcaConfigsTable)
      .where(
        and(
          eq(lcaConfigsTable.projectId, String(body.projectId)),
          eq(lcaConfigsTable.isActive, true),
        ),
      )
      .limit(1);
    if (existing) {
      return res.status(409).json({
        error: "An active LCA configuration already exists for this project. Deactivate it first.",
        existingConfigId: existing.id,
      });
    }

    const startYear = new Date(body.effectiveStartDate).getFullYear();
    const escalationPct = typeof body.escalationPct === "number" ? body.escalationPct : 0;

    const [created] = await db
      .insert(lcaConfigsTable)
      .values({
        projectId: String(body.projectId),
        agreementId: agreementRef ?? undefined,
        baseAmount: body.baseAmount,
        escalationPct,
        effectiveStartDate: body.effectiveStartDate,
        startYear,
        notes: body.notes ?? null,
        isActive: true,
        createdById: actor.id,
        createdByName: actor.displayName ?? actor.email ?? "Unknown",
      })
      .returning();

    const [projectRow] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, created.projectId))
      .limit(1);

    return res.status(201).json(formatConfig({ ...created, projectName: projectRow?.name }));
  },
);

// ── GET /lca/configs/:id ─────────────────────────────────────────────────────

router.get("/configs/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [row] = await db
    .select({
      config: lcaConfigsTable,
      projectName: projectsTable.name,
    })
    .from(lcaConfigsTable)
    .leftJoin(projectsTable, eq(lcaConfigsTable.projectId, projectsTable.id))
    .where(eq(lcaConfigsTable.id, String(req.params.id)))
    .limit(1);

  if (!row) return res.status(404).json({ error: "LCA config not found" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(row.config.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  return res.json(formatConfig({ ...row.config, projectName: row.projectName }));
});

// ── PATCH /lca/configs/:id ───────────────────────────────────────────────────

router.patch(
  "/configs/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const [existing] = await db
      .select()
      .from(lcaConfigsTable)
      .where(eq(lcaConfigsTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "LCA config not found" });

    const body = req.body as {
      baseAmount?: number;
      escalationPct?: number;
      notes?: string;
      agreementId?: string | null;
    };

    const updates: Partial<typeof lcaConfigsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.baseAmount === "number" && body.baseAmount > 0) {
      updates.baseAmount = body.baseAmount;
    }
    if (typeof body.escalationPct === "number" && body.escalationPct >= 0) {
      updates.escalationPct = body.escalationPct;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes ?? null;
    }
    if (body.agreementId !== undefined) {
      if (body.agreementId === null) {
        updates.agreementId = null;
      } else {
        const [agr] = await db
          .select()
          .from(agreementsTable)
          .where(and(eq(agreementsTable.id, String(body.agreementId)), isNull(agreementsTable.deletedAt)))
          .limit(1);
        if (!agr) return res.status(404).json({ error: "Agreement not found" });
        if (agr.revenueModel !== "contribution") {
          return res.status(400).json({
            error: "LCA applies only to contribution-model agreements",
          });
        }
        updates.agreementId = agr.id;
      }
    }

    const [updated] = await db
      .update(lcaConfigsTable)
      .set(updates)
      .where(eq(lcaConfigsTable.id, String(req.params.id)))
      .returning();

    const [projectRow] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatConfig({ ...updated, projectName: projectRow?.name }));
  },
);

// ── DELETE /lca/configs/:id ──────────────────────────────────────────────────

router.delete(
  "/configs/:id",
  requireRole("admin"),
  async (req, res) => {
    const [existing] = await db
      .select()
      .from(lcaConfigsTable)
      .where(eq(lcaConfigsTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "LCA config not found" });

    await db
      .update(lcaConfigsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(lcaConfigsTable.id, String(req.params.id)));

    return res.json({ success: true });
  },
);

// ── GET /lca/configs/:id/schedule ────────────────────────────────────────────

router.get("/configs/:id/schedule", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [row] = await db
    .select()
    .from(lcaConfigsTable)
    .where(eq(lcaConfigsTable.id, String(req.params.id)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "LCA config not found" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(row.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const yearsParam = req.query.years ? Number(req.query.years) : 10;
  const years = Math.max(1, Math.min(40, isNaN(yearsParam) ? 10 : yearsParam));

  // Fetch existing ledger entries for this config to merge payment state
  const existingEntries = await db
    .select()
    .from(lcaLedgerTable)
    .where(eq(lcaLedgerTable.configId, row.id));
  const entryByYear = new Map(existingEntries.map((e) => [e.year, e]));

  const baseAmount = Number(row.baseAmount);
  const escalationPct = Number(row.escalationPct);
  const startYear = row.startYear;

  const schedule = [];
  let cumulativeCarryForward = 0;

  for (let i = 0; i < years; i++) {
    const year = startYear + i;
    const existing = entryByYear.get(year);

    const grossDue = computeGrossDue(baseAmount, escalationPct, i);
    const carryForward = existing
      ? Number(existing.carryForward)
      : cumulativeCarryForward;
    const totalDue = grossDue + carryForward;
    const amountPaid = existing ? Number(existing.amountPaid) : 0;
    const balance = Math.max(0, totalDue - amountPaid);

    schedule.push({
      year,
      yearOffset: i,
      grossDue: Math.round(grossDue * 100) / 100,
      carryForward: Math.round(carryForward * 100) / 100,
      totalDue: Math.round(totalDue * 100) / 100,
      amountPaid: Math.round(amountPaid * 100) / 100,
      balance: Math.round(balance * 100) / 100,
      status: existing?.status ?? "pending",
      ledgerEntryId: existing?.id ?? null,
      hasLedgerEntry: !!existing,
    });

    // Carry forward unpaid balance to next year (not escalated)
    cumulativeCarryForward = existing ? balance : balance;
  }

  return res.json({
    configId: row.id,
    projectId: row.projectId,
    startYear,
    escalationPct,
    baseAmount,
    schedule,
  });
});

// ── GET /lca/ledger ──────────────────────────────────────────────────────────

router.get("/ledger", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, configId, year, status } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const rows = await db
    .select({
      entry: lcaLedgerTable,
      projectName: projectsTable.name,
    })
    .from(lcaLedgerTable)
    .leftJoin(projectsTable, eq(lcaLedgerTable.projectId, projectsTable.id))
    .where(
      and(
        eq(lcaLedgerTable.isActive, true),
        projectId ? eq(lcaLedgerTable.projectId, String(projectId)) : undefined,
        configId ? eq(lcaLedgerTable.configId, String(configId)) : undefined,
        year ? eq(lcaLedgerTable.year, Number(year)) : undefined,
        status ? eq(lcaLedgerTable.status, status as "pending" | "partial" | "paid" | "waived") : undefined,
        visibleProjectIds
          ? inArray(lcaLedgerTable.projectId, visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"])
          : undefined,
      ),
    )
    .orderBy(desc(lcaLedgerTable.year));

  return res.json(rows.map((r) => formatEntry({ ...r.entry, projectName: r.projectName })));
});

// ── POST /lca/ledger ─────────────────────────────────────────────────────────

router.post(
  "/ledger",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const body = req.body as {
      configId: string;
      year: number;
      amountPaid?: number;
      notes?: string;
    };

    if (!body.configId || typeof body.year !== "number") {
      return res.status(400).json({ error: "configId and year are required" });
    }

    const [config] = await db
      .select()
      .from(lcaConfigsTable)
      .where(and(eq(lcaConfigsTable.id, String(body.configId)), eq(lcaConfigsTable.isActive, true)))
      .limit(1);
    if (!config) return res.status(404).json({ error: "LCA config not found or inactive" });

    // Check for duplicate
    const [dup] = await db
      .select({ id: lcaLedgerTable.id })
      .from(lcaLedgerTable)
      .where(
        and(
          eq(lcaLedgerTable.configId, String(body.configId)),
          eq(lcaLedgerTable.year, body.year),
          eq(lcaLedgerTable.isActive, true),
        ),
      )
      .limit(1);
    if (dup) {
      return res.status(409).json({
        error: "A ledger entry for this year already exists",
        existingId: dup.id,
      });
    }

    // Compute escalation
    const yearOffset = body.year - config.startYear;
    if (yearOffset < 0) {
      return res.status(400).json({
        error: `Year ${body.year} is before the LCA start year (${config.startYear})`,
      });
    }

    const baseAmount = Number(config.baseAmount);
    const escalationPct = Number(config.escalationPct);
    const grossDue = computeGrossDue(baseAmount, escalationPct, yearOffset);
    const escalationFactor = yearOffset === 0 ? 1.0 : Math.pow(1 + escalationPct / 100, yearOffset);

    // Compute carry-forward from previous year
    let carryForward = 0;
    const [prevEntry] = await db
      .select()
      .from(lcaLedgerTable)
      .where(
        and(
          eq(lcaLedgerTable.configId, String(body.configId)),
          eq(lcaLedgerTable.year, body.year - 1),
          eq(lcaLedgerTable.isActive, true),
        ),
      )
      .limit(1);
    if (prevEntry && prevEntry.status !== "paid" && prevEntry.status !== "waived") {
      carryForward = Math.max(0, Number(prevEntry.balance));
    }

    const totalDue = grossDue + carryForward;
    const amountPaid = Math.min(typeof body.amountPaid === "number" ? body.amountPaid : 0, totalDue);
    const balance = Math.max(0, totalDue - amountPaid);

    let status: "pending" | "partial" | "paid" | "waived" = "pending";
    if (amountPaid >= totalDue) status = "paid";
    else if (amountPaid > 0) status = "partial";

    const [created] = await db
      .insert(lcaLedgerTable)
      .values({
        configId: String(body.configId),
        projectId: config.projectId,
        year: body.year,
        baseAmount,
        escalationFactor,
        grossDue,
        carryForward,
        totalDue,
        amountPaid,
        balance,
        status,
        paidAt: status === "paid" ? new Date().toISOString().slice(0, 10) : null,
        notes: body.notes ?? null,
        isActive: true,
        createdById: actor.id,
        createdByName: actor.displayName ?? actor.email ?? "Unknown",
      })
      .returning();

    const [projectRow] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, created.projectId))
      .limit(1);

    return res.status(201).json(formatEntry({ ...created, projectName: projectRow?.name }));
  },
);

// ── PATCH /lca/ledger/:id ────────────────────────────────────────────────────

router.patch(
  "/ledger/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const [existing] = await db
      .select()
      .from(lcaLedgerTable)
      .where(eq(lcaLedgerTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Ledger entry not found" });

    const body = req.body as {
      amountPaid?: number;
      status?: "pending" | "partial" | "paid" | "waived";
      notes?: string;
      paidAt?: string;
    };

    const totalDue = Number(existing.totalDue);
    const newPaid =
      typeof body.amountPaid === "number"
        ? Math.max(0, Math.min(body.amountPaid, totalDue))
        : Number(existing.amountPaid);

    const balance = Math.max(0, totalDue - newPaid);

    let newStatus = existing.status;
    if (body.status === "waived") {
      newStatus = "waived";
    } else {
      if (newPaid >= totalDue) newStatus = "paid";
      else if (newPaid > 0) newStatus = "partial";
      else newStatus = "pending";
    }

    const [updated] = await db
      .update(lcaLedgerTable)
      .set({
        amountPaid: newPaid,
        balance,
        status: newStatus,
        paidAt:
          newStatus === "paid" || newStatus === "waived"
            ? (body.paidAt ?? new Date().toISOString().slice(0, 10))
            : (existing.paidAt ?? null),
        notes: body.notes !== undefined ? body.notes : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(lcaLedgerTable.id, String(req.params.id)))
      .returning();

    const [projectRow] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatEntry({ ...updated, projectName: projectRow?.name }));
  },
);

// ── GET /lca/summary ─────────────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const configRows = await db
    .select({
      config: lcaConfigsTable,
      projectName: projectsTable.name,
    })
    .from(lcaConfigsTable)
    .leftJoin(projectsTable, eq(lcaConfigsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(lcaConfigsTable.isActive, true),
        projectId ? eq(lcaConfigsTable.projectId, String(projectId)) : undefined,
        visibleProjectIds
          ? inArray(lcaConfigsTable.projectId, visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"])
          : undefined,
      ),
    );

  const configIds = configRows.map((r) => r.config.id);

  const ledgerRows = configIds.length > 0
    ? await db
        .select()
        .from(lcaLedgerTable)
        .where(
          and(
            inArray(lcaLedgerTable.configId, configIds),
            eq(lcaLedgerTable.isActive, true),
          ),
        )
    : [];

  const totalGrossDue = ledgerRows.reduce((s, r) => s + Number(r.grossDue), 0);
  const totalCarryForward = ledgerRows.reduce((s, r) => s + Number(r.carryForward), 0);
  const totalDue = ledgerRows.reduce((s, r) => s + Number(r.totalDue), 0);
  const totalPaid = ledgerRows.reduce((s, r) => s + Number(r.amountPaid), 0);
  const totalBalance = ledgerRows.reduce((s, r) => s + Number(r.balance), 0);

  const pendingCount = ledgerRows.filter((r) => r.status === "pending").length;
  const partialCount = ledgerRows.filter((r) => r.status === "partial").length;
  const paidCount = ledgerRows.filter((r) => r.status === "paid").length;
  const waivedCount = ledgerRows.filter((r) => r.status === "waived").length;

  // Per-project breakdown
  const byProject = configRows.map((cr) => {
    const entries = ledgerRows.filter((r) => r.configId === cr.config.id);
    const projTotalDue = entries.reduce((s, r) => s + Number(r.totalDue), 0);
    const projPaid = entries.reduce((s, r) => s + Number(r.amountPaid), 0);
    const projBalance = entries.reduce((s, r) => s + Number(r.balance), 0);
    return {
      projectId: cr.config.projectId,
      projectName: cr.projectName ?? undefined,
      configId: cr.config.id,
      baseAmount: Number(cr.config.baseAmount),
      escalationPct: Number(cr.config.escalationPct),
      startYear: cr.config.startYear,
      totalDue: Math.round(projTotalDue * 100) / 100,
      totalPaid: Math.round(projPaid * 100) / 100,
      balance: Math.round(projBalance * 100) / 100,
      entryCount: entries.length,
      pendingEntries: entries.filter((r) => r.status === "pending" || r.status === "partial").length,
    };
  });

  return res.json({
    configCount: configRows.length,
    totalGrossDue: Math.round(totalGrossDue * 100) / 100,
    totalCarryForward: Math.round(totalCarryForward * 100) / 100,
    totalDue: Math.round(totalDue * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalBalance: Math.round(totalBalance * 100) / 100,
    pendingCount,
    partialCount,
    paidCount,
    waivedCount,
    byProject,
  });
});

// ── POST /lca/configs/:id/auto-generate ──────────────────────────────────────
// Auto-generate all missing yearly ledger entries from startYear → toYear.
// Entries are computed in sequence so each year's carry-forward reflects the
// previous year's actual balance. Already-existing entries are skipped.

router.post(
  "/configs/:id/auto-generate",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const [config] = await db
      .select()
      .from(lcaConfigsTable)
      .where(eq(lcaConfigsTable.id, String(req.params.id)))
      .limit(1);
    if (!config) return res.status(404).json({ error: "LCA config not found" });
    if (!config.isActive) return res.status(400).json({ error: "Config is inactive" });

    const currentYear = new Date().getFullYear();
    const body = req.body as { toYear?: number };
    const toYear = body.toYear && Number.isInteger(body.toYear)
      ? Math.min(body.toYear, currentYear + 5)
      : currentYear;

    if (toYear < config.startYear) {
      return res.status(400).json({
        error: `toYear (${toYear}) is before startYear (${config.startYear})`,
      });
    }

    // Fetch existing entries for this config
    const existing = await db
      .select()
      .from(lcaLedgerTable)
      .where(and(eq(lcaLedgerTable.configId, config.id), eq(lcaLedgerTable.isActive, true)))
      .orderBy(asc(lcaLedgerTable.year));

    const existingByYear = new Map(existing.map((e) => [e.year, e]));
    const baseAmount = Number(config.baseAmount);
    const escalationPct = Number(config.escalationPct);
    const creatorName = actor.displayName ?? actor.email ?? "System";

    const generated: typeof lcaLedgerTable.$inferSelect[] = [];
    const skippedYears: number[] = [];

    for (let year = config.startYear; year <= toYear; year++) {
      if (existingByYear.has(year)) {
        skippedYears.push(year);
        continue;
      }

      const yearOffset = year - config.startYear;
      const escalationFactor = yearOffset === 0 ? 1.0 : Math.pow(1 + escalationPct / 100, yearOffset);
      const grossDue = baseAmount * escalationFactor;

      // Carry-forward from previous year's balance (not escalated)
      let carryForward = 0;
      const prevEntry = existingByYear.get(year - 1)
        ?? generated.find((e) => e.year === year - 1);
      if (prevEntry && prevEntry.status !== "paid" && prevEntry.status !== "waived") {
        carryForward = Math.max(0, Number(prevEntry.balance));
      }

      const totalDue = grossDue + carryForward;

      const [created] = await db
        .insert(lcaLedgerTable)
        .values({
          configId: config.id,
          projectId: config.projectId,
          year,
          baseAmount,
          escalationFactor,
          grossDue,
          carryForward,
          totalDue,
          amountPaid: 0,
          balance: totalDue,
          status: "pending",
          isActive: true,
          createdById: actor.id,
          createdByName: creatorName,
        })
        .returning();

      generated.push(created);
      existingByYear.set(year, created);
    }

    const projectRow = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, config.projectId))
      .limit(1)
      .then((r) => r[0]);

    return res.json({
      configId: config.id,
      generated: generated.map((e) => formatEntry({ ...e, projectName: projectRow?.name })),
      skippedYears,
      generatedCount: generated.length,
      totalYears: toYear - config.startYear + 1,
    });
  },
);

// ── GET /lca/ledger/:id/payments ─────────────────────────────────────────────

router.get("/ledger/:id/payments", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [entry] = await db
    .select()
    .from(lcaLedgerTable)
    .where(eq(lcaLedgerTable.id, String(req.params.id)))
    .limit(1);
  if (!entry) return res.status(404).json({ error: "Ledger entry not found" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(entry.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const events = await db
    .select()
    .from(lcaPaymentEventsTable)
    .where(eq(lcaPaymentEventsTable.ledgerEntryId, String(req.params.id)))
    .orderBy(desc(lcaPaymentEventsTable.createdAt));

  return res.json(events.map(formatPaymentEvent));
});

// ── POST /lca/ledger/:id/payments ────────────────────────────────────────────

router.post(
  "/ledger/:id/payments",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const [entry] = await db
      .select()
      .from(lcaLedgerTable)
      .where(eq(lcaLedgerTable.id, String(req.params.id)))
      .limit(1);
    if (!entry) return res.status(404).json({ error: "Ledger entry not found" });

    if (entry.status === "waived") {
      return res.status(400).json({ error: "Cannot record payment on a waived entry" });
    }

    const body = req.body as {
      amountPaid: number;
      paymentDate: string;
      paymentRef?: string;
      notes?: string;
    };

    if (typeof body.amountPaid !== "number" || body.amountPaid <= 0) {
      return res.status(400).json({ error: "amountPaid must be a positive number" });
    }
    if (!body.paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate)) {
      return res.status(400).json({ error: "paymentDate must be YYYY-MM-DD" });
    }

    const currentPaid = Number(entry.amountPaid);
    const totalDue = Number(entry.totalDue);
    const newTotalPaid = Math.min(currentPaid + body.amountPaid, totalDue);
    const newBalance = Math.max(0, totalDue - newTotalPaid);

    let newStatus: "pending" | "partial" | "paid" | "waived" = "pending";
    if (newTotalPaid >= totalDue) newStatus = "paid";
    else if (newTotalPaid > 0) newStatus = "partial";

    // Insert payment event
    const [event] = await db
      .insert(lcaPaymentEventsTable)
      .values({
        ledgerEntryId: entry.id,
        configId: entry.configId,
        projectId: entry.projectId,
        year: entry.year,
        amountPaid: body.amountPaid,
        paymentDate: body.paymentDate,
        paymentRef: body.paymentRef ?? null,
        notes: body.notes ?? null,
        recordedById: actor.id,
        recordedByName: actor.displayName ?? actor.email ?? "Unknown",
      })
      .returning();

    // Update ledger entry
    const [updatedEntry] = await db
      .update(lcaLedgerTable)
      .set({
        amountPaid: newTotalPaid,
        balance: newBalance,
        status: newStatus,
        paidAt: newStatus === "paid" ? body.paymentDate : entry.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(lcaLedgerTable.id, entry.id))
      .returning();

    const [projectRow] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updatedEntry.projectId))
      .limit(1);

    return res.status(201).json({
      event: formatPaymentEvent(event),
      ledgerEntry: formatEntry({ ...updatedEntry, projectName: projectRow?.name }),
    });
  },
);

// ── GET /lca/full-ledger ──────────────────────────────────────────────────────
// ERP-style full accounting view: config + all entries + per-entry payment history.

router.get("/full-ledger", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, configId } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const configRows = await db
    .select({
      config: lcaConfigsTable,
      projectName: projectsTable.name,
    })
    .from(lcaConfigsTable)
    .leftJoin(projectsTable, eq(lcaConfigsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(lcaConfigsTable.isActive, true),
        projectId ? eq(lcaConfigsTable.projectId, String(projectId)) : undefined,
        configId ? eq(lcaConfigsTable.id, String(configId)) : undefined,
        visibleProjectIds
          ? inArray(lcaConfigsTable.projectId, visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"])
          : undefined,
      ),
    )
    .limit(1);

  if (configRows.length === 0) {
    return res.status(404).json({ error: "No matching LCA config found" });
  }

  const { config, projectName } = configRows[0];

  const entries = await db
    .select()
    .from(lcaLedgerTable)
    .where(and(eq(lcaLedgerTable.configId, config.id), eq(lcaLedgerTable.isActive, true)))
    .orderBy(asc(lcaLedgerTable.year));

  const entryIds = entries.map((e) => e.id);
  const allPayments = entryIds.length > 0
    ? await db
        .select()
        .from(lcaPaymentEventsTable)
        .where(inArray(lcaPaymentEventsTable.ledgerEntryId, entryIds))
        .orderBy(desc(lcaPaymentEventsTable.createdAt))
    : [];

  const paymentsByEntry = new Map<string, typeof allPayments>();
  for (const p of allPayments) {
    const list = paymentsByEntry.get(p.ledgerEntryId) ?? [];
    list.push(p);
    paymentsByEntry.set(p.ledgerEntryId, list);
  }

  const enrichedEntries = entries.map((e) => {
    const escalationApplied = Math.round((Number(e.grossDue) - Number(e.baseAmount)) * 100) / 100;
    return {
      ...formatEntry({ ...e, projectName }),
      escalationApplied,
      payments: (paymentsByEntry.get(e.id) ?? []).map(formatPaymentEvent),
    };
  });

  const totals = {
    baseTotal: Math.round(entries.reduce((s, e) => s + Number(e.baseAmount), 0) * 100) / 100,
    escalationTotal: Math.round(
      entries.reduce((s, e) => s + (Number(e.grossDue) - Number(e.baseAmount)), 0) * 100,
    ) / 100,
    carryForwardTotal: Math.round(entries.reduce((s, e) => s + Number(e.carryForward), 0) * 100) / 100,
    totalDue: Math.round(entries.reduce((s, e) => s + Number(e.totalDue), 0) * 100) / 100,
    totalPaid: Math.round(entries.reduce((s, e) => s + Number(e.amountPaid), 0) * 100) / 100,
    totalBalance: Math.round(entries.reduce((s, e) => s + Number(e.balance), 0) * 100) / 100,
    yearCount: entries.length,
  };

  return res.json({
    config: formatConfig({ ...config, projectName }),
    entries: enrichedEntries,
    totals,
  });
});

// ── Payment event formatter ───────────────────────────────────────────────────

function formatPaymentEvent(row: typeof lcaPaymentEventsTable.$inferSelect) {
  return {
    id: row.id,
    ledgerEntryId: row.ledgerEntryId,
    configId: row.configId,
    projectId: row.projectId,
    year: row.year,
    amountPaid: Number(row.amountPaid),
    paymentDate: row.paymentDate,
    paymentRef: row.paymentRef ?? undefined,
    notes: row.notes ?? undefined,
    recordedById: row.recordedById ?? undefined,
    recordedByName: row.recordedByName,
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;
