/**
 * data_health.ts
 *
 * Admin-only data health and legacy normalization routes.
 * Mounted at /api/admin/data-health.
 *
 * Provides:
 *   GET  /summary                   — aggregated issue counts (all categories)
 *   GET  /orphan-contributors       — contributions with no partnerId link
 *   GET  /lifecycle-violations      — ownership entries in wrong lifecycle phase
 *   GET  /stock-negatives           — projects with negative confirmed stock
 *   GET  /ownership-gaps            — mature projects with no crystallization freeze
 *   GET  /stale-contributions       — entries stuck in draft/pending > 30 days
 *   POST /backfill-crystallization  — retroactively crystallize all ownership-gap projects
 */

import { Router } from "express";
import { requireRole } from "../middlewares/auth";
import {
  db,
  projectsTable,
  contributionsTable,
  inventoryStockMovementsTable,
  projectOwnershipFreezesTable,
  ownershipSnapshotsTable,
  usersTable,
  partnersTable,
  personMasterTable,
  projectParticipantsTable,
  partnerClaimantsTable,
  ownershipTransfersTable,
  inheritanceClaimsTable,
  type OwnershipSnapshotEntry,
} from "@workspace/db";
import { eq, and, isNull, lt, gt, sql, inArray, not, isNotNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router = Router();

// All routes require admin role
router.use(requireRole("admin", "developer"));

// ── GET /summary ─────────────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  const [
    orphanCount,
    violationCount,
    stockNegativeCount,
    ownershipGapCount,
    staleCount,
    contributionsAfterFreezeCount,
    contributionsVerifiedAfterMaturityCount,
    draftsOnMaturedCount,
    closedProjectActivityCount,
    // Partner identity foundation counters
    partnersWithoutPersonMasterCount,
    inactivePartnersWithOwnershipCount,
    duplicatePartnersPerPersonCount,
    participantsMissingPartnerCount,
    snapshotUnknownPartnersCount,
    transfersInvalidPartnerCount,
    inheritanceInvalidPartnerCount,
  ] = await Promise.all([
    // Orphan contributors: contributions with no partnerId
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .where(
        and(
          isNull(contributionsTable.partnerId),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Lifecycle violations: ownership-affecting entries NOT in prematurity
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .where(
        and(
          eq(contributionsTable.affectsOwnership, true),
          not(eq(contributionsTable.lifecyclePhaseSnapshot, "prematurity")),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Stock negatives: projects with any negative confirmed balance
    db
      .select({
        projectId: inventoryStockMovementsTable.projectId,
        stockType: inventoryStockMovementsTable.stockType,
        balance: sql<number>`
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      })
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.isActive, true))
      .groupBy(
        inventoryStockMovementsTable.projectId,
        inventoryStockMovementsTable.stockType,
      )
      .having(
        sql`(
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)
        ) < 0`,
      )
      .then((rows) => rows.length),

    // Ownership gaps: mature/closed projects with no freeze record
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
          isNull(projectsTable.ownershipFrozenAt),
        ),
      )
      .then((rows) => rows.length),

    // Stale contributions: draft/pending > 30 days
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .where(
        and(
          inArray(contributionsTable.verificationStatus, [
            "draft",
            "pending_verification",
          ]),
          lt(contributionsTable.createdAt, sql`NOW() - INTERVAL '30 days'`),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Ownership-affecting contributions created AFTER an active freeze.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .innerJoin(
        projectOwnershipFreezesTable,
        eq(projectOwnershipFreezesTable.projectId, contributionsTable.projectId),
      )
      .where(
        and(
          eq(contributionsTable.affectsOwnership, true),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
          gt(contributionsTable.createdAt, projectOwnershipFreezesTable.frozenAt),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Ownership-affecting contributions verified after the project reached maturity.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .innerJoin(
        projectsTable,
        eq(projectsTable.id, contributionsTable.projectId),
      )
      .where(
        and(
          eq(contributionsTable.affectsOwnership, true),
          eq(contributionsTable.verificationStatus, "verified"),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
          inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
          isNotNull(projectsTable.ownershipFrozenAt),
          isNotNull(contributionsTable.verifiedAt),
          gt(contributionsTable.verifiedAt, projectsTable.ownershipFrozenAt),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Ownership-affecting draft/pending contributions remaining on matured projects.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, contributionsTable.projectId))
      .where(
        and(
          eq(contributionsTable.affectsOwnership, true),
          inArray(contributionsTable.verificationStatus, ["draft", "pending_verification", "disputed"]),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
          inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Closed projects with any ownership-affecting contribution activity.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, contributionsTable.projectId))
      .where(
        and(
          eq(projectsTable.lifecycleStatus, "closed"),
          eq(contributionsTable.affectsOwnership, true),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // ── Partner identity foundation ─────────────────────────────────────────
    // 1. Partners with no person_master link.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(partnersTable)
      .where(and(isNull(partnersTable.personMasterId), isNull(partnersTable.deletedAt)))
      .then(([r]) => Number(r?.count ?? 0)),

    // 2. Inactive or soft-deleted partners that still own at least one
    // ownership-affecting, non-deleted contribution.
    db
      .select({ count: sql<number>`count(DISTINCT ${partnersTable.id})::int` })
      .from(partnersTable)
      .innerJoin(
        contributionsTable,
        eq(contributionsTable.partnerId, partnersTable.id),
      )
      .where(
        and(
          eq(contributionsTable.affectsOwnership, true),
          isNull(contributionsTable.deletedAt),
          eq(contributionsTable.isActive, true),
          // Either inactive or soft-deleted
          sql`(${partnersTable.isActive} = false OR ${partnersTable.deletedAt} IS NOT NULL)`,
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // 3. Persons with >1 non-deleted partner row pointing at them.
    db
      .select({
        personMasterId: partnersTable.personMasterId,
        c: sql<number>`count(*)::int`,
      })
      .from(partnersTable)
      .where(
        and(
          isNull(partnersTable.deletedAt),
          // personMasterId not null
          sql`${partnersTable.personMasterId} IS NOT NULL`,
        ),
      )
      .groupBy(partnersTable.personMasterId)
      .having(sql`count(*) > 1`)
      .then((rows) => rows.length),

    // 4. Project participants in ownership-bearing roles (landowner/investor)
    // whose person has no active, non-deleted partner row.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectParticipantsTable)
      .where(
        and(
          inArray(projectParticipantsTable.role, ["landowner", "investor"]),
          sql`${projectParticipantsTable.personMasterId} IS NOT NULL`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${partnersTable} p
            WHERE p.person_master_id = ${projectParticipantsTable.personMasterId}
              AND p.is_active = true
              AND p.deleted_at IS NULL
          )`,
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // 5. Ownership snapshots that reference a partnerId that does not exist
    // in the partners table (scans the JSON entries[] column).
    // UUID-safe: only cast values matching the canonical UUID regex; values
    // failing the pattern are surfaced as anomalies on their own (any
    // non-null, non-UUID string is by definition unknown to partners).
    db.execute(sql`
      WITH raw AS (
        SELECT DISTINCT (e->>'partnerId') AS pid_text
        FROM ${ownershipSnapshotsTable},
             jsonb_array_elements(${ownershipSnapshotsTable.entries}::jsonb) AS e
        WHERE (e->>'partnerId') IS NOT NULL
      )
      SELECT count(*)::int AS c
      FROM raw
      WHERE pid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (
              SELECT 1 FROM ${partnersTable} p WHERE p.id = raw.pid_text::uuid
            )
    `).then((r: any) => Number(r?.rows?.[0]?.c ?? 0)),

    // 6. Transfers (non-cancelled) referencing a partner whose identity is
    // invalid: missing, inactive, soft-deleted, or missing person link.
    db
      .select({ count: sql<number>`count(DISTINCT ${ownershipTransfersTable.id})::int` })
      .from(ownershipTransfersTable)
      .where(
        and(
          sql`${ownershipTransfersTable.status} <> 'cancelled'`,
          sql`(
            NOT EXISTS (
              SELECT 1 FROM ${partnersTable} p
              WHERE p.id = ${ownershipTransfersTable.transferorPartnerId}
                AND p.is_active = true
                AND p.deleted_at IS NULL
                AND p.person_master_id IS NOT NULL
            )
            OR (
              ${ownershipTransfersTable.buyerPartnerId} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM ${partnersTable} p
                WHERE p.id = ${ownershipTransfersTable.buyerPartnerId}
                  AND p.is_active = true
                  AND p.deleted_at IS NULL
                  AND p.person_master_id IS NOT NULL
              )
            )
          )`,
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // 7. Inheritance claims (non-rejected) referencing a partner whose
    // identity is invalid: missing, inactive, soft-deleted, or missing
    // person link.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inheritanceClaimsTable)
      .where(
        and(
          sql`${inheritanceClaimsTable.status} <> 'rejected'`,
          eq(inheritanceClaimsTable.isActive, true),
          sql`NOT EXISTS (
            SELECT 1 FROM ${partnersTable} p
            WHERE p.id = ${inheritanceClaimsTable.partnerId}
              AND p.is_active = true
              AND p.deleted_at IS NULL
              AND p.person_master_id IS NOT NULL
          )`,
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),
  ]);

  req.log.info(
    {
      orphanCount,
      violationCount,
      stockNegativeCount,
      ownershipGapCount,
      staleCount,
      contributionsAfterFreezeCount,
      contributionsVerifiedAfterMaturityCount,
      draftsOnMaturedCount,
      closedProjectActivityCount,
    },
    "data-health summary fetched",
  );

  return res.json({
    orphanContributors: orphanCount,
    lifecycleViolations: violationCount,
    stockNegatives: stockNegativeCount,
    ownershipGaps: ownershipGapCount,
    staleContributions: staleCount,
    contributionsAfterFreeze: contributionsAfterFreezeCount,
    contributionsVerifiedAfterMaturity: contributionsVerifiedAfterMaturityCount,
    draftOwnershipContribsOnMatured: draftsOnMaturedCount,
    closedProjectOwnershipActivity: closedProjectActivityCount,
    partnersWithoutPersonMaster: partnersWithoutPersonMasterCount,
    inactivePartnersWithOwnership: inactivePartnersWithOwnershipCount,
    duplicatePartnersPerPerson: duplicatePartnersPerPersonCount,
    participantsMissingPartner: participantsMissingPartnerCount,
    snapshotUnknownPartners: snapshotUnknownPartnersCount,
    transfersInvalidPartner: transfersInvalidPartnerCount,
    inheritanceInvalidPartner: inheritanceInvalidPartnerCount,
    totalIssues:
      orphanCount +
      violationCount +
      stockNegativeCount +
      ownershipGapCount +
      staleCount +
      contributionsAfterFreezeCount +
      contributionsVerifiedAfterMaturityCount +
      draftsOnMaturedCount +
      closedProjectActivityCount +
      partnersWithoutPersonMasterCount +
      inactivePartnersWithOwnershipCount +
      duplicatePartnersPerPersonCount +
      participantsMissingPartnerCount +
      snapshotUnknownPartnersCount +
      transfersInvalidPartnerCount +
      inheritanceInvalidPartnerCount,
    fetchedAt: new Date().toISOString(),
  });
});

// ── GET /contributions-after-freeze ──────────────────────────────────────────
// Ownership-affecting contributions created after the project ownership freeze.
router.get("/contributions-after-freeze", async (_req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      projectId: contributionsTable.projectId,
      partnerName: contributionsTable.partnerName,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      verificationStatus: contributionsTable.verificationStatus,
      contributionCreatedAt: contributionsTable.createdAt,
      freezeFrozenAt: projectOwnershipFreezesTable.frozenAt,
      freezeStatus: projectOwnershipFreezesTable.status,
    })
    .from(contributionsTable)
    .innerJoin(
      projectOwnershipFreezesTable,
      eq(projectOwnershipFreezesTable.projectId, contributionsTable.projectId),
    )
    .where(
      and(
        eq(contributionsTable.affectsOwnership, true),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
        gt(contributionsTable.createdAt, projectOwnershipFreezesTable.frozenAt),
      ),
    )
    .orderBy(contributionsTable.createdAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// ── GET /verified-after-maturity ─────────────────────────────────────────────
router.get("/verified-after-maturity", async (_req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      projectId: contributionsTable.projectId,
      partnerName: contributionsTable.partnerName,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      verifiedAt: contributionsTable.verifiedAt,
      lifecycleStatus: projectsTable.lifecycleStatus,
      ownershipFrozenAt: projectsTable.ownershipFrozenAt,
    })
    .from(contributionsTable)
    .innerJoin(projectsTable, eq(projectsTable.id, contributionsTable.projectId))
    .where(
      and(
        eq(contributionsTable.affectsOwnership, true),
        eq(contributionsTable.verificationStatus, "verified"),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
        inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
        isNotNull(projectsTable.ownershipFrozenAt),
        isNotNull(contributionsTable.verifiedAt),
        gt(contributionsTable.verifiedAt, projectsTable.ownershipFrozenAt),
      ),
    )
    .orderBy(contributionsTable.verifiedAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// ── GET /drafts-on-matured ───────────────────────────────────────────────────
router.get("/drafts-on-matured", async (_req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      projectId: contributionsTable.projectId,
      partnerName: contributionsTable.partnerName,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      verificationStatus: contributionsTable.verificationStatus,
      createdAt: contributionsTable.createdAt,
      lifecycleStatus: projectsTable.lifecycleStatus,
    })
    .from(contributionsTable)
    .innerJoin(projectsTable, eq(projectsTable.id, contributionsTable.projectId))
    .where(
      and(
        eq(contributionsTable.affectsOwnership, true),
        inArray(contributionsTable.verificationStatus, ["draft", "pending_verification", "disputed"]),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
        inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
      ),
    )
    .orderBy(contributionsTable.createdAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// ── GET /closed-project-activity ─────────────────────────────────────────────
router.get("/closed-project-activity", async (_req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      projectId: contributionsTable.projectId,
      partnerName: contributionsTable.partnerName,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      verificationStatus: contributionsTable.verificationStatus,
      createdAt: contributionsTable.createdAt,
    })
    .from(contributionsTable)
    .innerJoin(projectsTable, eq(projectsTable.id, contributionsTable.projectId))
    .where(
      and(
        eq(projectsTable.lifecycleStatus, "closed"),
        eq(contributionsTable.affectsOwnership, true),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
      ),
    )
    .orderBy(contributionsTable.createdAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// ── GET /orphan-contributors ──────────────────────────────────────────────────
router.get("/orphan-contributors", async (req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      partnerName: contributionsTable.partnerName,
      projectId: contributionsTable.projectId,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      verificationStatus: contributionsTable.verificationStatus,
      createdAt: contributionsTable.createdAt,
    })
    .from(contributionsTable)
    .where(
      and(
        isNull(contributionsTable.partnerId),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
      ),
    )
    .orderBy(contributionsTable.createdAt)
    .limit(200);

  return res.json({ items: rows, count: rows.length });
});

// ── GET /lifecycle-violations ─────────────────────────────────────────────────
router.get("/lifecycle-violations", async (req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      partnerName: contributionsTable.partnerName,
      projectId: contributionsTable.projectId,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      affectsOwnership: contributionsTable.affectsOwnership,
      lifecyclePhaseSnapshot: contributionsTable.lifecyclePhaseSnapshot,
      verificationStatus: contributionsTable.verificationStatus,
      reimbursementFlag: contributionsTable.reimbursementFlag,
      createdAt: contributionsTable.createdAt,
    })
    .from(contributionsTable)
    .where(
      and(
        eq(contributionsTable.affectsOwnership, true),
        not(eq(contributionsTable.lifecyclePhaseSnapshot, "prematurity")),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
      ),
    )
    .orderBy(contributionsTable.createdAt)
    .limit(200);

  return res.json({ items: rows, count: rows.length });
});

// ── GET /stock-negatives ──────────────────────────────────────────────────────
router.get("/stock-negatives", async (req, res) => {
  const rows = await db
    .select({
      projectId: inventoryStockMovementsTable.projectId,
      stockType: inventoryStockMovementsTable.stockType,
      unit: inventoryStockMovementsTable.unit,
      confirmedIn: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
        AND ${inventoryStockMovementsTable.status} = 'confirmed'
        THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      confirmedOut: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
        AND ${inventoryStockMovementsTable.status} = 'confirmed'
        THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      balance: sql<number>`
        COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
          AND ${inventoryStockMovementsTable.status} = 'confirmed'
          THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
          AND ${inventoryStockMovementsTable.status} = 'confirmed'
          THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
    })
    .from(inventoryStockMovementsTable)
    .where(eq(inventoryStockMovementsTable.isActive, true))
    .groupBy(
      inventoryStockMovementsTable.projectId,
      inventoryStockMovementsTable.stockType,
      inventoryStockMovementsTable.unit,
    )
    .having(
      sql`(
        COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
          AND ${inventoryStockMovementsTable.status} = 'confirmed'
          THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
          AND ${inventoryStockMovementsTable.status} = 'confirmed'
          THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)
      ) < 0`,
    )
    .orderBy(
      sql`(
        COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
          AND ${inventoryStockMovementsTable.status} = 'confirmed'
          THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
          AND ${inventoryStockMovementsTable.status} = 'confirmed'
          THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)
      )`,
    );

  return res.json({ items: rows.map(r => ({ ...r, balance: Number(r.balance), confirmedIn: Number(r.confirmedIn), confirmedOut: Number(r.confirmedOut) })), count: rows.length });
});

// ── GET /ownership-gaps ───────────────────────────────────────────────────────
router.get("/ownership-gaps", async (req, res) => {
  const rows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      lifecycleStatus: projectsTable.lifecycleStatus,
      commercialModel: projectsTable.commercialModel,
      ownershipFrozenAt: projectsTable.ownershipFrozenAt,
    })
    .from(projectsTable)
    .where(
      and(
        inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
        isNull(projectsTable.ownershipFrozenAt),
      ),
    )
    .orderBy(projectsTable.name);

  return res.json({ items: rows, count: rows.length });
});

// ── GET /stale-contributions ──────────────────────────────────────────────────
router.get("/stale-contributions", async (req, res) => {
  const rows = await db
    .select({
      id: contributionsTable.id,
      partnerName: contributionsTable.partnerName,
      projectId: contributionsTable.projectId,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
      verificationStatus: contributionsTable.verificationStatus,
      affectsOwnership: contributionsTable.affectsOwnership,
      createdAt: contributionsTable.createdAt,
    })
    .from(contributionsTable)
    .where(
      and(
        inArray(contributionsTable.verificationStatus, [
          "draft",
          "pending_verification",
        ]),
        lt(contributionsTable.createdAt, sql`NOW() - INTERVAL '30 days'`),
        eq(contributionsTable.isActive, true),
        isNull(contributionsTable.deletedAt),
      ),
    )
    .orderBy(contributionsTable.createdAt)
    .limit(200);

  return res.json({ items: rows, count: rows.length });
});

// ── POST /backfill-crystallization ────────────────────────────────────────────
// Retroactively crystallize ownership for all mature/closed projects that have
// no freeze record. This corrects projects that transitioned to mature_production
// before the auto-crystallization engine was deployed.
router.post("/backfill-crystallization", requireRole("admin"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const [actorRow] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  const actingUserId = actorRow?.id;
  const actingUserName = actorRow?.displayName ?? "System Backfill";

  // Find all mature/closed projects without an ownershipFrozenAt stamp
  const gapProjects = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(
      and(
        inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
        isNull(projectsTable.ownershipFrozenAt),
      ),
    );

  if (gapProjects.length === 0) {
    return res.json({ ok: true, processed: 0, results: [], message: "No ownership gaps found — all mature projects are already crystallized." });
  }

  const results: Array<{ projectId: string; projectName: string; status: "crystallized" | "skipped" | "error"; partnerCount?: number; error?: string }> = [];

  for (const project of gapProjects) {
    try {
      const crystalRows = await db
        .select({
          partnerId: contributionsTable.partnerId,
          partnerName: sql<string>`MAX(${contributionsTable.partnerName})`,
          landAmount: sql<number>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.contributionType} = 'land_notional'), 0)`,
          economicAmount: sql<number>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.contributionType} = 'economic_investment'), 0)`,
          totalAmount: sql<number>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.affectsOwnership} = true), 0)`,
        })
        .from(contributionsTable)
        .where(
          and(
            eq(contributionsTable.projectId, project.id),
            eq(contributionsTable.verificationStatus, "verified"),
            eq(contributionsTable.isActive, true),
            isNull(contributionsTable.deletedAt),
          ),
        )
        .groupBy(contributionsTable.partnerId)
        .having(
          sql`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.affectsOwnership} = true), 0) > 0`,
        );

      const grandTotal = crystalRows.reduce((acc, r) => acc + Number(r.totalAmount), 0);
      const landTotal = crystalRows.reduce((acc, r) => acc + Number(r.landAmount), 0);
      const economicTotal = crystalRows.reduce((acc, r) => acc + Number(r.economicAmount), 0);

      const entries: OwnershipSnapshotEntry[] = crystalRows.map((r) => ({
        partnerKey: r.partnerId ?? r.partnerName,
        partnerId: r.partnerId ?? null,
        partnerName: r.partnerName,
        landAmount: Number(r.landAmount),
        economicAmount: Number(r.economicAmount),
        totalAmount: Number(r.totalAmount),
        percentage:
          grandTotal > 0
            ? Math.round((Number(r.totalAmount) / grandTotal) * 10000) / 100
            : 0,
      }));

      await db.insert(ownershipSnapshotsTable).values({
        projectId: project.id,
        snapshotType: "maturity_declaration",
        lifecycleStatus: "mature_production",
        totalRecognizedAmount: grandTotal,
        landTotal,
        economicTotal,
        entries,
        notes: `Backfill crystallization by ${actingUserName} via Data Health dashboard`,
        triggeredBy: actingUserId ?? null,
        triggeredByName: actingUserName,
      });

      await db
        .insert(projectOwnershipFreezesTable)
        .values({
          projectId: project.id,
          status: "frozen",
          frozenBy: actingUserId ?? null,
          frozenByName: actingUserName,
          notes: "Ownership frozen via Data Health backfill — retroactive crystallization",
        })
        .onConflictDoNothing();

      await db
        .update(projectsTable)
        .set({ ownershipFrozenAt: new Date() })
        .where(eq(projectsTable.id, project.id));

      results.push({
        projectId: project.id,
        projectName: project.name,
        status: "crystallized",
        partnerCount: entries.length,
      });

      req.log.info(
        { projectId: project.id, partnerCount: entries.length, grandTotal },
        "backfill: ownership crystallized",
      );
    } catch (err) {
      req.log.error({ projectId: project.id, err }, "backfill: crystallization failed");
      results.push({
        projectId: project.id,
        projectName: project.name,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const crystallized = results.filter((r) => r.status === "crystallized").length;
  const errors = results.filter((r) => r.status === "error").length;

  req.log.info(
    { crystallized, errors, total: gapProjects.length },
    "backfill-crystallization complete",
  );

  return res.json({
    ok: errors === 0,
    processed: gapProjects.length,
    crystallized,
    errors,
    results,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Partner Identity Foundation — list endpoints (top 200)
// ─────────────────────────────────────────────────────────────────────────────

// 1. Partners with no person_master link.
router.get("/partners-without-person-master", async (_req, res) => {
  const rows = await db
    .select({
      id: partnersTable.id,
      name: partnersTable.name,
      role: partnersTable.role,
      isActive: partnersTable.isActive,
      createdAt: partnersTable.createdAt,
    })
    .from(partnersTable)
    .where(and(isNull(partnersTable.personMasterId), isNull(partnersTable.deletedAt)))
    .orderBy(partnersTable.createdAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// 2. Inactive (or soft-deleted) partners that still hold ownership-affecting
// contributions.
router.get("/inactive-partners-with-ownership", async (_req, res) => {
  const rows = await db
    .select({
      partnerId: partnersTable.id,
      partnerName: partnersTable.name,
      partnerIsActive: partnersTable.isActive,
      partnerDeletedAt: partnersTable.deletedAt,
      contributionCount: sql<number>`count(${contributionsTable.id})::int`,
    })
    .from(partnersTable)
    .innerJoin(
      contributionsTable,
      eq(contributionsTable.partnerId, partnersTable.id),
    )
    .where(
      and(
        eq(contributionsTable.affectsOwnership, true),
        isNull(contributionsTable.deletedAt),
        eq(contributionsTable.isActive, true),
        sql`(${partnersTable.isActive} = false OR ${partnersTable.deletedAt} IS NOT NULL)`,
      ),
    )
    .groupBy(partnersTable.id, partnersTable.name, partnersTable.isActive, partnersTable.deletedAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// 3. Persons with multiple non-deleted partner rows.
router.get("/duplicate-partners-per-person", async (_req, res) => {
  const rows = await db
    .select({
      personMasterId: partnersTable.personMasterId,
      partnerCount: sql<number>`count(*)::int`,
      partnerIds: sql<string[]>`array_agg(${partnersTable.id}::text)`,
      partnerNames: sql<string[]>`array_agg(${partnersTable.name})`,
    })
    .from(partnersTable)
    .where(
      and(
        isNull(partnersTable.deletedAt),
        sql`${partnersTable.personMasterId} IS NOT NULL`,
      ),
    )
    .groupBy(partnersTable.personMasterId)
    .having(sql`count(*) > 1`)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

// 4. Landowner/investor participants whose person has no active partner row.
router.get("/participants-missing-partner", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      pp.id              AS "participantId",
      pp.project_id      AS "projectId",
      pp.role            AS "role",
      pp.full_name       AS "fullName",
      pp.person_master_id AS "personMasterId"
    FROM ${projectParticipantsTable} pp
    WHERE pp.role IN ('landowner', 'investor')
      AND pp.person_master_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${partnersTable} p
        WHERE p.person_master_id = pp.person_master_id
          AND p.is_active = true
          AND p.deleted_at IS NULL
      )
    ORDER BY pp.created_at
    LIMIT 200
  `);
  const items = (rows as any).rows ?? [];
  return res.json({ items, count: items.length });
});

// 5. Ownership snapshots whose entries[].partnerId is malformed or not in
// partners. UUID-safe: only cast strings matching the canonical UUID regex.
// Malformed (non-UUID, non-null) values are flagged as "malformed".
router.get("/snapshot-unknown-partners", async (_req, res) => {
  const result = await db.execute(sql`
    WITH raw AS (
      SELECT
        s.id            AS snapshot_id,
        s.project_id    AS project_id,
        s.snapshot_type AS snapshot_type,
        s.snapshot_at   AS snapshot_at,
        e->>'partnerId' AS pid_text,
        e->>'partnerName' AS partner_name,
        e->>'percentage'  AS percentage
      FROM ${ownershipSnapshotsTable} s,
           jsonb_array_elements(s.entries::jsonb) AS e
      WHERE (e->>'partnerId') IS NOT NULL
    )
    SELECT
      snapshot_id    AS "snapshotId",
      project_id     AS "projectId",
      snapshot_type  AS "snapshotType",
      snapshot_at    AS "snapshotAt",
      pid_text       AS "unknownPartnerId",
      partner_name   AS "partnerName",
      percentage     AS "percentage",
      CASE
        WHEN pid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN 'malformed'
        ELSE 'not_in_partners'
      END AS "reason"
    FROM raw
    WHERE pid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (
            SELECT 1 FROM ${partnersTable} p WHERE p.id = raw.pid_text::uuid
          )
    ORDER BY snapshot_at DESC
    LIMIT 200
  `);
  const items = (result as any).rows ?? [];
  return res.json({ items, count: items.length });
});

// 6. Transfers referencing an invalid partner (transferor or buyer).
router.get("/transfers-invalid-partner", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      t.id                       AS "transferId",
      t.project_id               AS "projectId",
      t.status                   AS "status",
      t.transferor_partner_id    AS "transferorPartnerId",
      t.buyer_partner_id         AS "buyerPartnerId",
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM ${partnersTable} p
          WHERE p.id = t.transferor_partner_id
            AND p.is_active = true
            AND p.deleted_at IS NULL
            AND p.person_master_id IS NOT NULL
        ) THEN 'transferor'
        ELSE 'buyer'
      END AS "invalidSide"
    FROM ${ownershipTransfersTable} t
    WHERE t.status <> 'cancelled'
      AND (
        NOT EXISTS (
          SELECT 1 FROM ${partnersTable} p
          WHERE p.id = t.transferor_partner_id
            AND p.is_active = true
            AND p.deleted_at IS NULL
            AND p.person_master_id IS NOT NULL
        )
        OR (
          t.buyer_partner_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${partnersTable} p
            WHERE p.id = t.buyer_partner_id
              AND p.is_active = true
              AND p.deleted_at IS NULL
              AND p.person_master_id IS NOT NULL
          )
        )
      )
    ORDER BY t.created_at DESC
    LIMIT 200
  `);
  const items = (rows as any).rows ?? [];
  return res.json({ items, count: items.length });
});

// 7. Inheritance claims referencing an invalid source partner.
router.get("/inheritance-invalid-partner", async (_req, res) => {
  const rows = await db
    .select({
      claimId: inheritanceClaimsTable.id,
      projectId: inheritanceClaimsTable.projectId,
      partnerId: inheritanceClaimsTable.partnerId,
      status: inheritanceClaimsTable.status,
      claimType: inheritanceClaimsTable.claimType,
      createdAt: inheritanceClaimsTable.createdAt,
    })
    .from(inheritanceClaimsTable)
    .where(
      and(
        sql`${inheritanceClaimsTable.status} <> 'rejected'`,
        eq(inheritanceClaimsTable.isActive, true),
        sql`NOT EXISTS (
          SELECT 1 FROM ${partnersTable} p
          WHERE p.id = ${inheritanceClaimsTable.partnerId}
            AND p.is_active = true
            AND p.deleted_at IS NULL
            AND p.person_master_id IS NOT NULL
        )`,
      ),
    )
    .orderBy(inheritanceClaimsTable.createdAt)
    .limit(200);
  return res.json({ items: rows, count: rows.length });
});

export default router;
