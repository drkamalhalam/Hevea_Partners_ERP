/**
 * SettlementGovernance.tsx
 *
 * Distribution Governance & Settlement Monitoring
 * ERP/accounting-style financial monitoring dashboard.
 *
 * Four panels:
 *   Overview  — health score, severity KPIs, category breakdown, exposure total
 *   Alerts    — all alerts sorted by severity, filterable by category/severity
 *   Tasks     — pending payment tasks + finalization queue + open disputes
 *   Discrepancies — override difference monitoring per settlement record
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useGetSettlementGovernanceSummary,
  useListSettlementGovernanceAlerts,
  useGetSettlementTasks,
  useGetSettlementDiscrepancies,
} from "@workspace/api-client-react";
import type {
  SettlementAlert as GovernanceAlert,
  SettlementGovernanceSummary,
} from "@workspace/api-client-react";
import { useListProjects } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  ShieldAlert, AlertTriangle, AlertCircle, Info, RefreshCw,
  TrendingDown, Scale, Clock, CheckCircle, ArrowRight,
  IndianRupee, Zap, FileWarning, BarChart3, ClipboardList,
  Activity, ChevronRight, ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";
import { parseNumeric } from "@/lib/numeric";

// ── Constants ─────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  CRITICAL: { label: "Critical",  color: "text-red-400",    bg: "bg-red-900/30",    border: "border-red-800/60",    icon: <AlertCircle size={14} className="text-red-400" />,    dot: "bg-red-500" },
  HIGH:     { label: "High",      color: "text-orange-400", bg: "bg-orange-900/25", border: "border-orange-800/50", icon: <AlertTriangle size={14} className="text-orange-400" />, dot: "bg-orange-500" },
  MEDIUM:   { label: "Medium",    color: "text-amber-400",  bg: "bg-amber-900/20",  border: "border-amber-800/40",  icon: <Info size={14} className="text-amber-400" />,          dot: "bg-amber-500" },
  LOW:      { label: "Low",       color: "text-blue-400",   bg: "bg-blue-900/15",   border: "border-blue-800/30",   icon: <Info size={14} className="text-blue-400" />,           dot: "bg-blue-500" },
} as const;

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  PENDING_SETTLEMENT:   { label: "Pending Settlement",    icon: <Clock size={13} />,       color: "text-amber-400" },
  LARGE_OVERRIDE:       { label: "Large Override",        icon: <Scale size={13} />,       color: "text-orange-400" },
  UNPAID_LCA:           { label: "Unpaid LCA",            icon: <IndianRupee size={13} />, color: "text-red-400" },
  NEGATIVE_BALANCE:     { label: "Negative Balance",      icon: <TrendingDown size={13} />,color: "text-red-500" },
  MISSING_FINALIZATION: { label: "Missing Finalization",  icon: <FileWarning size={13} />, color: "text-orange-400" },
  UNRESOLVED_DISPUTE:   { label: "Unresolved Dispute",    icon: <ShieldAlert size={13} />, color: "text-red-400" },
};

const DIFF_FLAG_CONFIG = {
  CRITICAL: { label: "Critical",  color: "text-red-400",    bg: "bg-red-900/30 border-red-800/60" },
  HIGH:     { label: "High",      color: "text-orange-400", bg: "bg-orange-900/25 border-orange-800/50" },
  MEDIUM:   { label: "Medium",    color: "text-amber-400",  bg: "bg-amber-900/20 border-amber-800/40" },
  OK:       { label: "OK",        color: "text-emerald-400",bg: "bg-emerald-900/15 border-emerald-800/30" },
};

// ── Helpers ───────────────────────────────────────────────────────────────

const fmt = (v: string | number | null | undefined) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(parseNumeric(v));

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function SeverityBadge({ sev }: { sev: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" }) {
  const c = SEVERITY_CONFIG[sev];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold border ${c.bg} ${c.border} ${c.color}`}>
      {c.icon} {c.label}
    </span>
  );
}

// ── Health Score gauge ─────────────────────────────────────────────────────

function HealthGauge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : score >= 40 ? "text-orange-400" : "text-red-400";
  const barColor = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : score >= 40 ? "bg-orange-500" : "bg-red-500";
  const label = score >= 80 ? "Healthy" : score >= 60 ? "Caution" : score >= 40 ? "Warning" : "Critical";

  return (
    <div className="flex flex-col items-center">
      <div className={`text-5xl font-black tabular-nums ${color}`}>{score}</div>
      <div className={`text-xs font-semibold mt-1 ${color}`}>{label}</div>
      <div className="w-32 h-2 bg-slate-700 rounded-full mt-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${score}%` }} />
      </div>
      <div className="text-xs text-slate-500 mt-1">/ 100</div>
    </div>
  );
}

// ── Alert card ─────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: GovernanceAlert }) {
  const [, setLocation] = useLocation();
  const sev = alert.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  const c = SEVERITY_CONFIG[sev];
  const cat = CATEGORY_CONFIG[alert.category];

  return (
    <div className={`rounded-lg border p-3 ${c.bg} ${c.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div className={`mt-0.5 shrink-0 ${c.color}`}>{c.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-semibold ${c.color} leading-tight`}>{alert.title}</p>
              <SeverityBadge sev={sev} />
              {cat && (
                <span className={`flex items-center gap-1 text-xs ${cat.color}`}>
                  {cat.icon} {cat.label}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{alert.description}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {alert.projectName && <span className="text-xs text-slate-500">Project: <span className="text-slate-400">{alert.projectName}</span></span>}
              {alert.partnerName && <span className="text-xs text-slate-500">Partner: <span className="text-slate-400">{alert.partnerName}</span></span>}
              {alert.amount != null && alert.amount > 0 && (
                <span className="text-xs text-slate-500">Exposure: <span className={`font-semibold ${c.color}`}>{fmt(alert.amount)}</span></span>
              )}
            </div>
          </div>
        </div>
        {alert.actionUrl && (
          <button
            onClick={() => setLocation(alert.actionUrl!)}
            className={`shrink-0 flex items-center gap-1 text-xs ${c.color} hover:opacity-80 transition-opacity`}
          >
            <ExternalLink size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Task row ───────────────────────────────────────────────────────────────

function TaskRow({ task, type }: { task: Record<string, unknown>; type: "payment" | "finalization" | "dispute" }) {
  const [, setLocation] = useLocation();
  const dest = type === "payment" ? "/distribution-records" : "/final-settlement";

  const badgeStyle =
    type === "dispute"      ? "bg-red-900/40 border-red-800/50 text-red-300"
    : type === "finalization" ? "bg-orange-900/30 border-orange-800/40 text-orange-300"
    : "bg-amber-900/30 border-amber-800/40 text-amber-300";

  const label =
    type === "dispute"        ? "Dispute"
    : type === "finalization" ? "Awaiting Finalization"
    : `${(task.status as string)?.replace("_", " ") ?? "Pending"}`;

  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-700/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-white truncate">
            {(task.accountingPeriodLabel as string) ?? (task.periodLabel as string) ?? "—"}
          </p>
          <span className={`text-xs px-1.5 py-0.5 rounded border ${badgeStyle} capitalize`}>{label}</span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {(task.projectName as string) ?? (task.projectId as string)}
          {task.partnerName ? ` · ${task.partnerName as string}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        {type === "payment" && (
          <p className="text-sm font-bold text-amber-400">{fmt(task.pendingPayable as string)}</p>
        )}
        {type === "finalization" && (
          <p className="text-sm font-bold text-orange-400">{fmt(task.recommendedAmount as string)}</p>
        )}
        {type === "dispute" && (
          <p className="text-sm font-bold text-red-400">{fmt(task.recommendedAmount as string)}</p>
        )}
        <p className="text-xs text-slate-500">{fmtDate(task.createdAt as string)}</p>
      </div>
      <button onClick={() => setLocation(dest)} className="text-slate-500 hover:text-slate-300 transition-colors">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// ── Discrepancy row ────────────────────────────────────────────────────────

function DiscrepancyRow({ d }: { d: Record<string, unknown> }) {
  const flag = d.diffFlag as string;
  const fc = DIFF_FLAG_CONFIG[flag as keyof typeof DIFF_FLAG_CONFIG] ?? DIFF_FLAG_CONFIG.OK;
  const diffPct = parseNumeric(d.diffPct as string | number | null | undefined);
  const diff = parseNumeric(d.diff as string | number | null | undefined);

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs">
      <div className="min-w-0">
        <p className="font-medium text-white truncate">{d.periodLabel as string}</p>
        <p className="text-slate-400 truncate">{d.projectName as string} {d.partnerName ? `· ${d.partnerName as string}` : ""}</p>
        {d.overrideRemarks ? <p className="text-slate-500 italic truncate mt-0.5">"{String(d.overrideRemarks)}"</p> : null}
      </div>
      <div className="text-right">
        <p className="text-slate-400">Recommended</p>
        <p className="text-slate-200 font-medium">{fmt(d.recommendedAmount as string)}</p>
      </div>
      <div className="text-right">
        <p className="text-slate-400">Actual</p>
        <p className="text-slate-200 font-medium">{fmt(d.actualAmount as string)}</p>
      </div>
      <div className="text-right">
        <p className="text-slate-400">Δ Diff</p>
        <p className={`font-semibold ${diff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {diff >= 0 ? "+" : ""}{fmt(d.diff as string)}
        </p>
        <p className={`text-xs ${diff >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          {diff >= 0 ? "+" : ""}{diffPct.toFixed(1)}%
        </p>
      </div>
      <div>
        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border ${fc.bg} ${fc.color}`}>
          {fc.label}
        </span>
        <p className="text-slate-500 text-xs mt-0.5 text-right">{d.overrideCount as number}× override</p>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SettlementGovernance() {
  const { role } = useRole();
  const [tab, setTab] = useState("overview");
  const [filterProject, setFilterProject] = useState("__all__");
  const [filterCategory, setFilterCategory] = useState("__all__");
  const [filterSeverity, setFilterSeverity] = useState("__all__");

  const projectId = filterProject !== "__all__" ? filterProject : undefined;

  const { data: summaryData, refetch: refetchSummary, isLoading: summaryLoading } = useGetSettlementGovernanceSummary();
  const { data: alertsData,  refetch: refetchAlerts } = useListSettlementGovernanceAlerts({
    category: filterCategory !== "__all__" ? filterCategory : undefined,
    severity: filterSeverity !== "__all__" ? filterSeverity : undefined,
    projectId,
  });
  const { data: tasksData,   refetch: refetchTasks } = useGetSettlementTasks({ projectId });
  const { data: discData,    refetch: refetchDisc  } = useGetSettlementDiscrepancies({ projectId });
  const { data: projectsData } = useListProjects();

  const summary = summaryData as SettlementGovernanceSummary | undefined;
  const alerts  = (alertsData as { alerts?: GovernanceAlert[] })?.alerts ?? [];
  const tasks   = tasksData as {
    pendingPayments: Record<string, unknown>[];
    pendingFinalizations: Record<string, unknown>[];
    openDisputes: Record<string, unknown>[];
    taskCounts: { total: number; pendingPayments: number; pendingFinalizations: number; openDisputes: number };
  } | undefined;
  const disc = discData as {
    discrepancies: Record<string, unknown>[];
    total: number;
    totalDiscrepancyAmount: string;
    flagCounts: Record<string, number>;
  } | undefined;
  const projects = (projectsData as { projects?: { id: string; name: string }[] })?.projects ?? [];

  const refetchAll = () => { refetchSummary(); refetchAlerts(); refetchTasks(); refetchDisc(); };

  const criticalCount = summary?.bySeverity?.CRITICAL ?? 0;
  const highCount     = summary?.bySeverity?.HIGH ?? 0;

  // Group alerts by category for overview
  const categoryGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const [k, v] of Object.entries(summary?.byCategory ?? {})) {
      groups[k] = v as number;
    }
    return groups;
  }, [summary]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <ShieldAlert size={18} className="text-orange-400" />
            Settlement Governance
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Financial monitoring · Alert center · Discrepancy analysis · Task queue
          </p>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1.5 bg-red-900/40 border border-red-700/60 rounded-full px-3 py-1 text-xs font-semibold text-red-300">
              <Zap size={11} /> {criticalCount} Critical
            </span>
          )}
          <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white text-xs" onClick={refetchAll}>
            <RefreshCw size={12} className="mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Global filters */}
      <div className="flex items-center gap-3 px-6 py-2.5 bg-slate-900/60 border-b border-slate-800 shrink-0">
        <Select value={filterProject} onValueChange={v => setFilterProject(v)}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-7 w-44">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            <SelectItem value="__all__" className="text-slate-300 text-xs">All Projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id} className="text-white text-xs">{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="bg-slate-900 border-b border-slate-800 rounded-none justify-start px-6 shrink-0">
          <TabsTrigger value="overview"       className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">
            <Activity size={12} className="mr-1.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="alerts"         className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">
            <AlertTriangle size={12} className="mr-1.5" />
            Alerts
            {summary && summary.totalAlerts > 0 && (
              <span className="ml-1.5 bg-orange-700 text-white text-xs rounded-full px-1.5">{summary.totalAlerts}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks"          className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">
            <ClipboardList size={12} className="mr-1.5" />
            Task Center
            {tasks?.taskCounts?.total ? (
              <span className="ml-1.5 bg-amber-700 text-white text-xs rounded-full px-1.5">{tasks.taskCounts.total}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="discrepancies"  className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">
            <BarChart3 size={12} className="mr-1.5" />
            Discrepancies
            {disc && disc.total > 0 && (
              <span className="ml-1.5 bg-orange-800 text-white text-xs rounded-full px-1.5">{disc.total}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 overflow-y-auto m-0">
          <div className="p-6 space-y-6">

            {/* Health + severity KPIs */}
            <div className="grid grid-cols-5 gap-4">
              {/* Health gauge */}
              <Card className="col-span-1 bg-slate-800/60 border-slate-700 flex items-center justify-center p-4">
                <div className="text-center">
                  <p className="text-xs text-slate-400 mb-3">Settlement Health</p>
                  <HealthGauge score={summary?.healthScore ?? 100} />
                </div>
              </Card>

              {/* Severity breakdown */}
              <Card className="col-span-4 bg-slate-800/60 border-slate-700">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs text-slate-400 font-medium">Alert Severity Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-4 gap-3">
                    {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map(sev => {
                      const c = SEVERITY_CONFIG[sev];
                      const count = summary?.bySeverity?.[sev] ?? 0;
                      return (
                        <button
                          key={sev}
                          onClick={() => { setTab("alerts"); setFilterSeverity(sev); }}
                          className={`rounded-lg border p-3 text-left transition-all hover:opacity-90 ${c.bg} ${c.border}`}
                        >
                          <div className={`text-2xl font-black ${c.color}`}>{count}</div>
                          <div className="flex items-center gap-1 mt-1">
                            {c.icon}
                            <span className={`text-xs font-semibold ${c.color}`}>{c.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Category breakdown */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm text-slate-300 flex items-center justify-between">
                  Alert Categories
                  <span className="text-xs text-slate-500 font-normal">Total exposure: <span className="text-orange-400 font-semibold">{fmt(summary?.totalExposure)}</span></span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => {
                    const count = categoryGroups[cat] ?? 0;
                    return (
                      <button
                        key={cat}
                        onClick={() => { setTab("alerts"); setFilterCategory(cat); }}
                        disabled={count === 0}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          count > 0
                            ? "bg-slate-700/50 border-slate-600/60 hover:bg-slate-700 cursor-pointer"
                            : "bg-slate-800/30 border-slate-700/30 opacity-40 cursor-default"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cfg.color}>{cfg.icon}</span>
                          <span className="text-xs text-slate-300">{cfg.label}</span>
                        </div>
                        <span className={`text-lg font-bold ${count > 0 ? cfg.color : "text-slate-600"}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Task summary quick links */}
            {tasks && tasks.taskCounts.total > 0 && (
              <Card className="bg-slate-800/60 border-slate-700">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-sm text-slate-300">Pending Actions Required</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => setTab("tasks")} className="flex items-center justify-between p-3 rounded-lg bg-amber-900/20 border border-amber-800/40 hover:bg-amber-900/30 transition-colors">
                      <div>
                        <p className="text-xs text-amber-300">Pending Payments</p>
                        <p className="text-2xl font-bold text-amber-400">{tasks.taskCounts.pendingPayments}</p>
                      </div>
                      <ChevronRight size={16} className="text-amber-500" />
                    </button>
                    <button onClick={() => setTab("tasks")} className="flex items-center justify-between p-3 rounded-lg bg-orange-900/20 border border-orange-800/40 hover:bg-orange-900/30 transition-colors">
                      <div>
                        <p className="text-xs text-orange-300">Awaiting Finalization</p>
                        <p className="text-2xl font-bold text-orange-400">{tasks.taskCounts.pendingFinalizations}</p>
                      </div>
                      <ChevronRight size={16} className="text-orange-500" />
                    </button>
                    <button onClick={() => setTab("tasks")} className="flex items-center justify-between p-3 rounded-lg bg-red-900/20 border border-red-800/40 hover:bg-red-900/30 transition-colors">
                      <div>
                        <p className="text-xs text-red-300">Open Disputes</p>
                        <p className="text-2xl font-bold text-red-400">{tasks.taskCounts.openDisputes}</p>
                      </div>
                      <ChevronRight size={16} className="text-red-500" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* All-clear state */}
            {!summaryLoading && (summary?.totalAlerts ?? 0) === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle size={48} className="text-emerald-500 mb-4" />
                <p className="text-lg font-semibold text-emerald-400">All Clear</p>
                <p className="text-sm text-slate-400 mt-1">No active governance alerts detected across all settlement systems.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Alerts tab ───────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="flex-1 overflow-hidden m-0 flex flex-col">
          {/* Alert filters */}
          <div className="flex items-center gap-3 px-6 py-2.5 bg-slate-900/40 border-b border-slate-800 shrink-0">
            <Select value={filterCategory} onValueChange={v => setFilterCategory(v)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-7 w-48">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="__all__" className="text-slate-300 text-xs">All Categories</SelectItem>
                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-white text-xs">{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSeverity} onValueChange={v => setFilterSeverity(v)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-7 w-36">
                <SelectValue placeholder="All severities" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="__all__" className="text-slate-300 text-xs">All Severities</SelectItem>
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(s => (
                  <SelectItem key={s} value={s} className="text-white text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-slate-500">{alerts.length} alerts</span>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {alerts.length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  <CheckCircle size={32} className="mx-auto mb-3 text-emerald-600 opacity-60" />
                  <p className="text-sm">No alerts matching current filters</p>
                </div>
              ) : (
                alerts.map(a => <AlertCard key={a.id} alert={a} />)
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Task Center tab ───────────────────────────────────────────── */}
        <TabsContent value="tasks" className="flex-1 overflow-y-auto m-0">
          <div className="p-6 space-y-6">

            {/* Pending Payments */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                  <Clock size={14} /> Pending Payments
                  <span className="bg-amber-800 text-amber-200 text-xs px-1.5 rounded-full">{tasks?.taskCounts.pendingPayments ?? 0}</span>
                </h3>
                <span className="text-xs text-slate-500">Requires payment recording</span>
              </div>
              <div className="space-y-2">
                {tasks?.pendingPayments.length === 0 && (
                  <div className="text-center py-6 text-slate-600 text-sm">
                    <CheckCircle size={20} className="mx-auto mb-2 text-emerald-700" /> No pending payments
                  </div>
                )}
                {tasks?.pendingPayments.map(t => (
                  <TaskRow key={t.id as string} task={t} type="payment" />
                ))}
              </div>
            </div>

            <Separator className="bg-slate-800" />

            {/* Pending Finalizations */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-orange-300 flex items-center gap-2">
                  <FileWarning size={14} /> Awaiting Finalization
                  <span className="bg-orange-800 text-orange-200 text-xs px-1.5 rounded-full">{tasks?.taskCounts.pendingFinalizations ?? 0}</span>
                </h3>
                <span className="text-xs text-slate-500">Settlement records pending admin approval</span>
              </div>
              <div className="space-y-2">
                {tasks?.pendingFinalizations.length === 0 && (
                  <div className="text-center py-6 text-slate-600 text-sm">
                    <CheckCircle size={20} className="mx-auto mb-2 text-emerald-700" /> No pending finalizations
                  </div>
                )}
                {tasks?.pendingFinalizations.map(t => (
                  <TaskRow key={t.id as string} task={t} type="finalization" />
                ))}
              </div>
            </div>

            <Separator className="bg-slate-800" />

            {/* Open Disputes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-red-300 flex items-center gap-2">
                  <Scale size={14} /> Open Disputes
                  <span className="bg-red-800 text-red-200 text-xs px-1.5 rounded-full">{tasks?.taskCounts.openDisputes ?? 0}</span>
                </h3>
                <span className="text-xs text-slate-500">Requires resolution or reopen</span>
              </div>
              <div className="space-y-2">
                {tasks?.openDisputes.length === 0 && (
                  <div className="text-center py-6 text-slate-600 text-sm">
                    <CheckCircle size={20} className="mx-auto mb-2 text-emerald-700" /> No open disputes
                  </div>
                )}
                {tasks?.openDisputes.map(t => (
                  <TaskRow key={t.id as string} task={t} type="dispute" />
                ))}
              </div>
            </div>

            {tasks?.taskCounts.total === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle size={48} className="text-emerald-500 mb-4" />
                <p className="text-lg font-semibold text-emerald-400">All Tasks Cleared</p>
                <p className="text-sm text-slate-400 mt-1">No pending payments, finalizations, or disputes.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Discrepancies tab ─────────────────────────────────────────── */}
        <TabsContent value="discrepancies" className="flex-1 overflow-hidden m-0 flex flex-col">
          {/* Summary bar */}
          {disc && disc.total > 0 && (
            <div className="flex items-center justify-between px-6 py-3 bg-slate-900/40 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-400">Total discrepancy: <span className="text-orange-400 font-semibold">{fmt(disc.totalDiscrepancyAmount)}</span></span>
                {Object.entries(disc.flagCounts).map(([flag, count]) => count > 0 && (
                  <span key={flag} className={`text-xs ${DIFF_FLAG_CONFIG[flag as keyof typeof DIFF_FLAG_CONFIG]?.color ?? "text-slate-400"}`}>
                    {flag}: {count as number}
                  </span>
                ))}
              </div>
              <span className="text-xs text-slate-500">{disc.total} overridden records</span>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-4">
              {/* Table header */}
              {disc && disc.discrepancies.length > 0 && (
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 mb-2 text-xs text-slate-500 font-medium">
                  <span>Period / Project</span>
                  <span className="text-right">Recommended</span>
                  <span className="text-right">Actual</span>
                  <span className="text-right">Δ Difference</span>
                  <span>Flag</span>
                </div>
              )}
              <div className="space-y-2">
                {disc?.discrepancies.length === 0 && (
                  <div className="text-center py-16 text-slate-500">
                    <CheckCircle size={32} className="mx-auto mb-3 text-emerald-600 opacity-60" />
                    <p className="text-sm">No overridden settlements found</p>
                  </div>
                )}
                {disc?.discrepancies.map(d => (
                  <DiscrepancyRow key={d.id as string} d={d} />
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
