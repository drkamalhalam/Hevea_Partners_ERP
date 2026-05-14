/**
 * DistributionWorkflow.tsx
 *
 * Guided 5-step workflow for generating contribution-model distribution
 * settlement recommendations.
 *
 * Steps:
 *  1. Setup       — project + accounting period
 *  2. Revenue     — link confirmed sales records or enter manually
 *  3. Deductions  — operational cost + LCA
 *  4. Ownership   — select ownership snapshot
 *  5. Result      — waterfall calculation + save/confirm
 *
 * Also shows a "History" tab with confirmed recommendation records.
 *
 * GUIDANCE ONLY — actual settlement is manual.
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListProjects,
  useLookupRevenueForDistribution,
  useLookupLcaForDistribution,
  useLookupOwnershipForDistribution,
  useCreateDistributionPreview,
  useListDistributionPreviews,
  useConfirmDistributionPreview,
  useArchiveDistributionPreview,
  getLookupRevenueForDistributionQueryKey,
  getLookupOwnershipForDistributionQueryKey,
  getLookupLcaForDistributionQueryKey,
  getListDistributionPreviewsQueryKey,
} from "@workspace/api-client-react";
import type {
  Project,
  OwnershipSnapshotLookupRow,
  RevenueLookupSaleRow,
  DistributionPreview,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Layers,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Circle,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  Info,
  Minus,
  Equal,
  ArrowRight,
  Lock,
  Archive,
  Calculator,
  TrendingDown,
  Users,
  Receipt,
  BarChart3,
  History,
  Banknote,
  Landmark,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

// ── Formatting ────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n: number) {
  return `${Number(n).toFixed(2)}%`;
}

// ── Step indicator ────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Setup", icon: BarChart3 },
  { id: 2, label: "Revenue", icon: Banknote },
  { id: 3, label: "Deductions", icon: Receipt },
  { id: 4, label: "Ownership", icon: Users },
  { id: 5, label: "Result", icon: Calculator },
];

function StepIndicator({
  currentStep,
  onStepClick,
  completedSteps,
}: {
  currentStep: number;
  onStepClick: (s: number) => void;
  completedSteps: Set<number>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {STEPS.map((s) => {
        const done = completedSteps.has(s.id) && s.id < currentStep;
        const active = s.id === currentStep;
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            onClick={() => s.id <= currentStep || completedSteps.has(s.id - 1) ? onStepClick(s.id) : undefined}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
              active
                ? "bg-blue-900/40 border border-blue-700/50 text-white"
                : done
                ? "text-emerald-400 hover:bg-slate-800/40 cursor-pointer"
                : "text-slate-600 cursor-default"
            }`}
          >
            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
              done ? "bg-emerald-800/60 text-emerald-400" : active ? "bg-blue-700 text-white" : "bg-slate-800 text-slate-600"
            }`}>
              {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-xs font-bold">{s.id}</span>}
            </div>
            <div>
              <p className={`text-sm font-medium ${active ? "text-white" : done ? "text-emerald-400" : "text-slate-600"}`}>{s.label}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">
        <Lock className="w-2.5 h-2.5" /> Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-900/30 text-amber-400 border border-amber-800/40">
      Draft
    </span>
  );
}

// ── Client-side distribution calculation ──────────────────────────────────

interface ShareEntry {
  partnerKey: string;
  partnerId: string | null;
  partnerName: string;
  role: "landowner" | "developer" | "unknown";
  ownershipPct: number;
  amount: number;
}

interface WaterfallResult {
  grossRevenue: number;
  operationalCost: number;
  lcaAmount: number;
  distributablePool: number;
  ownerShares: ShareEntry[];
  landownerTotal: number;
  developerTotal: number;
  warnings: string[];
}

function computeWaterfall(
  grossRevenue: number,
  operationalCost: number,
  lcaAmount: number,
  snapshotEntries: OwnershipSnapshotLookupRow["entries"],
): WaterfallResult {
  const warnings: string[] = [];
  const distributablePool = Math.max(0, grossRevenue - operationalCost - lcaAmount);

  const ownerShares: ShareEntry[] = snapshotEntries.map((e) => ({
    partnerKey: e.partnerKey,
    partnerId: e.partnerId ?? null,
    partnerName: e.partnerName,
    role: "unknown" as const,
    ownershipPct: e.percentage,
    amount: Math.round((distributablePool * e.percentage) / 100 * 100) / 100,
  }));

  if (ownerShares.length === 0) {
    warnings.push("No ownership entries in the selected snapshot. Cannot compute per-partner amounts.");
  }

  const totalPct = snapshotEntries.reduce((s, e) => s + e.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.5) {
    warnings.push(`Ownership percentages sum to ${totalPct.toFixed(2)}% (expected 100%). Results may not balance.`);
  }

  const landownerTotal = ownerShares.reduce((s, e) => s + e.amount, 0);

  return {
    grossRevenue,
    operationalCost,
    lcaAmount,
    distributablePool,
    ownerShares,
    landownerTotal,
    developerTotal: distributablePool - landownerTotal,
    warnings,
  };
}

// ── Waterfall display ─────────────────────────────────────────────────────

function WaterfallDisplay({ result }: { result: WaterfallResult }) {
  return (
    <div className="space-y-4">
      {/* Waterfall */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-5 space-y-2">
        <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">Distribution Waterfall</p>
        <WRow label="Gross Revenue" value={result.grossRevenue} color="text-emerald-400" symbol="+" bold />
        {result.operationalCost > 0 && (
          <WRow label="Operational Cost" value={result.operationalCost} color="text-red-400" symbol="−" />
        )}
        {result.lcaAmount > 0 && (
          <WRow label="LCA (Land Contribution Adj.)" value={result.lcaAmount} color="text-amber-400" symbol="−" />
        )}
        <div className="border-t border-slate-700 my-3" />
        <WRow label="Distributable Pool" value={result.distributablePool} color="text-sky-300" bold />
      </div>

      {/* Per-partner breakdown */}
      {result.ownerShares.length > 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider">Ownership Distribution</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/40">
                <th className="text-left px-5 py-2 text-xs text-slate-500">Partner</th>
                <th className="text-right px-4 py-2 text-xs text-slate-500">Share %</th>
                <th className="text-right px-5 py-2 text-xs text-slate-500">Recommended Amount</th>
              </tr>
            </thead>
            <tbody>
              {result.ownerShares.map((s, i) => (
                <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                  <td className="px-5 py-3 text-slate-200 font-medium">{s.partnerName}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">{pct(s.ownershipPct)}</td>
                  <td className="px-5 py-3 text-right font-mono text-emerald-400 font-semibold text-base">{fmt(s.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900/60">
              <tr>
                <td colSpan={2} className="px-5 py-2.5 text-xs text-slate-500">Total distributed</td>
                <td className="px-5 py-2.5 text-right font-mono text-sky-300 font-semibold">
                  {fmt(result.distributablePool)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {/* Warnings */}
      {result.warnings.map((w, i) => (
        <div key={i} className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {w}
        </div>
      ))}

      {/* Advisory note */}
      <div className="bg-slate-800/30 rounded-lg px-4 py-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400">
          This is a <strong className="text-slate-300">settlement recommendation only</strong>. Actual payments must be processed manually outside this system. Confirm this record to lock it as official guidance.
        </p>
      </div>
    </div>
  );
}

function WRow({ label, value, color, symbol, bold }: { label: string; value: number; color: string; symbol?: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${bold ? "text-base" : "text-sm"}`}>
      <div className="flex items-center gap-2 text-slate-300">
        {symbol === "+" ? (
          <span className="text-emerald-500 font-bold text-base w-4">+</span>
        ) : symbol === "−" ? (
          <Minus className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <Equal className="w-3.5 h-3.5 text-sky-400" />
        )}
        <span className={bold ? "font-semibold text-white" : ""}>{label}</span>
      </div>
      <span className={`font-mono font-semibold ${color}`}>{fmt(value)}</span>
    </div>
  );
}

// ── History item ──────────────────────────────────────────────────────────

function HistoryRow({
  p,
  onConfirm,
  onArchive,
  isAdmin,
  expanded,
  onToggle,
}: {
  p: DistributionPreview;
  onConfirm: (id: string) => void;
  onArchive: (id: string) => void;
  isAdmin: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const result = p.distributionResult as any;
  const pool = result?.distributablePool ?? 0;
  const shares: any[] = result?.ownerShares ?? [];

  return (
    <div className={`border border-slate-800 rounded-xl overflow-hidden ${p.status === "confirmed" ? "border-emerald-900/40" : ""}`}>
      <div
        className="flex items-center gap-4 px-5 py-3.5 bg-slate-900/40 cursor-pointer hover:bg-slate-800/40"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-200">{p.periodLabel}</span>
            <StatusBadge status={p.status} />
            {p.revenueSource === "sales_records" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/30">
                Linked Sales
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-slate-500 flex-wrap">
            <span>Gross: {fmt(p.grossRevenue)}</span>
            {p.operationalCost > 0 && <span>Op: {fmt(p.operationalCost)}</span>}
            {p.lcaAmount > 0 && <span>LCA: {fmt(p.lcaAmount)}</span>}
            <span className="text-sky-400">Pool: {fmt(pool)}</span>
            {p.calculatedByName && <span>by {p.calculatedByName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && p.status === "draft" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onConfirm(p.id); }}
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 h-7 px-2 text-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onArchive(p.id); }}
                className="text-slate-500 hover:text-red-400 hover:bg-red-900/20 h-7 w-7 p-0"
              >
                <Archive className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 px-5 py-4 bg-slate-950/30">
          {/* Ownership snapshot entries */}
          {(p.ownershipSnapshotEntries as any[])?.length > 0 && (
            <div className="mb-4">
              <WaterfallDisplay result={computeWaterfall(
                p.grossRevenue,
                p.operationalCost,
                p.lcaAmount,
                p.ownershipSnapshotEntries as any[],
              )} />
            </div>
          )}
          {/* Linked sales */}
          {(p.linkedSaleIds as string[])?.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              {(p.linkedSaleIds as string[]).length} confirmed sale{(p.linkedSaleIds as string[]).length > 1 ? "s" : ""} linked
            </p>
          )}
          {p.notes && (
            <p className="text-xs text-slate-500 italic border-t border-slate-800 pt-2 mt-2">Notes: {p.notes}</p>
          )}
          {p.confirmedAt && (
            <p className="text-xs text-slate-600 mt-1">
              Confirmed {new Date(p.confirmedAt).toLocaleDateString("en-IN")} by {p.confirmedByName}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function DistributionWorkflow() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const canUse = role === "admin" || role === "developer";

  // Navigation
  const [activeTab, setActiveTab] = useState<"workflow" | "history">("workflow");
  const [step, setStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Step 1: Setup
  const [projectId, setProjectId] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodYear, setPeriodYear] = useState("");
  const [agreementId, setAgreementId] = useState<string | undefined>();
  const [notes, setNotes] = useState("");

  // Step 2: Revenue
  const [revenueSource, setRevenueSource] = useState<"sales_records" | "manual">("sales_records");
  const [selectedSaleIds, setSelectedSaleIds] = useState<Set<string>>(new Set());
  const [manualGrossRevenue, setManualGrossRevenue] = useState("");

  // Step 3: Deductions
  const [operationalCost, setOperationalCost] = useState("0");
  const [lcaSource, setLcaSource] = useState<"manual" | "ledger">("manual");
  const [manualLca, setManualLca] = useState("0");

  // Step 4: Ownership
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

  // History
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Error state
  const [stepError, setStepError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Data fetches ──────────────────────────────────────────────────────

  const { data: projects = [] } = useListProjects();

  const { data: revenueData, isLoading: revenueLoading } = useLookupRevenueForDistribution(
    { projectId, from: periodStart || undefined, to: periodEnd || undefined },
    {
      query: {
        enabled: !!projectId && step >= 2,
        queryKey: getLookupRevenueForDistributionQueryKey({ projectId, from: periodStart || undefined, to: periodEnd || undefined }),
      },
    },
  );

  const { data: ownershipData, isLoading: ownershipLoading } = useLookupOwnershipForDistribution(
    { projectId },
    {
      query: {
        enabled: !!projectId && step >= 4,
        queryKey: getLookupOwnershipForDistributionQueryKey({ projectId }),
      },
    },
  );

  const { data: lcaData } = useLookupLcaForDistribution(
    { projectId },
    {
      query: {
        enabled: !!projectId && step >= 3 && lcaSource === "ledger",
        queryKey: getLookupLcaForDistributionQueryKey({ projectId }),
      },
    },
  );

  const { data: historyPage, isLoading: historyLoading } = useListDistributionPreviews(
    { projectId },
    {
      query: {
        enabled: !!projectId && activeTab === "history",
        queryKey: getListDistributionPreviewsQueryKey({ projectId }),
      },
    },
  );
  const history = historyPage?.previews ?? [];

  const createMutation = useCreateDistributionPreview();
  const confirmMutation = useConfirmDistributionPreview();
  const archiveMutation = useArchiveDistributionPreview();

  // ── Derived values ─────────────────────────────────────────────────────

  const selectedSales = useMemo(
    () => (revenueData?.sales ?? []).filter((s: RevenueLookupSaleRow) => selectedSaleIds.has(s.id)),
    [revenueData, selectedSaleIds],
  );

  const linkedGrossRevenue = useMemo(
    () => selectedSales.reduce((s: number, r: RevenueLookupSaleRow) => s + r.grossRevenue, 0),
    [selectedSales],
  );

  const effectiveGrossRevenue = revenueSource === "sales_records"
    ? linkedGrossRevenue
    : parseFloat(manualGrossRevenue) || 0;

  const effectiveLca = lcaSource === "ledger"
    ? (lcaData?.totalBalance ?? 0)
    : parseFloat(manualLca) || 0;

  const selectedSnapshot = useMemo(
    () => (ownershipData?.snapshots ?? []).find((s: OwnershipSnapshotLookupRow) => s.id === selectedSnapshotId),
    [ownershipData, selectedSnapshotId],
  );

  const waterfallResult = useMemo(() => {
    if (!selectedSnapshot) return null;
    return computeWaterfall(
      effectiveGrossRevenue,
      parseFloat(operationalCost) || 0,
      effectiveLca,
      selectedSnapshot.entries,
    );
  }, [effectiveGrossRevenue, operationalCost, effectiveLca, selectedSnapshot]);

  // ── Navigation ─────────────────────────────────────────────────────────

  function markComplete(s: number) {
    setCompletedSteps((prev) => new Set([...prev, s]));
  }

  function goNext() {
    setStepError(null);
    if (step === 1) {
      if (!projectId) return setStepError("Select a project to continue.");
      if (!periodLabel.trim()) return setStepError('Enter a period label (e.g. "2024-25 Q1").');
      markComplete(1);
      setStep(2);
    } else if (step === 2) {
      if (revenueSource === "sales_records" && selectedSaleIds.size === 0) {
        return setStepError("Select at least one confirmed sale, or switch to manual entry.");
      }
      if (revenueSource === "manual" && !(parseFloat(manualGrossRevenue) > 0)) {
        return setStepError("Enter a gross revenue amount greater than zero.");
      }
      markComplete(2);
      setStep(3);
    } else if (step === 3) {
      markComplete(3);
      setStep(4);
    } else if (step === 4) {
      if (!selectedSnapshotId) return setStepError("Select an ownership snapshot to continue.");
      markComplete(4);
      setStep(5);
    }
  }

  function goBack() {
    setStepError(null);
    if (step > 1) setStep(step - 1);
  }

  // ── Save ───────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveError(null);
    if (!selectedSnapshot) return setSaveError("Ownership snapshot required.");
    if (effectiveGrossRevenue <= 0) return setSaveError("Gross revenue must be greater than zero.");

    try {
      await createMutation.mutateAsync({
        data: {
          projectId,
          periodLabel: periodLabel.trim(),
          periodStart: periodStart || undefined,
          periodEnd: periodEnd || undefined,
          periodYear: periodYear ? parseInt(periodYear) : undefined,
          grossRevenue: effectiveGrossRevenue,
          operationalCost: parseFloat(operationalCost) || 0,
          lcaAmount: effectiveLca,
          lcaSource,
          revenueSource,
          linkedSaleIds: revenueSource === "sales_records" ? [...selectedSaleIds] : [],
          ownershipSnapshotId: selectedSnapshotId ?? undefined,
          ownershipSnapshotEntries: selectedSnapshot.entries,
          notes: notes.trim() || undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getListDistributionPreviewsQueryKey({ projectId }) });
      setActiveTab("history");
    } catch (e: any) {
      setSaveError(e?.response?.data?.error ?? "Failed to save recommendation.");
    }
  }

  async function handleConfirm(id: string) {
    await confirmMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListDistributionPreviewsQueryKey({ projectId }) });
  }

  async function handleArchive(id: string) {
    await archiveMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListDistributionPreviewsQueryKey({ projectId }) });
  }

  // ── Access guard ───────────────────────────────────────────────────────

  if (!canUse) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Distribution workflow is restricted to admins and developers.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg border border-blue-700/40">
              <Layers className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Distribution Workflow</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Contribution model · Ownership-based settlement guidance
              </p>
            </div>
          </div>
          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("workflow")}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === "workflow" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <Calculator className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              New Calculation
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === "history" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <History className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              History
            </button>
          </div>
        </div>

        {/* Model info strip */}
        <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl px-5 py-3 mb-6 flex items-center gap-4 text-xs text-slate-400">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-emerald-400">Gross Revenue</span>
            <Minus className="w-3 h-3 text-red-400" />
            <span>Operational Cost</span>
            <Minus className="w-3 h-3 text-red-400" />
            <span>LCA</span>
            <Equal className="w-3 h-3 text-sky-400" />
            <span className="text-sky-400 font-semibold">Distributable Pool</span>
            <ArrowRight className="w-3 h-3" />
            <span>split by <strong className="text-slate-300">frozen ownership percentages</strong></span>
          </div>
        </div>

        {/* ── WORKFLOW TAB ── */}
        {activeTab === "workflow" && (
          <div className="grid grid-cols-[200px_1fr] gap-6">
            {/* Left: step nav */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 h-fit">
              <StepIndicator
                currentStep={step}
                completedSteps={completedSteps}
                onStepClick={(s) => { if (s <= step || completedSteps.has(s - 1)) { setStepError(null); setStep(s); } }}
              />
            </div>

            {/* Right: step content */}
            <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-6">

              {/* ── Step 1: Setup ── */}
              {step === 1 && (
                <div className="space-y-5">
                  <StepHeader icon={BarChart3} title="Project & Period Setup" subtitle="Select the project and define the accounting period for this distribution." />

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Project *</Label>
                    <Select value={projectId} onValueChange={(v) => { setProjectId(v); setSelectedSaleIds(new Set()); setSelectedSnapshotId(null); }}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        {projects.map((p: Project) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Period Label * <span className="text-slate-600">(e.g. "2024-25 Q1" or "FY 2024-25")</span></Label>
                    <Input
                      value={periodLabel}
                      onChange={(e) => setPeriodLabel(e.target.value)}
                      placeholder="e.g. 2024-25 Q1"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-slate-400 text-xs">Period Start</Label>
                      <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
                        className="bg-slate-900 border-slate-700 text-slate-200" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-400 text-xs">Period End</Label>
                      <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
                        className="bg-slate-900 border-slate-700 text-slate-200" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-400 text-xs">Year</Label>
                      <Input type="number" value={periodYear} onChange={(e) => setPeriodYear(e.target.value)}
                        placeholder="2024" className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Notes (optional)</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="Context, data sources, remarks…"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16" />
                  </div>
                </div>
              )}

              {/* ── Step 2: Revenue ── */}
              {step === 2 && (
                <div className="space-y-5">
                  <StepHeader icon={Banknote} title="Verified Revenue" subtitle="Link confirmed sales records for this period, or enter revenue manually." />

                  {/* Source toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRevenueSource("sales_records")}
                      className={`flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${revenueSource === "sales_records" ? "bg-blue-900/40 border-blue-700 text-blue-300" : "border-slate-700 text-slate-500 hover:border-slate-600"}`}
                    >
                      Link Sales Records
                    </button>
                    <button
                      onClick={() => setRevenueSource("manual")}
                      className={`flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${revenueSource === "manual" ? "bg-blue-900/40 border-blue-700 text-blue-300" : "border-slate-700 text-slate-500 hover:border-slate-600"}`}
                    >
                      Enter Manually
                    </button>
                  </div>

                  {revenueSource === "sales_records" ? (
                    <div>
                      {revenueLoading ? (
                        <div className="flex items-center gap-2 py-8 justify-center text-slate-500">
                          <RefreshCw className="w-4 h-4 animate-spin" /> Loading confirmed sales…
                        </div>
                      ) : !revenueData?.sales?.length ? (
                        <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-10 text-center">
                          <Banknote className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          <p className="text-slate-500 text-sm">No confirmed sales found for this project/period.</p>
                          {(periodStart || periodEnd) ? (
                            <p className="text-slate-600 text-xs mt-1">Try adjusting the date range in Step 1, or switch to manual entry.</p>
                          ) : (
                            <p className="text-slate-600 text-xs mt-1">Set a date range in Step 1 to filter sales, or switch to manual entry.</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          {/* Select all */}
                          <div className="flex items-center justify-between mb-2 px-1">
                            <span className="text-xs text-slate-500">{revenueData.sales.length} confirmed sale{revenueData.sales.length > 1 ? "s" : ""}</span>
                            <button
                              className="text-xs text-blue-400 hover:text-blue-300"
                              onClick={() => {
                                if (selectedSaleIds.size === revenueData.sales.length) {
                                  setSelectedSaleIds(new Set());
                                } else {
                                  setSelectedSaleIds(new Set(revenueData.sales.map((s: RevenueLookupSaleRow) => s.id)));
                                }
                              }}
                            >
                              {selectedSaleIds.size === revenueData.sales.length ? "Deselect all" : "Select all"}
                            </button>
                          </div>
                          <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {revenueData.sales.map((s: RevenueLookupSaleRow) => (
                              <label
                                key={s.id}
                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedSaleIds.has(s.id) ? "border-blue-700/50 bg-blue-900/20" : "border-slate-800 hover:border-slate-700"}`}
                              >
                                <Checkbox
                                  checked={selectedSaleIds.has(s.id)}
                                  onCheckedChange={(v) => {
                                    setSelectedSaleIds((prev) => {
                                      const next = new Set(prev);
                                      v ? next.add(s.id) : next.delete(s.id);
                                      return next;
                                    });
                                  }}
                                  className="border-slate-600"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-200">{s.saleNumber}</span>
                                    <span className="font-mono text-sm text-emerald-400">{fmt(s.grossRevenue)}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                                    <span>{s.saleDate}</span>
                                    <span>{s.buyerName}</span>
                                    {s.deductions > 0 && <span className="text-red-400">−{fmt(s.deductions)} deductions</span>}
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>

                          {/* Selected total */}
                          {selectedSaleIds.size > 0 && (
                            <div className="mt-3 bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-2.5 flex items-center justify-between">
                              <span className="text-sm text-slate-400">{selectedSaleIds.size} sale{selectedSaleIds.size > 1 ? "s" : ""} selected</span>
                              <span className="font-mono font-semibold text-emerald-400">{fmt(linkedGrossRevenue)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="text-slate-400 text-xs">Gross Revenue (₹) *</Label>
                      <Input
                        type="number"
                        value={manualGrossRevenue}
                        onChange={(e) => setManualGrossRevenue(e.target.value)}
                        placeholder="0.00"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-lg"
                      />
                      <p className="text-xs text-slate-500">Enter the total gross revenue for this accounting period.</p>
                    </div>
                  )}

                  {/* Revenue summary */}
                  {effectiveGrossRevenue > 0 && (
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-4 py-3 flex items-center justify-between">
                      <span className="text-sm text-emerald-400">Gross Revenue for Distribution</span>
                      <span className="font-mono font-bold text-emerald-400 text-xl">{fmt(effectiveGrossRevenue)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 3: Deductions ── */}
              {step === 3 && (
                <div className="space-y-5">
                  <StepHeader icon={Receipt} title="Deductions" subtitle="Enter operational costs and LCA to be deducted from gross revenue before distribution." />

                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 mb-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">Gross Revenue (from Step 2)</span>
                      <span className="font-mono text-emerald-400 font-semibold">{fmt(effectiveGrossRevenue)}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Operational Cost (₹)</Label>
                    <Input
                      type="number"
                      value={operationalCost}
                      onChange={(e) => setOperationalCost(e.target.value)}
                      placeholder="0.00"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                    <p className="text-xs text-slate-500">Labour, maintenance, transport, and other direct operational expenses.</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-slate-400 text-xs">LCA — Land Contribution Adjustment (₹)</Label>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setLcaSource("ledger")}
                          className={`text-xs px-2.5 py-1 rounded border transition-all ${lcaSource === "ledger" ? "bg-amber-900/30 border-amber-700 text-amber-300" : "border-slate-700 text-slate-500 hover:border-slate-600"}`}
                        >
                          From Ledger
                        </button>
                        <button
                          onClick={() => setLcaSource("manual")}
                          className={`text-xs px-2.5 py-1 rounded border transition-all ${lcaSource === "manual" ? "bg-blue-900/30 border-blue-700 text-blue-300" : "border-slate-700 text-slate-500 hover:border-slate-600"}`}
                        >
                          Manual
                        </button>
                      </div>
                    </div>

                    {lcaSource === "ledger" ? (
                      <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4">
                        {lcaData ? (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm text-amber-400">Total LCA Outstanding Balance</span>
                              <span className="font-mono font-bold text-amber-400 text-lg">{fmt(lcaData.totalBalance)}</span>
                            </div>
                            <div className="text-xs text-slate-500 space-y-1">
                              {(lcaData.entries ?? []).map((e: any) => (
                                <div key={e.id} className="flex justify-between">
                                  <span>Year {e.year}</span>
                                  <span className={e.balance > 0 ? "text-amber-500" : "text-emerald-500"}>
                                    Balance: {fmt(e.balance)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500">No LCA ledger entries found for this project.</p>
                        )}
                      </div>
                    ) : (
                      <Input
                        type="number"
                        value={manualLca}
                        onChange={(e) => setManualLca(e.target.value)}
                        placeholder="0.00"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                      />
                    )}
                  </div>

                  {/* Live pool preview */}
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">Live Pool Preview</p>
                    <WRow label="Gross Revenue" value={effectiveGrossRevenue} color="text-emerald-400" symbol="+" />
                    {(parseFloat(operationalCost) || 0) > 0 && (
                      <WRow label="Operational Cost" value={parseFloat(operationalCost) || 0} color="text-red-400" symbol="−" />
                    )}
                    {effectiveLca > 0 && (
                      <WRow label="LCA" value={effectiveLca} color="text-amber-400" symbol="−" />
                    )}
                    <div className="border-t border-slate-700 my-2" />
                    <WRow label="Distributable Pool" value={Math.max(0, effectiveGrossRevenue - (parseFloat(operationalCost) || 0) - effectiveLca)} color="text-sky-300" bold />
                  </div>
                </div>
              )}

              {/* ── Step 4: Ownership ── */}
              {step === 4 && (
                <div className="space-y-5">
                  <StepHeader icon={Users} title="Ownership Snapshot" subtitle="Select the ownership snapshot to use for per-partner distribution. Use a frozen snapshot for settlement finality." />

                  {ownershipLoading ? (
                    <div className="flex items-center gap-2 py-8 justify-center text-slate-500">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Loading ownership snapshots…
                    </div>
                  ) : !ownershipData?.snapshots?.length ? (
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-10 text-center">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-slate-500 text-sm">No ownership snapshots found for this project.</p>
                      <p className="text-slate-600 text-xs mt-1">Take an ownership snapshot from the Contributions module first.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {ownershipData.isFrozen && (
                        <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs text-emerald-400">
                          <Lock className="w-3.5 h-3.5" />
                          Ownership is frozen — using a snapshot from before the freeze date gives final, binding percentages.
                        </div>
                      )}

                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {(ownershipData.snapshots ?? []).map((s: OwnershipSnapshotLookupRow) => (
                          <button
                            key={s.id}
                            onClick={() => setSelectedSnapshotId(s.id)}
                            className={`w-full text-left p-4 rounded-xl border transition-all ${selectedSnapshotId === s.id ? "border-blue-700/60 bg-blue-900/20" : "border-slate-800 hover:border-slate-700 bg-slate-900/30"}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-200">
                                  {new Date(s.snapshotAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">{s.snapshotType}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">{s.lifecycleStatus}</span>
                              </div>
                              {selectedSnapshotId === s.id && (
                                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mb-2">
                              Total recognised: {fmt(s.totalRecognizedAmount)} ·{" "}
                              {s.triggeredByName ? `by ${s.triggeredByName}` : ""}
                            </div>
                            {/* Per-partner mini table */}
                            <div className="space-y-1">
                              {s.entries.map((e, i) => (
                                <div key={i} className="flex items-center justify-between text-xs">
                                  <span className="text-slate-300">{e.partnerName}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono text-slate-400">{pct(e.percentage)}</span>
                                    <span className="font-mono text-slate-500">{fmt(e.totalAmount)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {s.notes && <p className="text-xs text-slate-600 mt-2 italic">{s.notes}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 5: Result ── */}
              {step === 5 && (
                <div className="space-y-5">
                  <StepHeader icon={Calculator} title="Settlement Recommendation" subtitle="Review the calculated distribution below. Save as draft, then confirm to lock it as official guidance." />

                  {waterfallResult ? (
                    <WaterfallDisplay result={waterfallResult} />
                  ) : (
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-10 text-center">
                      <Calculator className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-slate-500 text-sm">No ownership snapshot selected. Go back to Step 4.</p>
                    </div>
                  )}

                  {/* Summary card */}
                  {waterfallResult && (
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-slate-500 text-xs mb-1">Project</p>
                        <p className="text-slate-200">{projects.find((p: Project) => p.id === projectId)?.name ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs mb-1">Period</p>
                        <p className="text-slate-200">{periodLabel}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs mb-1">Revenue Source</p>
                        <p className="text-slate-200">{revenueSource === "sales_records" ? `${selectedSaleIds.size} linked sale(s)` : "Manual entry"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs mb-1">Snapshot Date</p>
                        <p className="text-slate-200">{selectedSnapshot ? new Date(selectedSnapshot.snapshotAt).toLocaleDateString("en-IN") : "—"}</p>
                      </div>
                    </div>
                  )}

                  {saveError && (
                    <p className="text-red-400 text-sm bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-2">{saveError}</p>
                  )}

                  <Button
                    onClick={handleSave}
                    disabled={createMutation.isPending || !waterfallResult}
                    className="w-full bg-blue-700 hover:bg-blue-600 text-white py-5 text-base"
                  >
                    {createMutation.isPending ? (
                      <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                    ) : (
                      <><Calculator className="w-4 h-4 mr-2" /> Save as Draft Recommendation</>
                    )}
                  </Button>
                </div>
              )}

              {/* Error */}
              {stepError && (
                <div className="mt-4 bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-2 text-sm text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {stepError}
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-5 border-t border-slate-800">
                <Button
                  variant="ghost"
                  onClick={goBack}
                  disabled={step === 1}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                {step < 5 && (
                  <Button onClick={goNext} className="bg-blue-700 hover:bg-blue-600 text-white">
                    Continue <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === "history" && (
          <div className="space-y-4">
            {/* Project selector for history */}
            <div className="flex items-center gap-3">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-72">
                  <SelectValue placeholder="Select a project to view history" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  {projects.map((p: Project) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projectId && history.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="bg-amber-900/30 text-amber-400 border border-amber-800/30 px-2 py-0.5 rounded">
                    {history.filter((p) => p.status === "draft").length} draft
                  </span>
                  <span className="bg-emerald-900/30 text-emerald-400 border border-emerald-800/30 px-2 py-0.5 rounded">
                    {history.filter((p) => p.status === "confirmed").length} confirmed
                  </span>
                </div>
              )}
            </div>

            {!projectId ? (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-16 text-center">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-slate-500 text-sm">Select a project to view its recommendation history</p>
              </div>
            ) : historyLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading history…
              </div>
            ) : history.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-16 text-center">
                <History className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-slate-500 text-sm">No distribution records yet for this project</p>
                <Button
                  onClick={() => setActiveTab("workflow")}
                  variant="outline"
                  size="sm"
                  className="mt-4 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Create first recommendation
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((p: DistributionPreview) => (
                  <HistoryRow
                    key={p.id}
                    p={p}
                    onConfirm={handleConfirm}
                    onArchive={handleArchive}
                    isAdmin={isAdmin}
                    expanded={expandedHistoryId === p.id}
                    onToggle={() => setExpandedHistoryId(expandedHistoryId === p.id ? null : p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step header ───────────────────────────────────────────────────────────

function StepHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 pb-2 border-b border-slate-800 mb-2">
      <Icon className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
