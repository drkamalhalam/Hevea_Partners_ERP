import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  userProjectAssignmentsTable,
  inventoryStockMovementsTable,
  collectionEntriesTable,
  storeEntriesTable,
  salesTransactionsTable,
  salesOrdersTable,
  lcaLedgerTable,
  distributionRecordsTable,
  projectParticipantsTable,
  agreementsTable,
  contributionsTable,
  recoverableAdvancesTable,
  lcaConfigsTable,
  projectOwnershipFreezesTable,
  ownershipSnapshotsTable,
} from "@workspace/db";

const router = Router();

function canSeeAll(role: string): boolean {
  return role === "admin" || role === "developer";
}

function canSeeRevenue(role: string): boolean {
  return role === "admin" || role === "developer" || role === "investor";
}

function canSeeFinancials(role: string): boolean {
  return role === "admin" || role === "developer" || role === "investor" || role === "landowner";
}

// GET /card-summaries — aggregated live project card data for all accessible projects
router.get("/card-summaries", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const [actor] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.clerkUserId, clerkUserId), eq(usersTable.isActive, true)))
    .limit(1);
  if (!actor) return res.status(401).json({ error: "User not found" });

  // ── Project access scope ─────────────────────────────────────────────────────
  let visibleProjectIds: string[] | null = null;
  if (!canSeeAll(actor.role)) {
    const rows = await db
      .select({ projectId: userProjectAssignmentsTable.projectId })
      .from(userProjectAssignmentsTable)
      .where(
        and(
          eq(userProjectAssignmentsTable.userId, actor.id),
          isNull(userProjectAssignmentsTable.revokedAt),
        ),
      );
    visibleProjectIds = rows.map((r) => r.projectId);
  }

  const none = ["__none__"];

  function projectFilter<T extends { projectId: unknown }>(
    col: T["projectId"],
  ) {
    if (!visibleProjectIds) return undefined;
    return inArray(
      col as Parameters<typeof inArray>[0],
      visibleProjectIds.length > 0 ? visibleProjectIds : none,
    );
  }

  // ── All aggregation queries in parallel ──────────────────────────────────────
  const [
    projects,
    stockRows,
    collectionRows,
    storeRows,
    salesRows,
    lcaRows,
    distRows,
    participantRows,
    agreementRows,
    contributionRows,
    advanceRows,
    lcaConfigRows,
    participantRoleRows,
    freezeRows,
    crystalRows,
    salesOrderRows,
  ] = await Promise.all([
    // Visible projects list (includes governance columns)
    (() => {
      if (!visibleProjectIds) return db.select({ id: projectsTable.id, ownershipFrozenAt: projectsTable.ownershipFrozenAt, lifecycleStatus: projectsTable.lifecycleStatus }).from(projectsTable);
      if (visibleProjectIds.length === 0) return Promise.resolve([]);
      return db
        .select({ id: projectsTable.id, ownershipFrozenAt: projectsTable.ownershipFrozenAt, lifecycleStatus: projectsTable.lifecycleStatus })
        .from(projectsTable)
        .where(inArray(projectsTable.id, visibleProjectIds));
    })(),

    // Stock: confirmed balance + pending count per project + stock type
    db
      .select({
        projectId: inventoryStockMovementsTable.projectId,
        stockType: inventoryStockMovementsTable.stockType,
        unit: inventoryStockMovementsTable.unit,
        confirmedIn: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
        confirmedOut: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
        pendingCount: sql<number>`count(*) FILTER (WHERE ${inventoryStockMovementsTable.status} = 'pending')::int`,
      })
      .from(inventoryStockMovementsTable)
      .where(
        and(
          eq(inventoryStockMovementsTable.isActive, true),
          projectFilter(inventoryStockMovementsTable.projectId),
        ),
      )
      .groupBy(
        inventoryStockMovementsTable.projectId,
        inventoryStockMovementsTable.stockType,
        inventoryStockMovementsTable.unit,
      ),

    // Collection: entry count + total sheets per project
    db
      .select({
        projectId: collectionEntriesTable.projectId,
        entryCount: sql<number>`count(*)::int`,
        totalSheets: sql<number>`COALESCE(SUM(${collectionEntriesTable.sheetCount}), 0)::int`,
      })
      .from(collectionEntriesTable)
      .where(projectFilter(collectionEntriesTable.projectId))
      .groupBy(collectionEntriesTable.projectId),

    // Store: entry count + total sheets + total weight per project
    db
      .select({
        projectId: storeEntriesTable.projectId,
        entryCount: sql<number>`count(*)::int`,
        totalSheets: sql<number>`COALESCE(SUM(${storeEntriesTable.sheetCount}), 0)::int`,
        totalWeightKg: sql<number>`COALESCE(SUM(${storeEntriesTable.weightKg}), 0)`,
      })
      .from(storeEntriesTable)
      .where(
        and(
          isNull(storeEntriesTable.deletedAt),
          projectFilter(storeEntriesTable.projectId),
        ),
      )
      .groupBy(storeEntriesTable.projectId),

    // Sales: confirmed + draft counts, gross + net revenue per project
    db
      .select({
        projectId: salesTransactionsTable.projectId,
        confirmedCount: sql<number>`count(*) FILTER (WHERE ${salesTransactionsTable.status} = 'confirmed')::int`,
        draftCount: sql<number>`count(*) FILTER (WHERE ${salesTransactionsTable.status} = 'draft')::int`,
        totalGross: sql<number>`COALESCE(SUM(${salesTransactionsTable.totalGrossRevenue}::numeric) FILTER (WHERE ${salesTransactionsTable.status} = 'confirmed'), 0)`,
        totalNet: sql<number>`COALESCE(SUM(${salesTransactionsTable.totalNetRevenue}::numeric) FILTER (WHERE ${salesTransactionsTable.status} = 'confirmed'), 0)`,
      })
      .from(salesTransactionsTable)
      .where(
        and(
          eq(salesTransactionsTable.isActive, true),
          projectFilter(salesTransactionsTable.projectId),
        ),
      )
      .groupBy(salesTransactionsTable.projectId),

    // LCA: outstanding (pending + partial) balance per project
    db
      .select({
        projectId: lcaLedgerTable.projectId,
        outstandingBalance: sql<number>`COALESCE(SUM(${lcaLedgerTable.balance}) FILTER (WHERE ${lcaLedgerTable.status} IN ('pending', 'partial')), 0)`,
        outstandingCount: sql<number>`count(*) FILTER (WHERE ${lcaLedgerTable.status} IN ('pending', 'partial'))::int`,
      })
      .from(lcaLedgerTable)
      .where(projectFilter(lcaLedgerTable.projectId))
      .groupBy(lcaLedgerTable.projectId),

    // Distribution: pending payable per project
    db
      .select({
        projectId: distributionRecordsTable.projectId,
        pendingAmount: sql<number>`COALESCE(SUM(${distributionRecordsTable.pendingPayable}::numeric) FILTER (WHERE ${distributionRecordsTable.status} NOT IN ('paid')), 0)`,
        pendingCount: sql<number>`count(*) FILTER (WHERE ${distributionRecordsTable.status} NOT IN ('paid') AND ${distributionRecordsTable.pendingPayable}::numeric > 0)::int`,
      })
      .from(distributionRecordsTable)
      .where(
        and(
          eq(distributionRecordsTable.isActive, true),
          projectFilter(distributionRecordsTable.projectId),
        ),
      )
      .groupBy(distributionRecordsTable.projectId),

    // KYC participants: count per project
    db
      .select({
        projectId: projectParticipantsTable.projectId,
        kycCount: sql<number>`count(*)::int`,
      })
      .from(projectParticipantsTable)
      .where(projectFilter(projectParticipantsTable.projectId))
      .groupBy(projectParticipantsTable.projectId),

    // Agreements: count + latest status per project
    db
      .select({
        projectId: agreementsTable.projectId,
        agreementCount: sql<number>`count(*)::int`,
        latestStatus: sql<string>`(array_agg(${agreementsTable.status} ORDER BY ${agreementsTable.createdAt} DESC))[1]`,
      })
      .from(agreementsTable)
      .where(
        and(
          isNull(agreementsTable.deletedAt),
          projectFilter(agreementsTable.projectId),
        ),
      )
      .groupBy(agreementsTable.projectId),

    // Contributions: total, verified, ownership-eligible, pending, disputed, reimbursement per project
    db
      .select({
        projectId: contributionsTable.projectId,
        totalAmount: sql<number>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
        verifiedAmount: sql<number>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.verificationStatus} = 'verified'), 0)`,
        ownershipEligibleAmount: sql<number>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.verificationStatus} = 'verified' AND ${contributionsTable.affectsOwnership} = true AND ${contributionsTable.lifecyclePhaseSnapshot} = 'prematurity'), 0)`,
        pendingCount: sql<number>`count(*) FILTER (WHERE ${contributionsTable.verificationStatus} IN ('draft', 'pending_verification'))::int`,
        disputedCount: sql<number>`count(*) FILTER (WHERE ${contributionsTable.verificationStatus} = 'disputed')::int`,
        contributorCount: sql<number>`count(DISTINCT ${contributionsTable.partnerId})::int`,
        reimbursementTotal: sql<number>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.reimbursementFlag} = true), 0)`,
        reimbursementCount: sql<number>`count(*) FILTER (WHERE ${contributionsTable.reimbursementFlag} = true)::int`,
      })
      .from(contributionsTable)
      .where(
        and(
          eq(contributionsTable.isActive, true),
          projectFilter(contributionsTable.projectId),
        ),
      )
      .groupBy(contributionsTable.projectId),

    // Recoverable advances: outstanding balance + open count per project
    db
      .select({
        projectId: recoverableAdvancesTable.projectId,
        totalOutstanding: sql<number>`COALESCE(SUM(${recoverableAdvancesTable.originalAmount}::numeric - ${recoverableAdvancesTable.recoveredAmount}::numeric) FILTER (WHERE ${recoverableAdvancesTable.status} NOT IN ('recovered', 'written_off')), 0)`,
        pendingCount: sql<number>`count(*) FILTER (WHERE ${recoverableAdvancesTable.status} IN ('pending', 'acknowledged', 'in_recovery'))::int`,
      })
      .from(recoverableAdvancesTable)
      .where(
        and(
          eq(recoverableAdvancesTable.isActive, true),
          projectFilter(recoverableAdvancesTable.projectId),
        ),
      )
      .groupBy(recoverableAdvancesTable.projectId),

    // LCA configs: whether at least one config exists per project
    db
      .select({
        projectId: lcaConfigsTable.projectId,
        count: sql<number>`count(*)::int`,
      })
      .from(lcaConfigsTable)
      .where(projectFilter(lcaConfigsTable.projectId))
      .groupBy(lcaConfigsTable.projectId),

    // Participant role breakdown per project
    db
      .select({
        projectId: projectParticipantsTable.projectId,
        role: projectParticipantsTable.role,
        count: sql<number>`count(*)::int`,
      })
      .from(projectParticipantsTable)
      .where(projectFilter(projectParticipantsTable.projectId))
      .groupBy(projectParticipantsTable.projectId, projectParticipantsTable.role),

    // Ownership freeze status per project
    db
      .select({
        projectId: projectOwnershipFreezesTable.projectId,
        status: projectOwnershipFreezesTable.status,
        frozenAt: projectOwnershipFreezesTable.frozenAt,
      })
      .from(projectOwnershipFreezesTable)
      .where(
        visibleProjectIds && visibleProjectIds.length > 0
          ? inArray(projectOwnershipFreezesTable.projectId, visibleProjectIds)
          : undefined,
      ),

    // Crystallization snapshot: participant count per project
    db
      .select({
        projectId: ownershipSnapshotsTable.projectId,
        snapshotCount: sql<number>`count(*)::int`,
        latestAt: sql<string>`MAX(${ownershipSnapshotsTable.snapshotAt})`,
      })
      .from(ownershipSnapshotsTable)
      .where(
        and(
          eq(ownershipSnapshotsTable.snapshotType, "maturity_declaration"),
          visibleProjectIds && visibleProjectIds.length > 0
            ? inArray(ownershipSnapshotsTable.projectId, visibleProjectIds)
            : undefined,
        ),
      )
      .groupBy(ownershipSnapshotsTable.projectId),

    // V2 Sales Orders pipeline stats per project.
    // unbridgedRevenue: confirmed V2 orders that do NOT yet have a V1 bridge record —
    // these are added to totalGrossRevenue so they appear in project cards immediately,
    // without double-counting orders that already have a V1 salesTransactions bridge.
    db
      .select({
        projectId: salesOrdersTable.projectId,
        confirmedCount: sql<number>`count(*) FILTER (WHERE ${salesOrdersTable.orderStatus} IN ('confirmed', 'partially_dispatched', 'completed'))::int`,
        completedCount: sql<number>`count(*) FILTER (WHERE ${salesOrdersTable.orderStatus} = 'completed')::int`,
        pendingDispatchKg: sql<number>`COALESCE(SUM((${salesOrdersTable.quantityKg}::numeric - COALESCE(${salesOrdersTable.quantityDispatchedKg}::numeric, 0))) FILTER (WHERE ${salesOrdersTable.orderStatus} IN ('confirmed', 'partially_dispatched')), 0)`,
        totalConfirmedRevenue: sql<number>`COALESCE(SUM(${salesOrdersTable.totalAmount}::numeric) FILTER (WHERE ${salesOrdersTable.orderStatus} IN ('confirmed', 'partially_dispatched', 'completed')), 0)`,
        unbridgedRevenue: sql<number>`COALESCE(SUM(${salesOrdersTable.totalAmount}::numeric) FILTER (WHERE ${salesOrdersTable.orderStatus} IN ('confirmed', 'partially_dispatched', 'completed') AND NOT EXISTS (SELECT 1 FROM sales_transactions st WHERE st.sale_number = ${salesOrdersTable.salesCode})), 0)`,
      })
      .from(salesOrdersTable)
      .where(projectFilter(salesOrdersTable.projectId))
      .groupBy(salesOrdersTable.projectId),
  ]);

  // ── Build lookup maps ────────────────────────────────────────────────────────

  type StockEntry = { balance: number; unit: string; totalIn: number; totalOut: number };
  const stockMap = new Map<string, { rubber_sheet?: StockEntry; rubber_scrap?: StockEntry; latex?: StockEntry; pendingCount: number }>();
  for (const r of stockRows) {
    if (!stockMap.has(r.projectId)) stockMap.set(r.projectId, { pendingCount: 0 });
    const entry = stockMap.get(r.projectId)!;
    const stockData: StockEntry = {
      balance: Number(r.confirmedIn) - Number(r.confirmedOut),
      unit: r.unit,
      totalIn: Number(r.confirmedIn),
      totalOut: Number(r.confirmedOut),
    };
    if (r.stockType === "rubber_sheet") entry.rubber_sheet = stockData;
    else if (r.stockType === "rubber_scrap") entry.rubber_scrap = stockData;
    else if (r.stockType === "latex") entry.latex = stockData;
    entry.pendingCount += Number(r.pendingCount);
  }

  const collectionMap = new Map(collectionRows.map((r) => [r.projectId, r]));
  const storeMap = new Map(storeRows.map((r) => [r.projectId, r]));
  const salesMap = new Map(salesRows.map((r) => [r.projectId, r]));
  const salesOrderMap = new Map(salesOrderRows.map((r) => [r.projectId, r]));
  const lcaMap = new Map(lcaRows.map((r) => [r.projectId, r]));
  const distMap = new Map(distRows.map((r) => [r.projectId, r]));
  const participantMap = new Map(participantRows.map((r) => [r.projectId, r]));
  const agreementMap = new Map(agreementRows.map((r) => [r.projectId, r]));
  const contributionMap = new Map(contributionRows.map((r) => [r.projectId, r]));
  const advanceMap = new Map(advanceRows.map((r) => [r.projectId, r]));
  const lcaConfigMap = new Map(lcaConfigRows.map((r) => [r.projectId, r]));
  const freezeMap = new Map(freezeRows.map((r) => [r.projectId, r]));
  const crystalMap = new Map(crystalRows.map((r) => [r.projectId, r]));
  const projectGovernanceMap = new Map(projects.map((p) => [p.id, p]));

  // Build participant role breakdown map: projectId -> { landowner, developer, investor, other }
  const participantRoleMap = new Map<string, { landowner: number; developer: number; investor: number; other: number }>();
  for (const r of participantRoleRows) {
    if (!participantRoleMap.has(r.projectId)) {
      participantRoleMap.set(r.projectId, { landowner: 0, developer: 0, investor: 0, other: 0 });
    }
    const entry = participantRoleMap.get(r.projectId)!;
    const count = Number(r.count);
    if (r.role === "landowner") entry.landowner += count;
    else if (r.role === "developer") entry.developer += count;
    else if (r.role === "investor") entry.investor += count;
    else entry.other += count;
  }

  const showRevenue = canSeeRevenue(actor.role);
  const showFinancials = canSeeFinancials(actor.role);

  const summaries = projects.map((p) => {
    const pid = p.id;
    const stock = stockMap.get(pid) ?? { pendingCount: 0 };
    const sheetStock = stock.rubber_sheet;
    const scrapStock = stock.rubber_scrap;
    const latexStock = stock.latex;

    const col = collectionMap.get(pid);
    const store = storeMap.get(pid);
    const sales = salesMap.get(pid);
    const v2so = salesOrderMap.get(pid);
    const lca = lcaMap.get(pid);
    const dist = distMap.get(pid);
    const parts = participantMap.get(pid);
    const agr = agreementMap.get(pid);
    const contrib = contributionMap.get(pid);
    const adv = advanceMap.get(pid);
    const lcaCfg = lcaConfigMap.get(pid);
    const roles = participantRoleMap.get(pid) ?? { landowner: 0, developer: 0, investor: 0, other: 0 };
    const freeze = freezeMap.get(pid);
    const crystal = crystalMap.get(pid);
    const gov = projectGovernanceMap.get(pid);
    const ownershipFrozen = !!freeze || !!gov?.ownershipFrozenAt;
    const lifecycleStatus = gov?.lifecycleStatus ?? "prematurity";
    const maturityLocked = lifecycleStatus !== "prematurity";

    // Settlement exposure: total unpaid distribution + outstanding LCA (financial-role-gated)
    const settlementExposure = showFinancials
      ? (dist ? Number(dist.pendingAmount) : 0) + (lca ? Number(lca.outstandingBalance) : 0)
      : null;

    return {
      projectId: pid,

      // Stock (confirmed inventory ledger balances)
      rubberSheetBalanceKg: sheetStock?.balance ?? 0,
      rubberScrapBalanceKg: scrapStock?.balance ?? 0,
      latexBalanceLitres: latexStock?.balance ?? 0,
      pendingStockCount: stock.pendingCount,

      // Collection (raw fresh-sheet production)
      collectionEntryCount: col ? Number(col.entryCount) : 0,
      collectionSheetCount: col ? Number(col.totalSheets) : 0,

      // Store (post-drying rubber in storage)
      storeEntryCount: store ? Number(store.entryCount) : 0,
      storeSheetCount: store ? Number(store.totalSheets) : 0,
      storeWeightKg: store ? Number(store.totalWeightKg) : 0,

      // Sales — V1 transactions PLUS unbridged V2 orders.
      // totalGrossRevenue = V1 confirmed transactions + V2 confirmed orders not yet in V1.
      // This is double-count-safe: the NOT EXISTS filter in the V2 query excludes any V2
      // order that already has a matching V1 bridge record (documentRef = salesCode).
      confirmedSaleCount: (sales ? Number(sales.confirmedCount) : 0) + (v2so ? Number(v2so.confirmedCount) : 0),
      draftSaleCount: sales ? Number(sales.draftCount) : 0,
      totalGrossRevenue: showRevenue
        ? (sales ? Number(sales.totalGross) : 0) + (v2so ? Number(v2so.unbridgedRevenue) : 0)
        : null,
      totalNetRevenue: showRevenue
        ? (sales ? Number(sales.totalNet) : 0) + (v2so ? Number(v2so.unbridgedRevenue) : 0)
        : null,
      // V2 pipeline visibility — dispatch progress + full pipeline revenue
      v2ActiveOrderCount: v2so ? Number(v2so.confirmedCount) : 0,
      v2CompletedOrderCount: v2so ? Number(v2so.completedCount) : 0,
      v2PendingDispatchKg: v2so ? Number(v2so.pendingDispatchKg) : 0,
      v2PipelineRevenue: showRevenue ? (v2so ? Number(v2so.totalConfirmedRevenue) : 0) : null,

      // LCA outstanding
      lcaOutstandingBalance: showFinancials ? (lca ? Number(lca.outstandingBalance) : 0) : null,
      lcaOutstandingCount: lca ? Number(lca.outstandingCount) : 0,

      // Distribution pending
      distributionPendingAmount: showFinancials ? (dist ? Number(dist.pendingAmount) : 0) : null,
      distributionPendingCount: dist ? Number(dist.pendingCount) : 0,

      // Participants (KYC total)
      kycParticipantCount: parts ? Number(parts.kycCount) : 0,

      // Agreements
      agreementCount: agr ? Number(agr.agreementCount) : 0,
      latestAgreementStatus: agr?.latestStatus ?? null,

      // ── Contribution intelligence ──────────────────────────────────────────
      contributionTotal: contrib ? Number(contrib.totalAmount) : 0,
      contributionVerified: contrib ? Number(contrib.verifiedAmount) : 0,
      contributionOwnershipEligible: contrib ? Number(contrib.ownershipEligibleAmount) : 0,
      contributionPendingCount: contrib ? Number(contrib.pendingCount) : 0,
      contributionDisputedCount: contrib ? Number(contrib.disputedCount) : 0,
      contributorCount: contrib ? Number(contrib.contributorCount) : 0,
      reimbursementTotal: contrib ? Number(contrib.reimbursementTotal) : 0,
      reimbursementCount: contrib ? Number(contrib.reimbursementCount) : 0,

      // ── Recoverable advances ───────────────────────────────────────────────
      advancesTotalOutstanding: adv ? Number(adv.totalOutstanding) : 0,
      advancesPendingCount: adv ? Number(adv.pendingCount) : 0,

      // ── LCA configuration ──────────────────────────────────────────────────
      lcaIsConfigured: lcaCfg ? Number(lcaCfg.count) > 0 : false,

      // ── Participant role breakdown ─────────────────────────────────────────
      participantLandownerCount: roles.landowner,
      participantDeveloperCount: roles.developer,
      participantInvestorCount: roles.investor,
      participantOtherCount: roles.other,

      // ── Governance / crystallization ───────────────────────────────────────
      ownershipFrozen,
      ownershipFrozenAt: gov?.ownershipFrozenAt?.toISOString() ?? null,
      crystallizationParticipantCount: crystal ? Number(crystal.snapshotCount) : 0,
      settlementExposure,
      maturityLocked,
    };
  });

  req.log.info({ projectCount: summaries.length, role: actor.role }, "card-summaries fetched");
  return res.json({ summaries });
});

export default router;
