/**
 * prematurity_succession.ts — Prematurity Death Succession Workflow
 *
 * Routes (all under /prematurity-succession):
 *
 *   GET  /dashboard                         — full dashboard summary
 *   GET  /participations                    — list participation records
 *   POST /participations                    — activate claimant participation
 *   PATCH /participations/:id               — update participation status/notes
 *   DELETE /participations/:id              — deactivate (admin only)
 *
 *   GET  /contributions                     — list contributions (filterable)
 *   POST /contributions                     — submit new contribution (pending OTP)
 *   POST /contributions/:id/request-otp     — generate + display OTP (admin/dev)
 *   POST /contributions/:id/verify-otp      — developer verifies OTP → confirmed
 *   PATCH /contributions/:id                — update notes / reject
 *
 *   GET  /accumulation                      — list disputed accumulation entries
 *   POST /accumulation                      — create accumulation entry
 *   PATCH /accumulation/:id                 — update description/notes
 *   POST /accumulation/:id/release          — release to a claimant (admin)
 *   POST /accumulation/:id/forfeit          — mark forfeited (admin)
 *
 * Design rules:
 *   - Project operations are NEVER blocked by this workflow
 *   - OTP is 6-digit numeric, generated server-side, returned in the response
 *     (admin/developer communicates it to the claimant out-of-band)
 *   - Disputed amounts accumulate; only the contested portion is held
 */

import crypto from "crypto";
import { Router } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  claimantParticipationRecordsTable,
  claimantContributionsTable,
  disputedAccumulationLedgerTable,
  inheritanceClaimsTable,
  partnerClaimantsTable,
  partnersTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────

async function resolveUser(clerkId: string) {
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkId))
    .limit(1);
  return u ?? null;
}

async function actor(req: any) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  return resolveUser(userId);
}

// ── OTP generator ─────────────────────────────────────────────────────────

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmtParticipation(
  r: typeof claimantParticipationRecordsTable.$inferSelect,
) {
  return {
    id: r.id,
    claimId: r.claimId,
    claimantId: r.claimantId,
    projectId: r.projectId,
    partnerId: r.partnerId,
    inheritedSharePct: r.inheritedSharePct,
    isContributing: r.isContributing,
    participationStatus: r.participationStatus,
    contributionActivatedAt: r.contributionActivatedAt?.toISOString() ?? null,
    activatedBy: r.activatedBy,
    activatedByName: r.activatedByName,
    notes: r.notes,
    isActive: r.isActive,
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function fmtContribution(
  c: typeof claimantContributionsTable.$inferSelect,
) {
  return {
    id: c.id,
    participationRecordId: c.participationRecordId,
    claimantId: c.claimantId,
    projectId: c.projectId,
    claimId: c.claimId,
    periodLabel: c.periodLabel,
    amount: c.amount,
    contributionType: c.contributionType,
    description: c.description,
    status: c.status,
    otpCode: c.otpCode, // returned to admin/developer only
    otpRequestedAt: c.otpRequestedAt?.toISOString() ?? null,
    otpSentAt: c.otpSentAt?.toISOString() ?? null,
    otpVerifiedAt: c.otpVerifiedAt?.toISOString() ?? null,
    otpVerifiedBy: c.otpVerifiedBy,
    otpVerifiedByName: c.otpVerifiedByName,
    rejectionReason: c.rejectionReason,
    notes: c.notes,
    submittedBy: c.submittedBy,
    submittedByName: c.submittedByName,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function fmtAccumulation(
  e: typeof disputedAccumulationLedgerTable.$inferSelect,
) {
  return {
    id: e.id,
    claimId: e.claimId,
    projectId: e.projectId,
    claimantId: e.claimantId,
    periodLabel: e.periodLabel,
    periodYear: e.periodYear,
    amount: e.amount,
    accumulationType: e.accumulationType,
    description: e.description,
    status: e.status,
    releasedToClaimantId: e.releasedToClaimantId,
    releasedToClaimantName: e.releasedToClaimantName,
    releasedAt: e.releasedAt?.toISOString() ?? null,
    releasedBy: e.releasedBy,
    releasedByName: e.releasedByName,
    releaseNotes: e.releaseNotes,
    createdBy: e.createdBy,
    createdByName: e.createdByName,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════

router.get("/dashboard", async (req, res) => {
  try {
    const { projectId, claimId } = req.query as Record<string, string>;

    // Active participations
    const partConds: any[] = [
      eq(claimantParticipationRecordsTable.isActive, true),
    ];
    if (projectId)
      partConds.push(
        eq(claimantParticipationRecordsTable.projectId, projectId),
      );
    if (claimId)
      partConds.push(eq(claimantParticipationRecordsTable.claimId, claimId));

    const participations = await db
      .select({
        rec: claimantParticipationRecordsTable,
        claimantName: partnerClaimantsTable.claimantName,
        relationship: partnerClaimantsTable.relationship,
        partnerName: partnersTable.name,
        projectName: projectsTable.name,
      })
      .from(claimantParticipationRecordsTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(
          claimantParticipationRecordsTable.claimantId,
          partnerClaimantsTable.id,
        ),
      )
      .leftJoin(
        partnersTable,
        eq(claimantParticipationRecordsTable.partnerId, partnersTable.id),
      )
      .leftJoin(
        projectsTable,
        eq(claimantParticipationRecordsTable.projectId, projectsTable.id),
      )
      .where(and(...partConds))
      .orderBy(desc(claimantParticipationRecordsTable.createdAt));

    // Pending OTP contributions
    const pendingOtpConds: any[] = [
      inArray(claimantContributionsTable.status, [
        "pending_otp",
        "otp_sent",
      ]),
    ];
    if (projectId)
      pendingOtpConds.push(
        eq(claimantContributionsTable.projectId, projectId),
      );
    if (claimId)
      pendingOtpConds.push(
        eq(claimantContributionsTable.claimId, claimId),
      );

    const pendingOtp = await db
      .select({
        contrib: claimantContributionsTable,
        claimantName: partnerClaimantsTable.claimantName,
        projectName: projectsTable.name,
      })
      .from(claimantContributionsTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(claimantContributionsTable.claimantId, partnerClaimantsTable.id),
      )
      .leftJoin(
        projectsTable,
        eq(claimantContributionsTable.projectId, projectsTable.id),
      )
      .where(and(...pendingOtpConds))
      .orderBy(desc(claimantContributionsTable.createdAt));

    // Disputed accumulation totals
    const accumConds: any[] = [
      eq(disputedAccumulationLedgerTable.status, "accumulating"),
    ];
    if (projectId)
      accumConds.push(
        eq(disputedAccumulationLedgerTable.projectId, projectId),
      );
    if (claimId)
      accumConds.push(
        eq(disputedAccumulationLedgerTable.claimId, claimId),
      );

    const accumulationRows = await db
      .select({
        entry: disputedAccumulationLedgerTable,
        claimantName: partnerClaimantsTable.claimantName,
        projectName: projectsTable.name,
      })
      .from(disputedAccumulationLedgerTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(
          disputedAccumulationLedgerTable.claimantId,
          partnerClaimantsTable.id,
        ),
      )
      .leftJoin(
        projectsTable,
        eq(disputedAccumulationLedgerTable.projectId, projectsTable.id),
      )
      .where(and(...accumConds))
      .orderBy(desc(disputedAccumulationLedgerTable.createdAt));

    const totalAccumulated = accumulationRows.reduce(
      (s, r) => s + parseFloat(r.entry.amount ?? "0"),
      0,
    );

    // Summary KPIs
    const activeCount = participations.filter(
      (p) => p.rec.participationStatus === "active",
    ).length;
    const disputedCount = participations.filter(
      (p) => p.rec.participationStatus === "disputed",
    ).length;
    const contributingCount = participations.filter(
      (p) => p.rec.isContributing,
    ).length;

    res.json({
      summary: {
        totalParticipations: participations.length,
        activeParticipations: activeCount,
        disputedParticipations: disputedCount,
        contributingClaimants: contributingCount,
        pendingOtpCount: pendingOtp.length,
        accumulatingEntries: accumulationRows.length,
        totalAccumulatedAmount: totalAccumulated,
      },
      participations: participations.map((p) => ({
        ...fmtParticipation(p.rec),
        claimantName: p.claimantName,
        relationship: p.relationship,
        partnerName: p.partnerName,
        projectName: p.projectName,
      })),
      pendingOtpContributions: pendingOtp.map((c) => ({
        ...fmtContribution(c.contrib),
        claimantName: c.claimantName,
        projectName: c.projectName,
      })),
      accumulationEntries: accumulationRows.map((e) => ({
        ...fmtAccumulation(e.entry),
        claimantName: e.claimantName,
        projectName: e.projectName,
      })),
      // Governance flags (non-blocking)
      governanceFlags: {
        hasDisputedClaimants: disputedCount > 0,
        hasPendingOtp: pendingOtp.length > 0,
        hasAccumulatedFunds: totalAccumulated > 0,
        projectOperationsBlocked: false, // ALWAYS false by design
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load prematurity succession dashboard");
    res
      .status(500)
      .json({ error: "Failed to load prematurity succession dashboard" });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PARTICIPATION RECORDS
// ══════════════════════════════════════════════════════════════════════════

router.get("/participations", async (req, res) => {
  try {
    const { projectId, claimId, status } = req.query as Record<string, string>;
    const conds: any[] = [
      eq(claimantParticipationRecordsTable.isActive, true),
    ];
    if (projectId)
      conds.push(
        eq(claimantParticipationRecordsTable.projectId, projectId),
      );
    if (claimId)
      conds.push(eq(claimantParticipationRecordsTable.claimId, claimId));
    if (status)
      conds.push(
        eq(claimantParticipationRecordsTable.participationStatus, status),
      );

    const rows = await db
      .select({
        rec: claimantParticipationRecordsTable,
        claimantName: partnerClaimantsTable.claimantName,
        relationship: partnerClaimantsTable.relationship,
        claimantStatus: partnerClaimantsTable.status,
        partnerName: partnersTable.name,
        projectName: projectsTable.name,
      })
      .from(claimantParticipationRecordsTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(
          claimantParticipationRecordsTable.claimantId,
          partnerClaimantsTable.id,
        ),
      )
      .leftJoin(
        partnersTable,
        eq(claimantParticipationRecordsTable.partnerId, partnersTable.id),
      )
      .leftJoin(
        projectsTable,
        eq(claimantParticipationRecordsTable.projectId, projectsTable.id),
      )
      .where(and(...conds))
      .orderBy(desc(claimantParticipationRecordsTable.createdAt));

    res.json({
      participations: rows.map((r) => ({
        ...fmtParticipation(r.rec),
        claimantName: r.claimantName,
        relationship: r.relationship,
        claimantStatus: r.claimantStatus,
        partnerName: r.partnerName,
        projectName: r.projectName,
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list participations");
    res.status(500).json({ error: "Failed to list participations" });
  }
});

router.post(
  "/participations",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const {
        claimId,
        claimantId,
        projectId,
        partnerId,
        inheritedSharePct,
        isContributing,
        notes,
      } = req.body as {
        claimId: string;
        claimantId: string;
        projectId: string;
        partnerId: string;
        inheritedSharePct?: number;
        isContributing?: boolean;
        notes?: string;
      };

      if (!claimId || !claimantId || !projectId || !partnerId) {
        res
          .status(400)
          .json({
            error:
              "claimId, claimantId, projectId and partnerId are required.",
          });
        return;
      }

      // Verify the inheritance claim exists and is a death claim
      const [claim] = await db
        .select()
        .from(inheritanceClaimsTable)
        .where(eq(inheritanceClaimsTable.id, claimId))
        .limit(1);
      if (!claim) {
        res.status(404).json({ error: "Inheritance claim not found." });
        return;
      }
      if (claim.claimType !== "death") {
        res
          .status(400)
          .json({
            error:
              "Prematurity succession participation is only for death claims.",
          });
        return;
      }

      const now = new Date();
      const [rec] = await db
        .insert(claimantParticipationRecordsTable)
        .values({
          claimId,
          claimantId,
          projectId,
          partnerId,
          inheritedSharePct: inheritedSharePct != null
            ? String(inheritedSharePct)
            : null,
          isContributing: isContributing ?? false,
          participationStatus: "active",
          contributionActivatedAt: isContributing ? now : null,
          activatedBy: isContributing ? (me?.id ?? null) : null,
          activatedByName: isContributing ? (me?.displayName ?? null) : null,
          notes: notes?.trim() || null,
          createdBy: me?.id ?? null,
          createdByName: me?.displayName ?? null,
        })
        .returning();

      res.status(201).json({ participation: fmtParticipation(rec) });
    } catch (err: any) {
      req.log.error({ err }, "Failed to create participation record");
      res
        .status(500)
        .json({ error: "Failed to create participation record" });
    }
  },
);

router.patch(
  "/participations/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const id = req.params.id as string;
      const {
        participationStatus,
        isContributing,
        inheritedSharePct,
        notes,
      } = req.body as {
        participationStatus?: string;
        isContributing?: boolean;
        inheritedSharePct?: number;
        notes?: string;
      };

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (participationStatus !== undefined)
        updates.participationStatus = participationStatus;
      if (notes !== undefined) updates.notes = notes?.trim() || null;
      if (inheritedSharePct !== undefined)
        updates.inheritedSharePct = String(inheritedSharePct);

      if (isContributing !== undefined) {
        updates.isContributing = isContributing;
        if (isContributing) {
          updates.contributionActivatedAt = new Date();
          updates.activatedBy = me?.id ?? null;
          updates.activatedByName = me?.displayName ?? null;
        }
      }

      const [updated] = await db
        .update(claimantParticipationRecordsTable)
        .set(updates)
        .where(eq(claimantParticipationRecordsTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Participation record not found." });
        return;
      }
      res.json({ participation: fmtParticipation(updated) });
    } catch (err) {
      req.log.error({ err }, "Failed to update participation");
      res.status(500).json({ error: "Failed to update participation" });
    }
  },
);

router.delete(
  "/participations/:id",
  requireRole("admin"),
  async (req, res) => {
    try {
      const id = req.params.id as string;
      const [updated] = await db
        .update(claimantParticipationRecordsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(claimantParticipationRecordsTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Participation record not found." });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      req.log.error({ err }, "Failed to delete participation");
      res.status(500).json({ error: "Failed to delete participation" });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════
// CONTRIBUTIONS (with OTP workflow)
// ══════════════════════════════════════════════════════════════════════════

router.get("/contributions", async (req, res) => {
  try {
    const { projectId, claimId, claimantId, status } = req.query as Record<
      string,
      string
    >;
    const conds: any[] = [];
    if (projectId)
      conds.push(eq(claimantContributionsTable.projectId, projectId));
    if (claimId) conds.push(eq(claimantContributionsTable.claimId, claimId));
    if (claimantId)
      conds.push(eq(claimantContributionsTable.claimantId, claimantId));
    if (status) conds.push(eq(claimantContributionsTable.status, status));

    const rows = await db
      .select({
        contrib: claimantContributionsTable,
        claimantName: partnerClaimantsTable.claimantName,
        projectName: projectsTable.name,
      })
      .from(claimantContributionsTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(claimantContributionsTable.claimantId, partnerClaimantsTable.id),
      )
      .leftJoin(
        projectsTable,
        eq(claimantContributionsTable.projectId, projectsTable.id),
      )
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(claimantContributionsTable.createdAt));

    res.json({
      contributions: rows.map((r) => ({
        ...fmtContribution(r.contrib),
        claimantName: r.claimantName,
        projectName: r.projectName,
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list contributions");
    res.status(500).json({ error: "Failed to list contributions" });
  }
});

router.post(
  "/contributions",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const {
        participationRecordId,
        claimantId,
        projectId,
        claimId,
        periodLabel,
        amount,
        contributionType,
        description,
        notes,
      } = req.body as {
        participationRecordId: string;
        claimantId: string;
        projectId: string;
        claimId: string;
        periodLabel: string;
        amount: number;
        contributionType?: string;
        description?: string;
        notes?: string;
      };

      if (!participationRecordId || !claimantId || !projectId || !claimId) {
        res
          .status(400)
          .json({ error: "participationRecordId, claimantId, projectId and claimId are required." });
        return;
      }
      if (!periodLabel || amount == null || amount <= 0) {
        res
          .status(400)
          .json({ error: "periodLabel and a positive amount are required." });
        return;
      }

      const [contrib] = await db
        .insert(claimantContributionsTable)
        .values({
          participationRecordId,
          claimantId,
          projectId,
          claimId,
          periodLabel: periodLabel.trim(),
          amount: String(amount),
          contributionType: contributionType ?? "cash",
          description: description?.trim() || null,
          notes: notes?.trim() || null,
          status: "pending_otp",
          submittedBy: me?.id ?? null,
          submittedByName: me?.displayName ?? null,
        })
        .returning();

      res.status(201).json({ contribution: fmtContribution(contrib) });
    } catch (err) {
      req.log.error({ err }, "Failed to submit contribution");
      res.status(500).json({ error: "Failed to submit contribution" });
    }
  },
);

// Generate OTP for developer verification
router.post(
  "/contributions/:id/request-otp",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const id = req.params.id as string;
      const [contrib] = await db
        .select()
        .from(claimantContributionsTable)
        .where(eq(claimantContributionsTable.id, id))
        .limit(1);

      if (!contrib) {
        res.status(404).json({ error: "Contribution not found." });
        return;
      }
      if (!["pending_otp", "otp_sent"].includes(contrib.status)) {
        res
          .status(400)
          .json({
            error: `Cannot request OTP for contribution with status "${contrib.status}".`,
          });
        return;
      }

      const otp = generateOtp();
      const now = new Date();

      const [updated] = await db
        .update(claimantContributionsTable)
        .set({
          status: "otp_sent",
          otpCode: otp,
          otpRequestedAt: contrib.otpRequestedAt ?? now,
          otpSentAt: now,
          updatedAt: now,
        })
        .where(eq(claimantContributionsTable.id, id))
        .returning();

      // OTP is returned in the response — admin/developer communicates it
      // to the claimant out-of-band (phone, in-person, etc.)
      res.json({
        contribution: fmtContribution(updated),
        otp, // exposed here so developer can relay it
        message: "OTP generated. Share this with the claimant for verification.",
      });
    } catch (err) {
      req.log.error({ err }, "Failed to generate OTP");
      res.status(500).json({ error: "Failed to generate OTP" });
    }
  },
);

// Developer verifies OTP (confirms the claimant's contribution)
router.post(
  "/contributions/:id/verify-otp",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const id = req.params.id as string;
      const { otpCode } = req.body as { otpCode: string };

      if (!otpCode) {
        res.status(400).json({ error: "otpCode is required." });
        return;
      }

      const [contrib] = await db
        .select()
        .from(claimantContributionsTable)
        .where(eq(claimantContributionsTable.id, id))
        .limit(1);

      if (!contrib) {
        res.status(404).json({ error: "Contribution not found." });
        return;
      }
      if (contrib.status !== "otp_sent") {
        res
          .status(400)
          .json({
            error: `Expected status "otp_sent", got "${contrib.status}".`,
          });
        return;
      }
      if (!contrib.otpCode || contrib.otpCode !== otpCode.trim()) {
        res.status(400).json({ error: "Invalid OTP code." });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(claimantContributionsTable)
        .set({
          status: "confirmed",
          otpVerifiedAt: now,
          otpVerifiedBy: me?.id ?? null,
          otpVerifiedByName: me?.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(claimantContributionsTable.id, id))
        .returning();

      res.json({
        contribution: fmtContribution(updated),
        message: "Contribution verified and confirmed.",
      });
    } catch (err) {
      req.log.error({ err }, "Failed to verify OTP");
      res.status(500).json({ error: "Failed to verify OTP" });
    }
  },
);

router.patch(
  "/contributions/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const id = req.params.id as string;
      const { notes, rejectionReason, status } = req.body as {
        notes?: string;
        rejectionReason?: string;
        status?: string;
      };

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (notes !== undefined) updates.notes = notes?.trim() || null;
      if (rejectionReason !== undefined)
        updates.rejectionReason = rejectionReason?.trim() || null;
      if (status === "rejected") {
        updates.status = "rejected";
      }

      const [updated] = await db
        .update(claimantContributionsTable)
        .set(updates)
        .where(eq(claimantContributionsTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Contribution not found." });
        return;
      }
      res.json({ contribution: fmtContribution(updated) });
    } catch (err) {
      req.log.error({ err }, "Failed to update contribution");
      res.status(500).json({ error: "Failed to update contribution" });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════
// DISPUTED ACCUMULATION LEDGER
// ══════════════════════════════════════════════════════════════════════════

router.get("/accumulation", async (req, res) => {
  try {
    const { projectId, claimId, claimantId, status } = req.query as Record<
      string,
      string
    >;
    const conds: any[] = [];
    if (projectId)
      conds.push(eq(disputedAccumulationLedgerTable.projectId, projectId));
    if (claimId)
      conds.push(eq(disputedAccumulationLedgerTable.claimId, claimId));
    if (claimantId)
      conds.push(
        eq(disputedAccumulationLedgerTable.claimantId, claimantId),
      );
    if (status)
      conds.push(eq(disputedAccumulationLedgerTable.status, status));

    const rows = await db
      .select({
        entry: disputedAccumulationLedgerTable,
        claimantName: partnerClaimantsTable.claimantName,
        projectName: projectsTable.name,
      })
      .from(disputedAccumulationLedgerTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(
          disputedAccumulationLedgerTable.claimantId,
          partnerClaimantsTable.id,
        ),
      )
      .leftJoin(
        projectsTable,
        eq(disputedAccumulationLedgerTable.projectId, projectsTable.id),
      )
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(disputedAccumulationLedgerTable.createdAt));

    const totalAccumulating = rows
      .filter((r) => r.entry.status === "accumulating")
      .reduce((s, r) => s + parseFloat(r.entry.amount ?? "0"), 0);

    res.json({
      entries: rows.map((r) => ({
        ...fmtAccumulation(r.entry),
        claimantName: r.claimantName,
        projectName: r.projectName,
      })),
      total: rows.length,
      totalAccumulatingAmount: totalAccumulating,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list accumulation entries");
    res.status(500).json({ error: "Failed to list accumulation entries" });
  }
});

router.post(
  "/accumulation",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const {
        claimId,
        projectId,
        claimantId,
        periodLabel,
        periodYear,
        amount,
        accumulationType,
        description,
      } = req.body as {
        claimId: string;
        projectId: string;
        claimantId?: string;
        periodLabel: string;
        periodYear?: number;
        amount: number;
        accumulationType?: string;
        description?: string;
      };

      if (!claimId || !projectId || !periodLabel || amount == null || amount <= 0) {
        res
          .status(400)
          .json({
            error:
              "claimId, projectId, periodLabel and a positive amount are required.",
          });
        return;
      }

      const [entry] = await db
        .insert(disputedAccumulationLedgerTable)
        .values({
          claimId,
          projectId,
          claimantId: claimantId || null,
          periodLabel: periodLabel.trim(),
          periodYear: periodYear ?? null,
          amount: String(amount),
          accumulationType: accumulationType ?? "other",
          description: description?.trim() || null,
          status: "accumulating",
          createdBy: me?.id ?? null,
          createdByName: me?.displayName ?? null,
        })
        .returning();

      res.status(201).json({ entry: fmtAccumulation(entry) });
    } catch (err) {
      req.log.error({ err }, "Failed to create accumulation entry");
      res
        .status(500)
        .json({ error: "Failed to create accumulation entry" });
    }
  },
);

router.patch(
  "/accumulation/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const id = req.params.id as string;
      const { description, amount } = req.body as {
        description?: string;
        amount?: number;
      };

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (description !== undefined)
        updates.description = description?.trim() || null;
      if (amount !== undefined) updates.amount = String(amount);

      const [updated] = await db
        .update(disputedAccumulationLedgerTable)
        .set(updates)
        .where(eq(disputedAccumulationLedgerTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Accumulation entry not found." });
        return;
      }
      res.json({ entry: fmtAccumulation(updated) });
    } catch (err) {
      req.log.error({ err }, "Failed to update accumulation entry");
      res.status(500).json({ error: "Failed to update accumulation entry" });
    }
  },
);

// Release accumulated amount to a claimant after dispute resolution
router.post(
  "/accumulation/:id/release",
  requireRole("admin"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const id = req.params.id as string;
      const { releasedToClaimantId, releasedToClaimantName, releaseNotes } =
        req.body as {
          releasedToClaimantId?: string;
          releasedToClaimantName?: string;
          releaseNotes?: string;
        };

      const [entry] = await db
        .select()
        .from(disputedAccumulationLedgerTable)
        .where(eq(disputedAccumulationLedgerTable.id, id))
        .limit(1);

      if (!entry) {
        res.status(404).json({ error: "Accumulation entry not found." });
        return;
      }
      if (entry.status !== "accumulating") {
        res
          .status(400)
          .json({
            error: `Entry is already "${entry.status}", not accumulating.`,
          });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(disputedAccumulationLedgerTable)
        .set({
          status: "released",
          releasedToClaimantId: releasedToClaimantId || null,
          releasedToClaimantName: releasedToClaimantName?.trim() || null,
          releasedAt: now,
          releasedBy: me?.id ?? null,
          releasedByName: me?.displayName ?? null,
          releaseNotes: releaseNotes?.trim() || null,
          updatedAt: now,
        })
        .where(eq(disputedAccumulationLedgerTable.id, id))
        .returning();

      res.json({ entry: fmtAccumulation(updated) });
    } catch (err) {
      req.log.error({ err }, "Failed to release accumulation entry");
      res.status(500).json({ error: "Failed to release accumulation entry" });
    }
  },
);

// Forfeit (tribal council / court decision)
router.post(
  "/accumulation/:id/forfeit",
  requireRole("admin"),
  async (req, res) => {
    try {
      const me = await actor(req);
      const id = req.params.id as string;
      const { releaseNotes } = req.body as { releaseNotes?: string };

      const [entry] = await db
        .select()
        .from(disputedAccumulationLedgerTable)
        .where(eq(disputedAccumulationLedgerTable.id, id))
        .limit(1);

      if (!entry) {
        res.status(404).json({ error: "Accumulation entry not found." });
        return;
      }
      if (entry.status !== "accumulating") {
        res
          .status(400)
          .json({
            error: `Entry is already "${entry.status}".`,
          });
        return;
      }

      const [updated] = await db
        .update(disputedAccumulationLedgerTable)
        .set({
          status: "forfeited",
          releasedAt: new Date(),
          releasedBy: me?.id ?? null,
          releasedByName: me?.displayName ?? null,
          releaseNotes: releaseNotes?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(disputedAccumulationLedgerTable.id, id))
        .returning();

      res.json({ entry: fmtAccumulation(updated) });
    } catch (err) {
      req.log.error({ err }, "Failed to forfeit accumulation entry");
      res.status(500).json({ error: "Failed to forfeit accumulation entry" });
    }
  },
);

export default router;
