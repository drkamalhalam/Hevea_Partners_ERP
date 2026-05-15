import { Router } from "express";
import { db, moneyCustodyLedgerTable, projectsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { differenceInDays, parseISO } from "date-fns";

const router = Router();

const CASH_AGING_WARNING_DAYS = 7;
const CASH_AGING_CRITICAL_DAYS = 14;

router.get("/", async (req, res) => {
  try {
    const { projectId, holderUserId, isClosed } = req.query as Record<string, string>;
    const conditions = [];
    if (projectId) conditions.push(eq(moneyCustodyLedgerTable.projectId, projectId));
    if (holderUserId) conditions.push(eq(moneyCustodyLedgerTable.holderUserId, holderUserId));
    if (isClosed !== undefined) {
      conditions.push(eq(moneyCustodyLedgerTable.isClosed, isClosed === "true"));
    } else {
      conditions.push(eq(moneyCustodyLedgerTable.isClosed, false));
    }

    const entries = await db
      .select()
      .from(moneyCustodyLedgerTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(moneyCustodyLedgerTable.createdAt));

    // Compute aging for cash entries
    const today = new Date();
    const enriched = entries.map((e) => {
      const daysHeld = differenceInDays(today, parseISO(e.receivedDate));
      const agingStatus =
        e.paymentMode === "cash"
          ? daysHeld >= CASH_AGING_CRITICAL_DAYS
            ? "critical"
            : daysHeld >= CASH_AGING_WARNING_DAYS
            ? "warning"
            : "ok"
          : "ok";
      return { ...e, daysHeld, agingStatus };
    });

    res.json(enriched);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch money custody ledger" });
  }
});

const DepositSchema = z.object({
  depositedAmount: z.number().positive(),
  depositReference: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/:id/deposit", async (req, res) => {
  const parse = DepositSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  try {
    const [entry] = await db
      .select()
      .from(moneyCustodyLedgerTable)
      .where(eq(moneyCustodyLedgerTable.id, req.params.id));
    if (!entry) return res.status(404).json({ error: "Ledger entry not found" });
    if (entry.isClosed) return res.status(400).json({ error: "Entry is already closed" });

    const data = parse.data;
    const totalAmount = parseFloat(entry.amount);
    const alreadyDeposited = parseFloat(entry.depositedAmount ?? "0");
    const newDeposited = alreadyDeposited + data.depositedAmount;
    const newRemaining = totalAmount - newDeposited;

    if (newDeposited > totalAmount + 0.01) {
      return res.status(400).json({ error: "Deposit exceeds total amount" });
    }

    const isClosed = newRemaining <= 0.01;

    const [updated] = await db
      .update(moneyCustodyLedgerTable)
      .set({
        depositedAmount: newDeposited.toString(),
        remainingBalance: Math.max(0, newRemaining).toString(),
        depositedAt: new Date(),
        depositedById: req.dbUser?.id,
        depositedByName: req.dbUser?.displayName ?? "",
        depositReference: data.depositReference,
        isClosed,
        notes: data.notes ?? entry.notes,
        updatedAt: new Date(),
      })
      .where(eq(moneyCustodyLedgerTable.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record deposit" });
  }
});

router.get("/summary/by-holder", async (req, res) => {
  try {
    const { projectId } = req.query as Record<string, string>;
    const conditions = [eq(moneyCustodyLedgerTable.isClosed, false)];
    if (projectId) conditions.push(eq(moneyCustodyLedgerTable.projectId, projectId));

    const entries = await db
      .select()
      .from(moneyCustodyLedgerTable)
      .where(and(...conditions));

    const byHolder: Record<string, {
      holderName: string;
      holderRole: string;
      totalAmount: number;
      remainingBalance: number;
      cashAmount: number;
      onlineAmount: number;
      oldestCashDate: string | null;
      agingStatus: string;
    }> = {};

    const today = new Date();
    for (const e of entries) {
      const key = e.holderUserId ?? e.holderName;
      if (!byHolder[key]) {
        byHolder[key] = {
          holderName: e.holderName,
          holderRole: e.holderRole,
          totalAmount: 0,
          remainingBalance: 0,
          cashAmount: 0,
          onlineAmount: 0,
          oldestCashDate: null,
          agingStatus: "ok",
        };
      }
      const h = byHolder[key];
      h.totalAmount += parseFloat(e.amount);
      h.remainingBalance += parseFloat(e.remainingBalance);
      if (e.paymentMode === "cash") {
        h.cashAmount += parseFloat(e.remainingBalance);
        if (!h.oldestCashDate || e.receivedDate < h.oldestCashDate) {
          h.oldestCashDate = e.receivedDate;
        }
      } else {
        h.onlineAmount += parseFloat(e.remainingBalance);
      }
    }

    // Compute aging
    for (const h of Object.values(byHolder)) {
      if (h.oldestCashDate) {
        const days = differenceInDays(today, parseISO(h.oldestCashDate));
        h.agingStatus = days >= CASH_AGING_CRITICAL_DAYS ? "critical" : days >= CASH_AGING_WARNING_DAYS ? "warning" : "ok";
      }
    }

    res.json(Object.values(byHolder));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch custody summary" });
  }
});

export default router;
