import { useState, useEffect } from "react";
import { useAuthFetch } from "../lib/authFetch";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import {
  BarChart3, Globe, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, Clock, Leaf, Package, DollarSign, Users,
  FileText, Zap, Activity, Target, Shield, ChevronRight,
  AlertCircle, Building2, Layers, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { useRole } from "../contexts/RoleContext";
import { useProjectFilter } from "../contexts/ProjectFilterContext";

const API = (path: string) => `/api/${path}`;

// ── Color palette ─────────────────────────────────────────────────────────
const COLORS = {
  emerald: "#10b981",
  blue: "#3b82f6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  cyan: "#06b6d4",
  orange: "#f97316",
  slate: "#94a3b8",
};

const PIE_COLORS = [COLORS.emerald, COLORS.blue, COLORS.amber, COLORS.rose, COLORS.violet, COLORS.cyan, COLORS.orange];

const SEVERITY_COLORS: Record<string, string> = {
  critical: COLORS.rose,
  high: COLORS.orange,
  medium: COLORS.amber,
  low: COLORS.slate,
};

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt = (n: number | string | undefined, prefix = "₹") =>
  `${prefix}${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const fmtKg = (n: number | string | undefined) =>
  `${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;

const fmtPct = (n: number | undefined) => `${(n ?? 0).toFixed(1)}%`;

const lifecycle: Record<string, { label: string; color: string }> = {
  prematurity: { label: "Pre-Maturity", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  mature_production: { label: "Mature Production", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  closed: { label: "Closed", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
};

const activation: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  draft: { label: "Draft", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  ready_for_activation: { label: "Ready", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  suspended: { label: "Suspended", color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  closed: { label: "Closed", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
};

const model: Record<string, { label: string; color: string }> = {
  ownership_contribution: { label: "Ownership & Contribution", color: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  fifty_percent_revenue: { label: "50% Revenue Split", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
};

// ── Sub-components ────────────────────────────────────────────────────────

function Badge({ text, colorClass }: { text: string; colorClass: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {text}
    </span>
  );
}

function KPICard({
  label, value, sub, icon: Icon, iconColor, trend, trendLabel,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-xs font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-slate-500 text-xs">{sub}</div>}
      {trendLabel && (
        <div className={`flex items-center gap-1 text-xs ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-slate-400"}`}>
          {trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : trend === "down" ? <ArrowDownRight className="w-3 h-3" /> : null}
          {trendLabel}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 bg-slate-700/50 rounded-lg">
        <Icon className="w-4 h-4 text-slate-300" />
      </div>
      <div>
        <div className="text-slate-200 font-semibold text-sm">{title}</div>
        {sub && <div className="text-slate-500 text-xs">{sub}</div>}
      </div>
    </div>
  );
}

function StatRow({ label, value, valueClass = "text-white" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`font-semibold text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}

const tipFmt = (v: number | string) =>
  `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// ── Tabs ──────────────────────────────────────────────────────────────────
const TABS = ["Overview", "Financial", "Operations", "Governance", "Efficiency"] as const;
type Tab = (typeof TABS)[number];

// ── Main Component ────────────────────────────────────────────────────────
export default function ProjectAnalytics() {
  const authFetch = useAuthFetch();
  const { role } = useRole();
  const { selectedProjectId, setSelectedProjectId } = useProjectFilter();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  // List of projects the user may see
  const { data: projectsData } = useQuery({
    queryKey: ["project-analytics-projects"],
    queryFn: () =>
      authFetch(API("project-analytics/projects"))
        .then((r) => r.json()) as Promise<{
          projects: { id: string; name: string; commercialModel: string; lifecycleStatus: string; activationStatus: string }[];
        }>,
  });

  const projects = projectsData?.projects ?? [];

  // Auto-select first project
  const [localProjectId, setLocalProjectId] = useState<string>("");
  useEffect(() => {
    if (projects.length > 0 && !localProjectId) {
      const first = selectedProjectId && projects.find((p) => p.id === selectedProjectId)
        ? selectedProjectId
        : projects[0].id;
      setLocalProjectId(first);
    }
  }, [projects, selectedProjectId, localProjectId]);

  // Analytics data
  const { data, isLoading, error } = useQuery({
    queryKey: ["project-analytics-overview", localProjectId],
    queryFn: () =>
      authFetch(API(`project-analytics/overview?projectId=${localProjectId}`))
        .then((r) => r.json()),
    enabled: !!localProjectId,
  });

  const isAdmin = role === "admin" || role === "developer";

  // ── Derived ───────────────────────────────────────────────────────────

  const project = data?.project;
  const production = data?.production;
  const inventory = data?.inventory;
  const expenditure = data?.expenditure;
  const revenue = data?.revenue;
  const profitability = data?.profitability;
  const partnerships = data?.partnerships;
  const agreements = data?.agreements;
  const settlements = data?.settlements;
  const governance = data?.governance;
  const pendingActions = data?.pendingActions;
  const monthlyTrend = data?.monthlyTrend ?? [];
  const lifecycleHistory = data?.lifecycleHistory ?? [];
  const invByType = inventory?.byStockType ?? [];
  const expByCat = expenditure?.byCategory ?? [];
  const expByPhase = expenditure?.byPhase ?? [];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-400" />
              Project Analytics
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Per-project performance reporting &amp; lifecycle insights
            </p>
          </div>

          {/* Project Selector */}
          <div className="flex items-center gap-2">
            <label className="text-slate-400 text-sm whitespace-nowrap">Project:</label>
            <select
              value={localProjectId}
              onChange={(e) => {
                setLocalProjectId(e.target.value);
                setSelectedProjectId(e.target.value);
              }}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[200px]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Project meta badges */}
        {project && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {project.projectCode && (
              <span className="text-slate-500 text-xs font-mono border border-slate-700 px-2 py-0.5 rounded">
                {project.projectCode}
              </span>
            )}
            <Badge text={lifecycle[project.lifecycleStatus]?.label ?? project.lifecycleStatus} colorClass={lifecycle[project.lifecycleStatus]?.color ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"} />
            <Badge text={activation[project.activationStatus]?.label ?? project.activationStatus} colorClass={activation[project.activationStatus]?.color ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"} />
            <Badge text={model[project.commercialModel]?.label ?? project.commercialModel} colorClass={model[project.commercialModel]?.color ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"} />
            <span className="text-slate-500 text-xs">{project.district}, {project.state}</span>
            <span className="text-slate-500 text-xs">• {project.landArea} {project.landAreaUnit} land</span>
            <span className="text-slate-500 text-xs">• {project.termYears}yr term</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mt-3 border-b border-slate-800 -mb-4 pb-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab
                  ? "text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-6">
        {!localProjectId && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Globe className="w-12 h-12 mb-3 opacity-30" />
            <p>Select a project to view analytics</p>
          </div>
        )}

        {localProjectId && isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Activity className="w-8 h-8 mb-3 animate-pulse opacity-40" />
            <p>Loading project analytics…</p>
          </div>
        )}

        {localProjectId && error && (
          <div className="flex flex-col items-center justify-center h-64 text-rose-400">
            <AlertCircle className="w-8 h-8 mb-3" />
            <p>Failed to load analytics data</p>
          </div>
        )}

        {localProjectId && data && (
          <>
            {/* ───────── OVERVIEW TAB ───────── */}
            {activeTab === "Overview" && (
              <div className="space-y-6">
                {/* Primary KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-4">
                  <KPICard
                    label="Total Revenue"
                    value={fmt(production?.totalRevenue)}
                    sub="From production sales"
                    icon={DollarSign}
                    iconColor="text-emerald-400"
                    trend="up"
                    trendLabel="All records"
                  />
                  <KPICard
                    label="Expenditure"
                    value={fmt(expenditure?.total)}
                    sub={`${expenditure?.count ?? 0} records`}
                    icon={TrendingDown}
                    iconColor="text-rose-400"
                  />
                  <KPICard
                    label="Operating Profit"
                    value={fmt(profitability?.operationalProfit)}
                    sub={`${fmtPct(profitability?.profitMargin)} margin`}
                    icon={TrendingUp}
                    iconColor={Number(profitability?.operationalProfit) >= 0 ? "text-emerald-400" : "text-rose-400"}
                    trend={Number(profitability?.operationalProfit) >= 0 ? "up" : "down"}
                  />
                  <KPICard
                    label="Production"
                    value={fmtKg(production?.totalProductionKg)}
                    sub={`${fmtKg(production?.totalSoldKg)} sold`}
                    icon={Leaf}
                    iconColor="text-emerald-400"
                  />
                  <KPICard
                    label="Sell-Through"
                    value={fmtPct(production?.sellThroughRate)}
                    sub={`${fmtKg(production?.currentStockKg)} in stock`}
                    icon={Package}
                    iconColor="text-amber-400"
                  />
                  <KPICard
                    label="Partners"
                    value={String(partnerships?.partnerCount ?? 0)}
                    sub={`${agreements?.active ?? 0} active agreements`}
                    icon={Users}
                    iconColor="text-violet-400"
                  />
                  <KPICard
                    label="Active Disputes"
                    value={String(governance?.disputes.active ?? 0)}
                    sub={`${governance?.disputes.critical ?? 0} critical`}
                    icon={AlertTriangle}
                    iconColor={Number(governance?.disputes.critical) > 0 ? "text-rose-400" : "text-amber-400"}
                    trend={Number(governance?.disputes.active) > 0 ? "down" : "neutral"}
                  />
                  <KPICard
                    label="Pending Tasks"
                    value={String(governance?.tasks.pending ?? 0)}
                    sub={`${governance?.tasks.overdue ?? 0} overdue`}
                    icon={Clock}
                    iconColor={Number(governance?.tasks.overdue) > 0 ? "text-rose-400" : "text-amber-400"}
                    trend={Number(governance?.tasks.overdue) > 0 ? "down" : "neutral"}
                  />
                </div>

                {/* Production + Expenditure Summary Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Production Summary */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Leaf} title="Production Summary" sub={`${production?.recordCount ?? 0} records`} />
                    <StatRow label="Total Produced" value={fmtKg(production?.totalProductionKg)} />
                    <StatRow label="Total Sold" value={fmtKg(production?.totalSoldKg)} />
                    <StatRow label="Current Stock" value={fmtKg(production?.currentStockKg)} valueClass="text-amber-400" />
                    <StatRow label="Avg Selling Price" value={`₹${Number(production?.avgSellingPrice ?? 0).toFixed(2)}/kg`} />
                    <StatRow label="Sell-Through Rate" value={fmtPct(production?.sellThroughRate)} valueClass={Number(production?.sellThroughRate) >= 80 ? "text-emerald-400" : "text-amber-400"} />
                    <StatRow label="Est. Stock Value" value={fmt(production?.estimatedStockValue)} valueClass="text-cyan-400" />
                  </div>

                  {/* Inventory Summary */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Package} title="Inventory Summary" sub={`${inventory?.movementCount ?? 0} movements`} />
                    <StatRow label="Total Stock-In" value={`${Number(inventory?.totalIn ?? 0).toFixed(1)} units`} valueClass="text-emerald-400" />
                    <StatRow label="Total Stock-Out" value={`${Number(inventory?.totalOut ?? 0).toFixed(1)} units`} valueClass="text-rose-400" />
                    <StatRow label="Net Balance" value={`${Number(inventory?.balance ?? 0).toFixed(1)} units`} valueClass="text-amber-400" />
                    {invByType.map((s: { stockType: string; unit: string; totalIn: number; totalOut: number; balance: number }) => (
                      <StatRow
                        key={s.stockType}
                        label={`  └─ ${s.stockType.replace(/_/g, " ")}`}
                        value={`${s.balance.toFixed(1)} ${s.unit}`}
                        valueClass="text-slate-300"
                      />
                    ))}
                  </div>

                  {/* Ownership & Partnerships */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Users} title="Ownership Participation" sub={`${partnerships?.partnerCount ?? 0} partners`} />
                    {partnerships?.partners?.slice(0, 5).map((p: { id: string; name: string; role: string }) => (
                      <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0">
                        <span className="text-slate-300 text-sm truncate max-w-[150px]">{p.name}</span>
                        <Badge
                          text={p.role.replace(/_/g, " ")}
                          colorClass={p.role === "landowner" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : p.role === "developer" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-violet-500/20 text-violet-400 border-violet-500/30"}
                        />
                      </div>
                    ))}
                    {partnerships?.partnerCount === 0 && (
                      <p className="text-slate-500 text-sm text-center py-4">No partners linked</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <StatRow label="Total Contributions" value={fmt(partnerships?.contributions.totalAmount)} />
                      <StatRow label="Verified" value={fmt(partnerships?.contributions.verified)} valueClass="text-emerald-400" />
                    </div>
                  </div>
                </div>

                {/* Settlement + Governance Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Settlement History */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={FileText} title="Settlement History" sub="Distribution & LCA" />
                    {project?.commercialModel === "ownership_contribution" ? (
                      <>
                        <StatRow label="LCA Total Due" value={fmt(settlements?.lca.totalDue)} />
                        <StatRow label="LCA Total Paid" value={fmt(settlements?.lca.totalPaid)} valueClass="text-emerald-400" />
                        <StatRow label="LCA Pending" value={fmt(settlements?.lca.totalPending)} valueClass={Number(settlements?.lca.totalPending) > 0 ? "text-amber-400" : "text-emerald-400"} />
                        <StatRow label="LCA Entries" value={String(settlements?.lca.entryCount ?? 0)} />
                        <div className="mt-2 pt-2 border-t border-slate-700/50">
                          <StatRow label="Settlement Records" value={String(settlements?.records.total ?? 0)} />
                          <StatRow label="Finalized" value={String(settlements?.records.finalized ?? 0)} valueClass="text-emerald-400" />
                          <StatRow label="Completion Rate" value={fmtPct(settlements?.records.completionRate)} valueClass={Number(settlements?.records.completionRate) >= 90 ? "text-emerald-400" : "text-amber-400"} />
                        </div>
                      </>
                    ) : (
                      <>
                        <StatRow label="50% Sessions" value={String((settlements?.records.total ?? 0))} />
                        <StatRow label="Gross Revenue" value={fmt(revenue?.fiftyPctGross)} />
                        <StatRow label="Landowner Net" value={fmt(revenue?.fiftyPctLandownerNet)} valueClass="text-emerald-400" />
                        <StatRow label="Pool Share" value={fmt(revenue?.fiftyPctPoolShare)} valueClass="text-violet-400" />
                        <StatRow label="Confirmed Sessions" value={String(revenue?.confirmedSessions ?? 0)} valueClass="text-emerald-400" />
                        <StatRow label="Draft Sessions" value={String(revenue?.draftSessions ?? 0)} valueClass="text-amber-400" />
                      </>
                    )}
                  </div>

                  {/* Governance Status */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Shield} title="Governance Status" sub="Disputes & tasks" />
                    <StatRow label="Total Disputes" value={String(governance?.disputes.total ?? 0)} />
                    <StatRow label="Active Disputes" value={String(governance?.disputes.active ?? 0)} valueClass={Number(governance?.disputes.active) > 0 ? "text-amber-400" : "text-emerald-400"} />
                    <StatRow label="Escalated" value={String(governance?.disputes.escalated ?? 0)} valueClass={Number(governance?.disputes.escalated) > 0 ? "text-rose-400" : "text-emerald-400"} />
                    <StatRow label="Critical" value={String(governance?.disputes.critical ?? 0)} valueClass={Number(governance?.disputes.critical) > 0 ? "text-rose-400" : "text-emerald-400"} />
                    <div className="mt-2 pt-2 border-t border-slate-700/50">
                      <StatRow label="Total Tasks" value={String(governance?.tasks.total ?? 0)} />
                      <StatRow label="Completed" value={String(governance?.tasks.completed ?? 0)} valueClass="text-emerald-400" />
                      <StatRow label="Overdue" value={String(governance?.tasks.overdue ?? 0)} valueClass={Number(governance?.tasks.overdue) > 0 ? "text-rose-400" : "text-emerald-400"} />
                      <StatRow label="Task Completion" value={fmtPct(governance?.tasks.completionRate)} valueClass={Number(governance?.tasks.completionRate) >= 80 ? "text-emerald-400" : "text-amber-400"} />
                    </div>
                  </div>

                  {/* Pending Actions */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={AlertCircle} title="Pending Actions" sub="Requires attention" />
                    {pendingActions?.disputes.length === 0 && pendingActions?.tasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-6 text-emerald-400">
                        <CheckCircle2 className="w-8 h-8 mb-2" />
                        <p className="text-sm">No pending actions</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {pendingActions?.disputes.map((d: { id: string; title: string; severity: string; status: string }) => (
                          <div key={d.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/40 border border-slate-700/50">
                            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: SEVERITY_COLORS[d.severity] ?? COLORS.slate }} />
                            <div className="min-w-0">
                              <p className="text-slate-200 text-xs font-medium truncate">{d.title}</p>
                              <p className="text-slate-500 text-xs capitalize">{d.status.replace(/_/g, " ")} • {d.severity}</p>
                            </div>
                          </div>
                        ))}
                        {pendingActions?.tasks.map((t: { id: string; title: string; priority: string; status: string; dueDate?: string }) => (
                          <div key={t.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/40 border border-slate-700/50">
                            <Clock className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-slate-200 text-xs font-medium truncate">{t.title}</p>
                              <p className="text-slate-500 text-xs capitalize">{t.status.replace(/_/g, " ")} • {t.priority}</p>
                            </div>
                          </div>
                        ))}
                        <div className="mt-2 pt-2 border-t border-slate-700/50">
                          <StatRow label="Pending Settlement" value={fmt(pendingActions?.pendingSettlementAmount)} valueClass="text-amber-400" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Monthly Trend Chart */}
                {monthlyTrend.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="Monthly Revenue vs Expenditure" sub={`${monthlyTrend.length} months`} />
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={monthlyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.emerald} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradExp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.rose} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={COLORS.rose} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                          labelStyle={{ color: "#94a3b8" }}
                          formatter={(v: number) => [tipFmt(v)]}
                        />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.emerald} fill="url(#gradRev)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="expenditure" name="Expenditure" stroke={COLORS.rose} fill="url(#gradExp)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="profit" name="Profit" stroke={COLORS.blue} fill="url(#gradProfit)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* ───────── FINANCIAL TAB ───────── */}
            {activeTab === "Financial" && (
              <div className="space-y-6">
                {/* Financial KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Total Revenue" value={fmt(production?.totalRevenue)} sub="From sales" icon={DollarSign} iconColor="text-emerald-400" />
                  <KPICard label="Total Expenditure" value={fmt(expenditure?.total)} sub={`${expenditure?.count} entries`} icon={TrendingDown} iconColor="text-rose-400" />
                  <KPICard label="Operating Profit" value={fmt(profitability?.operationalProfit)} sub={`${fmtPct(profitability?.profitMargin)} margin`} icon={TrendingUp} iconColor="text-blue-400" />
                  <KPICard label="Verified Expenditure" value={fmt(expenditure?.verified)} sub={`${fmt(expenditure?.draft)} pending`} icon={CheckCircle2} iconColor="text-emerald-400" />
                </div>

                {/* Revenue vs Expenditure trend */}
                {monthlyTrend.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="Revenue & Expenditure Trend" sub="18-month view" />
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={monthlyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                          labelStyle={{ color: "#94a3b8" }}
                          formatter={(v: number) => [tipFmt(v)]}
                        />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Bar dataKey="revenue" name="Revenue" fill={COLORS.emerald} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="expenditure" name="Expenditure" fill={COLORS.rose} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Expenditure breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* By Category */}
                  {expByCat.length > 0 && (
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                      <SectionTitle icon={Layers} title="Expenditure by Category" />
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie data={expByCat} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={85} label={({ category, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {expByCat.map((_: unknown, i: number) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                            formatter={(v: number) => [tipFmt(v)]}
                          />
                          <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* By Lifecycle Phase */}
                  {expByPhase.length > 0 && (
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                      <SectionTitle icon={Activity} title="Expenditure by Lifecycle Phase" />
                      <div className="space-y-3 mt-2">
                        {expByPhase.map((p: { phase: string; total: number; count: number }) => {
                          const total = expByPhase.reduce((s: number, x: { total: number }) => s + x.total, 0);
                          const pct = total > 0 ? (p.total / total) * 100 : 0;
                          return (
                            <div key={p.phase}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-slate-300 capitalize">{(p.phase ?? "Unknown").replace(/_/g, " ")}</span>
                                <span className="text-slate-400">{fmt(p.total)} ({p.count})</span>
                              </div>
                              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Settlement Analysis */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={FileText} title="LCA Settlement" sub="Land Contribution Adjustments" />
                    <StatRow label="Total Due" value={fmt(settlements?.lca.totalDue)} />
                    <StatRow label="Total Paid" value={fmt(settlements?.lca.totalPaid)} valueClass="text-emerald-400" />
                    <StatRow label="Outstanding" value={fmt(settlements?.lca.totalPending)} valueClass={Number(settlements?.lca.totalPending) > 0 ? "text-amber-400" : "text-emerald-400"} />
                    <StatRow label="LCA Entries" value={String(settlements?.lca.entryCount)} />
                    <StatRow label="Pending Entries" value={String(settlements?.lca.pendingCount)} valueClass={Number(settlements?.lca.pendingCount) > 0 ? "text-amber-400" : "text-emerald-400"} />
                  </div>

                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={DollarSign} title="Distribution Records" sub="Partner payouts" />
                    <StatRow label="Total Paid Out" value={fmt(settlements?.distribution.totalPaid)} valueClass="text-emerald-400" />
                    <StatRow label="Total Pending" value={fmt(settlements?.distribution.totalPending)} valueClass={Number(settlements?.distribution.totalPending) > 0 ? "text-amber-400" : "text-emerald-400"} />
                    <StatRow label="Paid Records" value={String(settlements?.distribution.paidCount)} valueClass="text-emerald-400" />
                    <StatRow label="Pending Records" value={String(settlements?.distribution.pendingCount)} valueClass={Number(settlements?.distribution.pendingCount) > 0 ? "text-amber-400" : "text-emerald-400"} />
                  </div>

                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={CheckCircle2} title="Settlement Records" sub="Finalization status" />
                    <StatRow label="Total Records" value={String(settlements?.records.total)} />
                    <StatRow label="Finalized" value={String(settlements?.records.finalized)} valueClass="text-emerald-400" />
                    <StatRow label="Disputed" value={String(settlements?.records.disputed)} valueClass={Number(settlements?.records.disputed) > 0 ? "text-rose-400" : "text-emerald-400"} />
                    <StatRow label="Overridden" value={String(settlements?.records.overridden)} valueClass={Number(settlements?.records.overridden) > 0 ? "text-amber-400" : "text-emerald-400"} />
                    <StatRow label="Total Finalized" value={fmt(settlements?.records.totalActual)} valueClass="text-emerald-400" />
                    <StatRow label="Completion Rate" value={fmtPct(settlements?.records.completionRate)} valueClass={Number(settlements?.records.completionRate) >= 90 ? "text-emerald-400" : "text-amber-400"} />
                  </div>
                </div>
              </div>
            )}

            {/* ───────── OPERATIONS TAB ───────── */}
            {activeTab === "Operations" && (
              <div className="space-y-6">
                {/* Ops KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Total Produced" value={fmtKg(production?.totalProductionKg)} sub={`${production?.recordCount} records`} icon={Leaf} iconColor="text-emerald-400" />
                  <KPICard label="Total Sold" value={fmtKg(production?.totalSoldKg)} sub={`${fmtPct(production?.sellThroughRate)} sell-through`} icon={TrendingUp} iconColor="text-blue-400" />
                  <KPICard label="Avg Price" value={`₹${Number(production?.avgSellingPrice ?? 0).toFixed(2)}/kg`} sub="Across all records" icon={DollarSign} iconColor="text-amber-400" />
                  <KPICard label="Stock Balance" value={fmtKg(inventory?.balance)} sub={`${inventory?.movementCount} movements`} icon={Package} iconColor="text-violet-400" />
                </div>

                {/* Monthly production chart */}
                {monthlyTrend.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Leaf} title="Monthly Production vs Sales" sub="18-month view" />
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={monthlyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)} kg`} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                          labelStyle={{ color: "#94a3b8" }}
                          formatter={(v: number) => [`${v.toFixed(1)} kg`]}
                        />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Bar dataKey="productionKg" name="Produced (kg)" fill={COLORS.emerald} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="soldKg" name="Sold (kg)" fill={COLORS.blue} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Inventory by stock type */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Package} title="Inventory by Stock Type" />
                    {invByType.length === 0 ? (
                      <p className="text-slate-500 text-sm text-center py-6">No inventory data</p>
                    ) : (
                      <div className="space-y-4">
                        {invByType.map((s: { stockType: string; unit: string; totalIn: number; totalOut: number; balance: number }) => (
                          <div key={s.stockType} className="p-3 rounded-lg bg-slate-900/40 border border-slate-700/50">
                            <div className="flex justify-between mb-2">
                              <span className="text-slate-200 text-sm font-medium capitalize">{s.stockType.replace(/_/g, " ")}</span>
                              <span className="text-amber-400 text-sm font-semibold">{s.balance.toFixed(1)} {s.unit}</span>
                            </div>
                            <div className="flex gap-4 text-xs text-slate-500">
                              <span>In: <span className="text-emerald-400">{s.totalIn.toFixed(1)}</span></span>
                              <span>Out: <span className="text-rose-400">{s.totalOut.toFixed(1)}</span></span>
                              <span>Balance: <span className="text-amber-400">{s.balance.toFixed(1)} {s.unit}</span></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Activity} title="Task Health" sub={`${governance?.tasks.total ?? 0} total tasks`} />
                    <div className="space-y-3">
                      {[
                        { label: "Completed", value: governance?.tasks.completed ?? 0, color: "bg-emerald-500", total: governance?.tasks.total ?? 1 },
                        { label: "In Progress", value: governance?.tasks.inProgress ?? 0, color: "bg-blue-500", total: governance?.tasks.total ?? 1 },
                        { label: "Pending", value: governance?.tasks.pending ?? 0, color: "bg-amber-500", total: governance?.tasks.total ?? 1 },
                        { label: "Overdue", value: governance?.tasks.overdue ?? 0, color: "bg-rose-500", total: governance?.tasks.total ?? 1 },
                      ].map((item) => (
                        <div key={item.label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-300">{item.label}</span>
                            <span className="text-slate-400">{item.value}</span>
                          </div>
                          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${item.color} rounded-full transition-all`}
                              style={{ width: `${item.total > 0 ? (item.value / item.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {pendingActions?.tasks.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-700/50">
                        <p className="text-slate-400 text-xs mb-2">Upcoming tasks</p>
                        {pendingActions.tasks.map((t: { id: string; title: string; priority: string; status: string; dueDate?: string }) => (
                          <div key={t.id} className="flex items-center gap-2 py-1.5">
                            <Clock className="w-3 h-3 text-amber-400 flex-shrink-0" />
                            <span className="text-slate-300 text-xs truncate flex-1">{t.title}</span>
                            <Badge
                              text={t.priority}
                              colorClass={t.priority === "urgent" ? "bg-rose-500/20 text-rose-400 border-rose-500/30" : t.priority === "high" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-slate-500/20 text-slate-400 border-slate-500/30"}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Agreements */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={FileText} title="Agreements" sub={`${agreements?.total ?? 0} total`} />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
                    {[
                      { label: "Total", value: agreements?.total ?? 0, color: "text-white" },
                      { label: "Active", value: agreements?.active ?? 0, color: "text-emerald-400" },
                      { label: "Draft", value: agreements?.draft ?? 0, color: "text-amber-400" },
                      { label: "Terminated", value: agreements?.terminated ?? 0, color: "text-slate-400" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center p-3 bg-slate-900/40 rounded-lg border border-slate-700/50">
                        <div className={`text-2xl font-bold ${color}`}>{value}</div>
                        <div className="text-slate-500 text-xs mt-1">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ───────── GOVERNANCE TAB ───────── */}
            {activeTab === "Governance" && (
              <div className="space-y-6">
                {/* Governance KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Active Disputes" value={String(governance?.disputes.active ?? 0)} sub={`${governance?.disputes.total ?? 0} total`} icon={AlertTriangle} iconColor={Number(governance?.disputes.active) > 0 ? "text-rose-400" : "text-emerald-400"} />
                  <KPICard label="Escalated" value={String(governance?.disputes.escalated ?? 0)} sub="Require urgent attention" icon={AlertCircle} iconColor={Number(governance?.disputes.escalated) > 0 ? "text-rose-400" : "text-emerald-400"} />
                  <KPICard label="Task Completion" value={fmtPct(governance?.tasks.completionRate)} sub={`${governance?.tasks.overdue ?? 0} overdue`} icon={Target} iconColor={Number(governance?.tasks.completionRate) >= 80 ? "text-emerald-400" : "text-amber-400"} />
                  <KPICard label="Pending Settlement" value={fmt(pendingActions?.pendingSettlementAmount)} sub={`${pendingActions?.pendingSettlementCount ?? 0} items`} icon={DollarSign} iconColor={Number(pendingActions?.pendingSettlementAmount) > 0 ? "text-amber-400" : "text-emerald-400"} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Dispute breakdown */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={AlertTriangle} title="Dispute Breakdown" sub={`${governance?.disputes.total ?? 0} disputes`} />
                    {governance?.disputes.total === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-emerald-400">
                        <CheckCircle2 className="w-10 h-10 mb-2" />
                        <p className="text-sm">No disputes recorded</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[
                          { label: "Open", value: governance?.disputes.open ?? 0, color: COLORS.amber },
                          { label: "Under Review", value: governance?.disputes.underReview ?? 0, color: COLORS.blue },
                          { label: "Escalated", value: governance?.disputes.escalated ?? 0, color: COLORS.rose },
                          { label: "Resolved", value: governance?.disputes.resolved ?? 0, color: COLORS.emerald },
                        ].map(({ label, value, color }) => {
                          const pct = (governance?.disputes.total ?? 0) > 0 ? (value / (governance?.disputes.total ?? 1)) * 100 : 0;
                          return (
                            <div key={label}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-slate-300">{label}</span>
                                <span className="text-slate-400">{value}</span>
                              </div>
                              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Active disputes list */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={AlertCircle} title="Active Disputes" sub="Latest 5" />
                    {pendingActions?.disputes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-emerald-400">
                        <Shield className="w-10 h-10 mb-2" />
                        <p className="text-sm">No active disputes</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {pendingActions?.disputes.map((d: { id: string; title: string; disputeType: string; severity: string; status: string; raisedAt?: string }) => (
                          <div key={d.id} className="p-3 rounded-lg bg-slate-900/40 border border-slate-700/50">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="text-slate-200 text-sm font-medium truncate">{d.title}</span>
                              <Badge
                                text={d.severity}
                                colorClass={
                                  d.severity === "critical" ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                                    : d.severity === "high" ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                    : d.severity === "medium" ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                    : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                                }
                              />
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="capitalize">{d.disputeType?.replace(/_/g, " ")}</span>
                              <span>•</span>
                              <span className="capitalize">{d.status?.replace(/_/g, " ")}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Lifecycle history */}
                {lifecycleHistory.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Activity} title="Lifecycle History" sub={`${lifecycleHistory.length} transitions`} />
                    <div className="space-y-3">
                      {lifecycleHistory.map((h: { fromStatus: string | null; toStatus: string; changedAt: string; remarks: string | null; changedByName: string | null }, i: number) => (
                        <div key={i} className="flex items-start gap-4 p-3 rounded-lg bg-slate-900/40 border border-slate-700/50">
                          <div className="flex flex-col items-center gap-1 pt-1">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            {i < lifecycleHistory.length - 1 && <div className="w-0.5 h-8 bg-slate-700" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {h.fromStatus && (
                                <>
                                  <Badge text={lifecycle[h.fromStatus]?.label ?? h.fromStatus} colorClass={lifecycle[h.fromStatus]?.color ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"} />
                                  <ChevronRight className="w-3 h-3 text-slate-500" />
                                </>
                              )}
                              <Badge text={lifecycle[h.toStatus]?.label ?? h.toStatus} colorClass={lifecycle[h.toStatus]?.color ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"} />
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                              <span>{new Date(h.changedAt).toLocaleDateString("en-IN")}</span>
                              {h.changedByName && <span>by {h.changedByName}</span>}
                              {h.remarks && <span>— {h.remarks}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ───────── EFFICIENCY TAB ───────── */}
            {activeTab === "Efficiency" && (
              <div className="space-y-6">
                {/* Efficiency KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Revenue / kg Sold" value={`₹${profitability?.revenuePerKg ?? 0}/kg`} sub="Avg realisation per kg" icon={Zap} iconColor="text-emerald-400" />
                  <KPICard label="Expenditure / kg" value={`₹${profitability?.expenditurePerKg ?? 0}/kg`} sub="Cost per kg produced" icon={TrendingDown} iconColor="text-rose-400" />
                  <KPICard label="Profit Margin" value={fmtPct(profitability?.profitMargin)} sub="Operating margin" icon={Target} iconColor={Number(profitability?.profitMargin) >= 20 ? "text-emerald-400" : "text-amber-400"} />
                  <KPICard label="Sell-Through Rate" value={fmtPct(production?.sellThroughRate)} sub={`${fmtKg(production?.currentStockKg)} unsold`} icon={Package} iconColor={Number(production?.sellThroughRate) >= 80 ? "text-emerald-400" : "text-amber-400"} />
                </div>

                {/* Revenue per kg trend */}
                {monthlyTrend.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Zap} title="Revenue per kg Sold (Monthly)" sub="Realisation efficiency over time" />
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={monthlyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                          labelStyle={{ color: "#94a3b8" }}
                          formatter={(v: number) => [`₹${v.toFixed(2)}/kg`]}
                        />
                        <Line type="monotone" dataKey="revenuePerKg" name="₹/kg" stroke={COLORS.emerald} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="avgPrice" name="Avg Price" stroke={COLORS.amber} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Profitability profile + Lifecycle profitability */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="Profitability Profile" />
                    <div className="space-y-4 mt-2">
                      {[
                        { label: "Total Revenue", value: fmt(production?.totalRevenue), pct: 100, color: "bg-emerald-500" },
                        { label: "Total Expenditure", value: fmt(expenditure?.total), pct: Number(production?.totalRevenue) > 0 ? (Number(expenditure?.total) / Number(production?.totalRevenue)) * 100 : 0, color: "bg-rose-500" },
                        { label: "Operating Profit", value: fmt(profitability?.operationalProfit), pct: Math.max(0, Number(profitability?.profitMargin)), color: "bg-blue-500" },
                      ].map(({ label, value, pct, color }) => (
                        <div key={label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-300">{label}</span>
                            <span className="text-slate-400">{value}</span>
                          </div>
                          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-2">
                        <StatRow label="Revenue / kg Sold" value={`₹${profitability?.revenuePerKg ?? 0}`} valueClass="text-emerald-400" />
                        <StatRow label="Expenditure / kg Produced" value={`₹${profitability?.expenditurePerKg ?? 0}`} valueClass="text-rose-400" />
                        <StatRow label="Estimated Stock Value" value={fmt(production?.estimatedStockValue)} valueClass="text-cyan-400" />
                      </div>
                    </div>
                  </div>

                  {/* Radar: performance scorecard */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Target} title="Performance Scorecard" sub="Normalised 0–100" />
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={[
                        { metric: "Sell-Through", score: Math.min(100, Number(production?.sellThroughRate ?? 0)) },
                        { metric: "Margin", score: Math.min(100, Math.max(0, Number(profitability?.profitMargin ?? 0))) },
                        { metric: "Tasks", score: Math.min(100, Number(governance?.tasks.completionRate ?? 0)) },
                        { metric: "Settlements", score: Math.min(100, Number(settlements?.records.completionRate ?? 0)) },
                        { metric: "Agreements", score: Math.min(100, agreements?.total > 0 ? (agreements?.active / agreements?.total) * 100 : 0) },
                        { metric: "Disputes", score: Math.max(0, 100 - Number(governance?.disputes.active ?? 0) * 15) },
                      ]}>
                        <PolarGrid stroke="#334155" />
                        <PolarAngleAxis dataKey="metric" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="Score" dataKey="score" stroke={COLORS.emerald} fill={COLORS.emerald} fillOpacity={0.25} strokeWidth={2} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} labelStyle={{ color: "#94a3b8" }} formatter={(v: number) => [`${v.toFixed(1)}/100`]} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
