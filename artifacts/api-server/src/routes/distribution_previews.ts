/**
 * distribution_previews.ts
 *
 * Model-aware financial distribution preview API.
 * Routes mounted at /distribution-previews.
 *
 * This module handles SETTLEMENT GUIDANCE only — no actual payments.
 * All calculations are stored as advisory previews that admins can confirm.
 *
 * IMPORTANT: All static sub-paths (lca-lookup, revenue-lookup, ownership-lookup)
 * MUST be registered BEFORE the /:id wildcard handler.
 */

import { Router } from "express";
import {
  db,
  distributionPreviewsTable,
  agreementsTable,
  agreementAccountingProfilesTable,
  projectsTable,
  partnersTable,
  ownershipSnapshotsTable,
  lcaLedgerTable,
  usersTable,
  projectOwnershipFreezesTable,
  salesTransactionsTable,
} from "@workspace/db";
import type { DistributionResult } from "@workspace/db";
import {
  eq,
  and,
  desc,
  isNull,
  count,
  or,
  inArray,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import { toNum } from "../lib/numericSafe.js";
import {
  calculateContributionDistribution,
  calculateFiftyPercentDistribution,
  sharesFromSnapshot,
  sharesFromAgreement,
} from "../lib/distributionEngine";
import type { ContributionModelInputs } from "../lib/distributionEngine";
import { z } from "zod/v4";
import type {
  OwnershipSnapshotEntry,
  ContributionDistributionResult,
} from "@workspace/db";

type OwnershipSource = ContributionDistributionResult["ownershipSource"];

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

const router = Router();

// ── Input schemas ──────────────────────────────────────────────────────────

const OwnershipOverrideEntry = z.object({
  partnerKey: z.string(),
  partnerId: z.string().uuid().nullable(),
  partnerName: z.string(),
  role: z.enum(["landowner", "developer", "unknown"]).default("unknown"),
  percentage: z.number().min(0).max(100),
});

const CreatePreviewSchema = z.object({
  projectId: z.string().uuid(),
  agreementId: z.string().uuid().optional(),
  periodLabel: z.string().min(1).max(100),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  periodYear: z.number().int().optional(),
  grossRevenue: z.number().min(0),
  operationalCost: z.number().min(0).default(0),
  lcaAmount: z.number().min(0).default(0),
  lcaSource: z.enum(["manual", "ledger"]).default("manual"),
  notes: z.string().optional(),
  // Sales linkage
  linkedSaleIds: z.array(z.string().uuid()).default([]),
  revenueSource: z.enum(["sales_records", "manual"]).default("manual"),
  // Ownership snapshot linkage
  ownershipSnapshotId: z.string().uuid().optional(),
  ownershipSnapshotEntries: z.array(z.any()).default([]),
  // Optional overrides for ownership shares
  ownershipOverride: z.array(OwnershipOverrideEntry).optional(),
});

const PatchPreviewSchema = z.object({
  periodLabel: z.string().min(1).max(100).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  periodYear: z.number().int().optional(),
  grossRevenue: z.number().min(0).optional(),
  operationalCost: z.number().min(0).optional(),
  lcaAmount: z.number().min(0).optional(),
  lcaSource: z.enum(["manual", "ledger"]).optional(),
  notes: z.string().optional(),
  linkedSaleIds: z.array(z.string().uuid()).optional(),
  revenueSource: z.enum(["sales_records", "manual"]).optional(),
  ownershipSnapshotId: z.string().uuid().optional(),
  ownershipSnapshotEntries: z.array(z.any()).optional(),
  ownershipOverride: z.array(OwnershipOverrideEntry).optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveOwnershipShares(
  projectId: string,
  agreementId: string | null | undefined,
  agreement: {
    landOwnerId: string;
    projectDeveloperId: string;
    ownershipShareLandowner: number | null;
    ownershipShareDeveloper: number | null;
  } | null,
  snapshotId?: string,
  ownershipOverride?: ContributionModelInputs["ownerShares"],
): Promise<{
  ownerShares: ContributionModelInputs["ownerShares"];
  ownershipSource: OwnershipSource;
  snapshotEntries: OwnershipSnapshotEntry[];
  warnings: string[];
}> {
  const warnings: string[] = [];

  // 1. Explicit override wins
  if (ownershipOverride && ownershipOverride.length > 0) {
    return {
      ownerShares: ownershipOverride,
      ownershipSource: "manual",
      snapshotEntries: [],
      warnings: ["Ownership shares were provided manually (not from the system)."],
    };
  }

  // 2. Specific snapshot requested
  if (snapshotId) {
    const [snap] = await db
      .select()
      .from(ownershipSnapshotsTable)
      .where(and(
        eq(ownershipSnapshotsTable.id, snapshotId),
        eq(ownershipSnapshotsTable.projectId, projectId),
      ))
      .limit(1);

    if (snap && snap.entries.length > 0) {
      const entries = snap.entries as OwnershipSnapshotEntry[];
      const shares = sharesFromSnapshot(entries, agreement?.landOwnerId, agreement?.projectDeveloperId);
      const isFrozen = await db
        .select({ id: projectOwnershipFreezesTable.id })
        .from(projectOwnershipFreezesTable)
        .where(eq(projectOwnershipFreezesTable.projectId, projectId))
        .limit(1);
      if (isFrozen.length === 0) {
        warnings.push("Ownership is not yet frozen. Using a selected snapshot — percentages may change before final settlement.");
      }
      return { ownerShares: shares, ownershipSource: "frozen_snapshot", snapshotEntries: entries, warnings };
    }
  }

  // 3. Try latest ownership snapshot for the project
  const snapshots = await db
    .select()
    .from(ownershipSnapshotsTable)
    .where(eq(ownershipSnapshotsTable.projectId, projectId))
    .orderBy(desc(ownershipSnapshotsTable.snapshotAt))
    .limit(1);

  const isFrozen = await db
    .select({ id: projectOwnershipFreezesTable.id })
    .from(projectOwnershipFreezesTable)
    .where(eq(projectOwnershipFreezesTable.projectId, projectId))
    .limit(1);

  if (snapshots.length > 0 && snapshots[0].entries.length > 0) {
    const snap = snapshots[0];
    const entries = snap.entries as OwnershipSnapshotEntry[];
    const shares = sharesFromSnapshot(entries, agreement?.landOwnerId, agreement?.projectDeveloperId);
    const source: OwnershipSource = isFrozen.length > 0 ? "frozen_snapshot" : "live_calculation";
    if (isFrozen.length === 0) {
      warnings.push("Ownership is not yet frozen. Using the latest ownership snapshot — percentages may change before final settlement.");
    }
    return { ownerShares: shares, ownershipSource: source, snapshotEntries: entries, warnings };
  }

  // 4. Fall back to agreement ownership shares (two-party)
  if (
    agreement &&
    agreement.ownershipShareLandowner != null &&
    agreement.ownershipShareDeveloper != null
  ) {
    const partnerIds = [agreement.landOwnerId, agreement.projectDeveloperId];
    const partners = await db
      .select({ id: partnersTable.id, name: partnersTable.name })
      .from(partnersTable)
      .where(or(eq(partnersTable.id, partnerIds[0]), eq(partnersTable.id, partnerIds[1])));
    const byId = Object.fromEntries(partners.map((p) => [p.id, p.name]));

    warnings.push(
      "Using ownership shares from the agreement record (no contribution snapshot found). These reflect the agreement's stated shares, not computed contribution ratios.",
    );
    return {
      ownerShares: sharesFromAgreement({
        landownerId: agreement.landOwnerId,
        landownerName: byId[agreement.landOwnerId] ?? "Landowner",
        landownerPct: agreement.ownershipShareLandowner,
        developerId: agreement.projectDeveloperId,
        developerName: byId[agreement.projectDeveloperId] ?? "Developer",
        developerPct: agreement.ownershipShareDeveloper,
      }),
      ownershipSource: "agreement_shares",
      snapshotEntries: [],
      warnings,
    };
  }

  warnings.push(
    "No ownership data found (no snapshot, no agreement shares). Distribution cannot be computed per-partner. Please add verified contributions or set ownership shares on the agreement.",
  );
  return { ownerShares: [], ownershipSource: "manual", snapshotEntries: [], warnings };
}

async function buildDistributionResult(
  inputs: z.infer<typeof CreatePreviewSchema>,
  agreement: {
    id: string;
    landOwnerId: string;
    projectDeveloperId: string;
    ownershipShareLandowner: number | null;
    ownershipShareDeveloper: number | null;
    revenueModel: string;
  } | null,
  profile: {
    accountingModel: string;
    costsChargedBeforeDistribution: boolean;
    lcaChargedBeforeDistribution: boolean;
    lcaApplicable: boolean;
    grossSplitPctLandowner: number;
    grossSplitPctDeveloper: number;
  } | null,
): Promise<{ result: DistributionResult; snapshotEntries: OwnershipSnapshotEntry[] }> {
  const model = profile?.accountingModel ?? agreement?.revenueModel ?? "contribution";

  if (model === "fifty_percent_revenue") {
    const splitPctLandowner = profile?.grossSplitPctLandowner ?? 50;
    const splitPctDeveloper = profile?.grossSplitPctDeveloper ?? 50;
    return {
      result: calculateFiftyPercentDistribution({
        grossRevenue: inputs.grossRevenue,
        operationalCost: inputs.operationalCost,
        splitPctLandowner,
        splitPctDeveloper,
      }),
      snapshotEntries: [],
    };
  }

  const { ownerShares, ownershipSource, snapshotEntries, warnings } = await resolveOwnershipShares(
    inputs.projectId,
    inputs.agreementId,
    agreement,
    inputs.ownershipSnapshotId,
    inputs.ownershipOverride,
  );

  return {
    result: calculateContributionDistribution({
      grossRevenue: inputs.grossRevenue,
      operationalCost: inputs.operationalCost,
      lcaAmount: inputs.lcaAmount,
      costsChargedBeforeDistribution: profile?.costsChargedBeforeDistribution ?? true,
      lcaChargedBeforeDistribution: profile?.lcaChargedBeforeDistribution ?? true,
      lcaApplicable: profile?.lcaApplicable ?? false,
      ownerShares,
      ownershipSource,
      warnings,
    }),
    snapshotEntries,
  };
}

function formatPreview(p: typeof distributionPreviewsTable.$inferSelect) {
  return {
    id: p.id,
    projectId: p.projectId,
    agreementId: p.agreementId,
    accountingModel: p.accountingModel,
    periodLabel: p.periodLabel,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    periodYear: p.periodYear,
    grossRevenue: p.grossRevenue,
    operationalCost: p.operationalCost,
    lcaAmount: p.lcaAmount,
    lcaSource: p.lcaSource,
    linkedSaleIds: (p.linkedSaleIds as string[]) ?? [],
    revenueSource: p.revenueSource,
    ownershipSnapshotId: p.ownershipSnapshotId,
    ownershipSnapshotEntries: (p.ownershipSnapshotEntries as OwnershipSnapshotEntry[]) ?? [],
    notes: p.notes,
    distributionResult: p.distributionResult,
    status: p.status,
    isActive: p.isActive,
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    confirmedByName: p.confirmedByName,
    calculatedByName: p.calculatedByName,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// STATIC LOOKUP ROUTES — must be registered before /:id wildcard
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /distribution-previews/lca-lookup ─────────────────────────────────

router.get("/lca-lookup", async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;

  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!req.canAccessAllProjects && !req.userProjectIds?.includes(projectId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const conditions = [eq(lcaLedgerTable.projectId, projectId)];
  if (year) conditions.push(eq(lcaLedgerTable.year, year));

  const entries = await db
    .select({
      id: lcaLedgerTable.id,
      year: lcaLedgerTable.year,
      grossDue: lcaLedgerTable.grossDue,
      totalDue: lcaLedgerTable.totalDue,
      amountPaid: lcaLedgerTable.amountPaid,
      balance: lcaLedgerTable.balance,
      status: lcaLedgerTable.status,
    })
    .from(lcaLedgerTable)
    .where(and(...conditions))
    .orderBy(lcaLedgerTable.year);

  // NPF Stage-2 readiness: wrap raw DB balance in toNum() to prevent string
  // concatenation once lca_ledger.balance becomes a numeric string post-migration.
  const totalBalance = entries.reduce((s, e) => s + toNum(e.balance), 0);
  return res.json({ projectId, entries, totalBalance: Math.round(totalBalance * 100) / 100 });
});

// ── GET /distribution-previews/revenue-lookup ─────────────────────────────
// Fetches confirmed sales transactions for a project/period and returns a
// revenue summary for use as distribution inputs.

router.get("/revenue-lookup", async (req, res) => {
  const { projectId, from, to } = req.query as Record<string, string>;

  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!req.canAccessAllProjects && !req.userProjectIds?.includes(projectId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const conditions = [
    eq(salesTransactionsTable.projectId, projectId),
    eq(salesTransactionsTable.isActive, true),
    eq(salesTransactionsTable.status, "confirmed"),
  ];
  if (from) conditions.push(gte(salesTransactionsTable.saleDate, from));
  if (to) conditions.push(lte(salesTransactionsTable.saleDate, to));

  const sales = await db
    .select({
      id: salesTransactionsTable.id,
      saleNumber: salesTransactionsTable.saleNumber,
      saleDate: salesTransactionsTable.saleDate,
      buyerName: salesTransactionsTable.buyerName,
      totalGrossRevenue: salesTransactionsTable.totalGrossRevenue,
      totalDeductions: salesTransactionsTable.totalDeductions,
      totalNetRevenue: salesTransactionsTable.totalNetRevenue,
      confirmedAt: salesTransactionsTable.confirmedAt,
    })
    .from(salesTransactionsTable)
    .where(and(...conditions))
    .orderBy(desc(salesTransactionsTable.saleDate));

  const totalGross = sales.reduce((s, r) => s + parseFloat(String(r.totalGrossRevenue ?? 0)), 0);
  const totalDeductions = sales.reduce((s, r) => s + parseFloat(String(r.totalDeductions ?? 0)), 0);
  const totalNet = sales.reduce((s, r) => s + parseFloat(String(r.totalNetRevenue ?? 0)), 0);

  return res.json({
    projectId,
    from: from ?? null,
    to: to ?? null,
    saleCount: sales.length,
    totalGrossRevenue: Math.round(totalGross * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    totalNetRevenue: Math.round(totalNet * 100) / 100,
    sales: sales.map((s) => ({
      id: s.id,
      saleNumber: s.saleNumber,
      saleDate: s.saleDate,
      buyerName: s.buyerName,
      grossRevenue: parseFloat(String(s.totalGrossRevenue ?? 0)),
      deductions: parseFloat(String(s.totalDeductions ?? 0)),
      netRevenue: parseFloat(String(s.totalNetRevenue ?? 0)),
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
    })),
  });
});

// ── GET /distribution-previews/ownership-lookup ───────────────────────────
// Fetches available ownership snapshots for a project and the current
// live ownership data — for use in selecting a snapshot for distribution.

router.get("/ownership-lookup", async (req, res) => {
  const { projectId } = req.query as Record<string, string>;

  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!req.canAccessAllProjects && !req.userProjectIds?.includes(projectId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const snapshots = await db
    .select({
      id: ownershipSnapshotsTable.id,
      snapshotType: ownershipSnapshotsTable.snapshotType,
      lifecycleStatus: ownershipSnapshotsTable.lifecycleStatus,
      totalRecognizedAmount: ownershipSnapshotsTable.totalRecognizedAmount,
      entries: ownershipSnapshotsTable.entries,
      notes: ownershipSnapshotsTable.notes,
      triggeredByName: ownershipSnapshotsTable.triggeredByName,
      snapshotAt: ownershipSnapshotsTable.snapshotAt,
    })
    .from(ownershipSnapshotsTable)
    .where(eq(ownershipSnapshotsTable.projectId, projectId))
    .orderBy(desc(ownershipSnapshotsTable.snapshotAt))
    .limit(20);

  const isFrozen = await db
    .select()
    .from(projectOwnershipFreezesTable)
    .where(eq(projectOwnershipFreezesTable.projectId, projectId))
    .limit(1);

  return res.json({
    projectId,
    isFrozen: isFrozen.length > 0,
    frozenAt: isFrozen[0]?.frozenAt?.toISOString() ?? null,
    snapshots: snapshots.map((s) => ({
      id: s.id,
      snapshotType: s.snapshotType,
      lifecycleStatus: s.lifecycleStatus,
      totalRecognizedAmount: s.totalRecognizedAmount,
      entries: s.entries as OwnershipSnapshotEntry[],
      notes: s.notes,
      triggeredByName: s.triggeredByName,
      snapshotAt: s.snapshotAt.toISOString(),
    })),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRUD ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /distribution-previews ────────────────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = CreatePreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    }
    const inputs = parsed.data;

    // Fetch agreement + accounting profile if agreementId provided
    let agreement = null;
    let profile = null;
    let accountingModel = "contribution";

    if (inputs.agreementId) {
      const [agr] = await db
        .select()
        .from(agreementsTable)
        .where(
          and(
            eq(agreementsTable.id, inputs.agreementId),
            eq(agreementsTable.projectId, inputs.projectId),
            isNull(agreementsTable.deletedAt),
          ),
        )
        .limit(1);
      if (!agr) return res.status(404).json({ error: "Agreement not found for this project" });
      agreement = agr;
      accountingModel = agr.revenueModel;

      const [prof] = await db
        .select()
        .from(agreementAccountingProfilesTable)
        .where(eq(agreementAccountingProfilesTable.agreementId, inputs.agreementId))
        .limit(1);
      profile = prof ?? null;
      if (prof) accountingModel = prof.accountingModel;
    }

    // Project access check
    if (!req.canAccessAllProjects && !req.userProjectIds?.includes(inputs.projectId)) {
      return res.status(403).json({ error: "Access denied to this project" });
    }

    // If linked sales provided, verify gross revenue matches (warn but don't block)
    let resolvedGrossRevenue = inputs.grossRevenue;
    if (inputs.revenueSource === "sales_records" && inputs.linkedSaleIds.length > 0) {
      const linkedSales = await db
        .select({ totalGrossRevenue: salesTransactionsTable.totalGrossRevenue })
        .from(salesTransactionsTable)
        .where(
          and(
            inArray(salesTransactionsTable.id, inputs.linkedSaleIds),
            eq(salesTransactionsTable.projectId, inputs.projectId),
            eq(salesTransactionsTable.isActive, true),
          ),
        );
      const sumFromSales = linkedSales.reduce(
        (s, r) => s + parseFloat(String(r.totalGrossRevenue ?? 0)),
        0,
      );
      // Use the computed sum from actual sales records
      resolvedGrossRevenue = Math.round(sumFromSales * 100) / 100;
    }

    const mergedInputs = { ...inputs, grossRevenue: resolvedGrossRevenue };
    const { result: distributionResult, snapshotEntries } = await buildDistributionResult(
      mergedInputs,
      agreement,
      profile,
    );

    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveActor(clerkUserId) : null;
    const callerName = actor?.displayName ?? actor?.clerkUserId ?? "System";

    // Determine which snapshot entries to persist
    const finalSnapshotEntries =
      inputs.ownershipSnapshotEntries.length > 0
        ? (inputs.ownershipSnapshotEntries as OwnershipSnapshotEntry[])
        : snapshotEntries;

    const [inserted] = await db
      .insert(distributionPreviewsTable)
      .values({
        projectId: inputs.projectId,
        agreementId: inputs.agreementId ?? null,
        accountingModel,
        periodLabel: inputs.periodLabel,
        periodStart: inputs.periodStart ?? null,
        periodEnd: inputs.periodEnd ?? null,
        periodYear: inputs.periodYear ?? null,
        grossRevenue: resolvedGrossRevenue,
        operationalCost: inputs.operationalCost,
        lcaAmount: inputs.lcaAmount,
        lcaSource: inputs.lcaSource,
        linkedSaleIds: inputs.linkedSaleIds,
        revenueSource: inputs.revenueSource,
        ownershipSnapshotId: inputs.ownershipSnapshotId ?? null,
        ownershipSnapshotEntries: finalSnapshotEntries,
        notes: inputs.notes ?? null,
        distributionResult,
        status: "draft",
        calculatedById: actor?.id ?? null,
        calculatedByName: callerName,
      })
      .returning();

    return res.status(201).json(formatPreview(inserted));
  },
);

// ── GET /distribution-previews ─────────────────────────────────────────────

router.get("/", async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  const agreementId = req.query.agreementId as string | undefined;
  const status = req.query.status as string | undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);

  const conditions = [eq(distributionPreviewsTable.isActive, true)];

  if (projectId) {
    if (!req.canAccessAllProjects && !req.userProjectIds?.includes(projectId)) {
      return res.status(403).json({ error: "Access denied to this project" });
    }
    conditions.push(eq(distributionPreviewsTable.projectId, projectId));
  } else if (!req.canAccessAllProjects) {
    return res.status(400).json({ error: "projectId is required for this role" });
  }

  if (agreementId) conditions.push(eq(distributionPreviewsTable.agreementId, agreementId));
  if (status) conditions.push(eq(distributionPreviewsTable.status, status));

  const rows = await db
    .select()
    .from(distributionPreviewsTable)
    .where(and(...conditions))
    .orderBy(desc(distributionPreviewsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(distributionPreviewsTable)
    .where(and(...conditions));

  return res.json({ previews: rows.map(formatPreview), total });
});

// ── GET /distribution-previews/:id ────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = String(req.params.id);

  const [preview] = await db
    .select()
    .from(distributionPreviewsTable)
    .where(and(eq(distributionPreviewsTable.id, id), eq(distributionPreviewsTable.isActive, true)))
    .limit(1);

  if (!preview) return res.status(404).json({ error: "Preview not found" });
  if (!req.canAccessAllProjects && !req.userProjectIds?.includes(preview.projectId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const [project] = await db
    .select({ name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, preview.projectId))
    .limit(1);

  let agreementContext = null;
  if (preview.agreementId) {
    const [agr] = await db
      .select({ status: agreementsTable.status, revenueModel: agreementsTable.revenueModel })
      .from(agreementsTable)
      .where(eq(agreementsTable.id, preview.agreementId))
      .limit(1);
    agreementContext = agr ?? null;
  }

  // Fetch linked sale summaries
  let linkedSales: { id: string; saleNumber: string; saleDate: string; grossRevenue: number }[] = [];
  const saleIds = (preview.linkedSaleIds as string[]) ?? [];
  if (saleIds.length > 0) {
    const sales = await db
      .select({
        id: salesTransactionsTable.id,
        saleNumber: salesTransactionsTable.saleNumber,
        saleDate: salesTransactionsTable.saleDate,
        totalGrossRevenue: salesTransactionsTable.totalGrossRevenue,
      })
      .from(salesTransactionsTable)
      .where(inArray(salesTransactionsTable.id, saleIds));
    linkedSales = sales.map((s) => ({
      id: s.id,
      saleNumber: s.saleNumber,
      saleDate: s.saleDate,
      grossRevenue: parseFloat(String(s.totalGrossRevenue ?? 0)),
    }));
  }

  return res.json({
    ...formatPreview(preview),
    projectName: project?.name ?? null,
    lifecycleStatus: project?.lifecycleStatus ?? null,
    agreementStatus: agreementContext?.status ?? null,
    agreementRevenueModel: agreementContext?.revenueModel ?? null,
    linkedSales,
  });
});

// ── PATCH /distribution-previews/:id ──────────────────────────────────────

router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = String(req.params.id);

    const [existing] = await db
      .select()
      .from(distributionPreviewsTable)
      .where(and(eq(distributionPreviewsTable.id, id), eq(distributionPreviewsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Preview not found" });
    if (existing.status === "confirmed") {
      return res.status(409).json({ error: "Confirmed previews cannot be modified. Archive and create a new one." });
    }
    if (!req.canAccessAllProjects && !req.userProjectIds?.includes(existing.projectId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const parsed = PatchPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    }
    const patch = parsed.data;

    const merged: z.infer<typeof CreatePreviewSchema> = {
      projectId: existing.projectId,
      agreementId: existing.agreementId ?? undefined,
      periodLabel: patch.periodLabel ?? existing.periodLabel,
      periodStart: patch.periodStart ?? existing.periodStart ?? undefined,
      periodEnd: patch.periodEnd ?? existing.periodEnd ?? undefined,
      periodYear: patch.periodYear ?? existing.periodYear ?? undefined,
      grossRevenue: patch.grossRevenue ?? existing.grossRevenue,
      operationalCost: patch.operationalCost ?? existing.operationalCost,
      lcaAmount: patch.lcaAmount ?? existing.lcaAmount,
      lcaSource: (patch.lcaSource ?? existing.lcaSource) as "manual" | "ledger",
      notes: patch.notes ?? existing.notes ?? undefined,
      linkedSaleIds: patch.linkedSaleIds ?? (existing.linkedSaleIds as string[]) ?? [],
      revenueSource: (patch.revenueSource ?? existing.revenueSource) as "sales_records" | "manual",
      ownershipSnapshotId: patch.ownershipSnapshotId ?? existing.ownershipSnapshotId ?? undefined,
      ownershipSnapshotEntries: patch.ownershipSnapshotEntries ?? (existing.ownershipSnapshotEntries as OwnershipSnapshotEntry[]) ?? [],
      ownershipOverride: patch.ownershipOverride,
    };

    let agreement = null;
    let profile = null;
    let accountingModel = existing.accountingModel;

    if (merged.agreementId) {
      const [agr] = await db
        .select()
        .from(agreementsTable)
        .where(eq(agreementsTable.id, merged.agreementId))
        .limit(1);
      agreement = agr ?? null;

      const [prof] = await db
        .select()
        .from(agreementAccountingProfilesTable)
        .where(eq(agreementAccountingProfilesTable.agreementId, merged.agreementId))
        .limit(1);
      profile = prof ?? null;
      if (prof) accountingModel = prof.accountingModel;
    }

    const { result: distributionResult, snapshotEntries } = await buildDistributionResult(
      merged,
      agreement,
      profile,
    );

    const finalSnapshotEntries =
      merged.ownershipSnapshotEntries.length > 0
        ? (merged.ownershipSnapshotEntries as OwnershipSnapshotEntry[])
        : snapshotEntries;

    const [updated] = await db
      .update(distributionPreviewsTable)
      .set({
        periodLabel: merged.periodLabel,
        periodStart: merged.periodStart ?? null,
        periodEnd: merged.periodEnd ?? null,
        periodYear: merged.periodYear ?? null,
        grossRevenue: merged.grossRevenue,
        operationalCost: merged.operationalCost,
        lcaAmount: merged.lcaAmount,
        lcaSource: merged.lcaSource,
        linkedSaleIds: merged.linkedSaleIds,
        revenueSource: merged.revenueSource,
        ownershipSnapshotId: merged.ownershipSnapshotId ?? null,
        ownershipSnapshotEntries: finalSnapshotEntries,
        notes: merged.notes ?? null,
        accountingModel,
        distributionResult,
        updatedAt: new Date(),
      })
      .where(eq(distributionPreviewsTable.id, id))
      .returning();

    return res.json(formatPreview(updated));
  },
);

// ── POST /distribution-previews/:id/confirm ───────────────────────────────

router.post(
  "/:id/confirm",
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);

    const [existing] = await db
      .select()
      .from(distributionPreviewsTable)
      .where(and(eq(distributionPreviewsTable.id, id), eq(distributionPreviewsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Preview not found" });
    if (existing.status === "confirmed") return res.status(409).json({ error: "Already confirmed" });

    const { userId: clerkUserId2 } = getAuth(req);
    const actor2 = clerkUserId2 ? await resolveActor(clerkUserId2) : null;
    const callerName = actor2?.displayName ?? actor2?.clerkUserId ?? "System";

    const [updated] = await db
      .update(distributionPreviewsTable)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedById: actor2?.id ?? null,
        confirmedByName: callerName,
        updatedAt: new Date(),
      })
      .where(eq(distributionPreviewsTable.id, id))
      .returning();

    return res.json(formatPreview(updated));
  },
);

// ── DELETE /distribution-previews/:id ─────────────────────────────────────

router.delete(
  "/:id",
  requireRole("admin"),
  async (req, res) => {
    const id = String(req.params.id);

    const [existing] = await db
      .select({ id: distributionPreviewsTable.id, projectId: distributionPreviewsTable.projectId })
      .from(distributionPreviewsTable)
      .where(and(eq(distributionPreviewsTable.id, id), eq(distributionPreviewsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Preview not found" });

    await db
      .update(distributionPreviewsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(distributionPreviewsTable.id, id));

    return res.json({ ok: true });
  },
);

export default router;
