import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  useGetInventoryAnalytics,
  useListProjects,
  getGetInventoryAnalyticsQueryKey,
} from "@workspace/api-client-react";
import type {
  StockValuationItem,
  MonthlyStockTrend,
  MonthlySalesTrend,
  RecentBatch,
  LowStockAlert,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  Droplets,
  Layers,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingCart,
  FlaskConical,
  RefreshCw,
  Activity,
  DollarSign,
  Boxes,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#0f172a",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    fontSize: 12,
    color: "#e2e8f0",
  },
};

function fmtQty(val: number, unit: string, digits = 1) {
  return `${val.toLocaleString("en-IN", { maximumFractionDigits: digits })} ${unit}`;
}

function fmtINR(val: number) {
  if (val >= 10_00_000) return `₹${(val / 10_00_000).toFixed(2)}L`;
  if (val >= 1_000) return `₹${(val / 1_000).toFixed(1)}K`;
  return `₹${val.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatMonth(m: string) {
  try { return format(parseISO(`${m}-01`), "MMM yy"); } catch { return m; }
}

// ── Stock type metadata ───────────────────────────────────────────────────────

function typeMeta(st: string) {
  if (st === "latex") return { label: "Field Latex", unit: "litres", icon: <Droplets className="h-4 w-4 text-sky-400" />, color: "#38bdf8" };
  if (st === "rubber_sheet") return { label: "Rubber Sheet", unit: "kg", icon: <Layers className="h-4 w-4 text-emerald-400" />, color: "#34d399" };
  return { label: "Rubber Scrap", unit: "kg", icon: <Package className="h-4 w-4 text-amber-400" />, color: "#fbbf24" };
}

// ── Alert level helpers ────────────────────────────────────────────────────────

function alertBadge(level: string) {
  if (level === "empty") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Empty</Badge>;
  if (level === "critical") return <Badge className="bg-red-400/20 text-red-300 border-red-400/30">Critical</Badge>;
  if (level === "low") return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">Low Stock</Badge>;
  return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Healthy</Badge>;
}

function batchStatusBadge(status: string) {
  if (status === "open") return <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 gap-1"><Clock className="h-3 w-3" />Open</Badge>;
  if (status === "closed") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1"><CheckCircle2 className="h-3 w-3" />Closed</Badge>;
  return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 gap-1"><XCircle className="h-3 w-3" />Voided</Badge>;
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1,2,3].map((i) => <Skeleton key={i} className="h-44 rounded-xl bg-slate-800/60" />)}
      </div>
      <Skeleton className="h-8 w-40 rounded bg-slate-800/60" />
      <Skeleton className="h-72 rounded-xl bg-slate-800/60" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl bg-slate-800/60" />
        <Skeleton className="h-64 rounded-xl bg-slate-800/60" />
      </div>
    </div>
  );
}

// ── Valuation Card ─────────────────────────────────────────────────────────────

function ValuationCard({ item }: { item: StockValuationItem }) {
  const meta = typeMeta(item.stockType);
  const wastageRate = item.totalProductionIn > 0
    ? ((item.totalWastage / item.totalProductionIn) * 100).toFixed(1)
    : "0.0";
  const utilizationRate = item.totalIn > 0
    ? ((item.totalSaleOut / item.totalIn) * 100).toFixed(1)
    : "0.0";

  return (
    <Card className={`bg-slate-900/60 border-white/10 relative overflow-hidden ${item.alertLevel !== "ok" ? "ring-1 ring-amber-500/30" : ""}`}>
      {item.alertLevel !== "ok" && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500" />
      )}
      <CardHeader className="pb-2 flex flex-row items-center gap-2">
        <span className="p-1.5 rounded-lg bg-slate-800">{meta.icon}</span>
        <div>
          <CardTitle className="text-sm font-medium text-slate-200">{meta.label}</CardTitle>
          <p className="text-xs text-slate-500 mt-0.5">{meta.unit}</p>
        </div>
        <div className="ml-auto">{alertBadge(item.alertLevel)}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Balance & Value */}
        <div className="flex items-end justify-between">
          <div>
            <div className={`text-3xl font-bold tabular-nums ${
              item.alertLevel === "empty" ? "text-red-400" :
              item.alertLevel === "critical" ? "text-red-300" :
              item.alertLevel === "low" ? "text-amber-300" : "text-white"
            }`}>
              {item.balance.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">current balance</div>
          </div>
          {item.estimatedValue > 0 && (
            <div className="text-right">
              <div className="text-xl font-bold text-emerald-400 tabular-nums">
                {fmtINR(item.estimatedValue)}
              </div>
              <div className="text-xs text-slate-400">est. value</div>
            </div>
          )}
        </div>

        {/* Rate info */}
        {(item.lastSaleRate ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/60 rounded-lg px-3 py-1.5">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400/70" />
            <span>₹{(item.lastSaleRate ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/{item.unit}</span>
            {item.lastSaleDate && (
              <>
                <span className="text-slate-600 mx-1">·</span>
                <span className="text-slate-500">last sale {format(parseISO(item.lastSaleDate), "dd MMM yy")}</span>
              </>
            )}
          </div>
        )}

        {/* Flow row */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-xs text-emerald-400 mb-0.5">
              <ArrowUpRight className="h-3 w-3" /> In
            </div>
            <div className="text-sm font-semibold text-white tabular-nums">
              {item.totalIn.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="text-center border-x border-white/5">
            <div className="flex items-center justify-center gap-1 text-xs text-red-400 mb-0.5">
              <ArrowDownRight className="h-3 w-3" /> Out
            </div>
            <div className="text-sm font-semibold text-white tabular-nums">
              {item.totalOut.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-xs text-amber-400 mb-0.5">
              <AlertTriangle className="h-3 w-3" /> Waste
            </div>
            <div className="text-sm font-semibold text-white tabular-nums">
              {item.totalWastage.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        {/* Micro stats */}
        <div className="flex gap-3 text-xs text-slate-500 pt-0.5">
          <span>Wastage rate: <span className="text-slate-300">{wastageRate}%</span></span>
          <span>·</span>
          <span>Utilization: <span className="text-slate-300">{utilizationRate}%</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Low Stock Alert Banner ─────────────────────────────────────────────────────

function LowStockAlertBanner({ alerts }: { alerts: LowStockAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2 text-amber-300 font-medium text-sm">
        <AlertTriangle className="h-4 w-4" />
        Low Stock Alerts ({alerts.length})
      </div>
      <div className="flex flex-wrap gap-3">
        {alerts.map((a) => {
          const meta = typeMeta(a.stockType);
          const pct = a.balance > 0 ? Math.min(100, (a.balance / a.threshold) * 100) : 0;
          return (
            <div key={a.stockType} className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-3 py-1.5">
              {meta.icon}
              <span className="text-slate-300 text-xs font-medium">{meta.label}</span>
              <span className="text-xs text-slate-400">
                {a.balance.toLocaleString("en-IN", { maximumFractionDigits: 1 })} / {a.threshold} {a.unit}
              </span>
              <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${a.alertLevel === "empty" ? "bg-red-500" : a.alertLevel === "critical" ? "bg-orange-500" : "bg-amber-400"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {alertBadge(a.alertLevel)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InventoryAnalytics() {
  const [projectId, setProjectId] = useState<string>("all");

  const { data: projects } = useListProjects();
  const { data: analytics, isLoading } = useGetInventoryAnalytics(
    { projectId: projectId === "all" ? undefined : projectId },
    {
      query: {
        queryKey: getGetInventoryAnalyticsQueryKey({ projectId: projectId === "all" ? undefined : projectId }),
        staleTime: 60_000,
      },
    },
  );

  // ── Chart data transforms ──────────────────────────────────────────────────

  const prodSalesTrend = useMemo(() => {
    return (analytics?.monthlyTrends ?? []).map((t: MonthlyStockTrend) => ({
      month: formatMonth(t.month),
      "Latex Prod": t.latexProdIn ?? 0,
      "Sheet Prod": t.sheetProdIn ?? 0,
      "Scrap Prod": t.scrapProdIn ?? 0,
      "Latex Sales": t.latexSaleOut ?? 0,
      "Sheet Sales": t.sheetSaleOut ?? 0,
    }));
  }, [analytics?.monthlyTrends]);

  const wastageTrend = useMemo(() => {
    return (analytics?.monthlyTrends ?? []).map((t: MonthlyStockTrend) => ({
      month: formatMonth(t.month),
      "Latex": t.latexWastage ?? 0,
      "Sheet": t.sheetWastage ?? 0,
      "Scrap": t.scrapWastage ?? 0,
    }));
  }, [analytics?.monthlyTrends]);

  const revenueData = useMemo(() => {
    return (analytics?.salesTrends ?? []).map((t: MonthlySalesTrend) => ({
      month: formatMonth(t.month),
      "Gross Revenue": t.revenue,
      "Net Revenue": t.netRevenue,
      "Sales": t.salesCount,
    }));
  }, [analytics?.salesTrends]);

  const wastageByType = useMemo(() => {
    const v = analytics?.stockValuation ?? [];
    return [
      { name: "Latex", value: v.find((x: StockValuationItem) => x.stockType === "latex")?.totalWastage ?? 0, color: "#38bdf8" },
      { name: "Sheet", value: v.find((x: StockValuationItem) => x.stockType === "rubber_sheet")?.totalWastage ?? 0, color: "#34d399" },
      { name: "Scrap", value: v.find((x: StockValuationItem) => x.stockType === "rubber_scrap")?.totalWastage ?? 0, color: "#fbbf24" },
    ].filter((d) => d.value > 0);
  }, [analytics?.stockValuation]);

  const totalEstimatedValue = (analytics?.stockValuation ?? []).reduce(
    (sum: number, v: StockValuationItem) => sum + v.estimatedValue, 0
  );

  const bs = analytics?.batchSummary;

  if (isLoading) return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur px-6 py-4">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-semibold text-white">Inventory Analytics</h1>
        </div>
      </div>
      <PageSkeleton />
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">

      {/* ── Header ── */}
      <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <Activity className="h-5 w-5 text-sky-400 shrink-0" />
          <h1 className="text-base font-semibold text-white">Inventory Analytics</h1>
          <div className="ml-auto flex items-center gap-2">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-44 h-8 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all" className="text-slate-200">All Projects</SelectItem>
                {(projects ?? []).map((p: { id: string; name: string }) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-200">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">

        {/* ── Low Stock Alerts ── */}
        <LowStockAlertBanner alerts={analytics?.lowStockAlerts ?? []} />

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Est. Portfolio Value",
              value: fmtINR(totalEstimatedValue),
              icon: <DollarSign className="h-4 w-4 text-emerald-400" />,
              sub: "based on last sale rates",
            },
            {
              label: "Total Batches",
              value: bs?.totalBatches ?? 0,
              icon: <Boxes className="h-4 w-4 text-sky-400" />,
              sub: `${bs?.openBatches ?? 0} open`,
            },
            {
              label: "Confirmed Sales",
              value: analytics?.salesTrends?.reduce((s: number, t: MonthlySalesTrend) => s + t.salesCount, 0) ?? 0,
              icon: <ShoppingCart className="h-4 w-4 text-violet-400" />,
              sub: "last 13 months",
            },
            {
              label: "Sales Revenue",
              value: fmtINR(analytics?.salesTrends?.reduce((s: number, t: MonthlySalesTrend) => s + t.netRevenue, 0) ?? 0),
              icon: <TrendingUp className="h-4 w-4 text-amber-400" />,
              sub: "net, last 13 months",
            },
          ].map((k) => (
            <div key={k.label} className="bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                {k.icon}
                {k.label}
              </div>
              <div className="text-xl sm:text-2xl font-bold text-white tabular-nums">{k.value}</div>
              <div className="text-xs text-slate-500">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Stock Valuation Cards ── */}
        <div>
          <h2 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-slate-500" />
            Stock Valuation &amp; Health
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(analytics?.stockValuation ?? []).map((item: StockValuationItem) => (
              <ValuationCard key={item.stockType} item={item} />
            ))}
          </div>
        </div>

        {/* ── Production vs Sales Trend ── */}
        {prodSalesTrend.length > 0 && (
          <Card className="bg-slate-900/60 border-white/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-sky-400" />
                Production vs Sales — Monthly Trend (Last 13 Months)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={prodSalesTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                  <Bar dataKey="Latex Prod" fill="#38bdf8" radius={[2, 2, 0, 0]} stackId="prod" />
                  <Bar dataKey="Sheet Prod" fill="#34d399" radius={[2, 2, 0, 0]} stackId="prod" />
                  <Bar dataKey="Scrap Prod" fill="#fbbf24" radius={[2, 2, 0, 0]} stackId="prod" />
                  <Line type="monotone" dataKey="Sheet Sales" stroke="#f472b6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Latex Sales" stroke="#818cf8" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-xs text-slate-500 mt-2">Bars = production input (stacked); Lines = sales outflows</p>
            </CardContent>
          </Card>
        )}

        {/* ── Revenue Trend + Wastage side-by-side ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Revenue Trend */}
          {revenueData.length > 0 && (
            <Card className="bg-slate-900/60 border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Sales Revenue Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={revenueData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => fmtINR(v)} />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, ""]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Area type="monotone" dataKey="Gross Revenue" stroke="#34d399" fill="url(#grossGrad)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="Net Revenue" stroke="#38bdf8" fill="url(#netGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Wastage Analytics */}
          <Card className="bg-slate-900/60 border-white/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Wastage Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {wastageTrend.length > 0 ? (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={wastageTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                      <Bar dataKey="Latex" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="Sheet" fill="#34d399" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="Scrap" fill="#fbbf24" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {wastageByType.length > 0 && (
                    <div className="flex items-center gap-4 justify-center">
                      <ResponsiveContainer width="50%" height={120}>
                        <PieChart>
                          <Pie
                            data={wastageByType}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={28}
                            outerRadius={50}
                            paddingAngle={3}
                          >
                            {wastageByType.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip {...TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1.5">
                        {wastageByType.map((entry) => (
                          <div key={entry.name} className="flex items-center gap-2 text-xs">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: entry.color }} />
                            <span className="text-slate-400">{entry.name}</span>
                            <span className="text-slate-200 font-medium tabular-nums">
                              {entry.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-56 flex items-center justify-center text-slate-500 text-sm">
                  No wastage data recorded
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Stock Movement Flow: individual per-type charts ── */}
        {(analytics?.monthlyTrends ?? []).length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-500" />
              Stock Movement Analytics — Per Product Type
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(["latex", "rubber_sheet", "rubber_scrap"] as const).map((st) => {
                const meta = typeMeta(st);
                const data = (analytics?.monthlyTrends ?? []).map((t: MonthlyStockTrend) => {
                  const prodIn = st === "latex" ? (t.latexProdIn ?? 0) : st === "rubber_sheet" ? (t.sheetProdIn ?? 0) : (t.scrapProdIn ?? 0);
                  const saleOut = st === "latex" ? (t.latexSaleOut ?? 0) : st === "rubber_sheet" ? (t.sheetSaleOut ?? 0) : (t.scrapSaleOut ?? 0);
                  const wastage = st === "latex" ? (t.latexWastage ?? 0) : st === "rubber_sheet" ? (t.sheetWastage ?? 0) : (t.scrapWastage ?? 0);
                  const otherIn = st === "latex" ? (t.latexOtherIn ?? 0) : st === "rubber_sheet" ? (t.sheetOtherIn ?? 0) : (t.scrapOtherIn ?? 0);
                  return { month: formatMonth(t.month), "Prod In": prodIn, "Sale Out": saleOut, "Wastage": wastage, "Other In": otherIn };
                });

                return (
                  <Card key={st} className="bg-slate-900/60 border-white/10">
                    <CardHeader className="pb-2 flex flex-row items-center gap-2">
                      {meta.icon}
                      <CardTitle className="text-xs font-medium text-slate-300">{meta.label} Flow</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id={`grad_in_${st}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={meta.color} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={meta.color} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 9 }} />
                          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} />
                          <Tooltip {...TOOLTIP_STYLE} />
                          <Area type="monotone" dataKey="Prod In" stroke={meta.color} fill={`url(#grad_in_${st})`} strokeWidth={1.5} dot={false} />
                          <Area type="monotone" dataKey="Sale Out" stroke="#f87171" fill="none" strokeWidth={1.5} dot={false} />
                          <Area type="monotone" dataKey="Wastage" stroke="#fbbf24" fill="none" strokeWidth={1} strokeDasharray="3 2" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Batch Summary ── */}
        {bs && (
          <div>
            <h2 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <Boxes className="h-4 w-4 text-slate-500" />
              Batch Summary
            </h2>

            {/* Batch KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: "Total Batches", value: bs.totalBatches, cls: "text-white" },
                { label: "Open", value: bs.openBatches, cls: "text-sky-300" },
                { label: "Closed", value: bs.closedBatches, cls: "text-emerald-400" },
                { label: "Voided", value: bs.voidedBatches, cls: "text-slate-500" },
              ].map((k) => (
                <div key={k.label} className="bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3">
                  <div className="text-xs text-slate-400">{k.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${k.cls}`}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Recent Batches Table */}
            {bs.recentBatches.length > 0 && (
              <Card className="bg-slate-900/60 border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-300">Recent Batches</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/5 hover:bg-transparent">
                          <TableHead className="text-slate-400 text-xs font-medium">Batch #</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium">Date</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium">Project</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium">Status</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium text-right">Latex (L)</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium text-right">Sheet (kg)</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium text-right">Scrap (kg)</TableHead>
                          <TableHead className="text-slate-400 text-xs font-medium text-right">Entries</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bs.recentBatches.map((b: RecentBatch) => (
                          <TableRow key={b.id} className="border-white/5 hover:bg-white/5 transition-colors">
                            <TableCell className="text-slate-200 text-sm font-mono font-medium">{b.batchNumber}</TableCell>
                            <TableCell className="text-slate-400 text-sm">
                              {b.batchDate ? format(parseISO(b.batchDate), "dd MMM yy") : "—"}
                            </TableCell>
                            <TableCell className="text-slate-400 text-sm max-w-[140px] truncate">{b.projectName ?? "—"}</TableCell>
                            <TableCell>{batchStatusBadge(b.status)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-sky-300">
                              {(b.totalLatexLitres ?? 0) > 0 ? (b.totalLatexLitres!).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : <span className="text-slate-600">—</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-emerald-300">
                              {(b.totalSheetKg ?? 0) > 0 ? (b.totalSheetKg!).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : <span className="text-slate-600">—</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-amber-300">
                              {(b.totalScrapKg ?? 0) > 0 ? (b.totalScrapKg!).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : <span className="text-slate-600">—</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm text-slate-400">{b.entryCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && (analytics?.monthlyTrends ?? []).length === 0 && (analytics?.stockValuation ?? []).every((v: StockValuationItem) => v.balance === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <BarChart3 className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-sm font-medium">No analytics data available yet</p>
            <p className="text-xs mt-1">Record production batches and inventory movements to see trends.</p>
          </div>
        )}

      </div>
    </div>
  );
}
