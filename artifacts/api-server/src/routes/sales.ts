import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  buyersTable,
  salesTransactionsTable,
  salesLineItemsTable,
  salesDeductionsTable,
  inventoryStockMovementsTable,
  productionBatchesTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole, canAccessProject } from "../middlewares/auth";
import {
  writeSaleAudit,
  assessLineItemRisk,
  describeLineItemChange,
  type FieldChange,
} from "../lib/saleAuditHelper";
import { logOperationalAccess } from "../lib/accessLog";

const router = Router();

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

/**
 * Roles that may see revenue totals per transaction.
 * employee and operational_staff handle operational work but must not see
 * financial aggregates. landowner/investor see their revenue share through
 * the dedicated landowner-account module instead.
 */
function canSeeRevenueTotals(role: string): boolean {
  return role === "admin" || role === "developer";
}

/**
 * Roles that may see per-unit pricing (saleRate / grossAmount per line item).
 * employees enter and manage sale line items so they need these fields.
 * operational_staff, landowners, investors do not.
 */
function canSeePricing(role: string): boolean {
  return role === "admin" || role === "developer" || role === "employee";
}

function formatTransaction(
  row: typeof salesTransactionsTable.$inferSelect & {
    projectName?: string | null;
    buyerPhone?: string | null;
  },
  role?: string,
) {
  const showRevenue = !role || canSeeRevenueTotals(role);
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    buyerId: row.buyerId ?? undefined,
    buyerName: row.buyerName,
    buyerPhone: row.buyerPhone ?? undefined,
    saleNumber: row.saleNumber,
    saleDate: row.saleDate,
    status: row.status,
    notes: row.notes ?? undefined,
    documentRef: row.documentRef ?? undefined,
    totalGrossRevenue: showRevenue ? Number(row.totalGrossRevenue) : undefined,
    totalDeductions: showRevenue ? Number(row.totalDeductions) : undefined,
    totalNetRevenue: showRevenue ? Number(row.totalNetRevenue) : undefined,
    distributionId: row.distributionId ?? undefined,
    confirmedAt: row.confirmedAt?.toISOString() ?? undefined,
    confirmedByName: row.confirmedByName ?? undefined,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatLineItem(row: typeof salesLineItemsTable.$inferSelect, role?: string) {
  const showPricing = !role || canSeePricing(role);
  return {
    id: row.id,
    transactionId: row.transactionId,
    batchId: row.batchId ?? undefined,
    batchNumber: row.batchNumber ?? undefined,
    productType: row.productType,
    quantity: Number(row.quantity),
    unit: row.unit,
    saleRate: showPricing && row.saleRate !== null ? Number(row.saleRate) : undefined,
    grossAmount: showPricing && row.grossAmount !== null ? Number(row.grossAmount) : undefined,
    remarks: row.remarks ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatDeduction(row: typeof salesDeductionsTable.$inferSelect) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    deductionType: row.deductionType,
    description: row.description ?? undefined,
    amount: Number(row.amount),
    createdAt: row.createdAt.toISOString(),
  };
}

async function recomputeTotals(transactionId: string) {
  const items = await db
    .select()
    .from(salesLineItemsTable)
    .where(eq(salesLineItemsTable.transactionId, transactionId));
  const deductions = await db
    .select()
    .from(salesDeductionsTable)
    .where(eq(salesDeductionsTable.transactionId, transactionId));

  const grossRevenue = items.reduce((s, i) => s + Number(i.grossAmount ?? 0), 0);
  const totalDeductions = deductions.reduce((s, d) => s + Number(d.amount), 0);
  const netRevenue = grossRevenue - totalDeductions;

  await db
    .update(salesTransactionsTable)
    .set({
      totalGrossRevenue: grossRevenue.toString(),
      totalDeductions: totalDeductions.toString(),
      totalNetRevenue: netRevenue.toString(),
      updatedAt: new Date(),
    })
    .where(eq(salesTransactionsTable.id, transactionId));
}

// ── GET /sales ─────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, status, buyerId, from, to } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (projectId && !visibleProjectIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const rows = await db
    .select({
      tx: salesTransactionsTable,
      projectName: projectsTable.name,
      buyerPhone: buyersTable.phone,
    })
    .from(salesTransactionsTable)
    .leftJoin(projectsTable, eq(salesTransactionsTable.projectId, projectsTable.id))
    .leftJoin(buyersTable, eq(salesTransactionsTable.buyerId, buyersTable.id))
    .where(
      and(
        eq(salesTransactionsTable.isActive, true),
        projectId ? eq(salesTransactionsTable.projectId, projectId) : undefined,
        status ? eq(salesTransactionsTable.status, status) : undefined,
        buyerId ? eq(salesTransactionsTable.buyerId, buyerId) : undefined,
        from ? sql`${salesTransactionsTable.saleDate} >= ${from}` : undefined,
        to ? sql`${salesTransactionsTable.saleDate} <= ${to}` : undefined,
        visibleProjectIds
          ? inArray(
              salesTransactionsTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .orderBy(desc(salesTransactionsTable.saleDate), desc(salesTransactionsTable.createdAt));

  logOperationalAccess({
    req,
    resourceType: "sale_transaction",
    action: "list",
    projectId: projectId ?? null,
  });

  return res.json(
    rows.map((r) =>
      formatTransaction({ ...r.tx, projectName: r.projectName, buyerPhone: r.buyerPhone }, actor.role),
    ),
  );
});

// ── GET /sales/summary ─────────────────────────────────────────────────────────

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

  const rows = await db
    .select({
      projectId: salesTransactionsTable.projectId,
      projectName: projectsTable.name,
      totalSales: sql<number>`count(*)::int`,
      confirmedSales: sql<number>`count(*) filter (where ${salesTransactionsTable.status} = 'confirmed')::int`,
      totalGross: sql<number>`COALESCE(SUM(${salesTransactionsTable.totalGrossRevenue}::numeric) filter (where ${salesTransactionsTable.status} = 'confirmed'), 0)`,
      totalDeductions: sql<number>`COALESCE(SUM(${salesTransactionsTable.totalDeductions}::numeric) filter (where ${salesTransactionsTable.status} = 'confirmed'), 0)`,
      totalNet: sql<number>`COALESCE(SUM(${salesTransactionsTable.totalNetRevenue}::numeric) filter (where ${salesTransactionsTable.status} = 'confirmed'), 0)`,
    })
    .from(salesTransactionsTable)
    .leftJoin(projectsTable, eq(salesTransactionsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(salesTransactionsTable.isActive, true),
        projectId ? eq(salesTransactionsTable.projectId, projectId) : undefined,
        visibleProjectIds
          ? inArray(
              salesTransactionsTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .groupBy(salesTransactionsTable.projectId, projectsTable.name);

  const totalGrossAll = rows.reduce((s, r) => s + Number(r.totalGross), 0);
  const totalNetAll = rows.reduce((s, r) => s + Number(r.totalNet), 0);
  const totalSalesAll = rows.reduce((s, r) => s + r.totalSales, 0);

  const showRevenue = canSeeRevenueTotals(actor.role);

  logOperationalAccess({
    req,
    resourceType: "sale_summary",
    action: "summary",
    projectId: projectId ?? null,
  });

  return res.json({
    totalGrossRevenue: showRevenue ? totalGrossAll : undefined,
    totalNetRevenue: showRevenue ? totalNetAll : undefined,
    totalSalesCount: totalSalesAll,
    projects: rows.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName ?? undefined,
      totalSales: r.totalSales,
      confirmedSales: r.confirmedSales,
      totalGrossRevenue: showRevenue ? Number(r.totalGross) : undefined,
      totalDeductions: showRevenue ? Number(r.totalDeductions) : undefined,
      totalNetRevenue: showRevenue ? Number(r.totalNet) : undefined,
    })),
  });
});

// ── POST /sales ────────────────────────────────────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    type LineItemInput = {
      batchId?: string;
      productType: string;
      quantity: number;
      unit: string;
      saleRate?: number;
      remarks?: string;
    };
    type DeductionInput = {
      deductionType?: string;
      description?: string;
      amount: number;
    };
    type Body = {
      projectId: string;
      buyerId?: string;
      buyerName: string;
      saleDate: string;
      notes?: string;
      documentRef?: string;
      lineItems: LineItemInput[];
      deductions?: DeductionInput[];
    };

    const { projectId, buyerId, buyerName, saleDate, notes, documentRef, lineItems, deductions } =
      req.body as Body;

    if (!projectId || !buyerName?.trim() || !saleDate || !lineItems?.length) {
      return res
        .status(400)
        .json({ error: "projectId, buyerName, saleDate, and at least one lineItem are required" });
    }
    if (!canAccessProject(req, projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Auto-generate sale number
    const dateStr = saleDate.replace(/-/g, "");
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesTransactionsTable)
      .where(
        and(
          eq(salesTransactionsTable.projectId, projectId),
          eq(salesTransactionsTable.saleDate, saleDate),
        ),
      );
    const seq = (countRow?.count ?? 0) + 1;
    const saleNumber = `SALE-${dateStr}-${String(seq).padStart(3, "0")}`;
    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    // Verify buyer if provided
    if (buyerId) {
      const [buyer] = await db
        .select()
        .from(buyersTable)
        .where(eq(buyersTable.id, buyerId))
        .limit(1);
      if (!buyer) return res.status(404).json({ error: "Buyer not found" });
    }

    // Create transaction
    const [tx] = await db
      .insert(salesTransactionsTable)
      .values({
        projectId,
        buyerId: buyerId ?? null,
        buyerName: buyerName.trim(),
        saleNumber,
        saleDate,
        status: "draft",
        notes: notes ?? null,
        documentRef: documentRef ?? null,
        createdById: actor.id,
        createdByName: actorName,
      })
      .returning();

    // Insert line items
    for (const item of lineItems) {
      if (!item.productType || !item.quantity || !item.unit) continue;

      let batchNumber: string | null = null;
      if (item.batchId) {
        const [batch] = await db
          .select({ batchNumber: productionBatchesTable.batchNumber })
          .from(productionBatchesTable)
          .where(eq(productionBatchesTable.id, item.batchId))
          .limit(1);
        batchNumber = batch?.batchNumber ?? null;
      }

      const grossAmount =
        item.saleRate !== undefined ? Number(item.quantity) * item.saleRate : null;

      await db.insert(salesLineItemsTable).values({
        transactionId: tx.id,
        batchId: item.batchId ?? null,
        batchNumber,
        productType: item.productType,
        quantity: item.quantity.toString(),
        unit: item.unit,
        saleRate: item.saleRate !== undefined ? item.saleRate.toString() : null,
        grossAmount: grossAmount !== null ? grossAmount.toString() : null,
        remarks: item.remarks ?? null,
      });
    }

    // Insert deductions
    if (deductions?.length) {
      for (const d of deductions) {
        if (!d.amount) continue;
        await db.insert(salesDeductionsTable).values({
          transactionId: tx.id,
          deductionType: d.deductionType ?? "other",
          description: d.description ?? null,
          amount: d.amount.toString(),
        });
      }
    }

    await recomputeTotals(tx.id);

    const [updated] = await db
      .select({ tx: salesTransactionsTable, projectName: projectsTable.name })
      .from(salesTransactionsTable)
      .leftJoin(projectsTable, eq(salesTransactionsTable.projectId, projectsTable.id))
      .where(eq(salesTransactionsTable.id, tx.id))
      .limit(1);

    writeSaleAudit({
      transactionId: tx.id,
      saleNumber: saleNumber,
      projectId: projectId,
      eventType: "created",
      entityType: "transaction",
      description: `Sale created: ${saleNumber} — ${buyerName.trim()}, ${lineItems.length} line item(s)`,
      actorId: actor.id,
      actorName: actor.displayName ?? actor.email ?? "Unknown",
      actorRole: actor.role,
    });

    return res
      .status(201)
      .json(formatTransaction({ ...updated.tx, projectName: updated.projectName }, actor.role));
  },
);

// ── GET /sales/:id ─────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const txId = req.params.id as string;
  const [row] = await db
    .select({
      tx: salesTransactionsTable,
      projectName: projectsTable.name,
      buyerPhone: buyersTable.phone,
    })
    .from(salesTransactionsTable)
    .leftJoin(projectsTable, eq(salesTransactionsTable.projectId, projectsTable.id))
    .leftJoin(buyersTable, eq(salesTransactionsTable.buyerId, buyersTable.id))
    .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Sale not found" });
  if (!canAccessProject(req, row.tx.projectId)) return res.status(403).json({ error: "Forbidden" });

  const lineItems = await db
    .select()
    .from(salesLineItemsTable)
    .where(eq(salesLineItemsTable.transactionId, txId));

  const deductions = await db
    .select()
    .from(salesDeductionsTable)
    .where(eq(salesDeductionsTable.transactionId, txId));

  logOperationalAccess({
    req,
    resourceType: "sale_detail",
    action: "view",
    projectId: row.tx.projectId,
    resourceId: txId,
    resourceRef: row.tx.saleNumber,
  });

  return res.json({
    ...formatTransaction({ ...row.tx, projectName: row.projectName, buyerPhone: row.buyerPhone }, actor.role),
    lineItems: lineItems.map((li) => formatLineItem(li, actor.role)),
    deductions: deductions.map(formatDeduction),
  });
});

// ── PATCH /sales/:id ───────────────────────────────────────────────────────────

router.patch(
  "/:id",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const txId = req.params.id as string;
    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status === "confirmed" && actor.role !== "admin") {
      return res.status(400).json({ error: "Cannot edit a confirmed sale" });
    }
    if (tx.status === "cancelled") {
      return res.status(400).json({ error: "Cannot edit a cancelled sale" });
    }

    type Body = { buyerId?: string; buyerName?: string; saleDate?: string; notes?: string; documentRef?: string };
    const { buyerId, buyerName, saleDate, notes, documentRef } = req.body as Body;

    const [updated] = await db
      .update(salesTransactionsTable)
      .set({
        ...(buyerId !== undefined && { buyerId: buyerId || null }),
        ...(buyerName !== undefined && { buyerName: buyerName.trim() }),
        ...(saleDate !== undefined && { saleDate }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(documentRef !== undefined && { documentRef: documentRef || null }),
        updatedAt: new Date(),
      })
      .where(eq(salesTransactionsTable.id, txId))
      .returning();

    const txChanges: FieldChange[] = [];
    if (buyerName !== undefined && buyerName !== tx.buyerName) {
      txChanges.push({ field: "buyerName", oldValue: tx.buyerName, newValue: buyerName });
    }
    if (saleDate !== undefined && saleDate !== tx.saleDate) {
      txChanges.push({ field: "saleDate", oldValue: tx.saleDate, newValue: saleDate });
    }
    const actorNameForAudit = actor.displayName ?? actor.email ?? "Unknown";
    writeSaleAudit({
      transactionId: txId,
      saleNumber: tx.saleNumber,
      projectId: tx.projectId,
      eventType: "updated",
      entityType: "transaction",
      description: txChanges.length > 0
        ? `Sale updated: ${txChanges.map((c) => c.field).join(", ")} changed`
        : "Sale metadata updated",
      fieldChanges: txChanges,
      riskLevel: tx.status === "confirmed" ? "flag" : "normal",
      riskReason: tx.status === "confirmed" ? "Edit on confirmed sale" : undefined,
      actorId: actor.id,
      actorName: actorNameForAudit,
      actorRole: actor.role,
    });

    return res.json(formatTransaction(updated, actor.role));
  },
);

// ── POST /sales/:id/confirm ────────────────────────────────────────────────────
// Confirms a sale and auto-creates sale_out inventory movements.

router.post(
  "/:id/confirm",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const txId = req.params.id as string;
    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status === "confirmed") return res.status(400).json({ error: "Sale is already confirmed" });
    if (tx.status === "cancelled") return res.status(400).json({ error: "Cannot confirm a cancelled sale" });

    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    const [updated] = await db
      .update(salesTransactionsTable)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedById: actor.id,
        confirmedByName: actorName,
        updatedAt: new Date(),
      })
      .where(eq(salesTransactionsTable.id, txId))
      .returning();

    // Auto-create sale_out inventory movements for each line item
    const lineItems = await db
      .select()
      .from(salesLineItemsTable)
      .where(eq(salesLineItemsTable.transactionId, txId));

    for (const item of lineItems) {
      await db.insert(inventoryStockMovementsTable).values({
        projectId: updated.projectId,
        stockType: item.productType,
        movementType: "sale_out",
        direction: "out",
        quantity: item.quantity,
        unit: item.unit,
        movementDate: updated.saleDate,
        batchId: item.batchId ?? null,
        referenceId: updated.saleNumber,
        referenceType: "sale",
        notes: `Sale to ${updated.buyerName} — ${updated.saleNumber}`,
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedById: actor.id,
        confirmedByName: actorName,
        createdById: actor.id,
        createdByName: actorName,
        isActive: true,
      });
    }

    writeSaleAudit({
      transactionId: txId,
      saleNumber: updated.saleNumber,
      projectId: updated.projectId,
      eventType: "confirmed",
      entityType: "transaction",
      description: `Sale confirmed by ${actorName}`,
      actorId: actor.id,
      actorName: actorName,
      actorRole: actor.role,
    });

    return res.json(formatTransaction(updated, actor.role));
  },
);

// ── POST /sales/:id/cancel ─────────────────────────────────────────────────────

router.post(
  "/:id/cancel",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const txId = req.params.id as string;
    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status === "cancelled") return res.status(400).json({ error: "Already cancelled" });

    const [updated] = await db
      .update(salesTransactionsTable)
      .set({ status: "cancelled", isActive: false, updatedAt: new Date() })
      .where(eq(salesTransactionsTable.id, txId))
      .returning();

    const [cancelActor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (cancelActor) {
      writeSaleAudit({
        transactionId: txId,
        saleNumber: tx.saleNumber,
        projectId: tx.projectId,
        eventType: "cancelled",
        entityType: "transaction",
        description: `Sale cancelled by ${cancelActor.displayName ?? cancelActor.email ?? "Unknown"}`,
        actorId: cancelActor.id,
        actorName: cancelActor.displayName ?? cancelActor.email ?? "Unknown",
        actorRole: cancelActor.role,
      });
    }

    return res.json(formatTransaction(updated, cancelActor.role));
  },
);

// ── POST /sales/:id/line-items ─────────────────────────────────────────────────

router.post(
  "/:id/line-items",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const txId = req.params.id as string;
    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status !== "draft") return res.status(400).json({ error: "Can only add items to draft sales" });

    type Body = { batchId?: string; productType: string; quantity: number; unit: string; saleRate?: number; remarks?: string };
    const { batchId, productType, quantity, unit, saleRate, remarks } = req.body as Body;

    if (!productType || !quantity || !unit) {
      return res.status(400).json({ error: "productType, quantity, unit are required" });
    }

    let batchNumber: string | null = null;
    if (batchId) {
      const [batch] = await db
        .select({ batchNumber: productionBatchesTable.batchNumber })
        .from(productionBatchesTable)
        .where(eq(productionBatchesTable.id, batchId))
        .limit(1);
      batchNumber = batch?.batchNumber ?? null;
    }

    const grossAmount = saleRate !== undefined ? Number(quantity) * saleRate : null;

    const [created] = await db
      .insert(salesLineItemsTable)
      .values({
        transactionId: txId,
        batchId: batchId ?? null,
        batchNumber,
        productType,
        quantity: quantity.toString(),
        unit,
        saleRate: saleRate !== undefined ? saleRate.toString() : null,
        grossAmount: grossAmount !== null ? grossAmount.toString() : null,
        remarks: remarks ?? null,
      })
      .returning();

    await recomputeTotals(txId);

    const liAddActorName = actor.displayName ?? actor.email ?? "Unknown";
    writeSaleAudit({
      transactionId: txId,
      saleNumber: tx.saleNumber,
      projectId: tx.projectId,
      eventType: "line_item_added",
      entityType: "line_item",
      entityId: created.id,
      description: `Line item added: ${productType} × ${quantity} ${unit}${saleRate !== undefined ? ` @ ₹${saleRate}` : ""}`,
      actorId: actor.id,
      actorName: liAddActorName,
      actorRole: actor.role,
    });

    return res.status(201).json(formatLineItem(created, actor.role));
  },
);

// ── PATCH /sales/:txId/line-items/:itemId ──────────────────────────────────────

router.patch(
  "/:txId/line-items/:itemId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const txId = req.params.txId as string;
    const itemId = req.params.itemId as string;

    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);
    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status !== "draft") return res.status(400).json({ error: "Can only edit items in draft sales" });

    type Body = { quantity?: number; saleRate?: number; remarks?: string };
    const { quantity, saleRate, remarks } = req.body as Body;

    const [item] = await db
      .select()
      .from(salesLineItemsTable)
      .where(eq(salesLineItemsTable.id, itemId))
      .limit(1);
    if (!item) return res.status(404).json({ error: "Line item not found" });

    const newQty = quantity ?? Number(item.quantity);
    const newRate = saleRate ?? (item.saleRate !== null ? Number(item.saleRate) : undefined);
    const grossAmount = newRate !== undefined ? newQty * newRate : null;

    const [updated] = await db
      .update(salesLineItemsTable)
      .set({
        ...(quantity !== undefined && { quantity: quantity.toString() }),
        ...(saleRate !== undefined && { saleRate: saleRate.toString() }),
        ...(remarks !== undefined && { remarks }),
        ...(grossAmount !== null && { grossAmount: grossAmount.toString() }),
        updatedAt: new Date(),
      })
      .where(eq(salesLineItemsTable.id, itemId))
      .returning();

    await recomputeTotals(txId);

    const oldQty = Number(item.quantity);
    const oldRate = item.saleRate !== null ? Number(item.saleRate) : null;
    const newQtyVal = quantity !== undefined ? Number(quantity) : oldQty;
    const newRateVal = saleRate !== undefined ? Number(saleRate) : oldRate;
    const liRisk = assessLineItemRisk(oldQty, newQtyVal, oldRate, newRateVal, false);
    const liDesc = describeLineItemChange(item.productType, oldQty, newQtyVal, oldRate, newRateVal);
    const liChanges: FieldChange[] = [];
    if (quantity !== undefined && quantity !== oldQty) {
      liChanges.push({ field: "quantity", oldValue: oldQty, newValue: quantity });
    }
    if (saleRate !== undefined && saleRate !== oldRate) {
      liChanges.push({ field: "saleRate", oldValue: oldRate, newValue: saleRate });
    }
    const [liPatchActor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (liPatchActor) {
      writeSaleAudit({
        transactionId: txId,
        saleNumber: tx.saleNumber,
        projectId: tx.projectId,
        eventType: "line_item_updated",
        entityType: "line_item",
        entityId: itemId,
        description: liDesc,
        fieldChanges: liChanges,
        riskLevel: liRisk.riskLevel,
        riskReason: liRisk.riskReason,
        actorId: liPatchActor.id,
        actorName: liPatchActor.displayName ?? liPatchActor.email ?? "Unknown",
        actorRole: liPatchActor.role,
      });
    }

    return res.json(formatLineItem(updated, liPatchActor.role));
  },
);

// ── DELETE /sales/:txId/line-items/:itemId ─────────────────────────────────────

router.delete(
  "/:txId/line-items/:itemId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const txId = req.params.txId as string;
    const itemId = req.params.itemId as string;

    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);
    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status !== "draft") return res.status(400).json({ error: "Can only delete items from draft sales" });

    const [liToDelete] = await db
      .select()
      .from(salesLineItemsTable)
      .where(eq(salesLineItemsTable.id, itemId))
      .limit(1);
    await db.delete(salesLineItemsTable).where(eq(salesLineItemsTable.id, itemId));
    await recomputeTotals(txId);

    const [liDelActor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (liDelActor) {
      writeSaleAudit({
        transactionId: txId,
        saleNumber: tx.saleNumber,
        projectId: tx.projectId,
        eventType: "line_item_removed",
        entityType: "line_item",
        entityId: itemId,
        description: liToDelete
          ? `Line item removed: ${liToDelete.productType} × ${liToDelete.quantity} ${liToDelete.unit}`
          : "Line item removed",
        actorId: liDelActor.id,
        actorName: liDelActor.displayName ?? liDelActor.email ?? "Unknown",
        actorRole: liDelActor.role,
      });
    }

    return res.json({ success: true });
  },
);

// ── POST /sales/:id/deductions ─────────────────────────────────────────────────

router.post(
  "/:id/deductions",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const txId = req.params.id as string;
    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);
    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status !== "draft") return res.status(400).json({ error: "Can only add deductions to draft sales" });

    type Body = { deductionType?: string; description?: string; amount: number };
    const { deductionType, description, amount } = req.body as Body;
    if (!amount) return res.status(400).json({ error: "amount is required" });

    const [created] = await db
      .insert(salesDeductionsTable)
      .values({
        transactionId: txId,
        deductionType: deductionType ?? "other",
        description: description ?? null,
        amount: amount.toString(),
      })
      .returning();

    await recomputeTotals(txId);

    const [dedAddActor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (dedAddActor) {
      writeSaleAudit({
        transactionId: txId,
        saleNumber: tx.saleNumber,
        projectId: tx.projectId,
        eventType: "deduction_added",
        entityType: "deduction",
        entityId: created.id,
        description: `Deduction added: ${created.deductionType} — ₹${amount}${description ? ` (${description})` : ""}`,
        actorId: dedAddActor.id,
        actorName: dedAddActor.displayName ?? dedAddActor.email ?? "Unknown",
        actorRole: dedAddActor.role,
      });
    }

    return res.status(201).json(formatDeduction(created));
  },
);

// ── DELETE /sales/:txId/deductions/:dedId ──────────────────────────────────────

router.delete(
  "/:txId/deductions/:dedId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const txId = req.params.txId as string;
    const dedId = req.params.dedId as string;

    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);
    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (tx.status !== "draft") return res.status(400).json({ error: "Can only delete deductions from draft sales" });

    const [dedToDelete] = await db
      .select()
      .from(salesDeductionsTable)
      .where(eq(salesDeductionsTable.id, dedId))
      .limit(1);
    await db.delete(salesDeductionsTable).where(eq(salesDeductionsTable.id, dedId));
    await recomputeTotals(txId);

    const [dedDelActor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (dedDelActor) {
      writeSaleAudit({
        transactionId: txId,
        saleNumber: tx.saleNumber,
        projectId: tx.projectId,
        eventType: "deduction_removed",
        entityType: "deduction",
        entityId: dedId,
        description: dedToDelete
          ? `Deduction removed: ${dedToDelete.deductionType} — ₹${dedToDelete.amount}`
          : "Deduction removed",
        actorId: dedDelActor.id,
        actorName: dedDelActor.displayName ?? dedDelActor.email ?? "Unknown",
        actorRole: dedDelActor.role,
      });
    }

    return res.json({ success: true });
  },
);

export default router;
