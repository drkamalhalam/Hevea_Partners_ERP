import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  workAssignmentsTable,
  workAssignmentAuditTable,
  personMasterTable,
  storesTable,
} from "@workspace/db";
import { z } from "zod";

const router = Router();

function isAdminOrDev(role: string) {
  return role === "admin" || role === "developer";
}

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      displayName: usersTable.displayName,
      personMasterId: usersTable.personMasterId,
    })
    .from(usersTable)
    .where(and(eq(usersTable.clerkUserId, clerkUserId), eq(usersTable.isActive, true)))
    .limit(1);
  return user ?? null;
}

async function appendAudit(
  assignmentId: string,
  eventType: "created" | "activated" | "edited" | "completed" | "expired" | "archived" | "restored",
  performedBy: string | null,
  performedByName: string | null,
  opts: { oldStatus?: string; newStatus?: string; reason?: string; notes?: string } = {},
) {
  await db.insert(workAssignmentAuditTable).values({
    assignmentId,
    eventType,
    performedBy: performedBy ?? null,
    performedByName: performedByName ?? null,
    oldStatus: opts.oldStatus ?? null,
    newStatus: opts.newStatus ?? null,
    reason: opts.reason ?? null,
    notes: opts.notes ?? null,
  });
}

const createSchema = z.object({
  assignmentType: z.enum([
    "store_entry",
    "observer",
    "store_sale_operator",
    "general_responsibility",
    "collection_entry",
  ]),
  personMasterId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  projectCoverage: z.enum(["all_projects", "selected_projects"]).optional(),
  storeId: z.string().uuid().optional(),
  place: z.string().optional(),
  expenditurePermission: z.boolean().optional().default(false),
  title: z.string().optional(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["pending", "active"]).optional().default("active"),
});

const editSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  projectCoverage: z.string().optional().nullable(),
  storeId: z.string().uuid().optional().nullable(),
  place: z.string().optional().nullable(),
  expenditurePermission: z.boolean().optional(),
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function enrichAssignment(row: typeof workAssignmentsTable.$inferSelect) {
  // Join mobile from person_master for contact visibility
  const [person] = await db
    .select({ mobile: personMasterTable.mobile, aadhaarLast4: personMasterTable.aadhaarLast4 })
    .from(personMasterTable)
    .where(eq(personMasterTable.id, row.personMasterId))
    .limit(1);
  return { ...row, personMobile: person?.mobile ?? null, personAadhaarLast4: person?.aadhaarLast4 ?? null };
}

async function enrichAssignments(rows: (typeof workAssignmentsTable.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const personIds = [...new Set(rows.map((r) => r.personMasterId))];
  const persons = await db
    .select({ id: personMasterTable.id, mobile: personMasterTable.mobile, aadhaarLast4: personMasterTable.aadhaarLast4 })
    .from(personMasterTable)
    .where(inArray(personMasterTable.id, personIds));
  const personMap = new Map(persons.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = personMap.get(r.personMasterId);
    return { ...r, personMobile: p?.mobile ?? null, personAadhaarLast4: p?.aadhaarLast4 ?? null };
  });
}

// ── GET /work-assignments ─────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { assignmentType, status, projectId, personMasterId, storeId, activeOnly } = req.query as Record<string, string | undefined>;

  const conditions: ReturnType<typeof eq>[] = [];
  if (assignmentType) conditions.push(eq(workAssignmentsTable.assignmentType, assignmentType as any));
  if (status) conditions.push(eq(workAssignmentsTable.status, status as any));
  if (projectId) conditions.push(eq(workAssignmentsTable.projectId, projectId));
  if (personMasterId) conditions.push(eq(workAssignmentsTable.personMasterId, personMasterId));
  if (storeId) conditions.push(eq(workAssignmentsTable.storeId, storeId));
  if (activeOnly === "true") {
    conditions.push(eq(workAssignmentsTable.status, "active"));
  }

  const rows = await db
    .select()
    .from(workAssignmentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(workAssignmentsTable.createdAt));

  return res.json(await enrichAssignments(rows));
});

// ── GET /work-assignments/person/:personMasterId ──────────────────────────────

router.get("/person/:personMasterId", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { personMasterId } = req.params;
  const includeArchived = req.query.includeArchived === "true";

  const conditions: ReturnType<typeof eq>[] = [
    eq(workAssignmentsTable.personMasterId, personMasterId),
  ];
  if (!includeArchived) {
    // Exclude archived by using inArray with allowed statuses
    conditions.push(
      // status != 'archived' expressed as inArray of allowed values
      inArray(workAssignmentsTable.status, ["pending", "active", "completed", "expired"]) as any,
    );
  }

  const rows = await db
    .select()
    .from(workAssignmentsTable)
    .where(and(...conditions))
    .orderBy(desc(workAssignmentsTable.createdAt));

  return res.json(await enrichAssignments(rows));
});

// ── GET /work-assignments/my ──────────────────────────────────────────────────
// Returns active + pending assignments for the currently authenticated user,
// with auto-select context metadata for each assignment.

router.get("/my", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(403).json({ error: "Forbidden" });

  // No personMasterId linked → user has no operational assignments
  if (!actor.personMasterId) return res.json([]);

  const rows = await db
    .select()
    .from(workAssignmentsTable)
    .where(
      and(
        eq(workAssignmentsTable.personMasterId, actor.personMasterId),
        inArray(workAssignmentsTable.status, ["active", "pending"]),
      ),
    )
    .orderBy(desc(workAssignmentsTable.createdAt));

  if (rows.length === 0) return res.json([]);

  // Enrich with mobile / aadhaar
  const [person] = await db
    .select({ mobile: personMasterTable.mobile, aadhaarLast4: personMasterTable.aadhaarLast4 })
    .from(personMasterTable)
    .where(eq(personMasterTable.id, actor.personMasterId))
    .limit(1);

  // Build auto-select context per assignment.
  // canAutoSelect* = true when this is the only active assignment of its type
  // that carries a non-null value for the field (project, store, or place).
  function buildAutoSelectContext(row: typeof workAssignmentsTable.$inferSelect) {
    const sameType = rows.filter((r) => r.assignmentType === row.assignmentType);

    const projectRows = sameType.filter((r) => r.projectId != null);
    const storeRows = sameType.filter((r) => r.storeId != null);
    const placeRows = sameType.filter((r) => r.place != null);

    return {
      canAutoSelectProject: projectRows.length === 1 && row.projectId != null,
      canAutoSelectStore: storeRows.length === 1 && row.storeId != null,
      canAutoSelectPlace: placeRows.length === 1 && row.place != null,
      resolvedProjectId: row.projectId ?? null,
      resolvedProjectName: row.projectNameSnapshot ?? null,
      resolvedStoreId: row.storeId ?? null,
      resolvedStoreName: row.storeNameSnapshot ?? null,
      resolvedPlace: row.place ?? null,
    };
  }

  const result = rows.map((r) => ({
    ...r,
    personMobile: person?.mobile ?? null,
    personAadhaarLast4: person?.aadhaarLast4 ?? null,
    autoSelectContext: buildAutoSelectContext(r),
  }));

  return res.json(result);
});

// ── GET /work-assignments/:id ─────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [row] = await db
    .select()
    .from(workAssignmentsTable)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Assignment not found." });

  return res.json(await enrichAssignment(row));
});

// ── POST /work-assignments ────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  const d = parsed.data;

  // Validate person exists
  const [person] = await db
    .select({ id: personMasterTable.id, fullName: personMasterTable.fullName })
    .from(personMasterTable)
    .where(eq(personMasterTable.id, d.personMasterId))
    .limit(1);
  if (!person) return res.status(404).json({ error: "Person not found in registry." });

  // Type-specific validation
  if (d.assignmentType === "store_entry" || d.assignmentType === "store_sale_operator") {
    if (!d.storeId) {
      return res.status(400).json({ error: "storeId is required for store_entry and store_sale_operator assignments." });
    }
  }
  if (d.assignmentType === "general_responsibility" && !d.title) {
    return res.status(400).json({ error: "title is required for general_responsibility assignments." });
  }

  // Resolve snapshots
  let projectNameSnapshot: string | null = null;
  if (d.projectId) {
    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, d.projectId))
      .limit(1);
    if (!proj) return res.status(404).json({ error: "Project not found." });
    projectNameSnapshot = proj.name;
  }

  let storeNameSnapshot: string | null = null;
  if (d.storeId) {
    const [store] = await db
      .select({ storeName: storesTable.storeName })
      .from(storesTable)
      .where(eq(storesTable.id, d.storeId))
      .limit(1);
    if (!store) return res.status(404).json({ error: "Store not found." });
    storeNameSnapshot = store.storeName;
  }

  const today = new Date().toISOString().slice(0, 10);

  const [created] = await db
    .insert(workAssignmentsTable)
    .values({
      assignmentType: d.assignmentType,
      status: d.status ?? "active",
      statusChangedAt: new Date(),
      personMasterId: d.personMasterId,
      personNameSnapshot: person.fullName,
      projectId: d.projectId ?? null,
      projectNameSnapshot,
      projectCoverage: d.projectCoverage ?? null,
      storeId: d.storeId ?? null,
      storeNameSnapshot,
      place: d.place ?? null,
      expenditurePermission: d.expenditurePermission ?? false,
      title: d.title ?? null,
      description: d.description ?? null,
      startDate: d.startDate ?? today,
      endDate: d.endDate ?? null,
      assignedBy: actor.id,
      assignedByName: actor.displayName,
      notes: d.notes ?? null,
    })
    .returning();

  await appendAudit(created.id, "created", actor.id, actor.displayName, {
    newStatus: created.status,
    notes: `Assignment type: ${d.assignmentType}`,
  });

  return res.status(201).json(await enrichAssignment(created));
});

// ── PATCH /work-assignments/:id ───────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db
    .select()
    .from(workAssignmentsTable)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });
  if (existing.status === "archived") {
    return res.status(409).json({ error: "Cannot edit an archived assignment. Restore it first." });
  }

  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  const d = parsed.data;
  const updates: Partial<typeof workAssignmentsTable.$inferInsert> = {};

  if (d.projectId !== undefined) {
    updates.projectId = d.projectId;
    if (d.projectId) {
      const [proj] = await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, d.projectId))
        .limit(1);
      if (!proj) return res.status(404).json({ error: "Project not found." });
      updates.projectNameSnapshot = proj.name;
    } else {
      updates.projectNameSnapshot = null;
    }
  }

  if (d.storeId !== undefined) {
    updates.storeId = d.storeId;
    if (d.storeId) {
      const [store] = await db
        .select({ storeName: storesTable.storeName })
        .from(storesTable)
        .where(eq(storesTable.id, d.storeId))
        .limit(1);
      if (!store) return res.status(404).json({ error: "Store not found." });
      updates.storeNameSnapshot = store.storeName;
    } else {
      updates.storeNameSnapshot = null;
    }
  }

  if (d.projectCoverage !== undefined) updates.projectCoverage = d.projectCoverage;
  if (d.place !== undefined) updates.place = d.place;
  if (d.expenditurePermission !== undefined) updates.expenditurePermission = d.expenditurePermission;
  if (d.title !== undefined) updates.title = d.title;
  if (d.description !== undefined) updates.description = d.description;
  if (d.startDate !== undefined) updates.startDate = d.startDate;
  if (d.endDate !== undefined) updates.endDate = d.endDate;
  if (d.notes !== undefined) updates.notes = d.notes;
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(workAssignmentsTable)
    .set(updates)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .returning();

  await appendAudit(updated.id, "edited", actor.id, actor.displayName, {
    oldStatus: existing.status,
    newStatus: updated.status,
  });

  return res.json(await enrichAssignment(updated));
});

// ── POST /work-assignments/:id/activate ──────────────────────────────────────

router.post("/:id/activate", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db
    .select()
    .from(workAssignmentsTable)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });
  if (existing.status !== "pending") {
    return res.status(409).json({ error: `Assignment is already ${existing.status}, cannot activate.` });
  }

  const [updated] = await db
    .update(workAssignmentsTable)
    .set({ status: "active", statusChangedAt: new Date(), statusReason: req.body?.reason ?? null, updatedAt: new Date() })
    .where(eq(workAssignmentsTable.id, req.params.id))
    .returning();

  await appendAudit(updated.id, "activated", actor.id, actor.displayName, {
    oldStatus: "pending",
    newStatus: "active",
    reason: req.body?.reason,
  });

  return res.json(await enrichAssignment(updated));
});

// ── POST /work-assignments/:id/complete ──────────────────────────────────────

router.post("/:id/complete", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db
    .select()
    .from(workAssignmentsTable)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });
  if (!["active", "pending"].includes(existing.status)) {
    return res.status(409).json({ error: `Cannot complete an assignment with status: ${existing.status}.` });
  }

  const [updated] = await db
    .update(workAssignmentsTable)
    .set({ status: "completed", statusChangedAt: new Date(), statusReason: req.body?.reason ?? null, updatedAt: new Date() })
    .where(eq(workAssignmentsTable.id, req.params.id))
    .returning();

  await appendAudit(updated.id, "completed", actor.id, actor.displayName, {
    oldStatus: existing.status,
    newStatus: "completed",
    reason: req.body?.reason,
  });

  return res.json(await enrichAssignment(updated));
});

// ── POST /work-assignments/:id/archive ───────────────────────────────────────

router.post("/:id/archive", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db
    .select()
    .from(workAssignmentsTable)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });
  if (existing.status === "archived") {
    return res.status(409).json({ error: "Assignment is already archived." });
  }

  const [updated] = await db
    .update(workAssignmentsTable)
    .set({ status: "archived", statusChangedAt: new Date(), statusReason: req.body?.reason ?? null, updatedAt: new Date() })
    .where(eq(workAssignmentsTable.id, req.params.id))
    .returning();

  await appendAudit(updated.id, "archived", actor.id, actor.displayName, {
    oldStatus: existing.status,
    newStatus: "archived",
    reason: req.body?.reason,
  });

  return res.json(await enrichAssignment(updated));
});

// ── POST /work-assignments/:id/restore ───────────────────────────────────────

router.post("/:id/restore", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db
    .select()
    .from(workAssignmentsTable)
    .where(eq(workAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });
  if (existing.status !== "archived") {
    return res.status(409).json({ error: "Only archived assignments can be restored." });
  }

  const [updated] = await db
    .update(workAssignmentsTable)
    .set({ status: "active", statusChangedAt: new Date(), statusReason: req.body?.reason ?? null, updatedAt: new Date() })
    .where(eq(workAssignmentsTable.id, req.params.id))
    .returning();

  await appendAudit(updated.id, "restored", actor.id, actor.displayName, {
    oldStatus: "archived",
    newStatus: "active",
    reason: req.body?.reason,
  });

  return res.json(await enrichAssignment(updated));
});

// ── GET /work-assignments/:id/audit ──────────────────────────────────────────

router.get("/:id/audit", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const events = await db
    .select()
    .from(workAssignmentAuditTable)
    .where(eq(workAssignmentAuditTable.assignmentId, req.params.id))
    .orderBy(desc(workAssignmentAuditTable.createdAt));

  return res.json(events);
});

export default router;
