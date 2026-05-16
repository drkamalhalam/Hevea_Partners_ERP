import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Scale, TrendingUp, DollarSign, AlertTriangle, CheckCircle2,
  Clock, Lock, Repeat, Users, Activity, ArrowRightLeft,
  Globe, FileText, Landmark, BarChart2, ShieldAlert,
  Banknote, Layers, ChevronRight, CircleDot,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url, { credentials: "include" }).then((r) => r.json());

// ── Constants ─────────────────────────────────────────────────────────────
const TABS = ["Overview", "Distribution History", "Settlements", "Overrides", "Landowner Accounting", "EPP Distribution", "Pending Payables"] as const;
type Tab = (typeof TABS)[number];

const PARTNER_COLORS = ["#10b981","#3b82f6","#f59e0b","#8b5cf6","#f43f5e","#06b6d4","#f97316","#a3e635","#ec4899","#94a3b8"];
const STATUS_COLORS: Record<string, string> = {
  paid: "text-emerald-400", finalized: "text-emerald-400", released: "text-emerald-400",
  partial: "text-amber-400", recommended: "text-blue-400",
  pending: "text-amber-400", pending_rofr: "text-amber-400",
  draft: "text-slate-400",
  overridden: "text-orange-400",
  disputed: "text-rose-400",
  carried_forward: "text-purple-400",
  held: "text-rose-400",
};
const STATUS_BADGE: Record<string, string> = {
  paid: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  finalized: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  draft: "bg-slate-600/30 text-slate-400 border-slate-600/30",
  overridden: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  disputed: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  carried_forward: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  held: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  released: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  recommended: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};
const MODULE_COLOR: Record<string, string> = {
  settlement: "text-orange-400", lca: "text-cyan-400",
  contributions: "text-green-400", ownership: "text-violet-400",
  expenditures: "text-rose-400", governance: "text-slate-400",
};

const ENTRY_TYPE_COLORS: Record<string, string> = {
  revenue_entitlement: "#10b981",
  operational_burden: "#f43f5e",
  recoverable_adjustment: "#f59e0b",
  lca_credit: "#3b82f6",
  other_credit: "#06b6d4",
  other_debit: "#8b5cf6",
};

// ── Formatters ────────────────────────────────────────────────────────────
const fmtINR = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number | null | undefined, dp = 1) =>
  `${Number(n ?? 0).toFixed(dp)}%`;
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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

function ModelTag({ model }: { model: string }) {
  return model === "ownership_contribution"
    ? <Badge text="Ownership Model" colorClass="bg-violet-500/20 text-violet-400 border-violet-500/30" />
    : <Badge text="50% Revenue Model" colorClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/30" />;
}

// ── Main Component ────────────────────────────────────────────────────────
export default function SettlementAnalytics() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [projectId, setProjectId] = useState("");

  const { data: projectsData } = useQuery({
    queryKey: ["sa-projects"],
    queryFn: () => fetcher("/api/settlement-analytics/projects") as Promise<{
      projects: { id: string; name: string; projectCode?: string; commercialModel: string; lifecycleStatus: string }[];
    }>,
  });
  const projects = projectsData?.projects ?? [];
  useEffect(() => { if (projects.length > 0 && !projectId) setProjectId(projects[0].id); }, [projects, projectId]);
  const selectedProject = projects.find((p) => p.id === projectId);
  const is50Pct = selectedProject?.commercialModel === "fifty_percent_revenue";
  const isOwnership = selectedProject?.commercialModel === "ownership_contribution";

  const enabled = !!projectId;
  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["sa-overview", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/overview?projectId=${projectId}`),
    enabled: enabled && activeTab === "Overview",
  });
  const { data: distData, isLoading: distLoading } = useQuery({
    queryKey: ["sa-distributions", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/distributions?projectId=${projectId}`),
    enabled: enabled && activeTab === "Distribution History",
  });
  const { data: settlData, isLoading: settlLoading } = useQuery({
    queryKey: ["sa-settlements", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/settlements?projectId=${projectId}`),
    enabled: enabled && activeTab === "Settlements",
  });
  const { data: overData, isLoading: overLoading } = useQuery({
    queryKey: ["sa-overrides", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/overrides?projectId=${projectId}`),
    enabled: enabled && activeTab === "Overrides",
  });
  const { data: lownrData, isLoading: lownrLoading } = useQuery({
    queryKey: ["sa-landowner", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/landowner?projectId=${projectId}`),
    enabled: enabled && activeTab === "Landowner Accounting",
  });
  const { data: eppData, isLoading: eppLoading } = useQuery({
    queryKey: ["sa-epp", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/epp?projectId=${projectId}`),
    enabled: enabled && activeTab === "EPP Distribution",
  });
  const { data: pendData, isLoading: pendLoading } = useQuery({
    queryKey: ["sa-pending", projectId],
    queryFn: () => fetcher(`/api/settlement-analytics/pending?projectId=${projectId}`),
    enabled: enabled && activeTab === "Pending Payables",
  });

  const loading = ovLoading || distLoading || settlLoading || overLoading || lownrLoading || eppLoading || pendLoading;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-400" />
              Settlement Analytics
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">Distribution · Settlements · Overrides · Landowner · EPP · Pending</p>
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
            <ModelTag model={selectedProject.commercialModel} />
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
        {!projectId && <EmptyState icon={Globe} label="Select a project to view settlement analytics" />}
        {projectId && loading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Activity className="w-8 h-8 mb-3 animate-pulse opacity-40" />
            <p>Loading settlement data…</p>
          </div>
        )}

        {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
        {activeTab === "Overview" && overview && !ovLoading && (
          <div className="space-y-6">
            {/* Model label */}
            <div className="flex items-center gap-3">
              <ModelTag model={overview.project?.commercialModel} />
              <span className="text-slate-500 text-sm">{overview.project?.lifecycleStatus?.replace(/_/g, " ")}</span>
            </div>

            {/* Model-specific KPIs */}
            {isOwnership && (
              <div>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Ownership Model — Distribution</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Total Gross Revenue" value={fmtINR(overview.ownershipModel?.totalGross)} sub={`${overview.ownershipModel?.totalRecords} distribution records`} icon={DollarSign} iconColor="text-emerald-400" />
                  <KPICard label="Total Recommended" value={fmtINR(overview.ownershipModel?.totalRecommended)} sub={`${overview.ownershipModel?.partnerCount} partners`} icon={Scale} iconColor="text-blue-400" />
                  <KPICard label="Total Paid" value={fmtINR(overview.ownershipModel?.totalPaid)} sub={`${overview.ownershipModel?.paymentRate?.toFixed(1)}% payment rate`} icon={CheckCircle2} iconColor="text-emerald-400" />
                  <KPICard label="Pending Payable" value={fmtINR(overview.ownershipModel?.totalPending)} sub={`${overview.ownershipModel?.pendingCount} records pending`} icon={Clock} iconColor={overview.ownershipModel?.totalPending > 0 ? "text-amber-400" : "text-emerald-400"} alert={overview.ownershipModel?.totalPending > 0} />
                </div>
                {overview.ownershipModel?.totalCarryForward > 0 && (
                  <div className="mt-3 flex items-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-sm">
                    <Repeat className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <span className="text-purple-300">{fmtINR(overview.ownershipModel?.totalCarryForward)} carried forward across {overview.ownershipModel?.carriedCount} records</span>
                  </div>
                )}
              </div>
            )}

            {is50Pct && (
              <div>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">50% Revenue Model — Session Summary</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Total Gross Revenue" value={fmtINR(overview.fiftyPctModel?.totalGross)} sub={`${overview.fiftyPctModel?.sessionCount} sessions`} icon={DollarSign} iconColor="text-emerald-400" />
                  <KPICard label="Landowner Split (50%)" value={fmtINR(overview.fiftyPctModel?.totalLandownerSplit)} sub={`Net after costs: ${fmtINR(overview.fiftyPctModel?.totalLandownerNet)}`} icon={Landmark} iconColor="text-amber-400" />
                  <KPICard label="Participant Pool Split" value={fmtINR(overview.fiftyPctModel?.totalParticipantSplit)} sub={`EPP Allocated: ${fmtINR(overview.fiftyPctModel?.totalEppAllocated)}`} icon={Users} iconColor="text-blue-400" />
                  <KPICard label="EPP Remainder" value={fmtINR(overview.fiftyPctModel?.totalEppRemainder)} sub={`${overview.fiftyPctModel?.finalizedCount} finalized sessions`} icon={BarChart2} iconColor="text-violet-400" />
                </div>
                {overview.fiftyPctModel?.totalLca > 0 && (
                  <div className="mt-3 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-sm flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                    <span className="text-cyan-300">LCA deducted: {fmtINR(overview.fiftyPctModel?.totalLca)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Settlement + Overrides row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Settlement Records" value={String(overview.settlements?.totalRecords ?? 0)} sub={`${overview.settlements?.finalizedCount} finalized`} icon={FileText} iconColor="text-blue-400" />
              <KPICard label="Overridden Settlements" value={String(overview.settlements?.hasOverrideCount ?? 0)} sub={`${overview.settlements?.totalOverrideEvents} override events`} icon={ShieldAlert} iconColor={overview.settlements?.hasOverrideCount > 0 ? "text-orange-400" : "text-emerald-400"} />
              <KPICard label="Total Deviation" value={fmtINR(overview.settlements?.totalDeviation)} sub="Actual vs recommended" icon={AlertTriangle} iconColor={Math.abs(overview.settlements?.totalDeviation ?? 0) > 0 ? "text-orange-400" : "text-emerald-400"} />
              <KPICard label="Governance Overrides" value={String(overview.overrides?.totalOverrides ?? 0)} sub={`Settlement: ${overview.overrides?.settlementOverrides ?? 0}`} icon={Activity} iconColor="text-orange-400" />
            </div>

            {/* Held + Pending row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Active Held Amount" value={fmtINR(overview.held?.activeHeldAmount)} sub={`${overview.held?.activeHeld} records held`} icon={Lock} iconColor={overview.held?.activeHeld > 0 ? "text-rose-400" : "text-emerald-400"} alert={overview.held?.activeHeld > 0} />
              <KPICard label="Total Released" value={fmtINR(overview.held?.totalReleased)} sub={`${overview.held?.releasedCount} releases`} icon={CheckCircle2} iconColor="text-emerald-400" />
              <KPICard label="Disputed Settlements" value={String(overview.settlements?.disputedCount ?? 0)} sub="Requires resolution" icon={AlertTriangle} iconColor={overview.settlements?.disputedCount > 0 ? "text-rose-400" : "text-emerald-400"} alert={overview.settlements?.disputedCount > 0} />
              <KPICard label="Landowner Net Position" value={fmtINR(overview.landownerLedger?.netPosition)} sub={`Credits: ${fmtINR(overview.landownerLedger?.totalCredits)}`} icon={Banknote} iconColor={overview.landownerLedger?.netPosition >= 0 ? "text-emerald-400" : "text-rose-400"} />
            </div>

            {/* Pending by status breakdown */}
            {Object.keys(overview.pendingByStatus ?? {}).length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Clock} title="Outstanding Payable Breakdown" sub="By status" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {Object.entries(overview.pendingByStatus as Record<string, { count: number; pendingTotal: number; carryTotal: number }>).map(([status, v]) => (
                    <div key={status} className="p-4 bg-slate-900/40 rounded-lg border border-slate-700/50">
                      <Badge text={status} />
                      <div className="text-white text-lg font-bold mt-2">{fmtINR(v.pendingTotal)}</div>
                      <div className="text-slate-500 text-xs">{v.count} records</div>
                      {v.carryTotal > 0 && <div className="text-purple-400 text-xs">+ {fmtINR(v.carryTotal)} carry-out</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Landowner ledger by type */}
            {overview.landownerLedger?.byType?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Landmark} title="Landowner Ledger Summary" sub="By entry type — credits vs debits" />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Entry Type", "Total Credits", "Total Debits", "Net"]} />
                    <tbody>
                      {(overview.landownerLedger.byType as { type: string; creditTotal: number; debitTotal: number; net: number }[]).map((t) => (
                        <tr key={t.type} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ background: ENTRY_TYPE_COLORS[t.type] ?? "#94a3b8" }} />
                              <span className="text-slate-300 capitalize">{t.type.replace(/_/g, " ")}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-emerald-400">{t.creditTotal > 0 ? fmtINR(t.creditTotal) : "—"}</td>
                          <td className="px-3 py-2 text-rose-400">{t.debitTotal > 0 ? fmtINR(t.debitTotal) : "—"}</td>
                          <td className={`px-3 py-2 font-bold ${t.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtINR(t.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── DISTRIBUTION HISTORY ─────────────────────────────────────── */}
        {activeTab === "Distribution History" && distData && !distLoading && (
          <div className="space-y-6">
            {/* Model separator */}
            {isOwnership && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 py-2 border-b border-violet-500/30">
                  <div className="w-1 h-5 bg-violet-400 rounded-full" />
                  <span className="text-violet-300 font-semibold text-sm">Ownership Model Distributions</span>
                </div>

                {/* Monthly trend chart */}
                {distData.ownershipModel?.monthly?.length > 0 ? (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="Monthly Distribution Trend" sub="Gross · Recommended · Paid · Pending" />
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={distData.ownershipModel.monthly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Bar dataKey="gross" name="Gross Revenue" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="paid" name="Paid" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState icon={BarChart2} label="No ownership model distributions recorded" />}

                {/* Per-partner table */}
                {distData.ownershipModel?.byPartner?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <SectionTitle icon={Users} title="Per-Partner Distribution Summary" sub="Ownership model" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["Partner", "Records", "Gross", "Recommended", "Paid", "Pending", "Carry Fwd", "Payment Rate", "Last Payment"]} />
                        <tbody>
                          {distData.ownershipModel.byPartner.map((p: {
                            partnerId: string; partnerName: string; partnerRole: string; recordCount: number;
                            totalGross: number; totalRecommended: number; totalPaid: number; totalPending: number;
                            totalCarryForward: number; paymentRate: number; lastPaymentDate: string | null;
                          }, i: number) => (
                            <tr key={p.partnerId} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ background: PARTNER_COLORS[i % PARTNER_COLORS.length] }} />
                                  <span className="text-slate-200 font-medium">{p.partnerName}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-slate-400">{p.recordCount}</td>
                              <td className="px-3 py-2 text-slate-300">{fmtINR(p.totalGross)}</td>
                              <td className="px-3 py-2 text-blue-400">{fmtINR(p.totalRecommended)}</td>
                              <td className="px-3 py-2 text-emerald-400">{fmtINR(p.totalPaid)}</td>
                              <td className="px-3 py-2 text-amber-400">{p.totalPending > 0 ? fmtINR(p.totalPending) : "—"}</td>
                              <td className="px-3 py-2 text-purple-400">{p.totalCarryForward > 0 ? fmtINR(p.totalCarryForward) : "—"}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(100, p.paymentRate)}%` }} />
                                  </div>
                                  <span className={`text-xs font-medium ${p.paymentRate >= 100 ? "text-emerald-400" : p.paymentRate > 50 ? "text-amber-400" : "text-rose-400"}`}>{p.paymentRate.toFixed(0)}%</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-slate-500 text-xs">{p.lastPaymentDate ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Records list */}
                {distData.ownershipModel?.records?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <SectionTitle icon={FileText} title="Distribution Records" sub={`${distData.ownershipModel.records.length} records`} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["Period", "Partner", "Type", "Gross", "Recommended", "Paid", "Pending", "Carry In", "Status"]} />
                        <tbody>
                          {distData.ownershipModel.records.slice(0, 50).map((r: {
                            id: string; period: string; partnerName: string | null; settlementType: string | null;
                            gross: number; recommended: number; paid: number; pending: number; carryIn: number; status: string;
                          }) => (
                            <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2 text-slate-300 text-xs font-mono">{r.period}</td>
                              <td className="px-3 py-2 text-slate-200">{r.partnerName ?? "—"}</td>
                              <td className="px-3 py-2 text-slate-500 text-xs capitalize">{r.settlementType?.replace(/_/g, " ") ?? "—"}</td>
                              <td className="px-3 py-2 text-slate-300">{fmtINR(r.gross)}</td>
                              <td className="px-3 py-2 text-blue-400">{fmtINR(r.recommended)}</td>
                              <td className="px-3 py-2 text-emerald-400">{fmtINR(r.paid)}</td>
                              <td className="px-3 py-2 text-amber-400">{r.pending > 0 ? fmtINR(r.pending) : "—"}</td>
                              <td className="px-3 py-2 text-purple-400">{r.carryIn > 0 ? fmtINR(r.carryIn) : "—"}</td>
                              <td className="px-3 py-2"><Badge text={r.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {is50Pct && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 py-2 border-b border-cyan-500/30">
                  <div className="w-1 h-5 bg-cyan-400 rounded-full" />
                  <span className="text-cyan-300 font-semibold text-sm">50% Revenue Model Sessions</span>
                </div>

                {distData.fiftyPctModel?.monthly?.length > 0 ? (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="50% Revenue — Monthly Distribution" sub="Gross · Landowner split · Participant pool · LCA" />
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={distData.fiftyPctModel.monthly}>
                        <defs>
                          {[["gGross","#10b981"],["gLO","#f59e0b"],["gPool","#3b82f6"],["gLca","#f43f5e"]].map(([id, c]) => (
                            <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={c} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={c} stopOpacity={0} />
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Area type="monotone" dataKey="gross" name="Gross" stroke="#10b981" fill="url(#gGross)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="landownerSplit" name="Landowner Split" stroke="#f59e0b" fill="url(#gLO)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="participantSplit" name="Participant Pool" stroke="#3b82f6" fill="url(#gPool)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="lca" name="LCA" stroke="#f43f5e" fill="url(#gLca)" strokeWidth={1} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState icon={BarChart2} label="No 50% revenue sessions recorded" />}

                {distData.fiftyPctModel?.sessions?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <SectionTitle icon={FileText} title="Revenue Sessions" sub={`${distData.fiftyPctModel.sessions.length} sessions`} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["Period", "Gross", "Landowner Split", "Participant Pool", "LCA", "Landowner Net", "EPP Allocated", "Status"]} />
                        <tbody>
                          {distData.fiftyPctModel.sessions.map((s: {
                            id: string; period: string; gross: number; landownerSplit: number;
                            participantSplit: number; lca: number; landownerNet: number; eppAllocated: number; status: string;
                          }) => (
                            <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2 text-slate-300 text-xs font-mono">{s.period}</td>
                              <td className="px-3 py-2 text-slate-300">{fmtINR(s.gross)}</td>
                              <td className="px-3 py-2 text-amber-400">{fmtINR(s.landownerSplit)}</td>
                              <td className="px-3 py-2 text-blue-400">{fmtINR(s.participantSplit)}</td>
                              <td className="px-3 py-2 text-rose-400">{s.lca > 0 ? fmtINR(s.lca) : "—"}</td>
                              <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(s.landownerNet)}</td>
                              <td className="px-3 py-2 text-violet-400">{s.eppAllocated > 0 ? fmtINR(s.eppAllocated) : "—"}</td>
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
          </div>
        )}

        {/* ── SETTLEMENTS ──────────────────────────────────────────────── */}
        {activeTab === "Settlements" && settlData && !settlLoading && (
          <div className="space-y-6">
            {/* By type summary */}
            {settlData.byType?.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {settlData.byType.map((t: {
                  settlementType: string; count: number; finalized: number; overridden: number;
                  totalRecommended: number; totalActual: number; totalDeviation: number; overrideRate: number;
                }) => (
                  <div key={t.settlementType} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-slate-300 font-semibold text-sm capitalize">{t.settlementType.replace(/_/g, " ")}</span>
                      <span className="text-slate-500 text-xs">{t.count} records</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Recommended</span><span className="text-blue-400">{fmtINR(t.totalRecommended)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Actual</span><span className="text-white font-semibold">{fmtINR(t.totalActual)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Deviation</span><span className={`font-medium ${Math.abs(t.totalDeviation) > 0 ? "text-orange-400" : "text-emerald-400"}`}>{t.totalDeviation > 0 ? "+" : ""}{fmtINR(t.totalDeviation)}</span></div>
                      <div className="flex justify-between mt-2"><span className="text-slate-500">Override rate</span><span className={`${t.overrideRate > 0 ? "text-orange-400" : "text-emerald-400"}`}>{t.overrideRate.toFixed(1)}%</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Finalized</span><span className="text-emerald-400">{t.finalized}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Top deviations */}
            {settlData.topDeviations?.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
                <SectionTitle icon={AlertTriangle} title="Largest Override Deviations" sub="Actual vs recommended — overridden records only" />
                <div className="space-y-2">
                  {settlData.topDeviations.map((d: { settlementType: string; period: string; absDeviation: number; rawDeviation: number; status: string }, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-slate-900/40 rounded-lg border border-slate-700/40">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 font-mono text-xs w-6">#{i + 1}</span>
                        <span className="text-slate-300 text-sm capitalize">{d.settlementType.replace(/_/g, " ")}</span>
                        <span className="text-slate-500 text-xs font-mono">{d.period}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold text-sm ${d.rawDeviation > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {d.rawDeviation > 0 ? "+" : ""}{fmtINR(d.rawDeviation)}
                        </span>
                        <Badge text={d.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Settlement records table */}
            {settlData.records?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Scale} title="Settlement Records" sub={`${settlData.records.length} records — actual vs recommended`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Period", "Partner", "Type", "Recommended", "Actual", "Deviation", "Overrides", "Status", "Finalized"]} />
                    <tbody>
                      {settlData.records.map((r: {
                        id: string; period: string; partnerName: string | null; settlementType: string;
                        recommended: number | null; actual: number | null; deviation: number | null; deviationPct: number | null;
                        isOverridden: boolean; overrideCount: number; status: string; finalizedAt: string | null; finalizedByName: string | null;
                      }) => (
                        <tr key={r.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${r.isOverridden ? "bg-orange-500/5" : ""}`}>
                          <td className="px-3 py-2 text-slate-400 text-xs font-mono">{r.period}</td>
                          <td className="px-3 py-2 text-slate-200">{r.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{r.settlementType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-blue-400">{r.recommended != null ? fmtINR(r.recommended) : "—"}</td>
                          <td className="px-3 py-2 text-white font-semibold">{r.actual != null ? fmtINR(r.actual) : "—"}</td>
                          <td className="px-3 py-2">
                            {r.deviation != null ? (
                              <span className={`font-medium text-xs ${r.deviation > 0 ? "text-emerald-400" : r.deviation < 0 ? "text-rose-400" : "text-slate-500"}`}>
                                {r.deviation > 0 ? "+" : ""}{fmtINR(r.deviation)}
                                {r.deviationPct != null && <span className="text-slate-500 ml-1">({r.deviation > 0 ? "+" : ""}{r.deviationPct.toFixed(1)}%)</span>}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {r.isOverridden ? (
                              <span className="text-orange-400 font-medium text-xs flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3" />{r.overrideCount}
                              </span>
                            ) : <span className="text-slate-600 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-2"><Badge text={r.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{r.finalizedAt ? fmtDate(r.finalizedAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={Scale} label="No settlement records found" />}
          </div>
        )}

        {/* ── OVERRIDES ────────────────────────────────────────────────── */}
        {activeTab === "Overrides" && overData && !overLoading && (
          <div className="space-y-6">
            {/* Monthly override trend */}
            {overData.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Override Activity — Monthly Trend" sub="By module" />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={overData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="settlement" name="Settlement" fill="#f97316" stackId="a" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="lca" name="LCA" fill="#06b6d4" stackId="a" />
                    <Bar dataKey="contributions" name="Contributions" fill="#10b981" stackId="a" />
                    <Bar dataKey="ownership" name="Ownership" fill="#8b5cf6" stackId="a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By module */}
              {overData.byModule?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={Layers} title="Overrides by Module" sub="All governance override types" />
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {overData.byModule.map((m: { module: string; overrideType: string; count: number; latest: string | null }) => (
                      <div key={`${m.module}-${m.overrideType}`} className="flex items-center justify-between p-2 bg-slate-900/40 rounded-lg">
                        <div>
                          <span className={`font-medium text-sm ${MODULE_COLOR[m.module] ?? "text-slate-300"}`}>{m.module}</span>
                          <span className="text-slate-500 text-xs ml-2">{m.overrideType.replace(/_/g, " ")}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-white font-bold text-sm">{m.count}</span>
                          {m.latest && <div className="text-slate-600 text-xs">{fmtDate(m.latest)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By actor */}
              {overData.byActor?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={Users} title="Overrides by Actor" sub="Who performed overrides" />
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {overData.byActor.map((a: { actorName: string; actorRole: string | null; count: number; latest: string | null }, i: number) => (
                      <div key={a.actorName} className="flex items-center justify-between p-2 bg-slate-900/40 rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-slate-900" style={{ background: PARTNER_COLORS[i % PARTNER_COLORS.length] }}>
                            {a.actorName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="text-slate-200 text-sm">{a.actorName}</span>
                            {a.actorRole && <span className="text-slate-500 text-xs ml-2">{a.actorRole}</span>}
                          </div>
                        </div>
                        <span className="text-white font-bold">{a.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Settlement override events */}
            {overData.settlementEvents?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="Settlement Override Events" sub="Immutable audit trail" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Event", "Partner", "Period", "Type", "Prev Amount", "New Amount", "By", "Date"]} />
                    <tbody>
                      {overData.settlementEvents.slice(0, 50).map((e: {
                        id: string; eventType: string; partnerName: string | null; period: string; settlementType: string;
                        prevAmount: number | null; newAmount: number | null; prevStatus: string | null; newStatus: string | null;
                        performedByName: string | null; performedAt: string | null; remarks: string | null;
                      }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2">
                            <span className={`text-xs font-medium capitalize ${e.eventType === "overridden" ? "text-orange-400" : e.eventType === "finalized" ? "text-emerald-400" : e.eventType === "disputed" ? "text-rose-400" : "text-slate-400"}`}>
                              {e.eventType.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-300">{e.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{e.period}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{e.settlementType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-400">{e.prevAmount != null ? fmtINR(e.prevAmount) : "—"}</td>
                          <td className="px-3 py-2 text-white font-semibold">{e.newAmount != null ? fmtINR(e.newAmount) : "—"}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{e.performedByName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(e.performedAt ? String(e.performedAt) : null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Governance override log */}
            {overData.governanceOverrides?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={ShieldAlert} title="Governance Override Log" sub={`${overData.governanceOverrides.length} records — write-once audit trail`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Type", "Module", "Title", "Reason", "Actor", "Date"]} />
                    <tbody>
                      {overData.governanceOverrides.slice(0, 50).map((g: {
                        id: string; overrideType: string; module: string; title: string;
                        overrideReason: string | null; actorName: string | null; actorRole: string | null; occurredAt: string | null;
                      }) => (
                        <tr key={g.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{g.overrideType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2"><span className={`text-xs font-semibold ${MODULE_COLOR[g.module] ?? "text-slate-400"}`}>{g.module}</span></td>
                          <td className="px-3 py-2 text-slate-200 text-xs max-w-xs truncate">{g.title}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">{g.overrideReason ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{g.actorName ?? "—"}{g.actorRole && <span className="text-slate-600 ml-1">({g.actorRole})</span>}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(g.occurredAt ? String(g.occurredAt) : null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {overData.governanceOverrides?.length === 0 && overData.settlementEvents?.length === 0 && (
              <EmptyState icon={ShieldAlert} label="No override records found for this project" />
            )}
          </div>
        )}

        {/* ── LANDOWNER ACCOUNTING ─────────────────────────────────────── */}
        {activeTab === "Landowner Accounting" && lownrData && !lownrLoading && (
          <div className="space-y-6">
            {/* Per-partner cards */}
            {lownrData.byPartner?.length > 0 ? (
              <>
                <div className="space-y-4">
                  <SectionTitle icon={Users} title="Per-Partner Ledger Summary" sub="Revenue entitlement · Operational burden · LCA · Net position" />
                  {lownrData.byPartner.map((p: {
                    partnerId: string; partnerName: string; partnerRole: string;
                    totalCredits: number; totalDebits: number; netPosition: number;
                    revenueEntitlement: number; operationalBurden: number; recoverableAdj: number;
                    lcaCredit: number; totalRecovered: number; entryCount: number;
                  }, i: number) => (
                    <div key={p.partnerId} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: PARTNER_COLORS[i % PARTNER_COLORS.length] }} />
                          <span className="text-slate-200 font-semibold">{p.partnerName}</span>
                          <Badge text={p.partnerRole} colorClass="bg-slate-600/40 text-slate-400 border-slate-600/40" />
                        </div>
                        <div className={`text-lg font-bold ${p.netPosition >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {p.netPosition >= 0 ? "+" : ""}{fmtINR(p.netPosition)}
                          <div className="text-slate-500 text-xs font-normal text-right">net position</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-center">
                          <div className="text-emerald-400 font-bold">{fmtINR(p.revenueEntitlement)}</div>
                          <div className="text-slate-500 mt-0.5">Revenue Entitlement</div>
                        </div>
                        <div className="p-2 bg-rose-500/10 rounded-lg border border-rose-500/20 text-center">
                          <div className="text-rose-400 font-bold">{fmtINR(p.operationalBurden)}</div>
                          <div className="text-slate-500 mt-0.5">Operational Burden</div>
                        </div>
                        <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20 text-center">
                          <div className="text-amber-400 font-bold">{fmtINR(p.recoverableAdj)}</div>
                          <div className="text-slate-500 mt-0.5">Recoverable Adj.</div>
                        </div>
                        <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-center">
                          <div className="text-blue-400 font-bold">{fmtINR(p.lcaCredit)}</div>
                          <div className="text-slate-500 mt-0.5">LCA Credit</div>
                        </div>
                        <div className="p-2 bg-slate-700/40 rounded-lg text-center">
                          <div className="text-slate-300 font-bold">{p.entryCount}</div>
                          <div className="text-slate-500 mt-0.5">Ledger Entries</div>
                        </div>
                      </div>
                      {p.totalRecovered > 0 && (
                        <p className="text-emerald-400 text-xs mt-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> {fmtINR(p.totalRecovered)} operational cost recovered
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Monthly trend */}
                {lownrData.monthlyTrend?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="Landowner Ledger — Monthly Trend" sub="Credits vs debits" />
                    <ResponsiveContainer width="100%" height={230}>
                      <AreaChart data={lownrData.monthlyTrend}>
                        <defs>
                          <linearGradient id="gCr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                          <linearGradient id="gDb" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} /><stop offset="95%" stopColor="#f43f5e" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Area type="monotone" dataKey="credits" name="Credits" stroke="#10b981" fill="url(#gCr)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="debits" name="Debits" stroke="#f43f5e" fill="url(#gDb)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="net" name="Net" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Entry type summary */}
                {lownrData.byEntryType?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={Layers} title="Ledger by Entry Type" sub="Across all partners" />
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["Entry Type", "Credit Total", "Debit Total", "Net", "Entries", "Partners"]} />
                        <tbody>
                          {lownrData.byEntryType.map((t: {
                            entryType: string; creditTotal: number; debitTotal: number; net: number; count: number; partnerCount: number;
                          }) => (
                            <tr key={t.entryType} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ background: ENTRY_TYPE_COLORS[t.entryType] ?? "#94a3b8" }} />
                                  <span className="text-slate-300 capitalize">{t.entryType.replace(/_/g, " ")}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-emerald-400">{t.creditTotal > 0 ? fmtINR(t.creditTotal) : "—"}</td>
                              <td className="px-3 py-2 text-rose-400">{t.debitTotal > 0 ? fmtINR(t.debitTotal) : "—"}</td>
                              <td className={`px-3 py-2 font-bold ${t.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtINR(t.net)}</td>
                              <td className="px-3 py-2 text-slate-500">{t.count}</td>
                              <td className="px-3 py-2 text-slate-500">{t.partnerCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : <EmptyState icon={Landmark} label="No landowner ledger entries found for this project" />}
          </div>
        )}

        {/* ── EPP DISTRIBUTION ─────────────────────────────────────────── */}
        {activeTab === "EPP Distribution" && eppData && !eppLoading && (
          <div className="space-y-6">
            {!is50Pct && (
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-300 font-semibold text-sm">EPP applies to 50% Revenue Model only</p>
                  <p className="text-amber-400/70 text-xs mt-0.5">This project uses the ownership contribution model. EPP data is not applicable.</p>
                </div>
              </div>
            )}

            {is50Pct && eppData.sessions?.length > 0 && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard label="Total Sessions" value={String(eppData.totalSessions ?? 0)} sub="50% revenue sessions" icon={CircleDot} iconColor="text-cyan-400" />
                  <KPICard label="EPP Total Allocated" value={fmtINR(eppData.totalAllocated)} sub="Across all sessions" icon={Users} iconColor="text-emerald-400" />
                  <KPICard label="EPP Remainder" value={fmtINR(eppData.totalRemainder)} sub="Unallocated pool balance" icon={BarChart2} iconColor={Number(eppData.totalRemainder) > 0 ? "text-amber-400" : "text-emerald-400"} />
                  <KPICard label="EPP Participants" value={String(new Set((eppData.byPartner ?? []).map((p: { partnerId: string }) => p.partnerId)).size)} sub="Unique partners in EPP" icon={Layers} iconColor="text-violet-400" />
                </div>

                {/* Monthly EPP trend */}
                {eppData.monthlyTrend?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <SectionTitle icon={TrendingUp} title="EPP Monthly Trend" sub="Pool split vs allocated vs remainder" />
                    <ResponsiveContainer width="100%" height={230}>
                      <BarChart data={eppData.monthlyTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Bar dataKey="poolSplit" name="Pool Split (50%)" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="eppAllocated" name="EPP Allocated" fill="#10b981" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="eppRemainder" name="Remainder" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Per-partner EPP allocation */}
                {eppData.byPartner?.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <SectionTitle icon={Users} title="EPP — Per-Participant Allocation" sub="Economic contribution pool distribution" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHeader cols={["Participant", "Role", "Contribution Type", "Total Allocated", "Sessions"]} />
                        <tbody>
                          {eppData.byPartner.map((p: {
                            partnerId: string; partnerName: string; partnerRole: string;
                            contributionType: string; isLandownerAdditional: boolean;
                            totalAllocated: number; sessionCount: number;
                          }, i: number) => (
                            <tr key={`${p.partnerId}-${p.contributionType}`} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ background: PARTNER_COLORS[i % PARTNER_COLORS.length] }} />
                                  <span className="text-slate-200 font-medium">{p.partnerName}</span>
                                  {p.isLandownerAdditional && <Badge text="Landowner Additional" colorClass="bg-amber-500/20 text-amber-400 border-amber-500/30" />}
                                </div>
                              </td>
                              <td className="px-3 py-2"><Badge text={p.partnerRole} colorClass="bg-slate-600/40 text-slate-400 border-slate-600/40" /></td>
                              <td className="px-3 py-2 text-slate-400 text-xs capitalize">{p.contributionType.replace(/_/g, " ")}</td>
                              <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(p.totalAllocated)}</td>
                              <td className="px-3 py-2 text-slate-500">{p.sessionCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Session detail */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={FileText} title="EPP Session Detail" sub={`${eppData.sessions.length} sessions`} />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Period", "Gross", "Pool Split", "EPP Allocated", "Remainder", "Utilization", "Status"]} />
                      <tbody>
                        {eppData.sessions.map((s: {
                          id: string; period: string; gross: number; poolSplit: number;
                          eppAllocated: number; eppRemainder: number; utilizationPct: number; status: string;
                        }) => (
                          <tr key={s.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-300 text-xs font-mono">{s.period}</td>
                            <td className="px-3 py-2 text-slate-300">{fmtINR(s.gross)}</td>
                            <td className="px-3 py-2 text-blue-400">{fmtINR(s.poolSplit)}</td>
                            <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtINR(s.eppAllocated)}</td>
                            <td className="px-3 py-2 text-amber-400">{s.eppRemainder > 0 ? fmtINR(s.eppRemainder) : "—"}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(100, s.utilizationPct)}%` }} />
                                </div>
                                <span className="text-xs text-slate-400">{s.utilizationPct.toFixed(0)}%</span>
                              </div>
                            </td>
                            <td className="px-3 py-2"><Badge text={s.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {is50Pct && eppData.sessions?.length === 0 && (
              <EmptyState icon={Users} label="No EPP sessions found for this project" />
            )}
          </div>
        )}

        {/* ── PENDING PAYABLES ─────────────────────────────────────────── */}
        {activeTab === "Pending Payables" && pendData && !pendLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Total Pending" value={fmtINR(pendData.totals?.totalPending)} sub={`${pendData.totals?.pendingRecordCount} records`} icon={Clock} iconColor="text-amber-400" alert={Number(pendData.totals?.totalPending) > 0} />
              <KPICard label="Active Held Amount" value={fmtINR(pendData.totals?.totalHeldActive)} sub={`${pendData.totals?.activeHeldCount} held records`} icon={Lock} iconColor={Number(pendData.totals?.activeHeldCount) > 0 ? "text-rose-400" : "text-emerald-400"} alert={Number(pendData.totals?.activeHeldCount) > 0} />
              <KPICard label="Total Combined Exposure" value={fmtINR((pendData.totals?.totalPending ?? 0) + (pendData.totals?.totalHeldActive ?? 0))} sub="Pending + held" icon={AlertTriangle} iconColor="text-orange-400" />
              <KPICard label="Recent Payments" value={String(pendData.paymentEvents?.length ?? 0)} sub="Payment event log entries" icon={CheckCircle2} iconColor="text-emerald-400" />
            </div>

            {/* Aging analysis */}
            {pendData.agingSummary?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Clock} title="Aging Analysis" sub="How long have these payables been outstanding?" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  {pendData.agingSummary.map((a: { bucket: string; count: number; totalPending: number; partnerCount: number }) => (
                    <div key={a.bucket} className={`p-4 rounded-xl border text-center ${a.bucket === "180+ days" ? "bg-rose-500/15 border-rose-500/30" : a.bucket === "91-180 days" ? "bg-orange-500/10 border-orange-500/30" : a.bucket === "31-90 days" ? "bg-amber-500/10 border-amber-500/30" : "bg-slate-800/60 border-slate-700"}`}>
                      <div className={`text-lg font-bold ${a.bucket === "180+ days" ? "text-rose-300" : a.bucket === "91-180 days" ? "text-orange-300" : a.bucket === "31-90 days" ? "text-amber-300" : "text-white"}`}>{fmtINR(a.totalPending)}</div>
                      <div className="text-slate-400 text-xs mt-1 font-semibold">{a.bucket}</div>
                      <div className="text-slate-500 text-xs">{a.count} records · {a.partnerCount} partners</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending records */}
            {pendData.pendingRecords?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Clock} title="Outstanding Distribution Records" sub="Oldest first" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Period", "Partner", "Type", "Recommended", "Paid", "Pending", "Carry Out", "Age", "Status"]} />
                    <tbody>
                      {pendData.pendingRecords.map((r: {
                        id: string; period: string; partnerName: string | null; settlementType: string | null;
                        recommended: number; paid: number; pending: number; carryOut: number; ageDays: number; status: string;
                      }) => (
                        <tr key={r.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${r.ageDays > 180 ? "bg-rose-500/5" : r.ageDays > 90 ? "bg-orange-500/5" : ""}`}>
                          <td className="px-3 py-2 text-slate-400 text-xs font-mono">{r.period}</td>
                          <td className="px-3 py-2 text-slate-200">{r.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{r.settlementType?.replace(/_/g, " ") ?? "—"}</td>
                          <td className="px-3 py-2 text-blue-400">{fmtINR(r.recommended)}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(r.paid)}</td>
                          <td className="px-3 py-2 text-amber-400 font-semibold">{fmtINR(r.pending)}</td>
                          <td className="px-3 py-2 text-purple-400">{r.carryOut > 0 ? fmtINR(r.carryOut) : "—"}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-semibold ${r.ageDays > 180 ? "text-rose-400" : r.ageDays > 90 ? "text-orange-400" : r.ageDays > 30 ? "text-amber-400" : "text-slate-400"}`}>
                              {r.ageDays}d
                            </span>
                          </td>
                          <td className="px-3 py-2"><Badge text={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-emerald-300 font-semibold">All distributions paid up</p>
                  <p className="text-emerald-400/70 text-xs mt-0.5">No outstanding payables found for this project.</p>
                </div>
              </div>
            )}

            {/* Held records */}
            {pendData.heldRecords?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Lock} title="Held Distribution Ledger" sub="Disputed/locked amounts — awaiting release" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner", "Held Amount", "Ownership %", "Hold Reason", "Status", "Released", "Released To", "Date"]} />
                    <tbody>
                      {pendData.heldRecords.map((h: {
                        id: string; partnerName: string | null; heldAmount: number; ownershipPct: number | null;
                        holdReason: string; status: string; releasedAmount: number | null; releasedTo: string | null; releasedByName: string | null; createdAt: string | null;
                      }) => (
                        <tr key={h.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${h.status === "held" ? "bg-rose-500/5" : ""}`}>
                          <td className="px-3 py-2 text-slate-200">{h.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-rose-400 font-semibold">{fmtINR(h.heldAmount)}</td>
                          <td className="px-3 py-2 text-slate-400">{h.ownershipPct != null ? fmtPct(h.ownershipPct, 4) : "—"}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs max-w-xs truncate">{h.holdReason}</td>
                          <td className="px-3 py-2"><Badge text={h.status} /></td>
                          <td className="px-3 py-2 text-emerald-400">{h.releasedAmount ? fmtINR(h.releasedAmount) : "—"}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{h.releasedTo ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(h.createdAt ? String(h.createdAt) : null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Payment events */}
            {pendData.paymentEvents?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Banknote} title="Recent Payment Events" sub="Latest payment activity" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Event", "Partner", "Amount", "Cumulative", "Remaining", "Date", "Reference", "By"]} />
                    <tbody>
                      {pendData.paymentEvents.slice(0, 30).map((e: {
                        id: string; eventType: string; partnerName: string | null; amount: number | null;
                        cumulativePaid: number | null; remaining: number | null;
                        paymentDate: string | null; paymentRef: string | null; performedByName: string | null; performedAt: string | null;
                      }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2">
                            <span className={`text-xs font-medium capitalize ${e.eventType === "payment_recorded" ? "text-emerald-400" : e.eventType === "partial_payment" ? "text-amber-400" : "text-purple-400"}`}>
                              {e.eventType.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-300">{e.partnerName ?? "—"}</td>
                          <td className="px-3 py-2 text-emerald-400 font-semibold">{e.amount != null ? fmtINR(e.amount) : "—"}</td>
                          <td className="px-3 py-2 text-slate-400">{e.cumulativePaid != null ? fmtINR(e.cumulativePaid) : "—"}</td>
                          <td className="px-3 py-2 text-amber-400">{e.remaining != null && e.remaining > 0 ? fmtINR(e.remaining) : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{e.paymentDate ?? fmtDate(e.performedAt ? String(e.performedAt) : null)}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{e.paymentRef ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{e.performedByName ?? "—"}</td>
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
