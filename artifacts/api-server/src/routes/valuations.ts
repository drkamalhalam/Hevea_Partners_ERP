/**
 * valuations.ts
 *
 * Ownership Transfer Valuation Engine
 *
 * Formula v1 (fixed — do not change without bumping formulaVersion):
 *   projectGrossValue = I × (1 − (1.20)^(−N)) / 0.20
 *
 *   I = average net profit of up to 3 most recent post-maturity years
 *   N = max(1, 25 − postMaturityYears)
 *
 * Endpoints:
 *   GET  /valuations                         — list runs
 *   POST /valuations                         — create (compute + save) a run
 *   GET  /valuations/preview                 — compute without saving
 *   GET  /valuations/:id                     — get single run
 *   PATCH /valuations/:id                    — update override / notes / status
 *   DELETE /valuations/:id                   — admin only
 *
 *   GET  /valuations/profit-records          — list profit records (by project)
 *   POST /valuations/profit-records          — create profit record
 *   PATCH /valuations/profit-records/:id     — update
 *   DELETE /valuations/profit-records/:id    — delete
 *   POST /valuations/profit-records/import   — auto-import from fifty_pct_sessions
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  valuationRunsTable,
  valuationProfitRecordsTable,
  projectLifecycleHistoryTable,
  fiftyPctSessionsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, desc, inArray, asc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import {
  requireSettlementAccess,
  getProjectScopeFilter,
  logSettlementAccess,
} from "../middlewares/settlement_security";

const router = Router();

// ── Formula engine ────────────────────────────────────────────────────────

const DISCOUNT_RATE = 0.20;
const VALUATION_HORIZON = 25;
const FORMULA_VERSION = "v1";

interface ProfitYearDatum {
  year: number;
  netProfit: number;
}

function computeValuationFormula(
  avgAnnualProfit: number,
  postMaturityYears: number,
): { N: number; projectGrossValue: number; isHorizonExceeded: boolean } {
  const rawN = VALUATION_HORIZON - postMaturityYears;
  const isHorizonExceeded = rawN <= 0;
  const N = Math.max(1, rawN);
  const projectGrossValue =
    avgAnnualProfit * (1 - Math.pow(1 + DISCOUNT_RATE, -N)) / DISCOUNT_RATE;
  return { N, projectGrossValue: Math.max(0, projectGrossValue), isHorizonExceeded };
}

function fmtNum(n: number, dp = 2) {
  return parseFloat(n.toFixed(dp));
}

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateProfitRecordSchema = z.object({
  projectId: z.string().uuid(),
  periodYear: z.number().int().min(1990).max(2100),
  grossRevenue: z.number().min(0).optional(),
  operationalCost: z.number().min(0).optional(),
  lcaAmount: z.number().min(0).optional(),
  netProfit: z.number(),
  source: z.enum(["manual", "fifty_pct_session"]).default("manual"),
  sourceId: z.string().uuid().optional(),
  isPostMaturity: z.boolean().default(false),
  notes: z.string().optional(),
});

const UpdateProfitRecordSchema = z.object({
  periodYear: z.number().int().optional(),
  grossRevenue: z.number().min(0).optional(),
  operationalCost: z.number().min(0).optional(),
  lcaAmount: z.number().min(0).optional(),
  netProfit: z.number().optional(),
  isPostMaturity: z.boolean().optional(),
  notes: z.string().optional(),
});

const CreateValuationRunSchema = z.object({
  projectId: z.string().uuid(),
  transferId: z.string().uuid().optional(),
  shareFraction: z.number().min(0).max(1).optional(), // 0–1; e.g. 0.30 = 30%
  // Optionally override avgAnnualProfit (skip auto-compute from profit records)
  manualAvgAnnualProfit: z.number().min(0).optional(),
  // Optionally override postMaturityYears (skip auto-compute from lifecycle history)
  manualPostMaturityYears: z.number().min(0).optional(),
  notes: z.string().optional(),
  status: z.enum(["draft", "final"]).default("draft"),
});

const UpdateValuationRunSchema = z.object({
  finalPriceOverride: z.number().min(0).optional().nullable(),
  overrideReason: z.string().optional().nullable(),
  shareFraction: z.number().min(0).max(1).optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(["draft", "final"]).optional(),
});

const ImportProfitRecordsSchema = z.object({
  projectId: z.string().uuid(),
  // If omitted, import all confirmed sessions with a periodYear set
  limitYears: z.number().int().min(1).max(20).optional(),
  // Mark as post-maturity automatically if maturityDate is known
  autoMarkPostMaturity: z.boolean().default(true),
});

// ── Helper: look up user's internal UUID ──────────────────────────────────

async function resolveUser(req: any) {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return { id: null, displayName: null };
  const { usersTable } = await import("@workspace/db");
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return u ?? { id: null, displayName: null };
}

// ── Helper: get maturity date from lifecycle history ───────────────────────

async function getMaturityDate(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ changedAt: projectLifecycleHistoryTable.changedAt })
    .from(projectLifecycleHistoryTable)
    .where(
      and(
        eq(projectLifecycleHistoryTable.projectId, projectId),
        eq(projectLifecycleHistoryTable.toStatus, "mature_production"),
      ),
    )
    .orderBy(asc(projectLifecycleHistoryTable.changedAt))
    .limit(1);
  if (!row) return null;
  return row.changedAt.toISOString().split("T")[0]!;
}

// ── Helper: compute post-maturity years ───────────────────────────────────

function computePostMaturityYears(maturityDate: string): number {
  const maturity = new Date(maturityDate).getTime();
  const now = Date.now();
  return Math.max(0, (now - maturity) / (365.25 * 24 * 3600 * 1000));
}

// ── GET /valuations ───────────────────────────────────────────────────────

router.get("/", requireSettlementAccess, async (req, res) => {
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0)
    return res.json({ runs: [], total: 0 });

  const { projectId, transferId, status } = req.query as Record<string, string | undefined>;

  const conds: ReturnType<typeof eq>[] = [];
  if (projectId) conds.push(eq(valuationRunsTable.projectId, projectId));
  if (transferId) conds.push(eq(valuationRunsTable.transferId, transferId));
  if (status) conds.push(eq(valuationRunsTable.status, status));
  if (projectScope !== null)
    conds.push(inArray(valuationRunsTable.projectId, projectScope));

  const runs = await db
    .select()
    .from(valuationRunsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(valuationRunsTable.createdAt));

  logSettlementAccess(req, "valuation_runs", "list");
  return res.json({ runs, total: runs.length });
});

// ── GET /valuations/preview ────────────────────────────────────────────────

router.get("/preview", requireSettlementAccess, async (req, res) => {
  const { projectId, sharePct } = req.query as Record<string, string | undefined>;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const maturityDate = await getMaturityDate(projectId);
  const postMaturityYears = maturityDate ? computePostMaturityYears(maturityDate) : 0;

  // Fetch top-3 post-maturity profit records
  const records = await db
    .select()
    .from(valuationProfitRecordsTable)
    .where(
      and(
        eq(valuationProfitRecordsTable.projectId, projectId),
        eq(valuationProfitRecordsTable.isPostMaturity, true),
      ),
    )
    .orderBy(desc(valuationProfitRecordsTable.periodYear))
    .limit(3);

  const profitYearData: ProfitYearDatum[] = records.map((r) => ({
    year: r.periodYear,
    netProfit: parseFloat(String(r.netProfit)),
  }));
  const profitYearsUsed = profitYearData.length;
  const avgAnnualProfit =
    profitYearsUsed > 0
      ? profitYearData.reduce((s, r) => s + r.netProfit, 0) / profitYearsUsed
      : 0;

  const { N, projectGrossValue, isHorizonExceeded } = computeValuationFormula(
    avgAnnualProfit,
    postMaturityYears,
  );

  const fraction = sharePct ? parseFloat(sharePct) / 100 : null;
  const shareValue = fraction !== null ? fmtNum(projectGrossValue * fraction) : null;

  return res.json({
    projectId,
    maturityDate,
    postMaturityYears: fmtNum(postMaturityYears),
    profitYearsUsed,
    profitYearData,
    avgAnnualProfit: fmtNum(avgAnnualProfit),
    discountRate: DISCOUNT_RATE,
    valuationHorizon: VALUATION_HORIZON,
    remainingLife: fmtNum(N),
    isHorizonExceeded,
    projectGrossValue: fmtNum(projectGrossValue),
    shareFraction: fraction,
    shareValue,
    formulaVersion: FORMULA_VERSION,
    warnings: [
      ...(profitYearsUsed === 0 ? ["No post-maturity profit records found. Add profit records to compute I."] : []),
      ...(profitYearsUsed < 3 && profitYearsUsed > 0 ? [`Only ${profitYearsUsed} post-maturity year(s) available (3 preferred). Average uses available data.`] : []),
      ...(!maturityDate ? ["Project has not reached mature_production — N cannot be computed from lifecycle history."] : []),
      ...(isHorizonExceeded ? ["Project has exceeded the 25-year guidance horizon. Formula uses N=1 (minimum). Valuation is indicative only."] : []),
    ],
  });
});

// ── GET /valuations/profit-records ────────────────────────────────────────

router.get("/profit-records", requireSettlementAccess, async (req, res) => {
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0)
    return res.json({ records: [], total: 0 });

  const { projectId } = req.query as { projectId?: string };
  const conds: ReturnType<typeof eq>[] = [];
  if (projectId) conds.push(eq(valuationProfitRecordsTable.projectId, projectId));
  if (projectScope !== null)
    conds.push(inArray(valuationProfitRecordsTable.projectId, projectScope));

  const records = await db
    .select()
    .from(valuationProfitRecordsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      asc(valuationProfitRecordsTable.projectId),
      desc(valuationProfitRecordsTable.periodYear),
    );

  return res.json({ records, total: records.length });
});

// ── POST /valuations/profit-records ───────────────────────────────────────

router.post(
  "/profit-records",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = CreateProfitRecordSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

    const user = await resolveUser(req);
    const d = parsed.data;

    const [row] = await db
      .insert(valuationProfitRecordsTable)
      .values({
        projectId: d.projectId,
        periodYear: d.periodYear,
        grossRevenue: d.grossRevenue?.toFixed(2),
        operationalCost: d.operationalCost?.toFixed(2),
        lcaAmount: d.lcaAmount?.toFixed(2),
        netProfit: d.netProfit.toFixed(2),
        source: d.source,
        sourceId: d.sourceId,
        isPostMaturity: d.isPostMaturity,
        notes: d.notes,
        recordedBy: user.id ?? undefined,
        recordedByName: user.displayName ?? undefined,
      })
      .returning();

    return res.status(201).json({ record: row });
  },
);

// ── POST /valuations/profit-records/import ────────────────────────────────

router.post(
  "/profit-records/import",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = ImportProfitRecordsSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

    const { projectId, limitYears, autoMarkPostMaturity } = parsed.data;
    const user = await resolveUser(req);

    // Fetch maturity date for post-maturity flagging
    const maturityDate = autoMarkPostMaturity ? await getMaturityDate(projectId) : null;

    // Pull confirmed sessions with a periodYear set
    const sessions = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(
        and(
          eq(fiftyPctSessionsTable.projectId, projectId),
          eq(fiftyPctSessionsTable.status, "confirmed"),
        ),
      )
      .orderBy(desc(fiftyPctSessionsTable.periodYear));

    const eligible = sessions.filter((s) => s.periodYear != null);
    const toImport = limitYears ? eligible.slice(0, limitYears) : eligible;

    // Get existing source IDs to avoid duplicates
    const existing = await db
      .select({ sourceId: valuationProfitRecordsTable.sourceId })
      .from(valuationProfitRecordsTable)
      .where(eq(valuationProfitRecordsTable.projectId, projectId));
    const existingSourceIds = new Set(existing.map((r) => r.sourceId).filter(Boolean));

    const toCreate = toImport.filter((s) => !existingSourceIds.has(s.id));

    if (toCreate.length === 0) {
      return res.json({ imported: 0, skipped: toImport.length, records: [] });
    }

    const maturityMs = maturityDate ? new Date(maturityDate).getTime() : null;

    const rows = await db
      .insert(valuationProfitRecordsTable)
      .values(
        toCreate.map((s) => {
          const gross = parseFloat(String(s.grossRevenue));
          const opCost = parseFloat(String(s.operationalCost));
          const lca = parseFloat(String(s.lcaAmount));
          // Net = landowner net + EPP pool = gross - opCost - lca
          const netProfit = Math.max(0, gross - opCost - lca);

          const yearStart = s.periodYear
            ? new Date(s.periodYear, 0, 1).getTime()
            : null;
          const isPostMaturity =
            autoMarkPostMaturity &&
            maturityMs !== null &&
            yearStart !== null &&
            yearStart >= maturityMs;

          return {
            projectId,
            periodYear: s.periodYear!,
            grossRevenue: gross.toFixed(2),
            operationalCost: opCost.toFixed(2),
            lcaAmount: lca.toFixed(2),
            netProfit: netProfit.toFixed(2),
            source: "fifty_pct_session" as const,
            sourceId: s.id,
            isPostMaturity,
            notes: `Imported from settlement session: ${s.periodLabel}`,
            recordedBy: user.id ?? undefined,
            recordedByName: user.displayName ?? undefined,
          };
        }),
      )
      .returning();

    return res.json({ imported: rows.length, skipped: toImport.length - rows.length, records: rows });
  },
);

// ── PATCH /valuations/profit-records/:id ─────────────────────────────────

router.patch(
  "/profit-records/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const parsed = UpdateProfitRecordSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

    const d = parsed.data;
    const [row] = await db
      .update(valuationProfitRecordsTable)
      .set({
        ...(d.periodYear !== undefined && { periodYear: d.periodYear }),
        ...(d.grossRevenue !== undefined && { grossRevenue: d.grossRevenue?.toFixed(2) }),
        ...(d.operationalCost !== undefined && { operationalCost: d.operationalCost?.toFixed(2) }),
        ...(d.lcaAmount !== undefined && { lcaAmount: d.lcaAmount?.toFixed(2) }),
        ...(d.netProfit !== undefined && { netProfit: d.netProfit.toFixed(2) }),
        ...(d.isPostMaturity !== undefined && { isPostMaturity: d.isPostMaturity }),
        ...(d.notes !== undefined && { notes: d.notes }),
        updatedAt: new Date(),
      })
      .where(eq(valuationProfitRecordsTable.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "Profit record not found" });
    return res.json({ record: row });
  },
);

// ── DELETE /valuations/profit-records/:id ────────────────────────────────

router.delete(
  "/profit-records/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const [row] = await db
      .delete(valuationProfitRecordsTable)
      .where(eq(valuationProfitRecordsTable.id, id))
      .returning({ id: valuationProfitRecordsTable.id });
    if (!row) return res.status(404).json({ error: "Profit record not found" });
    return res.json({ deleted: true });
  },
);

// ── POST /valuations/value-to-percentage ─────────────────────────────────
// Given a transfer value (INR), compute the equivalent ownership percentage
// using the specified or latest-final valuation run for the project.
// Formula: percentage = (transferValue / projectGrossValue) × 100

router.post("/value-to-percentage", requireSettlementAccess, async (req, res) => {
  const schema = z.object({
    projectId: z.string().uuid(),
    transferValue: z.number().positive(),
    valuationRunId: z.string().uuid().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

  const { projectId, transferValue, valuationRunId } = parsed.data;

  let run: typeof valuationRunsTable.$inferSelect | undefined;

  if (valuationRunId) {
    const rows = await db
      .select()
      .from(valuationRunsTable)
      .where(
        and(
          eq(valuationRunsTable.id, valuationRunId),
          eq(valuationRunsTable.projectId, projectId),
        ),
      )
      .limit(1);
    run = rows[0];
    if (!run) return res.status(404).json({ error: "Valuation run not found for this project" });
  } else {
    // Use the most recent final run for this project
    const rows = await db
      .select()
      .from(valuationRunsTable)
      .where(
        and(
          eq(valuationRunsTable.projectId, projectId),
          eq(valuationRunsTable.status, "final"),
        ),
      )
      .orderBy(desc(valuationRunsTable.createdAt))
      .limit(1);
    run = rows[0];
    if (!run)
      return res.status(422).json({
        error: "No final valuation run found for this project. Create and finalise a valuation run first.",
      });
  }

  const projectGrossValue = parseFloat(run.projectGrossValue);
  if (!projectGrossValue || projectGrossValue <= 0)
    return res.status(422).json({ error: "Valuation run has an invalid projectGrossValue — cannot compute percentage" });

  const percentage = (transferValue / projectGrossValue) * 100;

  return res.json({
    projectId,
    valuationRunId: run.id,
    projectGrossValue: run.projectGrossValue,
    transferValue,
    derivedPercentage: percentage,
    derivedPercentageFormatted: percentage.toFixed(8),
    warning:
      percentage > 100
        ? "Derived percentage exceeds 100% — the transfer value is greater than the total project gross value"
        : null,
  });
});

// ── POST /valuations ──────────────────────────────────────────────────────

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = CreateValuationRunSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

  const d = parsed.data;
  const user = await resolveUser(req);

  // Resolve maturity date + post-maturity years
  const maturityDate = await getMaturityDate(d.projectId);
  const postMaturityYears =
    d.manualPostMaturityYears ??
    (maturityDate ? computePostMaturityYears(maturityDate) : 0);

  // Resolve avg annual profit
  let avgAnnualProfit = d.manualAvgAnnualProfit;
  let profitYearData: ProfitYearDatum[] = [];

  if (avgAnnualProfit === undefined) {
    // Fetch top-3 post-maturity profit records
    const records = await db
      .select()
      .from(valuationProfitRecordsTable)
      .where(
        and(
          eq(valuationProfitRecordsTable.projectId, d.projectId),
          eq(valuationProfitRecordsTable.isPostMaturity, true),
        ),
      )
      .orderBy(desc(valuationProfitRecordsTable.periodYear))
      .limit(3);

    profitYearData = records.map((r) => ({
      year: r.periodYear,
      netProfit: parseFloat(String(r.netProfit)),
    }));
    avgAnnualProfit =
      profitYearData.length > 0
        ? profitYearData.reduce((s, r) => s + r.netProfit, 0) / profitYearData.length
        : 0;
  }

  const { N, projectGrossValue, isHorizonExceeded } = computeValuationFormula(
    avgAnnualProfit,
    postMaturityYears,
  );

  const shareValue =
    d.shareFraction !== undefined
      ? fmtNum(projectGrossValue * d.shareFraction)
      : undefined;

  const [run] = await db
    .insert(valuationRunsTable)
    .values({
      projectId: d.projectId,
      transferId: d.transferId,
      maturityDate: maturityDate ?? undefined,
      postMaturityYears: fmtNum(postMaturityYears).toString(),
      profitYearsUsed: profitYearData.length,
      profitYearData,
      avgAnnualProfit: fmtNum(avgAnnualProfit).toString(),
      discountRate: DISCOUNT_RATE.toString(),
      valuationHorizon: VALUATION_HORIZON,
      remainingLife: fmtNum(N).toString(),
      isHorizonExceeded,
      projectGrossValue: fmtNum(projectGrossValue).toString(),
      shareFraction: d.shareFraction?.toFixed(6),
      shareValue: shareValue?.toString(),
      status: d.status,
      notes: d.notes,
      formulaVersion: FORMULA_VERSION,
      calculatedBy: user.id ?? undefined,
      calculatedByName: user.displayName ?? undefined,
    })
    .returning();

  logSettlementAccess(req, "valuation_runs", "create", run.id, d.projectId);
  return res.status(201).json({ run });
});

// ── GET /valuations/:id ───────────────────────────────────────────────────

router.get("/:id", requireSettlementAccess, async (req, res) => {
  const id = req.params.id as string;

  const [run] = await db
    .select()
    .from(valuationRunsTable)
    .where(eq(valuationRunsTable.id, id))
    .limit(1);

  if (!run) return res.status(404).json({ error: "Valuation run not found" });

  // Project name
  const [proj] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, run.projectId))
    .limit(1);

  // Formula step-by-step breakdown for the UI
  const I = parseFloat(String(run.avgAnnualProfit));
  const N = parseFloat(String(run.remainingLife));
  const r = parseFloat(String(run.discountRate));
  const annuityFactor = (1 - Math.pow(1 + r, -N)) / r;
  const pgv = parseFloat(String(run.projectGrossValue));
  const sf = run.shareFraction ? parseFloat(String(run.shareFraction)) : null;
  const fop = run.finalPriceOverride ? parseFloat(String(run.finalPriceOverride)) : null;

  return res.json({
    run: { ...run, projectName: proj?.name ?? null },
    formulaBreakdown: {
      I: fmtNum(I),
      N: fmtNum(N),
      discountRate: r,
      annuityFactor: fmtNum(annuityFactor, 6),
      projectGrossValue: fmtNum(pgv),
      shareFraction: sf,
      shareValue: sf !== null ? fmtNum(pgv * sf) : null,
      finalPrice: fop ?? (sf !== null ? fmtNum(pgv * sf) : fmtNum(pgv)),
      isOverridden: fop !== null,
    },
  });
});

// ── PATCH /valuations/:id ─────────────────────────────────────────────────

router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const id = req.params.id as string;
  const parsed = UpdateValuationRunSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });

  const d = parsed.data;

  // Recompute shareValue if shareFraction changed
  let shareValueUpdate: string | null | undefined = undefined;
  if (d.shareFraction !== undefined) {
    const [run] = await db
      .select({ projectGrossValue: valuationRunsTable.projectGrossValue })
      .from(valuationRunsTable)
      .where(eq(valuationRunsTable.id, id))
      .limit(1);
    if (run && d.shareFraction !== null) {
      shareValueUpdate = fmtNum(
        parseFloat(String(run.projectGrossValue)) * d.shareFraction,
      ).toString();
    } else {
      shareValueUpdate = null;
    }
  }

  const [updated] = await db
    .update(valuationRunsTable)
    .set({
      ...(d.finalPriceOverride !== undefined && {
        finalPriceOverride: d.finalPriceOverride?.toFixed(2) ?? null,
      }),
      ...(d.overrideReason !== undefined && { overrideReason: d.overrideReason }),
      ...(d.shareFraction !== undefined && {
        shareFraction: d.shareFraction?.toFixed(6) ?? null,
      }),
      ...(shareValueUpdate !== undefined && { shareValue: shareValueUpdate }),
      ...(d.notes !== undefined && { notes: d.notes }),
      ...(d.status !== undefined && { status: d.status }),
      updatedAt: new Date(),
    })
    .where(eq(valuationRunsTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Valuation run not found" });
  return res.json({ run: updated });
});

// ── DELETE /valuations/:id ────────────────────────────────────────────────

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = req.params.id as string;
  const [row] = await db
    .delete(valuationRunsTable)
    .where(eq(valuationRunsTable.id, id))
    .returning({ id: valuationRunsTable.id });
  if (!row) return res.status(404).json({ error: "Valuation run not found" });
  return res.json({ deleted: true });
});

export default router;
