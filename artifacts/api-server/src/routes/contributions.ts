import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, isNull, ne, inArray, desc, sql } from "drizzle-orm";
import {
  db,
  contributionsTable,
  contributionVerificationEventsTable,
  projectsTable,
  projectParticipantsTable,
  partnersTable,
  usersTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { writeAudit } from "../lib/auditLogger";
import { writeTimeline, TL } from "../lib/timelineLogger";
import { writeOverride, OV } from "../lib/overrideLogger";
import { logDispute, DT } from "../lib/disputeLogger";
import { assertOwnershipMutationAllowed } from "../lib/ownershipGuard";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

const VALID_CONTRIBUTION_TYPES = [
  "land_notional",
  "economic_investment",
  "operational_cost",
  "recoverable_advance",
  "manual_adjustment",
] as const;
type ContributionType = (typeof VALID_CONTRIBUTION_TYPES)[number];

const VALID_VERIFICATION_STATUSES = [
  "draft",
  "pending_verification",
  "verified",
  "rejected",
  "disputed",
] as const;
type VerificationStatus = (typeof VALID_VERIFICATION_STATUSES)[number];

/**
 * Types that automatically affect ownership (default affectsOwnership=true).
 * operational_cost is excluded — it NEVER creates ownership rights.
 */
const OWNERSHIP_AFFECTING_TYPES: ContributionType[] = [
  "land_notional",
  "economic_investment",
  "recoverable_advance",
  "manual_adjustment",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ActingUser {
  id: string;
  name: string | null;
  role: string;
}

async function resolveActingUser(clerkUserId: string): Promise<ActingUser | null> {
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (!rows[0]) return null;
  return { id: rows[0].id, name: rows[0].displayName, role: rows[0].role };
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

function parseAmount(v: unknown): number | null {
  if (typeof v === "number" && v > 0 && isFinite(v)) return v;
  return null;
}

function isValidDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ── Format contribution row for API response ──────────────────────────────────

function formatContribution(
  row: typeof contributionsTable.$inferSelect & { projectName?: string | null },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    partnerId: row.partnerId,
    partnerName: row.partnerName,
    contributionType: row.contributionType,
    amount: row.amount,
    contributionDate: row.contributionDate,
    lifecyclePhaseSnapshot: row.lifecyclePhaseSnapshot,
    agreementId: row.agreementId,
    referenceNumber: row.referenceNumber,
    remarks: row.remarks,
    affectsOwnership: row.affectsOwnership,
    verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedBy: row.verifiedBy,
    verifiedByName: row.verifiedByName,
    verifierNotes: row.verifierNotes,
    designatedVerifierId: row.designatedVerifierId ?? null,
    designatedVerifierName: row.designatedVerifierName ?? null,
    disputeNotes: row.disputeNotes ?? null,
    disputedAt: row.disputedAt?.toISOString() ?? null,
    disputedBy: row.disputedBy ?? null,
    disputedByName: row.disputedByName ?? null,
    recordedBy: row.recordedBy,
    recordedByName: row.recordedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

// ── Write verification event (fire-and-forget helper) ─────────────────────────

async function writeVerificationEvent(params: {
  contributionId: string;
  eventType:
    | "verification_requested"
    | "approved"
    | "rejected"
    | "re_approved"
    | "verifier_changed"
    | "otp_sent"
    | "otp_verified"
    | "dispute_raised"
    | "dispute_resolved"
    | "dispute_overridden";
  actorId?: string | null;
  actorName?: string | null;
  targetUserId?: string | null;
  targetUserName?: string | null;
  notes?: string | null;
}) {
  try {
    await db.insert(contributionVerificationEventsTable).values({
      contributionId: params.contributionId,
      eventType: params.eventType,
      actorId: params.actorId ?? null,
      actorName: params.actorName ?? null,
      targetUserId: params.targetUserId ?? null,
      targetUserName: params.targetUserName ?? null,
      notes: params.notes ?? null,
    });
  } catch {
    // Non-fatal — event logging must not block the response
  }
}

// ── GET /contributions/summary ────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  if (actor.role === "employee" || actor.role === "operational_staff") {
    return res.status(403).json({ error: "Contribution analytics are not accessible to your role." });
  }

  // Determine visible project IDs
  let visibleProjectIds: string[] | null = null; // null = all
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({ projects: [], totals: { totalAmount: 0, verifiedAmount: 0, ownershipEligibleAmount: 0, count: 0 } });
    }
  }

  // Filter by optional projectId query param
  const filterProjectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (filterProjectId) {
    if (visibleProjectIds !== null && !visibleProjectIds.includes(filterProjectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    visibleProjectIds = [filterProjectId];
  }

  // Fetch all non-deleted contributions
  const conditions = [isNull(contributionsTable.deletedAt)];
  if (visibleProjectIds !== null) {
    conditions.push(inArray(contributionsTable.projectId, visibleProjectIds));
  }

  const rows = await db
    .select({
      id: contributionsTable.id,
      projectId: contributionsTable.projectId,
      amount: contributionsTable.amount,
      contributionType: contributionsTable.contributionType,
      verificationStatus: contributionsTable.verificationStatus,
      lifecyclePhaseSnapshot: contributionsTable.lifecyclePhaseSnapshot,
      affectsOwnership: contributionsTable.affectsOwnership,
      partnerId: contributionsTable.partnerId,
      partnerName: contributionsTable.partnerName,
      projectName: projectsTable.name,
      projectModel: projectsTable.commercialModel,
      projectLifecycle: projectsTable.lifecycleStatus,
    })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(contributionsTable.createdAt));

  type ParticipantAgg = {
    partnerId: string | null;
    partnerName: string;
    totalAmount: number;
    verifiedAmount: number;
    ownershipEligibleAmount: number;
    reimbursableAmount: number;
    draftCount: number;
    pendingCount: number;
    verifiedCount: number;
    rejectedCount: number;
    disputedCount: number;
  };

  type ProjectAgg = {
    projectId: string;
    projectName: string;
    model: string;
    lifecycleStatus: string;
    totalAmount: number;
    verifiedAmount: number;
    ownershipEligibleAmount: number;
    reimbursableAmount: number;
    byType: Record<string, number>;
    draftCount: number;
    pendingCount: number;
    verifiedCount: number;
    rejectedCount: number;
    disputedCount: number;
    participantMap: Map<string, ParticipantAgg>;
  };

  const projectMap = new Map<string, ProjectAgg>();

  let grandTotal = 0;
  let grandVerified = 0;
  let grandOwnership = 0;
  let grandCount = 0;

  for (const row of rows) {
    if (!projectMap.has(row.projectId)) {
      projectMap.set(row.projectId, {
        projectId: row.projectId,
        projectName: row.projectName ?? "Unknown Project",
        model: row.projectModel ?? "unknown",
        lifecycleStatus: row.projectLifecycle ?? "unknown",
        totalAmount: 0,
        verifiedAmount: 0,
        ownershipEligibleAmount: 0,
        reimbursableAmount: 0,
        byType: {},
        draftCount: 0,
        pendingCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
        disputedCount: 0,
        participantMap: new Map(),
      });
    }
    const p = projectMap.get(row.projectId)!;
    p.totalAmount += row.amount;
    p.byType[row.contributionType] = (p.byType[row.contributionType] ?? 0) + row.amount;

    // ── Participant aggregation ────────────────────────────────────────────────
    const partKey = row.partnerName;
    if (!p.participantMap.has(partKey)) {
      p.participantMap.set(partKey, {
        partnerId: row.partnerId ?? null,
        partnerName: row.partnerName,
        totalAmount: 0,
        verifiedAmount: 0,
        ownershipEligibleAmount: 0,
        reimbursableAmount: 0,
        draftCount: 0,
        pendingCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
        disputedCount: 0,
      });
    }
    const part = p.participantMap.get(partKey)!;
    part.totalAmount += row.amount;

    if (row.contributionType === "recoverable_advance") {
      part.reimbursableAmount += row.amount;
      p.reimbursableAmount += row.amount;
    }

    if (row.verificationStatus === "verified") {
      p.verifiedAmount += row.amount;
      part.verifiedAmount += row.amount;
      grandVerified += row.amount;
      if (row.affectsOwnership && row.lifecyclePhaseSnapshot === "prematurity") {
        p.ownershipEligibleAmount += row.amount;
        part.ownershipEligibleAmount += row.amount;
        grandOwnership += row.amount;
      }
    }

    if (row.verificationStatus === "draft") { p.draftCount++; part.draftCount++; }
    if (row.verificationStatus === "pending_verification") { p.pendingCount++; part.pendingCount++; }
    if (row.verificationStatus === "verified") { p.verifiedCount++; part.verifiedCount++; }
    if (row.verificationStatus === "rejected") { p.rejectedCount++; part.rejectedCount++; }
    if (row.verificationStatus === "disputed") { p.disputedCount++; part.disputedCount++; }

    grandTotal += row.amount;
    grandCount++;
  }

  return res.json({
    projects: Array.from(projectMap.values()).map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      model: p.model,
      lifecycleStatus: p.lifecycleStatus,
      totalAmount: p.totalAmount,
      verifiedAmount: p.verifiedAmount,
      ownershipEligibleAmount: p.ownershipEligibleAmount,
      reimbursableAmount: p.reimbursableAmount,
      byType: p.byType,
      draftCount: p.draftCount,
      pendingCount: p.pendingCount,
      verifiedCount: p.verifiedCount,
      rejectedCount: p.rejectedCount,
      disputedCount: p.disputedCount,
      participants: Array.from(p.participantMap.values()),
    })),
    totals: {
      totalAmount: grandTotal,
      verifiedAmount: grandVerified,
      ownershipEligibleAmount: grandOwnership,
      count: grandCount,
    },
  });
});

// ── GET /contributions ────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) return res.json({ contributions: [] });
  }

  const conditions: ReturnType<typeof eq>[] = [isNull(contributionsTable.deletedAt) as unknown as ReturnType<typeof eq>];

  // Optional filters
  if (typeof req.query.projectId === "string") {
    const pid = req.query.projectId;
    if (visibleProjectIds !== null && !visibleProjectIds.includes(pid)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    conditions.push(eq(contributionsTable.projectId, pid) as unknown as ReturnType<typeof eq>);
  } else if (visibleProjectIds !== null) {
    conditions.push(inArray(contributionsTable.projectId, visibleProjectIds) as unknown as ReturnType<typeof eq>);
  }

  if (typeof req.query.partnerId === "string") {
    conditions.push(eq(contributionsTable.partnerId, req.query.partnerId) as unknown as ReturnType<typeof eq>);
  }
  if (typeof req.query.contributionType === "string" && VALID_CONTRIBUTION_TYPES.includes(req.query.contributionType as ContributionType)) {
    conditions.push(eq(contributionsTable.contributionType, req.query.contributionType as ContributionType) as unknown as ReturnType<typeof eq>);
  }
  if (typeof req.query.verificationStatus === "string" && VALID_VERIFICATION_STATUSES.includes(req.query.verificationStatus as VerificationStatus)) {
    conditions.push(eq(contributionsTable.verificationStatus, req.query.verificationStatus as VerificationStatus) as unknown as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({
      contribution: contributionsTable,
      projectName: projectsTable.name,
    })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(...(conditions as Parameters<typeof and>)))
    .orderBy(desc(contributionsTable.createdAt));

  return res.json({
    contributions: rows.map((r) =>
      formatContribution({ ...r.contribution, projectName: r.projectName }),
    ),
  });
});

// ── POST /contributions ────────────────────────────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const b = req.body as Record<string, unknown>;

    if (!b.projectId || typeof b.projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!b.contributionType || !VALID_CONTRIBUTION_TYPES.includes(b.contributionType as ContributionType)) {
      return res.status(400).json({ error: "contributionType must be one of: " + VALID_CONTRIBUTION_TYPES.join(", ") });
    }
    const amount = parseAmount(b.amount);
    if (!amount) return res.status(400).json({ error: "amount must be a positive number" });
    if (!isValidDate(b.contributionDate)) {
      return res.status(400).json({ error: "contributionDate must be YYYY-MM-DD" });
    }
    // ── Participant validation ─────────────────────────────────────────────────
    // partnerName must resolve to a real participant in project_participants.
    // Accept either partnerName (looked up against project roster) or
    // participantId (direct FK to project_participants.id).
    // In both cases, partnerName is DERIVED from the DB record — never trusted
    // from the request body — to eliminate fake contributor names.
    let resolvedParticipantId: string | null = null;
    let resolvedPartnerName: string;

    if (typeof b.participantId === "string" && b.participantId) {
      // Client sent a participantId — look it up and verify it belongs to this project
      const [participant] = await db
        .select({ id: projectParticipantsTable.id, fullName: projectParticipantsTable.fullName })
        .from(projectParticipantsTable)
        .where(and(
          eq(projectParticipantsTable.id, b.participantId),
          eq(projectParticipantsTable.projectId, String(b.projectId)),
        ))
        .limit(1);
      if (!participant) {
        return res.status(400).json({
          error: "participantId does not belong to this project.",
          code: "INVALID_PARTICIPANT",
        });
      }
      resolvedParticipantId = participant.id;
      resolvedPartnerName = participant.fullName;
    } else if (typeof b.partnerName === "string" && b.partnerName.trim()) {
      // Legacy path: partnerName string — verify it matches a real project participant
      const [participant] = await db
        .select({ id: projectParticipantsTable.id, fullName: projectParticipantsTable.fullName })
        .from(projectParticipantsTable)
        .where(and(
          eq(projectParticipantsTable.projectId, String(b.projectId)),
          eq(projectParticipantsTable.fullName, b.partnerName.trim()),
        ))
        .limit(1);
      if (!participant) {
        return res.status(400).json({
          error: `"${b.partnerName}" is not a registered participant of this project. Only project participants may have contributions recorded against them.`,
          code: "INVALID_PARTICIPANT_NAME",
        });
      }
      resolvedParticipantId = participant.id;
      resolvedPartnerName = participant.fullName; // Use DB name — normalised casing
    } else {
      return res.status(400).json({ error: "Either participantId or partnerName is required." });
    }

    const cType = b.contributionType as ContributionType;

    // Auto-determine affectsOwnership: false for operational_cost, true for others
    // Allow explicit override only for manual_adjustment
    let affectsOwnership = OWNERSHIP_AFFECTING_TYPES.includes(cType);
    if (cType === "manual_adjustment" && typeof b.affectsOwnership === "boolean") {
      affectsOwnership = b.affectsOwnership;
    }

    // reimbursementFlag always overrides ownership — reimbursable entries go to the
    // recoverable ledger only and must never create equity, regardless of type.
    let reimbursementFlag = b.reimbursementFlag === true;
    if (reimbursementFlag) {
      affectsOwnership = false;
    }

    // Fetch current project lifecycle phase + commercial model for guards
    const projectRows = await db
      .select({
        lifecycleStatus: projectsTable.lifecycleStatus,
        commercialModel: projectsTable.commercialModel,
        name: projectsTable.name,
        governanceLocked: projectsTable.governanceLocked,
        configurationStatus: projectsTable.configurationStatus,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, String(b.projectId)))
      .limit(1);
    if (!projectRows[0]) return res.status(400).json({ error: "Project not found" });

    // ── Governance lock check ──────────────────────────────────────────
    if (projectRows[0].governanceLocked) {
      return res.status(423).json({
        error: "Project is governance-locked. At least one valid landowner must be linked before contributions can be recorded.",
        code: "GOVERNANCE_LOCKED",
        configurationStatus: projectRows[0].configurationStatus,
      });
    }

    // ── Commercial model guard (fifty_percent_revenue) ────────────────────────
    // Under the 50% Revenue Model: no ownership equity is ever created.
    // Land notional contributions are blocked outright, and any other
    // contribution must not affect ownership calculations.
    if (projectRows[0].commercialModel === "fifty_percent_revenue") {
      if (cType === "land_notional") {
        return res.status(422).json({
          error:
            "Land notional contributions are not permitted for 50% Revenue Model projects. This model does not create ownership equity.",
          code: "MODEL_GUARD_LAND_NOTIONAL",
        });
      }
      // Force affectsOwnership to false — the 50% model never creates ownership equity
      affectsOwnership = false;
    }

    // ── Post-maturity ownership guard ─────────────────────────────────────────
    // Only operational_cost and manual_adjustment (with affectsOwnership=false)
    // are permitted after maturity. Ownership-forming types (economic_investment,
    // recoverable_advance) must use the Post-Maturity Cost Payments system.
    const currentLifecycle = projectRows[0].lifecycleStatus ?? "prematurity";

    // Auto-set reimbursementFlag for post-maturity operational costs.
    // After maturity, all operational costs are reimbursable burdens — never equity.
    if (!reimbursementFlag && currentLifecycle !== "prematurity" && cType === "operational_cost") {
      reimbursementFlag = true;
      affectsOwnership = false;
    }
    if (
      currentLifecycle !== "prematurity" &&
      (cType === "economic_investment" || cType === "recoverable_advance")
    ) {
      return res.status(422).json({
        error:
          "Ownership-forming contributions (economic investment and recoverable advance) cannot be recorded after maturity declaration. Post-maturity financial support must be tracked via the Post-Maturity Cost Payments system where it is treated as a reimbursable project cost advance.",
        code: "POST_MATURITY_OWNERSHIP_BLOCKED",
        lifecycleStatus: currentLifecycle,
      });
    }

    // ── Land notional rules ───────────────────────────────────────────────────
    // 1. Must be recorded during prematurity phase only
    // 2. Only one active (non-rejected, non-deleted) land_notional per project
    // 3. affectsOwnership is always true (cannot be overridden)
    // 4. lifecyclePhaseSnapshot is always "prematurity" (fixed, not current project state)
    if (cType === "land_notional") {
      const currentPhase = projectRows[0].lifecycleStatus ?? "prematurity";
      if (currentPhase !== "prematurity") {
        return res.status(409).json({
          error: "Land notional contributions can only be recorded during the prematurity phase. This project has already advanced beyond prematurity.",
          code: "LAND_NOTIONAL_PHASE_LOCKED",
        });
      }
      const existing = await db
        .select({ id: contributionsTable.id, verificationStatus: contributionsTable.verificationStatus })
        .from(contributionsTable)
        .where(and(
          eq(contributionsTable.projectId, String(b.projectId)),
          eq(contributionsTable.contributionType, "land_notional"),
          isNull(contributionsTable.deletedAt),
          ne(contributionsTable.verificationStatus, "rejected"),
        ))
        .limit(1);
      if (existing[0]) {
        return res.status(409).json({
          error: "A land notional contribution already exists for this project. Only one land notional contribution is allowed per project.",
          code: "LAND_NOTIONAL_EXISTS",
          existingId: existing[0].id,
        });
      }
      // Force: always affects ownership, always prematurity snapshot
      affectsOwnership = true;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Ownership freeze / maturity / closed guard ───────────────────────────
    // Blocks ownership-affecting creates when a freeze is active or the project
    // is mature_production / closed. Non-ownership-affecting entries
    // (operational_cost, reimbursable manual_adjustment) are unaffected.
    const guardCreate = await assertOwnershipMutationAllowed({
      projectId: String(b.projectId),
      action: "contribution.create",
      affectsOwnership,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      req,
      targetTable: "contributions",
      metadata: { contributionType: cType, amount },
    });
    if (!guardCreate.ok) return res.status(guardCreate.status).json(guardCreate.body);

    const lifecyclePhaseSnapshot = cType === "land_notional"
      ? "prematurity"
      : (typeof b.lifecyclePhaseSnapshot === "string"
        ? b.lifecyclePhaseSnapshot
        : (projectRows[0].lifecycleStatus ?? "prematurity"));

    // Resolve designated verifier if provided
    let designatedVerifierId: string | null = null;
    let designatedVerifierName: string | null = null;
    if (typeof b.designatedVerifierId === "string") {
      const verifierRows = await db
        .select({ id: usersTable.id, displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, b.designatedVerifierId))
        .limit(1);
      if (!verifierRows[0]) return res.status(400).json({ error: "Designated verifier user not found" });
      designatedVerifierId = verifierRows[0].id;
      designatedVerifierName = verifierRows[0].displayName;
    }

    const [inserted] = await db
      .insert(contributionsTable)
      .values({
        projectId: String(b.projectId),
        partnerId: resolvedParticipantId,
        partnerName: resolvedPartnerName,
        contributionType: cType,
        amount,
        contributionDate: b.contributionDate,
        lifecyclePhaseSnapshot,
        agreementId: typeof b.agreementId === "string" ? b.agreementId : null,
        referenceNumber: typeof b.referenceNumber === "string" ? b.referenceNumber : null,
        remarks: typeof b.remarks === "string" ? b.remarks : null,
        affectsOwnership,
        reimbursementFlag,
        verificationStatus: "draft",
        recordedBy: actor.id,
        recordedByName: actor.name,
        designatedVerifierId,
        designatedVerifierName,
      })
      .returning();

    // Write initial event if a verifier was assigned at creation
    if (designatedVerifierId) {
      void writeVerificationEvent({
        contributionId: inserted.id,
        eventType: "verification_requested",
        actorId: actor.id,
        actorName: actor.name,
        targetUserId: designatedVerifierId,
        targetUserName: designatedVerifierName,
        notes: typeof b.remarks === "string" ? b.remarks : null,
      });
    }

    writeAudit(req, {
      tableName: "contributions",
      recordId: inserted.id,
      operation: "INSERT",
      module: "contributions",
      actionType: "contribution_created",
      projectId: inserted.projectId,
      newData: { contributionType: inserted.contributionType, amount: inserted.amount, partnerName: inserted.partnerName },
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });

    return res.status(201).json(formatContribution({ ...inserted, projectName: projectRows[0].name }));
  },
);

// ── GET /contributions/land-notional ──────────────────────────────────────────
// Returns the single active (non-rejected, non-deleted) land_notional for a
// project, plus project context (lifecycle status, canRecord flag).

router.get("/land-notional", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const [projectRow] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!projectRow) return res.status(404).json({ error: "Project not found" });

  const rows = await db
    .select({ contribution: contributionsTable, projectName: projectsTable.name })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(
      eq(contributionsTable.projectId, projectId),
      eq(contributionsTable.contributionType, "land_notional"),
      isNull(contributionsTable.deletedAt),
      ne(contributionsTable.verificationStatus, "rejected"),
    ))
    .orderBy(desc(contributionsTable.createdAt))
    .limit(1);

  const entry = rows[0]
    ? formatContribution({ ...rows[0].contribution, projectName: rows[0].projectName })
    : null;

  const currentPhase = projectRow.lifecycleStatus ?? "prematurity";

  return res.json({
    entry,
    projectId,
    projectName: projectRow.name,
    lifecycleStatus: currentPhase,
    // canRecord: true only when no active entry exists AND project is still in prematurity
    canRecord: !entry && currentPhase === "prematurity",
    isLocked: currentPhase !== "prematurity",
  });
});

// ── GET /contributions/land-notional/history ───────────────────────────────────
// Returns ALL land_notional entries for a project (including rejected),
// ordered newest-first. Used to display the immutable audit trail.

router.get("/land-notional/history", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db
    .select({ contribution: contributionsTable, projectName: projectsTable.name })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(
      eq(contributionsTable.projectId, projectId),
      eq(contributionsTable.contributionType, "land_notional"),
    ))
    .orderBy(desc(contributionsTable.createdAt));

  return res.json({
    history: rows.map((r) =>
      formatContribution({ ...r.contribution, projectName: r.projectName }),
    ),
  });
});

// ── GET /contributions/pending-verification ────────────────────────────────────
// Returns contributions pending verification for the current user.
// For admin/developer: all pending_verification entries within visible projects.
// For other roles: only entries where they are the designated verifier.
// MUST be registered before /:id to avoid Express treating "pending-verification"
// as an :id parameter value.

router.get("/pending-verification", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({ contributions: [], totalCount: 0 });
    }
  }

  const filterProjectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (filterProjectId) {
    if (visibleProjectIds !== null && !visibleProjectIds.includes(filterProjectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    visibleProjectIds = [filterProjectId];
  }

  const conditions: ReturnType<typeof eq>[] = [
    isNull(contributionsTable.deletedAt) as unknown as ReturnType<typeof eq>,
    eq(contributionsTable.verificationStatus, "pending_verification") as unknown as ReturnType<typeof eq>,
  ];

  if (!canAccessAllProjects(actor.role)) {
    conditions.push(eq(contributionsTable.designatedVerifierId, actor.id) as unknown as ReturnType<typeof eq>);
  }
  if (visibleProjectIds !== null) {
    conditions.push(inArray(contributionsTable.projectId, visibleProjectIds) as unknown as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ contribution: contributionsTable, projectName: projectsTable.name })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(...(conditions as Parameters<typeof and>)))
    .orderBy(desc(contributionsTable.createdAt));

  const contributions = rows.map((r) =>
    formatContribution({ ...r.contribution, projectName: r.projectName }),
  );

  return res.json({ contributions, totalCount: contributions.length });
});

// ── GET /contributions/:id ─────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const id = String(req.params.id);
  const rows = await db
    .select({ contribution: contributionsTable, projectName: projectsTable.name })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
    .limit(1);

  if (!rows[0]) return res.status(404).json({ error: "Contribution not found" });

  const row = rows[0];
  // Role-based project visibility check
  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(row.contribution.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  return res.json(formatContribution({ ...row.contribution, projectName: row.projectName }));
});

// ── PATCH /contributions/:id ───────────────────────────────────────────────────

router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    const current = existing[0];

    // Cannot edit verified or rejected entries (only admin can correct via new manual_adjustment)
    if (current.verificationStatus === "verified" && actor.role !== "admin") {
      return res.status(403).json({ error: "Cannot edit a verified contribution" });
    }

    // ── Ownership freeze / maturity / closed guard ─────────────────────────
    // Edits to ownership-affecting rows are blocked under any lock.
    // We also block if the patch is attempting to FLIP affectsOwnership=true
    // on a previously non-affecting row.
    const bRaw = req.body as Record<string, unknown>;
    const willAffectOwnership =
      current.affectsOwnership ||
      (typeof bRaw.affectsOwnership === "boolean" && bRaw.affectsOwnership === true) ||
      (typeof bRaw.contributionType === "string" &&
        OWNERSHIP_AFFECTING_TYPES.includes(bRaw.contributionType as ContributionType) &&
        bRaw.contributionType !== "manual_adjustment");
    const guardPatch = await assertOwnershipMutationAllowed({
      projectId: current.projectId,
      action: "contribution.patch",
      affectsOwnership: willAffectOwnership,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      req,
      targetTable: "contributions",
      targetRecordId: id,
    });
    if (!guardPatch.ok) return res.status(guardPatch.status).json(guardPatch.body);

    const b = req.body as Record<string, unknown>;
    const updates: Partial<typeof contributionsTable.$inferInsert> = {};

    if ("amount" in b) {
      const amt = parseAmount(b.amount);
      if (!amt) return res.status(400).json({ error: "amount must be a positive number" });
      updates.amount = amt;
    }
    if ("contributionDate" in b) {
      if (!isValidDate(b.contributionDate)) return res.status(400).json({ error: "contributionDate must be YYYY-MM-DD" });
      updates.contributionDate = b.contributionDate;
    }
    if ("contributionType" in b) {
      if (!VALID_CONTRIBUTION_TYPES.includes(b.contributionType as ContributionType)) {
        return res.status(400).json({ error: "Invalid contributionType" });
      }
      updates.contributionType = b.contributionType as ContributionType;
      // Re-derive affectsOwnership when type changes
      if ((b.contributionType as ContributionType) !== "manual_adjustment") {
        updates.affectsOwnership = OWNERSHIP_AFFECTING_TYPES.includes(b.contributionType as ContributionType);
      }
    }
    if ("agreementId" in b) updates.agreementId = b.agreementId === null ? null : (typeof b.agreementId === "string" ? b.agreementId : undefined);
    if ("referenceNumber" in b && typeof b.referenceNumber === "string") updates.referenceNumber = b.referenceNumber;
    if ("remarks" in b && typeof b.remarks === "string") updates.remarks = b.remarks;
    // affectsOwnership override only for manual_adjustment and admin
    if ("affectsOwnership" in b && typeof b.affectsOwnership === "boolean") {
      if (current.contributionType === "manual_adjustment" || actor.role === "admin") {
        updates.affectsOwnership = b.affectsOwnership;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [updated] = await db
      .update(contributionsTable)
      .set(updates)
      .where(eq(contributionsTable.id, id))
      .returning();

    const projectRows = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
  },
);

// ── POST /contributions/:id/submit ─────────────────────────────────────────────

router.post(
  "/:id/submit",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    if (existing[0].verificationStatus !== "draft") {
      return res.status(400).json({ error: "Only draft contributions can be submitted for verification" });
    }

    const [updated] = await db
      .update(contributionsTable)
      .set({ verificationStatus: "pending_verification" })
      .where(eq(contributionsTable.id, id))
      .returning();

    const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
    return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
  },
);

// ── POST /contributions/:id/verify ─────────────────────────────────────────────
// Extended: designated verifier AND admin/developer can approve.
// Handles re_approved event for previously-rejected contributions.

router.post("/:id/verify", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const id = String(req.params.id);
  const existing = await db
    .select({ contribution: contributionsTable, projectName: projectsTable.name })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
    .limit(1);
  if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

  const curr = existing[0].contribution;
  if (curr.verificationStatus === "verified") {
    return res.status(400).json({ error: "Already verified" });
  }

  // Authorization: admin, developer, or the designated verifier
  const isDesignatedVerifier = curr.designatedVerifierId === actor.id;
  const isAdminOrDev = actor.role === "admin" || actor.role === "developer";
  if (!isAdminOrDev && !isDesignatedVerifier) {
    return res.status(403).json({ error: "Only the designated verifier or admin/developer can approve this contribution" });
  }

  // ── Ownership freeze / maturity / closed guard ───────────────────────────
  // Verifying an ownership-affecting contribution would inject equity into a
  // locked project — block it.
  const guardVerify = await assertOwnershipMutationAllowed({
    projectId: curr.projectId,
    action: "contribution.verify",
    affectsOwnership: curr.affectsOwnership === true,
    actor: { id: actor.id, name: actor.name, role: actor.role },
    req,
    targetTable: "contributions",
    targetRecordId: id,
  });
  if (!guardVerify.ok) return res.status(guardVerify.status).json(guardVerify.body);

  const b = req.body as Record<string, unknown>;
  const wasRejected = curr.verificationStatus === "rejected";

  const [updated] = await db
    .update(contributionsTable)
    .set({
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedBy: actor.id,
      verifiedByName: actor.name,
      verifierNotes: typeof b.notes === "string" ? b.notes : null,
    })
    .where(eq(contributionsTable.id, id))
    .returning();

  // Write audit event
  void writeVerificationEvent({
    contributionId: id,
    eventType: wasRejected ? "re_approved" : "approved",
    actorId: actor.id,
    actorName: actor.name,
    notes: typeof b.notes === "string" ? b.notes : null,
  });

  writeAudit(req, {
    tableName: "contributions",
    recordId: id,
    operation: "UPDATE",
    module: "contributions",
    actionType: wasRejected ? "contribution_re_approved" : "contribution_verified",
    projectId: updated.projectId,
    oldData: { verificationStatus: curr.verificationStatus },
    newData: { verificationStatus: "verified" },
    actor: { id: actor.id, name: actor.name, role: actor.role },
  });

  writeTimeline(req, {
    projectId: updated.projectId,
    eventType: TL.CONTRIBUTION_APPROVED,
    title: wasRejected ? "Contribution re-approved after rejection" : "Contribution verified and approved",
    severity: "important",
    relatedTable: "contributions",
    relatedRecordId: id,
    metadata: { contributionId: id, previousStatus: curr.verificationStatus },
  });

  const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
  return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
});

// ── POST /contributions/:id/reject ─────────────────────────────────────────────
// Extended: designated verifier AND admin/developer can reject.

router.post("/:id/reject", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const id = String(req.params.id);
  const existing = await db
    .select()
    .from(contributionsTable)
    .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
    .limit(1);
  if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });
  if (existing[0].verificationStatus === "rejected") {
    return res.status(400).json({ error: "Already rejected" });
  }

  const curr = existing[0];
  const isDesignatedVerifier = curr.designatedVerifierId === actor.id;
  const isAdminOrDev = actor.role === "admin" || actor.role === "developer";
  if (!isAdminOrDev && !isDesignatedVerifier) {
    return res.status(403).json({ error: "Only the designated verifier or admin/developer can reject this contribution" });
  }

  // ── Ownership freeze / maturity / closed guard ───────────────────────────
  // Rejecting a previously-verified ownership-affecting contribution removes
  // it from ownership math (`computeOwnership` only includes verified rows),
  // which constitutes an ownership mutation. Block under any lock.
  const guardReject = await assertOwnershipMutationAllowed({
    projectId: curr.projectId,
    action: "contribution.reject",
    affectsOwnership: curr.affectsOwnership === true,
    actor: { id: actor.id, name: actor.name, role: actor.role },
    req,
    targetTable: "contributions",
    targetRecordId: id,
    metadata: { previousStatus: curr.verificationStatus },
  });
  if (!guardReject.ok) return res.status(guardReject.status).json(guardReject.body);

  const b = req.body as Record<string, unknown>;
  const [updated] = await db
    .update(contributionsTable)
    .set({
      verificationStatus: "rejected",
      verifiedAt: new Date(),
      verifiedBy: actor.id,
      verifiedByName: actor.name,
      verifierNotes: typeof b.notes === "string" ? b.notes : null,
    })
    .where(eq(contributionsTable.id, id))
    .returning();

  void writeVerificationEvent({
    contributionId: id,
    eventType: "rejected",
    actorId: actor.id,
    actorName: actor.name,
    notes: typeof b.notes === "string" ? b.notes : null,
  });

  writeAudit(req, {
    tableName: "contributions",
    recordId: id,
    operation: "UPDATE",
    module: "contributions",
    actionType: "contribution_rejected",
    projectId: updated.projectId,
    oldData: { verificationStatus: curr.verificationStatus },
    newData: { verificationStatus: "rejected" },
    actor: { id: actor.id, name: actor.name, role: actor.role },
  });

  writeTimeline(req, {
    projectId: updated.projectId,
    eventType: TL.CONTRIBUTION_REJECTED,
    title: "Contribution rejected by verifier",
    severity: "important",
    relatedTable: "contributions",
    relatedRecordId: id,
    metadata: { contributionId: id, previousStatus: curr.verificationStatus },
  });

  const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
  return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
});

// ── POST /contributions/:id/request-verification ───────────────────────────────
// Assign or reassign the counterparty verifier. Writes a verification_requested
// or verifier_changed event. The contribution must be non-deleted.

router.post(
  "/:id/request-verification",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    const b = req.body as Record<string, unknown>;
    if (!b.verifierUserId || typeof b.verifierUserId !== "string") {
      return res.status(400).json({ error: "verifierUserId is required" });
    }

    const verifierRows = await db
      .select({ id: usersTable.id, displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, b.verifierUserId))
      .limit(1);
    if (!verifierRows[0]) return res.status(400).json({ error: "Verifier user not found" });

    const hadVerifier = !!existing[0].designatedVerifierId;
    const [updated] = await db
      .update(contributionsTable)
      .set({
        designatedVerifierId: verifierRows[0].id,
        designatedVerifierName: verifierRows[0].displayName,
        // Auto-advance draft to pending_verification when verifier is assigned
        verificationStatus:
          existing[0].verificationStatus === "draft"
            ? "pending_verification"
            : existing[0].verificationStatus,
      })
      .where(eq(contributionsTable.id, id))
      .returning();

    void writeVerificationEvent({
      contributionId: id,
      eventType: hadVerifier ? "verifier_changed" : "verification_requested",
      actorId: actor.id,
      actorName: actor.name,
      targetUserId: verifierRows[0].id,
      targetUserName: verifierRows[0].displayName,
      notes: typeof b.notes === "string" ? b.notes : null,
    });

    const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
    return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
  },
);

// ── GET /contributions/:id/verification-history ────────────────────────────────
// Returns the immutable event timeline for a contribution.

router.get("/:id/verification-history", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const id = String(req.params.id);
  const contribution = await db
    .select()
    .from(contributionsTable)
    .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
    .limit(1);
  if (!contribution[0]) return res.status(404).json({ error: "Contribution not found" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    const isDesignatedVerifier = contribution[0].designatedVerifierId === actor.id;
    if (!assigned.includes(contribution[0].projectId) && !isDesignatedVerifier) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const events = await db
    .select()
    .from(contributionVerificationEventsTable)
    .where(eq(contributionVerificationEventsTable.contributionId, id))
    .orderBy(desc(contributionVerificationEventsTable.createdAt));

  return res.json({
    events: events.map((e) => ({
      id: e.id,
      contributionId: e.contributionId,
      eventType: e.eventType,
      actorId: e.actorId,
      actorName: e.actorName,
      targetUserId: e.targetUserId,
      targetUserName: e.targetUserName,
      notes: e.notes,
      otpSentAt: e.otpSentAt?.toISOString() ?? null,
      otpVerifiedAt: e.otpVerifiedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// ── POST /contributions/dispute-summary ────────────────────────────────────────
// Counts of disputed / pending / rejected contributions per visible project.
// Placed before /:id to avoid route shadowing.

router.get("/dispute-summary", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({
        totalDisputed: 0, totalPending: 0, totalRejected: 0,
        projects: [], blockedProjectIds: [],
      });
    }
  }

  const statusFilter = inArray(contributionsTable.verificationStatus, [
    "pending_verification" as const,
    "rejected" as const,
    "disputed" as const,
  ]);
  const baseWhere = visibleProjectIds
    ? and(
        inArray(contributionsTable.projectId, visibleProjectIds),
        statusFilter,
        isNull(contributionsTable.deletedAt),
      )
    : and(statusFilter, isNull(contributionsTable.deletedAt));

  const rows = await db
    .select({
      projectId: contributionsTable.projectId,
      verificationStatus: contributionsTable.verificationStatus,
    })
    .from(contributionsTable)
    .where(baseWhere);

  const projectMap = new Map<string, { disputed: number; pending: number; rejected: number }>();
  for (const row of rows) {
    if (!projectMap.has(row.projectId)) {
      projectMap.set(row.projectId, { disputed: 0, pending: 0, rejected: 0 });
    }
    const entry = projectMap.get(row.projectId)!;
    if (row.verificationStatus === "disputed") entry.disputed++;
    else if (row.verificationStatus === "pending_verification") entry.pending++;
    else if (row.verificationStatus === "rejected") entry.rejected++;
  }

  const projects = Array.from(projectMap.entries()).map(([projectId, counts]) => ({
    projectId,
    ...counts,
  }));
  const blockedProjectIds = projects.filter((p) => p.disputed > 0).map((p) => p.projectId);

  return res.json({
    totalDisputed: rows.filter((r) => r.verificationStatus === "disputed").length,
    totalPending: rows.filter((r) => r.verificationStatus === "pending_verification").length,
    totalRejected: rows.filter((r) => r.verificationStatus === "rejected").length,
    projects,
    blockedProjectIds,
  });
});

// ── POST /contributions/:id/dispute ────────────────────────────────────────────
// Admin/developer only. Raises a dispute on a verified contribution.
// Triggers governance alert and blocks project from declaring maturity.

router.post(
  "/:id/dispute",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const id = String(req.params.id);
    const b = req.body as Record<string, unknown>;

    if (!b.disputeNotes || typeof b.disputeNotes !== "string" || b.disputeNotes.trim() === "") {
      return res.status(400).json({ error: "disputeNotes is required" });
    }

    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    if (existing[0].verificationStatus !== "verified") {
      return res.status(400).json({
        error: `Only verified contributions can be disputed. Current status: ${existing[0].verificationStatus}`,
      });
    }

    // ── Ownership freeze / maturity / closed guard ─────────────────────────
    // A dispute flips verified → disputed, removing the row from ownership
    // math. Block under any lock for ownership-affecting rows.
    const guardDispute = await assertOwnershipMutationAllowed({
      projectId: existing[0].projectId,
      action: "contribution.dispute",
      affectsOwnership: existing[0].affectsOwnership === true,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      req,
      targetTable: "contributions",
      targetRecordId: id,
    });
    if (!guardDispute.ok) return res.status(guardDispute.status).json(guardDispute.body);

    const [updated] = await db
      .update(contributionsTable)
      .set({
        verificationStatus: "disputed",
        disputeNotes: b.disputeNotes.trim(),
        disputedAt: new Date(),
        disputedBy: actor.id,
        disputedByName: actor.name,
      })
      .where(eq(contributionsTable.id, id))
      .returning();

    void writeVerificationEvent({
      contributionId: id,
      eventType: "dispute_raised",
      actorId: actor.id,
      actorName: actor.name,
      notes: b.disputeNotes.trim(),
    });

    void logDispute(req, {
      projectId: updated.projectId,
      disputeType: DT.CONTRIBUTION,
      severity: "high",
      title: `Contribution dispute raised — ${existing[0].contributionType}`,
      description: b.disputeNotes.trim(),
      relatedTable: "contributions",
      relatedRecordId: id,
      metadata: {
        amount: existing[0].amount,
        contributionType: existing[0].contributionType,
        partnerId: existing[0].partnerId,
      },
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });

    writeAudit(req, {
      tableName: "contributions",
      recordId: id,
      operation: "UPDATE",
      module: "contributions",
      actionType: "contribution_disputed",
      projectId: updated.projectId,
      oldData: { verificationStatus: "verified" },
      newData: { verificationStatus: "disputed", disputeNotes: b.disputeNotes.trim() },
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });

    const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
    return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
  },
);

// ── POST /contributions/:id/resolve-dispute ────────────────────────────────────
// Admin/developer only. Resolves a disputed contribution.
// action = "re_verify" → status becomes verified (clears the maturity block)
// action = "reject"    → status becomes rejected (closes dispute without re-approving)

router.post(
  "/:id/resolve-dispute",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const id = String(req.params.id);
    const b = req.body as Record<string, unknown>;

    if (b.action !== "re_verify" && b.action !== "reject") {
      return res.status(400).json({ error: "action must be 're_verify' or 'reject'" });
    }

    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    if (existing[0].verificationStatus !== "disputed") {
      return res.status(400).json({
        error: `Contribution is not in disputed status. Current status: ${existing[0].verificationStatus}`,
      });
    }

    // ── Ownership freeze / maturity / closed guard ─────────────────────────
    // Re-verifying a disputed ownership-affecting contribution would inject
    // equity into a locked project — block it. A "reject" resolution is
    // permitted because it does NOT create or restore equity.
    if (b.action === "re_verify") {
      const guardReVerify = await assertOwnershipMutationAllowed({
        projectId: existing[0].projectId,
        action: "contribution.dispute_re_verify",
        affectsOwnership: existing[0].affectsOwnership === true,
        actor: { id: actor.id, name: actor.name, role: actor.role },
        req,
        targetTable: "contributions",
        targetRecordId: id,
      });
      if (!guardReVerify.ok) return res.status(guardReVerify.status).json(guardReVerify.body);
    }

    const newStatus = b.action === "re_verify" ? "verified" : "rejected";
    const eventType = b.action === "re_verify" ? "dispute_resolved" : "dispute_overridden";

    const [updated] = await db
      .update(contributionsTable)
      .set({
        verificationStatus: newStatus,
        verifiedAt: new Date(),
        verifiedBy: actor.id,
        verifiedByName: actor.name,
        verifierNotes: typeof b.notes === "string" ? b.notes : null,
      })
      .where(eq(contributionsTable.id, id))
      .returning();

    void writeVerificationEvent({
      contributionId: id,
      eventType,
      actorId: actor.id,
      actorName: actor.name,
      notes: typeof b.notes === "string" ? b.notes : null,
    });

    writeAudit(req, {
      tableName: "contributions",
      recordId: id,
      operation: "UPDATE",
      module: "contributions",
      actionType: "contribution_dispute_resolved",
      projectId: updated.projectId,
      oldData: { verificationStatus: "disputed" },
      newData: { verificationStatus: newStatus, action: b.action },
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });

    void writeOverride(req, {
      projectId: updated.projectId,
      overrideType: b.action === "re_verify" ? OV.CONTRIBUTION_DISPUTE_RESOLVED : OV.CONTRIBUTION_DISPUTE_REJECTED,
      module: "contributions",
      title: b.action === "re_verify"
        ? "Contribution dispute resolved — re-verified"
        : "Contribution dispute resolved — rejected",
      originalValue: { verificationStatus: "disputed", amount: existing[0].amount, contributionType: existing[0].contributionType },
      finalValue: { verificationStatus: newStatus, action: b.action, verifierNotes: typeof b.notes === "string" ? b.notes : null },
      overrideReason: typeof b.notes === "string" ? b.notes : `Admin resolved dispute via ${b.action}`,
      relatedTable: "contributions",
      relatedRecordId: id,
      metadata: { action: b.action, eventType },
    });

    const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
    return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
  },
);

// ── DELETE /contributions/:id ──────────────────────────────────────────────────

router.delete(
  "/:id",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    // ── Ownership freeze / maturity / closed guard ─────────────────────────
    // Deleting an ownership-affecting contribution would mutate the equity
    // base of a locked project — block it. Non-ownership-affecting entries
    // (operational_cost, reimbursable manual_adjustment) remain deletable.
    const guardDelete = await assertOwnershipMutationAllowed({
      projectId: existing[0].projectId,
      action: "contribution.delete",
      affectsOwnership: existing[0].affectsOwnership === true,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      req,
      targetTable: "contributions",
      targetRecordId: id,
    });
    if (!guardDelete.ok) return res.status(guardDelete.status).json(guardDelete.body);

    await db
      .update(contributionsTable)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(contributionsTable.id, id));

    writeAudit(req, {
      tableName: "contributions",
      recordId: id,
      operation: "DELETE",
      module: "contributions",
      actionType: "contribution_deleted",
      projectId: existing[0].projectId,
      oldData: {
        contributionType: existing[0].contributionType,
        amount: existing[0].amount,
        affectsOwnership: existing[0].affectsOwnership,
        verificationStatus: existing[0].verificationStatus,
      },
      actor: { id: actor.id, name: actor.name, role: actor.role },
    });

    return res.status(204).send();
  },
);

export default router;
