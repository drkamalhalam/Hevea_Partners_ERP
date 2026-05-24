import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useListProjects } from "@workspace/api-client-react";
import {
  useListDistributionPreviews,
  useCreateDistributionPreview,
  useConfirmDistributionPreview,
  useArchiveDistributionPreview,
  useLookupLcaForDistribution,
  getListDistributionPreviewsQueryKey,
  getLookupLcaForDistributionQueryKey,
} from "@workspace/api-client-react";
import type {
  DistributionPreview as DistributionPreviewType,
  Project,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PieChart,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Minus,
  Equal,
  Info,
  Calculator,
  Archive,
  Lock,
  TrendingDown,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Formatting helpers ────────────────────────────────────────────────────
// NPF Stage 2 — accept string|number from server (numeric(15,2) columns).
import { parseNumeric } from "@/lib/numeric";

function fmt(n: number | string | null | undefined): string {
  const v = parseNumeric(n);
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number | string | null | undefined): string {
  return `${parseNumeric(n).toFixed(2)}%`;
}

// ── Model badge ───────────────────────────────────────────────────────────

function ModelBadge({ model }: { model: string }) {
  if (model === "fifty_percent_revenue") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">
        <TrendingDown className="w-3 h-3" />
        50% Revenue Split
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-900/40 text-blue-300 border border-blue-700/50">
      <PieChart className="w-3 h-3" />
      Contribution / Ownership
    </span>
  );
}

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

// ── Contribution model waterfall ───────────────────────────────────────────

function ContributionWaterfall({ result }: { result: any }) {
  return (
    <div className="space-y-3">
      {/* Waterfall */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-5 space-y-2">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-4">Distribution Waterfall</p>

        <WaterfallRow
          label="Gross Revenue"
          value={result.grossRevenue}
          color="text-emerald-400"
          symbol="+"
          bold
        />
        {result.costsChargedBeforeDistribution && result.operationalCost > 0 && (
          <WaterfallRow label="Operational Cost" value={result.operationalCost} color="text-red-400" symbol="−" />
        )}
        {result.lcaChargedBeforeDistribution && result.lcaAmount > 0 && (
          <WaterfallRow label="LCA (Land Contribution Adjustment)" value={result.lcaAmount} color="text-amber-400" symbol="−" />
        )}

        <div className="border-t border-slate-700 my-3" />

        <WaterfallRow
          label="Distributable Pool"
          value={result.distributablePool}
          color="text-sky-300"
          bold
        />
      </div>

      {/* Per-partner shares */}
      {result.ownerShares?.length > 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <p className="text-xs text-slate-500 uppercase tracking-wider">
              Ownership Distribution
            </p>
            <span className="text-xs text-slate-500 italic">
              Source: {ownershipSourceLabel(result.ownershipSource)}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/40">
                <th className="text-left px-5 py-2 text-xs text-slate-500 font-medium">Partner</th>
                <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium">Role</th>
                <th className="text-right px-4 py-2 text-xs text-slate-500 font-medium">Share %</th>
                <th className="text-right px-5 py-2 text-xs text-slate-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {result.ownerShares.map((s: any, i: number) => (
                <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/20">
                  <td className="px-5 py-2.5 text-slate-200">{s.partnerName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded ${s.role === "landowner" ? "bg-amber-900/30 text-amber-300" : s.role === "developer" ? "bg-blue-900/30 text-blue-300" : "bg-slate-700 text-slate-400"}`}>
                      {s.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">{pct(s.ownershipPct)}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-emerald-400">{fmt(s.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900/60">
              <tr>
                <td colSpan={3} className="px-5 py-2.5 text-xs text-slate-500 font-medium">Landowner total / Developer total</td>
                <td className="px-5 py-2.5 text-right">
                  <span className="text-amber-400 font-mono text-sm">{fmt(result.landownerTotal)}</span>
                  <span className="text-slate-600 mx-2">/</span>
                  <span className="text-blue-400 font-mono text-sm">{fmt(result.developerTotal)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-4 text-sm text-amber-400">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          No ownership shares found. Add verified contributions or set ownership shares on the agreement to compute per-partner amounts.
        </div>
      )}

      {/* Warnings */}
      <WarningList warnings={result.warnings} />
    </div>
  );
}

// ── 50% Revenue model waterfall ────────────────────────────────────────────

function FiftyPercentWaterfall({ result }: { result: any }) {
  return (
    <div className="space-y-3">
      {/* Split layout */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 text-center text-sm font-semibold text-slate-300">
            Gross Revenue
          </div>
          <span className="text-2xl font-bold text-emerald-400">{fmt(result.grossRevenue)}</span>
        </div>

        <div className="flex items-stretch gap-3">
          {/* Landowner side */}
          <div className="flex-1 bg-amber-950/20 border border-amber-800/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Landowner Side</p>
              <span className="text-xs text-amber-500">{pct(result.splitPctLandowner)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Gross Share</span>
                <span className="font-mono text-amber-300">{fmt(result.landownerGross)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-400">− Operational Cost</span>
                <span className="font-mono text-red-400">{fmt(result.operationalCost)}</span>
              </div>
              <div className="border-t border-amber-800/30 pt-2 flex justify-between font-semibold">
                <span className="text-white">Net to Landowner</span>
                <span className="font-mono text-amber-300 text-base">{fmt(result.landownerNet)}</span>
              </div>
            </div>
          </div>

          {/* Split arrow */}
          <div className="flex flex-col items-center justify-center text-slate-600 text-xs gap-1 shrink-0">
            <ArrowRight className="w-4 h-4 rotate-180" />
            <span className="text-[10px]">split</span>
            <ArrowRight className="w-4 h-4" />
          </div>

          {/* Economic participant pool */}
          <div className="flex-1 bg-blue-950/20 border border-blue-800/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Economic Pool</p>
              <span className="text-xs text-blue-500">{pct(result.splitPctDeveloper)}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Gross Share</span>
                <span className="font-mono text-blue-300">{fmt(result.participantPoolGross)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 text-xs italic">Costs do not apply</span>
                <span className="font-mono text-slate-600">—</span>
              </div>
              <div className="border-t border-blue-800/30 pt-2 flex justify-between font-semibold">
                <span className="text-white">Net to Pool</span>
                <span className="font-mono text-blue-300 text-base">{fmt(result.participantPoolNet)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Key note */}
        <div className="mt-4 bg-slate-800/40 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-400" />
          {result.note}
        </div>
      </div>

      {/* Warnings */}
      <WarningList warnings={result.warnings} />
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────

function WaterfallRow({
  label,
  value,
  color,
  symbol,
  bold,
}: {
  label: string;
  value: number;
  color: string;
  symbol?: string;
  bold?: boolean;
}) {
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

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div key={i} className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {w}
        </div>
      ))}
    </div>
  );
}

function ownershipSourceLabel(source: string): string {
  const MAP: Record<string, string> = {
    frozen_snapshot: "Frozen Ownership Snapshot",
    agreement_shares: "Agreement Stated Shares",
    live_calculation: "Live Calculation (Not Frozen)",
    manual: "Manually Entered",
  };
  return MAP[source] ?? source;
}

// ── History item ──────────────────────────────────────────────────────────

function HistoryItem({
  preview,
  expanded,
  onToggle,
  onConfirm,
  onArchive,
  canAdmin,
}: {
  preview: DistributionPreviewType;
  expanded: boolean;
  onToggle: () => void;
  onConfirm: (id: string) => void;
  onArchive: (id: string) => void;
  canAdmin: boolean;
}) {
  const result = preview.distributionResult as any;
  const isContribution = result?.model === "contribution";

  return (
    <div className={`border border-slate-800 rounded-xl overflow-hidden ${preview.status === "confirmed" ? "border-emerald-900/40" : ""}`}>
      <div
        className="flex items-center gap-4 px-5 py-3 bg-slate-900/40 cursor-pointer hover:bg-slate-800/40 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-200 text-sm">{preview.periodLabel}</span>
            <ModelBadge model={preview.accountingModel} />
            <StatusBadge status={preview.status} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
            <span>Gross: {fmt(preview.grossRevenue)}</span>
            <span>Op. Cost: {fmt(preview.operationalCost)}</span>
            {preview.lcaAmount > 0 && <span>LCA: {fmt(preview.lcaAmount)}</span>}
            {isContribution ? (
              <span className="text-sky-400">Pool: {fmt(result?.distributablePool ?? 0)}</span>
            ) : (
              <>
                <span className="text-amber-400">L: {fmt(result?.landownerNet ?? 0)}</span>
                <span className="text-blue-400">P: {fmt(result?.participantPoolNet ?? 0)}</span>
              </>
            )}
            {preview.calculatedByName && (
              <span>by {preview.calculatedByName}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canAdmin && preview.status === "draft" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onConfirm(preview.id); }}
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 h-7 px-2 text-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onArchive(preview.id); }}
                className="text-slate-400 hover:text-red-400 hover:bg-red-900/20 h-7 px-2 text-xs"
              >
                <Archive className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 py-4 bg-slate-950/30 border-t border-slate-800">
          {isContribution ? (
            <ContributionWaterfall result={result} />
          ) : (
            <FiftyPercentWaterfall result={result} />
          )}
          {preview.notes && (
            <div className="mt-3 text-xs text-slate-500 italic border-t border-slate-800 pt-3">
              Notes: {preview.notes}
            </div>
          )}
          {preview.confirmedAt && (
            <div className="mt-2 text-xs text-slate-500">
              Confirmed on {new Date(preview.confirmedAt).toLocaleDateString("en-IN")} by {preview.confirmedByName}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function DistributionPreviewPage() {
  const { role } = useRole();
  const qc = useQueryClient();

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formProjectId, setFormProjectId] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodYear, setPeriodYear] = useState<string>("");
  const [grossRevenue, setGrossRevenue] = useState<string>("");
  const [operationalCost, setOperationalCost] = useState<string>("0");
  const [lcaAmount, setLcaAmount] = useState<string>("0");
  const [lcaSource, setLcaSource] = useState<"manual" | "ledger">("manual");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data: projects = [] } = useListProjects();

  const activeProjectId = selectedProjectId || "";
  const lcaProjectId = formProjectId || selectedProjectId;

  const { data: previewsPage, isLoading: previewsLoading } = useListDistributionPreviews(
    activeProjectId ? { projectId: activeProjectId } : {},
    { query: { enabled: !!activeProjectId, queryKey: getListDistributionPreviewsQueryKey(activeProjectId ? { projectId: activeProjectId } : {}) } },
  );
  const previews = previewsPage?.previews ?? [];

  const { data: lcaData } = useLookupLcaForDistribution(
    { projectId: lcaProjectId },
    { query: { enabled: !!lcaProjectId && lcaSource === "ledger", queryKey: getLookupLcaForDistributionQueryKey({ projectId: lcaProjectId }) } },
  );

  const createMutation = useCreateDistributionPreview();
  const confirmMutation = useConfirmDistributionPreview();
  const archiveMutation = useArchiveDistributionPreview();

  const isAdmin = role === "admin";
  const canUse = role === "admin" || role === "developer";

  if (!canUse) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Distribution preview is restricted to admins and developers.</p>
      </div>
    );
  }

  function invalidatePreviews() {
    qc.invalidateQueries({ queryKey: getListDistributionPreviewsQueryKey({ projectId: activeProjectId }) });
  }

  async function handleCreate() {
    setFormError(null);
    if (!formProjectId && !selectedProjectId) {
      setFormError("Select a project first.");
      return;
    }
    if (!periodLabel.trim()) {
      setFormError("Period label is required.");
      return;
    }
    const grev = parseFloat(grossRevenue);
    if (isNaN(grev) || grev < 0) {
      setFormError("Gross revenue must be a valid number.");
      return;
    }

    try {
      await createMutation.mutateAsync({
        data: {
          projectId: formProjectId || selectedProjectId,
          periodLabel: periodLabel.trim(),
          periodYear: periodYear ? parseInt(periodYear) : undefined,
          grossRevenue: grev,
          operationalCost: parseFloat(operationalCost) || 0,
          lcaAmount: parseFloat(lcaAmount) || 0,
          lcaSource,
          notes: notes.trim() || undefined,
        },
      });
      setShowForm(false);
      setPeriodLabel("");
      setPeriodYear("");
      setGrossRevenue("");
      setOperationalCost("0");
      setLcaAmount("0");
      setNotes("");
      if (!selectedProjectId) setSelectedProjectId(formProjectId);
      invalidatePreviews();
    } catch (e: any) {
      setFormError(e?.response?.data?.error ?? "Failed to create preview.");
    }
  }

  async function handleConfirm(id: string) {
    try {
      await confirmMutation.mutateAsync({ id });
      invalidatePreviews();
    } catch (e: any) {
      console.error("Confirm failed", e);
    }
  }

  async function handleArchive(id: string) {
    try {
      await archiveMutation.mutateAsync({ id });
      invalidatePreviews();
    } catch (e: any) {
      console.error("Archive failed", e);
    }
  }

  const draftCount = previews.filter((p) => p.status === "draft").length;
  const confirmedCount = previews.filter((p) => p.status === "confirmed").length;

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg border border-blue-700/40">
              <PieChart className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Distribution Preview</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Settlement guidance — model-aware distribution calculations. No actual payments.
              </p>
            </div>
          </div>
          <Button
            onClick={() => { setFormProjectId(selectedProjectId); setShowForm(true); }}
            className="bg-blue-700 hover:bg-blue-600 text-white"
          >
            <Calculator className="w-4 h-4 mr-2" />
            New Preview
          </Button>
        </div>

        {/* Model explanation strip */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ModelBadge model="contribution" />
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-mono">Revenue</span>
                <Minus className="w-3 h-3 text-red-400" />
                <span>Op. Cost</span>
                <Minus className="w-3 h-3 text-red-400" />
                <span>LCA</span>
                <Equal className="w-3 h-3 text-sky-400" />
                <span className="text-sky-400 font-semibold">Pool</span>
              </div>
              <p className="text-slate-500">Pool split by frozen ownership percentages per partner.</p>
            </div>
          </div>
          <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ModelBadge model="fifty_percent_revenue" />
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-mono">Revenue</span>
                <ArrowRight className="w-3 h-3" />
                <span className="text-amber-400">50% L</span>
                <span className="text-slate-600">|</span>
                <span className="text-blue-400">50% Pool</span>
              </div>
              <p className="text-slate-500">Op. costs borne entirely by landowner side. Pool is untouched.</p>
            </div>
          </div>
        </div>

        {/* Project selector */}
        <div className="flex items-center gap-3">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-72">
              <SelectValue placeholder="Select a project to view previews" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              {projects.map((p: Project) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {activeProjectId && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="bg-amber-900/30 text-amber-400 border border-amber-800/30 px-2 py-0.5 rounded">{draftCount} draft</span>
              <span className="bg-emerald-900/30 text-emerald-400 border border-emerald-800/30 px-2 py-0.5 rounded">{confirmedCount} confirmed</span>
            </div>
          )}
        </div>

        {/* Preview history */}
        {!activeProjectId ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-12 text-center text-slate-500">
            <PieChart className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Select a project to view its distribution previews</p>
          </div>
        ) : previewsLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading previews…
          </div>
        ) : previews.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-12 text-center text-slate-500">
            <Calculator className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No distribution previews yet for this project</p>
            <Button
              onClick={() => { setFormProjectId(selectedProjectId); setShowForm(true); }}
              variant="outline"
              size="sm"
              className="mt-4 border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Create first preview
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {previews.map((p: DistributionPreviewType) => (
              <HistoryItem
                key={p.id}
                preview={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onConfirm={handleConfirm}
                onArchive={handleArchive}
                canAdmin={isAdmin}
              />
            ))}
          </div>
        )}
      </div>

      {/* New Preview Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-950 border-slate-700 text-slate-200 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-400" />
              New Distribution Preview
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Project */}
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs">Project</Label>
              <Select value={formProjectId || selectedProjectId} onValueChange={setFormProjectId}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  {projects.map((p: Project) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">The accounting model (contribution vs 50%) is read from the linked agreement's profile.</p>
            </div>

            {/* Period */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs">Period Label *</Label>
                <Input
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  placeholder="e.g. 2024-25 Q1"
                  className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs">Year</Label>
                <Input
                  value={periodYear}
                  onChange={(e) => setPeriodYear(e.target.value)}
                  placeholder="e.g. 2024"
                  type="number"
                  className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Financials */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs">Gross Revenue (₹) *</Label>
                <Input
                  value={grossRevenue}
                  onChange={(e) => setGrossRevenue(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs">Operational Cost (₹)</Label>
                <Input
                  value={operationalCost}
                  onChange={(e) => setOperationalCost(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* LCA */}
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs">LCA Amount (₹) — contribution model only</Label>
              <div className="flex gap-2">
                <Input
                  value={lcaAmount}
                  onChange={(e) => setLcaAmount(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 flex-1"
                />
                <Select value={lcaSource} onValueChange={(v) => setLcaSource(v as "manual" | "ledger")}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-300 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="ledger">From Ledger</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {lcaSource === "ledger" && lcaData && (
                <p className="text-xs text-amber-400">
                  LCA outstanding balance: {fmt(lcaData.totalBalance)}
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setLcaAmount(String(lcaData.totalBalance))}
                  >
                    Use this
                  </button>
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Period context, data sources, remarks…"
                className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16"
              />
            </div>

            {formError && (
              <p className="text-red-400 text-sm bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowForm(false)} className="text-slate-400">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="bg-blue-700 hover:bg-blue-600 text-white"
            >
              {createMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Calculating…</>
              ) : (
                <><Calculator className="w-4 h-4 mr-2" /> Calculate</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
