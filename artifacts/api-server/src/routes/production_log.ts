import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, asc, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  productionBatchesTable,
  productionEntriesTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole, canAccessProject } from "../middlewares/auth";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

const PRODUCTION_TYPES = ["latex", "rubber_sheet", "rubber_scrap"] as const;
const BATCH_STATUSES = ["open", "closed", "voided"] as const;

type ProductionType = (typeof PRODUCTION_TYPES)[number];
type BatchStatus = (typeof BATCH_STATUSES)[number];

// Default unit per type
function defaultUnit(type: ProductionType): string {
  return type === "latex" ? "litres" : "kg";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function canAccessAllProjects(role: string) {
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

async function syncBatchTotals(batchId: string) {
  const entries = await db
    .select()
    .from(productionEntriesTable)
    .where(
      and(
        eq(productionEntriesTable.batchId, batchId),
        eq(productionEntriesTable.isActive, true),
      ),
    );

  let latexLitres = 0;
  let sheetKg = 0;
  let scrapKg = 0;
  for (const e of entries) {
    const qty = Number(e.quantity);
    if (e.productionType === "latex") latexLitres += qty;
    else if (e.productionType === "rubber_sheet") sheetKg += qty;
    else if (e.productionType === "rubber_scrap") scrapKg += qty;
  }

  await db
    .update(productionBatchesTable)
    .set({
      entryCount: entries.length,
      totalLatexLitres: latexLitres.toString(),
      totalSheetKg: sheetKg.toString(),
      totalScrapKg: scrapKg.toString(),
      updatedAt: new Date(),
    })
    .where(eq(productionBatchesTable.id, batchId));
}

function formatBatch(
  row: typeof productionBatchesTable.$inferSelect & { projectName?: string | null },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    batchNumber: row.batchNumber,
    batchDate: row.batchDate,
    status: row.status,
    notes: row.notes ?? undefined,
    entryCount: row.entryCount,
    totalLatexLitres: Number(row.totalLatexLitres),
    totalSheetKg: Number(row.totalSheetKg),
    totalScrapKg: Number(row.totalScrapKg),
    createdByName: row.createdByName,
    closedAt: row.closedAt?.toISOString() ?? undefined,
    closedByName: row.closedByName ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatEntry(
  row: typeof productionEntriesTable.$inferSelect & { projectName?: string | null },
) {
  return {
    id: row.id,
    batchId: row.batchId,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    productionType: row.productionType,
    quantity: Number(row.quantity),
    unit: row.unit,
    productionDate: row.productionDate,
    enteredByName: row.enteredByName,
    remarks: row.remarks ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /production-log/batches ───────────────────────────────────────────────

router.get("/batches", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, date: dateFilter, status } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (projectId && !visibleProjectIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const rows = await db
    .select({
      batch: productionBatchesTable,
      projectName: projectsTable.name,
    })
    .from(productionBatchesTable)
    .leftJoin(projectsTable, eq(productionBatchesTable.projectId, projectsTable.id))
    .where(
      and(
        projectId ? eq(productionBatchesTable.projectId, projectId) : undefined,
        dateFilter ? eq(productionBatchesTable.batchDate, dateFilter) : undefined,
        status ? eq(productionBatchesTable.status, status) : undefined,
        visibleProjectIds
          ? inArray(
              productionBatchesTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .orderBy(desc(productionBatchesTable.batchDate), desc(productionBatchesTable.createdAt));

  return res.json(rows.map((r) => formatBatch({ ...r.batch, projectName: r.projectName })));
});

// ── POST /production-log/batches ──────────────────────────────────────────────

router.post(
  "/batches",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    type Body = { projectId: string; batchDate: string; notes?: string };
    const { projectId, batchDate, notes } = req.body as Body;

    if (!projectId || !batchDate) {
      return res.status(400).json({ error: "projectId and batchDate are required" });
    }
    if (!canAccessProject(req, projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Auto-generate batch number: BATCH-YYYYMMDD-NNN
    const dateStr = batchDate.replace(/-/g, "");
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(productionBatchesTable)
      .where(
        and(
          eq(productionBatchesTable.projectId, projectId),
          eq(productionBatchesTable.batchDate, batchDate),
        ),
      );
    const seq = (countRow?.count ?? 0) + 1;
    const batchNumber = `BATCH-${dateStr}-${String(seq).padStart(3, "0")}`;
    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    const [created] = await db
      .insert(productionBatchesTable)
      .values({
        projectId,
        batchNumber,
        batchDate,
        status: "open",
        notes: notes ?? null,
        createdById: actor.id,
        createdByName: actorName,
      })
      .returning();

    const [proj] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    return res.status(201).json(formatBatch({ ...created, projectName: proj?.name }));
  },
);

// ── GET /production-log/batches/:id ──────────────────────────────────────────

router.get("/batches/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const batchId = req.params.id as string;

  const [batchRow] = await db
    .select({ batch: productionBatchesTable, projectName: projectsTable.name })
    .from(productionBatchesTable)
    .leftJoin(projectsTable, eq(productionBatchesTable.projectId, projectsTable.id))
    .where(eq(productionBatchesTable.id, batchId))
    .limit(1);

  if (!batchRow) return res.status(404).json({ error: "Batch not found" });
  if (!canAccessProject(req, batchRow.batch.projectId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const entries = await db
    .select()
    .from(productionEntriesTable)
    .where(
      and(
        eq(productionEntriesTable.batchId, batchId),
        eq(productionEntriesTable.isActive, true),
      ),
    )
    .orderBy(asc(productionEntriesTable.createdAt));

  return res.json({
    ...formatBatch({ ...batchRow.batch, projectName: batchRow.projectName }),
    entries: entries.map((e) => formatEntry(e)),
  });
});

// ── POST /production-log/batches/:id/close ────────────────────────────────────

router.post(
  "/batches/:id/close",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const batchId = req.params.id as string;
    const [batch] = await db
      .select()
      .from(productionBatchesTable)
      .where(eq(productionBatchesTable.id, batchId))
      .limit(1);

    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (!canAccessProject(req, batch.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (batch.status !== "open") {
      return res.status(400).json({ error: `Batch is already ${batch.status}` });
    }

    const actorName = actor.displayName ?? actor.email ?? "Unknown";
    const [updated] = await db
      .update(productionBatchesTable)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedById: actor.id,
        closedByName: actorName,
        updatedAt: new Date(),
      })
      .where(eq(productionBatchesTable.id, batchId))
      .returning();

    return res.json(formatBatch(updated));
  },
);

// ── POST /production-log/batches/:id/reopen ───────────────────────────────────

router.post(
  "/batches/:id/reopen",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const batchId = req.params.id as string;
    const [batch] = await db
      .select()
      .from(productionBatchesTable)
      .where(eq(productionBatchesTable.id, batchId))
      .limit(1);

    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (!canAccessProject(req, batch.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (batch.status === "voided") return res.status(400).json({ error: "Voided batches cannot be reopened" });
    if (batch.status === "open") return res.status(400).json({ error: "Batch is already open" });

    const [updated] = await db
      .update(productionBatchesTable)
      .set({ status: "open", closedAt: null, closedById: null, closedByName: null, updatedAt: new Date() })
      .where(eq(productionBatchesTable.id, batchId))
      .returning();

    return res.json(formatBatch(updated));
  },
);

// ── GET /production-log/entries ───────────────────────────────────────────────

router.get("/entries", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, batchId, productionType } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (projectId && !visibleProjectIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const rows = await db
    .select({
      entry: productionEntriesTable,
      projectName: projectsTable.name,
    })
    .from(productionEntriesTable)
    .leftJoin(projectsTable, eq(productionEntriesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(productionEntriesTable.isActive, true),
        projectId ? eq(productionEntriesTable.projectId, projectId) : undefined,
        batchId ? eq(productionEntriesTable.batchId, batchId) : undefined,
        productionType ? eq(productionEntriesTable.productionType, productionType) : undefined,
        visibleProjectIds
          ? inArray(
              productionEntriesTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .orderBy(desc(productionEntriesTable.productionDate), desc(productionEntriesTable.createdAt));

  return res.json(rows.map((r) => formatEntry({ ...r.entry, projectName: r.projectName })));
});

// ── POST /production-log/entries ──────────────────────────────────────────────

router.post(
  "/entries",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    type Body = {
      batchId: string;
      projectId: string;
      productionType: string;
      quantity: number;
      unit?: string;
      productionDate: string;
      remarks?: string;
    };
    const { batchId, projectId, productionType, quantity, unit, productionDate, remarks } =
      req.body as Body;

    if (!batchId || !projectId || !productionType || !quantity || !productionDate) {
      return res.status(400).json({ error: "batchId, projectId, productionType, quantity, productionDate are required" });
    }
    if (!PRODUCTION_TYPES.includes(productionType as ProductionType)) {
      return res.status(400).json({ error: `productionType must be one of: ${PRODUCTION_TYPES.join(", ")}` });
    }
    if (!canAccessProject(req, projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Verify batch exists, belongs to project, and is open
    const [batch] = await db
      .select()
      .from(productionBatchesTable)
      .where(eq(productionBatchesTable.id, batchId))
      .limit(1);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.projectId !== projectId) {
      return res.status(400).json({ error: "Batch does not belong to the specified project" });
    }
    if (batch.status !== "open") {
      return res.status(400).json({ error: `Cannot add entries to a ${batch.status} batch` });
    }

    const effectiveUnit = unit ?? defaultUnit(productionType as ProductionType);
    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    const [created] = await db
      .insert(productionEntriesTable)
      .values({
        batchId,
        projectId,
        productionType,
        quantity: quantity.toString(),
        unit: effectiveUnit,
        productionDate,
        enteredById: actor.id,
        enteredByName: actorName,
        remarks: remarks ?? null,
        isActive: true,
      })
      .returning();

    await syncBatchTotals(batchId);

    return res.status(201).json(formatEntry(created));
  },
);

// ── PATCH /production-log/entries/:id ────────────────────────────────────────

router.patch(
  "/entries/:id",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const entryId = req.params.id as string;
    const [entry] = await db
      .select()
      .from(productionEntriesTable)
      .where(eq(productionEntriesTable.id, entryId))
      .limit(1);
    if (!entry || !entry.isActive) return res.status(404).json({ error: "Entry not found" });
    if (!canAccessProject(req, entry.projectId)) return res.status(403).json({ error: "Forbidden" });

    // Check batch is still open
    const [batch] = await db
      .select()
      .from(productionBatchesTable)
      .where(eq(productionBatchesTable.id, entry.batchId))
      .limit(1);
    if (batch && batch.status !== "open" && actor.role !== "admin") {
      return res.status(400).json({ error: "Cannot edit entries in a closed batch" });
    }

    type Body = { quantity?: number; unit?: string; remarks?: string; productionDate?: string };
    const { quantity, unit, remarks, productionDate } = req.body as Body;

    const [updated] = await db
      .update(productionEntriesTable)
      .set({
        ...(quantity !== undefined && { quantity: quantity.toString() }),
        ...(unit !== undefined && { unit }),
        ...(remarks !== undefined && { remarks }),
        ...(productionDate !== undefined && { productionDate }),
        updatedAt: new Date(),
      })
      .where(eq(productionEntriesTable.id, entryId))
      .returning();

    await syncBatchTotals(entry.batchId);
    return res.json(formatEntry(updated));
  },
);

// ── DELETE /production-log/entries/:id ───────────────────────────────────────

router.delete(
  "/entries/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const entryId = req.params.id as string;
    const [entry] = await db
      .select()
      .from(productionEntriesTable)
      .where(eq(productionEntriesTable.id, entryId))
      .limit(1);
    if (!entry || !entry.isActive) return res.status(404).json({ error: "Entry not found" });
    if (!canAccessProject(req, entry.projectId)) return res.status(403).json({ error: "Forbidden" });

    await db
      .update(productionEntriesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(productionEntriesTable.id, entryId));

    await syncBatchTotals(entry.batchId);
    return res.json({ success: true });
  },
);

// ── GET /production-log/summary ───────────────────────────────────────────────
// Project-wise aggregated production summary (across all dates or filtered).

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (projectId && !visibleProjectIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Aggregate per project
  const rows = await db
    .select({
      projectId: productionEntriesTable.projectId,
      projectName: projectsTable.name,
      productionType: productionEntriesTable.productionType,
      totalQty: sql<number>`sum(${productionEntriesTable.quantity}::numeric)`,
      unit: productionEntriesTable.unit,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(productionEntriesTable)
    .leftJoin(projectsTable, eq(productionEntriesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(productionEntriesTable.isActive, true),
        projectId ? eq(productionEntriesTable.projectId, projectId) : undefined,
        visibleProjectIds
          ? inArray(
              productionEntriesTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .groupBy(
      productionEntriesTable.projectId,
      projectsTable.name,
      productionEntriesTable.productionType,
      productionEntriesTable.unit,
    );

  // Group by project
  const projectMap: Record<
    string,
    {
      projectId: string;
      projectName: string | null;
      totalLatexLitres: number;
      totalSheetKg: number;
      totalScrapKg: number;
      totalEntries: number;
    }
  > = {};

  for (const r of rows) {
    if (!projectMap[r.projectId]) {
      projectMap[r.projectId] = {
        projectId: r.projectId,
        projectName: r.projectName ?? null,
        totalLatexLitres: 0,
        totalSheetKg: 0,
        totalScrapKg: 0,
        totalEntries: 0,
      };
    }
    const p = projectMap[r.projectId];
    if (r.productionType === "latex") p.totalLatexLitres += Number(r.totalQty);
    else if (r.productionType === "rubber_sheet") p.totalSheetKg += Number(r.totalQty);
    else if (r.productionType === "rubber_scrap") p.totalScrapKg += Number(r.totalQty);
    p.totalEntries += r.entryCount;
  }

  // Batch counts
  const batchRows = await db
    .select({
      projectId: productionBatchesTable.projectId,
      batchCount: sql<number>`count(*)::int`,
      openBatchCount: sql<number>`count(*) filter (where ${productionBatchesTable.status} = 'open')::int`,
    })
    .from(productionBatchesTable)
    .where(
      and(
        projectId ? eq(productionBatchesTable.projectId, projectId) : undefined,
        visibleProjectIds
          ? inArray(
              productionBatchesTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .groupBy(productionBatchesTable.projectId);

  const batchMap: Record<string, { batchCount: number; openBatchCount: number }> = {};
  for (const b of batchRows) {
    batchMap[b.projectId] = { batchCount: b.batchCount, openBatchCount: b.openBatchCount };
  }

  const projects = Object.values(projectMap).map((p) => ({
    ...p,
    batchCount: batchMap[p.projectId]?.batchCount ?? 0,
    openBatchCount: batchMap[p.projectId]?.openBatchCount ?? 0,
  }));

  // Platform totals
  const totalLatexLitres = projects.reduce((s, p) => s + p.totalLatexLitres, 0);
  const totalSheetKg = projects.reduce((s, p) => s + p.totalSheetKg, 0);
  const totalScrapKg = projects.reduce((s, p) => s + p.totalScrapKg, 0);
  const totalBatches = batchRows.reduce((s, b) => s + b.batchCount, 0);

  return res.json({
    totalLatexLitres,
    totalSheetKg,
    totalScrapKg,
    totalBatches,
    projects,
  });
});

export default router;
