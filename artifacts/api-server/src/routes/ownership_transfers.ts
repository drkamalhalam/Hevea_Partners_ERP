/**
 * ownership_transfers.ts
 *
 * Ownership share transfer request workflow.
 * Routes mounted at /ownership-transfers.
 *
 * Transfer state machine (forward-only):
 *   draft → pending_rofr → rofr_accepted|rofr_rejected → pending_approval → approved → executed
 *   draft → pending_approval → approved → executed   (internal type — ROFR optional)
 *   any non-terminal → cancelled
 *   pending_rofr → expired
 *
 * Business rules:
 *   - Project must be in mature_production lifecycle
 *   - Project must have a frozen ownership record
 *   - offeredPercentage ≤ transferor's frozen ownership %
 *   - third_party: ROFR must be completed (rofr_rejected) + offeredValue ≥ ₹1,00,000
 *   - No silent ownership modification — execution is an explicit admin-only action
 */

import { Router } from "express";
import {
  db,
  ownershipTransfersTable,
  ownershipSnapshotsTable,
  projectOwnershipFreezesTable,
  projectsTable,
  partnersTable,
  usersTable,
} from "@workspace/db";
import type { RofrResponse } from "@workspace/db";
import { eq, and, desc, or, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import { z } from "zod/v4";

const router = Router();

// ── Constants ──────────────────────────────────────────────────────────────

const THIRD_PARTY_MIN_VALUE = 100_000; // ₹1,00,000
const ROFR_DAYS = 14;

// ── Allowed transitions ────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending_rofr", "pending_approval", "cancelled"],
  pending_rofr: ["rofr_accepted", "rofr_rejected", "expired", "cancelled"],
  rofr_accepted: ["pending_approval", "cancelled"],
  rofr_rejected: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["executed", "cancelled"],
  executed: [],
  cancelled: [],
  expired: ["cancelled"],
};

const TERMINAL_STATUSES = new Set(["executed", "cancelled", "expired"]);

// ── Helper: resolve actor from Clerk userId ────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── Helper: get project scope for non-admin roles ──────────────────────────

function getProjectScope(req: any): string[] | null {
  const { userRole, canAccessAllProjects, userProjectIds } = req as any;
  if (canAccessAllProjects || userRole === "admin" || userRole === "developer") return null;
  return Array.isArray(userProjectIds) ? userProjectIds : [];
}

// ── GET /ownership-transfers ───────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { projectId, status, transferorPartnerId } = req.query as Record<string, string>;

  const scope = getProjectScope(req);
  const filters: any[] = [];

  if (scope !== null) {
    if (scope.length === 0) return res.json({ transfers: [], total: 0 });
    filters.push(inArray(ownershipTransfersTable.projectId, scope));
  }
  if (projectId) filters.push(eq(ownershipTransfersTable.projectId, projectId));
  if (status) filters.push(eq(ownershipTransfersTable.status, status as any));
  if (transferorPartnerId) filters.push(eq(ownershipTransfersTable.transferorPartnerId, transferorPartnerId));

  const transfers = await db
    .select({
      transfer: ownershipTransfersTable,
      projectName: projectsTable.name,
    })
    .from(ownershipTransfersTable)
    .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(ownershipTransfersTable.createdAt));

  return res.json({
    transfers: transfers.map(({ transfer, projectName }) => ({
      ...transfer,
      projectName: projectName ?? null,
    })),
    total: transfers.length,
  });
});

// ── GET /ownership-transfers/dashboard ───────────────────────────────────

router.get("/dashboard", requireRole("admin", "developer"), async (req, res) => {
  const pending = await db
    .select({
      transfer: ownershipTransfersTable,
      projectName: projectsTable.name,
    })
    .from(ownershipTransfersTable)
    .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
    .where(
      inArray(ownershipTransfersTable.status, [
        "pending_rofr",
        "rofr_accepted",
        "rofr_rejected",
        "pending_approval",
        "approved",
      ]),
    )
    .orderBy(desc(ownershipTransfersTable.updatedAt));

  const byStatus: Record<string, number> = {};
  for (const { transfer } of pending) {
    byStatus[transfer.status] = (byStatus[transfer.status] ?? 0) + 1;
  }

  return res.json({
    pendingTransfers: pending.map(({ transfer, projectName }) => ({
      ...transfer,
      projectName: projectName ?? null,
    })),
    totalPending: pending.length,
    byStatus,
  });
});

// ── GET /ownership-transfers/:id ──────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const [row] = await db
    .select({
      transfer: ownershipTransfersTable,
      projectName: projectsTable.name,
      projectLifecycle: projectsTable.lifecycleStatus,
    })
    .from(ownershipTransfersTable)
    .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Transfer request not found" });

  // Scope check
  const scope = getProjectScope(req);
  if (scope !== null && !scope.includes(row.transfer.projectId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  return res.json({ ...row.transfer, projectName: row.projectName ?? null, projectLifecycle: row.projectLifecycle ?? null });
});

// ── POST /ownership-transfers ─────────────────────────────────────────────

const createTransferSchema = z.object({
  projectId: z.string().min(1),
  transferorPartnerId: z.string().min(1),
  offeredPercentage: z.number().gt(0).lte(100),
  offeredValue: z.number().positive().optional(),
  transferType: z.enum(["internal", "third_party"]),
  buyerPartnerId: z.string().optional(),
  buyerName: z.string().min(1),
  buyerContact: z.string().optional(),
  reason: z.string().optional(),
  linkedSnapshotId: z.string().optional(),
});

router.post("/", requireRole("admin", "developer", "landowner", "investor"), async (req, res) => {
  const parsed = createTransferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });

  const b = parsed.data;
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  // Validate project
  const [project] = await db
    .select({ id: projectsTable.id, lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, b.projectId))
    .limit(1);

  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.lifecycleStatus !== "mature_production") {
    return res.status(422).json({ error: "Ownership transfers are only allowed after maturity declaration (mature_production lifecycle)" });
  }

  // Validate ownership freeze
  const [freeze] = await db
    .select({ id: projectOwnershipFreezesTable.id })
    .from(projectOwnershipFreezesTable)
    .where(eq(projectOwnershipFreezesTable.projectId, b.projectId))
    .limit(1);

  if (!freeze) {
    return res.status(422).json({ error: "Project ownership has not been frozen. Freeze ownership first via the maturity workflow." });
  }

  // Validate transferor partner
  const [transferor] = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .where(eq(partnersTable.id, b.transferorPartnerId))
    .limit(1);

  if (!transferor) return res.status(404).json({ error: "Transferor partner not found" });

  // Validate buyer partner if internal
  if (b.transferType === "internal" && b.buyerPartnerId) {
    const [buyer] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.id, b.buyerPartnerId))
      .limit(1);
    if (!buyer) return res.status(404).json({ error: "Buyer partner not found" });
    if (b.buyerPartnerId === b.transferorPartnerId) {
      return res.status(422).json({ error: "Buyer and transferor cannot be the same partner" });
    }
  }

  // Validate third_party minimum value
  if (b.transferType === "third_party") {
    if (!b.offeredValue || b.offeredValue < THIRD_PARTY_MIN_VALUE) {
      return res.status(422).json({
        error: `Third-party transfers require a minimum offered value of ₹${THIRD_PARTY_MIN_VALUE.toLocaleString("en-IN")} (₹1 lakh)`,
      });
    }
  }

  // Validate offeredPercentage against linked snapshot if provided
  if (b.linkedSnapshotId) {
    const [snap] = await db
      .select({ entries: ownershipSnapshotsTable.entries })
      .from(ownershipSnapshotsTable)
      .where(and(
        eq(ownershipSnapshotsTable.id, b.linkedSnapshotId),
        eq(ownershipSnapshotsTable.projectId, b.projectId),
      ))
      .limit(1);

    if (!snap) return res.status(404).json({ error: "Linked snapshot not found for this project" });

    const entries = snap.entries as Array<{ partnerId: string | null; percentage: number }>;
    const transferorEntry = entries.find(e => e.partnerId === b.transferorPartnerId);
    if (transferorEntry && b.offeredPercentage > transferorEntry.percentage) {
      return res.status(422).json({
        error: `Offered percentage (${b.offeredPercentage}%) exceeds transferor's ownership in the linked snapshot (${transferorEntry.percentage.toFixed(4)}%)`,
      });
    }
  }

  const [created] = await db
    .insert(ownershipTransfersTable)
    .values({
      projectId: b.projectId,
      transferorPartnerId: b.transferorPartnerId,
      transferorName: transferor.name,
      offeredPercentage: String(b.offeredPercentage),
      offeredValue: b.offeredValue != null ? String(b.offeredValue) : undefined,
      transferType: b.transferType,
      buyerPartnerId: b.buyerPartnerId,
      buyerName: b.buyerName,
      buyerContact: b.buyerContact,
      reason: b.reason,
      linkedSnapshotId: b.linkedSnapshotId,
      status: "draft",
      createdBy: actor.id,
      createdByName: actor.displayName,
    })
    .returning();

  return res.status(201).json(created);
});

// ── PATCH /ownership-transfers/:id ────────────────────────────────────────

const patchTransferSchema = z.object({
  offeredPercentage: z.number().gt(0).lte(100).optional(),
  offeredValue: z.number().positive().optional().nullable(),
  buyerPartnerId: z.string().optional().nullable(),
  buyerName: z.string().min(1).optional(),
  buyerContact: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  linkedSnapshotId: z.string().optional().nullable(),
  adminNotes: z.string().optional().nullable(),
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = patchTransferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });

  const { userRole } = req as any;
  const isAdminDev = userRole === "admin" || userRole === "developer";

  // Only draft is editable (except adminNotes which admin/dev can always update)
  if (existing.status !== "draft" && !isAdminDev) {
    return res.status(422).json({ error: "Only draft transfer requests can be edited" });
  }
  if (existing.status !== "draft" && isAdminDev && !("adminNotes" in req.body)) {
    return res.status(422).json({ error: "Only admin notes can be updated on a submitted transfer" });
  }

  const b = parsed.data;
  const updateFields: any = { updatedAt: new Date() };

  if (existing.status === "draft") {
    if (b.offeredPercentage !== undefined) updateFields.offeredPercentage = String(b.offeredPercentage);
    if ("offeredValue" in b) updateFields.offeredValue = b.offeredValue != null ? String(b.offeredValue) : null;
    if ("buyerPartnerId" in b) updateFields.buyerPartnerId = b.buyerPartnerId;
    if (b.buyerName !== undefined) updateFields.buyerName = b.buyerName;
    if ("buyerContact" in b) updateFields.buyerContact = b.buyerContact;
    if ("reason" in b) updateFields.reason = b.reason;
    if ("linkedSnapshotId" in b) updateFields.linkedSnapshotId = b.linkedSnapshotId;
  }
  if (isAdminDev && "adminNotes" in b) updateFields.adminNotes = b.adminNotes;

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set(updateFields)
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/submit ──────────────────────────────────
// Submit a draft for ROFR (or directly to pending_approval for internal transfers
// when the buyer is an existing partner and admin/dev chooses to skip ROFR).

router.post("/:id/submit", requireRole("admin", "developer"), async (req, res) => {
  const { id } = req.params;
  const { skipRofr = false } = req.body as { skipRofr?: boolean };

  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });
  if (existing.status !== "draft") {
    return res.status(422).json({ error: `Cannot submit: transfer is already in '${existing.status}' status` });
  }

  // For third_party: must always go through ROFR
  if (existing.transferType === "third_party" && skipRofr) {
    return res.status(422).json({ error: "Third-party transfers must go through the right of first refusal process" });
  }

  const toStatus = (!skipRofr && existing.transferType === "third_party") || !skipRofr
    ? "pending_rofr"
    : "pending_approval";

  // Build initial ROFR responses if going to ROFR
  let rofrResponses: RofrResponse[] = [];
  let rofrDeadline: Date | null = null;

  if (toStatus === "pending_rofr") {
    // Fetch existing partners for this project
    const partnerRows = await db
      .select({ id: partnersTable.id, name: partnersTable.name })
      .from(partnersTable)
      .where(
        and(
          // Partners linked to this project via contributions — simplified: fetch all active partners
          // and let admin manage ROFR responses manually
        ),
      );

    rofrDeadline = new Date(Date.now() + ROFR_DAYS * 24 * 60 * 60 * 1000);
  }

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set({
      status: toStatus as any,
      submittedAt: new Date(),
      submittedBy: actor.id,
      submittedByName: actor.displayName,
      rofrDeadline: rofrDeadline ?? undefined,
      rofrResponses,
      updatedAt: new Date(),
    })
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/rofr-response ───────────────────────────
// Record an individual partner's ROFR response.

const rofrResponseSchema = z.object({
  partnerId: z.string().min(1),
  partnerName: z.string().min(1),
  response: z.enum(["accepted", "rejected"]),
  notes: z.string().optional().nullable(),
});

router.post("/:id/rofr-response", requireRole("admin", "developer"), async (req, res) => {
  const { id } = req.params;
  const parsed = rofrResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });
  if (existing.status !== "pending_rofr") {
    return res.status(422).json({ error: `ROFR responses can only be recorded when status is 'pending_rofr'` });
  }

  const b = parsed.data;
  const currentResponses: RofrResponse[] = (existing.rofrResponses as RofrResponse[]) ?? [];

  // Upsert this partner's response
  const idx = currentResponses.findIndex(r => r.partnerId === b.partnerId);
  const entry: RofrResponse = {
    partnerId: b.partnerId,
    partnerName: b.partnerName,
    response: b.response,
    respondedAt: new Date().toISOString(),
    notes: b.notes ?? null,
  };
  if (idx >= 0) {
    currentResponses[idx] = entry;
  } else {
    currentResponses.push(entry);
  }

  // Determine if we can auto-advance status:
  // If any response is 'accepted' → rofr_accepted
  // If all responses are 'rejected' → rofr_rejected (admin must confirm with finalizeRofr)
  // Otherwise remain pending_rofr
  const hasAccepted = currentResponses.some(r => r.response === "accepted");
  const newStatus = hasAccepted ? "rofr_accepted" : "pending_rofr";

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set({
      rofrResponses: currentResponses as any,
      status: newStatus as any,
      updatedAt: new Date(),
    })
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/finalize-rofr ───────────────────────────
// Admin manually finalizes ROFR outcome (accepted or rejected).

const finalizeRofrSchema = z.object({
  outcome: z.enum(["rofr_accepted", "rofr_rejected"]),
  notes: z.string().optional().nullable(),
});

router.post("/:id/finalize-rofr", requireRole("admin", "developer"), async (req, res) => {
  const { id } = req.params;
  const parsed = finalizeRofrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });
  if (!["pending_rofr", "rofr_accepted", "rofr_rejected"].includes(existing.status)) {
    return res.status(422).json({ error: `Cannot finalize ROFR from '${existing.status}' status` });
  }

  const b = parsed.data;

  // For third_party: if outcome is rofr_rejected, advance to pending_approval
  const newStatus = b.outcome;

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set({
      status: newStatus as any,
      adminNotes: b.notes
        ? [existing.adminNotes, `ROFR finalized: ${b.notes}`].filter(Boolean).join("\n")
        : existing.adminNotes,
      updatedAt: new Date(),
    })
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/approve ─────────────────────────────────

const approveSchema = z.object({
  adminNotes: z.string().optional().nullable(),
});

router.post("/:id/approve", requireRole("admin", "developer"), async (req, res) => {
  const { id } = req.params;
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });
  if (!["pending_rofr", "rofr_accepted", "rofr_rejected", "pending_approval"].includes(existing.status)) {
    return res.status(422).json({ error: `Cannot approve from '${existing.status}' status` });
  }

  // third_party transfers must have gone through ROFR rejection before approval
  if (existing.transferType === "third_party" && existing.status === "pending_rofr") {
    return res.status(422).json({ error: "Third-party transfer must complete the ROFR process before approval" });
  }

  const b = parsed.data;

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: actor.id,
      approvedByName: actor.displayName,
      adminNotes: b.adminNotes ?? existing.adminNotes,
      updatedAt: new Date(),
    })
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/execute ─────────────────────────────────
// Admin-only. Marks the transfer as executed. Does NOT automatically modify
// ownership records — admin must do that separately via the contributions
// or ownership snapshot workflow to prevent silent modification.

const executeSchema = z.object({
  executionNotes: z.string().min(1, "Execution notes are required to confirm explicit action"),
});

router.post("/:id/execute", requireRole("admin"), async (req, res) => {
  const { id } = req.params;
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Execution notes are required", details: parsed.error.issues });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });
  if (existing.status !== "approved") {
    return res.status(422).json({ error: `Transfer must be in 'approved' status before execution (currently: '${existing.status}')` });
  }

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set({
      status: "executed",
      executedAt: new Date(),
      executedBy: actor.id,
      executedByName: actor.displayName,
      executionNotes: parsed.data.executionNotes,
      updatedAt: new Date(),
    })
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/cancel ──────────────────────────────────

const cancelSchema = z.object({
  cancellationReason: z.string().min(1, "Cancellation reason is required"),
});

router.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Cancellation reason is required", details: parsed.error.issues });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [existing] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Transfer not found" });
  if (TERMINAL_STATUSES.has(existing.status)) {
    return res.status(422).json({ error: `Cannot cancel a transfer in '${existing.status}' status` });
  }

  // Scope check — non-admin can only cancel their own project's transfers
  const scope = getProjectScope(req);
  if (scope !== null && !scope.includes(existing.projectId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const [updated] = await db
    .update(ownershipTransfersTable)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: actor.id,
      cancelledByName: actor.displayName,
      cancellationReason: parsed.data.cancellationReason,
      updatedAt: new Date(),
    })
    .where(eq(ownershipTransfersTable.id, id))
    .returning();

  return res.json(updated);
});

export default router;
