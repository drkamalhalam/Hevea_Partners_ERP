import { useState, useEffect } from "react";
import { useAuthFetcher } from "../lib/authFetch";
import { parseNumeric } from "../lib/numeric";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Factory, Package, TrendingUp, ShoppingCart, AlertTriangle,
  Users, CheckCircle2, Clock, Activity, Layers, BarChart2,
  Truck, Globe, FileText, Beaker, Leaf, RefreshCw,
  ArrowUp, ArrowDown, CircleDot, DollarSign, Scale,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────
const TABS = ["Overview", "Production Reports", "Batch Reports", "Inventory Movement", "Sales Reports", "Wastage Analytics", "Buyer Summaries"] as const;
type Tab = (typeof TABS)[number];

const PROD_TYPE_COLOR: Record<string, string> = {
  latex: "#06b6d4",
  rubber_sheet: "#10b981",
  rubber_scrap: "#f59e0b",
};
const STOCK_COLOR: Record<string, string> = {
  latex: "#06b6d4",
  rubber_sheet: "#10b981",
  rubber_scrap: "#f59e0b",
};
const MOVEMENT_COLOR: Record<string, string> = {
  production_in: "#10b981",
  purchase_in: "#3b82f6",
  opening: "#8b5cf6",
  sale_out: "#f43f5e",
  wastage: "#f97316",
  transfer_out: "#94a3b8",
  adjustment_in: "#a3e635",
  adjustment_out: "#ec4899",
};
const BUYER_COLORS = ["#10b981","#3b82f6","#f59e0b","#8b5cf6","#f43f5e","#06b6d4","#f97316","#a3e635","#ec4899","#94a3b8"];

const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  closed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  voided: "bg-slate-600/30 text-slate-400 border-slate-600/30",
  confirmed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  draft: "bg-slate-600/30 text-slate-400 border-slate-600/30",
  cancelled: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  completed: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  out: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  payment_pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  partially_dispatched: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

// ── Formatters ────────────────────────────────────────────────────────────
const fmtINR = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtQty = (n: number | null | undefined, unit = "kg") =>
  `${Number(n ?? 0).toFixed(2)} ${unit}`;
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── Shared UI ─────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, icon: Icon, iconColor = "text-slate-400", alert = false }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; iconColor?: string; alert?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 border ${alert ? "bg-rose-500/10 border-rose-500/30" : "bg-slate-800/60 border-slate-700"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-400 text-xs font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className={`text-xl font-bold ${alert ? "text-rose-300" : "text-white"}`}>{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 bg-slate-700/50 rounded-lg"><Icon className="w-4 h-4 text-slate-300" /></div>
      <div>
        <div className="text-slate-200 font-semibold text-sm">{title}</div>
        {sub && <div className="text-slate-500 text-xs">{sub}</div>}
      </div>
    </div>
  );
}

function Badge({ text, colorClass }: { text: string; colorClass?: string }) {
  const cls = colorClass ?? STATUS_BADGE[text] ?? "bg-slate-600/30 text-slate-400 border-slate-600/30";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{text.replace(/_/g, " ")}</span>;
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-700">
        {cols.map((c) => <th key={c} className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{c}</th>)}
      </tr>
    </thead>
  );
}

function EmptyState({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <Icon className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function TypeLabel({ type }: { type: string }) {
  const color = PROD_TYPE_COLOR[type] ?? "#94a3b8";
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-slate-300 capitalize text-xs">{type.replace(/_/g, " ")}</span>
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function OperationalAnalytics() {
  const fetcher = useAuthFetcher();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [projectId, setProjectId] = useState("");

  const { data: projectsData } = useQuery({
    queryKey: ["oa-projects"],
    queryFn: () => fetcher("/api/operational-analytics/projects") as Promise<{
      projects: { id: string; name: string; projectCode?: string; commercialModel: string; lifecycleStatus: string }[];
    }>,
  });
  const projects = projectsData?.projects ?? [];
  useEffect(() => { if (projects.length > 0 && !projectId) setProjectId(projects[0].id); }, [projects, projectId]);
  const selectedProject = projects.find((p) => p.id === projectId);

  const enabled = !!projectId;
  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["oa-overview", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/overview?projectId=${projectId}`),
    enabled: enabled && activeTab === "Overview",
  });
  const { data: prodData, isLoading: prodLoading } = useQuery({
    queryKey: ["oa-production", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/production?projectId=${projectId}`),
    enabled: enabled && activeTab === "Production Reports",
  });
  const { data: batchData, isLoading: batchLoading } = useQuery({
    queryKey: ["oa-batches", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/batches?projectId=${projectId}`),
    enabled: enabled && activeTab === "Batch Reports",
  });
  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ["oa-inventory", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/inventory?projectId=${projectId}`),
    enabled: enabled && activeTab === "Inventory Movement",
  });
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["oa-sales", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/sales?projectId=${projectId}`),
    enabled: enabled && activeTab === "Sales Reports",
  });
  const { data: wastageData, isLoading: wastageLoading } = useQuery({
    queryKey: ["oa-wastage", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/wastage?projectId=${projectId}`),
    enabled: enabled && activeTab === "Wastage Analytics",
  });
  const { data: buyerData, isLoading: buyerLoading } = useQuery({
    queryKey: ["oa-buyers", projectId],
    queryFn: () => fetcher(`/api/operational-analytics/buyers?projectId=${projectId}`),
    enabled: enabled && activeTab === "Buyer Summaries",
  });

  const loading = ovLoading || prodLoading || batchLoading || invLoading || salesLoading || wastageLoading || buyerLoading;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Factory className="w-5 h-5 text-emerald-400" />
              Operational Analytics
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">Production · Batches · Inventory · Sales · Wastage · Buyers</p>
          </div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[200px]"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {selectedProject && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {selectedProject.projectCode && <span className="text-slate-500 text-xs font-mono border border-slate-700 px-2 py-0.5 rounded">{selectedProject.projectCode}</span>}
            <Badge text={selectedProject.lifecycleStatus} colorClass="bg-slate-500/20 text-slate-400 border-slate-500/30" />
          </div>
        )}
        <div className="flex gap-1 mt-3 border-b border-slate-800 -mb-4 overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap flex-shrink-0 ${activeTab === tab ? "text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/40" : "text-slate-400 hover:text-slate-200"}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        {!projectId && <EmptyState icon={Globe} label="Select a project to view operational analytics" />}
        {projectId && loading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Activity className="w-8 h-8 mb-3 animate-pulse opacity-40" />
            <p>Loading operational data…</p>
          </div>
        )}

        {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
        {activeTab === "Overview" && overview && !ovLoading && (
          <div className="space-y-6">
            {/* Production KPIs */}
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Production</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard label="Total Batches" value={String(overview.production?.totalBatches ?? 0)} sub={`${overview.production?.closedBatches} closed · ${overview.production?.openBatches} open`} icon={Layers} iconColor="text-emerald-400" />
                <KPICard label="Latex (Litres)" value={`${(overview.production?.totalLatexLitres ?? 0).toFixed(1)} L`} sub="Total production" icon={Beaker} iconColor="text-cyan-400" />
                <KPICard label="Rubber Sheet (kg)" value={fmtQty(overview.production?.totalSheetKg, "kg")} sub="Total production" icon={Leaf} iconColor="text-emerald-400" />
                <KPICard label="Rubber Scrap (kg)" value={fmtQty(overview.production?.totalScrapKg, "kg")} sub="Total production" icon={Package} iconColor="text-amber-400" />
              </div>
            </div>

            {/* Inventory KPIs */}
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Inventory</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {(overview.inventory?.byStockType ?? []).map((s: { stockType: string; unit: string; balance: number; totalIn: number; totalOut: number }) => (
                  <KPICard key={s.stockType} label={`${s.stockType.replace(/_/g, " ")} Balance`}
                    value={fmtQty(s.balance, s.unit)} sub={`In: ${s.totalIn.toFixed(1)} · Out: ${s.totalOut.toFixed(1)}`}
                    icon={Package} iconColor={s.balance > 0 ? "text-emerald-400" : "text-amber-400"} />
                ))}
                <KPICard label="Total Wastage" value={fmtQty(overview.inventory?.totalWastage, "mixed")} sub={`${overview.inventory?.wastageRate?.toFixed(1)}% wastage rate · ${overview.inventory?.wastageEvents} events`} icon={AlertTriangle} iconColor={Number(overview.inventory?.wastageRate) > 5 ? "text-rose-400" : "text-amber-400"} alert={Number(overview.inventory?.wastageRate) > 10} />
              </div>
            </div>

            {/* Sales KPIs */}
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Sales</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard label="Total Transactions" value={String(overview.sales?.confirmedTransactions ?? 0)} sub="Confirmed sales" icon={ShoppingCart} iconColor="text-blue-400" />
                <KPICard label="Total Gross Revenue" value={fmtINR(overview.sales?.totalGross)} sub="Confirmed sales only" icon={DollarSign} iconColor="text-emerald-400" />
                <KPICard label="Net Revenue" value={fmtINR(overview.sales?.totalNet)} sub={`Deductions: ${fmtINR(overview.sales?.totalDeductions)}`} icon={TrendingUp} iconColor="text-emerald-400" />
                <KPICard label="Unique Buyers" value={String(overview.sales?.uniqueBuyers ?? 0)} sub={`${overview.orders?.completedOrders ?? 0} orders completed`} icon={Users} iconColor="text-violet-400" />
              </div>
            </div>

            {/* Sales orders row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Completed Orders" value={String(overview.orders?.completedOrders ?? 0)} sub={`of ${overview.orders?.totalOrders ?? 0} total`} icon={CheckCircle2} iconColor="text-emerald-400" />
              <KPICard label="Orders Revenue" value={fmtINR(overview.orders?.completedRevenue)} sub="Completed orders" icon={Scale} iconColor="text-emerald-400" />
              <KPICard label="Avg Rate / kg" value={`₹${(overview.orders?.avgRatePerKg ?? 0).toFixed(2)}`} sub="Completed orders" icon={BarChart2} iconColor="text-cyan-400" />
              <KPICard label="Total Qty Sold" value={fmtQty(overview.orders?.completedQtyKg, "kg")} sub="Via orders" icon={Truck} iconColor="text-blue-400" />
            </div>

            {/* Recent Sales */}
            {overview.recentSales?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={ShoppingCart} title="Recent Sales Transactions" sub="Latest 5 confirmed sales" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Sale #", "Date", "Buyer", "Gross", "Net", "Status"]} />
                    <tbody>
                      {overview.recentSales.map((s: { id: string; saleNumber: string; saleDate: string; buyerName: string; gross: number; net: number; status: string }) => (
                        <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300 font-mono text-xs">{s.saleNumber}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{s.saleDate}</td>
                          <td className="px-3 py-2 text-slate-200">{s.buyerName}</td>
                          <td className="px-3 py-2 text-slate-300">{fmtINR(s.gross)}</td>
                          <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(s.net)}</td>
                          <td className="px-3 py-2"><Badge text={s.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PRODUCTION REPORTS ───────────────────────────────────────── */}
        {activeTab === "Production Reports" && prodData && !prodLoading && (
          <div className="space-y-6">
            {/* Year-over-year comparison */}
            {prodData.yearlyComparison?.length > 1 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Year-over-Year Production" sub="Sheet kg · Latex litres · Scrap kg" />
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={prodData.yearlyComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="year" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="latex" name="Latex (L)" fill={PROD_TYPE_COLOR.latex} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="sheet" name="Sheet (kg)" fill={PROD_TYPE_COLOR.rubber_sheet} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="scrap" name="Scrap (kg)" fill={PROD_TYPE_COLOR.rubber_scrap} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Monthly trend chart */}
            {prodData.monthlyTrend?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Monthly Production Trend" sub="Latex (litres) · Rubber sheet (kg) · Rubber scrap (kg)" />
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={prodData.monthlyTrend}>
                    <defs>
                      {Object.entries(PROD_TYPE_COLOR).map(([k, c]) => (
                        <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={c} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={c} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="latex" name="Latex (L)" stroke={PROD_TYPE_COLOR.latex} fill={`url(#glatex)`} strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="sheet" name="Sheet (kg)" stroke={PROD_TYPE_COLOR.rubber_sheet} fill={`url(#grubber_sheet)`} strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="scrap" name="Scrap (kg)" stroke={PROD_TYPE_COLOR.rubber_scrap} fill={`url(#grubber_scrap)`} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState icon={Factory} label="No production entries found for this project" />}

            {/* Recent entries */}
            {prodData.entries?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="Production Entries" sub={`${prodData.entries.length} entries`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Date", "Type", "Quantity", "Batch", "Batch Status", "Entered By", "Remarks"]} />
                    <tbody>
                      {prodData.entries.slice(0, 80).map((e: {
                        id: string; productionType: string; quantity: number; unit: string;
                        productionDate: string; remarks: string | null; enteredByName: string;
                        batchNumber: string; batchDate: string; batchStatus: string;
                      }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-400 text-xs">{e.productionDate}</td>
                          <td className="px-3 py-2"><TypeLabel type={e.productionType} /></td>
                          <td className="px-3 py-2 text-white font-semibold">{parseNumeric(e.quantity).toFixed(2)} {e.unit}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs font-mono">{e.batchNumber}</td>
                          <td className="px-3 py-2"><Badge text={e.batchStatus} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{e.enteredByName}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">{e.remarks ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── BATCH REPORTS ────────────────────────────────────────────── */}
        {activeTab === "Batch Reports" && batchData && !batchLoading && (
          <div className="space-y-6">
            {/* Status summary cards */}
            {batchData.statusSummary?.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {batchData.statusSummary.map((s: { status: string; count: number; latexLitres: number; sheetKg: number; scrapKg: number }) => (
                  <div key={s.status} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <Badge text={s.status} />
                      <span className="text-white font-bold text-lg">{s.count}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Latex</span><span className="text-cyan-400">{s.latexLitres.toFixed(1)} L</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Sheet</span><span className="text-emerald-400">{s.sheetKg.toFixed(1)} kg</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Scrap</span><span className="text-amber-400">{s.scrapKg.toFixed(1)} kg</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Monthly output chart */}
            {batchData.monthlyOutput?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={BarChart2} title="Monthly Batch Output" sub="Sheet kg · Latex litres per month" />
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={batchData.monthlyOutput}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="sheetTotal" name="Sheet (kg)" fill={PROD_TYPE_COLOR.rubber_sheet} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="latexTotal" name="Latex (L)" fill={PROD_TYPE_COLOR.latex} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="scrapTotal" name="Scrap (kg)" fill={PROD_TYPE_COLOR.rubber_scrap} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Batch traceability table */}
            {batchData.batches?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Layers} title="Batch Traceability" sub={`${batchData.batches.length} batches — production to sale linkage`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Batch #", "Date", "Status", "Latex (L)", "Sheet (kg)", "Scrap (kg)", "Sales", "Sale Amount", "Last Sale", "Closed By"]} />
                    <tbody>
                      {batchData.batches.map((b: {
                        id: string; batchNumber: string; batchDate: string; status: string;
                        latexLitres: number; sheetKg: number; scrapKg: number; entryCount: number;
                        linkedSaleCount: number; linkedGross: number; linkedQty: number; lastSaleDate: string | null;
                        isSold: boolean; closedAt: string | null; createdByName: string;
                      }) => (
                        <tr key={b.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${b.isSold ? "bg-emerald-500/5" : ""}`}>
                          <td className="px-3 py-2 font-mono text-slate-300 text-xs">{b.batchNumber}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{b.batchDate}</td>
                          <td className="px-3 py-2"><Badge text={b.status} /></td>
                          <td className="px-3 py-2 text-cyan-400">{b.latexLitres > 0 ? `${b.latexLitres.toFixed(1)} L` : "—"}</td>
                          <td className="px-3 py-2 text-emerald-400">{b.sheetKg > 0 ? `${b.sheetKg.toFixed(1)} kg` : "—"}</td>
                          <td className="px-3 py-2 text-amber-400">{b.scrapKg > 0 ? `${b.scrapKg.toFixed(1)} kg` : "—"}</td>
                          <td className="px-3 py-2">
                            {b.linkedSaleCount > 0 ? (
                              <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                                <CheckCircle2 className="w-3 h-3" />{b.linkedSaleCount} sale{b.linkedSaleCount > 1 ? "s" : ""}
                              </span>
                            ) : <span className="text-slate-600 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-300">{b.linkedGross > 0 ? fmtINR(b.linkedGross) : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{b.lastSaleDate ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{b.closedAt ? fmtDate(String(b.closedAt)) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={Layers} label="No batches found for this project" />}
          </div>
        )}

        {/* ── INVENTORY MOVEMENT ───────────────────────────────────────── */}
        {activeTab === "Inventory Movement" && invData && !invLoading && (
          <div className="space-y-6">
            {/* Stock balance cards */}
            {invData.balances?.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {invData.balances.map((b: {
                  stockType: string; unit: string; balance: number; totalIn: number; totalOut: number;
                  productionInQty: number; saleOutQty: number; wastageQty: number; adjInQty: number; adjOutQty: number;
                  utilizationRate: number; lastMovement: string | null;
                }) => (
                  <div key={b.stockType} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: STOCK_COLOR[b.stockType] ?? "#94a3b8" }} />
                        <span className="text-slate-200 font-semibold capitalize">{b.stockType.replace(/_/g, " ")}</span>
                      </div>
                      <span className={`text-lg font-bold ${b.balance > 0 ? "text-white" : "text-rose-400"}`}>{b.balance.toFixed(2)} {b.unit}</span>
                    </div>
                    <div className="space-y-1 text-xs mb-3">
                      <div className="flex justify-between"><span className="text-slate-500 flex items-center gap-1"><ArrowUp className="w-3 h-3 text-emerald-400" />Total In</span><span className="text-emerald-400">{b.totalIn.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500 flex items-center gap-1"><ArrowDown className="w-3 h-3 text-rose-400" />Total Out</span><span className="text-rose-400">{b.totalOut.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Production In</span><span className="text-cyan-400">{b.productionInQty.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Sale Out</span><span className="text-violet-400">{b.saleOutQty.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Wastage</span><span className="text-orange-400">{b.wastageQty.toFixed(2)}</span></div>
                      {(b.adjInQty > 0 || b.adjOutQty > 0) && <div className="flex justify-between"><span className="text-slate-500">Adjustments</span><span className="text-slate-300">+{b.adjInQty.toFixed(1)} / -{b.adjOutQty.toFixed(1)}</span></div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, b.utilizationRate)}%`, background: STOCK_COLOR[b.stockType] }} />
                      </div>
                      <span className="text-xs text-slate-400">{b.utilizationRate.toFixed(0)}% utilized</span>
                    </div>
                    {b.lastMovement && <p className="text-slate-600 text-xs mt-1">Last: {b.lastMovement}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Monthly flow chart */}
            {invData.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Inventory Flow — Monthly" sub="In vs Out across all stock types" />
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={invData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                      formatter={(v: unknown, name: string, props: { payload?: { month: string } }) => {
                        const month = props.payload?.month ?? "";
                        const parts = name.split(".");
                        const stockType = parts[0];
                        const field = parts[1];
                        return [`${Number(v).toFixed(2)} (${stockType?.replace(/_/g, " ")} ${field})`, ""];
                      }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 11 }} />
                    <Bar dataKey="rubber_sheet.totalIn" name="Sheet In" fill="#10b981" stackId="in" />
                    <Bar dataKey="rubber_sheet.totalOut" name="Sheet Out" fill="#f43f5e" stackId="out" />
                    <Bar dataKey="latex.totalIn" name="Latex In" fill="#06b6d4" stackId="in2" />
                    <Bar dataKey="latex.totalOut" name="Latex Out" fill="#f97316" stackId="out2" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Movement type breakdown */}
            {invData.movementsByType?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Layers} title="Movements by Type" sub="All confirmed movements" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {invData.movementsByType.map((m: { movementType: string; direction: string; stockType: string; count: number; totalQty: number }) => (
                    <div key={`${m.movementType}-${m.stockType}`} className="p-3 bg-slate-900/40 rounded-lg border border-slate-700/50">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: MOVEMENT_COLOR[m.movementType] ?? "#94a3b8" }} />
                        <span className="text-slate-400 text-xs capitalize">{m.movementType.replace(/_/g, " ")}</span>
                      </div>
                      <div className="text-white font-semibold text-sm">{m.totalQty.toFixed(1)}</div>
                      <div className="text-slate-500 text-xs">{m.stockType.replace(/_/g, " ")} · {m.count} events</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stock aging */}
            {invData.aging?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Clock} title="Stock Aging Analysis" sub="Age of oldest in-stock production batches" />
                <div className="space-y-3">
                  {invData.aging.map((a: { stockType: string; oldestAgeDays: number; oldestIn: string | null; newestIn: string | null; estimatedBalance: number; productionBatches: number }) => (
                    <div key={a.stockType} className={`p-4 rounded-xl border ${a.oldestAgeDays > 90 ? "bg-orange-500/10 border-orange-500/30" : a.oldestAgeDays > 30 ? "bg-amber-500/10 border-amber-500/30" : "bg-slate-900/40 border-slate-700/50"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: STOCK_COLOR[a.stockType] ?? "#94a3b8" }} />
                          <span className="text-slate-200 font-semibold capitalize">{a.stockType.replace(/_/g, " ")}</span>
                        </div>
                        <span className={`font-bold text-sm ${a.oldestAgeDays > 90 ? "text-orange-400" : a.oldestAgeDays > 30 ? "text-amber-400" : "text-slate-300"}`}>
                          {a.oldestAgeDays}d oldest stock
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-3 mt-2 text-xs">
                        <div><span className="text-slate-500">Oldest in</span><div className="text-slate-300">{a.oldestIn ?? "—"}</div></div>
                        <div><span className="text-slate-500">Newest in</span><div className="text-slate-300">{a.newestIn ?? "—"}</div></div>
                        <div><span className="text-slate-500">Est. balance</span><div className="text-white font-semibold">{a.estimatedBalance.toFixed(1)}</div></div>
                        <div><span className="text-slate-500">Batches</span><div className="text-slate-300">{a.productionBatches}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Movement log */}
            {invData.movements?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={RefreshCw} title="Stock Movement Log" sub={`${invData.movements.length} records`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Date", "Stock Type", "Movement", "Dir", "Qty", "Ref", "Batch", "Status", "By"]} />
                    <tbody>
                      {invData.movements.slice(0, 80).map((m: {
                        id: string; stockType: string; movementType: string; direction: string;
                        quantity: number; unit: string; movementDate: string; referenceId: string | null;
                        referenceType: string | null; notes: string | null; status: string;
                        createdByName: string; batchNumber: string | null;
                      }) => (
                        <tr key={m.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-400 text-xs">{m.movementDate}</td>
                          <td className="px-3 py-2"><TypeLabel type={m.stockType} /></td>
                          <td className="px-3 py-2">
                            <span className="text-xs capitalize" style={{ color: MOVEMENT_COLOR[m.movementType] ?? "#94a3b8" }}>
                              {m.movementType.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {m.direction === "in"
                              ? <span className="flex items-center gap-1 text-emerald-400 text-xs"><ArrowUp className="w-3 h-3" />in</span>
                              : <span className="flex items-center gap-1 text-rose-400 text-xs"><ArrowDown className="w-3 h-3" />out</span>}
                          </td>
                          <td className="px-3 py-2 text-white font-semibold">{parseNumeric(m.quantity).toFixed(2)} {m.unit}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{m.referenceId ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{m.batchNumber ?? "—"}</td>
                          <td className="px-3 py-2"><Badge text={m.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{m.createdByName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SALES REPORTS ────────────────────────────────────────────── */}
        {activeTab === "Sales Reports" && salesData && !salesLoading && (
          <div className="space-y-6">
            {/* Monthly revenue trend */}
            {salesData.monthlyRevenue?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Monthly Revenue Trend" sub="Gross · Deductions · Net" />
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={salesData.monthlyRevenue}>
                    <defs>
                      <linearGradient id="gGross" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="gross" name="Gross" stroke="#10b981" fill="url(#gGross)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="net" name="Net" stroke="#3b82f6" fill="url(#gNet)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="deductions" name="Deductions" stroke="#f43f5e" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState icon={ShoppingCart} label="No confirmed sales found for this project" />}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By product type */}
              {salesData.byProductType?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={Package} title="Revenue by Product Type" sub="Qty · Gross · Avg rate" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Product", "Total Qty", "Total Gross", "Avg Rate", "Range"]} />
                      <tbody>
                        {salesData.byProductType.map((p: {
                          productType: string; unit: string; totalQty: number;
                          totalGross: number; avgRate: number; maxRate: number; minRate: number;
                        }) => (
                          <tr key={p.productType} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2"><TypeLabel type={p.productType} /></td>
                            <td className="px-3 py-2 text-slate-300">{p.totalQty.toFixed(2)} {p.unit}</td>
                            <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(p.totalGross)}</td>
                            <td className="px-3 py-2 text-white">₹{p.avgRate.toFixed(2)}/kg</td>
                            <td className="px-3 py-2 text-slate-500 text-xs">₹{p.minRate.toFixed(0)}–{p.maxRate.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Deductions breakdown */}
              {salesData.deductionBreakdown?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={AlertTriangle} title="Deduction Breakdown" sub="By type" />
                  <div className="space-y-3">
                    {salesData.deductionBreakdown.map((d: { deductionType: string; count: number; totalAmount: number; avgAmount: number }) => (
                      <div key={d.deductionType} className="flex items-center gap-3 p-3 bg-slate-900/40 rounded-lg border border-slate-700/50">
                        <div className="flex-1">
                          <span className="text-slate-300 capitalize text-sm">{d.deductionType.replace(/_/g, " ")}</span>
                          <span className="text-slate-500 text-xs ml-2">{d.count} deductions · avg {fmtINR(d.avgAmount)}</span>
                        </div>
                        <span className="text-rose-400 font-bold">{fmtINR(d.totalAmount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Rate trend chart */}
            {salesData.rateTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Rate Trend (₹/kg)" sub="Average sale rate per product per month" />
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={salesData.rateTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [`₹${v.toFixed(2)}/kg`]} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    {["latex","rubber_sheet","rubber_scrap"].map((type) => (
                      <Line key={type} type="monotone" dataKey={type} name={type.replace(/_/g, " ")} stroke={PROD_TYPE_COLOR[type]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Orders status */}
            {salesData.ordersStatus?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={ShoppingCart} title="Sales Orders by Status" sub="Payment workflow orders" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Order Status", "Payment Status", "Count", "Total Amount", "Total Qty (kg)"]} />
                    <tbody>
                      {salesData.ordersStatus.map((o: { orderStatus: string; paymentStatus: string; count: number; totalAmount: number; totalQty: number }, i: number) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2"><Badge text={o.orderStatus} /></td>
                          <td className="px-3 py-2"><Badge text={o.paymentStatus} /></td>
                          <td className="px-3 py-2 text-white font-bold">{o.count}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(o.totalAmount)}</td>
                          <td className="px-3 py-2 text-slate-300">{o.totalQty.toFixed(2)} kg</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Transaction list */}
            {salesData.transactions?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="Sales Transactions" sub={`${salesData.transactions.length} records`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Sale #", "Date", "Buyer", "Gross", "Deductions", "Net", "Status", "Confirmed By"]} />
                    <tbody>
                      {salesData.transactions.slice(0, 60).map((t: {
                        id: string; saleNumber: string; saleDate: string; buyerName: string;
                        gross: number; deductions: number; net: number; status: string;
                        confirmedByName: string | null; documentRef: string | null;
                      }) => (
                        <tr key={t.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 font-mono text-slate-400 text-xs">{t.saleNumber}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{t.saleDate}</td>
                          <td className="px-3 py-2 text-slate-200">{t.buyerName}</td>
                          <td className="px-3 py-2 text-slate-300">{fmtINR(t.gross)}</td>
                          <td className="px-3 py-2 text-rose-400">{t.deductions > 0 ? fmtINR(t.deductions) : "—"}</td>
                          <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(t.net)}</td>
                          <td className="px-3 py-2"><Badge text={t.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{t.confirmedByName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── WASTAGE ANALYTICS ────────────────────────────────────────── */}
        {activeTab === "Wastage Analytics" && wastageData && !wastageLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Wastage Events" value={String(wastageData.totalWastageEvents ?? 0)} sub="Total recorded events" icon={AlertTriangle} iconColor="text-orange-400" />
              <KPICard label="Total Wastage Qty" value={`${(wastageData.totalWastageQty ?? 0).toFixed(2)}`} sub="Mixed units" icon={Package} iconColor="text-rose-400" alert={Number(wastageData.totalWastageQty) > 100} />
              {wastageData.byStockType?.map((s: { stockType: string; totalWastage: number; unit: string; eventCount: number; avgPerEvent: number }) => (
                <KPICard key={s.stockType} label={`${s.stockType.replace(/_/g, " ")} wastage`}
                  value={`${s.totalWastage.toFixed(2)} ${s.unit}`}
                  sub={`${s.eventCount} events · avg ${s.avgPerEvent.toFixed(2)}/event`}
                  icon={Leaf} iconColor="text-amber-400" />
              ))}
            </div>

            {/* Wastage rate chart */}
            {wastageData.wastageRates?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Wastage Rate vs Production" sub="Monthly wastage % against total production input" />
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={wastageData.wastageRates.filter((r: { stockType: string }) => r.stockType === "rubber_sheet")}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis yAxisId="qty" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis yAxisId="pct" orientation="right" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar yAxisId="qty" dataKey="productionIn" name="Production In (kg)" fill="#10b981" opacity={0.5} radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="qty" dataKey="wastage" name="Wastage (kg)" fill="#f97316" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="pct" type="monotone" dataKey="wastageRate" name="Wastage %" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-slate-500 text-xs mt-2">Showing rubber sheet. Wastage % = wastage / (production + wastage)</p>
              </div>
            )}

            {/* Monthly wastage by stock type */}
            {wastageData.monthlyWastage?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={BarChart2} title="Monthly Wastage by Stock Type" />
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={(() => {
                    const m: Record<string, { month: string; [k: string]: string | number }> = {};
                    for (const r of wastageData.monthlyWastage as { month: string; stockType: string; wastageQty: number }[]) {
                      if (!m[r.month]) m[r.month] = { month: r.month };
                      m[r.month][r.stockType] = r.wastageQty;
                    }
                    return Object.values(m).sort((a, b) => String(a.month).localeCompare(String(b.month)));
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    {["latex","rubber_sheet","rubber_scrap"].map(type => (
                      <Bar key={type} dataKey={type} name={type.replace(/_/g, " ")} fill={PROD_TYPE_COLOR[type]} stackId="a" radius={type === "rubber_scrap" ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Wastage event log */}
            {wastageData.events?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="Wastage Event Log" sub={`${wastageData.events.length} events`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Date", "Stock Type", "Quantity", "Batch", "Reason/Notes", "Status", "Recorded By"]} />
                    <tbody>
                      {wastageData.events.map((e: {
                        id: string; stockType: string; quantity: number; unit: string;
                        movementDate: string; notes: string | null; status: string;
                        createdByName: string; batchNumber: string | null;
                      }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-400 text-xs">{e.movementDate}</td>
                          <td className="px-3 py-2"><TypeLabel type={e.stockType} /></td>
                          <td className="px-3 py-2 text-orange-400 font-semibold">{parseNumeric(e.quantity).toFixed(2)} {e.unit}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{e.batchNumber ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">{e.notes ?? "—"}</td>
                          <td className="px-3 py-2"><Badge text={e.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{e.createdByName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={AlertTriangle} label="No wastage events recorded for this project" />}
          </div>
        )}

        {/* ── BUYER SUMMARIES ──────────────────────────────────────────── */}
        {activeTab === "Buyer Summaries" && buyerData && !buyerLoading && (
          <div className="space-y-6">
            {/* Buyer ranking */}
            {buyerData.buyerTotals?.length > 0 ? (
              <div className="space-y-3">
                <SectionTitle icon={Users} title="Buyer Rankings" sub="By net revenue — confirmed sales only" />
                {buyerData.buyerTotals.map((b: {
                  rank: number; buyerName: string; transactionCount: number;
                  totalGross: number; totalDeductions: number; totalNet: number;
                  totalQtyPurchased: number; firstPurchase: string | null; lastPurchase: string | null;
                }, i: number) => (
                  <div key={b.buyerName} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-slate-900" style={{ background: BUYER_COLORS[i % BUYER_COLORS.length] }}>
                          {b.rank}
                        </div>
                        <div>
                          <span className="text-slate-100 font-semibold">{b.buyerName}</span>
                          <span className="text-slate-500 text-xs ml-2">{b.transactionCount} transactions</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-emerald-400 font-bold text-lg">{fmtINR(b.totalNet)}</div>
                        <div className="text-slate-500 text-xs">net revenue</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                      <div className="p-2 bg-slate-900/40 rounded text-center">
                        <div className="text-slate-300 font-bold">{fmtINR(b.totalGross)}</div>
                        <div className="text-slate-500">Gross</div>
                      </div>
                      <div className="p-2 bg-slate-900/40 rounded text-center">
                        <div className="text-rose-400 font-bold">{fmtINR(b.totalDeductions)}</div>
                        <div className="text-slate-500">Deductions</div>
                      </div>
                      <div className="p-2 bg-slate-900/40 rounded text-center">
                        <div className="text-cyan-400 font-bold">{b.totalQtyPurchased.toFixed(1)} kg</div>
                        <div className="text-slate-500">Total Qty</div>
                      </div>
                      <div className="p-2 bg-slate-900/40 rounded text-center">
                        <div className="text-slate-300">{b.firstPurchase ?? "—"}</div>
                        <div className="text-slate-500">First Purchase</div>
                      </div>
                      <div className="p-2 bg-slate-900/40 rounded text-center">
                        <div className="text-slate-300">{b.lastPurchase ?? "—"}</div>
                        <div className="text-slate-500">Last Purchase</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyState icon={Users} label="No buyer data found for this project" />}

            {/* Rate analysis from orders */}
            {buyerData.rateAnalysis?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={BarChart2} title="Buyer Rate Analysis" sub="From completed sales orders" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Buyer", "Orders", "Avg Rate", "Max Rate", "Min Rate", "Total Qty", "Total Amount"]} />
                    <tbody>
                      {buyerData.rateAnalysis.map((r: {
                        buyerName: string; orderCount: number; avgRate: number;
                        maxRate: number; minRate: number; totalQty: number; totalAmount: number;
                      }) => (
                        <tr key={r.buyerName} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 font-medium">{r.buyerName}</td>
                          <td className="px-3 py-2 text-slate-400">{r.orderCount}</td>
                          <td className="px-3 py-2 text-white font-bold">₹{r.avgRate.toFixed(2)}/kg</td>
                          <td className="px-3 py-2 text-emerald-400">₹{r.maxRate.toFixed(2)}</td>
                          <td className="px-3 py-2 text-rose-400">₹{r.minRate.toFixed(2)}</td>
                          <td className="px-3 py-2 text-slate-300">{r.totalQty.toFixed(2)} kg</td>
                          <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(r.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Product preferences */}
            {buyerData.byProduct?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Package} title="Buyer Product Preferences" sub="What each buyer purchases" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Buyer", "Product", "Total Qty", "Total Gross", "Avg Rate", "Lines"]} />
                    <tbody>
                      {buyerData.byProduct.map((p: {
                        buyerName: string; productType: string; unit: string;
                        totalQty: number; totalGross: number; avgRate: number; lineCount: number;
                      }, i: number) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200">{p.buyerName}</td>
                          <td className="px-3 py-2"><TypeLabel type={p.productType} /></td>
                          <td className="px-3 py-2 text-slate-300">{p.totalQty.toFixed(2)} {p.unit}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(p.totalGross)}</td>
                          <td className="px-3 py-2 text-white">₹{p.avgRate.toFixed(2)}/kg</td>
                          <td className="px-3 py-2 text-slate-500">{p.lineCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Seller performance */}
            {buyerData.sellerPerformance?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={CircleDot} title="Sales Staff Performance" sub="From sales orders" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Seller", "Role", "Total Orders", "Completed", "Completion Rate", "Revenue"]} />
                    <tbody>
                      {buyerData.sellerPerformance.map((s: {
                        sellerName: string; sellerRole: string | null; orderCount: number;
                        completed: number; completionRate: number; totalRevenue: number;
                      }) => (
                        <tr key={s.sellerName} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 font-medium">{s.sellerName}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{s.sellerRole ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-300">{s.orderCount}</td>
                          <td className="px-3 py-2 text-emerald-400">{s.completed}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(100, s.completionRate)}%` }} />
                              </div>
                              <span className="text-xs text-slate-400">{s.completionRate.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(s.totalRevenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
