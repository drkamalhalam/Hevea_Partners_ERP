/**
 * held_distribution_ledger.ts
 *
 * Tracks distributions held due to ownership disputes or locks.
 * Only the disputed partner's attributable share is held — the rest of
 * the project's profit distribution continues normally.
 *
 * Endpoints:
 *   GET  /                      — list held entries (filter: projectId, partnerId, status)
 *   GET  /summary               — aggregate totals by project and partner
 *   POST /                      — create a held entry (admin/developer)
 *   GET  /:id                   — get single entry
 *   POST /:id/release           — release a held amount (admin only)
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  heldDistributionLedgerTable,
  partnersTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helper ─────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0] ?? null;
}

function fmt(r: typeof heldDistributionLedgerTable.$inferSelect) {
  return {
    id: r.id,
    projectId: r.projectId,
    partnerId: r.partnerId,
    partnerName: r.partnerName,
    holdType: r.holdType,
    sourceId: r.sourceId ?? null,
    sourceType: r.sourceType ?? null,
    sourceDescription: r.sourceDescription,
    periodYear: r.periodYear ?? null,
    heldAmount: r.heldAmount,
    ownershipPctAtTime: r.ownershipPctAtTime ?? null,
    holdReason: r.holdReason,
    holdNotes: r.holdNotes ?? null,
    status: r.status,
    releasedAt: r.releasedAt?.toISOString() ?? null,
    releasedAmount: r.releasedAmount ?? null,
    releasedTo: r.releasedTo ?? null,
    releaseNotes: r.releaseNotes,
    releasedByName: r.releasedByName ?? null,
    createdByName: r.createdByName ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── GET / ──────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { projectId, partnerId, status } = req.query as Record<string, string | undefined>;
  try {
    const conditions = [];
    if (projectId) conditions.push(eq(heldDistributionLedgerTable.projectId, projectId));
    if (partnerId) conditions.push(eq(heldDistributionLedgerTable.partnerId, partnerId));
    if (status) conditions.push(eq(heldDistributionLedgerTable.status, status));

    const rows = await db
      .select()
      .from(heldDistributionLedgerTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(heldDistributionLedgerTable.createdAt));
    res.json(rows.map(fmt));
  } catch (err) {
    req.log.error({ err }, "Failed to list held distribution entries");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /summary ───────────────────────────────────────────────────────────

router.get("/summary", requireRole("admin", "developer"), async (req, res) => {
  const { projectId } = req.query as Record<string, string | undefined>;
  try {
    const conditions = [eq(heldDistributionLedgerTable.status, "held")];
    if (projectId) conditions.push(eq(heldDistributionLedgerTable.projectId, projectId));

    const rows = await db
      .select({
        projectId: heldDistributionLedgerTable.projectId,
        partnerId: heldDistributionLedgerTable.partnerId,
        partnerName: heldDistributionLedgerTable.partnerName,
        totalHeld: sql<number>`SUM(${heldDistributionLedgerTable.heldAmount}::numeric)`,
        entryCount: sql<number>`COUNT(*)::int`,
      })
      .from(heldDistributionLedgerTable)
      .where(and(...conditions))
      .groupBy(
        heldDistributionLedgerTable.projectId,
        heldDistributionLedgerTable.partnerId,
        heldDistributionLedgerTable.partnerName,
      )
      .orderBy(heldDistributionLedgerTable.projectId, heldDistributionLedgerTable.partnerName);

    res.json(rows.map((r) => ({
      projectId: r.projectId,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      totalHeld: Number(r.totalHeld),
      entryCount: r.entryCount,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to get held distribution summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST / — create held entry ─────────────────────────────────────────────

const createSchema = z.object({
  projectId: z.string().uuid(),
  partnerId: z.string().uuid(),
  holdType: z.enum(["profit_distribution", "sale_proceeds", "lca_credit", "revenue_entitlement", "other"]),
  sourceId: z.string().uuid().optional().nullable(),
  sourceType: z.string().optional().nullable(),
  sourceDescription: z.string().min(1),
  periodYear: z.number().int().optional().nullable(),
  heldAmount: z.number().positive(),
  ownershipPctAtTime: z.number().min(0).max(100).optional().nullable(),
  holdReason: z.enum(["ownership_dispute", "payment_dispute", "governance_lock", "inheritance_pending", "admin_hold"]),
  holdNotes: z.string().optional().nullable(),
});

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    try {
      const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

      // Verify project
      const [project] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.id, b.projectId))
        .limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Verify partner
      const [partner] = await db
        .select({ id: partnersTable.id, name: partnersTable.name })
        .from(partnersTable)
        .where(eq(partnersTable.id, b.partnerId))
        .limit(1);
      if (!partner) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }

      const [created] = await db
        .insert(heldDistributionLedgerTable)
        .values({
          projectId: b.projectId,
          partnerId: b.partnerId,
          partnerName: partner.name,
          holdType: b.holdType,
          sourceId: b.sourceId ?? null,
          sourceType: b.sourceType ?? null,
          sourceDescription: b.sourceDescription,
          periodYear: b.periodYear ?? null,
          heldAmount: String(b.heldAmount),
          ownershipPctAtTime: b.ownershipPctAtTime != null ? String(b.ownershipPctAtTime) : null,
          holdReason: b.holdReason,
          holdNotes: b.holdNotes ?? null,
          status: "held",
          createdBy: actor?.id ?? null,
          createdByName: actor?.displayName ?? null,
        })
        .returning();

      req.log.info({ id: created.id, projectId: b.projectId, partnerId: b.partnerId }, "Held distribution entry created");
      res.status(201).json(fmt(created));
    } catch (err) {
      req.log.error({ err }, "Failed to create held distribution entry");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /:id ──────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;
  try {
    const [row] = await db
      .select()
      .from(heldDistributionLedgerTable)
      .where(eq(heldDistributionLedgerTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Held distribution entry not found" });
      return;
    }
    res.json(fmt(row));
  } catch (err) {
    req.log.error({ err }, "Failed to get held distribution entry");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /:id/release ─────────────────────────────────────────────────────

const releaseSchema = z.object({
  releasedAmount: z.number().positive(),
  releasedTo: z.enum(["original_partner", "dispute_settlement", "alternative_party", "forfeited"]),
  releaseNotes: z.string().min(1),
  forfeited: z.boolean().optional().default(false),
});

router.post(
  "/:id/release",
  requireRole("admin"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    const parsed = releaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    try {
      const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

      const [existing] = await db
        .select()
        .from(heldDistributionLedgerTable)
        .where(eq(heldDistributionLedgerTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Held distribution entry not found" });
        return;
      }
      if (existing.status !== "held") {
        res.status(409).json({ error: `Entry is already in '${existing.status}' status — cannot release again` });
        return;
      }

      const heldAmount = parseFloat(existing.heldAmount);
      if (b.releasedAmount > heldAmount + 0.01) {
        res.status(422).json({
          error: `Released amount (₹${b.releasedAmount}) cannot exceed held amount (₹${heldAmount.toFixed(2)})`,
        });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(heldDistributionLedgerTable)
        .set({
          status: b.forfeited ? "forfeited" : "released",
          releasedAt: now,
          releasedAmount: String(b.releasedAmount),
          releasedTo: b.releasedTo,
          releaseNotes: b.releaseNotes,
          releasedBy: actor?.id ?? null,
          releasedByName: actor?.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(heldDistributionLedgerTable.id, id))
        .returning();

      req.log.info({ id, releasedAmount: b.releasedAmount, releasedTo: b.releasedTo }, "Held distribution released");
      res.json(fmt(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to release held distribution");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
