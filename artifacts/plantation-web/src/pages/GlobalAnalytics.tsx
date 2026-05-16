/**
 * GlobalAnalytics.tsx
 *
 * Advanced Global Business Analytics Dashboard — Admin & Developer only.
 *
 * Five tabs:
 *   Overview     — 9 KPI cards across all modules + operational health
 *   Financial    — Monthly revenue vs expenditure trend + allocation breakdown
 *   Operations   — Production metrics, stock position, task health
 *   Governance   — Disputes by severity/type, pending settlements breakdown
 *   Projects     — Per-project comparison chart + summary table
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadialBarChart, RadialBar,
} from "recharts";
import {
  TrendingUp, TrendingDown, IndianRupee, RefreshCw,
  BarChart3, Activity, Globe, AlertTriangle, CheckCircle,
  Package, Scale, ShieldAlert, Layers, ArrowUpRight, ArrowDownRight,
  Minus, Warehouse, ClipboardList, FolderOpen,
} from "lucide-react";
import { useLocation } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────

interface GlobalOverview {
  projects: {
    total: number;
    byActivation: { active: number; draft: number; suspended: number; closed: number; readyForActivation: number };
    byLifecycle: { prematurity: number; matureProduction: number; closed: number };
    byModel: { ownershipContribution: number; fiftyPctRevenue: number };
  };
  revenue: {
    total: string; totalProductionKg: string; totalSoldKg: string;
    avgSellingPrice: string; recordCount: number;
  };
  expenditure: {
    total: string; verified: string; draft: string; count: number;
    byCategory: { category: string; total: number }[];
  };
  operationalProfit: { total: string; margin: number };
  distributableProfit: {
    grossRevenue: string; poolShare: string; landownerNet: string; confirmedSessions: number;
  };
  pendingSettlements: {
    totalAmount: string; totalCount: number;
    distributionPending: string; distributionCount: number;
    lcaPending: string; lcaCount: number;
    distributionPaid: string; paidCount: number;
  };
  stock: {
    totalProductionKg: string; totalSoldKg: string; currentStockKg: string;
    avgSellingPrice: string; estimatedStockValue: string;
  };
  disputes: {
    total: number; active: number; open: number; underReview: number;
    escalated: number; resolved: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
  };
  tasks: {
    total: number; pending: number; inProgress: number; completed: number;
    overdue: number; completionRate: number;
  };
  monthlyTrend: {
    month: string; revenue: number; expenditure: number; profit: number;
    productionKg: number; soldKg: number;
  }[];
  projectComparison: {
    projectId: string | null; projectName: string;
    revenue: number; expenditure: number; profit: number;
    productionKg: number; soldKg: number;
  }[];
}

// ── Formatters ──────────────────────────────────────────────────────────────

const fmtINR = (v: unknown, compact = false) => {
  const n = parseFloat(String(v ?? "0")) || 0;
  if (compact) {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
    if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
    if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
    return `₹${n.toFixed(0)}`;
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
};

const fmtKg = (v: unknown) => {
  const n = parseFloat(String(v ?? "0")) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M kg`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K kg`;
  return `${n.toFixed(0)} kg`;
};

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

// ── Design tokens ───────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "11px",
};

const C = {
  revenue: "#6366f1",
  expenditure: "#f59e0b",
  profit: "#10b981",
  production: "#3b82f6",
  sold: "#22c55e",
  stock: "#8b5cf6",
  pending: "#f97316",
  resolved: "#64748b",
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const CATEGORY_COLORS = [
  "#6366f1", "#10b981", "#3b82f6", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#22c55e", "#ef4444",
];

// ── KPI Card ────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
}
function KpiCard({ label, value, sub, icon, accent, trend, onClick }: KpiProps) {
  return (
    <Card
      className={`bg-slate-800/60 border-slate-700/80 transition-all ${onClick ? "cursor-pointer hover:bg-slate-700/60 hover:border-slate-600" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={`p-2 rounded-lg bg-slate-700/60 ${accent}`}>{icon}</div>
          {trend && trend !== "neutral" && (
            <span className={`text-xs ${trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
              {trend === "up" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className={`text-xl font-bold tabular-nums mt-0.5 ${accent}`}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-1 leading-snug">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Section header ──────────────────────────────────────────────────────────

function SH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Chart tooltip ───────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="p-3 shadow-2xl rounded-lg">
      <p className="text-xs text-slate-400 mb-2 font-medium">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-slate-300">{p.name}</span>
          </span>
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>
            {p.name.includes("Kg") || p.name.includes("kg") ? fmtKg(p.value) : fmtINR(p.value, true)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyChart({ height = 200 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center text-slate-600 text-sm" style={{ height }}>
      No data available yet
    </div>
  );
}

// ── Stat row ────────────────────────────────────────────────────────────────

function StatRow({ label, value, valueClass = "text-slate-200" }: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/60 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-xs font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

// ── Severity badge ──────────────────────────────────────────────────────────

function SeverityBadge({ level, count }: { level: string; count: number }) {
  const cls = level === "critical" ? "border-red-500/60 text-red-400 bg-red-500/10"
    : level === "high" ? "border-orange-500/60 text-orange-400 bg-orange-500/10"
    : level === "medium" ? "border-yellow-500/60 text-yellow-400 bg-yellow-500/10"
    : "border-green-500/60 text-green-400 bg-green-500/10";
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${cls}`}>
      <span className="text-xs font-medium capitalize">{level}</span>
      <span className="text-sm font-bold tabular-nums">{count}</span>
    </div>
  );
}

// ── Fetch hook ─────────────────────────────────────────────────────────────

function useGlobalOverview() {
  return useQuery<GlobalOverview>({
    queryKey: ["global-analytics-overview"],
    queryFn: async () => {
      const res = await fetch("/api/global-analytics/overview", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch global analytics");
      return res.json() as Promise<GlobalOverview>;
    },
    staleTime: 60_000,
  });
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function GlobalAnalytics() {
  const [tab, setTab] = useState("overview");
  const [, navigate] = useLocation();
  const { data, isLoading, refetch, isError } = useGlobalOverview();

  const d = data;

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-red-400 text-sm">
        Failed to load analytics data. Check your permissions or try refreshing.
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────

  const totalRevenue = parseFloat(d?.revenue.total ?? "0");
  const totalExpenditure = parseFloat(d?.expenditure.total ?? "0");
  const operationalProfit = parseFloat(d?.operationalProfit.total ?? "0");
  const profitMargin = d?.operationalProfit.margin ?? 0;

  const activeDisputes = d?.disputes.active ?? 0;
  const taskRate = d?.tasks.completionRate ?? 0;

  // Health score (0-100): penalise open disputes, overdue tasks, pending settlements
  const healthScore = Math.max(0, Math.min(100,
    100
    - (d?.disputes.escalated ?? 0) * 10
    - (d?.disputes.open ?? 0) * 3
    - Math.min(30, (d?.tasks.overdue ?? 0) * 5)
    - ((d?.pendingSettlements.totalCount ?? 0) > 10 ? 10 : 0)
    + (taskRate > 80 ? 5 : 0)
  ));

  const healthColor = healthScore >= 80 ? "text-emerald-400" : healthScore >= 60 ? "text-yellow-400" : "text-red-400";
  const healthLabel = healthScore >= 80 ? "Healthy" : healthScore >= 60 ? "Attention Needed" : "Critical";

  // Build activation breakdown for pie
  const activationData = [
    { name: "Active", value: d?.projects.byActivation.active ?? 0, fill: "#10b981" },
    { name: "Draft", value: d?.projects.byActivation.draft ?? 0, fill: "#6366f1" },
    { name: "Ready", value: d?.projects.byActivation.readyForActivation ?? 0, fill: "#3b82f6" },
    { name: "Suspended", value: d?.projects.byActivation.suspended ?? 0, fill: "#f59e0b" },
    { name: "Closed", value: d?.projects.byActivation.closed ?? 0, fill: "#64748b" },
  ].filter(x => x.value > 0);

  const expCategoryData = (d?.expenditure.byCategory ?? []).map((c, i) => ({
    name: c.category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
    value: c.total,
    fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const taskRadialData = [
    { name: "Completed", value: taskRate, fill: "#10b981" },
  ];

  const disputeSeverityData = [
    { name: "Critical", value: d?.disputes.bySeverity.critical ?? 0, fill: C.critical },
    { name: "High", value: d?.disputes.bySeverity.high ?? 0, fill: C.high },
    { name: "Medium", value: d?.disputes.bySeverity.medium ?? 0, fill: C.medium },
    { name: "Low", value: d?.disputes.bySeverity.low ?? 0, fill: C.low },
  ].filter(x => x.value > 0);

  const monthlyTrend = d?.monthlyTrend ?? [];
  const projectComparison = (d?.projectComparison ?? []).slice(0, 8);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Globe size={18} className="text-indigo-400" />
            Global Business Analytics
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Cross-module intelligence — all projects, all commercial models
          </p>
        </div>
        <Button
          size="sm" variant="ghost"
          className="text-slate-400 hover:text-white text-xs h-8"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw size={12} className={`mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="bg-slate-900 border-b border-slate-800 rounded-none justify-start px-6 shrink-0 h-10">
          {[
            { value: "overview",    label: "Overview",    icon: <BarChart3 size={12} /> },
            { value: "financial",   label: "Financial",   icon: <IndianRupee size={12} /> },
            { value: "operations",  label: "Operations",  icon: <Activity size={12} /> },
            { value: "governance",  label: "Governance",  icon: <ShieldAlert size={12} /> },
            { value: "projects",    label: "Projects",    icon: <FolderOpen size={12} /> },
          ].map(t => (
            <TabsTrigger key={t.value} value={t.value}
              className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs flex items-center gap-1.5 h-9">
              {t.icon} {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            OVERVIEW TAB
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">

          {/* Row 1 — Portfolio */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Portfolio</p>
            <div className="grid grid-cols-3 gap-3">
              <KpiCard
                label="Total Projects"
                value={String(d?.projects.total ?? "—")}
                sub={`${d?.projects.byActivation.active ?? 0} active · ${d?.projects.byActivation.draft ?? 0} draft`}
                icon={<Layers size={16} />}
                accent="text-indigo-400"
                onClick={() => navigate("/projects")}
              />
              <KpiCard
                label="Mature Production"
                value={String(d?.projects.byLifecycle.matureProduction ?? "—")}
                sub={`${d?.projects.byLifecycle.prematurity ?? 0} prematurity · ${d?.projects.byLifecycle.closed ?? 0} closed`}
                icon={<TrendingUp size={16} />}
                accent="text-emerald-400"
                onClick={() => navigate("/projects")}
              />
              <KpiCard
                label="Operational Health"
                value={isLoading ? "—" : `${healthScore}/100`}
                sub={healthLabel}
                icon={<Activity size={16} />}
                accent={healthColor}
              />
            </div>
          </div>

          {/* Row 2 — Financial Position */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Financial Position</p>
            <div className="grid grid-cols-4 gap-3">
              <KpiCard
                label="Total Revenue"
                value={isLoading ? "—" : fmtINR(totalRevenue, true)}
                sub={`${d?.revenue.recordCount ?? 0} production records`}
                icon={<TrendingUp size={16} />}
                accent="text-indigo-400"
                trend="up"
                onClick={() => navigate("/production")}
              />
              <KpiCard
                label="Total Expenditure"
                value={isLoading ? "—" : fmtINR(totalExpenditure, true)}
                sub={`${d?.expenditure.count ?? 0} entries · ${fmtINR(d?.expenditure.verified, true)} verified`}
                icon={<IndianRupee size={16} />}
                accent="text-amber-400"
                trend="neutral"
                onClick={() => navigate("/expenditure")}
              />
              <KpiCard
                label="Operational Profit"
                value={isLoading ? "—" : fmtINR(operationalProfit, true)}
                sub={`Margin: ${fmtPct(profitMargin)}`}
                icon={operationalProfit >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                accent={operationalProfit >= 0 ? "text-emerald-400" : "text-red-400"}
                trend={operationalProfit >= 0 ? "up" : "down"}
              />
              <KpiCard
                label="Distributable Profit"
                value={isLoading ? "—" : fmtINR(d?.distributableProfit.grossRevenue, true)}
                sub={`${d?.distributableProfit.confirmedSessions ?? 0} confirmed sessions`}
                icon={<Scale size={16} />}
                accent="text-blue-400"
                onClick={() => navigate("/distribution")}
              />
            </div>
          </div>

          {/* Row 3 — Risk & Operations */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Risk & Operations</p>
            <div className="grid grid-cols-3 gap-3">
              <KpiCard
                label="Pending Settlements"
                value={isLoading ? "—" : fmtINR(d?.pendingSettlements.totalAmount, true)}
                sub={`${d?.pendingSettlements.totalCount ?? 0} outstanding records`}
                icon={<AlertTriangle size={16} />}
                accent="text-orange-400"
                trend="down"
                onClick={() => navigate("/distribution")}
              />
              <KpiCard
                label="Active Disputes"
                value={isLoading ? "—" : String(activeDisputes)}
                sub={`${d?.disputes.escalated ?? 0} escalated · ${d?.disputes.bySeverity.critical ?? 0} critical`}
                icon={<ShieldAlert size={16} />}
                accent={activeDisputes > 0 ? "text-red-400" : "text-emerald-400"}
                trend={activeDisputes > 0 ? "down" : "neutral"}
                onClick={() => navigate("/disputes")}
              />
              <KpiCard
                label="Stock Value (Est.)"
                value={isLoading ? "—" : fmtINR(d?.stock.estimatedStockValue, true)}
                sub={`${fmtKg(d?.stock.currentStockKg)} unsold @ avg ₹${parseFloat(d?.stock.avgSellingPrice ?? "0").toFixed(0)}/kg`}
                icon={<Warehouse size={16} />}
                accent="text-violet-400"
                onClick={() => navigate("/inventory")}
              />
            </div>
          </div>

          {/* Row 4 — Scorecard panels */}
          <div className="grid grid-cols-2 gap-4">

            {/* Project distribution pie */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Project Status Breakdown</CardTitle>
                <p className="text-xs text-slate-500">{d?.projects.total ?? 0} total projects</p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {activationData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={activationData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={2}>
                          {activationData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                        </Pie>
                        <Tooltip formatter={(v) => [String(v), ""]} contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      {activationData.map(d => (
                        <div key={d.name} className="flex items-center gap-2 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-slate-400">{d.name}</span>
                          <span className="ml-auto font-semibold text-slate-200">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <EmptyChart height={200} />}
              </CardContent>
            </Card>

            {/* Key metrics scorecard */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Business Scorecard</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <StatRow label="Commercial Model — Ownership" value={d?.projects.byModel.ownershipContribution ?? "—"} />
                <StatRow label="Commercial Model — 50% Revenue" value={d?.projects.byModel.fiftyPctRevenue ?? "—"} />
                <StatRow label="Avg Selling Price / Kg" value={`₹${parseFloat(d?.stock.avgSellingPrice ?? "0").toFixed(2)}`} />
                <StatRow label="Total Kg Produced" value={fmtKg(d?.revenue.totalProductionKg)} />
                <StatRow label="Total Kg Sold" value={fmtKg(d?.revenue.totalSoldKg)} />
                <StatRow label="Current Stock" value={fmtKg(d?.stock.currentStockKg)} valueClass="text-violet-400" />
                <StatRow label="Tasks — Completion Rate" value={fmtPct(taskRate)} valueClass={taskRate >= 70 ? "text-emerald-400" : "text-amber-400"} />
                <StatRow label="Tasks — Overdue" value={d?.tasks.overdue ?? 0} valueClass={(d?.tasks.overdue ?? 0) > 0 ? "text-red-400" : "text-slate-200"} />
                <StatRow label="LCA Outstanding" value={fmtINR(d?.pendingSettlements.lcaPending, true)} valueClass="text-violet-400" />
                <StatRow label="Distribution Paid" value={fmtINR(d?.pendingSettlements.distributionPaid, true)} valueClass="text-emerald-400" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            FINANCIAL TAB
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="financial" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SH title="Financial Performance" sub="Revenue vs expenditure across all projects and commercial models" />

          {/* Summary KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <KpiCard label="Gross Revenue" value={fmtINR(totalRevenue, true)} sub="All production records" icon={<TrendingUp size={16} />} accent="text-indigo-400" />
            <KpiCard label="Total Expenditure" value={fmtINR(totalExpenditure, true)} sub={`${fmtINR(d?.expenditure.verified, true)} verified`} icon={<IndianRupee size={16} />} accent="text-amber-400" />
            <KpiCard label="Net Profit" value={fmtINR(operationalProfit, true)} sub={`${fmtPct(profitMargin)} margin`} icon={<Scale size={16} />} accent={operationalProfit >= 0 ? "text-emerald-400" : "text-red-400"} />
            <KpiCard label="50% Model Revenue" value={fmtINR(d?.distributableProfit.grossRevenue, true)} sub={`Pool: ${fmtINR(d?.distributableProfit.poolShare, true)}`} icon={<Layers size={16} />} accent="text-blue-400" />
          </div>

          {/* Monthly trend */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Monthly Revenue vs Expenditure</CardTitle>
              <p className="text-xs text-slate-500">Last 18 months — production records + expenditure ledger</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {monthlyTrend.length === 0 ? <EmptyChart height={260} /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyTrend} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                    <defs>
                      {[
                        { id: "rev", color: C.revenue },
                        { id: "exp", color: C.expenditure },
                        { id: "profit", color: C.profit },
                      ].map(({ id, color }) => (
                        <linearGradient key={id} id={`ga_${id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip content={<ChartTip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke={C.revenue} fill="url(#ga_rev)" strokeWidth={2} />
                    <Area type="monotone" dataKey="expenditure" name="Expenditure" stroke={C.expenditure} fill="url(#ga_exp)" strokeWidth={2} />
                    <Area type="monotone" dataKey="profit" name="Net Profit" stroke={C.profit} fill="url(#ga_profit)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Expenditure by category + distribution breakdown */}
          <div className="grid grid-cols-2 gap-4">

            {/* Expenditure pie */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Expenditure by Category</CardTitle>
                <p className="text-xs text-slate-500">Total: {fmtINR(totalExpenditure, true)}</p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {expCategoryData.length === 0 ? <EmptyChart height={200} /> : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={expCategoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={2}>
                          {expCategoryData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                        </Pie>
                        <Tooltip formatter={v => [fmtINR(Number(v), true), ""]} contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 mt-2 max-h-36 overflow-y-auto">
                      {expCategoryData.map(c => (
                        <div key={c.name} className="flex items-center gap-2 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: c.fill }} />
                          <span className="text-slate-400 truncate">{c.name}</span>
                          <span className="ml-auto font-semibold text-slate-200 tabular-nums">{fmtINR(c.value, true)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Settlement breakdown */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Settlement & Distribution Position</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">Distribution Paid</span>
                    <span className="text-emerald-400 font-semibold">{fmtINR(d?.pendingSettlements.distributionPaid, true)}</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    {(() => {
                      const paid = parseFloat(d?.pendingSettlements.distributionPaid ?? "0");
                      const pending = parseFloat(d?.pendingSettlements.distributionPending ?? "0");
                      const total = paid + pending;
                      const pct = total > 0 ? (paid / total) * 100 : 0;
                      return <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />;
                    })()}
                  </div>
                </div>
                <StatRow label="Distribution Pending" value={fmtINR(d?.pendingSettlements.distributionPending, true)} valueClass="text-orange-400" />
                <StatRow label="Distribution Records Paid" value={`${d?.pendingSettlements.paidCount ?? 0} records`} valueClass="text-emerald-400" />
                <StatRow label="Distribution Records Outstanding" value={`${d?.pendingSettlements.distributionCount ?? 0} records`} valueClass={Number(d?.pendingSettlements.distributionCount ?? 0) > 0 ? "text-orange-400" : "text-slate-200"} />
                <StatRow label="LCA Outstanding" value={fmtINR(d?.pendingSettlements.lcaPending, true)} valueClass="text-violet-400" />
                <StatRow label="LCA Pending Entries" value={`${d?.pendingSettlements.lcaCount ?? 0} entries`} valueClass={Number(d?.pendingSettlements.lcaCount ?? 0) > 0 ? "text-violet-400" : "text-slate-200"} />
                <StatRow label="Total Pending Settlements" value={fmtINR(d?.pendingSettlements.totalAmount, true)} valueClass="text-amber-400" />
                <StatRow label="Total Pending Count" value={`${d?.pendingSettlements.totalCount ?? 0} records`} valueClass="text-amber-400" />
              </CardContent>
            </Card>
          </div>

          {/* Monthly data table */}
          {monthlyTrend.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Monthly Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-500">
                        {["Month", "Revenue", "Expenditure", "Net Profit", "Prod. (Kg)", "Sold (Kg)"].map(h => (
                          <th key={h} className="text-right px-4 py-2.5 font-medium first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...monthlyTrend].reverse().map((r, i) => (
                        <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/20">
                          <td className="px-4 py-2 text-slate-300 font-medium">{r.month}</td>
                          <td className="px-4 py-2 text-right text-indigo-300 tabular-nums">{fmtINR(r.revenue, true)}</td>
                          <td className="px-4 py-2 text-right text-amber-300 tabular-nums">{fmtINR(r.expenditure, true)}</td>
                          <td className={`px-4 py-2 text-right font-semibold tabular-nums ${r.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtINR(r.profit, true)}</td>
                          <td className="px-4 py-2 text-right text-slate-400 tabular-nums">{fmtKg(r.productionKg)}</td>
                          <td className="px-4 py-2 text-right text-slate-400 tabular-nums">{fmtKg(r.soldKg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            OPERATIONS TAB
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="operations" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SH title="Operational Performance" sub="Production output, stock position, and task health" />

          {/* Production KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <KpiCard label="Total Produced" value={fmtKg(d?.revenue.totalProductionKg)} sub={`${d?.revenue.recordCount ?? 0} batches`} icon={<Package size={16} />} accent="text-blue-400" />
            <KpiCard label="Total Sold" value={fmtKg(d?.revenue.totalSoldKg)} sub={`Avg ₹${parseFloat(d?.stock.avgSellingPrice ?? "0").toFixed(2)}/kg`} icon={<TrendingUp size={16} />} accent="text-emerald-400" />
            <KpiCard label="Current Stock" value={fmtKg(d?.stock.currentStockKg)} sub={`Est. value: ${fmtINR(d?.stock.estimatedStockValue, true)}`} icon={<Warehouse size={16} />} accent="text-violet-400" onClick={() => navigate("/inventory")} />
            <KpiCard label="Avg Revenue / Record" value={fmtINR(d?.revenue.recordCount ? totalRevenue / d.revenue.recordCount : 0, true)} sub="Revenue per production record" icon={<IndianRupee size={16} />} accent="text-indigo-400" />
          </div>

          {/* Production trend bar chart */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Monthly Production vs Sales Volume</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {monthlyTrend.length === 0 ? <EmptyChart height={220} /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyTrend} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tickFormatter={v => fmtKg(v)} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip content={<ChartTip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="productionKg" name="Produced Kg" fill={C.production} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="soldKg" name="Sold Kg" fill={C.sold} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Task health */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Task Health</CardTitle>
                <p className="text-xs text-slate-500">{d?.tasks.total ?? 0} total operational tasks</p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex items-center gap-6">
                  <div className="relative shrink-0">
                    <ResponsiveContainer width={120} height={120}>
                      <RadialBarChart cx="50%" cy="50%" innerRadius={35} outerRadius={55} data={taskRadialData} startAngle={90} endAngle={-270}>
                        <RadialBar dataKey="value" background={{ fill: "#1e293b" }} cornerRadius={4} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-xl font-bold ${taskRate >= 70 ? "text-emerald-400" : "text-amber-400"}`}>{fmtPct(taskRate)}</span>
                      <span className="text-[10px] text-slate-500">done</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-0">
                    <StatRow label="Completed" value={d?.tasks.completed ?? 0} valueClass="text-emerald-400" />
                    <StatRow label="In Progress" value={d?.tasks.inProgress ?? 0} valueClass="text-blue-400" />
                    <StatRow label="Pending" value={d?.tasks.pending ?? 0} valueClass="text-amber-400" />
                    <StatRow label="Overdue" value={d?.tasks.overdue ?? 0} valueClass={(d?.tasks.overdue ?? 0) > 0 ? "text-red-400" : "text-slate-200"} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Stock Position Summary</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <StatRow label="Total Produced (All Time)" value={fmtKg(d?.stock.totalProductionKg)} />
                <StatRow label="Total Sold (All Time)" value={fmtKg(d?.stock.totalSoldKg)} valueClass="text-emerald-400" />
                <StatRow label="Current Unsold Stock" value={fmtKg(d?.stock.currentStockKg)} valueClass="text-violet-400" />
                <StatRow label="Avg Selling Price / Kg" value={`₹${parseFloat(d?.stock.avgSellingPrice ?? "0").toFixed(2)}`} />
                <StatRow label="Estimated Stock Value" value={fmtINR(d?.stock.estimatedStockValue, true)} valueClass="text-violet-400" />
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">Sell-through Rate</span>
                    {(() => {
                      const prod = parseFloat(d?.stock.totalProductionKg ?? "0");
                      const sold = parseFloat(d?.stock.totalSoldKg ?? "0");
                      const pct = prod > 0 ? (sold / prod) * 100 : 0;
                      return <span className="text-emerald-400 font-semibold">{fmtPct(pct)}</span>;
                    })()}
                  </div>
                  {(() => {
                    const prod = parseFloat(d?.stock.totalProductionKg ?? "0");
                    const sold = parseFloat(d?.stock.totalSoldKg ?? "0");
                    const pct = prod > 0 ? (sold / prod) * 100 : 0;
                    return (
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            GOVERNANCE TAB
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="governance" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SH title="Governance & Risk" sub="Active disputes, severity breakdown, and pending settlement risk" />

          {/* Dispute KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <KpiCard label="Total Disputes" value={String(d?.disputes.total ?? "—")} sub="All time across all projects" icon={<ShieldAlert size={16} />} accent="text-slate-400" onClick={() => navigate("/disputes")} />
            <KpiCard label="Active Disputes" value={String(d?.disputes.active ?? "—")} sub={`${d?.disputes.open ?? 0} open · ${d?.disputes.underReview ?? 0} review · ${d?.disputes.escalated ?? 0} escalated`} icon={<AlertTriangle size={16} />} accent={(d?.disputes.active ?? 0) > 0 ? "text-red-400" : "text-emerald-400"} onClick={() => navigate("/disputes")} />
            <KpiCard label="Escalated" value={String(d?.disputes.escalated ?? "—")} sub="Requires immediate attention" icon={<TrendingUp size={16} />} accent={(d?.disputes.escalated ?? 0) > 0 ? "text-orange-400" : "text-emerald-400"} onClick={() => navigate("/disputes")} />
            <KpiCard label="Resolved" value={String(d?.disputes.resolved ?? "—")} sub="Successfully closed" icon={<CheckCircle size={16} />} accent="text-emerald-400" />
          </div>

          {/* Dispute charts */}
          <div className="grid grid-cols-2 gap-4">

            {/* Severity breakdown */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Active Disputes by Severity</CardTitle>
                <p className="text-xs text-slate-500">{d?.disputes.active ?? 0} unresolved disputes</p>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {disputeSeverityData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie data={disputeSeverityData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                          {disputeSeverityData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                        </Pie>
                        <Tooltip formatter={(v) => [String(v) + " disputes", ""]} contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-2">
                      <SeverityBadge level="critical" count={d?.disputes.bySeverity.critical ?? 0} />
                      <SeverityBadge level="high" count={d?.disputes.bySeverity.high ?? 0} />
                      <SeverityBadge level="medium" count={d?.disputes.bySeverity.medium ?? 0} />
                      <SeverityBadge level="low" count={d?.disputes.bySeverity.low ?? 0} />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <CheckCircle size={36} className="text-emerald-500" />
                    <p className="text-sm text-emerald-400 font-medium">No active disputes</p>
                    <p className="text-xs text-slate-500">All governance issues are resolved</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Dispute status panel */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Dispute Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                {[
                  { label: "Open", value: d?.disputes.open ?? 0, cls: "text-red-400", bar: "#ef4444" },
                  { label: "Under Review", value: d?.disputes.underReview ?? 0, cls: "text-orange-400", bar: "#f97316" },
                  { label: "Escalated", value: d?.disputes.escalated ?? 0, cls: "text-yellow-400", bar: "#eab308" },
                  { label: "Resolved", value: d?.disputes.resolved ?? 0, cls: "text-emerald-400", bar: "#10b981" },
                ].map(s => {
                  const total = d?.disputes.total ?? 1;
                  const pct = total > 0 ? (s.value / total) * 100 : 0;
                  return (
                    <div key={s.label} className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{s.label}</span>
                        <span className={`font-semibold ${s.cls}`}>{s.value} ({fmtPct(pct)})</span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.bar }} />
                      </div>
                    </div>
                  );
                })}

                <div className="pt-3 border-t border-slate-700 mt-2">
                  <p className="text-xs font-semibold text-slate-400 mb-2">Pending Settlement Risk</p>
                  <StatRow label="Outstanding (Distribution)" value={fmtINR(d?.pendingSettlements.distributionPending, true)} valueClass="text-orange-400" />
                  <StatRow label="Outstanding (LCA)" value={fmtINR(d?.pendingSettlements.lcaPending, true)} valueClass="text-violet-400" />
                  <StatRow label="Total Pending" value={fmtINR(d?.pendingSettlements.totalAmount, true)} valueClass="text-amber-400" />
                  <StatRow label="Pending Record Count" value={`${d?.pendingSettlements.totalCount ?? 0} records`} valueClass="text-amber-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Expenditure verification risk */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Expenditure Verification Status</CardTitle>
              <p className="text-xs text-slate-500">{d?.expenditure.count ?? 0} active expenditure records</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-700/40 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-400 tabular-nums">{fmtINR(d?.expenditure.verified, true)}</p>
                  <p className="text-xs text-slate-400 mt-1">Verified</p>
                </div>
                <div className="bg-slate-700/40 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-amber-400 tabular-nums">{fmtINR(d?.expenditure.draft, true)}</p>
                  <p className="text-xs text-slate-400 mt-1">Draft / Unverified</p>
                </div>
                <div className="bg-slate-700/40 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-slate-200 tabular-nums">{fmtINR(totalExpenditure, true)}</p>
                  <p className="text-xs text-slate-400 mt-1">Total Active</p>
                </div>
              </div>
              {(() => {
                const verified = parseFloat(d?.expenditure.verified ?? "0");
                const pct = totalExpenditure > 0 ? (verified / totalExpenditure) * 100 : 0;
                return (
                  <div className="mt-4">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-400">Verification Rate</span>
                      <span className={`font-semibold ${pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400"}`}>{fmtPct(pct)}</span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            PROJECTS TAB
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="projects" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SH title="Project Comparison" sub="Revenue, expenditure, and net profit per project (top 8 by revenue)" />

          {/* Comparison bar chart */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Revenue vs Expenditure by Project</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {projectComparison.length === 0 ? <EmptyChart height={260} /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={projectComparison} margin={{ top: 4, right: 16, left: 16, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="projectName" tick={{ fill: "#64748b", fontSize: 9 }} angle={-25} textAnchor="end" />
                    <YAxis tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip content={<ChartTip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="revenue" name="Revenue" fill={C.revenue} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="expenditure" name="Expenditure" fill={C.expenditure} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="profit" name="Net Profit" fill={C.profit} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Production comparison */}
          {projectComparison.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Production Volume by Project</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={projectComparison} margin={{ top: 4, right: 16, left: 16, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="projectName" tick={{ fill: "#64748b", fontSize: 9 }} angle={-25} textAnchor="end" />
                    <YAxis tickFormatter={v => fmtKg(v)} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip content={<ChartTip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="productionKg" name="Produced Kg" fill={C.production} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="soldKg" name="Sold Kg" fill={C.sold} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Comparison table */}
          {projectComparison.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Project Detail Table</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-500">
                        {["Project", "Revenue", "Expenditure", "Net Profit", "Margin", "Produced", "Sold"].map(h => (
                          <th key={h} className="text-right px-4 py-2.5 font-medium first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projectComparison.map((p, i) => {
                        const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : "0.0";
                        return (
                          <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/20 cursor-pointer" onClick={() => navigate(`/projects`)}>
                            <td className="px-4 py-2.5 text-slate-200 font-medium max-w-48 truncate">{p.projectName}</td>
                            <td className="px-4 py-2.5 text-right text-indigo-300 tabular-nums">{fmtINR(p.revenue, true)}</td>
                            <td className="px-4 py-2.5 text-right text-amber-300 tabular-nums">{fmtINR(p.expenditure, true)}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${p.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtINR(p.profit, true)}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${parseFloat(margin) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{margin}%</td>
                            <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{fmtKg(p.productionKg)}</td>
                            <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{fmtKg(p.soldKg)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-600 bg-slate-700/20">
                        <td className="px-4 py-2.5 text-slate-300 font-semibold text-xs">TOTAL</td>
                        <td className="px-4 py-2.5 text-right text-indigo-300 font-semibold tabular-nums">{fmtINR(totalRevenue, true)}</td>
                        <td className="px-4 py-2.5 text-right text-amber-300 font-semibold tabular-nums">{fmtINR(totalExpenditure, true)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${operationalProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtINR(operationalProfit, true)}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${profitMargin >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtPct(profitMargin)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-300 font-semibold tabular-nums">{fmtKg(d?.revenue.totalProductionKg)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-300 font-semibold tabular-nums">{fmtKg(d?.revenue.totalSoldKg)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {projectComparison.length === 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                <ClipboardList size={40} className="text-slate-600" />
                <p className="text-sm text-slate-500">No production data recorded yet</p>
                <p className="text-xs text-slate-600">Add production records to see per-project comparison</p>
                <Button size="sm" variant="outline" className="mt-2 border-slate-600 text-slate-300" onClick={() => navigate("/production")}>
                  Go to Production
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
