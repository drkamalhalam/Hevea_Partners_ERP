import { Router } from "express";
import { db, salesInvoicesTable, salesOrdersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { projectId, buyerId, dispatchStatus, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const conditions = [];
    if (projectId) conditions.push(eq(salesInvoicesTable.projectId, projectId));
    if (buyerId) conditions.push(eq(salesInvoicesTable.buyerId, buyerId));
    if (dispatchStatus) conditions.push(eq(salesInvoicesTable.dispatchStatus, dispatchStatus));

    const invoices = await db
      .select()
      .from(salesInvoicesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(salesInvoicesTable.generatedAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    res.json(invoices);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [invoice] = await db
      .select()
      .from(salesInvoicesTable)
      .where(eq(salesInvoicesTable.id, req.params.id));
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const [order] = await db
      .select()
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, invoice.salesOrderId));

    res.json({ ...invoice, order });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

router.get("/by-number/:number", async (req, res): Promise<void> => {
  try {
    const [invoice] = await db
      .select()
      .from(salesInvoicesTable)
      .where(eq(salesInvoicesTable.invoiceNumber, req.params.number));
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json(invoice);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

export default router;
