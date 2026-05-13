import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, isNull, ne, inArray, desc, sql } from "drizzle-orm";
import {
  db,
  contributionsTable,
  contributionVerificationEventsTable,
  projectsTable,
  partnersTable,
  usersTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

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
    | "otp_verified";
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

router.get("/contributions/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

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
      projectName: projectsTable.name,
    })
    .from(contributionsTable)
    .leftJoin(projectsTable, eq(contributionsTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(contributionsTable.createdAt));

  // Aggregate per project
  const projectMap = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      totalAmount: number;
      verifiedAmount: number;
      ownershipEligibleAmount: number;
      byType: Record<string, number>;
      draftCount: number;
      pendingCount: number;
      verifiedCount: number;
      rejectedCount: number;
    }
  >();

  let grandTotal = 0;
  let grandVerified = 0;
  let grandOwnership = 0;
  let grandCount = 0;

  for (const row of rows) {
    if (!projectMap.has(row.projectId)) {
      projectMap.set(row.projectId, {
        projectId: row.projectId,
        projectName: row.projectName ?? "Unknown Project",
        totalAmount: 0,
        verifiedAmount: 0,
        ownershipEligibleAmount: 0,
        byType: {},
        draftCount: 0,
        pendingCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
      });
    }
    const p = projectMap.get(row.projectId)!;
    p.totalAmount += row.amount;
    p.byType[row.contributionType] = (p.byType[row.contributionType] ?? 0) + row.amount;

    if (row.verificationStatus === "verified") {
      p.verifiedAmount += row.amount;
      grandVerified += row.amount;
      if (row.affectsOwnership && row.lifecyclePhaseSnapshot === "prematurity") {
        p.ownershipEligibleAmount += row.amount;
        grandOwnership += row.amount;
      }
    }

    if (row.verificationStatus === "draft") p.draftCount++;
    if (row.verificationStatus === "pending_verification") p.pendingCount++;
    if (row.verificationStatus === "verified") p.verifiedCount++;
    if (row.verificationStatus === "rejected") p.rejectedCount++;

    grandTotal += row.amount;
    grandCount++;
  }

  return res.json({
    projects: Array.from(projectMap.values()),
    totals: {
      totalAmount: grandTotal,
      verifiedAmount: grandVerified,
      ownershipEligibleAmount: grandOwnership,
      count: grandCount,
    },
  });
});

// ── GET /contributions ────────────────────────────────────────────────────────

router.get("/contributions", async (req, res) => {
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
  "/contributions",
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
    if (!b.partnerName || typeof b.partnerName !== "string") {
      return res.status(400).json({ error: "partnerName is required" });
    }

    const cType = b.contributionType as ContributionType;

    // Auto-determine affectsOwnership: false for operational_cost, true for others
    // Allow explicit override only for manual_adjustment
    let affectsOwnership = OWNERSHIP_AFFECTING_TYPES.includes(cType);
    if (cType === "manual_adjustment" && typeof b.affectsOwnership === "boolean") {
      affectsOwnership = b.affectsOwnership;
    }

    // Fetch current project lifecycle phase for the snapshot
    const projectRows = await db
      .select({ lifecycleStatus: projectsTable.lifecycleStatus, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, String(b.projectId)))
      .limit(1);
    if (!projectRows[0]) return res.status(400).json({ error: "Project not found" });

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
        partnerId: typeof b.partnerId === "string" ? b.partnerId : null,
        partnerName: b.partnerName,
        contributionType: cType,
        amount,
        contributionDate: b.contributionDate,
        lifecyclePhaseSnapshot,
        agreementId: typeof b.agreementId === "string" ? b.agreementId : null,
        referenceNumber: typeof b.referenceNumber === "string" ? b.referenceNumber : null,
        remarks: typeof b.remarks === "string" ? b.remarks : null,
        affectsOwnership,
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

    return res.status(201).json(formatContribution({ ...inserted, projectName: projectRows[0].name }));
  },
);

// ── GET /contributions/land-notional ──────────────────────────────────────────
// Returns the single active (non-rejected, non-deleted) land_notional for a
// project, plus project context (lifecycle status, canRecord flag).

router.get("/contributions/land-notional", async (req, res) => {
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

router.get("/contributions/land-notional/history", async (req, res) => {
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

router.get("/contributions/pending-verification", async (req, res) => {
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

router.get("/contributions/:id", async (req, res) => {
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
  "/contributions/:id",
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
  "/contributions/:id/submit",
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

router.post("/contributions/:id/verify", async (req, res) => {
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

  const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
  return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
});

// ── POST /contributions/:id/reject ─────────────────────────────────────────────
// Extended: designated verifier AND admin/developer can reject.

router.post("/contributions/:id/reject", async (req, res) => {
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

  const projectRows = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, updated.projectId)).limit(1);
  return res.json(formatContribution({ ...updated, projectName: projectRows[0]?.name }));
});

// ── POST /contributions/:id/request-verification ───────────────────────────────
// Assign or reassign the counterparty verifier. Writes a verification_requested
// or verifier_changed event. The contribution must be non-deleted.

router.post(
  "/contributions/:id/request-verification",
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

router.get("/contributions/:id/verification-history", async (req, res) => {
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

// ── DELETE /contributions/:id ──────────────────────────────────────────────────

router.delete(
  "/contributions/:id",
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await db
      .select()
      .from(contributionsTable)
      .where(and(eq(contributionsTable.id, id), isNull(contributionsTable.deletedAt)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Contribution not found" });

    await db
      .update(contributionsTable)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(contributionsTable.id, id));

    return res.status(204).send();
  },
);

export default router;
