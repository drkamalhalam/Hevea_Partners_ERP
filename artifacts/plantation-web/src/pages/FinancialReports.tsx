import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  FileText, TrendingUp, TrendingDown, DollarSign, BarChart3,
  Users, ChevronRight, CheckCircle2, AlertTriangle, Clock,
  Layers, ArrowUpRight, ArrowDownRight, Repeat, CreditCard,
  BookOpen, Scale, Activity, Globe,
} from "lucide-react";
import { useRole } from "../contexts/RoleContext";

// ── API helpers ───────────────────────────────────────────────────────────
const API = (path: string) => `/api/${path}`;
const fetcher = (url: string) => fetch(url, { credentials: "include" }).then((r) => r.json());

// ── Constants ─────────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = ["all", ...Array.from({ length: 8 }, (_, i) => String(CURRENT_YEAR - i))];
const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#f43f5e", "#8b5cf6", "#06b6d4", "#f97316", "#94a3b8"];

const TABS = ["P&L Statement", "Revenue", "Expenditure", "LCA", "Burden & Recoverable", "Settlements", "Year Summary", "Partner Report"] as const;
type Tab = (typeof TABS)[number];

// ── Formatters ────────────────────────────────────────────────────────────
const fmtINR = (n: number | string | undefined | null) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtNum = (n: number | string | undefined | null, decimals = 1) =>
  Number(n ?? 0).toFixed(decimals);
const fmtPct = (n: number | undefined | null) => `${(n ?? 0).toFixed(1)}%`;
const tipINR = (v: number) => fmtINR(v);

const LCS_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "text-amber-400" },
  partial: { label: "Partial", color: "text-blue-400" },
  paid: { label: "Paid", color: "text-emerald-400" },
};

const DIST_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "text-slate-400" },
  pending: { label: "Pending", color: "text-amber-400" },
  partial: { label: "Partial", color: "text-blue-400" },
  paid: { label: "Paid", color: "text-emerald-400" },
  carried_forward: { label: "Carried Fwd", color: "text-violet-400" },
  archived: { label: "Archived", color: "text-slate-500" },
};

const MODEL_LABELS: Record<string, string> = {
  ownership_contribution: "Ownership & Contribution",
  fifty_percent_revenue: "50% Revenue Split",
};

// ── Shared UI ─────────────────────────────────────────────────────────────
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

function KPICard({ label, value, sub, icon: Icon, iconColor, trend }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; iconColor: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-xs font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-slate-500 text-xs">{sub}</div>}
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

function Badge({ text, colorClass }: { text: string; colorClass: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>{text}</span>;
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-700">
        {cols.map((c) => (
          <th key={c} className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{c}</th>
        ))}
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

// ── Main Component ────────────────────────────────────────────────────────
export default function FinancialReports() {
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const [activeTab, setActiveTab] = useState<Tab>("P&L Statement");
  const [projectId, setProjectId] = useState("");
  const [year, setYear] = useState<string>("all");
  const [partnerId, setPartnerId] = useState("");

  // Projects list
  const { data: projectsData } = useQuery({
    queryKey: ["fin-reports-projects"],
    queryFn: () => fetcher(API("financial-reports/projects")) as Promise<{
      projects: { id: string; name: string; projectCode?: string; commercialModel: string; lifecycleStatus: string }[];
    }>,
  });
  const projects = projectsData?.projects ?? [];

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !projectId) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const isOwnership = selectedProject?.commercialModel === "ownership_contribution";

  // Partners list for selected project
  const { data: partnersData } = useQuery({
    queryKey: ["fin-reports-partners", projectId],
    queryFn: () => fetcher(API(`financial-reports/partners?projectId=${projectId}`)) as Promise<{
      partners: { id: string; name: string; role: string; email?: string }[];
    }>,
    enabled: !!projectId,
  });
  const partners = partnersData?.partners ?? [];

  // Auto-select first partner
  useEffect(() => {
    if (partners.length > 0 && !partnerId) setPartnerId(partners[0].id);
  }, [partners, partnerId]);

  // Statement (P&L + Revenue + Expenditure)
  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ["fin-statement", projectId, year],
    queryFn: () => fetcher(API(`financial-reports/statement?projectId=${projectId}&year=${year}`)),
    enabled: !!projectId && ["P&L Statement", "Revenue", "Expenditure"].includes(activeTab),
  });

  // LCA
  const { data: lcaData, isLoading: lcaLoading } = useQuery({
    queryKey: ["fin-lca", projectId],
    queryFn: () => fetcher(API(`financial-reports/lca?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "LCA",
  });

  // Burden
  const { data: burdenData, isLoading: burdenLoading } = useQuery({
    queryKey: ["fin-burden", projectId, year],
    queryFn: () => fetcher(API(`financial-reports/burden?projectId=${projectId}&year=${year}`)),
    enabled: !!projectId && activeTab === "Burden & Recoverable",
  });

  // Settlements
  const { data: settlementsData, isLoading: settLoading } = useQuery({
    queryKey: ["fin-settlements", projectId, year],
    queryFn: () => fetcher(API(`financial-reports/settlements?projectId=${projectId}&year=${year}`)),
    enabled: !!projectId && activeTab === "Settlements",
  });

  // Year Summary
  const { data: yearData, isLoading: yearLoading } = useQuery({
    queryKey: ["fin-year-summary", projectId],
    queryFn: () => fetcher(API(`financial-reports/year-summary?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "Year Summary",
  });

  // Partner Report
  const { data: partnerReport, isLoading: partnerLoading } = useQuery({
    queryKey: ["fin-partner-report", projectId, partnerId],
    queryFn: () => fetcher(API(`financial-reports/partner-report?projectId=${projectId}&partnerId=${partnerId}`)),
    enabled: !!projectId && !!partnerId && activeTab === "Partner Report",
  });

  const isLoading = stmtLoading || lcaLoading || burdenLoading || settLoading || yearLoading || partnerLoading;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              Financial Reports
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Revenue · Expenditure · LCA · Burden · Settlements · Year Summary
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setPartnerId(""); }}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[180px]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y === "all" ? "All Years" : `CY ${y}`}</option>
              ))}
            </select>

            {activeTab === "Partner Report" && (
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[160px]"
              >
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Project badge row */}
        {selectedProject && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {selectedProject.projectCode && (
              <span className="text-slate-500 text-xs font-mono border border-slate-700 px-2 py-0.5 rounded">{selectedProject.projectCode}</span>
            )}
            <Badge
              text={MODEL_LABELS[selectedProject.commercialModel] ?? selectedProject.commercialModel}
              colorClass={isOwnership ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"}
            />
            <Badge
              text={selectedProject.lifecycleStatus.replace(/_/g, " ")}
              colorClass="bg-slate-500/20 text-slate-400 border-slate-500/30"
            />
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 mt-3 border-b border-slate-800 -mb-4 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap flex-shrink-0 ${
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
        {!projectId && (
          <EmptyState icon={Globe} label="Select a project to view financial reports" />
        )}

        {projectId && isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Activity className="w-8 h-8 mb-3 animate-pulse opacity-40" />
            <p>Loading report data…</p>
          </div>
        )}

        {/* ── P&L STATEMENT ─────────────────────────────────────────────────── */}
        {activeTab === "P&L Statement" && statement && (
          <div className="space-y-6">
            {/* P&L KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Gross Revenue" value={fmtINR(statement.pnl?.grossRevenue)} sub={isOwnership ? "Production sales" : "50% model gross"} icon={DollarSign} iconColor="text-emerald-400" />
              <KPICard label="Total Expenditure" value={fmtINR(statement.pnl?.totalExpenditure)} sub={`${statement.expenditure?.count ?? 0} records`} icon={TrendingDown} iconColor="text-rose-400" />
              <KPICard label="Gross Profit" value={fmtINR(statement.pnl?.grossProfit)} sub={`${fmtPct(statement.pnl?.profitMargin)} margin`} icon={TrendingUp} iconColor={Number(statement.pnl?.grossProfit) >= 0 ? "text-emerald-400" : "text-rose-400"} />
              <KPICard label="Net Profit (after LCA)" value={fmtINR(statement.pnl?.netProfit)} sub={`${fmtPct(statement.pnl?.netMargin)} net margin`} icon={Scale} iconColor={Number(statement.pnl?.netProfit) >= 0 ? "text-emerald-400" : "text-rose-400"} />
            </div>

            {/* Income Statement */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={BookOpen} title="Income Statement" sub={`${year === "all" ? "All years" : `CY ${year}`} · ${selectedProject?.name}`} />
                <div className="space-y-1">
                  <div className="flex justify-between py-2 text-sm font-semibold text-slate-300 border-b border-slate-700">
                    <span>REVENUE</span><span></span>
                  </div>
                  {isOwnership ? (
                    <>
                      <StatRow label="Production Revenue" value={fmtINR(statement.production?.totalRevenue)} valueClass="text-emerald-400" />
                      <StatRow label="Avg Selling Price" value={`₹${fmtNum(statement.production?.avgSellingPrice, 2)}/kg`} />
                      <StatRow label="Kg Produced" value={`${fmtNum(statement.production?.totalProductionKg, 1)} kg`} />
                      <StatRow label="Kg Sold" value={`${fmtNum(statement.production?.totalSoldKg, 1)} kg`} />
                    </>
                  ) : (
                    <>
                      <StatRow label="50% Gross Revenue" value={fmtINR(statement.fiftyPct?.grossRevenue)} valueClass="text-emerald-400" />
                      <StatRow label="Landowner Net" value={fmtINR(statement.fiftyPct?.landownerNet)} valueClass="text-emerald-400" />
                      <StatRow label="Participant Pool" value={fmtINR(statement.fiftyPct?.poolSplit)} valueClass="text-violet-400" />
                      <StatRow label="Operational Cost" value={fmtINR(statement.fiftyPct?.opCost)} />
                    </>
                  )}
                  <div className="flex justify-between py-2 text-sm font-semibold text-slate-300 border-b border-slate-700 mt-2">
                    <span>EXPENDITURE</span><span></span>
                  </div>
                  <StatRow label="Total Expenditure" value={fmtINR(statement.expenditure?.total)} valueClass="text-rose-400" />
                  <StatRow label="Verified" value={fmtINR(statement.expenditure?.verified)} valueClass="text-emerald-400" />
                  <StatRow label="Pending Verification" value={fmtINR(statement.expenditure?.draft)} valueClass="text-amber-400" />
                  <div className="flex justify-between py-2 text-sm font-semibold text-slate-300 border-b border-slate-700 mt-2">
                    <span>PROFIT / LOSS</span><span></span>
                  </div>
                  <StatRow label="Gross Profit" value={fmtINR(statement.pnl?.grossProfit)} valueClass={Number(statement.pnl?.grossProfit) >= 0 ? "text-emerald-400" : "text-rose-400"} />
                  {isOwnership && statement.lca?.applicable && (
                    <StatRow label="LCA Payments Made" value={`(${fmtINR(statement.lca?.totalPaid)})`} valueClass="text-amber-400" />
                  )}
                  <div className="flex justify-between py-3 mt-1 border-t-2 border-slate-600">
                    <span className="text-slate-200 font-bold">Net Profit</span>
                    <span className={`font-bold text-lg ${Number(statement.pnl?.netProfit) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmtINR(statement.pnl?.netProfit)}
                    </span>
                  </div>
                </div>
              </div>

              {/* LCA + Landowner Ledger Summary */}
              <div className="space-y-4">
                {isOwnership && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Repeat} title="LCA Summary" />
                    <StatRow label="Total Due" value={fmtINR(statement.lca?.totalDue)} />
                    <StatRow label="Total Paid" value={fmtINR(statement.lca?.totalPaid)} valueClass="text-emerald-400" />
                    <StatRow label="Outstanding" value={fmtINR(statement.lca?.outstanding)} valueClass={Number(statement.lca?.outstanding) > 0 ? "text-amber-400" : "text-emerald-400"} />
                    <StatRow label="Carry Forward" value={fmtINR(statement.lca?.totalCarryForward)} valueClass="text-violet-400" />
                    <StatRow label="Total Entries" value={String(statement.lca?.totalEntries ?? 0)} />
                    <StatRow label="Pending Entries" value={String(statement.lca?.pendingCount ?? 0)} valueClass={Number(statement.lca?.pendingCount) > 0 ? "text-amber-400" : "text-emerald-400"} />
                  </div>
                )}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={Users} title="Landowner Ledger Summary" />
                  <StatRow label="Revenue Credits" value={fmtINR(statement.landownerLedger?.revenueCredit)} valueClass="text-emerald-400" />
                  <StatRow label="Burden Debits" value={fmtINR(statement.landownerLedger?.burdenDebit)} valueClass="text-rose-400" />
                  <StatRow label="Recoverable Credit" value={fmtINR(statement.landownerLedger?.recoverableCredit)} valueClass="text-blue-400" />
                  <StatRow label="Recoverable Debit" value={fmtINR(statement.landownerLedger?.recoverableDebit)} valueClass="text-orange-400" />
                  <div className="flex justify-between py-3 mt-1 border-t-2 border-slate-600">
                    <span className="text-slate-200 font-bold">Net Ledger Position</span>
                    <span className={`font-bold ${Number(statement.landownerLedger?.netPosition) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmtINR(statement.landownerLedger?.netPosition)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Monthly Trend Chart */}
            {statement.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Monthly Revenue vs Expenditure" />
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={statement.monthlyTrend}>
                    <defs>
                      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} labelStyle={{ color: "#94a3b8" }} formatter={(v: number) => [tipINR(v)]} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" fill="url(#gRev)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="expenditure" name="Expenditure" stroke="#f43f5e" fill="url(#gExp)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="profit" name="Profit" stroke="#3b82f6" fill="none" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── REVENUE TAB ──────────────────────────────────────────────────────── */}
        {activeTab === "Revenue" && statement && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {isOwnership ? (
                <>
                  <KPICard label="Total Revenue" value={fmtINR(statement.production?.totalRevenue)} sub={`${statement.production?.recordCount ?? 0} records`} icon={DollarSign} iconColor="text-emerald-400" />
                  <KPICard label="Kg Produced" value={`${fmtNum(statement.production?.totalProductionKg)} kg`} sub="All batches" icon={Activity} iconColor="text-blue-400" />
                  <KPICard label="Kg Sold" value={`${fmtNum(statement.production?.totalSoldKg)} kg`} sub="Revenue-generating" icon={TrendingUp} iconColor="text-violet-400" />
                  <KPICard label="Avg Price" value={`₹${fmtNum(statement.production?.avgSellingPrice, 2)}/kg`} sub="Selling price per kg" icon={CreditCard} iconColor="text-amber-400" />
                </>
              ) : (
                <>
                  <KPICard label="Gross Revenue" value={fmtINR(statement.fiftyPct?.grossRevenue)} sub={`${statement.fiftyPct?.confirmedCount ?? 0} confirmed sessions`} icon={DollarSign} iconColor="text-emerald-400" />
                  <KPICard label="Landowner Net" value={fmtINR(statement.fiftyPct?.landownerNet)} sub="After deductions" icon={Users} iconColor="text-violet-400" />
                  <KPICard label="Participant Pool" value={fmtINR(statement.fiftyPct?.poolSplit)} sub="Economic participants" icon={Layers} iconColor="text-blue-400" />
                  <KPICard label="Operational Cost" value={fmtINR(statement.fiftyPct?.opCost)} sub="Deducted from gross" icon={TrendingDown} iconColor="text-rose-400" />
                </>
              )}
            </div>

            {/* Revenue chart */}
            {statement.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={BarChart3} title={isOwnership ? "Monthly Production Revenue" : "50% Session Revenue by Period"} />
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={isOwnership ? statement.monthlyTrend : statement.fiftyPct?.sessions}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey={isOwnership ? "month" : "period"} stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={40} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} labelStyle={{ color: "#94a3b8" }} formatter={(v: number) => [tipINR(v)]} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    {isOwnership ? (
                      <>
                        <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="productionKg" name="Production Kg" fill="#3b82f6" radius={[3, 3, 0, 0]} yAxisId={1} hide />
                      </>
                    ) : (
                      <>
                        <Bar dataKey="grossRevenue" name="Gross Revenue" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="landownerNet" name="Landowner Net" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="poolSplit" name="Pool Split" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Session/Record Table */}
            {!isOwnership && (statement.fiftyPct?.sessions?.length ?? 0) > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="50% Revenue Sessions" sub={`${(statement.fiftyPct?.sessions?.length ?? 0)} sessions`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Period", "Year", "Gross Revenue", "Landowner Net", "Pool Split", "Op Cost", "Status"]} />
                    <tbody>
                      {statement.fiftyPct.sessions.map((s: { period: string; year: number; grossRevenue: number; landownerNet: number; poolSplit: number; opCost: number; status: string }, i: number) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300">{s.period}</td>
                          <td className="px-3 py-2 text-slate-400">{s.year}</td>
                          <td className="px-3 py-2 text-emerald-400 font-medium">{fmtINR(s.grossRevenue)}</td>
                          <td className="px-3 py-2 text-violet-400">{fmtINR(s.landownerNet)}</td>
                          <td className="px-3 py-2 text-blue-400">{fmtINR(s.poolSplit)}</td>
                          <td className="px-3 py-2 text-rose-400">{fmtINR(s.opCost)}</td>
                          <td className="px-3 py-2">
                            <Badge text={s.status} colorClass={s.status === "confirmed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {isOwnership && statement.production?.monthly?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 pt-4 pb-0">
                  <SectionTitle icon={FileText} title="Monthly Production Records" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Month", "Revenue", "Production Kg", "Sold Kg", "Avg Price/kg"]} />
                    <tbody>
                      {statement.production.monthly.map((m: { month: string; revenue: number; productionKg: number; soldKg: number; avgPrice: number }) => (
                        <tr key={m.month} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300">{m.month}</td>
                          <td className="px-3 py-2 text-emerald-400 font-medium">{fmtINR(m.revenue)}</td>
                          <td className="px-3 py-2 text-slate-300">{fmtNum(m.productionKg)} kg</td>
                          <td className="px-3 py-2 text-slate-300">{fmtNum(m.soldKg)} kg</td>
                          <td className="px-3 py-2 text-amber-400">₹{fmtNum(m.avgPrice, 2)}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-700/30 font-semibold">
                        <td className="px-3 py-2 text-slate-200">Total</td>
                        <td className="px-3 py-2 text-emerald-400">{fmtINR(statement.production?.totalRevenue)}</td>
                        <td className="px-3 py-2 text-slate-200">{fmtNum(statement.production?.totalProductionKg)} kg</td>
                        <td className="px-3 py-2 text-slate-200">{fmtNum(statement.production?.totalSoldKg)} kg</td>
                        <td className="px-3 py-2 text-amber-400">₹{fmtNum(statement.production?.avgSellingPrice, 2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── EXPENDITURE TAB ──────────────────────────────────────────────────── */}
        {activeTab === "Expenditure" && statement && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Total Expenditure" value={fmtINR(statement.expenditure?.total)} sub={`${statement.expenditure?.count ?? 0} records`} icon={TrendingDown} iconColor="text-rose-400" />
              <KPICard label="Verified" value={fmtINR(statement.expenditure?.verified)} sub="Approved expenditure" icon={CheckCircle2} iconColor="text-emerald-400" />
              <KPICard label="Pending" value={fmtINR(statement.expenditure?.draft)} sub="Awaiting verification" icon={Clock} iconColor="text-amber-400" />
              <KPICard label="Verification Rate" value={fmtPct(Number(statement.expenditure?.total) > 0 ? (Number(statement.expenditure?.verified) / Number(statement.expenditure?.total)) * 100 : 0)} sub="Approved / Total" icon={CheckCircle2} iconColor="text-emerald-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Expenditure by Category Pie */}
              {statement.expenditure?.byCategory?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={Layers} title="By Category" />
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={statement.expenditure.byCategory} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={80} label={({ category, percent }: { category: string; percent: number }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {statement.expenditure.byCategory.map((_: unknown, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [tipINR(v)]} />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Category breakdown table */}
              {statement.expenditure?.byCategory?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 pt-4 pb-0">
                    <SectionTitle icon={BarChart3} title="Category Breakdown" />
                  </div>
                  <div className="px-5 pb-5 space-y-3">
                    {statement.expenditure.byCategory.map((cat: { category: string; total: number; count: number }) => {
                      const total = statement.expenditure.byCategory.reduce((s: number, c: { total: number }) => s + c.total, 0);
                      const pct = total > 0 ? (cat.total / total) * 100 : 0;
                      return (
                        <div key={cat.category}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-300">{cat.category}</span>
                            <span className="text-slate-400">{fmtINR(cat.total)} ({cat.count})</span>
                          </div>
                          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Monthly Expenditure Trend */}
            {statement.expenditure?.monthly?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingDown} title="Monthly Expenditure Trend" />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={statement.expenditure.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} labelStyle={{ color: "#94a3b8" }} formatter={(v: number) => [tipINR(v)]} />
                    <Bar dataKey="expenditure" name="Expenditure" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── LCA TAB ──────────────────────────────────────────────────────────── */}
        {activeTab === "LCA" && (
          <div className="space-y-6">
            {!isOwnership ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Scale className="w-12 h-12 mb-3 opacity-30" />
                <p className="font-medium">LCA is not applicable for 50% Revenue model projects</p>
                <p className="text-xs mt-1">LCA applies only to Ownership & Contribution model projects</p>
              </div>
            ) : lcaData ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Total Due" value={fmtINR(lcaData.summary?.totalDue)} sub={`${lcaData.summary?.totalEntries ?? 0} LCA entries`} icon={DollarSign} iconColor="text-rose-400" />
                  <KPICard label="Total Paid" value={fmtINR(lcaData.summary?.totalPaid)} sub={`${lcaData.summary?.paidCount ?? 0} fully paid`} icon={CheckCircle2} iconColor="text-emerald-400" />
                  <KPICard label="Outstanding" value={fmtINR(lcaData.summary?.outstanding)} sub={`${lcaData.summary?.pendingCount ?? 0} pending`} icon={Clock} iconColor={Number(lcaData.summary?.outstanding) > 0 ? "text-amber-400" : "text-emerald-400"} />
                  <KPICard label="Total Carry-Forward" value={fmtINR(lcaData.summary?.totalCarryForward)} sub="Rolled from prior years" icon={Repeat} iconColor="text-violet-400" />
                </div>

                {/* LCA Entries Table */}
                {lcaData.entries?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <SectionTitle icon={BookOpen} title="LCA Ledger — Year-wise Entries" sub="Land Contribution Adjustment" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["LCA Year", "Base Amount", "Esc. Factor", "Gross Due", "Carry Fwd", "Total Due", "Paid", "Balance", "Status"]} />
                        <tbody>
                          {lcaData.entries.map((e: { id: string; year: number; baseAmount: number; escalationFactor: number; grossDue: number; carryForward: number; totalDue: number; amountPaid: number; balance: number; status: string; paidAt?: string }) => (
                            <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2 text-slate-300 font-medium">Year {e.year}</td>
                              <td className="px-3 py-2 text-slate-400">{fmtINR(e.baseAmount)}</td>
                              <td className="px-3 py-2 text-slate-400">{e.escalationFactor.toFixed(3)}×</td>
                              <td className="px-3 py-2 text-slate-300">{fmtINR(e.grossDue)}</td>
                              <td className="px-3 py-2 text-violet-400">{e.carryForward > 0 ? fmtINR(e.carryForward) : "—"}</td>
                              <td className="px-3 py-2 text-white font-semibold">{fmtINR(e.totalDue)}</td>
                              <td className="px-3 py-2 text-emerald-400">{fmtINR(e.amountPaid)}</td>
                              <td className={`px-3 py-2 font-semibold ${e.balance > 0 ? "text-amber-400" : "text-emerald-400"}`}>{fmtINR(e.balance)}</td>
                              <td className="px-3 py-2">
                                <Badge text={LCS_STATUS[e.status]?.label ?? e.status} colorClass={e.status === "paid" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : e.status === "partial" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} />
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-slate-700/40 font-bold border-t border-slate-600">
                            <td colSpan={5} className="px-3 py-2 text-slate-300">Total</td>
                            <td className="px-3 py-2 text-white">{fmtINR(lcaData.summary?.totalDue)}</td>
                            <td className="px-3 py-2 text-emerald-400">{fmtINR(lcaData.summary?.totalPaid)}</td>
                            <td className={`px-3 py-2 ${Number(lcaData.summary?.outstanding) > 0 ? "text-amber-400" : "text-emerald-400"}`}>{fmtINR(lcaData.summary?.outstanding)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Payment History */}
                {lcaData.payments?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <SectionTitle icon={CreditCard} title="LCA Payment History" sub={`${lcaData.payments?.length ?? 0} payments`} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["LCA Year", "Amount Paid", "Payment Date", "Reference", "Recorded By"]} />
                        <tbody>
                          {lcaData.payments.map((p: { id: string; year: number; amountPaid: number; paymentDate: string; paymentRef?: string; recordedByName: string; notes?: string }) => (
                            <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2 text-slate-300">Year {p.year}</td>
                              <td className="px-3 py-2 text-emerald-400 font-medium">{fmtINR(p.amountPaid)}</td>
                              <td className="px-3 py-2 text-slate-400">{p.paymentDate}</td>
                              <td className="px-3 py-2 text-slate-500">{p.paymentRef ?? "—"}</td>
                              <td className="px-3 py-2 text-slate-400">{p.recordedByName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {lcaData.entries?.length === 0 && (
                  <EmptyState icon={BookOpen} label="No LCA entries found for this project" />
                )}
              </>
            ) : null}
          </div>
        )}

        {/* ── BURDEN & RECOVERABLE TAB ─────────────────────────────────────────── */}
        {activeTab === "Burden & Recoverable" && burdenData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Revenue Credits" value={fmtINR(burdenData.summary?.totalRevenue)} sub="Landowner entitlement" icon={DollarSign} iconColor="text-emerald-400" />
              <KPICard label="Burden Debits" value={fmtINR(burdenData.summary?.totalBurden)} sub="Operational charges" icon={TrendingDown} iconColor="text-rose-400" />
              <KPICard label="Recoverable Burden" value={fmtINR(burdenData.summary?.totalRecoverableBurden)} sub="Can be recovered" icon={Repeat} iconColor="text-amber-400" />
              <KPICard label="Net Ledger Position" value={fmtINR(burdenData.summary?.netPosition)} sub={`${burdenData.summary?.negativePartners ?? 0} partners negative`} icon={Scale} iconColor={Number(burdenData.summary?.netPosition) >= 0 ? "text-emerald-400" : "text-rose-400"} />
            </div>

            {/* Per-partner breakdown */}
            {burdenData.byPartner?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Users} title="Partner-wise Ledger" sub={`${burdenData.byPartner?.length} partners`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner", "Role", "Rev Credit", "Burden Debit", "Rec Credit", "Rec Debit", "LCA Credit", "Net Position"]} />
                    <tbody>
                      {burdenData.byPartner.map((p: { partnerId: string; partnerName: string; partnerRole: string; revenueCredit: number; burdenDebit: number; recoverableCredit: number; recoverableDebit: number; lcaCredit: number; netPosition: number; isNegative: boolean; entryCount: number }) => (
                        <tr key={p.partnerId} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${p.isNegative ? "bg-rose-500/5" : ""}`}>
                          <td className="px-3 py-2 font-medium text-slate-200">{p.partnerName}</td>
                          <td className="px-3 py-2"><Badge text={p.partnerRole} colorClass="bg-slate-500/20 text-slate-400 border-slate-500/30" /></td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(p.revenueCredit)}</td>
                          <td className="px-3 py-2 text-rose-400">{fmtINR(p.burdenDebit)}</td>
                          <td className="px-3 py-2 text-blue-400">{p.recoverableCredit > 0 ? fmtINR(p.recoverableCredit) : "—"}</td>
                          <td className="px-3 py-2 text-orange-400">{p.recoverableDebit > 0 ? fmtINR(p.recoverableDebit) : "—"}</td>
                          <td className="px-3 py-2 text-violet-400">{p.lcaCredit > 0 ? fmtINR(p.lcaCredit) : "—"}</td>
                          <td className={`px-3 py-2 font-bold ${p.isNegative ? "text-rose-400" : "text-emerald-400"}`}>
                            {p.isNegative ? "(" : ""}{fmtINR(Math.abs(p.netPosition))}{p.isNegative ? ")" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Entry detail table */}
            {burdenData.entries?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="Ledger Entry Detail" sub={`${burdenData.entries?.length} entries`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner", "Type", "Dir", "Period", "Amount", "Ownership%", "Status", "Recoverable"]} />
                    <tbody>
                      {burdenData.entries.map((e: { id: string; partnerName: string; entryType: string; direction: string; periodLabel: string; amount: number; ownershipPct?: number; status: string; isRecoverable: boolean; recoveryStatus: string; recoveredAmount: number }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300 font-medium">{e.partnerName}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{e.entryType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2">
                            <Badge text={e.direction} colorClass={e.direction === "credit" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border-rose-500/30"} />
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{e.periodLabel}</td>
                          <td className={`px-3 py-2 font-medium ${e.direction === "credit" ? "text-emerald-400" : "text-rose-400"}`}>{fmtINR(e.amount)}</td>
                          <td className="px-3 py-2 text-slate-400">{e.ownershipPct != null ? `${e.ownershipPct.toFixed(2)}%` : "—"}</td>
                          <td className="px-3 py-2"><Badge text={e.status} colorClass={e.status === "confirmed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} /></td>
                          <td className="px-3 py-2 text-xs">
                            {e.isRecoverable ? (
                              <span className={e.recoveryStatus === "full" ? "text-emerald-400" : "text-amber-400"}>
                                {e.recoveryStatus} ({fmtINR(e.recoveredAmount)})
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {burdenData.entries?.length === 0 && (
              <EmptyState icon={Users} label="No landowner ledger entries found" />
            )}
          </div>
        )}

        {/* ── SETTLEMENTS TAB ──────────────────────────────────────────────────── */}
        {activeTab === "Settlements" && settlementsData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Distribution Paid" value={fmtINR(settlementsData.distribution?.summary?.totalPaid)} sub={`${settlementsData.distribution?.summary?.paidCount ?? 0} paid records`} icon={CheckCircle2} iconColor="text-emerald-400" />
              <KPICard label="Distribution Pending" value={fmtINR(settlementsData.distribution?.summary?.totalPending)} sub={`${settlementsData.distribution?.summary?.pendingCount ?? 0} pending`} icon={Clock} iconColor={Number(settlementsData.distribution?.summary?.totalPending) > 0 ? "text-amber-400" : "text-emerald-400"} />
              <KPICard label="Carry-Forward" value={fmtINR(settlementsData.distribution?.summary?.totalCarryForward)} sub={`${settlementsData.distribution?.summary?.carriedCount ?? 0} carried records`} icon={Repeat} iconColor="text-violet-400" />
              <KPICard label="Finalized Settlements" value={String(settlementsData.settlements?.summary?.finalizedCount ?? 0)} sub={`${settlementsData.settlements?.summary?.totalCount ?? 0} total`} icon={FileText} iconColor="text-blue-400" />
            </div>

            {/* Distribution Records */}
            {settlementsData.distribution?.records?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={CreditCard} title="Distribution Records" sub={`${settlementsData.distribution?.records?.length} records (latest 100)`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Period", "Partner", "Type", "Gross Revenue", "Recommendation", "Paid", "Pending", "Carry Fwd", "Status"]} />
                    <tbody>
                      {settlementsData.distribution.records.map((r: { id: string; period: string; partnerName?: string; settlementType?: string; grossRevenue: number; recommendation: number; totalPaid: number; pendingPayable: number; carryForward: number; status: string }) => (
                        <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300 text-xs">{r.period}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{r.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{r.settlementType?.replace(/_/g, " ") ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-300">{fmtINR(r.grossRevenue)}</td>
                          <td className="px-3 py-2 text-blue-400">{fmtINR(r.recommendation)}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(r.totalPaid)}</td>
                          <td className={`px-3 py-2 ${r.pendingPayable > 0 ? "text-amber-400" : "text-emerald-400"}`}>{fmtINR(r.pendingPayable)}</td>
                          <td className={`px-3 py-2 ${r.carryForward > 0 ? "text-violet-400" : "text-slate-500"}`}>{r.carryForward > 0 ? fmtINR(r.carryForward) : "—"}</td>
                          <td className="px-3 py-2">
                            <Badge text={DIST_STATUS[r.status]?.label ?? r.status} colorClass={r.status === "paid" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : r.status === "carried_forward" ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : r.status === "partial" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Settlement Records */}
            {settlementsData.settlements?.records?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                  <SectionTitle icon={FileText} title="Settlement Records" sub={`${settlementsData.settlements?.records?.length ?? 0} records`} />
                  <div className="flex gap-3 text-xs text-slate-500 pb-4">
                    <span>Finalized: <span className="text-emerald-400">{settlementsData.settlements?.summary?.finalizedCount}</span></span>
                    <span>Disputed: <span className="text-rose-400">{settlementsData.settlements?.summary?.disputedCount}</span></span>
                    <span>Overridden: <span className="text-amber-400">{settlementsData.settlements?.summary?.overriddenCount}</span></span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Period", "Partner", "Type", "Recommended", "Actual", "Status", "Override"]} />
                    <tbody>
                      {settlementsData.settlements.records.map((r: { id: string; periodLabel: string; partnerName?: string; settlementType: string; recommendedAmount?: number; actualAmount?: number; status: string; isOverridden: boolean; overrideRemarks?: string }) => (
                        <tr key={r.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${r.isOverridden ? "bg-amber-500/5" : ""}`}>
                          <td className="px-3 py-2 text-slate-300 text-xs">{r.periodLabel}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{r.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{r.settlementType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-blue-400">{r.recommendedAmount != null ? fmtINR(r.recommendedAmount) : "—"}</td>
                          <td className="px-3 py-2 text-emerald-400">{r.actualAmount != null ? fmtINR(r.actualAmount) : "—"}</td>
                          <td className="px-3 py-2">
                            <Badge text={r.status} colorClass={r.status === "finalized" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : r.status === "disputed" ? "bg-rose-500/20 text-rose-400 border-rose-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} />
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {r.isOverridden ? (
                              <span className="text-amber-400" title={r.overrideRemarks ?? ""}>✓ Overridden</span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {settlementsData.distribution?.records?.length === 0 && settlementsData.settlements?.records?.length === 0 && (
              <EmptyState icon={FileText} label="No settlement records found" />
            )}
          </div>
        )}

        {/* ── YEAR SUMMARY TAB ─────────────────────────────────────────────────── */}
        {activeTab === "Year Summary" && yearData && (
          <div className="space-y-6">
            {yearData.years?.length === 0 ? (
              <EmptyState icon={BarChart3} label="No year-wise data available" />
            ) : (
              <>
                {/* Year-over-year chart */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={BarChart3} title="Year-over-Year Revenue vs Expenditure" />
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={yearData.years}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="year" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} labelStyle={{ color: "#94a3b8" }} formatter={(v: number) => [tipINR(v)]} />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                      <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="expenditure" name="Expenditure" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="grossProfit" name="Gross Profit" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Year-over-year table */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={FileText} title="Year-wise Accounting Summary" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Year", "Revenue", "Expenditure", "Gross Profit", "Margin", "Prod Kg", "Sold Kg", "LCA Due", "LCA Paid", "Dist Paid", "Dist Pending"]} />
                      <tbody>
                        {yearData.years.map((y: { year: number; revenue: number; expenditure: number; grossProfit: number; profitMargin: number; productionKg: number; soldKg: number; lcaDue: number; lcaPaid: number; distributionPaid: number; distributionPending: number }) => (
                          <tr key={y.year} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 font-semibold text-white">{y.year}</td>
                            <td className="px-3 py-2 text-emerald-400">{fmtINR(y.revenue)}</td>
                            <td className="px-3 py-2 text-rose-400">{fmtINR(y.expenditure)}</td>
                            <td className={`px-3 py-2 font-semibold ${y.grossProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtINR(y.grossProfit)}</td>
                            <td className={`px-3 py-2 ${y.profitMargin >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtPct(y.profitMargin)}</td>
                            <td className="px-3 py-2 text-slate-400">{fmtNum(y.productionKg)} kg</td>
                            <td className="px-3 py-2 text-slate-400">{fmtNum(y.soldKg)} kg</td>
                            <td className="px-3 py-2 text-amber-400">{y.lcaDue > 0 ? fmtINR(y.lcaDue) : "—"}</td>
                            <td className="px-3 py-2 text-emerald-400">{y.lcaPaid > 0 ? fmtINR(y.lcaPaid) : "—"}</td>
                            <td className="px-3 py-2 text-emerald-400">{y.distributionPaid > 0 ? fmtINR(y.distributionPaid) : "—"}</td>
                            <td className={`px-3 py-2 ${y.distributionPending > 0 ? "text-amber-400" : "text-slate-500"}`}>{y.distributionPending > 0 ? fmtINR(y.distributionPending) : "—"}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-700/40 font-bold border-t border-slate-600">
                          <td className="px-3 py-2 text-slate-300">Total</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(yearData.totals?.revenue)}</td>
                          <td className="px-3 py-2 text-rose-400">{fmtINR(yearData.totals?.expenditure)}</td>
                          <td className={`px-3 py-2 ${Number(yearData.totals?.grossProfit) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtINR(yearData.totals?.grossProfit)}</td>
                          <td colSpan={4}></td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(yearData.totals?.lcaPaid)}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(yearData.totals?.distributionPaid)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PARTNER REPORT TAB ───────────────────────────────────────────────── */}
        {activeTab === "Partner Report" && (
          <div className="space-y-6">
            {partners.length === 0 ? (
              <EmptyState icon={Users} label="No partners linked to this project" />
            ) : partnerReport ? (
              <>
                {/* Partner info header */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                          <Users className="w-5 h-5 text-slate-300" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-white">{partnerReport.partner?.name}</h2>
                          <p className="text-slate-400 text-sm capitalize">{partnerReport.partner?.role?.replace(/_/g, " ")}</p>
                        </div>
                      </div>
                      {partnerReport.partner?.email && (
                        <p className="text-slate-500 text-xs mt-2">{partnerReport.partner.email}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        text={MODEL_LABELS[partnerReport.project?.commercialModel] ?? partnerReport.project?.commercialModel}
                        colorClass={partnerReport.project?.commercialModel === "ownership_contribution" ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"}
                      />
                      {partnerReport.ledger?.ownershipPct > 0 && (
                        <span className="text-slate-400 text-xs">Ownership: {partnerReport.ledger.ownershipPct.toFixed(2)}%</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Summary KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Revenue Credits" value={fmtINR(partnerReport.ledger?.revenueCredit)} sub="Entitlement" icon={DollarSign} iconColor="text-emerald-400" />
                  <KPICard label="Burden Debits" value={fmtINR(partnerReport.ledger?.burdenDebit)} sub="Operational charges" icon={TrendingDown} iconColor="text-rose-400" />
                  <KPICard label="Distribution Paid" value={fmtINR(partnerReport.distribution?.paid)} sub={`${partnerReport.distribution?.paidCount ?? 0} payments`} icon={CreditCard} iconColor="text-blue-400" />
                  <KPICard label="Net Ledger Position" value={fmtINR(partnerReport.ledger?.netPosition)} sub={partnerReport.ledger?.isNegative ? "Negative balance" : "Positive"} icon={Scale} iconColor={partnerReport.ledger?.isNegative ? "text-rose-400" : "text-emerald-400"} />
                </div>

                {/* Detailed breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Ledger breakdown */}
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={BookOpen} title="Landowner Ledger" sub="Confirmed entries only" />
                    <StatRow label="Revenue Entitlement" value={fmtINR(partnerReport.ledger?.revenueCredit)} valueClass="text-emerald-400" />
                    <StatRow label="Operational Burden" value={fmtINR(partnerReport.ledger?.burdenDebit)} valueClass="text-rose-400" />
                    <StatRow label="Recoverable Credit" value={fmtINR(partnerReport.ledger?.recoverableCredit)} valueClass="text-blue-400" />
                    <StatRow label="Recoverable Debit" value={fmtINR(partnerReport.ledger?.recoverableDebit)} valueClass="text-orange-400" />
                    <StatRow label="LCA Credit" value={fmtINR(partnerReport.ledger?.lcaCredit)} valueClass="text-violet-400" />
                    <StatRow label="Other Credits" value={fmtINR(partnerReport.ledger?.otherCredit)} valueClass="text-emerald-300" />
                    <StatRow label="Other Debits" value={fmtINR(partnerReport.ledger?.otherDebit)} valueClass="text-rose-300" />
                    <div className="flex justify-between py-3 mt-2 border-t-2 border-slate-600">
                      <span className="text-slate-200 font-bold">Net Position</span>
                      <span className={`font-bold text-lg ${partnerReport.ledger?.isNegative ? "text-rose-400" : "text-emerald-400"}`}>
                        {partnerReport.ledger?.isNegative ? "(" : ""}{fmtINR(Math.abs(Number(partnerReport.ledger?.netPosition)))}{partnerReport.ledger?.isNegative ? ")" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Distribution + LCA + Contributions */}
                  <div className="space-y-4">
                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                      <SectionTitle icon={CreditCard} title="Distributions" />
                      <StatRow label="Total Paid" value={fmtINR(partnerReport.distribution?.paid)} valueClass="text-emerald-400" />
                      <StatRow label="Pending Payable" value={fmtINR(partnerReport.distribution?.pending)} valueClass={Number(partnerReport.distribution?.pending) > 0 ? "text-amber-400" : "text-emerald-400"} />
                      <StatRow label="Carry-Forward Balance" value={fmtINR(partnerReport.distribution?.carryForward)} valueClass={Number(partnerReport.distribution?.carryForward) > 0 ? "text-violet-400" : "text-emerald-400"} />
                      <StatRow label="Paid Records" value={String(partnerReport.distribution?.paidCount ?? 0)} />
                      <StatRow label="Pending Records" value={String(partnerReport.distribution?.pendingCount ?? 0)} valueClass={Number(partnerReport.distribution?.pendingCount) > 0 ? "text-amber-400" : "text-emerald-400"} />
                    </div>

                    {partnerReport.lca?.applicable && (
                      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                        <SectionTitle icon={Repeat} title="LCA Summary" />
                        <StatRow label="Total Due" value={fmtINR(partnerReport.lca?.totalDue)} />
                        <StatRow label="Total Paid" value={fmtINR(partnerReport.lca?.totalPaid)} valueClass="text-emerald-400" />
                        <StatRow label="Outstanding" value={fmtINR(partnerReport.lca?.outstanding)} valueClass={Number(partnerReport.lca?.outstanding) > 0 ? "text-amber-400" : "text-emerald-400"} />
                        <StatRow label="Carry-Forward" value={fmtINR(partnerReport.lca?.carryForward)} valueClass="text-violet-400" />
                      </div>
                    )}

                    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                      <SectionTitle icon={DollarSign} title="Contributions" />
                      <StatRow label="Total Contributed" value={fmtINR(partnerReport.contributions?.total)} />
                      <StatRow label="Verified" value={fmtINR(partnerReport.contributions?.verified)} valueClass="text-emerald-400" />
                      <StatRow label="Total Records" value={String(partnerReport.contributions?.count ?? 0)} />
                    </div>
                  </div>
                </div>

                {/* Financial Summary box */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={Scale} title="Financial Summary" sub="Partner financial position" />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-slate-900/40 rounded-lg border border-slate-700/50">
                      <div className="text-emerald-400 text-2xl font-bold">{fmtINR(partnerReport.summary?.totalReceivable)}</div>
                      <div className="text-slate-500 text-xs mt-1">Total Receivable</div>
                    </div>
                    <div className="text-center p-4 bg-slate-900/40 rounded-lg border border-slate-700/50">
                      <div className="text-rose-400 text-2xl font-bold">{fmtINR(partnerReport.summary?.totalPayable)}</div>
                      <div className="text-slate-500 text-xs mt-1">Total Payable</div>
                    </div>
                    <div className={`text-center p-4 rounded-lg border ${partnerReport.summary?.isNegativeBalance ? "bg-rose-500/10 border-rose-500/30" : "bg-emerald-500/10 border-emerald-500/30"}`}>
                      <div className={`text-2xl font-bold ${partnerReport.summary?.isNegativeBalance ? "text-rose-400" : "text-emerald-400"}`}>
                        {partnerReport.summary?.isNegativeBalance ? "(" : ""}{fmtINR(Math.abs(Number(partnerReport.summary?.netPosition)))}{partnerReport.summary?.isNegativeBalance ? ")" : ""}
                      </div>
                      <div className="text-slate-500 text-xs mt-1">Net Position</div>
                    </div>
                  </div>
                </div>
              </>
            ) : !partnerLoading && partnerId ? (
              <EmptyState icon={Users} label="No financial data found for this partner" />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
