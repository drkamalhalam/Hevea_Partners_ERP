/**
 * PartnerPayable.tsx
 *
 * Partner Actual Payable Recommendation Dashboard.
 *
 * RECOMMENDATION ONLY — final settlement stays manual.
 *
 * Formula (displayed prominently):
 *   Profit Share (confirmed 50% sessions where partner is landowner)
 *   + Recoverable Advances Outstanding (advances partner made, not yet recovered)
 *   + Pending Recoveries (landowner ledger isRecoverable, not fully settled)
 *   + Pending LCA Balance (outstanding land contribution adjustments)
 *   + Prior Imbalance Adjustments (net of manual credit/debit entries)
 *   − Negative Carry Balances (explicit deductions from prior periods)
 *   ════════════════════════════════════════════════════════════
 *   = ACTUAL PAYABLE RECOMMENDATION
 *
 * Tabs:
 *   Breakdown  — per-component detailed tables
 *   Adjustments — CRUD for manual imbalance/carry entries
 *   History     — saved recommendation snapshots
 */

import { useState } from "react";
import {
  useListProjects,
  useListPartners,
  useComputePayable,
  useListPayableAdjustments,
  useCreatePayableAdjustment,
  useUpdatePayableAdjustment,
  useDeletePayableAdjustment,
  useConfirmPayableAdjustment,
  useListPayableSnapshots,
  useCreatePayableSnapshot,
  useFinalizePayableSnapshot,
  getComputePayableQueryKey,
  getListPayableAdjustmentsQueryKey,
  getListPayableSnapshotsQueryKey,
} from "@workspace/api-client-react";
import type {
  Project,
  PayableAdjustment,
  PayableSnapshot,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import {
  RefreshCw,
  AlertTriangle,
  Info,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Lock,
  ShieldAlert,
  Landmark,
  TrendingUp,
  TrendingDown,
  Equal,
  History,
  ChevronRight,
  Calculator,
  Banknote,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
  Layers,
  X,
  BookOpen,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Formatting ────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtSigned = (n: number) =>
  n >= 0 ? `+${fmt(n)}` : `−${fmt(n)}`;

function n(v: unknown): number {
  return parseFloat(String(v ?? "0")) || 0;
}

// ── Component: Status badge ───────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "confirmed" || status === "finalized") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">
        <Lock className="w-2.5 h-2.5" />
        {status === "finalized" ? "Finalized" : "Confirmed"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-900/30 text-amber-400 border border-amber-800/40">
      Draft
    </span>
  );
}

// ── Component: Direction chip ─────────────────────────────────────────────

function DirectionChip({
  direction,
  amount,
}: {
  direction: string;
  amount: number;
}) {
  const isCredit = direction === "credit";
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-sm font-semibold ${isCredit ? "text-emerald-400" : "text-red-400"}`}
    >
      {isCredit ? (
        <ArrowUpRight className="w-3.5 h-3.5" />
      ) : (
        <ArrowDownRight className="w-3.5 h-3.5" />
      )}
      {fmt(amount)}
    </span>
  );
}

// ── Adjustment type label ─────────────────────────────────────────────────

const ADJ_LABELS: Record<string, { label: string; color: string }> = {
  imbalance_adjustment: { label: "Imbalance Adj.", color: "text-sky-400" },
  carry_balance: { label: "Carry Balance", color: "text-amber-400" },
  other_credit: { label: "Other Credit", color: "text-emerald-400" },
  other_debit: { label: "Other Debit", color: "text-red-400" },
};

function AdjTypeBadge({ type }: { type: string }) {
  const meta = ADJ_LABELS[type] ?? { label: type, color: "text-slate-400" };
  return (
    <span className={`text-[11px] font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ── Formula row component ─────────────────────────────────────────────────

function FormulaRow({
  symbol,
  label,
  amount,
  highlight,
  dim,
  sub,
}: {
  symbol: string;
  label: string;
  amount: number;
  highlight?: boolean;
  dim?: boolean;
  sub?: string;
}) {
  const isNeg = symbol === "−";
  const displayAmt = isNeg ? amount : amount;

  return (
    <div
      className={`flex items-center justify-between py-2.5 px-4 rounded-lg transition-colors ${
        highlight
          ? "bg-blue-950/30 border border-blue-700/40"
          : dim
          ? "opacity-50"
          : "hover:bg-slate-800/30"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-5 text-center font-mono text-base font-bold ${
            symbol === "+" ? "text-emerald-400" : symbol === "−" ? "text-red-400" : symbol === "=" ? "text-blue-400" : "text-slate-500"
          }`}
        >
          {symbol}
        </span>
        <div>
          <span
            className={`text-sm ${highlight ? "font-semibold text-white text-base" : "text-slate-300"}`}
          >
            {label}
          </span>
          {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
      </div>
      <span
        className={`font-mono font-semibold ${
          highlight
            ? "text-xl text-blue-300"
            : isNeg && displayAmt > 0
            ? "text-red-400"
            : displayAmt > 0
            ? "text-emerald-400"
            : displayAmt < 0
            ? "text-red-400"
            : "text-slate-500"
        }`}
      >
        {highlight ? fmt(displayAmt) : fmtSigned(isNeg ? -displayAmt : displayAmt)}
      </span>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  color,
  icon: Icon,
  positive,
  sub,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
  positive?: boolean;
  sub?: string;
}) {
  const isZero = Math.abs(value) < 0.01;
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${isZero ? "text-slate-600" : color}`} />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p
        className={`font-mono font-bold text-lg ${isZero ? "text-slate-600" : positive === false ? "text-red-400" : color}`}
      >
        {fmt(value)}
      </p>
      {sub && <p className="text-[10px] text-slate-600">{sub}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PartnerPayable() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const canEdit = role === "admin" || role === "developer";

  // Selectors
  const [projectId, setProjectId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [tab, setTab] = useState<"breakdown" | "adjustments" | "history">("breakdown");

  // Adjustment form
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjEditId, setAdjEditId] = useState<string | null>(null);
  const [adjType, setAdjType] = useState("imbalance_adjustment");
  const [adjDir, setAdjDir] = useState("credit");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjPeriod, setAdjPeriod] = useState("");
  const [adjDesc, setAdjDesc] = useState("");
  const [adjRef, setAdjRef] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjError, setAdjError] = useState<string | null>(null);

  // Snapshot dialog
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [snapshotPeriod, setSnapshotPeriod] = useState("");
  const [snapshotNotes, setSnapshotNotes] = useState("");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // ── Data fetches ──────────────────────────────────────────────────────

  const { data: projects = [] } = useListProjects();
  const { data: partners = [] } = useListPartners();

  const ready = !!(projectId && partnerId);

  const {
    data: computation,
    isLoading: computeLoading,
    error: computeError,
    refetch: refetchCompute,
  } = useComputePayable(
    { projectId, partnerId },
    {
      query: {
        enabled: ready,
        queryKey: getComputePayableQueryKey({ projectId, partnerId }),
      },
    },
  );

  const { data: adjPage, isLoading: adjLoading } = useListPayableAdjustments(
    { projectId: projectId || undefined, partnerId: partnerId || undefined },
    {
      query: {
        enabled: ready && tab === "adjustments",
        queryKey: getListPayableAdjustmentsQueryKey({
          projectId: projectId || undefined,
          partnerId: partnerId || undefined,
        }),
      },
    },
  );
  const adjustments = adjPage?.adjustments ?? [];

  const { data: snapshotsPage, isLoading: snapshotsLoading } =
    useListPayableSnapshots(
      { projectId: projectId || undefined, partnerId: partnerId || undefined },
      {
        query: {
          enabled: ready && tab === "history",
          queryKey: getListPayableSnapshotsQueryKey({
            projectId: projectId || undefined,
            partnerId: partnerId || undefined,
          }),
        },
      },
    );
  const snapshots = snapshotsPage?.snapshots ?? [];

  // ── Mutations ─────────────────────────────────────────────────────────

  const createAdjMutation = useCreatePayableAdjustment();
  const updateAdjMutation = useUpdatePayableAdjustment();
  const deleteAdjMutation = useDeletePayableAdjustment();
  const confirmAdjMutation = useConfirmPayableAdjustment();
  const createSnapshotMutation = useCreatePayableSnapshot();
  const finalizeSnapshotMutation = useFinalizePayableSnapshot();

  // ── Adjustment CRUD helpers ───────────────────────────────────────────

  function resetAdjForm() {
    setAdjEditId(null);
    setAdjType("imbalance_adjustment");
    setAdjDir("credit");
    setAdjAmount("");
    setAdjPeriod("");
    setAdjDesc("");
    setAdjRef("");
    setAdjNotes("");
    setAdjError(null);
    setShowAdjForm(false);
  }

  function openEditAdj(a: PayableAdjustment) {
    setAdjEditId(a.id);
    setAdjType(a.adjustmentType);
    setAdjDir(a.direction);
    setAdjAmount(String(a.amount));
    setAdjPeriod(a.periodLabel ?? "");
    setAdjDesc(a.description);
    setAdjRef(a.reference ?? "");
    setAdjNotes(a.notes ?? "");
    setAdjError(null);
    setShowAdjForm(true);
  }

  async function handleAdjSave() {
    setAdjError(null);
    if (!adjDesc.trim()) return setAdjError("Description is required.");
    if (!(parseFloat(adjAmount) > 0)) return setAdjError("Amount must be > 0.");

    try {
      if (adjEditId) {
        await updateAdjMutation.mutateAsync({
          id: adjEditId,
          data: {
            adjustmentType: adjType as any,
            direction: adjDir as any,
            amount: parseFloat(adjAmount),
            periodLabel: adjPeriod || undefined,
            description: adjDesc,
            reference: adjRef || undefined,
            notes: adjNotes || undefined,
          },
        });
      } else {
        await createAdjMutation.mutateAsync({
          data: {
            projectId,
            partnerId,
            adjustmentType: adjType as any,
            direction: adjDir as any,
            amount: parseFloat(adjAmount),
            periodLabel: adjPeriod || undefined,
            description: adjDesc,
            reference: adjRef || undefined,
            notes: adjNotes || undefined,
          },
        });
      }
      invalidateAll();
      resetAdjForm();
    } catch (e: any) {
      setAdjError(e?.response?.data?.error ?? "Failed to save adjustment.");
    }
  }

  async function handleAdjConfirm(id: string) {
    await confirmAdjMutation.mutateAsync({ id });
    invalidateAll();
  }

  async function handleAdjDelete(id: string) {
    await deleteAdjMutation.mutateAsync({ id });
    invalidateAll();
  }

  // ── Snapshot helpers ──────────────────────────────────────────────────

  async function handleSaveSnapshot() {
    setSnapshotError(null);
    if (!snapshotPeriod.trim()) return setSnapshotError("Period label is required.");
    try {
      await createSnapshotMutation.mutateAsync({
        data: {
          projectId,
          partnerId,
          periodLabel: snapshotPeriod.trim(),
          notes: snapshotNotes || undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getListPayableSnapshotsQueryKey({}) });
      setShowSnapshotDialog(false);
      setSnapshotPeriod("");
      setSnapshotNotes("");
    } catch (e: any) {
      setSnapshotError(e?.response?.data?.error ?? "Failed to save snapshot.");
    }
  }

  async function handleFinalize(id: string) {
    await finalizeSnapshotMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListPayableSnapshotsQueryKey({}) });
  }

  function invalidateAll() {
    qc.invalidateQueries({
      queryKey: getComputePayableQueryKey({ projectId, partnerId }),
    });
    qc.invalidateQueries({
      queryKey: getListPayableAdjustmentsQueryKey({
        projectId: projectId || undefined,
        partnerId: partnerId || undefined,
      }),
    });
  }

  // ── Guard ─────────────────────────────────────────────────────────────

  if (!canEdit) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Restricted to admin and developer roles.</p>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────

  const c = computation;
  const ps = n(c?.profitShareAmount);
  const ra = n(c?.recoverableAdvancesAmount);
  const pr = n(c?.pendingRecoveriesAmount);
  const lca = n(c?.pendingLcaAmount);
  const adj = n(c?.priorAdjustmentsAmount);
  const carry = n(c?.negativeCarryAmount);
  const actual = n(c?.actualPayable);

  const breakdown = c?.breakdown as any;

  // Chart data for overall waterfall
  const chartData = [
    { name: "Profit Share", value: ps, fill: "#34d399" },
    { name: "Rec. Advances", value: ra, fill: "#60a5fa" },
    { name: "Pending Recovery", value: pr, fill: "#a78bfa" },
    { name: "Pending LCA", value: lca, fill: "#fbbf24" },
    { name: "Adjustments", value: adj, fill: adj >= 0 ? "#34d399" : "#f87171" },
    { name: "Carry Deduction", value: carry, fill: "#f87171" },
  ].filter((d) => Math.abs(d.value) > 0.005);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg border border-blue-700/40">
              <Calculator className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">
                Partner Payable Dashboard
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Settlement recommendation engine · Advisory only
              </p>
            </div>
          </div>
          {ready && c && (
            <Button
              onClick={() => setShowSnapshotDialog(true)}
              className="bg-blue-700 hover:bg-blue-600 text-white"
            >
              <BookOpen className="w-4 h-4 mr-2" /> Save Recommendation
            </Button>
          )}
        </div>

        {/* ── Advisory banner ── */}
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl px-5 py-3 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300">
            <span className="font-semibold">Advisory only.</span> This engine
            computes a recommendation based on confirmed records across all
            modules. Final settlement amounts are determined manually by
            authorised partners. Generating a recommendation does not create any
            legal or financial obligation.
          </div>
        </div>

        {/* ── Selectors ── */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs text-slate-500 mb-1.5 block">Project</Label>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setPartnerId("");
              }}
            >
              <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                {projects.map((p: Project) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs text-slate-500 mb-1.5 block">Partner</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                <SelectValue placeholder="Select partner" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                {partners.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {ready && (
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchCompute()}
                className="text-slate-400 hover:text-slate-200 h-10 px-3"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {!ready && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-20 text-center">
            <Calculator className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-slate-500 text-sm">
              Select a project and partner to compute the payable recommendation.
            </p>
          </div>
        )}

        {ready && computeLoading && (
          <div className="flex items-center justify-center py-20 gap-2 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Computing payable…</span>
          </div>
        )}

        {ready && computeError && (
          <div className="bg-red-950/20 border border-red-800/30 rounded-xl p-4 flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="text-sm">
              Failed to compute payable. Check that this partner is the landowner
              on an agreement for the selected project.
            </span>
          </div>
        )}

        {ready && c && !computeLoading && (
          <div className="space-y-5">
            {/* ── Partner + computation context ── */}
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-900/30 border border-slate-800 rounded-xl text-sm text-slate-400 flex-wrap">
              <span>
                Partner:{" "}
                <span className="text-white font-medium">{c.partnerName}</span>
              </span>
              <span className="text-slate-600">·</span>
              <span>
                Project:{" "}
                <span className="text-white font-medium">{c.projectName}</span>
              </span>
              <span className="text-slate-600">·</span>
              <span>
                Computed:{" "}
                {new Date(c.computedAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>

            {/* ── KPI row ── */}
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
              <KpiCard label="Profit Share" value={ps} color="text-emerald-400" icon={Banknote} sub="confirmed sessions" />
              <KpiCard label="Rec. Advances" value={ra} color="text-blue-400" icon={ArrowUpRight} sub="outstanding" />
              <KpiCard label="Pending Recoveries" value={pr} color="text-violet-400" icon={RotateCcw} sub="landowner ledger" />
              <KpiCard label="Pending LCA" value={lca} color="text-amber-400" icon={Landmark} sub="outstanding balance" />
              <KpiCard label="Adjustments" value={adj} color={adj >= 0 ? "text-emerald-400" : "text-red-400"} icon={Equal} sub="imbalance + other" />
              <KpiCard label="Carry Deduction" value={carry} color="text-red-400" icon={ArrowDownRight} positive={false} sub="carry balances" />
            </div>

            {/* ── Formula card ── */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white">
                  Settlement Formula
                </span>
              </div>
              <div className="p-4 space-y-1">
                <FormulaRow symbol=" " label="Profit Share" amount={ps} sub="50% settlement sessions (confirmed)" />
                <FormulaRow symbol="+" label="Recoverable Advances Outstanding" amount={ra} sub="advances partner made, not yet recovered" />
                <FormulaRow symbol="+" label="Pending Recoveries" amount={pr} sub="landowner ledger, not fully settled" />
                <FormulaRow symbol="+" label="Pending LCA Balance" amount={lca} sub="outstanding land contribution adjustments" />
                <FormulaRow symbol="+" label="Prior Imbalance Adjustments" amount={adj} sub="manual credit / debit entries" />
                <FormulaRow symbol="−" label="Negative Carry Balances" amount={carry} sub="carry-forward deductions" />
                <div className="border-t border-slate-700 pt-2 mt-2">
                  <FormulaRow
                    symbol="="
                    label="Actual Payable Recommendation"
                    amount={actual}
                    highlight
                  />
                </div>
              </div>
            </div>

            {/* ── Chart ── */}
            {chartData.length > 0 && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">
                  Component Breakdown
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ left: 110, right: 60 }}
                  >
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) =>
                        `₹${(v / 1000).toFixed(0)}k`
                      }
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={110}
                    />
                    <Tooltip
                      formatter={(v: number) => fmt(v)}
                      contentStyle={{
                        background: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        color: "#e2e8f0",
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Tabs ── */}
            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
              {(["breakdown", "adjustments", "history"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors capitalize ${
                    tab === t
                      ? "bg-slate-700 text-white"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t === "history" ? (
                    <span className="flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5" /> History
                    </span>
                  ) : (
                    t.charAt(0).toUpperCase() + t.slice(1)
                  )}
                </button>
              ))}
            </div>

            {/* ════════ BREAKDOWN TAB ════════ */}
            {tab === "breakdown" && (
              <div className="space-y-4">
                {/* Profit Share */}
                <BreakdownSection
                  title="Profit Share"
                  color="text-emerald-400"
                  icon={Banknote}
                  total={ps}
                  empty={!breakdown?.profitShare?.sessions?.length}
                  emptyLabel="No confirmed 50% revenue sessions found for this partner as landowner."
                >
                  {breakdown?.profitShare?.sessions?.length > 0 && (
                    <SimpleTable
                      cols={["Period", "Gross Revenue", "Landowner Net", "Confirmed"]}
                      rows={breakdown.profitShare.sessions.map((s: any) => [
                        s.periodLabel,
                        fmt(n(s.grossRevenue)),
                        <span className="text-emerald-400 font-mono">{fmt(n(s.landownerNet))}</span>,
                        s.confirmedAt
                          ? new Date(s.confirmedAt).toLocaleDateString("en-IN")
                          : "—",
                      ])}
                    />
                  )}
                </BreakdownSection>

                {/* Recoverable Advances */}
                <BreakdownSection
                  title="Recoverable Advances Outstanding"
                  color="text-blue-400"
                  icon={ArrowUpRight}
                  total={ra}
                  empty={!breakdown?.recoverableAdvances?.items?.length}
                  emptyLabel="No outstanding advance recoveries for this partner."
                >
                  {breakdown?.recoverableAdvances?.items?.length > 0 && (
                    <SimpleTable
                      cols={["Description", "Raised", "Original", "Recovered", "Outstanding", "Status"]}
                      rows={breakdown.recoverableAdvances.items.map((a: any) => [
                        a.description,
                        a.advancedDate,
                        fmt(n(a.originalAmount)),
                        fmt(n(a.recoveredAmount)),
                        <span className="text-blue-400 font-mono">{fmt(n(a.outstanding))}</span>,
                        <StatusBadge status={a.status} />,
                      ])}
                    />
                  )}
                </BreakdownSection>

                {/* Pending Recoveries */}
                <BreakdownSection
                  title="Pending Recoveries (Landowner Ledger)"
                  color="text-violet-400"
                  icon={RotateCcw}
                  total={pr}
                  empty={!breakdown?.pendingRecoveries?.items?.length}
                  emptyLabel="No pending recoverable entries in the landowner ledger."
                >
                  {breakdown?.pendingRecoveries?.items?.length > 0 && (
                    <SimpleTable
                      cols={["Entry Type", "Period", "Amount", "Recovered", "Outstanding", "Recovery Status"]}
                      rows={breakdown.pendingRecoveries.items.map((e: any) => [
                        e.entryType,
                        e.periodLabel ?? "—",
                        fmt(n(e.amount)),
                        fmt(n(e.recoveredAmount ?? 0)),
                        <span className="text-violet-400 font-mono">{fmt(n(e.outstanding))}</span>,
                        <span className="text-xs text-slate-400">{e.recoveryStatus}</span>,
                      ])}
                    />
                  )}
                </BreakdownSection>

                {/* Pending LCA */}
                <BreakdownSection
                  title="Pending LCA Balance"
                  color="text-amber-400"
                  icon={Landmark}
                  total={lca}
                  empty={!breakdown?.pendingLca?.items?.length}
                  emptyLabel="No outstanding LCA entries for this project."
                >
                  {breakdown?.pendingLca?.items?.length > 0 && (
                    <SimpleTable
                      cols={["Year", "Total Due", "Paid", "Balance", "Status"]}
                      rows={breakdown.pendingLca.items.map((e: any) => [
                        e.year,
                        fmt(n(e.totalDue)),
                        fmt(n(e.amountPaid)),
                        <span className="text-amber-400 font-mono">{fmt(n(e.balance))}</span>,
                        <span className="text-xs text-slate-400">{e.status}</span>,
                      ])}
                    />
                  )}
                </BreakdownSection>

                {/* Adjustments breakdown */}
                <BreakdownSection
                  title="Prior Imbalance Adjustments"
                  color={adj >= 0 ? "text-emerald-400" : "text-red-400"}
                  icon={Equal}
                  total={adj}
                  empty={!breakdown?.priorAdjustments?.items?.length}
                  emptyLabel="No confirmed adjustments recorded."
                >
                  {breakdown?.priorAdjustments?.items?.length > 0 && (
                    <SimpleTable
                      cols={["Type", "Direction", "Period", "Description", "Net Amount"]}
                      rows={breakdown.priorAdjustments.items.map((a: any) => [
                        <AdjTypeBadge type={a.adjustmentType} />,
                        a.direction,
                        a.periodLabel ?? "—",
                        a.description,
                        <DirectionChip direction={a.direction} amount={n(a.amount)} />,
                      ])}
                    />
                  )}
                </BreakdownSection>

                {/* Carry balances breakdown */}
                <BreakdownSection
                  title="Negative Carry Balances"
                  color="text-red-400"
                  icon={ArrowDownRight}
                  total={carry}
                  positive={false}
                  empty={!breakdown?.negativeCarry?.items?.length}
                  emptyLabel="No negative carry balance entries."
                >
                  {breakdown?.negativeCarry?.items?.length > 0 && (
                    <SimpleTable
                      cols={["Period", "Description", "Amount (Deducted)"]}
                      rows={breakdown.negativeCarry.items.map((a: any) => [
                        a.periodLabel ?? "—",
                        a.description,
                        <span className="text-red-400 font-mono">−{fmt(n(a.amount))}</span>,
                      ])}
                    />
                  )}
                </BreakdownSection>
              </div>
            )}

            {/* ════════ ADJUSTMENTS TAB ════════ */}
            {tab === "adjustments" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Manual Adjustments
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Imbalance corrections and carry-forward deductions. Only
                      <strong className="text-slate-300"> confirmed</strong>{" "}
                      entries are included in the payable calculation.
                    </p>
                  </div>
                  {!showAdjForm && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        resetAdjForm();
                        setShowAdjForm(true);
                      }}
                      className="border-slate-700 text-slate-300 hover:bg-slate-800 h-7 px-3 text-xs"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add Adjustment
                    </Button>
                  )}
                </div>

                {/* Adjustment form */}
                {showAdjForm && (
                  <div className="bg-slate-900/60 border border-blue-700/40 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-medium text-blue-300">
                      {adjEditId ? "Edit Adjustment" : "New Manual Adjustment"}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Adjustment Type">
                        <Select value={adjType} onValueChange={setAdjType}>
                          <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                            <SelectItem value="imbalance_adjustment">Imbalance Adjustment</SelectItem>
                            <SelectItem value="carry_balance">Carry Balance (Deduction)</SelectItem>
                            <SelectItem value="other_credit">Other Credit</SelectItem>
                            <SelectItem value="other_debit">Other Debit</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Direction">
                        <Select value={adjDir} onValueChange={setAdjDir}>
                          <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                            <SelectItem value="credit">Credit (increases payable)</SelectItem>
                            <SelectItem value="debit">Debit (reduces payable)</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Amount (₹) *">
                        <Input
                          type="number"
                          value={adjAmount}
                          onChange={(e) => setAdjAmount(e.target.value)}
                          placeholder="0.00"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm"
                        />
                      </Field>
                      <Field label="Period Label">
                        <Input
                          value={adjPeriod}
                          onChange={(e) => setAdjPeriod(e.target.value)}
                          placeholder="e.g. 2024-25 Q3"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm"
                        />
                      </Field>
                    </div>
                    <Field label="Description *">
                      <Input
                        value={adjDesc}
                        onChange={(e) => setAdjDesc(e.target.value)}
                        placeholder="Brief explanation of this adjustment"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Reference (optional)">
                        <Input
                          value={adjRef}
                          onChange={(e) => setAdjRef(e.target.value)}
                          placeholder="Voucher / document ref"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm"
                        />
                      </Field>
                      <Field label="Notes (optional)">
                        <Input
                          value={adjNotes}
                          onChange={(e) => setAdjNotes(e.target.value)}
                          placeholder="Additional context"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm"
                        />
                      </Field>
                    </div>

                    {adjType === "carry_balance" && adjDir === "credit" && (
                      <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        Carry balances are normally debit entries (negative carry deducted from payable). Switch direction to Debit if this is a carry-forward deduction.
                      </div>
                    )}

                    {adjError && (
                      <p className="text-red-400 text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {adjError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleAdjSave}
                        disabled={
                          createAdjMutation.isPending ||
                          updateAdjMutation.isPending
                        }
                        className="bg-blue-700 hover:bg-blue-600 text-white h-7 px-4 text-xs"
                      >
                        {adjEditId ? "Update" : "Add"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={resetAdjForm}
                        className="text-slate-400 h-7 px-3 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Adjustments table */}
                {adjLoading ? (
                  <LoadingRow label="Loading adjustments…" />
                ) : adjustments.length === 0 ? (
                  <EmptyBox
                    icon={Equal}
                    label="No adjustments recorded. Add imbalance corrections or carry-balance entries above."
                  />
                ) : (
                  <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60">
                          <th className="text-left px-4 py-2.5 text-xs text-slate-500">Type</th>
                          <th className="text-left px-3 py-2.5 text-xs text-slate-500">Description</th>
                          <th className="text-left px-3 py-2.5 text-xs text-slate-500">Period</th>
                          <th className="text-right px-3 py-2.5 text-xs text-slate-500">Amount</th>
                          <th className="text-center px-3 py-2.5 text-xs text-slate-500">Status</th>
                          <th className="w-24 px-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {adjustments.map((a: PayableAdjustment) => (
                          <tr
                            key={a.id}
                            className="border-b border-slate-800/50 hover:bg-slate-800/20"
                          >
                            <td className="px-4 py-3">
                              <AdjTypeBadge type={a.adjustmentType} />
                            </td>
                            <td className="px-3 py-3 text-slate-300 max-w-[180px]">
                              <span className="truncate block">{a.description}</span>
                              {a.reference && (
                                <span className="text-[10px] text-slate-600 block">{a.reference}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-slate-500 text-xs">{a.periodLabel ?? "—"}</td>
                            <td className="px-3 py-3 text-right">
                              <DirectionChip direction={a.direction} amount={n(a.amount)} />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <StatusBadge status={a.status} />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex gap-1 justify-end">
                                {a.status === "draft" && (
                                  <>
                                    <button
                                      onClick={() => handleAdjConfirm(a.id)}
                                      title="Confirm"
                                      className="p-1 rounded hover:bg-emerald-900/20 text-slate-500 hover:text-emerald-400 transition-colors"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => openEditAdj(a)}
                                      title="Edit"
                                      className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                                {isAdmin && (
                                  <button
                                    onClick={() => handleAdjDelete(a.id)}
                                    title="Delete"
                                    className="p-1 rounded hover:bg-red-900/20 text-slate-500 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ════════ HISTORY TAB ════════ */}
            {tab === "history" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-slate-400">
                    Saved recommendation snapshots (write-once, immutable amounts).
                  </p>
                </div>
                {snapshotsLoading ? (
                  <LoadingRow label="Loading history…" />
                ) : snapshots.length === 0 ? (
                  <EmptyBox
                    icon={History}
                    label="No recommendation snapshots saved. Use 'Save Recommendation' to capture the current state."
                  />
                ) : (
                  <div className="space-y-2">
                    {snapshots.map((s: PayableSnapshot) => (
                      <div
                        key={s.id}
                        className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-medium text-slate-200">{s.periodLabel}</span>
                            <StatusBadge status={s.status} />
                            <span className="text-xs text-slate-500">
                              {new Date(s.computedAt).toLocaleString("en-IN", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                              {s.generatedByName && ` · ${s.generatedByName}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-blue-300 text-lg">
                              {fmt(n(s.actualPayable))}
                            </span>
                            {isAdmin && s.status === "draft" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleFinalize(s.id)}
                                className="h-7 px-2.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20"
                              >
                                <Lock className="w-3 h-3 mr-1" /> Finalize
                              </Button>
                            )}
                          </div>
                        </div>
                        {/* Snapshot breakdown row */}
                        <div className="flex gap-5 flex-wrap mt-3 text-xs text-slate-500">
                          <span>Profit Share: <span className="text-emerald-400 font-mono">{fmt(n(s.profitShareAmount))}</span></span>
                          <span>Advances: <span className="text-blue-400 font-mono">{fmt(n(s.recoverableAdvancesAmount))}</span></span>
                          <span>Recoveries: <span className="text-violet-400 font-mono">{fmt(n(s.pendingRecoveriesAmount))}</span></span>
                          <span>LCA: <span className="text-amber-400 font-mono">{fmt(n(s.pendingLcaAmount))}</span></span>
                          <span>Adjustments: <span className="text-slate-300 font-mono">{fmtSigned(n(s.priorAdjustmentsAmount))}</span></span>
                          <span>Carry: <span className="text-red-400 font-mono">−{fmt(n(s.negativeCarryAmount))}</span></span>
                        </div>
                        {s.notes && (
                          <p className="text-xs text-slate-500 mt-2 italic">{s.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Save snapshot dialog ── */}
        {showSnapshotDialog && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-white">
                  Save Recommendation Snapshot
                </h3>
                <button
                  onClick={() => setShowSnapshotDialog(false)}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2 text-xs text-amber-300 mb-4 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                This captures the current computation as an immutable record.
                Amounts will not change after saving. Final settlement stays manual.
              </div>

              {/* Preview of actual payable */}
              <div className="bg-blue-950/20 border border-blue-700/30 rounded-lg px-4 py-3 mb-4 text-center">
                <p className="text-xs text-blue-400 mb-1">Actual Payable Recommendation</p>
                <p className="font-mono text-2xl font-bold text-blue-300">{fmt(actual)}</p>
              </div>

              <div className="space-y-3">
                <Field label="Period Label *">
                  <Input
                    value={snapshotPeriod}
                    onChange={(e) => setSnapshotPeriod(e.target.value)}
                    placeholder='e.g. "2024-25 Final Settlement"'
                    className="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </Field>
                <Field label="Notes (optional)">
                  <Textarea
                    value={snapshotNotes}
                    onChange={(e) => setSnapshotNotes(e.target.value)}
                    placeholder="Context for this recommendation…"
                    className="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16"
                  />
                </Field>
              </div>

              {snapshotError && (
                <p className="mt-2 text-red-400 text-xs flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {snapshotError}
                </p>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSaveSnapshot}
                  disabled={createSnapshotMutation.isPending}
                  className="flex-1 bg-blue-700 hover:bg-blue-600 text-white"
                >
                  {createSnapshotMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <BookOpen className="w-4 h-4 mr-2" />
                  )}
                  Save Snapshot
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowSnapshotDialog(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Micro-components ──────────────────────────────────────────────────────

function BreakdownSection({
  title,
  color,
  icon: Icon,
  total,
  positive = true,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  color: string;
  icon: React.ElementType;
  total: number;
  positive?: boolean;
  empty: boolean;
  emptyLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/60 bg-slate-900/30">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${color}`} />
          <span className="text-sm font-medium text-slate-300">{title}</span>
        </div>
        <span
          className={`font-mono font-bold text-base ${
            Math.abs(total) < 0.01 ? "text-slate-600" : positive === false ? "text-red-400" : color
          }`}
        >
          {positive === false ? `−${fmt(total)}` : fmt(total)}
        </span>
      </div>
      <div className="p-4">
        {empty ? (
          <p className="text-xs text-slate-600 text-center py-4">{emptyLabel}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function SimpleTable({
  cols,
  rows,
}: {
  cols: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            {cols.map((c, i) => (
              <th
                key={i}
                className="text-left px-3 py-2 text-slate-500 font-medium"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-800/40 hover:bg-slate-800/20">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2.5 text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-400 text-xs">{label}</Label>
      {children}
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
      <RefreshCw className="w-4 h-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function EmptyBox({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-10 text-center">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-20" />
      <p className="text-slate-500 text-sm">{label}</p>
    </div>
  );
}
