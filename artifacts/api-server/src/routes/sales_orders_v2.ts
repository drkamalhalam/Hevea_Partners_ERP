import { Router } from "express";
import {
  db,
  salesOrdersTable,
  salesOrderDispatchesTable,
  salesOrderAuditTable,
  inventoryReservationsTable,
  salesInvoicesTable,
  moneyCustodyLedgerTable,
  paymentTransactionsTable,
  projectsTable,
  buyersTable,
  usersTable,
  paymentReceiverAccountsTable,
  storesTable,
  inventoryStockMovementsTable,
  salesTransactionsTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { format, addMinutes } from "date-fns";
import { canAccessProject } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateSalesCode(): string {
  const date = format(new Date(), "yyyyMMdd");
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `SO-${date}-${rand}`;
}

function generateInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `INV-${year}-${rand}`;
}

async function writeAudit(
  req: any,
  salesOrderId: string | null,
  salesCode: string,
  projectId: string | null,
  eventType: string,
  description: string,
  metadata?: object,
) {
  await db.insert(salesOrderAuditTable).values({
    salesOrderId: salesOrderId ?? undefined,
    salesCode,
    projectId: projectId ?? undefined,
    eventType,
    description,
    actorId: req.dbUser?.id,
    actorName: req.dbUser?.displayName ?? "",
    actorRole: req.dbUser?.role ?? "",
    metadata: metadata ? JSON.stringify(metadata) : undefined,
  });
}

// ── List orders ───────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { projectId, orderStatus, paymentStatus, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [];

    if (!req.canAccessAllProjects) {
      const allowedIds = req.userProjectIds ?? [];
      if (projectId) {
        if (!allowedIds.includes(projectId)) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        conditions.push(eq(salesOrdersTable.projectId, projectId));
      } else {
        if (allowedIds.length === 0) { res.json([]); return; }
        conditions.push(inArray(salesOrdersTable.projectId, allowedIds));
      }
    } else {
      if (projectId) conditions.push(eq(salesOrdersTable.projectId, projectId));
    }

    if (orderStatus) conditions.push(eq(salesOrdersTable.orderStatus, orderStatus));
    if (paymentStatus) conditions.push(eq(salesOrdersTable.paymentStatus, paymentStatus));

    const orders = await db
      .select()
      .from(salesOrdersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(salesOrdersTable.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    res.json(orders);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch sales orders" });
  }
});

// ── Get single order ──────────────────────────────────────────────────────────

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (!canAccessProject(req, order.projectId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const dispatches = await db
      .select()
      .from(salesOrderDispatchesTable)
      .where(eq(salesOrderDispatchesTable.salesOrderId, order.id))
      .orderBy(desc(salesOrderDispatchesTable.dispatchedAt));

    const audit = await db
      .select()
      .from(salesOrderAuditTable)
      .where(eq(salesOrderAuditTable.salesOrderId, order.id))
      .orderBy(desc(salesOrderAuditTable.createdAt));

    const reservations = await db
      .select()
      .from(inventoryReservationsTable)
      .where(eq(inventoryReservationsTable.salesOrderId, order.id));

    const txns = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.salesOrderId, order.id))
      .orderBy(desc(paymentTransactionsTable.detectedAt));

    let invoice = null;
    if (order.invoiceId) {
      const [inv] = await db
        .select()
        .from(salesInvoicesTable)
        .where(eq(salesInvoicesTable.id, order.invoiceId));
      invoice = inv ?? null;
    }

    res.json({ ...order, dispatches, audit, reservations, paymentTransactions: txns, invoice });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// ── Create order (draft) ──────────────────────────────────────────────────────

const CreateOrderSchema = z.object({
  projectId: z.string().uuid(),
  buyerId: z.string().uuid().optional(),
  buyerName: z.string().min(1),
  quantityKg: z.number().positive(),
  ratePerKg: z.number().positive(),
  paymentMode: z.enum(["online_only", "cash_only", "both"]).default("online_only"),
  paymentReceiverAccountId: z.string().uuid().optional(),
  remarks: z.string().optional(),
});

router.post("/", async (req, res): Promise<void> => {
  const parse = CreateOrderSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }
  const data = parse.data;

  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, data.projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (project.lifecycleStatus === "closed") {
      res.status(400).json({ error: "Cannot create sales order for a closed project" });
      return;
    }

    let receiverName: string | undefined;
    if (data.paymentReceiverAccountId) {
      const [acc] = await db
        .select()
        .from(paymentReceiverAccountsTable)
        .where(and(
          eq(paymentReceiverAccountsTable.id, data.paymentReceiverAccountId),
          eq(paymentReceiverAccountsTable.isActive, true),
        ));
      if (!acc) { res.status(400).json({ error: "Payment receiver account not found or inactive" }); return; }
      receiverName = acc.accountName;
    }

    const totalAmount = (data.quantityKg * data.ratePerKg).toFixed(2);
    const salesCode = generateSalesCode();

    const [order] = await db
      .insert(salesOrdersTable)
      .values({
        salesCode,
        projectId: data.projectId,
        projectName: project.name,
        buyerId: data.buyerId,
        buyerName: data.buyerName,
        sellerUserId: req.dbUser?.id,
        sellerName: req.dbUser?.displayName ?? "",
        sellerRole: req.dbUser?.role ?? "",
        quantityKg: data.quantityKg.toString(),
        ratePerKg: data.ratePerKg.toString(),
        totalAmount,
        paymentMode: data.paymentMode,
        paymentReceiverAccountId: data.paymentReceiverAccountId,
        paymentReceiverName: receiverName,
        orderStatus: "draft",
        paymentStatus: "unpaid",
        inventoryStatus: "available",
        dispatchStatus: "not_dispatched",
        remarks: data.remarks,
        createdById: req.dbUser?.id,
        createdByName: req.dbUser?.displayName ?? "",
      })
      .returning();

    await writeAudit(req, order.id, salesCode, data.projectId, "created",
      `Sales order ${salesCode} created for ${data.buyerName} — ${data.quantityKg} kg @ ₹${data.ratePerKg}/kg`);

    res.status(201).json(order);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create sales order" });
  }
});

// ── Initiate payment request ──────────────────────────────────────────────────

router.post("/:id/request-payment", async (req, res): Promise<void> => {
  try {
    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    if (!["draft"].includes(order.orderStatus)) {
      res.status(400).json({ error: `Cannot request payment for order in status: ${order.orderStatus}` });
      return;
    }

    const now = new Date();
    const expiresAt = addMinutes(now, 30);

    // Create inventory reservation
    await db.insert(inventoryReservationsTable).values({
      salesOrderId: order.id,
      salesCode: order.salesCode,
      projectId: order.projectId,
      quantityKg: order.quantityKg,
      status: "active",
      expiresAt,
    });

    const [updated] = await db
      .update(salesOrdersTable)
      .set({
        orderStatus: "payment_pending",
        paymentStatus: "pending",
        inventoryStatus: "reserved",
        paymentRequestedAt: now,
        paymentExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(salesOrdersTable.id, order.id))
      .returning();

    await writeAudit(req, order.id, order.salesCode, order.projectId, "payment_requested",
      `Payment request initiated for ${order.salesCode}. Inventory reserved. Expires at ${expiresAt.toISOString()}`);

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to initiate payment request" });
  }
});

// ── Record payment detected (manual / webhook) ────────────────────────────────

const DetectPaymentSchema = z.object({
  transactionReference: z.string().optional(),
  amount: z.number().positive(),
  paymentProvider: z.string().default("manual"),
  notes: z.string().optional(),
});

router.post("/:id/detect-payment", async (req, res): Promise<void> => {
  const parse = DetectPaymentSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }

  try {
    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (!["payment_pending"].includes(order.orderStatus)) {
      res.status(400).json({ error: `Cannot detect payment for order in status: ${order.orderStatus}` });
      return;
    }

    const data = parse.data;

    // ── Duplicate UTR guard ───────────────────────────────────────
    if (data.transactionReference) {
      const [duplicate] = await db
        .select({ id: paymentTransactionsTable.id })
        .from(paymentTransactionsTable)
        .where(eq(paymentTransactionsTable.transactionReference, data.transactionReference))
        .limit(1);
      if (duplicate) {
        res.status(409).json({
          error: `Duplicate transaction: UTR ${data.transactionReference} has already been recorded. If this is a mistake, contact admin.`,
        });
        return;
      }
    }

    const expectedAmount = parseFloat(order.totalAmount);
    const detectedAmount = data.amount;
    const matched = Math.abs(expectedAmount - detectedAmount) < 0.01;

    const [txn] = await db
      .insert(paymentTransactionsTable)
      .values({
        salesOrderId: order.id,
        transactionReference: data.transactionReference,
        amount: detectedAmount.toString(),
        paymentProvider: data.paymentProvider,
        detectedAt: new Date(),
        verificationStatus: matched ? "matched" : "mismatched",
        notes: data.notes,
      })
      .returning();

    await db
      .update(salesOrdersTable)
      .set({
        orderStatus: "awaiting_manual_confirmation",
        paymentStatus: "detected",
        updatedAt: new Date(),
      })
      .where(eq(salesOrdersTable.id, order.id));

    await writeAudit(req, order.id, order.salesCode, order.projectId, "payment_detected",
      `Payment detected: ₹${detectedAmount} via ${data.paymentProvider}. Status: ${matched ? "matched" : "mismatched"}`);

    res.json(txn);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record payment detection" });
  }
});

// ── Confirm payment (manual authorization) ────────────────────────────────────

router.post("/:id/confirm-payment", async (req, res): Promise<void> => {
  try {
    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    if (!["payment_pending", "awaiting_manual_confirmation", "payment_detected"].includes(order.orderStatus)) {
      res.status(400).json({ error: `Cannot confirm payment for order in status: ${order.orderStatus}` });
      return;
    }

    const now = new Date();
    const paymentRef = req.body.paymentReference as string | undefined;
    const notes = req.body.notes as string | undefined;

    // Fulfill reservation
    await db
      .update(inventoryReservationsTable)
      .set({ status: "fulfilled", fulfilledAt: now })
      .where(and(
        eq(inventoryReservationsTable.salesOrderId, order.id),
        eq(inventoryReservationsTable.status, "active"),
      ));

    // Mark any pending txns as confirmed
    await db
      .update(paymentTransactionsTable)
      .set({
        verificationStatus: "confirmed",
        manuallyConfirmedById: req.dbUser?.id,
        manuallyConfirmedByName: req.dbUser?.displayName ?? "",
        manuallyConfirmedAt: now,
      })
      .where(and(
        eq(paymentTransactionsTable.salesOrderId, order.id),
        inArray(paymentTransactionsTable.verificationStatus, ["detected", "matched", "mismatched"]),
      ));

    // Generate invoice number
    const invoiceNumber = generateInvoiceNumber();
    const [invoice] = await db
      .insert(salesInvoicesTable)
      .values({
        invoiceNumber,
        salesOrderId: order.id,
        salesCode: order.salesCode,
        projectId: order.projectId,
        projectName: order.projectName,
        buyerId: order.buyerId ?? undefined,
        buyerName: order.buyerName,
        sellerName: order.sellerName,
        sellerRole: order.sellerRole,
        paymentReceiverName: order.paymentReceiverName ?? undefined,
        paymentMode: order.paymentMode,
        paymentReference: paymentRef,
        paymentConfirmedAt: now,
        quantityKg: order.quantityKg,
        ratePerKg: order.ratePerKg,
        totalAmount: order.totalAmount,
        dispatchStatus: "not_dispatched",
        quantityDispatchedKg: "0",
        generatedById: req.dbUser?.id,
        generatedByName: req.dbUser?.displayName ?? "",
        invoiceDate: format(now, "yyyy-MM-dd"),
      })
      .returning();

    // Create money custody entry
    await db.insert(moneyCustodyLedgerTable).values({
      projectId: order.projectId,
      projectName: order.projectName,
      holderUserId: order.sellerUserId ?? undefined,
      holderName: order.paymentReceiverName ?? order.sellerName,
      holderRole: order.sellerRole,
      amount: order.totalAmount,
      paymentMode: order.paymentMode === "cash_only" ? "cash" : "online",
      sourceType: "sales_order",
      sourceReference: order.id,
      sourceCode: order.salesCode,
      receivedDate: format(now, "yyyy-MM-dd"),
      depositedAmount: "0",
      remainingBalance: order.totalAmount,
      createdById: req.dbUser?.id,
      createdByName: req.dbUser?.displayName ?? "",
    });

    // Update order
    const [updated] = await db
      .update(salesOrdersTable)
      .set({
        orderStatus: "confirmed",
        paymentStatus: "confirmed",
        inventoryStatus: "sold",
        paymentConfirmedAt: now,
        paymentConfirmedById: req.dbUser?.id,
        paymentConfirmedByName: req.dbUser?.displayName ?? "",
        invoiceId: invoice.id,
        updatedAt: now,
      })
      .where(eq(salesOrdersTable.id, order.id))
      .returning();

    await writeAudit(req, order.id, order.salesCode, order.projectId, "payment_confirmed",
      `Payment confirmed by ${req.dbUser?.displayName}. Invoice ${invoiceNumber} generated. ₹${order.totalAmount}`,
      { invoiceNumber, paymentRef, notes });

    // ── Financial bridge: V1 salesTransactions record at payment confirmation ──
    // Revenue is recognized the moment cash is received — not at physical dispatch.
    // This makes the confirmed order immediately visible in project cards, V1 sales
    // reports, the fifty-percent settlement engine, and distribution sessions.
    if (order.projectId) {
      const bridgeSaleNumber = order.salesCode;
      const [existingBridge] = await db
        .select({ id: salesTransactionsTable.id })
        .from(salesTransactionsTable)
        .where(eq(salesTransactionsTable.saleNumber, bridgeSaleNumber))
        .limit(1);
      if (!existingBridge) {
        await db.insert(salesTransactionsTable).values({
          projectId: order.projectId,
          buyerId: order.buyerId ?? undefined,
          buyerName: order.buyerName ?? "N/A",
          saleNumber: bridgeSaleNumber,
          saleDate: format(now, "yyyy-MM-dd"),
          status: "confirmed",
          totalGrossRevenue: order.totalAmount,
          totalDeductions: "0",
          totalNetRevenue: order.totalAmount,
          confirmedAt: now,
          confirmedById: req.dbUser?.id,
          confirmedByName: req.dbUser?.displayName ?? "",
          createdById: req.dbUser?.id,
          createdByName: req.dbUser?.displayName ?? "",
          documentRef: order.salesCode,
          notes: `Auto-bridged from Sales Order ${order.salesCode}`,
        });
        req.log.info(
          { salesCode: order.salesCode, amount: order.totalAmount, projectId: order.projectId },
          "sales-orders: V1 financial bridge record created at payment confirmation",
        );
      }
    }

    res.json({ ...updated, invoice });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

// ── Cancel order ──────────────────────────────────────────────────────────────

router.post("/:id/cancel", async (req, res): Promise<void> => {
  try {
    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (["confirmed", "completed", "cancelled"].includes(order.orderStatus)) {
      res.status(400).json({ error: `Cannot cancel order in status: ${order.orderStatus}` });
      return;
    }

    const reason = (req.body.reason as string) || "Cancelled by user";
    const now = new Date();

    // Release reservations
    await db
      .update(inventoryReservationsTable)
      .set({ status: "released", releasedAt: now, releaseReason: reason, releasedById: req.dbUser?.id })
      .where(and(
        eq(inventoryReservationsTable.salesOrderId, order.id),
        eq(inventoryReservationsTable.status, "active"),
      ));

    const [updated] = await db
      .update(salesOrdersTable)
      .set({
        orderStatus: "cancelled",
        inventoryStatus: "available",
        cancellationReason: reason,
        cancelledAt: now,
        cancelledById: req.dbUser?.id,
        updatedAt: now,
      })
      .where(eq(salesOrdersTable.id, order.id))
      .returning();

    await writeAudit(req, order.id, order.salesCode, order.projectId, "cancelled",
      `Order ${order.salesCode} cancelled. Reason: ${reason}`);

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to cancel order" });
  }
});

// ── Dispatch (partial or full) ────────────────────────────────────────────────

const DispatchSchema = z.object({
  quantityKg: z.number().positive(),
  storeId: z.string().uuid().optional(),
  storeName: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/:id/dispatch", async (req, res): Promise<void> => {
  const parse = DispatchSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }

  try {
    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, req.params.id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (!["confirmed", "partially_dispatched"].includes(order.orderStatus)) {
      res.status(400).json({ error: "Order must be confirmed before dispatch" });
      return;
    }

    const data = parse.data;
    const orderedKg = parseFloat(order.quantityKg);
    const alreadyDispatched = parseFloat(order.quantityDispatchedKg ?? "0");
    const remaining = orderedKg - alreadyDispatched;

    if (data.quantityKg > remaining + 0.001) {
      res.status(400).json({ error: `Cannot dispatch ${data.quantityKg} kg — only ${remaining.toFixed(3)} kg remaining` });
      return;
    }

    const now = new Date();
    const [dispatch] = await db
      .insert(salesOrderDispatchesTable)
      .values({
        salesOrderId: order.id,
        storeId: data.storeId,
        storeName: data.storeName,
        quantityKg: data.quantityKg.toString(),
        dispatchedById: req.dbUser?.id,
        dispatchedByName: req.dbUser?.displayName ?? "",
        dispatchedAt: now,
        notes: data.notes,
      })
      .returning();

    const newDispatched = alreadyDispatched + data.quantityKg;
    const isFullyDispatched = newDispatched >= orderedKg - 0.001;
    const newStatus = isFullyDispatched ? "completed" : "partially_dispatched";
    const newDispatchStatus = isFullyDispatched ? "fully_dispatched" : "partially_dispatched";

    const [updated] = await db
      .update(salesOrdersTable)
      .set({
        orderStatus: newStatus,
        dispatchStatus: newDispatchStatus,
        quantityDispatchedKg: newDispatched.toString(),
        updatedAt: now,
      })
      .where(eq(salesOrdersTable.id, order.id))
      .returning();

    // Update invoice dispatch status
    if (order.invoiceId) {
      await db
        .update(salesInvoicesTable)
        .set({ dispatchStatus: newDispatchStatus, quantityDispatchedKg: newDispatched.toString() })
        .where(eq(salesInvoicesTable.id, order.invoiceId));
    }

    // ── Phase 10: write confirmed sale_out to canonical inventory ledger ──────
    // Every dispatch event writes a confirmed sale_out movement so the universal
    // stock balance (used by inventory pages, field context, project cards) stays
    // in sync with fulfillment reality.
    if (order.projectId) {
      await db.insert(inventoryStockMovementsTable).values({
        projectId: order.projectId,
        stockType: "rubber_sheet",   // canonical commodity for rubber sales orders
        movementType: "sale_out",
        direction: "out",
        quantity: data.quantityKg.toString(),
        unit: "kg",
        movementDate: format(now, "yyyy-MM-dd"),
        referenceId: order.salesCode,
        referenceType: "sale",
        status: "confirmed",
        confirmedAt: now,
        confirmedById: req.dbUser?.id,
        confirmedByName: req.dbUser?.displayName ?? "",
        createdById: req.dbUser?.id,
        createdByName: req.dbUser?.displayName ?? "",
      });

    }

    await writeAudit(req, order.id, order.salesCode, order.projectId, "dispatched",
      `Dispatched ${data.quantityKg} kg${data.storeName ? ` from ${data.storeName}` : ""}. Total: ${newDispatched.toFixed(3)}/${orderedKg} kg.`);

    res.json({ ...updated, dispatch });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record dispatch" });
  }
});

// ── Expire stale reservations ─────────────────────────────────────────────────

router.post("/admin/expire-reservations", async (req, res) => {
  try {
    const now = new Date();
    const expired = await db
      .update(inventoryReservationsTable)
      .set({ status: "expired", releasedAt: now, releaseReason: "TTL elapsed" })
      .where(and(
        eq(inventoryReservationsTable.status, "active"),
        lte(inventoryReservationsTable.expiresAt, now),
      ))
      .returning();

    if (expired.length > 0) {
      const orderIds = [...new Set(expired.map((r) => r.salesOrderId))];
      await db
        .update(salesOrdersTable)
        .set({ orderStatus: "expired", inventoryStatus: "available", updatedAt: now })
        .where(and(
          inArray(salesOrdersTable.id, orderIds),
          eq(salesOrdersTable.orderStatus, "payment_pending"),
        ));
    }

    res.json({ expired: expired.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to expire reservations" });
  }
});

// ── Reconcile revenue bridges for existing confirmed orders ───────────────────
// One-time admin endpoint: creates V1 salesTransactions bridge records for all
// confirmed/in-dispatch/completed V2 orders that predate the auto-bridge logic.
// Safe to call multiple times — idempotent.

router.post("/admin/reconcile-bridges", async (req, res) => {
  try {
    const orders = await db
      .select()
      .from(salesOrdersTable)
      .where(inArray(salesOrdersTable.orderStatus, ["confirmed", "partially_dispatched", "completed"]));

    let created = 0;
    let skipped = 0;
    for (const order of orders) {
      if (!order.projectId) { skipped++; continue; }
      const bridgeSaleNumber = order.salesCode;
      const [existing] = await db
        .select({ id: salesTransactionsTable.id })
        .from(salesTransactionsTable)
        .where(eq(salesTransactionsTable.saleNumber, bridgeSaleNumber))
        .limit(1);
      if (existing) { skipped++; continue; }

      const confirmedAt = order.paymentConfirmedAt ?? new Date();
      await db.insert(salesTransactionsTable).values({
        projectId: order.projectId,
        buyerId: order.buyerId ?? undefined,
        buyerName: order.buyerName ?? "N/A",
        saleNumber: bridgeSaleNumber,
        saleDate: format(confirmedAt, "yyyy-MM-dd"),
        status: "confirmed",
        totalGrossRevenue: order.totalAmount,
        totalDeductions: "0",
        totalNetRevenue: order.totalAmount,
        confirmedAt,
        confirmedById: order.paymentConfirmedById ?? undefined,
        confirmedByName: order.paymentConfirmedByName ?? "",
        createdById: req.dbUser?.id,
        createdByName: req.dbUser?.displayName ?? "",
        documentRef: order.salesCode,
        notes: `Retroactively bridged from Sales Order ${order.salesCode}`,
      });
      created++;
    }

    req.log.info({ created, skipped }, "sales-orders: reconcile-bridges complete");
    res.json({
      created,
      skipped,
      message: `Created ${created} bridge record${created !== 1 ? "s" : ""}. ${skipped} already existed or had no project.`,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to reconcile bridges" });
  }
});

// ── Summary stats ─────────────────────────────────────────────────────────────

router.get("/stats/summary", async (req, res) => {
  try {
    const { projectId } = req.query as Record<string, string>;
    const conditions = projectId ? [eq(salesOrdersTable.projectId, projectId)] : [];

    const orders = await db
      .select()
      .from(salesOrdersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = orders.length;
    const byStatus: Record<string, number> = {};
    let totalRevenue = 0;
    let confirmedRevenue = 0;

    for (const o of orders) {
      byStatus[o.orderStatus] = (byStatus[o.orderStatus] ?? 0) + 1;
      totalRevenue += parseFloat(o.totalAmount);
      if (o.orderStatus === "confirmed" || o.orderStatus === "completed") {
        confirmedRevenue += parseFloat(o.totalAmount);
      }
    }

    res.json({ total, byStatus, totalRevenue, confirmedRevenue });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
