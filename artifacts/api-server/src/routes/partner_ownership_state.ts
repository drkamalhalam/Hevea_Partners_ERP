/**
 * partner_ownership_state.ts
 *
 * Endpoints for managing per-(project, partner) ownership state:
 *   GET  /:projectId/partner-ownership-states        — list all states for a project
 *   GET  /:projectId/partner-ownership-states/:partnerId — get a single partner's state
 *   POST /:projectId/partner-ownership-states/upsert — create or update state record
 *   POST /:projectId/partner-ownership-states/:partnerId/dispute  — mark % as disputed
 *   POST /:projectId/partner-ownership-states/:partnerId/resolve-dispute — resolve dispute
 *   POST /:projectId/partner-ownership-states/:partnerId/lock    — lock %
 *   POST /:projectId/partner-ownership-states/:partnerId/unlock  — unlock %
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  partnerOwnershipStatesTable,
  partnersTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { logDispute, DT } from "../lib/disputeLogger";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0] ?? null;
}

function fmt(s: typeof partnerOwnershipStatesTable.$inferSelect) {
  return {
    id: s.id,
    projectId: s.projectId,
    partnerId: s.partnerId,
    partnerName: s.partnerName,
    totalPercentage: s.totalPercentage,
    transferablePercentage: s.transferablePercentage,
    lockedPercentage: s.lockedPercentage,
    disputedPercentage: s.disputedPercentage,
    reservedPercentage: s.reservedPercentage,
    disputeReason: s.disputeReason ?? null,
    disputedSince: s.disputedSince?.toISOString() ?? null,
    disputeReference: s.disputeReference ?? null,
    lockReason: s.lockReason ?? null,
    lockedSince: s.lockedSince?.toISOString() ?? null,
    notes: s.notes ?? null,
    updatedByName: s.updatedByName ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ── GET /:projectId/partner-ownership-states ──────────────────────────────

router.get("/:projectId/partner-ownership-states", async (req, res) => {
  const projectId = req.params.projectId as string;
  try {
    const rows = await db
      .select()
      .from(partnerOwnershipStatesTable)
      .where(eq(partnerOwnershipStatesTable.projectId, projectId));
    res.json(rows.map(fmt));
  } catch (err) {
    req.log.error({ err }, "Failed to list partner ownership states");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /:projectId/partner-ownership-states/:partnerId ───────────────────

router.get("/:projectId/partner-ownership-states/:partnerId", async (req, res) => {
  const { projectId, partnerId } = req.params as { projectId: string; partnerId: string };
  try {
    const [row] = await db
      .select()
      .from(partnerOwnershipStatesTable)
      .where(
        and(
          eq(partnerOwnershipStatesTable.projectId, projectId),
          eq(partnerOwnershipStatesTable.partnerId, partnerId),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Ownership state record not found for this partner/project" });
      return;
    }
    res.json(fmt(row));
  } catch (err) {
    req.log.error({ err }, "Failed to get partner ownership state");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /:projectId/partner-ownership-states/upsert ─────────────────────

const upsertSchema = z.object({
  partnerId: z.string().uuid(),
  totalPercentage: z.number().min(0).max(100),
  transferablePercentage: z.number().min(0).max(100),
  lockedPercentage: z.number().min(0).max(100).default(0),
  disputedPercentage: z.number().min(0).max(100).default(0),
  reservedPercentage: z.number().min(0).max(100).default(0),
  notes: z.string().optional().nullable(),
});

router.post(
  "/:projectId/partner-ownership-states/upsert",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = req.params.projectId as string;
    const { userId: clerkUserId } = getAuth(req);
    const parsed = upsertSchema.safeParse(req.body);
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
        .where(eq(projectsTable.id, projectId))
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

      // Validate sum
      const sum = b.transferablePercentage + b.lockedPercentage + b.disputedPercentage + b.reservedPercentage;
      if (Math.abs(sum - b.totalPercentage) > 0.0001) {
        res.status(422).json({
          error: `State percentages must sum to totalPercentage. Got ${sum.toFixed(8)}, expected ${b.totalPercentage.toFixed(8)}`,
        });
        return;
      }

      // Check for existing record
      const [existing] = await db
        .select({ id: partnerOwnershipStatesTable.id })
        .from(partnerOwnershipStatesTable)
        .where(
          and(
            eq(partnerOwnershipStatesTable.projectId, projectId),
            eq(partnerOwnershipStatesTable.partnerId, b.partnerId),
          ),
        )
        .limit(1);

      const now = new Date();
      if (existing) {
        const [updated] = await db
          .update(partnerOwnershipStatesTable)
          .set({
            totalPercentage: String(b.totalPercentage),
            transferablePercentage: String(b.transferablePercentage),
            lockedPercentage: String(b.lockedPercentage),
            disputedPercentage: String(b.disputedPercentage),
            reservedPercentage: String(b.reservedPercentage),
            notes: b.notes ?? null,
            updatedBy: actor?.id ?? null,
            updatedByName: actor?.displayName ?? null,
            updatedAt: now,
          })
          .where(eq(partnerOwnershipStatesTable.id, existing.id))
          .returning();
        res.json(fmt(updated));
      } else {
        const [created] = await db
          .insert(partnerOwnershipStatesTable)
          .values({
            projectId,
            partnerId: b.partnerId,
            partnerName: partner.name,
            totalPercentage: String(b.totalPercentage),
            transferablePercentage: String(b.transferablePercentage),
            lockedPercentage: String(b.lockedPercentage),
            disputedPercentage: String(b.disputedPercentage),
            reservedPercentage: String(b.reservedPercentage),
            notes: b.notes ?? null,
            updatedBy: actor?.id ?? null,
            updatedByName: actor?.displayName ?? null,
          })
          .returning();
        res.status(201).json(fmt(created));
      }
    } catch (err) {
      req.log.error({ err }, "Failed to upsert partner ownership state");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /:projectId/partner-ownership-states/:partnerId/dispute ──────────

const disputeSchema = z.object({
  disputedPercentage: z.number().min(0.00000001).max(100),
  disputeReason: z.string().min(1),
  disputeReference: z.string().optional().nullable(),
});

router.post(
  "/:projectId/partner-ownership-states/:partnerId/dispute",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { projectId, partnerId } = req.params as { projectId: string; partnerId: string };
    const { userId: clerkUserId } = getAuth(req);
    const parsed = disputeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    try {
      const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

      const [existing] = await db
        .select()
        .from(partnerOwnershipStatesTable)
        .where(
          and(
            eq(partnerOwnershipStatesTable.projectId, projectId),
            eq(partnerOwnershipStatesTable.partnerId, partnerId),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Ownership state not found — run upsert first to initialise the record" });
        return;
      }

      const currentTransferable = parseFloat(existing.transferablePercentage);
      if (b.disputedPercentage > currentTransferable + 0.000001) {
        res.status(422).json({
          error: `Cannot dispute ${b.disputedPercentage}% — only ${currentTransferable.toFixed(8)}% is currently transferable`,
        });
        return;
      }

      const newTransferable = currentTransferable - b.disputedPercentage;
      const newDisputed = parseFloat(existing.disputedPercentage) + b.disputedPercentage;
      const now = new Date();

      const [updated] = await db
        .update(partnerOwnershipStatesTable)
        .set({
          transferablePercentage: String(newTransferable),
          disputedPercentage: String(newDisputed),
          disputeReason: b.disputeReason,
          disputedSince: now,
          disputeReference: b.disputeReference ?? null,
          updatedBy: actor?.id ?? null,
          updatedByName: actor?.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(partnerOwnershipStatesTable.id, existing.id))
        .returning();

      void logDispute(req, {
        projectId,
        disputeType: DT.OWNERSHIP,
        severity: "high",
        title: `Ownership percentage disputed — ${b.disputedPercentage}%`,
        description: b.disputeReason,
        relatedTable: "partner_ownership_states",
        relatedRecordId: existing.id,
        metadata: {
          partnerId,
          disputedPercentage: b.disputedPercentage,
          disputeReference: b.disputeReference ?? null,
          previousTransferable: existing.transferablePercentage,
        },
        actor: actor ? { id: actor.id, name: actor.displayName ?? null, role: actor.role } : null,
      });

      req.log.info({ projectId, partnerId, disputedPercentage: b.disputedPercentage }, "Ownership marked as disputed");
      res.json(fmt(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to mark ownership as disputed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /:projectId/partner-ownership-states/:partnerId/resolve-dispute ──

const resolveDisputeSchema = z.object({
  releasedPercentage: z.number().min(0.00000001).max(100),
  resolution: z.string().min(1),
});

router.post(
  "/:projectId/partner-ownership-states/:partnerId/resolve-dispute",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { projectId, partnerId } = req.params as { projectId: string; partnerId: string };
    const { userId: clerkUserId } = getAuth(req);
    const parsed = resolveDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    try {
      const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

      const [existing] = await db
        .select()
        .from(partnerOwnershipStatesTable)
        .where(
          and(
            eq(partnerOwnershipStatesTable.projectId, projectId),
            eq(partnerOwnershipStatesTable.partnerId, partnerId),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Ownership state not found" });
        return;
      }

      const currentDisputed = parseFloat(existing.disputedPercentage);
      if (b.releasedPercentage > currentDisputed + 0.000001) {
        res.status(422).json({
          error: `Cannot release ${b.releasedPercentage}% — only ${currentDisputed.toFixed(8)}% is disputed`,
        });
        return;
      }

      const newDisputed = currentDisputed - b.releasedPercentage;
      const newTransferable = parseFloat(existing.transferablePercentage) + b.releasedPercentage;
      const now = new Date();

      const [updated] = await db
        .update(partnerOwnershipStatesTable)
        .set({
          transferablePercentage: String(newTransferable),
          disputedPercentage: String(newDisputed),
          disputeReason: newDisputed < 0.000001 ? null : existing.disputeReason,
          disputedSince: newDisputed < 0.000001 ? null : existing.disputedSince,
          disputeReference: newDisputed < 0.000001 ? null : existing.disputeReference,
          notes: b.resolution,
          updatedBy: actor?.id ?? null,
          updatedByName: actor?.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(partnerOwnershipStatesTable.id, existing.id))
        .returning();

      req.log.info({ projectId, partnerId, releasedPercentage: b.releasedPercentage }, "Ownership dispute resolved");
      res.json(fmt(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to resolve dispute");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /:projectId/partner-ownership-states/:partnerId/lock ─────────────

const lockSchema = z.object({
  lockPercentage: z.number().min(0.00000001).max(100),
  lockReason: z.string().min(1),
});

router.post(
  "/:projectId/partner-ownership-states/:partnerId/lock",
  requireRole("admin"),
  async (req, res) => {
    const { projectId, partnerId } = req.params as { projectId: string; partnerId: string };
    const { userId: clerkUserId } = getAuth(req);
    const parsed = lockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    try {
      const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

      const [existing] = await db
        .select()
        .from(partnerOwnershipStatesTable)
        .where(
          and(
            eq(partnerOwnershipStatesTable.projectId, projectId),
            eq(partnerOwnershipStatesTable.partnerId, partnerId),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Ownership state not found — run upsert first" });
        return;
      }

      const currentTransferable = parseFloat(existing.transferablePercentage);
      if (b.lockPercentage > currentTransferable + 0.000001) {
        res.status(422).json({
          error: `Cannot lock ${b.lockPercentage}% — only ${currentTransferable.toFixed(8)}% is transferable`,
        });
        return;
      }

      const newTransferable = currentTransferable - b.lockPercentage;
      const newLocked = parseFloat(existing.lockedPercentage) + b.lockPercentage;
      const now = new Date();

      const [updated] = await db
        .update(partnerOwnershipStatesTable)
        .set({
          transferablePercentage: String(newTransferable),
          lockedPercentage: String(newLocked),
          lockReason: b.lockReason,
          lockedSince: now,
          updatedBy: actor?.id ?? null,
          updatedByName: actor?.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(partnerOwnershipStatesTable.id, existing.id))
        .returning();

      req.log.info({ projectId, partnerId, lockPercentage: b.lockPercentage }, "Ownership locked");
      res.json(fmt(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to lock ownership");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /:projectId/partner-ownership-states/:partnerId/unlock ───────────

const unlockSchema = z.object({
  unlockPercentage: z.number().min(0.00000001).max(100),
  reason: z.string().min(1),
});

router.post(
  "/:projectId/partner-ownership-states/:partnerId/unlock",
  requireRole("admin"),
  async (req, res) => {
    const { projectId, partnerId } = req.params as { projectId: string; partnerId: string };
    const { userId: clerkUserId } = getAuth(req);
    const parsed = unlockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    try {
      const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

      const [existing] = await db
        .select()
        .from(partnerOwnershipStatesTable)
        .where(
          and(
            eq(partnerOwnershipStatesTable.projectId, projectId),
            eq(partnerOwnershipStatesTable.partnerId, partnerId),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Ownership state not found" });
        return;
      }

      const currentLocked = parseFloat(existing.lockedPercentage);
      if (b.unlockPercentage > currentLocked + 0.000001) {
        res.status(422).json({
          error: `Cannot unlock ${b.unlockPercentage}% — only ${currentLocked.toFixed(8)}% is locked`,
        });
        return;
      }

      const newLocked = currentLocked - b.unlockPercentage;
      const newTransferable = parseFloat(existing.transferablePercentage) + b.unlockPercentage;
      const now = new Date();

      const [updated] = await db
        .update(partnerOwnershipStatesTable)
        .set({
          transferablePercentage: String(newTransferable),
          lockedPercentage: String(newLocked),
          lockReason: newLocked < 0.000001 ? null : existing.lockReason,
          lockedSince: newLocked < 0.000001 ? null : existing.lockedSince,
          notes: b.reason,
          updatedBy: actor?.id ?? null,
          updatedByName: actor?.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(partnerOwnershipStatesTable.id, existing.id))
        .returning();

      req.log.info({ projectId, partnerId, unlockPercentage: b.unlockPercentage }, "Ownership unlocked");
      res.json(fmt(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to unlock ownership");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
