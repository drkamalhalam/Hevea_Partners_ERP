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
import { eq, and, isNull, lt, gt, sql, inArray, not, isNotNull, or } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { assertOwnershipAttributionValid } from "../lib/ownershipAttributionGuard";

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
    // Ownership attribution hardening — continuous integrity counters
    ownershipAffectingInvalidIdentityCount,
    snapshotsWithInactivePartnerCount,
    snapshotsWithInactivePersonCount,
    crystallizationCandidatesInvalidCount,
    transferWorkflowInactiveIdentityCount,
    inheritanceWorkflowInactiveIdentityCount,
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

    // 8. Ownership-affecting contributions whose partner identity chain is
    // invalid (missing/inactive partner, missing person link, or person inactive).
    db.execute(sql`
      SELECT COUNT(*)::int AS count FROM contributions c
      LEFT JOIN partners p ON p.id = c.partner_id
      LEFT JOIN person_master pm ON pm.id = p.person_master_id
      WHERE c.affects_ownership = true
        AND c.is_active = true
        AND c.deleted_at IS NULL
        AND (
          c.partner_id IS NULL
          OR p.id IS NULL
          OR p.deleted_at IS NOT NULL
          OR p.is_active = false
          OR p.person_master_id IS NULL
          OR pm.id IS NULL
          OR pm.status <> 'active'
        )
    `).then((r) => Number((r.rows?.[0] as { count?: number } | undefined)?.count ?? 0)),

    // 9. Stored snapshots whose entries reference a partner now inactive/deleted/missing.
    db.execute(sql`
      SELECT COUNT(DISTINCT s.id)::int AS count
      FROM ownership_snapshots s
      CROSS JOIN LATERAL jsonb_array_elements(s.entries) AS entry
      LEFT JOIN partners p ON p.id = NULLIF(entry->>'partnerId', '')::uuid
      WHERE (entry->>'partnerId') IS NOT NULL AND (entry->>'partnerId') <> ''
        AND (p.id IS NULL OR p.deleted_at IS NOT NULL OR p.is_active = false)
    `).then((r) => Number((r.rows?.[0] as { count?: number } | undefined)?.count ?? 0)),

    // 10. Stored snapshots whose partner's person_master is now missing/inactive.
    db.execute(sql`
      SELECT COUNT(DISTINCT s.id)::int AS count
      FROM ownership_snapshots s
      CROSS JOIN LATERAL jsonb_array_elements(s.entries) AS entry
      LEFT JOIN partners p ON p.id = NULLIF(entry->>'partnerId', '')::uuid
      LEFT JOIN person_master pm ON pm.id = p.person_master_id
      WHERE (entry->>'partnerId') IS NOT NULL AND (entry->>'partnerId') <> ''
        AND p.id IS NOT NULL
        AND (p.person_master_id IS NULL OR pm.id IS NULL OR pm.status <> 'active')
    `).then((r) => Number((r.rows?.[0] as { count?: number } | undefined)?.count ?? 0)),

    // 11. Projects awaiting crystallization (mature/closed + not yet frozen)
    // whose verified contributions reference invalid identities — backfill
    // candidates that will be skipped by the attribution gate.
    db.execute(sql`
      SELECT COUNT(DISTINCT pr.id)::int AS count
      FROM projects pr
      JOIN contributions c ON c.project_id = pr.id
        AND c.is_active = true AND c.deleted_at IS NULL
        AND c.verification_status = 'verified'
        AND c.affects_ownership = true
      LEFT JOIN partners p ON p.id = c.partner_id
      LEFT JOIN person_master pm ON pm.id = p.person_master_id
      WHERE pr.lifecycle_status IN ('mature_production', 'closed')
        AND pr.ownership_frozen_at IS NULL
        AND (
          c.partner_id IS NULL
          OR p.id IS NULL
          OR p.deleted_at IS NOT NULL
          OR p.is_active = false
          OR p.person_master_id IS NULL
          OR pm.id IS NULL
          OR pm.status <> 'active'
        )
    `).then((r) => Number((r.rows?.[0] as { count?: number } | undefined)?.count ?? 0)),

    // 12. In-flight transfers (not yet executed/rejected/cancelled) whose
    // transferor or buyer identity is currently invalid.
    db.execute(sql`
      SELECT COUNT(DISTINCT t.id)::int AS count
      FROM ownership_transfers t
      LEFT JOIN partners tp ON tp.id = t.transferor_partner_id
      LEFT JOIN person_master tpm ON tpm.id = tp.person_master_id
      LEFT JOIN partners bp ON bp.id = t.buyer_partner_id
      LEFT JOIN person_master bpm ON bpm.id = bp.person_master_id
      WHERE t.status NOT IN ('executed', 'cancelled', 'expired')
        AND (
          tp.id IS NULL
          OR tp.deleted_at IS NOT NULL
          OR tp.is_active = false
          OR tp.person_master_id IS NULL
          OR tpm.id IS NULL
          OR tpm.status <> 'active'
          OR (
            t.buyer_partner_id IS NOT NULL
            AND (
              bp.id IS NULL
              OR bp.deleted_at IS NOT NULL
              OR bp.is_active = false
              OR bp.person_master_id IS NULL
              OR bpm.id IS NULL
              OR bpm.status <> 'active'
            )
          )
        )
    `).then((r) => Number((r.rows?.[0] as { count?: number } | undefined)?.count ?? 0)),

    // 13. Active inheritance claims (not yet settled/rejected) blocked by
    // identity issues — source partner or any active claimant identity broken.
    db.execute(sql`
      SELECT COUNT(DISTINCT ic.id)::int AS count
      FROM inheritance_claims ic
      LEFT JOIN partners sp ON sp.id = ic.partner_id
      LEFT JOIN person_master spm ON spm.id = sp.person_master_id
      LEFT JOIN partner_claimants pc ON pc.partner_id = ic.partner_id AND pc.is_active = true
      LEFT JOIN person_master cpm ON cpm.id = pc.person_master_id
      WHERE ic.is_active = true
        AND ic.status NOT IN ('settled', 'rejected')
        AND (
          sp.id IS NULL OR sp.deleted_at IS NOT NULL OR sp.is_active = false
          OR sp.person_master_id IS NULL OR spm.id IS NULL OR spm.status <> 'active'
          OR (pc.id IS NOT NULL AND (pc.person_master_id IS NULL OR cpm.id IS NULL OR cpm.status <> 'active'))
        )
    `).then((r) => Number((r.rows?.[0] as { count?: number } | undefined)?.count ?? 0)),
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
    ownershipAffectingInvalidIdentity: ownershipAffectingInvalidIdentityCount,
    snapshotsWithInactivePartner: snapshotsWithInactivePartnerCount,
    snapshotsWithInactivePerson: snapshotsWithInactivePersonCount,
    crystallizationCandidatesInvalid: crystallizationCandidatesInvalidCount,
    transferWorkflowInactiveIdentity: transferWorkflowInactiveIdentityCount,
    inheritanceWorkflowInactiveIdentity: inheritanceWorkflowInactiveIdentityCount,
    // NPF Stage 2 — money-precision counters (introspective, live).
    moneyPrecision: await getMoneyPrecisionCounters(),
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
      inheritanceInvalidPartnerCount +
      ownershipAffectingInvalidIdentityCount +
      snapshotsWithInactivePartnerCount +
      snapshotsWithInactivePersonCount +
      crystallizationCandidatesInvalidCount +
      transferWorkflowInactiveIdentityCount +
      inheritanceWorkflowInactiveIdentityCount,
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

      // Ownership attribution gate — reject backfill for projects whose
      // contributions still reference invalid identities. Audits each
      // invalid partner once.
      const attribGate = await assertOwnershipAttributionValid({
        rows: crystalRows.map((r) => ({
          partnerId: r.partnerId,
          partnerName: r.partnerName,
        })),
        projectId: project.id,
        action: "ownership.crystallization.backfill",
        actor: {
          id: actingUserId ?? null,
          name: actingUserName,
          role: null,
        },
        req,
        targetTable: "ownership_snapshots",
      });
      if (!attribGate.ok) {
        results.push({
          projectId: project.id,
          projectName: project.name,
          status: "skipped",
          error: `Invalid ownership attribution: ${attribGate.body.invalid.length} partner(s) — ${attribGate.body.invalid.map((i) => i.failureCode).join(", ")}`,
        });
        req.log.warn(
          { projectId: project.id, invalidCount: attribGate.body.invalid.length },
          "backfill: skipped — invalid ownership attribution",
        );
        continue;
      }

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

// ──────────────────────────────────────────────────────────────────────────────
// Ownership Attribution Hardening — diagnostic endpoints
// ──────────────────────────────────────────────────────────────────────────────

// 1. Ownership-affecting contributions whose partner identity chain is broken.
router.get("/ownership-affecting-invalid-identity", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT
      c.id, c.project_id AS "projectId", c.partner_id AS "partnerId",
      c.partner_name AS "partnerName", c.contribution_type AS "contributionType",
      c.amount, c.verification_status AS "verificationStatus", c.created_at AS "createdAt",
      CASE
        WHEN c.partner_id IS NULL THEN 'PARTNER_ID_MISSING'
        WHEN p.id IS NULL THEN 'PARTNER_NOT_FOUND'
        WHEN p.deleted_at IS NOT NULL THEN 'PARTNER_DELETED'
        WHEN p.is_active = false THEN 'PARTNER_INACTIVE'
        WHEN p.person_master_id IS NULL THEN 'PARTNER_PERSON_LINK_MISSING'
        WHEN pm.id IS NULL THEN 'PERSON_MASTER_NOT_FOUND'
        WHEN pm.status <> 'active' THEN 'PERSON_MASTER_INACTIVE'
      END AS "failureCode"
    FROM contributions c
    LEFT JOIN partners p ON p.id = c.partner_id
    LEFT JOIN person_master pm ON pm.id = p.person_master_id
    WHERE c.affects_ownership = true AND c.is_active = true AND c.deleted_at IS NULL
      AND (
        c.partner_id IS NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL
        OR p.is_active = false OR p.person_master_id IS NULL
        OR pm.id IS NULL OR pm.status <> 'active'
      )
    ORDER BY c.created_at DESC
    LIMIT 200
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// 2. Stored ownership snapshots whose entries reference an inactive/missing partner.
router.get("/snapshots-with-inactive-partner", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT DISTINCT
      s.id AS "snapshotId", s.project_id AS "projectId",
      s.snapshot_type AS "snapshotType", s.snapshot_at AS "snapshotAt",
      entry->>'partnerId' AS "partnerId", entry->>'partnerName' AS "partnerName",
      CASE
        WHEN p.id IS NULL THEN 'PARTNER_NOT_FOUND'
        WHEN p.deleted_at IS NOT NULL THEN 'PARTNER_DELETED'
        WHEN p.is_active = false THEN 'PARTNER_INACTIVE'
      END AS "failureCode"
    FROM ownership_snapshots s
    CROSS JOIN LATERAL jsonb_array_elements(s.entries) AS entry
    LEFT JOIN partners p ON p.id = NULLIF(entry->>'partnerId', '')::uuid
    WHERE (entry->>'partnerId') IS NOT NULL AND (entry->>'partnerId') <> ''
      AND (p.id IS NULL OR p.deleted_at IS NOT NULL OR p.is_active = false)
    ORDER BY s.snapshot_at DESC
    LIMIT 200
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// 3. Stored ownership snapshots whose partner's person_master is now invalid.
router.get("/snapshots-with-inactive-person", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT DISTINCT
      s.id AS "snapshotId", s.project_id AS "projectId",
      s.snapshot_type AS "snapshotType", s.snapshot_at AS "snapshotAt",
      entry->>'partnerId' AS "partnerId", entry->>'partnerName' AS "partnerName",
      p.person_master_id AS "personMasterId",
      CASE
        WHEN p.person_master_id IS NULL THEN 'PARTNER_PERSON_LINK_MISSING'
        WHEN pm.id IS NULL THEN 'PERSON_MASTER_NOT_FOUND'
        WHEN pm.status <> 'active' THEN 'PERSON_MASTER_INACTIVE'
      END AS "failureCode"
    FROM ownership_snapshots s
    CROSS JOIN LATERAL jsonb_array_elements(s.entries) AS entry
    LEFT JOIN partners p ON p.id = NULLIF(entry->>'partnerId', '')::uuid
    LEFT JOIN person_master pm ON pm.id = p.person_master_id
    WHERE (entry->>'partnerId') IS NOT NULL AND (entry->>'partnerId') <> ''
      AND p.id IS NOT NULL
      AND (p.person_master_id IS NULL OR pm.id IS NULL OR pm.status <> 'active')
    ORDER BY s.snapshot_at DESC
    LIMIT 200
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// 4. Crystallization-backfill candidates that will be skipped by the gate.
router.get("/crystallization-candidates-invalid", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT
      pr.id AS "projectId", pr.name AS "projectName",
      pr.lifecycle_status AS "lifecycleStatus",
      COUNT(DISTINCT c.id)::int AS "invalidContributionCount",
      COUNT(DISTINCT c.partner_id)::int AS "invalidPartnerCount"
    FROM projects pr
    JOIN contributions c ON c.project_id = pr.id
      AND c.is_active = true AND c.deleted_at IS NULL
      AND c.verification_status = 'verified'
      AND c.affects_ownership = true
    LEFT JOIN partners p ON p.id = c.partner_id
    LEFT JOIN person_master pm ON pm.id = p.person_master_id
    WHERE pr.lifecycle_status IN ('mature_production', 'closed')
      AND pr.ownership_frozen_at IS NULL
      AND (
        c.partner_id IS NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL
        OR p.is_active = false OR p.person_master_id IS NULL
        OR pm.id IS NULL OR pm.status <> 'active'
      )
    GROUP BY pr.id, pr.name, pr.lifecycle_status
    ORDER BY pr.name
    LIMIT 200
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// 5. In-flight transfers (not yet executed/rejected/cancelled) whose transferor
// or buyer identity is currently invalid. Broader than -invalid-partner — covers
// person-master state, soft-deletion, etc.
router.get("/transfer-workflow-inactive-identity", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT
      t.id AS "transferId", t.project_id AS "projectId",
      t.transferor_partner_id AS "transferorPartnerId",
      t.buyer_partner_id AS "buyerPartnerId",
      t.status, t.transfer_type AS "transferType", t.created_at AS "createdAt",
      CASE
        WHEN tp.id IS NULL THEN 'TRANSFEROR_PARTNER_NOT_FOUND'
        WHEN tp.deleted_at IS NOT NULL THEN 'TRANSFEROR_PARTNER_DELETED'
        WHEN tp.is_active = false THEN 'TRANSFEROR_PARTNER_INACTIVE'
        WHEN tp.person_master_id IS NULL THEN 'TRANSFEROR_PERSON_LINK_MISSING'
        WHEN tpm.id IS NULL THEN 'TRANSFEROR_PERSON_NOT_FOUND'
        WHEN tpm.status <> 'active' THEN 'TRANSFEROR_PERSON_INACTIVE'
        WHEN t.buyer_partner_id IS NOT NULL AND bp.id IS NULL THEN 'BUYER_PARTNER_NOT_FOUND'
        WHEN t.buyer_partner_id IS NOT NULL AND bp.deleted_at IS NOT NULL THEN 'BUYER_PARTNER_DELETED'
        WHEN t.buyer_partner_id IS NOT NULL AND bp.is_active = false THEN 'BUYER_PARTNER_INACTIVE'
        WHEN t.buyer_partner_id IS NOT NULL AND bp.person_master_id IS NULL THEN 'BUYER_PERSON_LINK_MISSING'
        WHEN t.buyer_partner_id IS NOT NULL AND bpm.id IS NULL THEN 'BUYER_PERSON_NOT_FOUND'
        WHEN t.buyer_partner_id IS NOT NULL AND bpm.status <> 'active' THEN 'BUYER_PERSON_INACTIVE'
      END AS "failureCode"
    FROM ownership_transfers t
    LEFT JOIN partners tp ON tp.id = t.transferor_partner_id
    LEFT JOIN person_master tpm ON tpm.id = tp.person_master_id
    LEFT JOIN partners bp ON bp.id = t.buyer_partner_id
    LEFT JOIN person_master bpm ON bpm.id = bp.person_master_id
    WHERE t.status NOT IN ('executed', 'cancelled', 'expired')
      AND (
        tp.id IS NULL OR tp.deleted_at IS NOT NULL OR tp.is_active = false
        OR tp.person_master_id IS NULL OR tpm.id IS NULL OR tpm.status <> 'active'
        OR (t.buyer_partner_id IS NOT NULL AND (
          bp.id IS NULL OR bp.deleted_at IS NOT NULL OR bp.is_active = false
          OR bp.person_master_id IS NULL OR bpm.id IS NULL OR bpm.status <> 'active'
        ))
      )
    ORDER BY t.created_at DESC
    LIMIT 200
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// 6. Active inheritance claims (or any of their active claimants) currently
// blocked by identity issues — source partner OR claimant person chain broken.
router.get("/inheritance-workflow-inactive-identity", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT DISTINCT
      ic.id AS "claimId", ic.project_id AS "projectId",
      ic.partner_id AS "partnerId", ic.status, ic.claim_type AS "claimType",
      ic.created_at AS "createdAt",
      CASE
        WHEN sp.id IS NULL THEN 'SOURCE_PARTNER_NOT_FOUND'
        WHEN sp.deleted_at IS NOT NULL THEN 'SOURCE_PARTNER_DELETED'
        WHEN sp.is_active = false THEN 'SOURCE_PARTNER_INACTIVE'
        WHEN sp.person_master_id IS NULL THEN 'SOURCE_PERSON_LINK_MISSING'
        WHEN spm.id IS NULL THEN 'SOURCE_PERSON_NOT_FOUND'
        WHEN spm.status <> 'active' THEN 'SOURCE_PERSON_INACTIVE'
        WHEN pc.id IS NOT NULL AND pc.person_master_id IS NULL THEN 'CLAIMANT_PERSON_LINK_MISSING'
        WHEN pc.id IS NOT NULL AND cpm.id IS NULL THEN 'CLAIMANT_PERSON_NOT_FOUND'
        WHEN pc.id IS NOT NULL AND cpm.status <> 'active' THEN 'CLAIMANT_PERSON_INACTIVE'
      END AS "failureCode"
    FROM inheritance_claims ic
    LEFT JOIN partners sp ON sp.id = ic.partner_id
    LEFT JOIN person_master spm ON spm.id = sp.person_master_id
    LEFT JOIN partner_claimants pc ON pc.partner_id = ic.partner_id AND pc.is_active = true
    LEFT JOIN person_master cpm ON cpm.id = pc.person_master_id
    WHERE ic.is_active = true
      AND ic.status NOT IN ('settled', 'rejected')
      AND (
        sp.id IS NULL OR sp.deleted_at IS NOT NULL OR sp.is_active = false
        OR sp.person_master_id IS NULL OR spm.id IS NULL OR spm.status <> 'active'
        OR (pc.id IS NOT NULL AND (pc.person_master_id IS NULL OR cpm.id IS NULL OR cpm.status <> 'active'))
      )
    ORDER BY ic.created_at DESC
    LIMIT 200
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// NPF Stage 2 — Money Precision Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

async function getMoneyPrecisionCounters(): Promise<{
  moneyColumnsUsingReal: number;
  moneyColumnsWithWrongScale: number;
  valuesExceedingTargetPrecision: number;
  aggregateDriftBurden: number;
  aggregateDriftDistribution: number;
}> {
  const safeExec = async (q: ReturnType<typeof sql>) => {
    try {
      const r = await db.execute(q);
      return Number((r.rows?.[0] as { n: number } | undefined)?.n ?? 0);
    } catch {
      return 0;
    }
  };

  const [usingReal, wrongScale, exceeding, burdenDrift, distDrift] = await Promise.all([
    safeExec(sql`
      SELECT count(*)::int AS n
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.data_type = 'real'
        AND (${MONEY_COLUMN_FILTER_SQL})
        AND ${SNAPSHOT_TABLE_EXCLUDE}
    `),
    safeExec(sql`
      SELECT count(*)::int AS n
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.data_type = 'numeric'
        AND (${MONEY_COLUMN_FILTER_SQL})
        AND ${SNAPSHOT_TABLE_EXCLUDE}
        AND (c.numeric_precision <> 15 OR c.numeric_scale <> 2)
    `),
    safeExec(sql`
      SELECT count(*)::int AS n FROM precision_conversion_audit WHERE delta <> 0
    `),
    safeExec(sql`
      SELECT count(*)::int AS n FROM burden_records br
      WHERE ABS(
        COALESCE(br.total_amount, 0) -
        COALESCE((SELECT SUM(c.amount) FROM burden_components c WHERE c.burden_record_id = br.id), 0)
      ) > 0.01
    `),
    safeExec(sql`
      SELECT count(*)::int AS n FROM distribution_previews dp
      WHERE ABS(
        COALESCE(dp.gross_revenue, 0) -
        (COALESCE(dp.epp_total, 0) + COALESCE(dp.landowner_total, 0))
      ) > 0.01
    `),
  ]);

  return {
    moneyColumnsUsingReal: usingReal,
    moneyColumnsWithWrongScale: wrongScale,
    valuesExceedingTargetPrecision: exceeding,
    aggregateDriftBurden: burdenDrift,
    aggregateDriftDistribution: distDrift,
  };
}

// All endpoints introspect live storage via information_schema. Target money
// shape: numeric(15, 2). Aggregate-drift endpoints compute "component sum vs
// stored total" deltas for the two highest-impact tables (burden, distribution).

const MONEY_COLUMN_HINTS = [
  "amount",
  "value",
  "cost",
  "price",
  "balance",
  "total",
  "revenue",
  "payment",
  "burden",
  "advance",
  "credit",
  "debit",
  "payable",
  "received",
  "recovered",
];

const MONEY_COLUMN_FILTER_SQL = sql.raw(
  MONEY_COLUMN_HINTS.map((h) => `c.column_name ILIKE '%${h}%'`).join(" OR "),
);

const SNAPSHOT_TABLE_EXCLUDE = sql.raw(
  `c.table_name NOT IN ('ownership_snapshots','inheritance_history','generations','backup','precision_conversion_audit')`,
);

// ── /money-precision/summary — 5 counters ────────────────────────────────────
router.get("/money-precision/summary", async (_req, res) => {
  const [usingReal, wrongScale, exceedingPrecision, burdenDrift, distDrift] =
    await Promise.all([
      db.execute(sql`
        SELECT count(*)::int AS n
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.data_type = 'real'
          AND (${MONEY_COLUMN_FILTER_SQL})
          AND ${SNAPSHOT_TABLE_EXCLUDE}
      `),
      db.execute(sql`
        SELECT count(*)::int AS n
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.data_type = 'numeric'
          AND (${MONEY_COLUMN_FILTER_SQL})
          AND ${SNAPSHOT_TABLE_EXCLUDE}
          AND (c.numeric_precision <> 15 OR c.numeric_scale <> 2)
      `),
      db.execute(sql`
        SELECT count(*)::int AS n
        FROM precision_conversion_audit
        WHERE delta <> 0
      `),
      db.execute(sql`
        SELECT count(*)::int AS n
        FROM burden_records br
        WHERE ABS(
          COALESCE(br.total_amount, 0) -
          COALESCE((
            SELECT SUM(c.amount)
            FROM burden_components c
            WHERE c.burden_record_id = br.id
          ), 0)
        ) > 0.01
      `).catch(() => ({ rows: [{ n: 0 }] } as never)),
      db.execute(sql`
        SELECT count(*)::int AS n
        FROM distribution_previews dp
        WHERE ABS(
          COALESCE(dp.gross_revenue, 0) -
          (COALESCE(dp.epp_total, 0) + COALESCE(dp.landowner_total, 0))
        ) > 0.01
      `).catch(() => ({ rows: [{ n: 0 }] } as never)),
    ]);

  return res.json({
    moneyColumnsUsingReal: Number((usingReal.rows?.[0] as { n: number })?.n ?? 0),
    moneyColumnsWithWrongScale: Number((wrongScale.rows?.[0] as { n: number })?.n ?? 0),
    valuesExceedingTargetPrecision: Number(
      (exceedingPrecision.rows?.[0] as { n: number })?.n ?? 0,
    ),
    aggregateDriftBurden: Number((burdenDrift.rows?.[0] as { n: number })?.n ?? 0),
    aggregateDriftDistribution: Number((distDrift.rows?.[0] as { n: number })?.n ?? 0),
  });
});

// ── /money-precision/money-columns-using-real ────────────────────────────────
router.get("/money-precision/money-columns-using-real", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type = 'real'
      AND (${MONEY_COLUMN_FILTER_SQL})
      AND ${SNAPSHOT_TABLE_EXCLUDE}
    ORDER BY c.table_name, c.column_name
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// ── /money-precision/money-columns-with-wrong-scale ──────────────────────────
router.get("/money-precision/money-columns-with-wrong-scale", async (_req, res) => {
  const r = await db.execute(sql`
    SELECT c.table_name, c.column_name, c.numeric_precision, c.numeric_scale
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type = 'numeric'
      AND (${MONEY_COLUMN_FILTER_SQL})
      AND ${SNAPSHOT_TABLE_EXCLUDE}
      AND (c.numeric_precision <> 15 OR c.numeric_scale <> 2)
    ORDER BY c.table_name, c.column_name
  `);
  return res.json({ items: r.rows, count: r.rows.length });
});

// ── /money-precision/values-exceeding-target-precision ───────────────────────
// Audit-table backed: any captured row whose delta != 0 is a rounding event
// that exceeded the post-migration target precision in its source representation.
router.get(
  "/money-precision/values-exceeding-target-precision",
  async (_req, res) => {
    const r = await db.execute(sql`
      SELECT source_table, source_row_id, source_column,
             original_value, converted_value, delta, migrated_at
      FROM precision_conversion_audit
      WHERE delta <> 0
      ORDER BY ABS(delta) DESC
      LIMIT 500
    `);
    return res.json({ items: r.rows, count: r.rows.length });
  },
);

// ── /money-precision/aggregate-drift-burden ──────────────────────────────────
router.get("/money-precision/aggregate-drift-burden", async (_req, res) => {
  try {
    const r = await db.execute(sql`
      SELECT br.id AS burden_record_id,
             br.total_amount AS stored_total,
             COALESCE((
               SELECT SUM(c.amount)
               FROM burden_components c
               WHERE c.burden_record_id = br.id
             ), 0) AS computed_total,
             br.total_amount - COALESCE((
               SELECT SUM(c.amount)
               FROM burden_components c
               WHERE c.burden_record_id = br.id
             ), 0) AS drift
      FROM burden_records br
      WHERE ABS(
        COALESCE(br.total_amount, 0) -
        COALESCE((
          SELECT SUM(c.amount)
          FROM burden_components c
          WHERE c.burden_record_id = br.id
        ), 0)
      ) > 0.01
      ORDER BY ABS(drift) DESC
      LIMIT 200
    `);
    return res.json({ items: r.rows, count: r.rows.length });
  } catch {
    return res.json({ items: [], count: 0, note: "burden tables not present" });
  }
});

// ── /money-precision/aggregate-drift-distribution ────────────────────────────
router.get(
  "/money-precision/aggregate-drift-distribution",
  async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT dp.id AS preview_id,
               dp.gross_revenue,
               dp.epp_total,
               dp.landowner_total,
               (dp.gross_revenue
                 - COALESCE(dp.epp_total, 0)
                 - COALESCE(dp.landowner_total, 0)) AS drift
        FROM distribution_previews dp
        WHERE ABS(
          COALESCE(dp.gross_revenue, 0) -
          (COALESCE(dp.epp_total, 0) + COALESCE(dp.landowner_total, 0))
        ) > 0.01
        ORDER BY ABS(
          COALESCE(dp.gross_revenue, 0) -
          (COALESCE(dp.epp_total, 0) + COALESCE(dp.landowner_total, 0))
        ) DESC
        LIMIT 200
      `);
      return res.json({ items: r.rows, count: r.rows.length });
    } catch {
      return res.json({
        items: [],
        count: 0,
        note: "distribution_previews columns not present",
      });
    }
  },
);

export default router;
