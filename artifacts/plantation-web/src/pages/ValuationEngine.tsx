/**
 * ValuationEngine.tsx
 *
 * Ownership Transfer Valuation Engine
 *
 * Formula v1 (fixed):
 *   Share Value = I × (1 − (1.20)^(−N)) / 0.20
 *
 *   I = average net profit of up to 3 most recent post-maturity years
 *   N = max(1, 25 − post-maturity project age)
 *   r = 20% (fixed discount rate)
 *   Horizon = 25 years (guidance only — project may continue indefinitely)
 *
 * Views:
 *   1. Calculator  — live formula preview (no save)
 *   2. Saved Runs  — list + detail with override support
 *   3. Profit Records — annual profit data management (import + manual)
 */

import { useState, useMemo, useCallback } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListProjects,
  useGetValuationPreview,
  useListValuationRuns,
  useCreateValuationRun,
  useUpdateValuationRun,
  useDeleteValuationRun,
  useGetValuationRun,
  useListValuationProfitRecords,
  useCreateValuationProfitRecord,
  useUpdateValuationProfitRecord,
  useDeleteValuationProfitRecord,
  useImportValuationProfitRecords,
  getListValuationRunsQueryKey,
  getGetValuationPreviewQueryKey,
  getListValuationProfitRecordsQueryKey,
  getGetValuationRunQueryKey,
} from "@workspace/api-client-react";
import type { Project, ValuationRun, ValuationProfitRecord } from "@workspace/api-client-react";
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
import {
  Scale,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronRight,
  Download,
  Lock,
  ShieldAlert,
  Banknote,
  Calculator,
  TrendingUp,
  Database,
  FileText,
  BarChart3,
  Layers,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

// ── Formatting ─────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtShort = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  return fmt(n);
};

const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

function num(v: unknown) {
  return parseFloat(String(v ?? "0")) || 0;
}

// ── Formula display ────────────────────────────────────────────────────────

function FormulaBox({
  I,
  N,
  r = 0.2,
  annuityFactor,
  projectGrossValue,
  shareFraction,
  shareValue,
  isHorizonExceeded,
}: {
  I: number;
  N: number;
  r?: number;
  annuityFactor: number;
  projectGrossValue: number;
  shareFraction?: number | null;
  shareValue?: number | null;
  isHorizonExceeded: boolean;
}) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 font-mono text-sm space-y-2">
      <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-3 font-sans">
        Formula v1 — Present Value of Annuity
      </p>

      {/* Step 1: inputs */}
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-48">I (avg annual profit)</span>
          <span className="text-emerald-400">{fmt(I)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-48">N (remaining life)</span>
          <span className={`${isHorizonExceeded ? "text-amber-400" : "text-blue-400"}`}>
            {N.toFixed(2)} yrs
            {isHorizonExceeded && <span className="text-amber-500 ml-2">(horizon exceeded — floored at 1)</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-48">r (discount rate)</span>
          <span className="text-slate-400">{(r * 100).toFixed(0)}% (fixed)</span>
        </div>
      </div>

      <div className="border-t border-slate-800 pt-3 mt-3">
        {/* Full formula */}
        <p className="text-slate-400 text-xs mb-2">
          Project Value = I × (1 − (1 + r)
          <sup>−N</sup>) ÷ r
        </p>
        <p className="text-slate-300 text-xs">
          = {fmt(I)} × (1 − 1.20<sup>−{N.toFixed(2)}</sup>) ÷ 0.20
        </p>
        <p className="text-slate-300 text-xs mt-1">
          = {fmt(I)} × {annuityFactor.toFixed(6)}
        </p>
        <p className="text-white font-bold text-base mt-2">
          = {fmt(projectGrossValue)}
        </p>
      </div>

      {shareFraction != null && shareValue != null && (
        <div className="border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-400">
            Share Value ({fmtPct(shareFraction)} × {fmt(projectGrossValue)})
          </p>
          <p className="text-emerald-400 font-bold text-xl mt-1">{fmt(shareValue)}</p>
        </div>
      )}
    </div>
  );
}

// ── Status badges ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-slate-800 text-slate-400 border-slate-700",
    final: "bg-emerald-900/30 text-emerald-400 border-emerald-800/40",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${map[status] ?? "bg-slate-800 text-slate-400 border-slate-700"}`}>
      {status}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return source === "fifty_pct_session" ? (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/30">
      Session
    </span>
  ) : (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
      Manual
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-400">{label}</Label>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="p-2 bg-blue-900/20 border border-blue-800/30 rounded-lg shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-blue-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyBox({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="py-12 text-center">
      <Icon className="w-8 h-8 mx-auto mb-3 opacity-20" />
      <p className="text-slate-500 text-sm">{label}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  color = "text-white",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function ValuationEngine() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const canEdit = role === "admin" || role === "developer";

  const [tab, setTab] = useState<"calculator" | "runs" | "records">("calculator");

  // ── Calculator state ────────────────────────────────────────────────
  const [calcProjectId, setCalcProjectId] = useState("");
  const [calcSharePct, setCalcSharePct] = useState("");

  // ── Runs state ──────────────────────────────────────────────────────
  const [runsProjectId, setRunsProjectId] = useState("all");
  const [runsStatus, setRunsStatus] = useState("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showNewRunForm, setShowNewRunForm] = useState(false);
  const [newRunProjectId, setNewRunProjectId] = useState("");
  const [newRunSharePct, setNewRunSharePct] = useState("");
  const [newRunManualI, setNewRunManualI] = useState("");
  const [newRunManualN, setNewRunManualN] = useState("");
  const [newRunNotes, setNewRunNotes] = useState("");
  const [newRunStatus, setNewRunStatus] = useState<"draft" | "final">("draft");
  const [newRunError, setNewRunError] = useState<string | null>(null);

  // Override state
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overridePrice, setOverridePrice] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // ── Records state ───────────────────────────────────────────────────
  const [recProjectId, setRecProjectId] = useState("all");
  const [showRecForm, setShowRecForm] = useState(false);
  const [recEditId, setRecEditId] = useState<string | null>(null);
  const [recYear, setRecYear] = useState("");
  const [recGross, setRecGross] = useState("");
  const [recOpCost, setRecOpCost] = useState("");
  const [recLca, setRecLca] = useState("");
  const [recNet, setRecNet] = useState("");
  const [recPostMaturity, setRecPostMaturity] = useState(false);
  const [recNotes, setRecNotes] = useState("");
  const [recProjectForNew, setRecProjectForNew] = useState("");
  const [recError, setRecError] = useState<string | null>(null);
  const [importProjectId, setImportProjectId] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  // ── Data fetches ────────────────────────────────────────────────────

  const { data: projects = [] } = useListProjects();

  const { data: preview, isLoading: previewLoading } = useGetValuationPreview(
    { projectId: calcProjectId, sharePct: calcSharePct ? parseFloat(calcSharePct) : undefined },
    {
      query: {
        enabled: !!calcProjectId,
        queryKey: getGetValuationPreviewQueryKey({ projectId: calcProjectId, sharePct: calcSharePct ? parseFloat(calcSharePct) : undefined }),
      },
    },
  );

  const runsPid = runsProjectId === "all" ? undefined : runsProjectId;
  const runsSt = runsStatus === "all" ? undefined : runsStatus;
  const { data: runsPage, isLoading: runsLoading } = useListValuationRuns(
    { projectId: runsPid, status: runsSt as any },
    {
      query: {
        enabled: tab === "runs",
        queryKey: getListValuationRunsQueryKey({ projectId: runsPid, status: runsSt as any }),
      },
    },
  );
  const runs = runsPage?.runs ?? [];

  const { data: runDetail, isLoading: runDetailLoading } = useGetValuationRun(
    selectedRunId ?? "",
    {
      query: {
        enabled: !!selectedRunId,
        queryKey: getGetValuationRunQueryKey(selectedRunId ?? ""),
      },
    },
  );

  const recPid = recProjectId === "all" ? undefined : recProjectId;
  const { data: recsPage, isLoading: recsLoading } = useListValuationProfitRecords(
    { projectId: recPid },
    {
      query: {
        enabled: tab === "records",
        queryKey: getListValuationProfitRecordsQueryKey({ projectId: recPid }),
      },
    },
  );
  const records = recsPage?.records ?? [];

  // ── Mutations ───────────────────────────────────────────────────────

  const createRunMut = useCreateValuationRun();
  const updateRunMut = useUpdateValuationRun();
  const deleteRunMut = useDeleteValuationRun();
  const createRecMut = useCreateValuationProfitRecord();
  const updateRecMut = useUpdateValuationProfitRecord();
  const deleteRecMut = useDeleteValuationProfitRecord();
  const importMut = useImportValuationProfitRecords();

  // ── Derived values ──────────────────────────────────────────────────

  const calcNetFromFields = useMemo(() => {
    const g = parseFloat(recGross) || 0;
    const o = parseFloat(recOpCost) || 0;
    const l = parseFloat(recLca) || 0;
    return Math.max(0, g - o - l);
  }, [recGross, recOpCost, recLca]);

  // Auto-fill net profit from breakdown
  const autoFillNet = useCallback(() => {
    setRecNet(calcNetFromFields.toFixed(2));
  }, [calcNetFromFields]);

  // ── Handlers ────────────────────────────────────────────────────────

  async function handleCreateRun() {
    setNewRunError(null);
    if (!newRunProjectId) return setNewRunError("Select a project.");
    try {
      const res = await createRunMut.mutateAsync({
        data: {
          projectId: newRunProjectId,
          shareFraction: newRunSharePct ? parseFloat(newRunSharePct) / 100 : undefined,
          manualAvgAnnualProfit: newRunManualI ? parseFloat(newRunManualI) : undefined,
          manualPostMaturityYears: newRunManualN ? parseFloat(newRunManualN) : undefined,
          notes: newRunNotes.trim() || undefined,
          status: newRunStatus,
        },
      });
      const rid = (res as any)?.run?.id;
      qc.invalidateQueries({ queryKey: getListValuationRunsQueryKey({}) });
      setShowNewRunForm(false);
      setNewRunProjectId("");
      setNewRunSharePct("");
      setNewRunManualI("");
      setNewRunManualN("");
      setNewRunNotes("");
      if (rid) setSelectedRunId(rid);
    } catch (e: any) {
      setNewRunError(e?.response?.data?.error ?? "Failed to create valuation run.");
    }
  }

  async function handleUpdateOverride() {
    setOverrideError(null);
    if (!selectedRunId) return;
    try {
      await updateRunMut.mutateAsync({
        id: selectedRunId,
        data: {
          finalPriceOverride: overridePrice ? parseFloat(overridePrice) : null,
          overrideReason: overrideReason.trim() || null,
        },
      });
      qc.invalidateQueries({ queryKey: getGetValuationRunQueryKey(selectedRunId) });
      qc.invalidateQueries({ queryKey: getListValuationRunsQueryKey({}) });
      setShowOverrideForm(false);
    } catch (e: any) {
      setOverrideError(e?.response?.data?.error ?? "Failed to update override.");
    }
  }

  async function handleMarkFinal(runId: string) {
    await updateRunMut.mutateAsync({ id: runId, data: { status: "final" } });
    qc.invalidateQueries({ queryKey: getGetValuationRunQueryKey(runId) });
    qc.invalidateQueries({ queryKey: getListValuationRunsQueryKey({}) });
  }

  async function handleDeleteRun(runId: string) {
    await deleteRunMut.mutateAsync({ id: runId });
    qc.invalidateQueries({ queryKey: getListValuationRunsQueryKey({}) });
    if (selectedRunId === runId) setSelectedRunId(null);
  }

  function resetRecForm() {
    setRecEditId(null);
    setRecYear("");
    setRecGross("");
    setRecOpCost("");
    setRecLca("");
    setRecNet("");
    setRecPostMaturity(false);
    setRecNotes("");
    setRecProjectForNew("");
    setRecError(null);
    setShowRecForm(false);
  }

  function openRecEdit(r: ValuationProfitRecord) {
    setRecEditId(r.id);
    setRecYear(String(r.periodYear));
    setRecGross(r.grossRevenue ?? "");
    setRecOpCost(r.operationalCost ?? "");
    setRecLca(r.lcaAmount ?? "");
    setRecNet(String(r.netProfit));
    setRecPostMaturity(r.isPostMaturity);
    setRecNotes(r.notes ?? "");
    setRecProjectForNew(r.projectId);
    setRecError(null);
    setShowRecForm(true);
  }

  async function handleSaveRec() {
    setRecError(null);
    const year = parseInt(recYear);
    const net = parseFloat(recNet);
    if (!year || year < 1990 || year > 2100) return setRecError("Enter a valid year (1990–2100).");
    if (isNaN(net)) return setRecError("Enter a valid net profit.");
    try {
      if (recEditId) {
        await updateRecMut.mutateAsync({
          id: recEditId,
          data: {
            periodYear: year,
            grossRevenue: recGross ? parseFloat(recGross) : undefined,
            operationalCost: recOpCost ? parseFloat(recOpCost) : undefined,
            lcaAmount: recLca ? parseFloat(recLca) : undefined,
            netProfit: net,
            isPostMaturity: recPostMaturity,
            notes: recNotes.trim() || undefined,
          },
        });
      } else {
        if (!recProjectForNew) return setRecError("Select a project.");
        await createRecMut.mutateAsync({
          data: {
            projectId: recProjectForNew,
            periodYear: year,
            grossRevenue: recGross ? parseFloat(recGross) : undefined,
            operationalCost: recOpCost ? parseFloat(recOpCost) : undefined,
            lcaAmount: recLca ? parseFloat(recLca) : undefined,
            netProfit: net,
            isPostMaturity: recPostMaturity,
            notes: recNotes.trim() || undefined,
          },
        });
      }
      qc.invalidateQueries({ queryKey: getListValuationProfitRecordsQueryKey({}) });
      resetRecForm();
    } catch (e: any) {
      setRecError(e?.response?.data?.error ?? "Failed to save profit record.");
    }
  }

  async function handleDeleteRec(id: string) {
    await deleteRecMut.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListValuationProfitRecordsQueryKey({}) });
  }

  async function handleImport() {
    if (!importProjectId) return;
    setImportLoading(true);
    try {
      const res = await importMut.mutateAsync({
        data: { projectId: importProjectId, autoMarkPostMaturity: true },
      });
      qc.invalidateQueries({ queryKey: getListValuationProfitRecordsQueryKey({}) });
      const r = res as any;
      alert(`Imported ${r?.imported ?? 0} records (${r?.skipped ?? 0} skipped — already exist).`);
    } finally {
      setImportLoading(false);
    }
  }

  // ── Guard ────────────────────────────────────────────────────────────

  if (!["admin", "developer", "landowner", "investor"].includes(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Restricted to admin, developer, landowner and investor roles.</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          {selectedRunId && tab === "runs" && (
            <button
              onClick={() => setSelectedRunId(null)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-2 bg-blue-900/30 rounded-lg border border-blue-700/40">
            <Scale className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Valuation Engine</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Ownership transfer pricing · Present-value annuity formula · 20% discount rate
            </p>
          </div>
        </div>

        {/* Formula strip */}
        <div className="bg-slate-900/30 border border-slate-800 rounded-xl px-5 py-3 mb-6 flex items-center gap-4 text-xs text-slate-400 flex-wrap font-mono">
          <span className="text-white">Share Value</span>
          <span className="text-slate-600">=</span>
          <span className="text-emerald-400">I</span>
          <span className="text-slate-600">×</span>
          <span className="text-blue-400">(1 − 1.20<sup>−N</sup>) / 0.20</span>
          <span className="text-slate-600 ml-4">·</span>
          <span className="font-sans text-slate-500">
            I = avg profit (≤3 post-maturity yrs) · N = 25 − project age · r = 20% fixed
          </span>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit mb-6">
          {([
            { id: "calculator", label: "Calculator", icon: Calculator },
            { id: "runs", label: "Saved Runs", icon: FileText },
            { id: "records", label: "Profit Records", icon: Database },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setSelectedRunId(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === id ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════
         * TAB: CALCULATOR
         * ══════════════════════════════════════════════ */}
        {tab === "calculator" && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              {/* Inputs */}
              <div className="col-span-1 bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-4">
                <SectionHeader icon={Calculator} title="Quick Preview" subtitle="Compute transfer pricing without saving." />

                <Field label="Project *">
                  <Select value={calcProjectId} onValueChange={setCalcProjectId}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                      {(projects as Project[]).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Share % being transferred (optional)">
                  <Input
                    type="number"
                    value={calcSharePct}
                    onChange={(e) => setCalcSharePct(e.target.value)}
                    placeholder="e.g. 30"
                    min="0"
                    max="100"
                    step="0.01"
                    className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                  />
                </Field>

                {calcProjectId && canEdit && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setShowNewRunForm(true);
                      setNewRunProjectId(calcProjectId);
                      setNewRunSharePct(calcSharePct);
                      setTab("runs");
                    }}
                    className="bg-blue-700 hover:bg-blue-600 text-white w-full text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Save as Valuation Run
                  </Button>
                )}
              </div>

              {/* Live formula */}
              <div className="col-span-2">
                {!calcProjectId ? (
                  <div className="h-full flex flex-col items-center justify-center py-16 bg-slate-900/20 border border-slate-800 rounded-xl">
                    <Scale className="w-10 h-10 opacity-20 mb-3" />
                    <p className="text-slate-500 text-sm">Select a project to see live formula preview.</p>
                  </div>
                ) : previewLoading ? (
                  <div className="h-full flex items-center justify-center py-16 bg-slate-900/20 border border-slate-800 rounded-xl">
                    <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
                  </div>
                ) : preview ? (
                  <div className="space-y-4">
                    {/* Warnings */}
                    {preview.warnings.map((w: string, i: number) => (
                      <div key={i} className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2.5 text-xs text-amber-400 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {w}
                      </div>
                    ))}

                    {/* KPIs */}
                    <div className="grid grid-cols-4 gap-3">
                      <KpiCard
                        label="Post-Maturity Age"
                        value={`${num(preview.postMaturityYears).toFixed(1)} yrs`}
                        color="text-slate-300"
                        sub={preview.maturityDate ? `Since ${preview.maturityDate}` : "No maturity date"}
                      />
                      <KpiCard
                        label="Remaining Life (N)"
                        value={`${num(preview.remainingLife).toFixed(1)} yrs`}
                        color={preview.isHorizonExceeded ? "text-amber-400" : "text-blue-400"}
                        sub="25 yr horizon"
                      />
                      <KpiCard
                        label="Avg Annual Profit (I)"
                        value={fmtShort(num(preview.avgAnnualProfit))}
                        color="text-emerald-400"
                        sub={`${preview.profitYearsUsed} yr avg`}
                      />
                      <KpiCard
                        label="Project Value"
                        value={fmtShort(num(preview.projectGrossValue))}
                        color="text-white"
                        sub="100% stake"
                      />
                    </div>

                    {/* Formula box */}
                    <FormulaBox
                      I={num(preview.avgAnnualProfit)}
                      N={num(preview.remainingLife)}
                      annuityFactor={(1 - Math.pow(1.2, -num(preview.remainingLife))) / 0.2}
                      projectGrossValue={num(preview.projectGrossValue)}
                      shareFraction={calcSharePct ? parseFloat(calcSharePct) / 100 : null}
                      shareValue={preview.shareValue ?? null}
                      isHorizonExceeded={preview.isHorizonExceeded}
                    />

                    {/* Profit history chart */}
                    {preview.profitYearData.length > 0 && (
                      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">
                          Profit History Used in Calculation
                        </p>
                        <ResponsiveContainer width="100%" height={150}>
                          <BarChart data={(preview.profitYearData as any[]).map((d: any) => ({ year: d.year, profit: d.netProfit }))}>
                            <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tickFormatter={(v) => fmtShort(v)} tick={{ fill: "#94a3b8", fontSize: 10 }} width={70} />
                            <Tooltip
                              formatter={(v: number) => [fmt(v), "Net Profit"]}
                              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
                            />
                            <Bar dataKey="profit" fill="#34d399" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                        <div className="mt-2 bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-3 py-2 flex justify-between text-xs">
                          <span className="text-slate-400">Average (I)</span>
                          <span className="font-mono font-bold text-emerald-400">{fmt(num(preview.avgAnnualProfit))}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * TAB: SAVED RUNS
         * ══════════════════════════════════════════════ */}
        {tab === "runs" && !selectedRunId && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Status filter */}
                <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                  {(["all", "draft", "final"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setRunsStatus(s)}
                      className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                        runsStatus === s ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {s === "all" ? "All" : s}
                    </button>
                  ))}
                </div>

                <Select value={runsProjectId} onValueChange={setRunsProjectId}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-56 h-8 text-xs">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="all">All projects</SelectItem>
                    {(projects as Project[]).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {runsLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
              </div>

              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => setShowNewRunForm(true)}
                  className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> New Valuation Run
                </Button>
              )}
            </div>

            {/* New run form */}
            {showNewRunForm && canEdit && (
              <div className="bg-slate-900/40 border border-blue-700/40 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-blue-300">New Valuation Run</p>
                  <button onClick={() => setShowNewRunForm(false)}>
                    <X className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Project *">
                    <Select value={newRunProjectId} onValueChange={setNewRunProjectId}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        {(projects as Project[]).map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Share % (optional)">
                    <Input
                      type="number"
                      value={newRunSharePct}
                      onChange={(e) => setNewRunSharePct(e.target.value)}
                      placeholder="e.g. 30"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </Field>
                </div>

                <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg px-3 py-2 text-xs text-blue-300 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Profit records and maturity date are auto-resolved from the database. Override manually only if needed.
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Override I — avg profit (₹, optional)">
                    <Input
                      type="number"
                      value={newRunManualI}
                      onChange={(e) => setNewRunManualI(e.target.value)}
                      placeholder="Auto from profit records"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                    />
                  </Field>
                  <Field label="Override N — post-maturity years (optional)">
                    <Input
                      type="number"
                      value={newRunManualN}
                      onChange={(e) => setNewRunManualN(e.target.value)}
                      placeholder="Auto from lifecycle history"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Notes">
                    <Textarea
                      value={newRunNotes}
                      onChange={(e) => setNewRunNotes(e.target.value)}
                      placeholder="Context, purpose…"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16 text-xs"
                    />
                  </Field>
                  <Field label="Status">
                    <Select value={newRunStatus} onValueChange={(v: "draft" | "final") => setNewRunStatus(v)}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                {newRunError && (
                  <p className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />{newRunError}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateRun}
                    disabled={createRunMut.isPending}
                    className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                  >
                    {createRunMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                    Compute & Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewRunForm(false)} className="text-slate-400 text-xs">
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Runs list */}
            {runs.length === 0 ? (
              <EmptyBox icon={FileText} label="No valuation runs yet. Create one to save a formula computation." />
            ) : (
              <div className="space-y-2">
                {runs.map((run: ValuationRun) => {
                  const pgv = num(run.projectGrossValue);
                  const sf = run.shareFraction ? num(run.shareFraction) : null;
                  const sv = run.shareValue ? num(run.shareValue) : null;
                  const override = run.finalPriceOverride ? num(run.finalPriceOverride) : null;
                  const displayPrice = override ?? sv ?? pgv;
                  return (
                    <div
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className="flex items-center gap-4 px-5 py-4 bg-slate-900/40 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 hover:bg-slate-800/40 transition-all group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <StatusBadge status={run.status} />
                          {override !== null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/30">
                              Overridden
                            </span>
                          )}
                          {run.calculatedByName && (
                            <span className="text-xs text-slate-500">by {run.calculatedByName}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                          <span>I = <span className="text-emerald-400 font-mono">{fmt(num(run.avgAnnualProfit))}</span></span>
                          <span>N = <span className="text-blue-400 font-mono">{num(run.remainingLife).toFixed(1)} yrs</span></span>
                          <span>Project = <span className="text-white font-mono">{fmt(pgv)}</span></span>
                          {sf !== null && (
                            <span>
                              {fmtPct(sf)} share = <span className={`font-mono font-semibold ${override ? "text-amber-400" : "text-emerald-400"}`}>{fmt(displayPrice)}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Run detail ── */}
        {tab === "runs" && selectedRunId && (
          <div className="space-y-4">
            {runDetailLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
              </div>
            ) : !runDetail ? (
              <EmptyBox icon={FileText} label="Valuation run not found." />
            ) : (
              <>
                {/* Run header */}
                <div className="flex items-center justify-between px-5 py-4 bg-slate-900/40 border border-slate-800 rounded-xl">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={(runDetail as any).run.status} />
                      {(runDetail as any).run.isHorizonExceeded && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/30">
                          Horizon Exceeded
                        </span>
                      )}
                      {(runDetail as any).run.finalPriceOverride && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/30">
                          Price Overridden
                        </span>
                      )}
                      {(runDetail as any).run.projectName && (
                        <span className="text-xs text-slate-500">{(runDetail as any).run.projectName}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Formula {(runDetail as any).run.formulaVersion} · by {(runDetail as any).run.calculatedByName ?? "—"} ·{" "}
                      {new Date((runDetail as any).run.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (runDetail as any).run.status === "draft" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMarkFinal((runDetail as any).run.id)}
                        className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 h-7 px-3 text-xs"
                      >
                        <Lock className="w-3 h-3 mr-1" /> Mark Final
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteRun((runDetail as any).run.id)}
                        className="text-slate-500 hover:text-red-400 hover:bg-red-900/20 h-7 w-7 p-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* KPI cards */}
                <div className="grid grid-cols-4 gap-3">
                  <KpiCard
                    label="Avg Annual Profit (I)"
                    value={fmt(num((runDetail as any).formulaBreakdown.I))}
                    color="text-emerald-400"
                    sub={`${(runDetail as any).run.profitYearsUsed} yr avg`}
                  />
                  <KpiCard
                    label="Remaining Life (N)"
                    value={`${num((runDetail as any).formulaBreakdown.N).toFixed(2)} yrs`}
                    color={(runDetail as any).run.isHorizonExceeded ? "text-amber-400" : "text-blue-400"}
                    sub="25 yr horizon"
                  />
                  <KpiCard
                    label="Annuity Factor"
                    value={(runDetail as any).formulaBreakdown.annuityFactor.toFixed(4)}
                    color="text-slate-300"
                    sub="(1−1.20⁻ᴺ)/0.20"
                  />
                  <KpiCard
                    label="Project Gross Value"
                    value={fmtShort(num((runDetail as any).formulaBreakdown.projectGrossValue))}
                    color="text-white"
                    sub="100% stake"
                  />
                </div>

                {/* Formula + pricing */}
                <div className="grid grid-cols-2 gap-4">
                  <FormulaBox
                    I={num((runDetail as any).formulaBreakdown.I)}
                    N={num((runDetail as any).formulaBreakdown.N)}
                    annuityFactor={(runDetail as any).formulaBreakdown.annuityFactor}
                    projectGrossValue={num((runDetail as any).formulaBreakdown.projectGrossValue)}
                    shareFraction={(runDetail as any).formulaBreakdown.shareFraction}
                    shareValue={(runDetail as any).formulaBreakdown.shareValue}
                    isHorizonExceeded={(runDetail as any).run.isHorizonExceeded}
                  />

                  {/* Pricing card */}
                  <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-4">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider">Transfer Pricing</p>

                    <div className="space-y-2 text-sm">
                      {(runDetail as any).formulaBreakdown.shareFraction && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Share fraction</span>
                          <span className="font-mono text-slate-300">{fmtPct((runDetail as any).formulaBreakdown.shareFraction)}</span>
                        </div>
                      )}
                      {(runDetail as any).formulaBreakdown.shareValue && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Formula share value</span>
                          <span className="font-mono text-slate-300">{fmt(num((runDetail as any).formulaBreakdown.shareValue))}</span>
                        </div>
                      )}
                      {(runDetail as any).run.finalPriceOverride && (
                        <div className="flex justify-between items-center border-t border-amber-800/20 pt-2">
                          <span className="text-amber-400 flex items-center gap-1">
                            <Pencil className="w-3 h-3" /> Override price
                          </span>
                          <span className="font-mono font-bold text-amber-300">{fmt(num((runDetail as any).run.finalPriceOverride))}</span>
                        </div>
                      )}
                      <div className="border-t border-slate-700 pt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-white font-medium">Final Transfer Price</span>
                          <span className="font-mono font-bold text-xl text-emerald-400">
                            {fmt(num((runDetail as any).formulaBreakdown.finalPrice))}
                          </span>
                        </div>
                        {(runDetail as any).formulaBreakdown.isOverridden && (
                          <p className="text-xs text-amber-400 mt-1">
                            Manual override applied. Reason: {(runDetail as any).run.overrideReason ?? "—"}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Disclaimer */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-500 flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-400" />
                      Valuation is guidance only. Final transfer price may be negotiated and overridden with written records.
                    </div>

                    {/* Override form */}
                    {canEdit && !showOverrideForm && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setOverridePrice(String((runDetail as any).run.finalPriceOverride ?? ""));
                          setOverrideReason((runDetail as any).run.overrideReason ?? "");
                          setShowOverrideForm(true);
                        }}
                        className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs w-full"
                      >
                        <Pencil className="w-3 h-3 mr-1.5" />
                        {(runDetail as any).run.finalPriceOverride ? "Edit Override" : "Set Manual Override"}
                      </Button>
                    )}

                    {showOverrideForm && canEdit && (
                      <div className="space-y-3 border border-amber-700/40 rounded-lg p-3 bg-amber-950/10">
                        <Field label="Override Price (₹)">
                          <Input
                            type="number"
                            value={overridePrice}
                            onChange={(e) => setOverridePrice(e.target.value)}
                            placeholder="Enter final agreed price"
                            className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                          />
                        </Field>
                        <Field label="Reason / Record Reference *">
                          <Textarea
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            placeholder="e.g. Negotiated price per dated agreement…"
                            className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16 text-xs"
                          />
                        </Field>
                        {overrideError && (
                          <p className="text-red-400 text-xs">{overrideError}</p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={handleUpdateOverride}
                            disabled={updateRunMut.isPending}
                            className="bg-amber-700 hover:bg-amber-600 text-white text-xs"
                          >
                            {updateRunMut.isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
                            Save Override
                          </Button>
                          {(runDetail as any).run.finalPriceOverride && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                await updateRunMut.mutateAsync({ id: selectedRunId!, data: { finalPriceOverride: null, overrideReason: null } });
                                qc.invalidateQueries({ queryKey: getGetValuationRunQueryKey(selectedRunId!) });
                                setShowOverrideForm(false);
                              }}
                              className="text-slate-400 text-xs"
                            >
                              <X className="w-3 h-3 mr-1" /> Clear
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setShowOverrideForm(false)} className="text-slate-400 text-xs">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Profit years used */}
                {((runDetail as any).run.profitYearData as any[])?.length > 0 && (
                  <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">
                      Profit Years Used in Calculation
                    </p>
                    <div className="space-y-2">
                      {((runDetail as any).run.profitYearData as any[]).map((d: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-sm px-3 py-2 bg-slate-800/40 rounded-lg">
                          <span className="text-slate-400 font-mono">{d.year}</span>
                          <span className="font-mono text-emerald-400">{fmt(d.netProfit)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-sm px-3 py-2 bg-emerald-950/20 border border-emerald-800/30 rounded-lg">
                        <span className="text-emerald-300 font-medium">Average (I)</span>
                        <span className="font-mono font-bold text-emerald-400">{fmt(num((runDetail as any).formulaBreakdown.I))}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {(runDetail as any).run.notes && (
                  <div className="bg-slate-900/30 border border-slate-800 rounded-lg px-4 py-3 text-xs text-slate-400">
                    <p className="text-slate-500 mb-1">Notes</p>
                    {(runDetail as any).run.notes}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * TAB: PROFIT RECORDS
         * ══════════════════════════════════════════════ */}
        {tab === "records" && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={recProjectId} onValueChange={setRecProjectId}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-64 h-8 text-xs">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="all">All projects</SelectItem>
                    {(projects as Project[]).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {recsLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
              </div>

              {canEdit && (
                <div className="flex items-center gap-2">
                  {/* Import from sessions */}
                  <div className="flex items-center gap-2">
                    <Select value={importProjectId} onValueChange={setImportProjectId}>
                      <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-48 h-8 text-xs">
                        <SelectValue placeholder="Project for import" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        {(projects as Project[]).map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleImport}
                      disabled={!importProjectId || importLoading}
                      className="border-blue-700/50 text-blue-400 hover:bg-blue-900/20 text-xs h-8"
                    >
                      {importLoading ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
                      Import Sessions
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => { resetRecForm(); setShowRecForm(true); }}
                    className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Record
                  </Button>
                </div>
              )}
            </div>

            {/* Import info */}
            <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg px-4 py-2.5 text-xs text-blue-300 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>Import Sessions</strong> pulls net profit figures from confirmed 50% Settlement sessions (gross − op cost − LCA).
                Records already imported are skipped. Mark records as <em>post-maturity</em> to include them in the valuation formula.
              </span>
            </div>

            {/* Add/edit form */}
            {showRecForm && canEdit && (
              <div className="bg-slate-900/40 border border-blue-700/40 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-blue-300">{recEditId ? "Edit Profit Record" : "Add Profit Record"}</p>
                  <button onClick={resetRecForm}><X className="w-4 h-4 text-slate-500 hover:text-slate-300" /></button>
                </div>

                {!recEditId && (
                  <Field label="Project *">
                    <Select value={recProjectForNew} onValueChange={setRecProjectForNew}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        {(projects as Project[]).map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Year *">
                    <Input
                      type="number"
                      value={recYear}
                      onChange={(e) => setRecYear(e.target.value)}
                      placeholder="e.g. 2023"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </Field>
                  <Field label="Net Profit (₹) * — used in formula">
                    <Input
                      type="number"
                      value={recNet}
                      onChange={(e) => setRecNet(e.target.value)}
                      placeholder="0.00"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                    />
                  </Field>
                </div>

                {/* Breakdown helpers */}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Gross Revenue (₹)">
                    <Input
                      type="number"
                      value={recGross}
                      onChange={(e) => setRecGross(e.target.value)}
                      placeholder="0"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                    />
                  </Field>
                  <Field label="Op. Cost (₹)">
                    <Input
                      type="number"
                      value={recOpCost}
                      onChange={(e) => setRecOpCost(e.target.value)}
                      placeholder="0"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                    />
                  </Field>
                  <Field label="LCA (₹)">
                    <Input
                      type="number"
                      value={recLca}
                      onChange={(e) => setRecLca(e.target.value)}
                      placeholder="0"
                      className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                    />
                  </Field>
                </div>

                {(recGross || recOpCost || recLca) && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-400">Computed net: <span className="font-mono text-emerald-400">{fmt(calcNetFromFields)}</span></span>
                    <button onClick={autoFillNet} className="text-blue-400 hover:text-blue-300 underline">Apply to Net Profit field</button>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recPostMaturity}
                      onChange={(e) => setRecPostMaturity(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-800"
                    />
                    <span className="text-xs text-slate-300">This year is post-maturity (eligible for valuation formula)</span>
                  </label>
                </div>

                <Field label="Notes (optional)">
                  <Input
                    value={recNotes}
                    onChange={(e) => setRecNotes(e.target.value)}
                    placeholder="Remarks…"
                    className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                  />
                </Field>

                {recError && (
                  <p className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />{recError}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveRec}
                    disabled={createRecMut.isPending || updateRecMut.isPending}
                    className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                  >
                    {(createRecMut.isPending || updateRecMut.isPending) ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
                    {recEditId ? "Update" : "Add Record"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={resetRecForm} className="text-slate-400 text-xs">Cancel</Button>
                </div>
              </div>
            )}

            {/* Records table */}
            {records.length === 0 ? (
              <EmptyBox
                icon={Database}
                label="No profit records yet. Import from confirmed settlement sessions or add manually."
              />
            ) : (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/60">
                      <th className="text-left px-4 py-2.5 text-xs text-slate-500">Year</th>
                      <th className="text-right px-3 py-2.5 text-xs text-slate-500">Gross Revenue</th>
                      <th className="text-right px-3 py-2.5 text-xs text-slate-500">Op. Cost</th>
                      <th className="text-right px-3 py-2.5 text-xs text-slate-500">LCA</th>
                      <th className="text-right px-4 py-2.5 text-xs text-slate-500">Net Profit (I)</th>
                      <th className="text-center px-3 py-2.5 text-xs text-slate-500">Post-Maturity</th>
                      <th className="text-left px-3 py-2.5 text-xs text-slate-500">Source</th>
                      {canEdit && <th className="w-16 px-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r: ValuationProfitRecord) => (
                      <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                        <td className="px-4 py-3 font-mono text-slate-300">{r.periodYear}</td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                          {r.grossRevenue ? fmt(num(r.grossRevenue)) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                          {r.operationalCost ? fmt(num(r.operationalCost)) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-slate-500">
                          {r.lcaAmount ? fmt(num(r.lcaAmount)) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-400">
                          {fmt(num(r.netProfit))}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {r.isPostMaturity ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          ) : (
                            <X className="w-3.5 h-3.5 text-slate-600 mx-auto" />
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <SourceBadge source={r.source} />
                        </td>
                        {canEdit && (
                          <td className="px-3 py-3">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => openRecEdit(r)} className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => handleDeleteRec(r.id)} className="p-1 rounded hover:bg-red-900/20 text-slate-500 hover:text-red-400">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Summary bar */}
                {records.filter((r: ValuationProfitRecord) => r.isPostMaturity).length > 0 && (
                  <div className="border-t border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-900/40">
                    <span className="text-xs text-slate-500">
                      {records.filter((r: ValuationProfitRecord) => r.isPostMaturity).length} post-maturity records
                    </span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-slate-500">
                        Top-3 avg (I) =
                        <span className="font-mono font-bold text-emerald-400 ml-1.5">
                          {fmt(
                            records
                              .filter((r: ValuationProfitRecord) => r.isPostMaturity)
                              .sort((a: ValuationProfitRecord, b: ValuationProfitRecord) => b.periodYear - a.periodYear)
                              .slice(0, 3)
                              .reduce((s: number, r: ValuationProfitRecord) => s + num(r.netProfit), 0) /
                              Math.min(3, records.filter((r: ValuationProfitRecord) => r.isPostMaturity).length)
                          )}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
