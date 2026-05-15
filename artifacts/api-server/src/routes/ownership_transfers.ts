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
  transferRofrOffersTable,
  transferOtpEventsTable,
  transferAuditEventsTable,
} from "@workspace/db";
import { writeAudit as writeCentralAudit } from "../lib/auditLogger";
import { writeTimeline, TL } from "../lib/timelineLogger";
import type { RofrResponse } from "@workspace/db";
import { eq, and, desc, or, inArray, lt, lte, gte, isNull, ne, sql } from "drizzle-orm";
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
  const id = req.params.id as string;

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
  // ── New financial + scheduling fields ─────────────────────────────────────
  transferMode: z.enum(["by_percentage", "by_value"]).optional().default("by_percentage"),
  transferValue: z.number().positive().optional().nullable(),
  payableAmount: z.number().positive().optional().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().nullable(),
  linkedValuationRunId: z.string().uuid().optional().nullable(),
  // ── Stock entitlement ─────────────────────────────────────────────────────
  stockEntitlementHandling: z.enum(["retain_with_seller", "transfer_to_buyer"]).optional().nullable(),
  stockEntitlementKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementRetainedKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementTransferredKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementNotes: z.string().optional().nullable(),
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
      // ── New fields ────────────────────────────────────────────────────────
      transferMode: b.transferMode ?? "by_percentage",
      transferValue: b.transferValue != null ? String(b.transferValue) : null,
      payableAmount: b.payableAmount != null ? String(b.payableAmount) : null,
      effectiveDate: b.effectiveDate ?? null,
      linkedValuationRunId: b.linkedValuationRunId ?? null,
      stockEntitlementHandling: b.stockEntitlementHandling ?? null,
      stockEntitlementKg: b.stockEntitlementKg != null ? String(b.stockEntitlementKg) : null,
      stockEntitlementRetainedKg: b.stockEntitlementRetainedKg != null ? String(b.stockEntitlementRetainedKg) : null,
      stockEntitlementTransferredKg: b.stockEntitlementTransferredKg != null ? String(b.stockEntitlementTransferredKg) : null,
      stockEntitlementNotes: b.stockEntitlementNotes ?? null,
    })
    .returning();

  writeCentralAudit(req, {
    tableName: "ownership_transfers",
    recordId: created.id,
    operation: "INSERT",
    module: "ownership_transfers",
    actionType: "transfer_created",
    projectId: created.projectId,
    newData: { transferType: created.transferType, transferorName: created.transferorName, offeredPercentage: created.offeredPercentage, status: "draft" },
    actor: { id: actor.id, name: actor.displayName, role: actor.role },
  });

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
  // ── New financial + scheduling fields (admin/developer editable at any stage) ─
  transferMode: z.enum(["by_percentage", "by_value"]).optional(),
  transferValue: z.number().positive().optional().nullable(),
  payableAmount: z.number().positive().optional().nullable(),
  paidAmount: z.number().nonnegative().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  linkedValuationRunId: z.string().uuid().optional().nullable(),
  // ── Stock entitlement ─────────────────────────────────────────────────────
  stockEntitlementHandling: z.enum(["retain_with_seller", "transfer_to_buyer"]).optional().nullable(),
  stockEntitlementKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementRetainedKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementTransferredKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementNotes: z.string().optional().nullable(),
});

router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;
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
  const ADMIN_ONLY_FIELDS = new Set(["adminNotes", "paidAmount", "payableAmount", "effectiveDate", "stockEntitlementHandling", "stockEntitlementKg", "stockEntitlementRetainedKg", "stockEntitlementTransferredKg", "stockEntitlementNotes"]);
  const requestedFields = new Set(Object.keys(req.body));
  const hasOnlyAdminFields = [...requestedFields].every(k => ADMIN_ONLY_FIELDS.has(k));
  if (existing.status !== "draft" && isAdminDev && !hasOnlyAdminFields) {
    return res.status(422).json({ error: "Only admin-managed fields (admin notes, payment tracking, stock entitlement, effective date) can be updated on a submitted transfer" });
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
    if (b.transferMode !== undefined) updateFields.transferMode = b.transferMode;
    if ("transferValue" in b) updateFields.transferValue = b.transferValue != null ? String(b.transferValue) : null;
    if ("payableAmount" in b) updateFields.payableAmount = b.payableAmount != null ? String(b.payableAmount) : null;
    if ("effectiveDate" in b) updateFields.effectiveDate = b.effectiveDate ?? null;
    if ("linkedValuationRunId" in b) updateFields.linkedValuationRunId = b.linkedValuationRunId ?? null;
    if ("stockEntitlementHandling" in b) updateFields.stockEntitlementHandling = b.stockEntitlementHandling ?? null;
    if ("stockEntitlementKg" in b) updateFields.stockEntitlementKg = b.stockEntitlementKg != null ? String(b.stockEntitlementKg) : null;
    if ("stockEntitlementRetainedKg" in b) updateFields.stockEntitlementRetainedKg = b.stockEntitlementRetainedKg != null ? String(b.stockEntitlementRetainedKg) : null;
    if ("stockEntitlementTransferredKg" in b) updateFields.stockEntitlementTransferredKg = b.stockEntitlementTransferredKg != null ? String(b.stockEntitlementTransferredKg) : null;
    if ("stockEntitlementNotes" in b) updateFields.stockEntitlementNotes = b.stockEntitlementNotes ?? null;
  }
  if (isAdminDev && "adminNotes" in b) updateFields.adminNotes = b.adminNotes;
  // Admin/developer can update payment tracking and scheduling at any stage
  if (isAdminDev) {
    if (b.paidAmount !== undefined) updateFields.paidAmount = String(b.paidAmount);
    if ("payableAmount" in b && existing.status !== "draft") updateFields.payableAmount = b.payableAmount != null ? String(b.payableAmount) : null;
    if ("effectiveDate" in b && existing.status !== "draft") updateFields.effectiveDate = b.effectiveDate ?? null;
    if ("stockEntitlementHandling" in b && existing.status !== "draft") updateFields.stockEntitlementHandling = b.stockEntitlementHandling ?? null;
    if ("stockEntitlementKg" in b && existing.status !== "draft") updateFields.stockEntitlementKg = b.stockEntitlementKg != null ? String(b.stockEntitlementKg) : null;
    if ("stockEntitlementRetainedKg" in b && existing.status !== "draft") updateFields.stockEntitlementRetainedKg = b.stockEntitlementRetainedKg != null ? String(b.stockEntitlementRetainedKg) : null;
    if ("stockEntitlementTransferredKg" in b && existing.status !== "draft") updateFields.stockEntitlementTransferredKg = b.stockEntitlementTransferredKg != null ? String(b.stockEntitlementTransferredKg) : null;
    if ("stockEntitlementNotes" in b && existing.status !== "draft") updateFields.stockEntitlementNotes = b.stockEntitlementNotes ?? null;
  }

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
  const id = req.params.id as string;
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
  const id = req.params.id as string;
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
  const id = req.params.id as string;
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
  const id = req.params.id as string;
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

  writeCentralAudit(req, {
    tableName: "ownership_transfers",
    recordId: id,
    operation: "UPDATE",
    module: "ownership_transfers",
    actionType: "transfer_approved",
    projectId: existing.projectId,
    oldData: { status: existing.status },
    newData: { status: "approved" },
    actor: { id: actor.id, name: actor.displayName, role: actor.role },
  });

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
  const id = req.params.id as string;
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

  writeCentralAudit(req, {
    tableName: "ownership_transfers",
    recordId: id,
    operation: "UPDATE",
    module: "ownership_transfers",
    actionType: "transfer_executed",
    projectId: existing.projectId,
    oldData: { status: "approved" },
    newData: { status: "executed", executionNotes: parsed.data.executionNotes },
    actor: { id: actor.id, name: actor.displayName, role: actor.role },
  });

  writeTimeline(req, {
    projectId: existing.projectId,
    eventType: TL.OWNERSHIP_TRANSFER_EXECUTED,
    title: "Ownership transfer executed",
    severity: "critical",
    relatedTable: "ownership_transfers",
    relatedRecordId: id,
    metadata: {
      transferId: id,
      transferorPartnerId: existing.transferorPartnerId,
      buyerPartnerId: existing.buyerPartnerId,
      executionNotes: parsed.data.executionNotes,
    },
  });

  return res.json(updated);
});

// ── POST /ownership-transfers/:id/cancel ──────────────────────────────────

const cancelSchema = z.object({
  cancellationReason: z.string().min(1, "Cancellation reason is required"),
});

router.post("/:id/cancel", async (req, res) => {
  const id = req.params.id as string;
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

  writeCentralAudit(req, {
    tableName: "ownership_transfers",
    recordId: id,
    operation: "UPDATE",
    module: "ownership_transfers",
    actionType: "transfer_cancelled",
    projectId: existing.projectId,
    oldData: { status: existing.status },
    newData: { status: "cancelled", cancellationReason: parsed.data.cancellationReason },
    actor: { id: actor.id, name: actor.displayName, role: actor.role },
  });

  return res.json(updated);
});

// ══════════════════════════════════════════════════════════════════════════
// ROFR OFFER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════

// ── Helpers ────────────────────────────────────────────────────────────────

/** Write an immutable audit event (fire-and-forget, non-fatal) */
async function writeAudit(params: {
  transferId: string;
  eventType: typeof transferAuditEventsTable.$inferInsert["eventType"];
  actorUserId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  targetPartnerId?: string | null;
  targetPartnerName?: string | null;
  eventData?: Record<string, unknown>;
  summary: string;
  ipAddress?: string | null;
}) {
  try {
    await db.insert(transferAuditEventsTable).values({
      transferId: params.transferId,
      eventType: params.eventType,
      actorUserId: params.actorUserId ?? null,
      actorName: params.actorName ?? null,
      actorRole: params.actorRole ?? null,
      targetPartnerId: params.targetPartnerId ?? null,
      targetPartnerName: params.targetPartnerName ?? null,
      eventData: params.eventData ?? {},
      summary: params.summary,
      ipAddress: params.ipAddress ?? null,
    });
  } catch (_e) {
    // Non-fatal — audit write should never break the main response
  }
}

/** Generate a 6-digit numeric OTP code */
function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

// ── GET /ownership-transfers/rofr-dashboard ────────────────────────────────

router.get("/rofr-dashboard", requireRole("admin", "developer"), async (req, res) => {
  const { projectId } = req.query as { projectId?: string };

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  // Pending offers
  const pendingOffers = await db
    .select({
      offer: transferRofrOffersTable,
      transfer: ownershipTransfersTable,
    })
    .from(transferRofrOffersTable)
    .innerJoin(ownershipTransfersTable, eq(transferRofrOffersTable.transferId, ownershipTransfersTable.id))
    .where(
      and(
        eq(transferRofrOffersTable.status, "pending"),
        eq(transferRofrOffersTable.isActive, true),
        projectId ? eq(ownershipTransfersTable.projectId, projectId as string) : undefined,
      )!,
    )
    .orderBy(transferRofrOffersTable.deadline);

  // Expiring today
  const expiringToday = await db
    .select()
    .from(transferRofrOffersTable)
    .where(
      and(
        eq(transferRofrOffersTable.status, "pending"),
        lte(transferRofrOffersTable.deadline, endOfToday),
        gte(transferRofrOffersTable.deadline, now),
      ),
    );

  // Expired but unresolved (deadline passed, still pending)
  const expiredUnresolved = await db
    .select()
    .from(transferRofrOffersTable)
    .where(
      and(
        eq(transferRofrOffersTable.status, "pending"),
        lt(transferRofrOffersTable.deadline, now),
      ),
    );

  // Count pending transfers overall
  const [{ count: totalPendingTransfers }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ownershipTransfersTable)
    .where(
      and(
        eq(ownershipTransfersTable.isActive, true),
        or(
          eq(ownershipTransfersTable.status, "pending_rofr"),
          eq(ownershipTransfersTable.status, "pending_approval"),
          eq(ownershipTransfersTable.status, "approved"),
        ),
      ),
    );

  // Count by ROFR offer status
  const statusCounts = await db
    .select({ status: transferRofrOffersTable.status, count: sql<number>`count(*)::int` })
    .from(transferRofrOffersTable)
    .groupBy(transferRofrOffersTable.status);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.status] = row.count;

  return res.json({
    pendingOffers,
    expiringToday,
    expiredUnresolved,
    byStatus,
    totalPendingTransfers: totalPendingTransfers ?? 0,
  });
});

// ── GET /ownership-transfers/:id/rofr-offers ──────────────────────────────

router.get("/:id/rofr-offers", async (req, res) => {
  const id = req.params.id as string;
  const offers = await db
    .select()
    .from(transferRofrOffersTable)
    .where(eq(transferRofrOffersTable.transferId, id))
    .orderBy(transferRofrOffersTable.offeredAt);
  return res.json({ offers });
});

// ── POST /ownership-transfers/:id/rofr-offers ─────────────────────────────

const sendOfferSchema = z.object({
  partnerId: z.string().uuid(),
  partnerName: z.string().min(1),
  partnerContact: z.string().optional(),
});

router.post("/:id/rofr-offers", requireRole("admin", "developer"), async (req, res) => {
  const id = req.params.id as string;
  const parsed = sendOfferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [transfer] = await db
    .select()
    .from(ownershipTransfersTable)
    .where(eq(ownershipTransfersTable.id, id))
    .limit(1);

  if (!transfer) return res.status(404).json({ error: "Transfer not found" });
  if (transfer.status !== "pending_rofr") {
    return res.status(422).json({ error: "ROFR offers can only be sent when transfer is in pending_rofr status" });
  }

  // Check for duplicate
  const [existing] = await db
    .select()
    .from(transferRofrOffersTable)
    .where(
      and(
        eq(transferRofrOffersTable.transferId, id),
        eq(transferRofrOffersTable.partnerId, parsed.data.partnerId),
        eq(transferRofrOffersTable.isActive, true),
      ),
    )
    .limit(1);

  if (existing) return res.status(409).json({ error: "An active ROFR offer already exists for this partner on this transfer" });

  const deadline = new Date();
  deadline.setDate(deadline.getDate() + ROFR_DAYS);

  const [offer] = await db
    .insert(transferRofrOffersTable)
    .values({
      transferId: id,
      partnerId: parsed.data.partnerId,
      partnerName: parsed.data.partnerName,
      deadline,
      sentByName: actor.displayName,
      sentById: actor.id,
    })
    .returning();

  // Write audit event
  void writeAudit({
    transferId: id,
    eventType: "rofr_offer_sent",
    actorUserId: actor.id,
    actorName: actor.displayName,
    actorRole: actor.role,
    targetPartnerId: parsed.data.partnerId,
    targetPartnerName: parsed.data.partnerName,
    eventData: { offerId: offer.id, deadline: deadline.toISOString() },
    summary: `ROFR offer sent to ${parsed.data.partnerName} (deadline: ${deadline.toLocaleDateString("en-IN")})`,
  });

  return res.status(201).json(offer);
});

// ── POST /ownership-transfers/:id/rofr-offers/:offerId/respond ────────────

const respondSchema = z.object({
  response: z.enum(["accepted", "rejected"]),
  otpCode: z.string().length(6),
  notes: z.string().optional(),
});

router.post("/:id/rofr-offers/:offerId/respond", async (req, res) => {
  const id = req.params.id as string;
  const offerId = req.params.offerId as string;
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [offer] = await db
    .select()
    .from(transferRofrOffersTable)
    .where(and(eq(transferRofrOffersTable.id, offerId), eq(transferRofrOffersTable.transferId, id)))
    .limit(1);

  if (!offer) return res.status(404).json({ error: "Offer not found" });
  if (offer.status !== "pending") return res.status(409).json({ error: `Offer already has status '${offer.status}'` });

  const now = new Date();
  if (offer.deadline < now) {
    // Mark expired
    await db
      .update(transferRofrOffersTable)
      .set({ status: "expired", updatedAt: now })
      .where(eq(transferRofrOffersTable.id, offerId));
    return res.status(422).json({ error: "ROFR offer has expired" });
  }

  // Find the most recent pending OTP for this offer
  const [otpEvent] = await db
    .select()
    .from(transferOtpEventsTable)
    .where(
      and(
        eq(transferOtpEventsTable.transferId, id),
        eq(transferOtpEventsTable.rofrOfferId, offerId),
        eq(transferOtpEventsTable.status, "pending"),
      ),
    )
    .orderBy(desc(transferOtpEventsTable.createdAt))
    .limit(1);

  if (!otpEvent) {
    return res.status(400).json({ error: "No pending OTP found for this offer. Please generate an OTP first." });
  }

  if (otpEvent.expiresAt < now) {
    await db.update(transferOtpEventsTable).set({ status: "expired", updatedAt: now }).where(eq(transferOtpEventsTable.id, otpEvent.id));
    void writeAudit({ transferId: id, eventType: "otp_failed", actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role, eventData: { otpId: otpEvent.id, purpose: otpEvent.purpose, recipientName: otpEvent.recipientName, reason: "expired" }, summary: `OTP expired for ${otpEvent.recipientName}` });
    return res.status(400).json({ error: "OTP has expired. Please generate a new OTP." });
  }

  // Verify code
  const codeMatch = otpEvent.otpPlaintext === parsed.data.otpCode;

  if (!codeMatch) {
    const newAttempts = otpEvent.failedAttempts + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(transferOtpEventsTable).set({ status: "cancelled", failedAttempts: newAttempts, updatedAt: now }).where(eq(transferOtpEventsTable.id, otpEvent.id));
      void writeAudit({ transferId: id, eventType: "otp_failed", actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role, eventData: { otpId: otpEvent.id, attempt: newAttempts, reason: "max_attempts" }, summary: `OTP cancelled after ${newAttempts} failed attempts for ${otpEvent.recipientName}` });
      return res.status(429).json({ error: "Too many failed attempts. OTP cancelled. Please generate a new OTP." });
    }
    await db.update(transferOtpEventsTable).set({ failedAttempts: newAttempts, updatedAt: now }).where(eq(transferOtpEventsTable.id, otpEvent.id));
    void writeAudit({ transferId: id, eventType: "otp_failed", actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role, eventData: { otpId: otpEvent.id, attempt: newAttempts }, summary: `OTP verification failed (attempt ${newAttempts}) for ${otpEvent.recipientName}` });
    return res.status(400).json({ error: `Invalid OTP code. ${OTP_MAX_ATTEMPTS - newAttempts} attempts remaining.` });
  }

  // OTP verified — mark it
  await db.update(transferOtpEventsTable).set({
    status: "verified",
    verifiedAt: now,
    verifiedByUserId: actor.id,
    verifiedByName: actor.displayName,
    updatedAt: now,
  }).where(eq(transferOtpEventsTable.id, otpEvent.id));

  void writeAudit({ transferId: id, eventType: "otp_verified", actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role, eventData: { otpId: otpEvent.id, purpose: otpEvent.purpose, recipientName: otpEvent.recipientName }, summary: `OTP verified for ${otpEvent.recipientName}` });

  // Record ROFR response
  const [updatedOffer] = await db
    .update(transferRofrOffersTable)
    .set({
      status: parsed.data.response,
      respondedAt: now,
      responseNotes: parsed.data.notes ?? null,
      verifiedViaOtpId: otpEvent.id,
      updatedAt: now,
    })
    .where(eq(transferRofrOffersTable.id, offerId))
    .returning();

  // Also update the JSONB array on the transfer for backwards compat
  const [currentTransfer] = await db.select().from(ownershipTransfersTable).where(eq(ownershipTransfersTable.id, id)).limit(1);
  if (currentTransfer) {
    const existing = (currentTransfer.rofrResponses ?? []) as RofrResponse[];
    const updated = existing.map(r =>
      r.partnerId === offer.partnerId
        ? { ...r, response: parsed.data.response, respondedAt: now.toISOString(), notes: parsed.data.notes ?? null }
        : r,
    );
    if (!updated.find(r => r.partnerId === offer.partnerId)) {
      updated.push({ partnerId: offer.partnerId, partnerName: offer.partnerName, response: parsed.data.response, respondedAt: now.toISOString(), notes: parsed.data.notes ?? null });
    }
    await db.update(ownershipTransfersTable).set({ rofrResponses: updated, updatedAt: now }).where(eq(ownershipTransfersTable.id, id));
  }

  void writeAudit({
    transferId: id,
    eventType: "rofr_response_recorded",
    actorUserId: actor.id,
    actorName: actor.displayName,
    actorRole: actor.role,
    targetPartnerId: offer.partnerId,
    targetPartnerName: offer.partnerName,
    eventData: { offerId, response: parsed.data.response, otpId: otpEvent.id },
    summary: `${offer.partnerName} ${parsed.data.response === "accepted" ? "accepted" : "declined"} the ROFR offer (OTP verified)`,
  });

  return res.json(updatedOffer);
});

// ══════════════════════════════════════════════════════════════════════════
// OTP MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════

// ── POST /ownership-transfers/:id/otp/generate ────────────────────────────

const generateOtpSchema = z.object({
  purpose: z.enum(["rofr_acceptance", "rofr_rejection", "transfer_execution", "transfer_submission"]),
  recipientName: z.string().min(1),
  recipientContact: z.string().optional(),
  rofrOfferId: z.string().uuid().optional(),
});

router.post("/:id/otp/generate", requireRole("admin", "developer"), async (req, res) => {
  const id = req.params.id as string;
  const parsed = generateOtpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [transfer] = await db.select().from(ownershipTransfersTable).where(eq(ownershipTransfersTable.id, id)).limit(1);
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  // Cancel any existing pending OTPs for the same transfer + purpose + offer
  await db
    .update(transferOtpEventsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(transferOtpEventsTable.transferId, id),
        eq(transferOtpEventsTable.purpose, parsed.data.purpose),
        eq(transferOtpEventsTable.status, "pending"),
        parsed.data.rofrOfferId ? eq(transferOtpEventsTable.rofrOfferId, parsed.data.rofrOfferId) : isNull(transferOtpEventsTable.rofrOfferId),
      ),
    );

  const [otpEvent] = await db
    .insert(transferOtpEventsTable)
    .values({
      transferId: id,
      purpose: parsed.data.purpose,
      recipientName: parsed.data.recipientName,
      recipientContact: parsed.data.recipientContact ?? null,
      otpPlaintext: code, // placeholder mode — remove when real provider wired
      delivery: "placeholder",
      expiresAt,
      rofrOfferId: parsed.data.rofrOfferId ?? null,
      requestedByUserId: actor.id,
      requestedByName: actor.displayName,
    })
    .returning();

  void writeAudit({
    transferId: id,
    eventType: "otp_generated",
    actorUserId: actor.id,
    actorName: actor.displayName,
    actorRole: actor.role,
    eventData: { otpId: otpEvent.id, purpose: parsed.data.purpose, recipientName: parsed.data.recipientName, delivery: "placeholder", expiresAt: expiresAt.toISOString() },
    summary: `OTP generated for ${parsed.data.recipientName} (purpose: ${parsed.data.purpose}, expires in ${OTP_TTL_MINUTES} min)`,
  });

  // Return with devModePlaintextCode for placeholder mode
  return res.status(201).json({
    ...otpEvent,
    devModePlaintextCode: code,
  });
});

// ── POST /ownership-transfers/:id/otp/verify ──────────────────────────────

const verifyOtpSchema = z.object({
  otpId: z.string().uuid(),
  otpCode: z.string().length(6),
});

router.post("/:id/otp/verify", async (req, res) => {
  const id = req.params.id as string;
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId!);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const [otpEvent] = await db
    .select()
    .from(transferOtpEventsTable)
    .where(and(eq(transferOtpEventsTable.id, parsed.data.otpId), eq(transferOtpEventsTable.transferId, id)))
    .limit(1);

  if (!otpEvent) return res.status(404).json({ error: "OTP event not found" });
  if (otpEvent.status === "verified") return res.status(400).json({ error: "OTP already verified" });
  if (otpEvent.status === "cancelled") return res.status(400).json({ error: "OTP has been cancelled" });

  const now = new Date();
  if (otpEvent.status === "expired" || otpEvent.expiresAt < now) {
    await db.update(transferOtpEventsTable).set({ status: "expired", updatedAt: now }).where(eq(transferOtpEventsTable.id, otpEvent.id));
    return res.status(400).json({ error: "OTP has expired" });
  }

  if (otpEvent.failedAttempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many failed attempts. OTP is locked." });
  }

  const codeMatch = otpEvent.otpPlaintext === parsed.data.otpCode;

  if (!codeMatch) {
    const newAttempts = otpEvent.failedAttempts + 1;
    const newStatus = newAttempts >= OTP_MAX_ATTEMPTS ? "cancelled" : "pending";
    await db.update(transferOtpEventsTable).set({ failedAttempts: newAttempts, status: newStatus, updatedAt: now }).where(eq(transferOtpEventsTable.id, otpEvent.id));
    void writeAudit({ transferId: id, eventType: "otp_failed", actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role, eventData: { otpId: otpEvent.id, attempt: newAttempts }, summary: `OTP verification failed (attempt ${newAttempts})` });
    if (newStatus === "cancelled") return res.status(429).json({ error: "Too many failed attempts. OTP cancelled." });
    return res.status(400).json({ error: `Invalid OTP. ${OTP_MAX_ATTEMPTS - newAttempts} attempts remaining.`, verified: false, otpEvent: { ...otpEvent, failedAttempts: newAttempts } });
  }

  const [updatedOtp] = await db
    .update(transferOtpEventsTable)
    .set({ status: "verified", verifiedAt: now, verifiedByUserId: actor.id, verifiedByName: actor.displayName, updatedAt: now })
    .where(eq(transferOtpEventsTable.id, otpEvent.id))
    .returning();

  void writeAudit({ transferId: id, eventType: "otp_verified", actorUserId: actor.id, actorName: actor.displayName, actorRole: actor.role, eventData: { otpId: otpEvent.id, purpose: otpEvent.purpose, recipientName: otpEvent.recipientName }, summary: `OTP verified for ${otpEvent.recipientName} (purpose: ${otpEvent.purpose})` });

  return res.json({ verified: true, otpEvent: updatedOtp });
});

// ── GET /ownership-transfers/:id/otp-events ───────────────────────────────

router.get("/:id/otp-events", requireRole("admin", "developer"), async (req, res) => {
  const id = req.params.id as string;
  const otpEvents = await db
    .select()
    .from(transferOtpEventsTable)
    .where(eq(transferOtpEventsTable.transferId, id))
    .orderBy(desc(transferOtpEventsTable.createdAt));

  // Redact plaintext codes for completed / expired OTPs (only show for pending)
  const sanitised = otpEvents.map(e => ({
    ...e,
    otpPlaintext: null, // never expose in list
    devModePlaintextCode: e.status === "pending" && e.delivery === "placeholder" ? e.otpPlaintext : null,
  }));

  return res.json({ otpEvents: sanitised });
});

// ══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════════════════════

// ── GET /ownership-transfers/:id/audit-events ─────────────────────────────

router.get("/:id/audit-events", async (req, res) => {
  const id = req.params.id as string;

  // Verify transfer exists and user has access
  const [transfer] = await db.select({ id: ownershipTransfersTable.id, projectId: ownershipTransfersTable.projectId })
    .from(ownershipTransfersTable).where(eq(ownershipTransfersTable.id, id)).limit(1);
  if (!transfer) return res.status(404).json({ error: "Transfer not found" });

  const scope = getProjectScope(req);
  if (scope !== null && !scope.includes(transfer.projectId)) return res.status(403).json({ error: "Access denied" });

  const events = await db
    .select()
    .from(transferAuditEventsTable)
    .where(eq(transferAuditEventsTable.transferId, id))
    .orderBy(transferAuditEventsTable.createdAt);

  return res.json({ events });
});

export default router;
