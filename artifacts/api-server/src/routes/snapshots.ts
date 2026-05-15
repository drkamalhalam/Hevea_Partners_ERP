/**
 * snapshots.ts
 *
 * Historical record snapshot preservation system.
 * All snapshot rows are write-once — this router never issues UPDATE or DELETE
 * on the record_snapshots table.
 *
 *   POST /snapshots/capture              — capture current state of any entity
 *   GET  /snapshots                      — list all snapshots (paginated, filterable)
 *   GET  /snapshots/:id                  — single snapshot detail
 *   GET  /snapshots/entity/:type/:id     — all snapshots for one entity (timeline)
 *   GET  /snapshots/project/:projectId   — all snapshots for a project
 *   GET  /snapshots/compare              — diff two snapshots (?a=id&b=id)
 *   GET  /snapshots/restore-preview/:id  — current state vs snapshot (read-only)
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  recordSnapshotsTable,
  partnerOwnershipStatesTable,
  agreementsTable,
  agreementGenerationsTable,
  fiftyPctSessionsTable,
  eppEntriesTable,
  distributionPreviewsTable,
  landownerLedgerTable,
  lcaLedgerTable,
  lcaConfigsTable,
  projectsTable,
  usersTable,
  ownershipSnapshotsTable,
} from "@workspace/db";
import {
  eq,
  and,
  desc,
  gte,
  lte,
  sql,
  or,
  ilike,
} from "drizzle-orm";
import { requireRole } from "../middlewares/auth";

const router = Router();
router.use(requireRole("admin", "developer"));

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseLimit(v: unknown, def = 50, max = 200): number {
  const n = parseInt(String(v), 10);
  return isNaN(n) || n < 1 ? def : Math.min(n, max);
}
function parseOffset(v: unknown): number {
  const n = parseInt(String(v), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function fmtSnapshot(row: typeof recordSnapshotsTable.$inferSelect) {
  return {
    id: row.id,
    snapshotType: row.snapshotType,
    entityId: row.entityId,
    entityType: row.entityType,
    projectId: row.projectId,
    projectName: row.projectName,
    label: row.label,
    notes: row.notes,
    triggerType: row.triggerType,
    capturedByName: row.capturedByName,
    capturedByRole: row.capturedByRole,
    createdAt: row.createdAt.toISOString(),
  };
}

function fmtSnapshotFull(row: typeof recordSnapshotsTable.$inferSelect) {
  return {
    ...fmtSnapshot(row),
    snapshotData: row.snapshotData,
  };
}

// ── Deep diff utility (server-side) ───────────────────────────────────────────

type DiffNode =
  | { type: "changed"; path: string; before: unknown; after: unknown }
  | { type: "added"; path: string; value: unknown }
  | { type: "removed"; path: string; value: unknown };

function deepDiff(a: unknown, b: unknown, path = ""): DiffNode[] {
  if (a === b) return [];

  // Both are plain objects — recurse
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    const results: DiffNode[] = [];
    for (const key of allKeys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in ao)) {
        results.push({ type: "added", path: childPath, value: bo[key] });
      } else if (!(key in bo)) {
        results.push({ type: "removed", path: childPath, value: ao[key] });
      } else {
        results.push(...deepDiff(ao[key], bo[key], childPath));
      }
    }
    return results;
  }

  // Arrays — compare JSON-stringified for simplicity
  if (Array.isArray(a) && Array.isArray(b)) {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    return [{ type: "changed", path, before: a, after: b }];
  }

  return [{ type: "changed", path, before: a, after: b }];
}

// ── Capture functions (pull current state from DB) ────────────────────────────

async function captureOwnershipState(projectId: string): Promise<Record<string, unknown>> {
  const [project, states, latestOwnershipSnap] = await Promise.all([
    db.select({ name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    db.select().from(partnerOwnershipStatesTable)
      .where(eq(partnerOwnershipStatesTable.projectId, projectId))
      .orderBy(partnerOwnershipStatesTable.partnerName),
    db.select().from(ownershipSnapshotsTable)
      .where(eq(ownershipSnapshotsTable.projectId, projectId))
      .orderBy(desc(ownershipSnapshotsTable.createdAt)).limit(1),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    projectId,
    projectName: project[0]?.name ?? null,
    lifecycleStatus: project[0]?.lifecycleStatus ?? null,
    partnerStates: states.map((s) => ({
      id: s.id,
      partnerId: s.partnerId,
      partnerName: s.partnerName,
      totalPercentage: s.totalPercentage,
      transferablePercentage: s.transferablePercentage,
      lockedPercentage: s.lockedPercentage,
      disputedPercentage: s.disputedPercentage,
      reservedPercentage: s.reservedPercentage,
      lockReason: s.lockReason ?? null,
      lockedSince: s.lockedSince?.toISOString() ?? null,
      disputeReason: s.disputeReason ?? null,
      disputedSince: s.disputedSince?.toISOString() ?? null,
      disputeReference: s.disputeReference ?? null,
      notes: s.notes ?? null,
      updatedByName: s.updatedByName ?? null,
      updatedAt: s.updatedAt.toISOString(),
    })),
    latestOwnershipSnapshot: latestOwnershipSnap[0]
      ? {
          id: latestOwnershipSnap[0].id,
          snapshotType: latestOwnershipSnap[0].snapshotType,
          totalRecognizedAmount: latestOwnershipSnap[0].totalRecognizedAmount,
          landTotal: latestOwnershipSnap[0].landTotal,
          economicTotal: latestOwnershipSnap[0].economicTotal,
          entries: latestOwnershipSnap[0].entries,
          snapshotAt: latestOwnershipSnap[0].snapshotAt.toISOString(),
        }
      : null,
  };
}

async function captureAgreement(agreementId: string): Promise<Record<string, unknown>> {
  const [agreement, latestGen] = await Promise.all([
    db.select().from(agreementsTable)
      .where(eq(agreementsTable.id, agreementId)).limit(1),
    db.select().from(agreementGenerationsTable)
      .where(eq(agreementGenerationsTable.agreementId, agreementId))
      .orderBy(desc(agreementGenerationsTable.generatedAt)).limit(1),
  ]);
  if (!agreement[0]) throw new Error("Agreement not found");
  const a = agreement[0];
  return {
    capturedAt: new Date().toISOString(),
    agreement: {
      id: a.id,
      projectId: a.projectId,
      landOwnerId: a.landOwnerId,
      projectDeveloperId: a.projectDeveloperId,
      executionDate: a.executionDate,
      executionPlace: a.executionPlace,
      termYears: a.termYears,
      landArea: a.landArea,
      landAreaUnit: a.landAreaUnit,
      landNotionalValue: a.landNotionalValue,
      landValuePerUnit: a.landValuePerUnit,
      landContributionAdjustment: a.landContributionAdjustment,
      yearlyEscalation: a.yearlyEscalation,
      ownershipShareLandowner: a.ownershipShareLandowner ?? null,
      ownershipShareDeveloper: a.ownershipShareDeveloper ?? null,
      revenueModel: a.revenueModel,
      status: a.status,
      northBoundary: a.northBoundary ?? null,
      southBoundary: a.southBoundary ?? null,
      eastBoundary: a.eastBoundary ?? null,
      westBoundary: a.westBoundary ?? null,
      notes: a.notes ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt?.toISOString() ?? null,
    },
    latestGeneration: latestGen[0]
      ? {
          id: latestGen[0].id,
          templateName: latestGen[0].templateName,
          templateVersion: latestGen[0].templateVersion ?? null,
          variableSnapshot: latestGen[0].variableSnapshot,
          generatedAt: latestGen[0].generatedAt?.toISOString() ?? null,
          generatedByName: latestGen[0].generatedByName ?? null,
        }
      : null,
  };
}

async function captureSettlementSession(sessionId: string): Promise<Record<string, unknown>> {
  const [session, eppEntries] = await Promise.all([
    db.select().from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, sessionId)).limit(1),
    db.select().from(eppEntriesTable)
      .where(eq(eppEntriesTable.sessionId, sessionId))
      .orderBy(eppEntriesTable.participantName),
  ]);
  if (!session[0]) throw new Error("Settlement session not found");
  const s = session[0];
  return {
    capturedAt: new Date().toISOString(),
    session: {
      id: s.id,
      projectId: s.projectId,
      periodLabel: s.periodLabel,
      periodStart: s.periodStart ?? null,
      periodEnd: s.periodEnd ?? null,
      periodYear: s.periodYear ?? null,
      grossRevenue: s.grossRevenue,
      landownerSplit: s.landownerSplit,
      participantPoolSplit: s.participantPoolSplit,
      operationalCost: s.operationalCost,
      lcaAmount: s.lcaAmount,
      lcaSource: s.lcaSource,
      landownerNet: s.landownerNet,
      eppTotalAllocated: s.eppTotalAllocated,
      eppRemainder: s.eppRemainder,
      status: s.status,
      notes: s.notes ?? null,
      calculatedByName: s.calculatedByName ?? null,
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
      confirmedByName: s.confirmedByName ?? null,
      createdAt: s.createdAt.toISOString(),
    },
    eppEntries: eppEntries.map((e) => ({
      id: e.id,
      participantKey: e.participantKey,
      participantName: e.participantName,
      participationPct: e.participationPct,
      allocatedAmount: e.allocatedAmount,
      contributionType: e.contributionType,
      isLandownerAdditional: e.isLandownerAdditional,
      notes: e.notes ?? null,
    })),
    eppCount: eppEntries.length,
  };
}

async function captureDistributionPreview(previewId: string): Promise<Record<string, unknown>> {
  const [preview] = await db.select().from(distributionPreviewsTable)
    .where(eq(distributionPreviewsTable.id, previewId)).limit(1);
  if (!preview) throw new Error("Distribution preview not found");
  return {
    capturedAt: new Date().toISOString(),
    preview: {
      id: preview.id,
      projectId: preview.projectId,
      agreementId: preview.agreementId ?? null,
      accountingModel: preview.accountingModel,
      periodLabel: preview.periodLabel,
      periodStart: preview.periodStart ?? null,
      periodEnd: preview.periodEnd ?? null,
      periodYear: preview.periodYear ?? null,
      grossRevenue: preview.grossRevenue,
      operationalCost: preview.operationalCost,
      lcaAmount: preview.lcaAmount,
      lcaSource: preview.lcaSource,
      ownershipSnapshotId: preview.ownershipSnapshotId ?? null,
      ownershipSnapshotEntries: preview.ownershipSnapshotEntries,
      distributionResult: preview.distributionResult,
      status: preview.status,
      notes: preview.notes ?? null,
      calculatedByName: preview.calculatedByName ?? null,
      confirmedAt: preview.confirmedAt?.toISOString() ?? null,
      confirmedByName: preview.confirmedByName ?? null,
      createdAt: preview.createdAt.toISOString(),
    },
  };
}

async function captureFinancialPosition(projectId: string): Promise<Record<string, unknown>> {
  const [project, rawEntries] = await Promise.all([
    db.select({ name: projectsTable.name })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    db.select({
      partnerId: landownerLedgerTable.partnerId,
      entryType: landownerLedgerTable.entryType,
      direction: landownerLedgerTable.direction,
      amount: landownerLedgerTable.amount,
      periodLabel: landownerLedgerTable.periodLabel,
      status: landownerLedgerTable.status,
    })
      .from(landownerLedgerTable)
      .where(eq(landownerLedgerTable.projectId, projectId))
      .orderBy(landownerLedgerTable.partnerId),
  ]);

  // Group by partner
  const byPartner: Record<string, {
    partnerId: string;
    totalCredit: number;
    totalDebit: number;
    byType: Record<string, { credit: number; debit: number }>;
    entryCount: number;
    confirmedCredit: number;
    confirmedDebit: number;
  }> = {};

  for (const e of rawEntries) {
    const pid = e.partnerId;
    if (!byPartner[pid]) {
      byPartner[pid] = {
        partnerId: pid,
        totalCredit: 0,
        totalDebit: 0,
        byType: {},
        entryCount: 0,
        confirmedCredit: 0,
        confirmedDebit: 0,
      };
    }
    const p = byPartner[pid];
    const amt = Number(e.amount ?? 0);
    if (e.direction === "credit") {
      p.totalCredit += amt;
      if (e.status === "confirmed") p.confirmedCredit += amt;
    } else {
      p.totalDebit += amt;
      if (e.status === "confirmed") p.confirmedDebit += amt;
    }
    const t = e.entryType ?? "unknown";
    if (!p.byType[t]) p.byType[t] = { credit: 0, debit: 0 };
    if (e.direction === "credit") p.byType[t].credit += amt;
    else p.byType[t].debit += amt;
    p.entryCount++;
  }

  const partnerSummaries = Object.values(byPartner).map((p) => ({
    ...p,
    netPosition: p.totalCredit - p.totalDebit,
    confirmedNet: p.confirmedCredit - p.confirmedDebit,
  }));

  return {
    capturedAt: new Date().toISOString(),
    projectId,
    projectName: project[0]?.name ?? null,
    partnerCount: partnerSummaries.length,
    totals: {
      totalCredit: partnerSummaries.reduce((s, p) => s + p.totalCredit, 0),
      totalDebit: partnerSummaries.reduce((s, p) => s + p.totalDebit, 0),
      netPosition: partnerSummaries.reduce((s, p) => s + p.netPosition, 0),
    },
    partnerSummaries,
    rawEntryCount: rawEntries.length,
  };
}

async function captureLcaPosition(projectId: string): Promise<Record<string, unknown>> {
  const [project, config, ledger] = await Promise.all([
    db.select({ name: projectsTable.name })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    db.select().from(lcaConfigsTable)
      .where(and(
        eq(lcaConfigsTable.projectId, projectId),
        eq(lcaConfigsTable.isActive, true),
      )).limit(1),
    db.select().from(lcaLedgerTable)
      .where(eq(lcaLedgerTable.projectId, projectId))
      .orderBy(lcaLedgerTable.year),
  ]);

  const c = config[0] ?? null;
  const totalDue = ledger.reduce((s, r) => s + r.totalDue, 0);
  const totalPaid = ledger.reduce((s, r) => s + r.amountPaid, 0);
  const totalBalance = ledger.reduce((s, r) => s + r.balance, 0);

  return {
    capturedAt: new Date().toISOString(),
    projectId,
    projectName: project[0]?.name ?? null,
    config: c
      ? {
          id: c.id,
          baseAmount: c.baseAmount,
          startYear: c.startYear,
          escalationPct: c.escalationPct,
          isActive: c.isActive,
          effectiveStartDate: c.effectiveStartDate,
        }
      : null,
    summary: {
      yearCount: ledger.length,
      totalDue,
      totalPaid,
      totalBalance,
    },
    ledger: ledger.map((r) => ({
      id: r.id,
      year: r.year,
      baseAmount: r.baseAmount,
      escalationFactor: r.escalationFactor,
      grossDue: r.grossDue,
      carryForward: r.carryForward,
      totalDue: r.totalDue,
      amountPaid: r.amountPaid,
      balance: r.balance,
      status: r.status,
      paidAt: r.paidAt ?? null,
    })),
  };
}

async function resolveEntityState(
  snapshotType: string,
  entityId: string,
): Promise<Record<string, unknown>> {
  switch (snapshotType) {
    case "ownership_state":
      return captureOwnershipState(entityId);
    case "agreement":
      return captureAgreement(entityId);
    case "settlement_session":
      return captureSettlementSession(entityId);
    case "distribution_preview":
      return captureDistributionPreview(entityId);
    case "financial_position":
      return captureFinancialPosition(entityId);
    case "lca_position":
      return captureLcaPosition(entityId);
    default:
      throw new Error(`Unknown snapshot type: ${snapshotType}`);
  }
}

// ── POST /snapshots/capture ───────────────────────────────────────────────────

router.post("/capture", async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const {
      snapshotType,
      entityId,
      projectId,
      label,
      notes,
      triggerType = "manual",
    } = req.body as {
      snapshotType: string;
      entityId: string;
      projectId?: string;
      label?: string;
      notes?: string;
      triggerType?: string;
    };

    const VALID_TYPES = [
      "ownership_state",
      "agreement",
      "settlement_session",
      "distribution_preview",
      "financial_position",
      "lca_position",
    ];

    if (!snapshotType || !VALID_TYPES.includes(snapshotType)) {
      return res.status(400).json({
        error: `snapshotType must be one of: ${VALID_TYPES.join(", ")}`,
      });
    }
    if (!entityId) return res.status(400).json({ error: "entityId is required" });

    // Resolve user info
    const [userRow] = await db
      .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    // Resolve project name (if projectId given)
    let projectName: string | null = null;
    const pid = projectId ?? (
      ["ownership_state", "financial_position", "lca_position"].includes(snapshotType)
        ? entityId
        : undefined
    );
    if (pid) {
      const [proj] = await db.select({ name: projectsTable.name })
        .from(projectsTable).where(eq(projectsTable.id, pid)).limit(1);
      projectName = proj?.name ?? null;
    }

    // Capture the current state
    const snapshotData = await resolveEntityState(snapshotType, entityId);

    // Determine entityType (table name)
    const entityTypeMap: Record<string, string> = {
      ownership_state: "partner_ownership_states",
      agreement: "agreements",
      settlement_session: "fifty_pct_sessions",
      distribution_preview: "distribution_previews",
      financial_position: "landowner_ledger_entries",
      lca_position: "lca_ledger",
    };

    const [inserted] = await db
      .insert(recordSnapshotsTable)
      .values({
        snapshotType,
        entityId,
        entityType: entityTypeMap[snapshotType] ?? snapshotType,
        projectId: pid ?? null,
        projectName,
        label: label ?? null,
        notes: notes ?? null,
        snapshotData,
        triggerType,
        capturedById: userRow?.id ?? null,
        capturedByName: userRow?.displayName ?? null,
        capturedByRole: userRow?.role ?? null,
      })
      .returning();

    req.log.info(
      { snapshotId: inserted.id, snapshotType, entityId },
      "Record snapshot captured",
    );

    return res.status(201).json(fmtSnapshotFull(inserted));
  } catch (err) {
    req.log.error({ err }, "Failed to capture snapshot");
    const msg = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
});

// ── GET /snapshots ────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const limit = parseLimit(q.limit);
    const offset = parseOffset(q.offset);

    const conditions: ReturnType<typeof eq>[] = [];
    if (q.snapshotType)
      conditions.push(eq(recordSnapshotsTable.snapshotType, q.snapshotType));
    if (q.entityId) conditions.push(eq(recordSnapshotsTable.entityId, q.entityId));
    if (q.projectId)
      conditions.push(eq(recordSnapshotsTable.projectId, q.projectId));
    if (q.triggerType)
      conditions.push(eq(recordSnapshotsTable.triggerType, q.triggerType));
    if (q.from)
      conditions.push(gte(recordSnapshotsTable.createdAt, new Date(q.from)));
    if (q.to)
      conditions.push(lte(recordSnapshotsTable.createdAt, new Date(q.to)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: recordSnapshotsTable.id,
          snapshotType: recordSnapshotsTable.snapshotType,
          entityId: recordSnapshotsTable.entityId,
          entityType: recordSnapshotsTable.entityType,
          projectId: recordSnapshotsTable.projectId,
          projectName: recordSnapshotsTable.projectName,
          label: recordSnapshotsTable.label,
          notes: recordSnapshotsTable.notes,
          triggerType: recordSnapshotsTable.triggerType,
          capturedByName: recordSnapshotsTable.capturedByName,
          capturedByRole: recordSnapshotsTable.capturedByRole,
          createdAt: recordSnapshotsTable.createdAt,
        })
        .from(recordSnapshotsTable)
        .where(where)
        .orderBy(desc(recordSnapshotsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recordSnapshotsTable)
        .where(where),
    ]);

    return res.json({
      snapshots: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list snapshots");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /snapshots/compare ────────────────────────────────────────────────────

router.get("/compare", async (req, res) => {
  try {
    const { a: aId, b: bId } = req.query as { a?: string; b?: string };
    if (!aId || !bId)
      return res.status(400).json({ error: "Provide ?a=<id>&b=<id>" });

    const [rowA, rowB] = await Promise.all([
      db.select().from(recordSnapshotsTable)
        .where(eq(recordSnapshotsTable.id, aId)).limit(1),
      db.select().from(recordSnapshotsTable)
        .where(eq(recordSnapshotsTable.id, bId)).limit(1),
    ]);

    if (!rowA[0]) return res.status(404).json({ error: "Snapshot A not found" });
    if (!rowB[0]) return res.status(404).json({ error: "Snapshot B not found" });

    const diff = deepDiff(
      rowA[0].snapshotData as unknown,
      rowB[0].snapshotData as unknown,
    );

    return res.json({
      a: fmtSnapshotFull(rowA[0]),
      b: fmtSnapshotFull(rowB[0]),
      diff,
      diffCount: {
        added: diff.filter((d) => d.type === "added").length,
        removed: diff.filter((d) => d.type === "removed").length,
        changed: diff.filter((d) => d.type === "changed").length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compare snapshots");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /snapshots/restore-preview/:id ───────────────────────────────────────

router.get("/restore-preview/:id", async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(recordSnapshotsTable)
      .where(eq(recordSnapshotsTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Snapshot not found" });

    // Pull current state using the same capture function
    const entityId = row.entityId;
    if (!entityId) return res.status(400).json({ error: "Snapshot has no entityId" });

    const currentState = await resolveEntityState(row.snapshotType, entityId);
    const diff = deepDiff(row.snapshotData as unknown, currentState as unknown);

    return res.json({
      snapshot: fmtSnapshotFull(row),
      currentState,
      diff,
      diffCount: {
        added: diff.filter((d) => d.type === "added").length,
        removed: diff.filter((d) => d.type === "removed").length,
        changed: diff.filter((d) => d.type === "changed").length,
      },
      hasDifferences: diff.length > 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build restore preview");
    const msg = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
});

// ── GET /snapshots/entity/:entityType/:entityId ───────────────────────────────

router.get("/entity/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params as {
      entityType: string;
      entityId: string;
    };
    const limit = parseLimit(req.query.limit, 100, 500);

    const rows = await db
      .select()
      .from(recordSnapshotsTable)
      .where(
        and(
          eq(recordSnapshotsTable.entityType, entityType),
          eq(recordSnapshotsTable.entityId, entityId),
        ),
      )
      .orderBy(desc(recordSnapshotsTable.createdAt))
      .limit(limit);

    // Compute consecutive diffs (newest → oldest)
    const withDiffs = rows.map((row, i) => {
      const next = rows[i + 1];
      const diff = next
        ? deepDiff(next.snapshotData as unknown, row.snapshotData as unknown)
        : null;
      return {
        ...fmtSnapshotFull(row),
        diffFromPrevious: diff,
        diffCount: diff
          ? {
              added: diff.filter((d) => d.type === "added").length,
              removed: diff.filter((d) => d.type === "removed").length,
              changed: diff.filter((d) => d.type === "changed").length,
            }
          : null,
      };
    });

    return res.json({ snapshots: withDiffs, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch entity timeline");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /snapshots/project/:projectId ─────────────────────────────────────────

router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const limit = parseLimit(req.query.limit, 100, 500);

    const rows = await db
      .select({
        id: recordSnapshotsTable.id,
        snapshotType: recordSnapshotsTable.snapshotType,
        entityId: recordSnapshotsTable.entityId,
        entityType: recordSnapshotsTable.entityType,
        projectId: recordSnapshotsTable.projectId,
        projectName: recordSnapshotsTable.projectName,
        label: recordSnapshotsTable.label,
        notes: recordSnapshotsTable.notes,
        triggerType: recordSnapshotsTable.triggerType,
        capturedByName: recordSnapshotsTable.capturedByName,
        capturedByRole: recordSnapshotsTable.capturedByRole,
        createdAt: recordSnapshotsTable.createdAt,
      })
      .from(recordSnapshotsTable)
      .where(eq(recordSnapshotsTable.projectId, projectId))
      .orderBy(desc(recordSnapshotsTable.createdAt))
      .limit(limit);

    // Count by type
    const typeCount: Record<string, number> = {};
    for (const r of rows) {
      typeCount[r.snapshotType] = (typeCount[r.snapshotType] ?? 0) + 1;
    }

    return res.json({
      snapshots: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: rows.length,
      byType: typeCount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch project snapshots");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /snapshots/:id ────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(recordSnapshotsTable)
      .where(eq(recordSnapshotsTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Snapshot not found" });
    return res.json(fmtSnapshotFull(row));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch snapshot");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
