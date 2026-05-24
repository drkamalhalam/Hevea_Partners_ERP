/**
 * FinancialAnalytics.tsx
 *
 * Financial Analytics Dashboard — professional accounting-style dark UI.
 *
 * Five tabs:
 *   Overview     — master KPI cards + revenue allocation pie + summary tables
 *   Revenue      — period-wise gross/net/pool/cost trend (area/bar charts)
 *   Settlements  — settlement completion rates + override analytics + LCA by year
 *   Projects     — per-project profitability table + comparative bar chart
 *   Payouts      — distribution paid vs pending + LCA status
 */

import { useState, useMemo } from "react";
import {
  useGetFinancialSummary,
  useGetRevenueTrend,
  useGetSettlementAnalytics,
  useGetProjectProfitability,
  useGetAllocationBreakdown,
  useListProjects,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, IndianRupee, RefreshCw,
  BarChart3, PieChartIcon, Scale, CheckCircle, AlertCircle,
  Layers, Activity, ChevronRight, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// ── Formatters ─────────────────────────────────────────────────────────────
// NPF Stage 2 — `parseFloat(String(...))` is functionally equivalent to
// the shared `parseNumeric` helper for these formatters; kept as-is to
// avoid churn. The pct helper is hardened below.
import { parseNumeric } from "@/lib/numeric";

const fmtINR = (v: unknown, compact = false) => {
  const n = parseFloat(String(v ?? "0")) || 0;
  if (compact) {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
    if (n >= 100_000)    return `₹${(n / 100_000).toFixed(2)}L`;
    if (n >= 1_000)      return `₹${(n / 1_000).toFixed(1)}K`;
    return `₹${n.toFixed(0)}`;
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
};

const fmtPct = (v: number | string | null | undefined) => `${parseNumeric(v).toFixed(1)}%`;

// ── Colour palette ─────────────────────────────────────────────────────────

const COLORS = {
  gross:        "#6366f1",
  landowner:    "#10b981",
  pool:         "#3b82f6",
  opCost:       "#f59e0b",
  lca:          "#8b5cf6",
  net:          "#22c55e",
  paid:         "#10b981",
  pending:      "#f59e0b",
  disputed:     "#ef4444",
  overridden:   "#f97316",
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "6px",
  color: "#e2e8f0",
  fontSize: "12px",
};

// ── KPI card ───────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  trend?: "up" | "down" | "neutral";
}
function KpiCard({ label, value, sub, icon, color, trend }: KpiCardProps) {
  return (
    <Card className="bg-slate-800/60 border-slate-700">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className={`p-2 rounded-lg bg-slate-700/60 ${color}`}>{icon}</div>
          {trend && (
            <span className={`text-xs font-medium ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-slate-400"}`}>
              {trend === "up" ? <ArrowUpRight size={14} /> : trend === "down" ? <ArrowDownRight size={14} /> : null}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-3">{label}</p>
        <p className={`text-xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Section header ─────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={CHART_TOOLTIP_STYLE} className="p-3 shadow-xl">
      <p className="text-xs text-slate-400 mb-2 font-medium">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
            <span className="text-slate-300">{p.name}</span>
          </span>
          <span className="font-semibold" style={{ color: p.color }}>{fmtINR(p.value, true)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Pie custom label ───────────────────────────────────────────────────────

const RADIAN = Math.PI / 180;
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct, name }: Record<string, number | string>) {
  const radius = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.5;
  const x = Number(cx) + radius * Math.cos(-Number(midAngle) * RADIAN);
  const y = Number(cy) + radius * Math.sin(-Number(midAngle) * RADIAN);
  if (Number(pct) < 5) return null;
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {`${Number(pct).toFixed(0)}%`}
    </text>
  );
}

// ── Settlement type label ──────────────────────────────────────────────────

const SETTLEMENT_LABELS: Record<string, string> = {
  fifty_pct: "50% Revenue",
  payable:   "Payable",
  lca:       "LCA",
  loss_absorption: "Loss Absorption",
  manual:    "Manual",
};

// ── Main page ──────────────────────────────────────────────────────────────

export default function FinancialAnalytics() {
  const [tab, setTab] = useState("overview");
  const [projectFilter, setProjectFilter] = useState("__all__");

  const projectId = projectFilter !== "__all__" ? projectFilter : undefined;

  const { data: summaryRaw,  refetch: refetchSummary  } = useGetFinancialSummary({ projectId });
  const { data: trendRaw,    refetch: refetchTrend    } = useGetRevenueTrend({ projectId });
  const { data: settlRaw,    refetch: refetchSettl    } = useGetSettlementAnalytics({ projectId });
  const { data: projRaw,     refetch: refetchProj     } = useGetProjectProfitability({ projectId });
  const { data: allocRaw,    refetch: refetchAlloc    } = useGetAllocationBreakdown({ projectId });
  const { data: projectsRaw } = useListProjects();

  const refetchAll = () => { refetchSummary(); refetchTrend(); refetchSettl(); refetchProj(); refetchAlloc(); };

  const s    = summaryRaw as Record<string, unknown> | undefined;
  const lca  = (s?.lca as Record<string, unknown>) ?? {};
  const dist = (s?.distribution as Record<string, unknown>) ?? {};
  const settl = (s?.settlements as Record<string, unknown>) ?? {};
  const negBal = (s?.negativeBalance as Record<string, unknown>) ?? {};
  const adjRec = (s?.recoverableAdjustments as Record<string, unknown>) ?? {};
  const sessions = (s?.sessions as Record<string, unknown>) ?? {};

  const trendData = (trendRaw as { trend?: Record<string, unknown>[] })?.trend ?? [];
  const settlByType = (settlRaw as { byType?: Record<string, unknown>[] })?.byType ?? [];
  const lcaByYear = (settlRaw as { lcaByYear?: Record<string, unknown>[] })?.lcaByYear ?? [];
  const projects = (projRaw as { projects?: Record<string, unknown>[] })?.projects ?? [];
  const allocBreakdown = (allocRaw as { breakdown?: { name: string; value: number; pct: number; fill: string }[]; grossRevenue?: string })?.breakdown ?? [];
  const allocGross = (allocRaw as { grossRevenue?: string })?.grossRevenue ?? "0";

  const projectList = (projectsRaw as { projects?: { id: string; name: string }[] })?.projects ?? [];

  const settlTotal = Number(settl?.total ?? 0);
  const settlFinalized = Number(settl?.finalized ?? 0);
  const completionRate = settlTotal > 0 ? ((settlFinalized / settlTotal) * 100).toFixed(1) : "0.0";

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-indigo-400" />
            Financial Analytics
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Distribution & settlement system — aggregate financial intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-8 w-48">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="__all__" className="text-slate-300 text-xs">All Projects</SelectItem>
              {projectList.map(p => <SelectItem key={p.id} value={p.id} className="text-white text-xs">{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white text-xs h-8" onClick={refetchAll}>
            <RefreshCw size={12} className="mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="bg-slate-900 border-b border-slate-800 rounded-none justify-start px-6 shrink-0 h-10">
          {[
            { value: "overview",    label: "Overview",    icon: <PieChartIcon size={12} /> },
            { value: "revenue",     label: "Revenue",     icon: <TrendingUp size={12} /> },
            { value: "settlements", label: "Settlements", icon: <Scale size={12} /> },
            { value: "projects",    label: "Projects",    icon: <Layers size={12} /> },
            { value: "payouts",     label: "Payouts",     icon: <IndianRupee size={12} /> },
          ].map(t => (
            <TabsTrigger key={t.value} value={t.value}
              className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs flex items-center gap-1.5 h-9">
              {t.icon} {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">

          {/* KPI Grid — Row 1: Revenue */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Revenue Position</p>
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Gross Revenue" value={fmtINR(s?.grossRevenue, true)} sub={`${Number(sessions?.confirmed ?? 0)} confirmed sessions`} icon={<TrendingUp size={16} />} color="text-indigo-400" />
              <KpiCard label="Landowner Net" value={fmtINR(s?.landownerNet, true)} sub={`Split: ${fmtINR(s?.landownerSplit, true)}`} icon={<IndianRupee size={16} />} color="text-emerald-400" />
              <KpiCard label="Participant Pool" value={fmtINR(s?.participantPoolSplit, true)} sub={`EPP allocated: ${fmtINR(s?.eppTotalAllocated, true)}`} icon={<Layers size={16} />} color="text-blue-400" />
              <KpiCard label="Op. Costs + LCA" value={fmtINR((parseFloat(String(s?.operationalCost ?? 0)) + parseFloat(String(s?.lcaDeducted ?? 0))).toFixed(2), true)} sub={`Op: ${fmtINR(s?.operationalCost, true)} · LCA: ${fmtINR(s?.lcaDeducted, true)}`} icon={<Activity size={16} />} color="text-amber-400" />
            </div>
          </div>

          {/* KPI Grid — Row 2: Financial Status */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Financial Status</p>
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Pending Settlements" value={fmtINR(dist?.totalPending, true)} sub={`${dist?.pendingCount ?? 0} records outstanding`} icon={<AlertCircle size={16} />} color="text-amber-400" trend="down" />
              <KpiCard label="LCA Outstanding" value={fmtINR(lca?.totalPending, true)} sub={`${lca?.pendingCount ?? 0} entries unpaid`} icon={<IndianRupee size={16} />} color="text-violet-400" trend="down" />
              <KpiCard label="Negative Balance" value={fmtINR(negBal?.totalDeficit, true)} sub="Total deficit (latest per partner)" icon={<TrendingDown size={16} />} color="text-red-400" trend="down" />
              <KpiCard label="Payouts Completed" value={fmtINR(dist?.totalPaid, true)} sub={`${dist?.paidCount ?? 0} fully paid records`} icon={<CheckCircle size={16} />} color="text-emerald-400" trend="up" />
            </div>
          </div>

          {/* Allocation pie + Settlement summary */}
          <div className="grid grid-cols-2 gap-4">

            {/* Pie chart */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Revenue Allocation (Confirmed Sessions)</CardTitle>
                <p className="text-xs text-slate-500">Gross: {fmtINR(allocGross, true)}</p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {allocBreakdown.length > 0 && parseFloat(allocGross) > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={allocBreakdown}
                        cx="50%" cy="50%"
                        innerRadius={55} outerRadius={90}
                        dataKey="value"
                        labelLine={false}
                        label={(props: Record<string, number | string>) => <PieLabel {...props} />}
                      >
                        {allocBreakdown.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => [fmtINR(v), ""]}
                        contentStyle={CHART_TOOLTIP_STYLE}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-slate-600 text-sm">No confirmed sessions yet</div>
                )}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {allocBreakdown.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-slate-400 truncate">{d.name}</span>
                      <span className="ml-auto font-semibold text-slate-200">{fmtPct(d.pct)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Settlement summary */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Settlement Overview</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {/* Completion gauge */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">Completion Rate</span>
                    <span className="text-emerald-400 font-semibold">{completionRate}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${completionRate}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { label: "Total",     value: settl?.total,     color: "text-slate-300" },
                    { label: "Finalized", value: settl?.finalized, color: "text-emerald-400" },
                    { label: "Disputed",  value: settl?.disputed,  color: "text-red-400" },
                    { label: "Overridden",value: settl?.overridden,color: "text-orange-400" },
                  ].map(r => (
                    <div key={r.label} className="bg-slate-700/40 rounded-lg p-2.5">
                      <p className="text-xs text-slate-500">{r.label}</p>
                      <p className={`text-xl font-bold ${r.color}`}>{String(r.value ?? 0)}</p>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-700">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Total Recommended</span>
                    <span className="text-slate-200 font-medium">{fmtINR(settl?.totalRecommended, true)}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-slate-400">Total Actual (Finalized)</span>
                    <span className="text-slate-200 font-medium">{fmtINR(settl?.totalActual, true)}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-slate-400">Recoverable Adjustments</span>
                    <span className="text-amber-400 font-medium">{fmtINR(adjRec?.total, true)} ({String(adjRec?.count ?? 0)} entries)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── REVENUE TREND ─────────────────────────────────────────────── */}
        <TabsContent value="revenue" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SectionHeader title="Revenue Trend" sub="Period-wise gross revenue, net distributable, and cost breakdown" />

          {/* Area chart: Gross / Landowner Net / Pool */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Gross Revenue vs Net Distribution</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {trendData.length === 0 ? (
                <div className="flex items-center justify-center h-60 text-slate-600 text-sm">No session data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                    <defs>
                      {[
                        { id: "gross", color: COLORS.gross },
                        { id: "net",   color: COLORS.net },
                        { id: "pool",  color: COLORS.pool },
                      ].map(({ id, color }) => (
                        <linearGradient key={id} id={`fill_${id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="10%" stopColor={color} stopOpacity={0.3} />
                          <stop offset="90%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="periodLabel" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Area type="monotone" dataKey="grossRevenue"        name="Gross Revenue"     stroke={COLORS.gross}    fill={`url(#fill_gross)`} strokeWidth={2} />
                    <Area type="monotone" dataKey="landownerNet"        name="Landowner Net"     stroke={COLORS.net}      fill={`url(#fill_net)`}   strokeWidth={2} />
                    <Area type="monotone" dataKey="participantPoolSplit" name="Participant Pool" stroke={COLORS.pool}     fill={`url(#fill_pool)`}  strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Bar chart: Cost breakdown */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Cost Deductions per Period</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {trendData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-600 text-sm">No session data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trendData} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="periodLabel" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="operationalCost" name="Op. Cost"    fill={COLORS.opCost} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="lcaAmount"        name="LCA Deducted" fill={COLORS.lca}   radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Raw data table */}
          {trendData.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Period Detail</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-500">
                        {["Period","Gross Revenue","Landowner (50%)","Pool (50%)","Op Cost","LCA","Landowner Net","Sessions"].map(h => (
                          <th key={h} className="text-right px-4 py-2 font-medium first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trendData.map((r, i) => (
                        <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/30">
                          <td className="px-4 py-2 text-slate-300 font-medium">{String(r.periodLabel)}</td>
                          <td className="px-4 py-2 text-right text-indigo-300">{fmtINR(r.grossRevenue as number)}</td>
                          <td className="px-4 py-2 text-right text-slate-300">{fmtINR(r.landownerSplit as number)}</td>
                          <td className="px-4 py-2 text-right text-blue-300">{fmtINR(r.participantPoolSplit as number)}</td>
                          <td className="px-4 py-2 text-right text-amber-300">{fmtINR(r.operationalCost as number)}</td>
                          <td className="px-4 py-2 text-right text-violet-300">{fmtINR(r.lcaAmount as number)}</td>
                          <td className="px-4 py-2 text-right text-emerald-400 font-semibold">{fmtINR(r.landownerNet as number)}</td>
                          <td className="px-4 py-2 text-right text-slate-400">{String(r.sessionCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── SETTLEMENTS ───────────────────────────────────────────────── */}
        <TabsContent value="settlements" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SectionHeader title="Settlement Analytics" sub="Completion rates, override analysis, LCA payment tracking" />

          {/* By type cards */}
          <div className="grid grid-cols-3 gap-3">
            {settlByType.map((t) => {
              const recAmt = parseFloat(String(t.sumRecommended ?? "0"));
              const actAmt = parseFloat(String(t.sumActual ?? "0"));
              return (
                <Card key={String(t.settlementType)} className="bg-slate-800/60 border-slate-700">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs text-slate-400 font-medium">{SETTLEMENT_LABELS[String(t.settlementType)] ?? String(t.settlementType)}</CardTitle>
                      <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">{String(t.total)} records</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {/* Completion bar */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">Completion</span>
                        <span className="text-emerald-400 font-semibold">{String(t.completionRate)}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${String(t.completionRate)}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="bg-slate-700/40 rounded p-1.5">
                        <p className="text-xs text-emerald-400 font-bold">{String(t.finalized)}</p>
                        <p className="text-[10px] text-slate-500">Done</p>
                      </div>
                      <div className="bg-slate-700/40 rounded p-1.5">
                        <p className="text-xs text-red-400 font-bold">{String(t.disputed)}</p>
                        <p className="text-[10px] text-slate-500">Disputed</p>
                      </div>
                      <div className="bg-slate-700/40 rounded p-1.5">
                        <p className="text-xs text-orange-400 font-bold">{String(t.overridden)}</p>
                        <p className="text-[10px] text-slate-500">Overridden</p>
                      </div>
                    </div>
                    <div className="text-xs border-t border-slate-700 pt-2 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Recommended</span>
                        <span className="text-slate-300">{fmtINR(recAmt, true)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Actual</span>
                        <span className="text-slate-300">{fmtINR(actAmt, true)}</span>
                      </div>
                      {Number(t.overridden) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Override Δ</span>
                          <span className={`font-medium ${Number(t.overrideDiffPct) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {Number(t.overrideDiffPct) >= 0 ? "+" : ""}{String(t.overrideDiffPct)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* LCA by year */}
          {lcaByYear.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">LCA Payment Status by Year</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={lcaByYear} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="totalDue"  name="Total Due"  fill={COLORS.gross}   radius={[2, 2, 0, 0]} />
                    <Bar dataKey="totalPaid" name="Paid"       fill={COLORS.paid}    radius={[2, 2, 0, 0]} />
                    <Bar dataKey="totalBal"  name="Outstanding" fill={COLORS.pending} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-500">
                        {["Year","Total Due","Paid","Outstanding","Payment Rate","Entries"].map(h => (
                          <th key={h} className="text-right px-3 py-2 font-medium first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lcaByYear.map((r) => (
                        <tr key={String(r.year)} className="border-b border-slate-800 hover:bg-slate-700/30">
                          <td className="px-3 py-2 text-slate-300 font-medium">{String(r.year)}</td>
                          <td className="px-3 py-2 text-right text-indigo-300">{fmtINR(r.totalDue as number)}</td>
                          <td className="px-3 py-2 text-right text-emerald-400">{fmtINR(r.totalPaid as number)}</td>
                          <td className="px-3 py-2 text-right text-amber-400">{fmtINR(r.totalBal as number)}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${String(r.paymentRate)}%` }} />
                              </div>
                              <span className="text-emerald-400">{String(r.paymentRate)}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">{String(r.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── PROJECT PROFITABILITY ─────────────────────────────────────── */}
        <TabsContent value="projects" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SectionHeader title="Project-wise Profitability" sub="Gross revenue, net returns, EPP distribution, LCA & settlement summary" />

          {/* Comparative bar chart */}
          {projects.length > 0 && (
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm text-slate-300">Project Revenue Comparison</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={projects.map(p => ({
                      name: String(p.projectName ?? "").substring(0, 20),
                      gross: parseFloat(String(p.grossRevenue ?? "0")),
                      net:   parseFloat(String(p.landownerNet ?? "0")),
                      epp:   parseFloat(String(p.eppAllocated ?? "0")),
                    }))}
                    margin={{ top: 4, right: 16, left: 16, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="gross" name="Gross Revenue"   fill={COLORS.gross}    radius={[2, 2, 0, 0]} />
                    <Bar dataKey="net"   name="Landowner Net"   fill={COLORS.landowner} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="epp"   name="EPP Allocated"   fill={COLORS.pool}     radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Project detail table */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Project Financial Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {projects.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-600 text-sm px-4">No project data available</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-500">
                        <th className="text-left px-4 py-2 font-medium">Project</th>
                        <th className="text-right px-3 py-2 font-medium">Gross</th>
                        <th className="text-right px-3 py-2 font-medium">Land Net</th>
                        <th className="text-right px-3 py-2 font-medium">Margin</th>
                        <th className="text-right px-3 py-2 font-medium">EPP</th>
                        <th className="text-right px-3 py-2 font-medium">Op Cost</th>
                        <th className="text-right px-3 py-2 font-medium">LCA Paid</th>
                        <th className="text-right px-3 py-2 font-medium">LCA Pending</th>
                        <th className="text-right px-3 py-2 font-medium">Dist. Paid</th>
                        <th className="text-right px-3 py-2 font-medium">Dist. Pending</th>
                        <th className="text-right px-3 py-2 font-medium">Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((p, i) => {
                        const margin = Number(p.landownerMarginPct ?? 0);
                        return (
                          <tr key={i} className="border-b border-slate-800 hover:bg-slate-700/30">
                            <td className="px-4 py-2.5 text-slate-200 font-medium max-w-[140px] truncate">{String(p.projectName ?? p.projectId)}</td>
                            <td className="px-3 py-2.5 text-right text-indigo-300 font-medium">{fmtINR(p.grossRevenue as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-emerald-400 font-semibold">{fmtINR(p.landownerNet as string, true)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${margin >= 30 ? "bg-emerald-900/40 text-emerald-300" : margin >= 15 ? "bg-amber-900/40 text-amber-300" : "bg-red-900/40 text-red-300"}`}>
                                {fmtPct(margin)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right text-blue-300">{fmtINR(p.eppAllocated as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-amber-300">{fmtINR(p.operationalCost as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-emerald-400">{fmtINR(p.lcaPaid as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-amber-400">{fmtINR(p.lcaPending as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-emerald-400">{fmtINR(p.distributionPaid as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-amber-400">{fmtINR(p.distributionPending as string, true)}</td>
                            <td className="px-3 py-2.5 text-right text-slate-400">{String(p.confirmedCount)}/{String(p.sessionCount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PAYOUTS ───────────────────────────────────────────────────── */}
        <TabsContent value="payouts" className="flex-1 overflow-y-auto m-0 p-6 space-y-6">
          <SectionHeader title="Actual Payout Analytics" sub="Distribution payments, LCA collection, recovery adjustments" />

          {/* Payout KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Total Distributed" value={fmtINR(dist?.totalPaid, true)} sub={`${dist?.paidCount ?? 0} fully settled records`} icon={<CheckCircle size={16} />} color="text-emerald-400" />
            <KpiCard label="Pending Payout"    value={fmtINR(dist?.totalPending, true)} sub={`${dist?.pendingCount ?? 0} outstanding records`} icon={<AlertCircle size={16} />} color="text-amber-400" />
            <KpiCard label="LCA Collected"     value={fmtINR(lca?.totalPaid, true)} sub={`${fmtINR(lca?.totalPending, true)} still outstanding`} icon={<IndianRupee size={16} />} color="text-violet-400" />
          </div>

          {/* Distribution paid vs pending chart */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">Distribution Payment Status (per Project)</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {projects.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-600 text-sm">No distribution data</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={projects.map(p => ({
                      name:    String(p.projectName ?? "").substring(0, 18),
                      paid:    parseFloat(String(p.distributionPaid ?? "0")),
                      pending: parseFloat(String(p.distributionPending ?? "0")),
                    }))}
                    margin={{ top: 4, right: 16, left: 16, bottom: 4 }}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => fmtINR(v, true)} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={100} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Bar dataKey="paid"    name="Paid"    fill={COLORS.paid}    radius={[0, 2, 2, 0]} />
                    <Bar dataKey="pending" name="Pending" fill={COLORS.pending} radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* LCA status summary */}
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-slate-300">LCA & Recovery Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "LCA Total Due",   value: lca?.totalDue,     color: "text-indigo-300" },
                  { label: "LCA Paid",         value: lca?.totalPaid,    color: "text-emerald-400" },
                  { label: "LCA Outstanding",  value: lca?.totalPending, color: "text-amber-400" },
                  { label: "Recoverable Adj.", value: adjRec?.total,     color: "text-violet-400" },
                ].map(r => (
                  <div key={r.label} className="bg-slate-700/40 rounded-lg p-3">
                    <p className="text-xs text-slate-500">{r.label}</p>
                    <p className={`text-lg font-bold ${r.color} mt-1`}>{fmtINR(r.value as string | number, true)}</p>
                  </div>
                ))}
              </div>
              {/* Negative balance warning */}
              {parseFloat(String(negBal?.totalDeficit ?? 0)) > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-red-900/20 border border-red-800/40">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-red-400" />
                    <p className="text-xs font-semibold text-red-300">Net Negative Balance: {fmtINR(negBal?.totalDeficit, true)}</p>
                  </div>
                  <p className="text-xs text-red-500 mt-1">Partners with deficit positions require recovery actions. Review Settlement Governance for details.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
