/**
 * FiftyPctSettlement.tsx
 *
 * 50% Revenue Model Settlement Engine — comprehensive page.
 *
 * Model:
 *   Gross Revenue ÷ 2  →  Landowner Side (50%) + Economic Participant Pool (50%)
 *   Landowner Side bears ALL operational costs + LCA  →  Landowner Net
 *   EPP is NEVER reduced by costs; distributed by verified economic participation.
 *   Land contribution itself does NOT count in EPP; only additional economic contributions.
 *
 * Views:
 *   1. New Session wizard (5 steps)
 *   2. Sessions list
 *   3. Session detail → sub-tabs: Split | EPP | Landowner | Analytics
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListProjects,
  useListFiftyPctSessions,
  useCreateFiftyPctSession,
  useUpdateFiftyPctSession,
  useConfirmFiftyPctSession,
  useArchiveFiftyPctSession,
  useGetFiftyPctSessionSummary,
  useListEppEntries,
  useCreateEppEntry,
  useUpdateEppEntry,
  useDeleteEppEntry,
  useLookupFiftyPctRevenue,
  useLookupFiftyPctLca,
  useLookupFiftyPctPartners,
  getListFiftyPctSessionsQueryKey,
  getGetFiftyPctSessionSummaryQueryKey,
  getListEppEntriesQueryKey,
  getLookupFiftyPctRevenueQueryKey,
  getLookupFiftyPctLcaQueryKey,
  getLookupFiftyPctPartnersQueryKey,
} from "@workspace/api-client-react";
import type {
  Project,
  FiftyPctSession,
  EppEntry,
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
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Info,
  Minus,
  Equal,
  Pencil,
  Trash2,
  Lock,
  ShieldAlert,
  Banknote,
  Users,
  Receipt,
  BarChart3,
  Calculator,
  Landmark,
  Layers,
  PieChart,
  TrendingDown,
  TrendingUp,
  X,
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

import { parseNumeric } from "@/lib/numeric";

const fmt = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (n: number) => `${Number(n).toFixed(2)}%`;

function num(v: unknown) {
  return parseNumeric(v as string | number | null | undefined);
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
  if (status === "archived") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-500 border border-slate-700">
        Archived
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-900/30 text-amber-400 border border-amber-800/40">
      Draft
    </span>
  );
}

// ── Contribution type badge ───────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  if (type === "landowner_additional") {
    return (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-sky-900/30 text-sky-400 border border-sky-800/30">
        Landowner+Additional
      </span>
    );
  }
  if (type === "external") {
    return (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-900/30 text-purple-400 border border-purple-800/30">
        External
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-900/30 text-green-400 border border-green-800/30">
      Economic
    </span>
  );
}

// ── Step wizard indicator ─────────────────────────────────────────────────

const WIZARD_STEPS = [
  { id: 1, label: "Setup", icon: BarChart3 },
  { id: 2, label: "Revenue", icon: Banknote },
  { id: 3, label: "Deductions", icon: Receipt },
  { id: 4, label: "Save", icon: Calculator },
  { id: 5, label: "EPP", icon: Users },
  { id: 6, label: "Review", icon: CheckCircle2 },
];

function WizardStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {WIZARD_STEPS.map((s, i) => {
        const done = s.id < step;
        const active = s.id === step;
        const Icon = s.icon;
        return (
          <div key={s.id} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                active
                  ? "bg-blue-900/40 border border-blue-700/50 text-blue-300"
                  : done
                  ? "bg-emerald-900/20 border border-emerald-800/30 text-emerald-400"
                  : "bg-slate-900/40 border border-slate-800 text-slate-600"
              }`}
            >
              {done ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Icon className="w-3.5 h-3.5" />
              )}
              {s.label}
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <ChevronRight className="w-3 h-3 text-slate-700" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 50/50 Split visual ────────────────────────────────────────────────────

function SplitVisual({ gross, opCost, lca }: { gross: number; opCost: number; lca: number }) {
  const half = Math.round((gross / 2) * 100) / 100;
  const landownerNet = Math.max(0, half - opCost - lca);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Landowner Side</span>
          <span className="ml-auto text-xs text-slate-500">50%</span>
        </div>
        <p className="font-mono text-2xl font-bold text-emerald-400 mb-3">{fmt(half)}</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1"><Minus className="w-2.5 h-2.5 text-red-400" /> Op. Cost</span>
            <span className="font-mono text-red-400">{fmt(opCost)}</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1"><Minus className="w-2.5 h-2.5 text-amber-400" /> LCA</span>
            <span className="font-mono text-amber-400">{fmt(lca)}</span>
          </div>
          <div className="border-t border-emerald-800/30 pt-1.5 mt-1.5 flex items-center justify-between">
            <span className="font-medium text-emerald-300">Net to Landowner</span>
            <span className="font-mono font-bold text-emerald-300 text-base">{fmt(landownerNet)}</span>
          </div>
        </div>
      </div>
      <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Participant Pool</span>
          <span className="ml-auto text-xs text-slate-500">50%</span>
        </div>
        <p className="font-mono text-2xl font-bold text-blue-400 mb-3">{fmt(half)}</p>
        <div className="bg-blue-900/10 border border-blue-800/20 rounded-lg px-3 py-2 text-xs text-blue-300">
          <p className="font-medium mb-1">Never reduced by costs</p>
          <p className="text-blue-400/60">Distributed by verified economic participation percentages only</p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function FiftyPctSettlement() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const canUse = role === "admin" || role === "developer";

  // Page state
  const [mode, setMode] = useState<"list" | "new" | "detail">("list");
  const [filterProjectId, setFilterProjectId] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "draft" | "confirmed" | "archived">("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"split" | "epp" | "landowner" | "analytics">("split");

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [wProjectId, setWProjectId] = useState("");
  const [wPeriodLabel, setWPeriodLabel] = useState("");
  const [wPeriodStart, setWPeriodStart] = useState("");
  const [wPeriodEnd, setWPeriodEnd] = useState("");
  const [wPeriodYear, setWPeriodYear] = useState("");
  const [wNotes, setWNotes] = useState("");
  const [wRevenueSource, setWRevenueSource] = useState<"sales_records" | "manual">("sales_records");
  const [wSelectedSaleIds, setWSelectedSaleIds] = useState<Set<string>>(new Set());
  const [wManualRevenue, setWManualRevenue] = useState("");
  const [wOpCost, setWOpCost] = useState("0");
  const [wLcaSource, setWLcaSource] = useState<"manual" | "ledger">("manual");
  const [wManualLca, setWManualLca] = useState("0");
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // EPP form state (step 5 and detail view)
  const [showEppForm, setShowEppForm] = useState(false);
  const [eppEditId, setEppEditId] = useState<string | null>(null);
  const [eppKey, setEppKey] = useState("");
  const [eppName, setEppName] = useState("");
  const [eppPct, setEppPct] = useState("");
  const [eppType, setEppType] = useState("economic_only");
  const [eppIsLandownerAdditional, setEppIsLandownerAdditional] = useState(false);
  const [eppNotes, setEppNotes] = useState("");
  const [eppError, setEppError] = useState<string | null>(null);

  // ── Data fetches ──────────────────────────────────────────────────────

  const { data: projects = [] } = useListProjects();

  const filterPid = filterProjectId === "all" ? undefined : filterProjectId;
  const filterSt = filterStatus === "all" ? undefined : filterStatus;
  const { data: sessionsPage, isLoading: sessionsLoading } = useListFiftyPctSessions(
    { projectId: filterPid, status: filterSt as any },
    {
      query: {
        enabled: mode === "list",
        queryKey: getListFiftyPctSessionsQueryKey({ projectId: filterPid, status: filterSt as any }),
      },
    },
  );
  const sessions = sessionsPage?.sessions ?? [];

  const { data: summary, isLoading: summaryLoading } = useGetFiftyPctSessionSummary(
    selectedSessionId ?? "",
    {
      query: {
        enabled: !!selectedSessionId && mode === "detail",
        queryKey: getGetFiftyPctSessionSummaryQueryKey(selectedSessionId ?? ""),
      },
    },
  );

  const { data: eppResult } = useListEppEntries(
    wizardSessionId ?? "",
    {
      query: {
        enabled: !!wizardSessionId && wizardStep === 5,
        queryKey: getListEppEntriesQueryKey(wizardSessionId ?? ""),
      },
    },
  );
  const wizardEppEntries = eppResult?.entries ?? [];

  // Wizard lookups
  const { data: revenueData, isLoading: revenueLoading } = useLookupFiftyPctRevenue(
    { projectId: wProjectId, from: wPeriodStart || undefined, to: wPeriodEnd || undefined },
    {
      query: {
        enabled: !!wProjectId && wizardStep === 2,
        queryKey: getLookupFiftyPctRevenueQueryKey({ projectId: wProjectId, from: wPeriodStart || undefined, to: wPeriodEnd || undefined }),
      },
    },
  );

  const { data: lcaData } = useLookupFiftyPctLca(
    { projectId: wProjectId },
    {
      query: {
        enabled: !!wProjectId && wizardStep === 3 && wLcaSource === "ledger",
        queryKey: getLookupFiftyPctLcaQueryKey({ projectId: wProjectId }),
      },
    },
  );

  const { data: partnersData } = useLookupFiftyPctPartners(
    { projectId: selectedSessionId ? (summary?.session.projectId ?? "") : wProjectId },
    {
      query: {
        enabled: !!(selectedSessionId ? summary?.session.projectId : wProjectId),
        queryKey: getLookupFiftyPctPartnersQueryKey({
          projectId: selectedSessionId ? (summary?.session.projectId ?? "") : wProjectId,
        }),
      },
    },
  );
  const partners = partnersData?.partners ?? [];

  // ── Mutations ─────────────────────────────────────────────────────────

  const createMutation = useCreateFiftyPctSession();
  const confirmMutation = useConfirmFiftyPctSession();
  const archiveMutation = useArchiveFiftyPctSession();
  const createEppMutation = useCreateEppEntry();
  const updateEppMutation = useUpdateEppEntry();
  const deleteEppMutation = useDeleteEppEntry();

  // ── Derived values ─────────────────────────────────────────────────────

  const linkedGross = useMemo(
    () =>
      (revenueData?.sales ?? [])
        .filter((s: any) => wSelectedSaleIds.has(s.id))
        .reduce((sum: number, s: any) => sum + parseNumeric(s.grossRevenue), 0),
    [revenueData, wSelectedSaleIds],
  );

  const effectiveGross = wRevenueSource === "sales_records"
    ? linkedGross
    : parseFloat(wManualRevenue) || 0;

  const effectiveLca = wLcaSource === "ledger"
    ? (lcaData?.totalBalance ?? 0)
    : parseFloat(wManualLca) || 0;

  const effectiveOpCost = parseFloat(wOpCost) || 0;

  // ── Wizard navigation ─────────────────────────────────────────────────

  function resetWizard() {
    setWizardStep(1);
    setWProjectId("");
    setWPeriodLabel("");
    setWPeriodStart("");
    setWPeriodEnd("");
    setWPeriodYear("");
    setWNotes("");
    setWRevenueSource("sales_records");
    setWSelectedSaleIds(new Set());
    setWManualRevenue("");
    setWOpCost("0");
    setWLcaSource("manual");
    setWManualLca("0");
    setWizardSessionId(null);
    setWizardError(null);
    setShowEppForm(false);
  }

  function goWizardNext() {
    setWizardError(null);
    if (wizardStep === 1) {
      if (!wProjectId) return setWizardError("Select a project.");
      if (!wPeriodLabel.trim()) return setWizardError("Enter a period label.");
      setWizardStep(2);
    } else if (wizardStep === 2) {
      if (wRevenueSource === "sales_records" && wSelectedSaleIds.size === 0) {
        return setWizardError("Select at least one confirmed sale or switch to manual.");
      }
      if (wRevenueSource === "manual" && !(parseFloat(wManualRevenue) > 0)) {
        return setWizardError("Enter gross revenue > 0.");
      }
      setWizardStep(3);
    } else if (wizardStep === 3) {
      setWizardStep(4);
    }
  }

  async function handleWizardSave() {
    setWizardError(null);
    try {
      const result = await createMutation.mutateAsync({
        data: {
          projectId: wProjectId,
          periodLabel: wPeriodLabel.trim(),
          periodStart: wPeriodStart || undefined,
          periodEnd: wPeriodEnd || undefined,
          periodYear: wPeriodYear ? parseInt(wPeriodYear) : undefined,
          grossRevenue: effectiveGross,
          revenueSource: wRevenueSource,
          linkedSaleIds: wRevenueSource === "sales_records" ? [...wSelectedSaleIds] : [],
          operationalCost: effectiveOpCost,
          lcaAmount: effectiveLca,
          lcaSource: wLcaSource,
          notes: wNotes.trim() || undefined,
        },
      });
      const sid = (result as any)?.session?.id;
      if (sid) {
        setWizardSessionId(sid);
        qc.invalidateQueries({ queryKey: getListFiftyPctSessionsQueryKey({}) });
        setWizardStep(5);
      }
    } catch (e: any) {
      setWizardError(e?.response?.data?.error ?? "Failed to save session.");
    }
  }

  function finishWizard() {
    const sid = wizardSessionId;
    resetWizard();
    if (sid) {
      setSelectedSessionId(sid);
      setDetailTab("split");
      setMode("detail");
    } else {
      setMode("list");
    }
  }

  // ── EPP helpers ───────────────────────────────────────────────────────

  function resetEppForm() {
    setEppEditId(null);
    setEppKey("");
    setEppName("");
    setEppPct("");
    setEppType("economic_only");
    setEppIsLandownerAdditional(false);
    setEppNotes("");
    setEppError(null);
    setShowEppForm(false);
  }

  function openEppEdit(e: EppEntry) {
    setEppEditId(e.id);
    setEppKey(e.participantKey);
    setEppName(e.participantName);
    setEppPct(String(e.participationPct));
    setEppType(e.contributionType);
    setEppIsLandownerAdditional(e.isLandownerAdditional);
    setEppNotes(e.notes ?? "");
    setEppError(null);
    setShowEppForm(true);
  }

  function handlePartnerSelect(partnerId: string) {
    const p = partners.find((x: any) => x.id === partnerId);
    if (p) {
      setEppKey(p.id);
      setEppName(p.name);
    }
  }

  async function handleEppSave(sessionId: string) {
    setEppError(null);
    if (!eppName.trim()) return setEppError("Participant name is required.");
    if (!(parseFloat(eppPct) > 0)) return setEppError("Participation % must be > 0.");

    try {
      if (eppEditId) {
        await updateEppMutation.mutateAsync({
          id: sessionId,
          entryId: eppEditId,
          data: {
            participantKey: eppKey || eppName,
            participantName: eppName,
            participationPct: parseFloat(eppPct),
            contributionType: eppType as any,
            isLandownerAdditional: eppIsLandownerAdditional,
            notes: eppNotes || undefined,
          },
        });
      } else {
        await createEppMutation.mutateAsync({
          id: sessionId,
          data: {
            participantKey: eppKey || eppName,
            participantName: eppName,
            participationPct: parseFloat(eppPct),
            contributionType: eppType as any,
            isLandownerAdditional: eppIsLandownerAdditional,
            notes: eppNotes || undefined,
          },
        });
      }
      qc.invalidateQueries({ queryKey: getListEppEntriesQueryKey(sessionId) });
      qc.invalidateQueries({ queryKey: getGetFiftyPctSessionSummaryQueryKey(sessionId) });
      resetEppForm();
    } catch (e: any) {
      setEppError(e?.response?.data?.error ?? "Failed to save EPP entry.");
    }
  }

  async function handleEppDelete(sessionId: string, entryId: string) {
    await deleteEppMutation.mutateAsync({ id: sessionId, entryId });
    qc.invalidateQueries({ queryKey: getListEppEntriesQueryKey(sessionId) });
    qc.invalidateQueries({ queryKey: getGetFiftyPctSessionSummaryQueryKey(sessionId) });
  }

  async function handleConfirm(sessionId: string) {
    await confirmMutation.mutateAsync({ id: sessionId });
    qc.invalidateQueries({ queryKey: getGetFiftyPctSessionSummaryQueryKey(sessionId) });
    qc.invalidateQueries({ queryKey: getListFiftyPctSessionsQueryKey({}) });
  }

  async function handleArchive(sessionId: string) {
    await archiveMutation.mutateAsync({ id: sessionId });
    qc.invalidateQueries({ queryKey: getListFiftyPctSessionsQueryKey({}) });
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
      setMode("list");
    }
  }

  // ── Guard ─────────────────────────────────────────────────────────────

  if (!canUse) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Restricted to admin and developer roles.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {mode !== "list" && (
              <button
                onClick={() => { setMode("list"); resetWizard(); setSelectedSessionId(null); }}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="p-2 bg-blue-900/30 rounded-lg border border-blue-700/40">
              <Layers className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">50% Revenue Settlement</h1>
              <p className="text-sm text-slate-500 mt-0.5">50/50 gross split · Landowner side · Economic Participant Pool</p>
            </div>
          </div>
          {mode === "list" && (
            <Button
              onClick={() => { resetWizard(); setMode("new"); }}
              className="bg-blue-700 hover:bg-blue-600 text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> New Settlement
            </Button>
          )}
        </div>

        {/* ── Model strip ── */}
        <div className="bg-slate-900/30 border border-slate-800 rounded-xl px-5 py-3 mb-6 flex items-center gap-6 text-xs text-slate-400 flex-wrap">
          <div className="flex items-center gap-2">
            <Banknote className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-mono text-white">Gross Revenue</span>
          </div>
          <div className="flex items-center gap-2">
            <ChevronRight className="w-3 h-3 text-slate-600" />
            <div className="flex gap-2">
              <span className="text-emerald-400 font-semibold">50% Landowner</span>
              <span className="text-slate-600">+</span>
              <span className="text-blue-400 font-semibold">50% EPP</span>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-amber-400">Landowner bears op costs + LCA</span>
            <span className="text-slate-600">·</span>
            <span className="text-blue-400">EPP never reduced by costs</span>
          </div>
        </div>

        {/* ══════════════════════════════════════════════
         * LIST MODE
         * ══════════════════════════════════════════════ */}
        {mode === "list" && (
          <div>
            {/* Status filter tabs */}
            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit mb-4">
              {(["all", "draft", "confirmed", "archived"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize ${
                    filterStatus === s
                      ? "bg-slate-700 text-white"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {s === "all" ? "All Sessions" : s}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 mb-4">
              <Select value={filterProjectId} onValueChange={setFilterProjectId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-72">
                  <SelectValue placeholder="Filter by project (optional)" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map((p: Project) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sessionsLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
            </div>

            {sessions.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-16 text-center">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-slate-500 text-sm">No settlement sessions yet.</p>
                <Button
                  onClick={() => { resetWizard(); setMode("new"); }}
                  variant="outline"
                  size="sm"
                  className="mt-4 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Create first settlement
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s: FiftyPctSession) => (
                  <div
                    key={s.id}
                    onClick={() => { setSelectedSessionId(s.id); setDetailTab("split"); setMode("detail"); }}
                    className="flex items-center gap-4 px-5 py-4 bg-slate-900/40 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 hover:bg-slate-800/40 transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-slate-200">{s.periodLabel}</span>
                        <StatusBadge status={s.status} />
                        {s.revenueSource === "sales_records" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/30">Linked Sales</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                        <span>Gross: <span className="text-slate-300">{fmt(num(s.grossRevenue))}</span></span>
                        <span>Landowner: <span className="text-emerald-400">{fmt(num(s.landownerSplit))}</span></span>
                        <span>EPP: <span className="text-blue-400">{fmt(num(s.participantPoolSplit))}</span></span>
                        <span>Net: <span className="text-emerald-300">{fmt(num(s.landownerNet))}</span></span>
                        {s.calculatedByName && <span>by {s.calculatedByName}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && s.status === "draft" && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleConfirm(s.id); }}
                            className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-900/20 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />Confirm
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleArchive(s.id); }}
                            className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * NEW SESSION WIZARD
         * ══════════════════════════════════════════════ */}
        {mode === "new" && (
          <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-6">
            <WizardStepper step={wizardStep} />

            {/* Step 1: Setup */}
            {wizardStep === 1 && (
              <div className="space-y-4 max-w-lg">
                <SectionHeader icon={BarChart3} title="Project & Period" subtitle="Select the project and define the accounting period." />
                <Field label="Project *">
                  <Select value={wProjectId} onValueChange={(v) => { setWProjectId(v); setWSelectedSaleIds(new Set()); }}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                      {projects.map((p: Project) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label='Period Label * (e.g. "2024-25 Q1")'>
                  <Input value={wPeriodLabel} onChange={(e) => setWPeriodLabel(e.target.value)}
                    placeholder="e.g. 2024-25 Q1"
                    className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600" />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="From">
                    <Input type="date" value={wPeriodStart} onChange={(e) => setWPeriodStart(e.target.value)}
                      className="bg-slate-900 border-slate-700 text-slate-200" />
                  </Field>
                  <Field label="To">
                    <Input type="date" value={wPeriodEnd} onChange={(e) => setWPeriodEnd(e.target.value)}
                      className="bg-slate-900 border-slate-700 text-slate-200" />
                  </Field>
                  <Field label="Year">
                    <Input type="number" value={wPeriodYear} onChange={(e) => setWPeriodYear(e.target.value)}
                      placeholder="2024" className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600" />
                  </Field>
                </div>
                <Field label="Notes (optional)">
                  <Textarea value={wNotes} onChange={(e) => setWNotes(e.target.value)}
                    placeholder="Context, remarks…"
                    className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16" />
                </Field>
              </div>
            )}

            {/* Step 2: Revenue */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                <SectionHeader icon={Banknote} title="Gross Revenue" subtitle="Link confirmed sales records or enter manually." />
                <div className="flex gap-2">
                  <ToggleBtn active={wRevenueSource === "sales_records"} onClick={() => setWRevenueSource("sales_records")}>Link Sales Records</ToggleBtn>
                  <ToggleBtn active={wRevenueSource === "manual"} onClick={() => setWRevenueSource("manual")}>Manual Entry</ToggleBtn>
                </div>

                {wRevenueSource === "sales_records" ? (
                  revenueLoading ? (
                    <LoadingRow label="Loading confirmed sales…" />
                  ) : !revenueData?.sales?.length ? (
                    <EmptyBox icon={Banknote} label="No confirmed sales found for this project/period." />
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs text-slate-500">{revenueData.sales.length} sale{revenueData.sales.length > 1 ? "s" : ""}</span>
                        <button className="text-xs text-blue-400 hover:text-blue-300"
                          onClick={() => setWSelectedSaleIds(
                            wSelectedSaleIds.size === revenueData.sales.length
                              ? new Set()
                              : new Set(revenueData.sales.map((s: any) => s.id))
                          )}>
                          {wSelectedSaleIds.size === revenueData.sales.length ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {revenueData.sales.map((s: any) => (
                          <label key={s.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${wSelectedSaleIds.has(s.id) ? "border-blue-700/50 bg-blue-900/20" : "border-slate-800 hover:border-slate-700"}`}>
                            <Checkbox checked={wSelectedSaleIds.has(s.id)}
                              onCheckedChange={(v) => setWSelectedSaleIds((prev) => {
                                const next = new Set(prev);
                                v ? next.add(s.id) : next.delete(s.id);
                                return next;
                              })} className="border-slate-600" />
                            <div className="flex-1 flex items-center justify-between text-sm">
                              <div>
                                <span className="font-medium text-slate-200">{s.saleNumber}</span>
                                <span className="text-slate-500 text-xs ml-2">{s.saleDate} · {s.buyerName}</span>
                              </div>
                              <span className="font-mono text-emerald-400">{fmt(parseNumeric(s.grossRevenue))}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                      {wSelectedSaleIds.size > 0 && (
                        <div className="mt-3 bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-4 py-2.5 flex justify-between text-sm">
                          <span className="text-slate-400">{wSelectedSaleIds.size} selected</span>
                          <span className="font-mono font-semibold text-emerald-400">{fmt(linkedGross)}</span>
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <Field label="Gross Revenue (₹) *">
                    <Input type="number" value={wManualRevenue} onChange={(e) => setWManualRevenue(e.target.value)}
                      placeholder="0.00" className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-lg" />
                  </Field>
                )}

                {effectiveGross > 0 && (
                  <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-4 py-3 flex justify-between">
                    <span className="text-sm text-emerald-400">Gross Revenue</span>
                    <span className="font-mono font-bold text-emerald-400 text-xl">{fmt(effectiveGross)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Deductions */}
            {wizardStep === 3 && (
              <div className="space-y-4 max-w-lg">
                <SectionHeader icon={Receipt} title="Landowner Deductions" subtitle="Op costs and LCA are deducted from the landowner's 50% only. The EPP is never reduced." />

                <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-2.5 flex justify-between text-sm mb-2">
                  <span className="text-slate-400">Landowner's 50%</span>
                  <span className="font-mono text-emerald-400">{fmt(effectiveGross / 2)}</span>
                </div>

                <Field label="Operational Cost (₹)">
                  <Input type="number" value={wOpCost} onChange={(e) => setWOpCost(e.target.value)}
                    className="bg-slate-900 border-slate-700 text-slate-200" />
                </Field>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-400 text-xs">LCA Amount (₹)</Label>
                    <div className="flex gap-1">
                      <ToggleBtn active={wLcaSource === "ledger"} onClick={() => setWLcaSource("ledger")} size="sm">From Ledger</ToggleBtn>
                      <ToggleBtn active={wLcaSource === "manual"} onClick={() => setWLcaSource("manual")} size="sm">Manual</ToggleBtn>
                    </div>
                  </div>
                  {wLcaSource === "ledger" ? (
                    <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-3 text-xs">
                      {lcaData ? (
                        <div className="flex justify-between">
                          <span className="text-amber-400">Outstanding LCA Balance</span>
                          <span className="font-mono font-bold text-amber-400">{fmt(lcaData.totalBalance)}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">No LCA entries found.</span>
                      )}
                    </div>
                  ) : (
                    <Input type="number" value={wManualLca} onChange={(e) => setWManualLca(e.target.value)}
                      className="bg-slate-900 border-slate-700 text-slate-200" />
                  )}
                </div>

                {/* Live preview */}
                <SplitVisual gross={effectiveGross} opCost={effectiveOpCost} lca={effectiveLca} />
              </div>
            )}

            {/* Step 4: Review + Save */}
            {wizardStep === 4 && (
              <div className="space-y-4">
                <SectionHeader icon={Calculator} title="Review & Save" subtitle="Confirm the 50/50 split and save as a draft settlement session." />

                <SplitVisual gross={effectiveGross} opCost={effectiveOpCost} lca={effectiveLca} />

                {/* Summary card */}
                <div className="grid grid-cols-2 gap-3 text-sm bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                  <InfoRow label="Project" value={projects.find((p: Project) => p.id === wProjectId)?.name ?? "—"} />
                  <InfoRow label="Period" value={wPeriodLabel} />
                  <InfoRow label="Revenue Source" value={wRevenueSource === "sales_records" ? `${wSelectedSaleIds.size} linked sales` : "Manual"} />
                  <InfoRow label="Gross Revenue" value={fmt(effectiveGross)} />
                </div>

                <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg px-4 py-3 flex items-start gap-2 text-xs text-blue-300">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  After saving, you will be taken to Step 5 where you can add Economic Participant Pool (EPP) participants and assign their distribution percentages.
                </div>

                {wizardError && (
                  <p className="text-red-400 text-sm bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />{wizardError}
                  </p>
                )}
              </div>
            )}

            {/* Step 5: EPP Setup */}
            {wizardStep === 5 && wizardSessionId && (
              <div className="space-y-4">
                <SectionHeader icon={Users} title="Economic Participant Pool" subtitle="Add participants to distribute the 50% EPP. Land contribution is excluded — only additional economic contributions qualify." />

                <EppPanel
                  sessionId={wizardSessionId}
                  entries={wizardEppEntries}
                  poolSplit={effectiveGross / 2}
                  isConfirmed={false}
                  partners={partners}
                  showForm={showEppForm}
                  eppEditId={eppEditId}
                  eppKey={eppKey} setEppKey={setEppKey}
                  eppName={eppName} setEppName={setEppName}
                  eppPct={eppPct} setEppPct={setEppPct}
                  eppType={eppType} setEppType={setEppType}
                  eppIsLandownerAdditional={eppIsLandownerAdditional} setEppIsLandownerAdditional={setEppIsLandownerAdditional}
                  eppNotes={eppNotes} setEppNotes={setEppNotes}
                  eppError={eppError}
                  onOpenForm={() => { resetEppForm(); setShowEppForm(true); }}
                  onEditEntry={openEppEdit}
                  onDeleteEntry={(entryId) => handleEppDelete(wizardSessionId, entryId)}
                  onSave={() => handleEppSave(wizardSessionId)}
                  onCancel={resetEppForm}
                  onPartnerSelect={handlePartnerSelect}
                  isSaving={createEppMutation.isPending || updateEppMutation.isPending}
                />
              </div>
            )}

            {/* Step 6: Final Review */}
            {wizardStep === 6 && wizardSessionId && (
              <div className="space-y-5">
                <SectionHeader icon={CheckCircle2} title="Final Review" subtitle="Complete settlement overview. Review the split, EPP allocation, and confirm when ready." />

                <SplitVisual gross={effectiveGross} opCost={effectiveOpCost} lca={effectiveLca} />

                {/* EPP summary */}
                <div className="bg-blue-950/10 border border-blue-800/30 rounded-xl p-5">
                  <p className="text-[11px] text-blue-400 uppercase tracking-wider mb-3">Economic Participant Pool — Allocation Summary</p>
                  {wizardEppEntries.length === 0 ? (
                    <p className="text-sm text-slate-500">No EPP participants added. You can add them from the detail view after finishing.</p>
                  ) : (
                    <div className="space-y-1">
                      {wizardEppEntries.map((e) => (
                        <div key={e.id} className="flex items-center justify-between py-2 border-b border-blue-800/20 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-200">{e.participantName}</span>
                            <TypeBadge type={e.contributionType} />
                          </div>
                          <div className="flex items-center gap-4 font-mono text-sm">
                            <span className="text-slate-500">{fmtPct(e.participationPct)}</span>
                            <span className="text-blue-300 font-semibold">{fmt(e.allocatedAmount)}</span>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-semibold pt-2">
                        <span className="text-slate-400">Total EPP Allocated</span>
                        <span className="text-blue-300 font-mono">{fmt(wizardEppEntries.reduce((s, e) => s + e.allocatedAmount, 0))}</span>
                      </div>
                      {(() => {
                        const allocated = wizardEppEntries.reduce((s, e) => s + e.allocatedAmount, 0);
                        const remainder = Math.max(0, effectiveGross / 2 - allocated);
                        return remainder > 0.01 ? (
                          <p className="text-xs text-amber-400 flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3" /> {fmt(remainder)} of the EPP pool is unallocated
                          </p>
                        ) : (
                          <p className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
                            <CheckCircle2 className="w-3 h-3" /> EPP fully allocated
                          </p>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Metadata summary */}
                <div className="grid grid-cols-2 gap-3 text-sm bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                  <InfoRow label="Project" value={projects.find((p: Project) => p.id === wProjectId)?.name ?? "—"} />
                  <InfoRow label="Period" value={wPeriodLabel} />
                  <InfoRow label="Gross Revenue" value={fmt(effectiveGross)} />
                  <InfoRow label="Status" value="Draft" />
                </div>

                {/* Optional confirm */}
                {isAdmin && (
                  <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-emerald-300">Confirm this settlement?</p>
                      <p className="text-xs text-emerald-400/70 mt-0.5">Confirmed sessions are locked and cannot be edited.</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={async () => { if (wizardSessionId) await handleConfirm(wizardSessionId); }}
                      disabled={confirmMutation.isPending}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs shrink-0"
                    >
                      {confirmMutation.isPending
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                        : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                      Confirm Now
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Wizard error */}
            {wizardStep !== 4 && wizardStep !== 5 && wizardStep !== 6 && wizardError && (
              <p className="mt-3 text-red-400 text-sm bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />{wizardError}
              </p>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-5 border-t border-slate-800">
              <Button variant="ghost" onClick={() => { if (wizardStep === 1) { setMode("list"); resetWizard(); } else setWizardStep(s => s - 1); }}
                disabled={wizardStep === 5}
                className="text-slate-400 hover:text-slate-200">
                <ChevronLeft className="w-4 h-4 mr-1" />
                {wizardStep === 1 ? "Cancel" : "Back"}
              </Button>

              {wizardStep < 4 && (
                <Button onClick={goWizardNext} className="bg-blue-700 hover:bg-blue-600 text-white">
                  Continue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
              {wizardStep === 4 && (
                <Button onClick={handleWizardSave} disabled={createMutation.isPending || effectiveGross <= 0}
                  className="bg-blue-700 hover:bg-blue-600 text-white">
                  {createMutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving…</> : <>Save Draft <ChevronRight className="w-4 h-4 ml-1" /></>}
                </Button>
              )}
              {wizardStep === 5 && (
                <Button onClick={() => setWizardStep(6)} className="bg-blue-700 hover:bg-blue-600 text-white">
                  Review Settlement <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
              {wizardStep === 6 && (
                <Button onClick={finishWizard} className="bg-emerald-700 hover:bg-emerald-600 text-white">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Finish & View Session
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * DETAIL MODE
         * ══════════════════════════════════════════════ */}
        {mode === "detail" && selectedSessionId && (
          <div>
            {summaryLoading ? (
              <LoadingRow label="Loading session…" />
            ) : !summary ? (
              <EmptyBox icon={Layers} label="Session not found." />
            ) : (
              <div className="space-y-4">
                {/* Session header */}
                <div className="flex items-center justify-between px-5 py-4 bg-slate-900/40 border border-slate-800 rounded-xl">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-semibold text-white">{summary.session.periodLabel}</span>
                      <StatusBadge status={summary.session.status} />
                      {summary.session.projectName && (
                        <span className="text-xs text-slate-500">{summary.session.projectName}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Gross: {fmt(num(summary.session.grossRevenue))} · by {summary.session.calculatedByName ?? "—"}
                      {summary.session.confirmedAt && (
                        <> · Confirmed {new Date(summary.session.confirmedAt).toLocaleDateString("en-IN")}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && summary.session.status === "draft" && (
                      <>
                        <Button size="sm" variant="ghost"
                          onClick={() => handleConfirm(selectedSessionId)}
                          className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 h-7 px-3 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confirm
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => handleArchive(selectedSessionId)}
                          className="text-slate-500 hover:text-red-400 hover:bg-red-900/20 h-7 w-7 p-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Warnings */}
                {summary.summary.warnings.map((w, i) => (
                  <div key={i} className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}
                  </div>
                ))}

                {/* Sub-tab nav */}
                <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
                  {(["split", "epp", "landowner", "analytics"] as const).map((t) => (
                    <button key={t}
                      onClick={() => setDetailTab(t)}
                      className={`px-4 py-1.5 rounded text-sm font-medium transition-colors capitalize ${detailTab === t ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>
                      {t === "split" ? "Revenue Split" : t === "epp" ? "Participant Pool" : t === "landowner" ? "Landowner View" : "Analytics"}
                    </button>
                  ))}
                </div>

                {/* ── Split tab ── */}
                {detailTab === "split" && (
                  <div className="space-y-4">
                    <SplitVisual
                      gross={num(summary.session.grossRevenue)}
                      opCost={num(summary.session.operationalCost)}
                      lca={num(summary.session.lcaAmount)}
                    />
                    {/* Full waterfall */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
                      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">Full Allocation</p>
                      <WRow label="Gross Revenue" value={num(summary.session.grossRevenue)} color="text-emerald-400" symbol="in" bold />
                      <div className="grid grid-cols-2 gap-6 mt-4">
                        <div className="space-y-2">
                          <p className="text-[11px] text-emerald-400 uppercase tracking-wider">Landowner Side (50%)</p>
                          <WRow label="Gross" value={num(summary.session.landownerSplit)} color="text-emerald-400" symbol="+" />
                          {num(summary.session.operationalCost) > 0 && <WRow label="Op. Cost" value={num(summary.session.operationalCost)} color="text-red-400" symbol="−" />}
                          {num(summary.session.lcaAmount) > 0 && <WRow label="LCA" value={num(summary.session.lcaAmount)} color="text-amber-400" symbol="−" />}
                          <div className="border-t border-slate-700 pt-2">
                            <WRow label="Net" value={num(summary.session.landownerNet)} color="text-emerald-300" bold />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-[11px] text-blue-400 uppercase tracking-wider">Economic Participant Pool (50%)</p>
                          <WRow label="Pool" value={num(summary.session.participantPoolSplit)} color="text-blue-400" symbol="+" />
                          <WRow label="Allocated" value={num(summary.session.eppTotalAllocated)} color="text-blue-300" symbol="=" />
                          {num(summary.session.eppRemainder) > 0 && (
                            <WRow label="Unallocated" value={num(summary.session.eppRemainder)} color="text-amber-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── EPP tab ── */}
                {detailTab === "epp" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">Economic Participant Pool</p>
                        <p className="text-xs text-slate-500 mt-0.5">Pool size: <span className="text-blue-400 font-mono">{fmt(num(summary.session.participantPoolSplit))}</span> · Allocated: <span className="text-blue-300 font-mono">{fmt(num(summary.session.eppTotalAllocated))}</span></p>
                      </div>
                      {summary.session.status !== "confirmed" && (
                        <Button size="sm" variant="outline"
                          onClick={() => { resetEppForm(); setShowEppForm(true); }}
                          className="border-slate-700 text-slate-300 hover:bg-slate-800 h-7 px-3 text-xs">
                          <Plus className="w-3 h-3 mr-1" /> Add Participant
                        </Button>
                      )}
                    </div>

                    <EppPanel
                      sessionId={selectedSessionId}
                      entries={summary.summary.economicParticipantPool.entries as any}
                      poolSplit={num(summary.session.participantPoolSplit)}
                      isConfirmed={summary.session.status === "confirmed"}
                      partners={partners}
                      showForm={showEppForm}
                      eppEditId={eppEditId}
                      eppKey={eppKey} setEppKey={setEppKey}
                      eppName={eppName} setEppName={setEppName}
                      eppPct={eppPct} setEppPct={setEppPct}
                      eppType={eppType} setEppType={setEppType}
                      eppIsLandownerAdditional={eppIsLandownerAdditional} setEppIsLandownerAdditional={setEppIsLandownerAdditional}
                      eppNotes={eppNotes} setEppNotes={setEppNotes}
                      eppError={eppError}
                      onOpenForm={() => { resetEppForm(); setShowEppForm(true); }}
                      onEditEntry={openEppEdit}
                      onDeleteEntry={(entryId) => handleEppDelete(selectedSessionId, entryId)}
                      onSave={() => handleEppSave(selectedSessionId)}
                      onCancel={resetEppForm}
                      onPartnerSelect={handlePartnerSelect}
                      isSaving={createEppMutation.isPending || updateEppMutation.isPending}
                    />
                  </div>
                )}

                {/* ── Landowner tab ── */}
                {detailTab === "landowner" && (
                  <div className="space-y-4">
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-xl p-6">
                      <p className="text-[11px] text-emerald-400 uppercase tracking-wider mb-5">Landowner-Side Accounting</p>
                      <div className="space-y-3">
                        <LedgerRow label="50% Gross Revenue Share" value={num(summary.session.landownerSplit)} type="credit" />
                        {num(summary.session.operationalCost) > 0 && (
                          <LedgerRow label="Less: Operational Cost" value={num(summary.session.operationalCost)} type="debit" note="borne by landowner side" />
                        )}
                        {num(summary.session.lcaAmount) > 0 && (
                          <LedgerRow label="Less: Land Contribution Adjustment (LCA)" value={num(summary.session.lcaAmount)} type="debit" note={`source: ${summary.session.lcaSource}`} />
                        )}
                        <div className="border-t border-emerald-800/30 pt-3 mt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-base font-semibold text-emerald-300">Net Landowner Position</span>
                            <span className="font-mono text-2xl font-bold text-emerald-300">{fmt(num(summary.session.landownerNet))}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-4">
                      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">Principle</p>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        In the 50% Revenue model, the landowner bears <strong className="text-slate-300">all operational costs and LCA</strong> from their 50% gross share.
                        The Economic Participant Pool is insulated from these costs and is distributed purely by economic participation percentages.
                        If the landowner has <em>additional</em> verified economic contributions beyond their land, they may also participate in the EPP.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Analytics tab ── */}
                {detailTab === "analytics" && (
                  <AnalyticsPanel summary={summary} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EPP Panel (reusable in wizard step 5 and detail EPP tab) ──────────────

interface EppPanelProps {
  sessionId: string;
  entries: EppEntry[];
  poolSplit: number;
  isConfirmed: boolean;
  partners: any[];
  showForm: boolean;
  eppEditId: string | null;
  eppKey: string; setEppKey: (v: string) => void;
  eppName: string; setEppName: (v: string) => void;
  eppPct: string; setEppPct: (v: string) => void;
  eppType: string; setEppType: (v: string) => void;
  eppIsLandownerAdditional: boolean; setEppIsLandownerAdditional: (v: boolean) => void;
  eppNotes: string; setEppNotes: (v: string) => void;
  eppError: string | null;
  onOpenForm: () => void;
  onEditEntry: (e: EppEntry) => void;
  onDeleteEntry: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onPartnerSelect: (id: string) => void;
  isSaving: boolean;
}

function EppPanel({
  entries, poolSplit, isConfirmed, partners, showForm, eppEditId,
  eppKey, setEppKey, eppName, setEppName, eppPct, setEppPct,
  eppType, setEppType, eppIsLandownerAdditional, setEppIsLandownerAdditional,
  eppNotes, setEppNotes, eppError, onOpenForm, onEditEntry, onDeleteEntry,
  onSave, onCancel, onPartnerSelect, isSaving,
}: EppPanelProps) {
  const totalPct = entries.reduce((s, e) => s + e.participationPct, 0);
  const totalAllocated = entries.reduce((s, e) => s + e.allocatedAmount, 0);
  const remainder = Math.max(0, poolSplit - totalAllocated);

  return (
    <div className="space-y-3">
      {/* Add button */}
      {!isConfirmed && !showForm && (
        <Button size="sm" variant="outline" onClick={onOpenForm}
          className="border-slate-700 text-slate-300 hover:bg-slate-800 h-7 px-3 text-xs">
          <Plus className="w-3 h-3 mr-1" /> Add Participant
        </Button>
      )}

      {/* Form */}
      {showForm && !isConfirmed && (
        <div className="bg-slate-900/60 border border-blue-700/40 rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-blue-300">{eppEditId ? "Edit Participant" : "Add EPP Participant"}</p>

          {/* Partner picker */}
          {partners.length > 0 && !eppEditId && (
            <Field label="Pick from partners (optional)">
              <Select onValueChange={onPartnerSelect}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200 h-8 text-xs">
                  <SelectValue placeholder="Select a registered partner" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  {partners.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Participant Name *">
              <Input value={eppName} onChange={(e) => setEppName(e.target.value)}
                placeholder="Name" className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm" />
            </Field>
            <Field label="Participation % *">
              <Input type="number" value={eppPct} onChange={(e) => setEppPct(e.target.value)}
                placeholder="0.00" className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contribution Type">
              <Select value={eppType} onValueChange={(v) => { setEppType(v); setEppIsLandownerAdditional(v === "landowner_additional"); }}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectItem value="economic_only">Economic Only</SelectItem>
                  <SelectItem value="landowner_additional">Landowner + Additional</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes (optional)">
              <Input value={eppNotes} onChange={(e) => setEppNotes(e.target.value)}
                placeholder="Remarks…" className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-sm" />
            </Field>
          </div>

          {eppType === "landowner_additional" && (
            <div className="bg-sky-950/20 border border-sky-800/30 rounded-lg px-3 py-2 text-xs text-sky-300 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>This entry marks the landowner's <strong>additional</strong> economic contribution — not their land stake. Their land is already accounted for in the 50% Landowner Side.</span>
            </div>
          )}

          {parseFloat(eppPct) > 0 && poolSplit > 0 && (
            <div className="text-xs text-slate-400 bg-slate-900/60 rounded px-3 py-1.5">
              Allocated: <span className="font-mono text-blue-300">{fmt((poolSplit * parseFloat(eppPct)) / 100)}</span>
            </div>
          )}

          {eppError && (
            <p className="text-red-400 text-xs flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />{eppError}
            </p>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={onSave} disabled={isSaving}
              className="bg-blue-700 hover:bg-blue-600 text-white h-7 px-4 text-xs">
              {isSaving ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
              {eppEditId ? "Update" : "Add"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} className="text-slate-400 h-7 px-3 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* Entries table */}
      {entries.length === 0 ? (
        <EmptyBox icon={Users} label="No EPP participants yet. Add economic contributors above." />
      ) : (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60">
                <th className="text-left px-4 py-2.5 text-xs text-slate-500">Participant</th>
                <th className="text-right px-3 py-2.5 text-xs text-slate-500">Share %</th>
                <th className="text-right px-4 py-2.5 text-xs text-slate-500">Allocated</th>
                {!isConfirmed && <th className="w-16 px-3" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-200">{e.participantName}</span>
                    <div className="mt-0.5"><TypeBadge type={e.contributionType} /></div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{fmtPct(e.participationPct)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-blue-300">{fmt(e.allocatedAmount)}</td>
                  {!isConfirmed && (
                    <td className="px-3 py-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => onEditEntry(e)} className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => onDeleteEntry(e.id)} className="p-1 rounded hover:bg-red-900/20 text-slate-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900/60">
              <tr>
                <td className="px-4 py-2.5 text-xs text-slate-500">Total</td>
                <td className={`px-3 py-2.5 text-right font-mono text-sm ${Math.abs(totalPct - 100) > 0.5 ? "text-amber-400" : "text-slate-300"}`}>
                  {fmtPct(totalPct)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-300">{fmt(totalAllocated)}</td>
                {!isConfirmed && <td />}
              </tr>
              {remainder > 0.01 && (
                <tr className="bg-amber-950/10">
                  <td colSpan={isConfirmed ? 2 : 3} className="px-4 py-2 text-xs text-amber-400">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    {fmt(remainder)} unallocated
                  </td>
                  {!isConfirmed && <td />}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Analytics panel ───────────────────────────────────────────────────────

function AnalyticsPanel({ summary }: { summary: any }) {
  const gross = num(summary.session.grossRevenue);
  const landownerSplit = num(summary.session.landownerSplit);
  const poolSplit = num(summary.session.participantPoolSplit);
  const opCost = num(summary.session.operationalCost);
  const lca = num(summary.session.lcaAmount);
  const landownerNet = num(summary.session.landownerNet);
  const eppAllocated = num(summary.session.eppTotalAllocated);

  const allocationData = [
    { name: "Landowner Net", value: landownerNet, fill: "#34d399" },
    { name: "Op Cost", value: opCost, fill: "#f87171" },
    { name: "LCA", value: lca, fill: "#fbbf24" },
    { name: "EPP", value: eppAllocated, fill: "#60a5fa" },
    ...(num(summary.session.eppRemainder) > 0.01 ? [{ name: "Unallocated EPP", value: num(summary.session.eppRemainder), fill: "#475569" }] : []),
  ].filter((d) => d.value > 0);

  const eppEntries = summary.summary.economicParticipantPool.entries ?? [];

  return (
    <div className="space-y-5">
      {/* Revenue allocation bar chart */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
        <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">Gross Revenue Allocation</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={allocationData} layout="vertical" margin={{ left: 80, right: 20 }}>
            <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={80} />
            <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {allocationData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 50/50 KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Gross Revenue" value={fmt(gross)} color="text-white" />
        <KpiCard label="Landowner Split" value={fmt(landownerSplit)} color="text-emerald-400" sub="50%" />
        <KpiCard label="Landowner Net" value={fmt(landownerNet)} color="text-emerald-300" />
        <KpiCard label="EPP Pool" value={fmt(poolSplit)} color="text-blue-400" sub="50%" />
      </div>

      {/* EPP breakdown chart */}
      {eppEntries.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-4">EPP Participant Allocation</p>
          <ResponsiveContainer width="100%" height={Math.max(120, eppEntries.length * 40)}>
            <BarChart data={eppEntries.map((e: any) => ({ name: e.participantName, value: e.allocatedAmount, pct: e.participationPct }))}
              layout="vertical" margin={{ left: 120, right: 60 }}>
              <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#cbd5e1", fontSize: 11 }} width={120} />
              <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} />
              <Bar dataKey="value" fill="#60a5fa" radius={[0, 4, 4, 0]} label={{ position: "right", formatter: (v: number) => fmt(v), fill: "#94a3b8", fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Micro-components ──────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 pb-3 border-b border-slate-800 mb-2">
      <Icon className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-400 text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
  size,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  size?: "sm";
}) {
  return (
    <button
      onClick={onClick}
      className={`${size === "sm" ? "px-2.5 py-1 text-xs" : "flex-1 py-2.5 px-4 text-sm"} rounded-lg border font-medium transition-all ${active ? "bg-blue-900/40 border-blue-700 text-blue-300" : "border-slate-700 text-slate-500 hover:border-slate-600"}`}
    >
      {children}
    </button>
  );
}

function WRow({ label, value, color, symbol, bold }: { label: string; value: number; color: string; symbol?: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${bold ? "text-base" : "text-sm"}`}>
      <div className="flex items-center gap-2 text-slate-400">
        {symbol === "+" ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          : symbol === "−" ? <TrendingDown className="w-3.5 h-3.5 text-red-400" />
          : symbol === "in" ? <BarChart3 className="w-3.5 h-3.5 text-slate-500" />
          : <Equal className="w-3.5 h-3.5 text-sky-400" />}
        <span className={bold ? "font-semibold text-white" : ""}>{label}</span>
      </div>
      <span className={`font-mono font-semibold ${color}`}>{fmt(value)}</span>
    </div>
  );
}

function LedgerRow({ label, value, type, note }: { label: string; value: number; type: "credit" | "debit"; note?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/30">
      <div>
        <span className={`text-sm ${type === "credit" ? "text-emerald-300" : "text-slate-300"}`}>{label}</span>
        {note && <p className="text-[10px] text-slate-600 mt-0.5">{note}</p>}
      </div>
      <span className={`font-mono text-sm font-semibold ${type === "credit" ? "text-emerald-400" : "text-red-400"}`}>
        {type === "credit" ? "+" : "−"}{fmt(value)}
      </span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-slate-200 mt-0.5">{value}</p>
    </div>
  );
}

function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`font-mono font-bold text-lg ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-1">{sub}</p>}
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

function EmptyBox({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-12 text-center">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-20" />
      <p className="text-slate-500 text-sm">{label}</p>
    </div>
  );
}
