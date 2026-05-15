import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, gte, lte } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  expendituresTable,
  expenditureVerificationEventsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { routeAndCreateVerificationRequest } from "./expenditure_verification";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

function canViewExpenditureAnalytics(role: string): boolean {
  return (
    role === "admin" ||
    role === "developer" ||
    role === "landowner" ||
    role === "investor"
  );
}

function canCreateExpenditure(role: string): boolean {
  return (
    role === "admin" ||
    role === "developer" ||
    role === "employee" ||
    role === "operational_staff"
  );
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
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

async function fetchExpenditure(id: string) {
  const [row] = await db
    .select({
      exp: expendituresTable,
      projectName: projectsTable.name,
    })
    .from(expendituresTable)
    .leftJoin(projectsTable, eq(expendituresTable.projectId, projectsTable.id))
    .where(and(eq(expendituresTable.id, id), eq(expendituresTable.isActive, true)))
    .limit(1);
  if (!row) return null;
  return { ...row.exp, projectName: row.projectName ?? null };
}

function formatEntry(
  exp: typeof expendituresTable.$inferSelect,
  projectName: string | null,
) {
  return {
    id: exp.id,
    projectId: exp.projectId,
    projectName,
    paidById: exp.paidById ?? null,
    paidByName: exp.paidByName ?? null,
    category: exp.category,
    amount: exp.amount,
    expenditureDate: exp.expenditureDate,
    description: exp.description,
    invoiceObjectPath: exp.invoiceObjectPath ?? null,
    verificationStatus: exp.verificationStatus,
    verifiedAt: exp.verifiedAt ? exp.verifiedAt.toISOString() : null,
    verifiedByName: exp.verifiedByName ?? null,
    verifierNotes: exp.verifierNotes ?? null,
    lifecyclePhaseSnapshot: exp.lifecyclePhaseSnapshot,
    recordedByName: exp.recordedByName ?? null,
    notes: exp.notes ?? null,
    createdAt: exp.createdAt.toISOString(),
  };
}

// ── GET /expenditures ─────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  // Investors see summary analytics only — individual records are not accessible
  if (actor.role === "investor") {
    return res.status(403).json({
      error: "Individual expenditure records are restricted to operational roles. Use the analytics summary endpoint instead.",
    });
  }

  // Employees and operational staff are restricted to entries they recorded themselves
  const selfOnlyRoles =
    actor.role === "employee" || actor.role === "operational_staff";

  // Determine visible project IDs
  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({ expenditures: [] });
    }
  }

  // Optional filters from query params
  const filterProjectId =
    typeof req.query.projectId === "string" ? req.query.projectId : null;
  const filterCategory =
    typeof req.query.category === "string" ? req.query.category : null;
  const filterStatus =
    typeof req.query.status === "string" ? req.query.status : null;
  const search =
    typeof req.query.search === "string" && req.query.search.trim()
      ? req.query.search.trim()
      : null;
  const dateFrom =
    typeof req.query.dateFrom === "string" ? req.query.dateFrom : null;
  const dateTo =
    typeof req.query.dateTo === "string" ? req.query.dateTo : null;

  // Narrow project scope if specific project requested
  if (filterProjectId) {
    if (
      visibleProjectIds !== null &&
      !visibleProjectIds.includes(filterProjectId)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    visibleProjectIds = [filterProjectId];
  }

  // Build where conditions
  const conditions = [eq(expendituresTable.isActive, true)];

  if (visibleProjectIds) {
    conditions.push(inArray(expendituresTable.projectId, visibleProjectIds));
  }

  if (filterCategory) {
    conditions.push(
      eq(
        expendituresTable.category,
        filterCategory as typeof expendituresTable.category._.data,
      ),
    );
  }

  if (filterStatus) {
    conditions.push(
      eq(
        expendituresTable.verificationStatus,
        filterStatus as typeof expendituresTable.verificationStatus._.data,
      ),
    );
  }

  if (dateFrom) {
    // expenditureDate is stored as YYYY-MM-DD text — lexicographic comparison works
    conditions.push(gte(expendituresTable.expenditureDate, dateFrom));
  }

  if (dateTo) {
    conditions.push(lte(expendituresTable.expenditureDate, dateTo));
  }

  // Restrict employees and operational staff to their own submitted records
  if (selfOnlyRoles) {
    conditions.push(eq(expendituresTable.recordedById, actor.id));
  }

  const rows = await db
    .select({
      exp: expendituresTable,
      projectName: projectsTable.name,
    })
    .from(expendituresTable)
    .leftJoin(projectsTable, eq(expendituresTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(expendituresTable.expenditureDate), desc(expendituresTable.createdAt));

  // Apply search filter in memory (description or paidByName)
  let results = rows.map((r) => formatEntry(r.exp, r.projectName ?? null));

  if (search) {
    const lc = search.toLowerCase();
    results = results.filter(
      (e) =>
        e.description.toLowerCase().includes(lc) ||
        (e.paidByName ?? "").toLowerCase().includes(lc) ||
        (e.projectName ?? "").toLowerCase().includes(lc) ||
        (e.notes ?? "").toLowerCase().includes(lc),
    );
  }

  return res.json({ expenditures: results });
});

// ── POST /expenditures ────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  if (!canCreateExpenditure(actor.role)) {
    return res.status(403).json({ error: "Your role cannot record expenditures." });
  }

  const { projectId, category, amount, expenditureDate, description, notes, paidByName } =
    req.body as {
      projectId?: string;
      category?: string;
      amount?: unknown;
      expenditureDate?: string;
      description?: string;
      notes?: string;
      paidByName?: string;
    };

  if (!projectId || !category || !expenditureDate || !description) {
    return res
      .status(400)
      .json({ error: "projectId, category, expenditureDate, and description are required." });
  }

  const parsedAmount = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  // Verify project access
  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Fetch project for lifecycle snapshot
  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.isActive, true)))
    .limit(1);

  if (!project) return res.status(400).json({ error: "Project not found." });

  const [inserted] = await db
    .insert(expendituresTable)
    .values({
      projectId,
      category: category as typeof expendituresTable.category._.data,
      amount: parsedAmount,
      expenditureDate,
      description,
      notes: notes ?? null,
      paidByName: paidByName ?? actor.displayName ?? null,
      paidById: actor.id,
      lifecyclePhaseSnapshot: project.lifecycleStatus,
      recordedById: actor.id,
      recordedByName: actor.displayName ?? null,
    })
    .returning();

  return res.status(201).json(formatEntry(inserted, project.name));
});

// ── GET /expenditures/summary ─────────────────────────────────────────────────
// Must be registered BEFORE /:id to avoid route shadowing.

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  if (!canViewExpenditureAnalytics(actor.role)) {
    return res
      .status(403)
      .json({ error: "Expenditure analytics are not accessible to your role." });
  }

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({
        projects: [],
        totals: { totalAmount: 0, approvedAmount: 0, pendingAmount: 0, count: 0 },
      });
    }
  }

  const filterProjectId =
    typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (filterProjectId) {
    if (visibleProjectIds !== null && !visibleProjectIds.includes(filterProjectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    visibleProjectIds = [filterProjectId];
  }

  // Fetch all active projects in scope
  const projectRows = visibleProjectIds
    ? await db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(
          and(
            inArray(projectsTable.id, visibleProjectIds),
            eq(projectsTable.isActive, true),
          ),
        )
    : await db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.isActive, true));

  const projectIdList = projectRows.map((p) => p.id);
  const projectNameMap = new Map(projectRows.map((p) => [p.id, p.name]));

  if (projectIdList.length === 0) {
    return res.json({
      projects: [],
      totals: { totalAmount: 0, approvedAmount: 0, pendingAmount: 0, count: 0 },
    });
  }

  // Fetch all expenditures for visible projects
  const allExps = await db
    .select()
    .from(expendituresTable)
    .where(
      and(
        inArray(expendituresTable.projectId, projectIdList),
        eq(expendituresTable.isActive, true),
      ),
    );

  // Build per-project summary
  const byProject = new Map<
    string,
    {
      totalAmount: number;
      approvedAmount: number;
      pendingAmount: number;
      count: number;
      byCategory: Map<string, { amount: number; count: number }>;
    }
  >();

  for (const exp of allExps) {
    if (!byProject.has(exp.projectId)) {
      byProject.set(exp.projectId, {
        totalAmount: 0,
        approvedAmount: 0,
        pendingAmount: 0,
        count: 0,
        byCategory: new Map(),
      });
    }
    const proj = byProject.get(exp.projectId)!;
    proj.totalAmount += exp.amount;
    proj.count += 1;
    if (exp.verificationStatus === "approved") proj.approvedAmount += exp.amount;
    if (exp.verificationStatus === "pending_review") proj.pendingAmount += exp.amount;

    const cat = byCategory(proj.byCategory, exp.category);
    cat.amount += exp.amount;
    cat.count += 1;
  }

  function byCategory(
    map: Map<string, { amount: number; count: number }>,
    category: string,
  ) {
    if (!map.has(category)) map.set(category, { amount: 0, count: 0 });
    return map.get(category)!;
  }

  const projects = projectRows.map((p) => {
    const s = byProject.get(p.id) ?? {
      totalAmount: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      count: 0,
      byCategory: new Map(),
    };
    return {
      projectId: p.id,
      projectName: p.name,
      totalAmount: s.totalAmount,
      approvedAmount: s.approvedAmount,
      pendingAmount: s.pendingAmount,
      count: s.count,
      categoryBreakdown: Array.from(s.byCategory.entries()).map(
        ([category, v]) => ({ category, amount: v.amount, count: v.count }),
      ),
    };
  });

  const totals = allExps.reduce(
    (acc, e) => {
      acc.totalAmount += e.amount;
      acc.count += 1;
      if (e.verificationStatus === "approved") acc.approvedAmount += e.amount;
      if (e.verificationStatus === "pending_review") acc.pendingAmount += e.amount;
      return acc;
    },
    { totalAmount: 0, approvedAmount: 0, pendingAmount: 0, count: 0 },
  );

  return res.json({ projects, totals });
});

// ── GET /expenditures/:id ─────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const entry = await fetchExpenditure(String(req.params.id));
  if (!entry) return res.status(404).json({ error: "Not found" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(entry.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  return res.json(formatEntry(entry, entry.projectName));
});

// ── PATCH /expenditures/:id ───────────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const entry = await fetchExpenditure(String(req.params.id));
  if (!entry) return res.status(404).json({ error: "Not found" });

  // Admin/developer can edit freely; others can only edit their own draft entries
  const isAdminOrDev = canAccessAllProjects(actor.role);
  if (!isAdminOrDev) {
    if (entry.recordedById !== actor.id) {
      return res.status(403).json({ error: "You can only edit your own expenditure entries." });
    }
    if (entry.verificationStatus !== "draft") {
      return res
        .status(403)
        .json({ error: "Only draft entries can be edited." });
    }
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(entry.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const { category, amount, expenditureDate, description, notes, paidByName } =
    req.body as {
      category?: string;
      amount?: unknown;
      expenditureDate?: string;
      description?: string;
      notes?: string;
      paidByName?: string;
    };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (category) updates.category = category;
  if (description) updates.description = description;
  if (expenditureDate) updates.expenditureDate = expenditureDate;
  if (notes !== undefined) updates.notes = notes;
  if (paidByName !== undefined) updates.paidByName = paidByName;
  if (amount !== undefined) {
    const parsed = typeof amount === "number" ? amount : parseFloat(String(amount));
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ error: "amount must be a positive number." });
    }
    updates.amount = parsed;
  }

  const [updated] = await db
    .update(expendituresTable)
    .set(updates)
    .where(eq(expendituresTable.id, String(req.params.id)))
    .returning();

  // Write immutable audit event for the edit (fire-and-forget)
  const changedFields = Object.keys(updates).filter((k) => k !== "updatedAt");
  if (changedFields.length > 0) {
    db.insert(expenditureVerificationEventsTable)
      .values({
        expenditureId: String(req.params.id),
        eventType: "edited",
        actorId: actor.id,
        actorName: actor.displayName ?? "Unknown",
        actorRole: actor.role,
        notes: `Fields updated: ${changedFields.join(", ")}`,
        metadata: { changedFields },
      })
      .catch((err: Error) =>
        req.log.warn({ err }, "Failed to write edit audit event"),
      );
  }

  return res.json(formatEntry(updated, entry.projectName));
});

// ── DELETE /expenditures/:id ──────────────────────────────────────────────────

router.delete(
  "/:id",
  requireRole("admin"),
  async (req, res) => {
    const entry = await fetchExpenditure(String(req.params.id));
    if (!entry) return res.status(404).json({ error: "Not found" });

    await db
      .update(expendituresTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(expendituresTable.id, String(req.params.id)));

    return res.status(204).send();
  },
);

// ── POST /expenditures/:id/submit ─────────────────────────────────────────────

router.post("/:id/submit", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const entry = await fetchExpenditure(String(req.params.id));
  if (!entry) return res.status(404).json({ error: "Not found" });

  // Must be creator or admin/dev
  const isAdminOrDev = canAccessAllProjects(actor.role);
  if (!isAdminOrDev && entry.recordedById !== actor.id) {
    return res.status(403).json({ error: "You can only submit your own expenditure entries." });
  }

  const isResubmission = entry.verificationStatus === "rejected";

  if (!["draft", "rejected"].includes(entry.verificationStatus)) {
    return res
      .status(400)
      .json({ error: `Cannot submit: current status is '${entry.verificationStatus}'.` });
  }

  const [updated] = await db
    .update(expendituresTable)
    .set({ verificationStatus: "pending_review", updatedAt: new Date() })
    .where(eq(expendituresTable.id, String(req.params.id)))
    .returning();

  // Create / reset the verification request and write routing event
  try {
    await routeAndCreateVerificationRequest({
      expenditureId: updated.id,
      projectId: updated.projectId,
      category: updated.category,
      actorId: actor.id,
      actorRole: actor.role,
      actorName: actor.displayName ?? "Unknown",
      eventType: isResubmission ? "resubmitted" : "routing_assigned",
    });

    // Write "submitted" event
    await db.insert(expenditureVerificationEventsTable).values({
      expenditureId: updated.id,
      eventType: "submitted",
      actorId: actor.id,
      actorName: actor.displayName ?? "Unknown",
      actorRole: actor.role,
      notes: isResubmission
        ? "Re-submitted for verification after rejection"
        : "Expenditure submitted for verification",
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to create verification request — expenditure submitted without routing");
  }

  return res.json(formatEntry(updated, entry.projectName));
});

// ── POST /expenditures/:id/approve ────────────────────────────────────────────

router.post(
  "/:id/approve",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const entry = await fetchExpenditure(String(req.params.id));
    if (!entry) return res.status(404).json({ error: "Not found" });

    if (entry.verificationStatus !== "pending_review") {
      return res
        .status(400)
        .json({ error: `Cannot approve: current status is '${entry.verificationStatus}'.` });
    }

    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

    const [updated] = await db
      .update(expendituresTable)
      .set({
        verificationStatus: "approved",
        verifiedAt: new Date(),
        verifiedById: actor.id,
        verifiedByName: actor.displayName ?? null,
        verifierNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(expendituresTable.id, String(req.params.id)))
      .returning();

    // Immutable approval audit event
    db.insert(expenditureVerificationEventsTable)
      .values({
        expenditureId: String(req.params.id),
        eventType: "approved",
        actorId: actor.id,
        actorName: actor.displayName ?? "Unknown",
        actorRole: actor.role,
        notes: notes ?? "Approved",
      })
      .catch((err: Error) =>
        req.log.warn({ err }, "Failed to write approval audit event"),
      );

    return res.json(formatEntry(updated, entry.projectName));
  },
);

// ── POST /expenditures/:id/reject ─────────────────────────────────────────────

router.post(
  "/:id/reject",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const entry = await fetchExpenditure(String(req.params.id));
    if (!entry) return res.status(404).json({ error: "Not found" });

    if (entry.verificationStatus !== "pending_review") {
      return res
        .status(400)
        .json({ error: `Cannot reject: current status is '${entry.verificationStatus}'.` });
    }

    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    if (!notes) {
      return res.status(400).json({ error: "Rejection notes are required." });
    }

    const [updated] = await db
      .update(expendituresTable)
      .set({
        verificationStatus: "rejected",
        verifiedAt: new Date(),
        verifiedById: actor.id,
        verifiedByName: actor.displayName ?? null,
        verifierNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(expendituresTable.id, String(req.params.id)))
      .returning();

    // Immutable rejection audit event
    db.insert(expenditureVerificationEventsTable)
      .values({
        expenditureId: String(req.params.id),
        eventType: "rejected",
        actorId: actor.id,
        actorName: actor.displayName ?? "Unknown",
        actorRole: actor.role,
        notes,
      })
      .catch((err: Error) =>
        req.log.warn({ err }, "Failed to write rejection audit event"),
      );

    return res.json(formatEntry(updated, entry.projectName));
  },
);

export default router;
