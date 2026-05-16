import { useState, useEffect } from "react";
import { useAuthFetcher } from "../lib/authFetch";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area,
} from "recharts";
import {
  PieChart as PieIcon, TrendingUp, Users, Layers, GitCompare,
  Clock, CheckCircle2, AlertTriangle, Lock, Repeat,
  ArrowRightLeft, Globe, Activity, Scale, DollarSign, Landmark,
  Heart, Shield, ChevronRight, FileText, Coins,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────
const API = (path: string) => `/api/${path}`;

// ── Constants ─────────────────────────────────────────────────────────────
const TABS = ["Overview", "Contributions", "Ownership Timeline", "Transfers", "Inheritance"] as const;
type Tab = (typeof TABS)[number];

const PARTNER_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#f43f5e",
  "#06b6d4", "#f97316", "#a3e635", "#ec4899", "#94a3b8",
];

const TYPE_COLORS: Record<string, string> = {
  land: "#10b981",
  economic: "#3b82f6",
  operational: "#f43f5e",
};

const TRANSFER_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "text-slate-400" },
  pending_rofr: { label: "Pending ROFR", color: "text-amber-400" },
  rofr_accepted: { label: "ROFR Accepted", color: "text-blue-400" },
  rofr_rejected: { label: "ROFR Rejected", color: "text-orange-400" },
  pending_approval: { label: "Pending Approval", color: "text-cyan-400" },
  approved: { label: "Approved", color: "text-emerald-300" },
  executed: { label: "Executed", color: "text-emerald-400" },
  cancelled: { label: "Cancelled", color: "text-rose-400" },
};

const CLAIM_STATUS: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "text-amber-400" },
  under_review: { label: "Under Review", color: "text-blue-400" },
  approved: { label: "Approved", color: "text-emerald-400" },
  rejected: { label: "Rejected", color: "text-rose-400" },
  closed: { label: "Closed", color: "text-slate-400" },
};

// ── Formatters ────────────────────────────────────────────────────────────
const fmtINR = (n: number | string | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number | null | undefined, dp = 2) =>
  `${(Number(n ?? 0)).toFixed(dp)}%`;

// ── Shared UI ─────────────────────────────────────────────────────────────
function KPICard({
  label, value, sub, icon: Icon, iconColor = "text-slate-400",
}: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; iconColor?: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-400 text-xs font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function SectionTitle({
  icon: Icon, title, sub,
}: { icon: React.ComponentType<{ className?: string }>; title: string; sub?: string }) {
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

function Badge({ text, colorClass }: { text: string; colorClass: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {text}
    </span>
  );
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
    <div className="flex flex-col items-center justify-center py-14 text-slate-500">
      <Icon className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

const CUSTOM_PIE_LABEL = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number; name: string;
}) => {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
};

// ── Main Component ────────────────────────────────────────────────────────
export default function OwnershipAnalytics() {
  const fetcher = useAuthFetcher();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [projectId, setProjectId] = useState("");
  const [snapshotIndex, setSnapshotIndex] = useState<number>(0);

  // Projects
  const { data: projectsData } = useQuery({
    queryKey: ["oa-projects"],
    queryFn: () => fetcher(API("ownership-analytics/projects")) as Promise<{
      projects: { id: string; name: string; projectCode?: string; commercialModel: string; lifecycleStatus: string }[];
    }>,
  });
  const projects = projectsData?.projects ?? [];

  useEffect(() => {
    if (projects.length > 0 && !projectId) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const selectedProject = projects.find((p) => p.id === projectId);

  // Overview
  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["oa-overview", projectId],
    queryFn: () => fetcher(API(`ownership-analytics/overview?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "Overview",
  });

  // Contributions
  const { data: contribs, isLoading: contribLoading } = useQuery({
    queryKey: ["oa-contributions", projectId],
    queryFn: () => fetcher(API(`ownership-analytics/contributions?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "Contributions",
  });

  // Snapshots
  const { data: snapData, isLoading: snapLoading } = useQuery({
    queryKey: ["oa-snapshots", projectId],
    queryFn: () => fetcher(API(`ownership-analytics/snapshots?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "Ownership Timeline",
  });

  // Transfers
  const { data: transferData, isLoading: transferLoading } = useQuery({
    queryKey: ["oa-transfers", projectId],
    queryFn: () => fetcher(API(`ownership-analytics/transfers?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "Transfers",
  });

  // Inheritance
  const { data: inheritData, isLoading: inheritLoading } = useQuery({
    queryKey: ["oa-inheritance", projectId],
    queryFn: () => fetcher(API(`ownership-analytics/inheritance?projectId=${projectId}`)),
    enabled: !!projectId && activeTab === "Inheritance",
  });

  const isLoading = ovLoading || contribLoading || snapLoading || transferLoading || inheritLoading;

  // ── Derived data ─────────────────────────────────────────────────────────

  // Ownership pie data from states
  const pieData = (overview?.ownershipStates ?? []).map(
    (s: { partnerName: string; totalPct: number }) => ({ name: s.partnerName, value: s.totalPct })
  );

  // Snapshot partner colors (consistent per partner name)
  const partnerColorMap: Record<string, string> = {};
  let colorIdx = 0;
  for (const name of (snapData?.partnerNames ?? [])) {
    partnerColorMap[name] = PARTNER_COLORS[colorIdx++ % PARTNER_COLORS.length];
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <PieIcon className="w-5 h-5 text-violet-400" />
              Ownership Analytics
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Ownership · Contributions · Transfers · Inheritance · Participation
            </p>
          </div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[200px]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Project badges */}
        {selectedProject && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {selectedProject.projectCode && (
              <span className="text-slate-500 text-xs font-mono border border-slate-700 px-2 py-0.5 rounded">
                {selectedProject.projectCode}
              </span>
            )}
            <Badge
              text={selectedProject.commercialModel === "ownership_contribution" ? "Ownership & Contribution" : "50% Revenue Split"}
              colorClass={selectedProject.commercialModel === "ownership_contribution" ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"}
            />
            <Badge
              text={selectedProject.lifecycleStatus.replace(/_/g, " ")}
              colorClass="bg-slate-500/20 text-slate-400 border-slate-500/30"
            />
            {overview?.freeze && (
              <Badge text="Ownership Frozen" colorClass="bg-rose-500/20 text-rose-400 border-rose-500/30" />
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mt-3 border-b border-slate-800 -mb-4 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === tab
                  ? "text-violet-400 border-b-2 border-violet-400 bg-slate-800/40"
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
        {!projectId && <EmptyState icon={Globe} label="Select a project to view ownership analytics" />}

        {projectId && isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Activity className="w-8 h-8 mb-3 animate-pulse opacity-40" />
            <p>Loading ownership data…</p>
          </div>
        )}

        {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
        {activeTab === "Overview" && overview && (
          <div className="space-y-6">
            {/* Freeze alert */}
            {overview.freeze && (
              <div className="flex items-start gap-3 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
                <Lock className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-rose-300 font-semibold text-sm">Ownership Frozen</p>
                  <p className="text-rose-400/80 text-xs mt-0.5">
                    Frozen {new Date(overview.freeze.frozenAt).toLocaleDateString("en-IN")}
                    {overview.freeze.frozenByName && ` by ${overview.freeze.frozenByName}`}
                    {overview.freeze.notes && ` — ${overview.freeze.notes}`}
                  </p>
                </div>
              </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Partners with Ownership" value={String(overview.ownershipStates?.length ?? 0)} sub={`${fmtPct(overview.totalOwnershipPct, 1)} total allocated`} icon={Users} iconColor="text-violet-400" />
              <KPICard label="Land Contribution (Verified)" value={fmtINR(overview.contributions?.land?.verifiedTotal)} sub={`${overview.contributions?.land?.partnerCount ?? 0} landowner partners`} icon={Landmark} iconColor="text-emerald-400" />
              <KPICard label="Economic Contribution (Verified)" value={fmtINR(overview.contributions?.economic?.verifiedTotal)} sub={`${overview.contributions?.economic?.partnerCount ?? 0} economic partners`} icon={Coins} iconColor="text-blue-400" />
              <KPICard label="Operational Burden" value={fmtINR(overview.contributions?.operational?.verifiedTotal)} sub={`${overview.contributions?.operational?.totalCount ?? 0} records`} icon={Activity} iconColor="text-rose-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ownership Pie */}
              {pieData.length > 0 ? (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={PieIcon} title="Current Ownership Distribution" sub="From partner ownership states" />
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        labelLine={false}
                        label={CUSTOM_PIE_LABEL}
                      >
                        {pieData.map((_: unknown, i: number) => (
                          <Cell key={i} fill={PARTNER_COLORS[i % PARTNER_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                        formatter={(v: number) => [`${v.toFixed(4)}%`, "Ownership"]}
                      />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5 flex items-center justify-center">
                  <EmptyState icon={PieIcon} label="No ownership state records yet" />
                </div>
              )}

              {/* Partner ownership state breakdown */}
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Users} title="Partner Ownership States" sub="Transferable · Locked · Disputed · Reserved" />
                {overview.ownershipStates?.length > 0 ? (
                  <div className="space-y-3">
                    {overview.ownershipStates.map((s: {
                      partnerId: string; partnerName: string; partnerRole: string;
                      totalPct: number; transferablePct: number; lockedPct: number; disputedPct: number; reservedPct: number;
                      hasDispute: boolean; disputeReason?: string;
                    }, i: number) => (
                      <div key={s.partnerId} className="p-3 bg-slate-900/40 rounded-lg border border-slate-700/50">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: PARTNER_COLORS[i % PARTNER_COLORS.length] }} />
                            <span className="text-slate-200 font-medium text-sm">{s.partnerName}</span>
                            <Badge text={s.partnerRole?.replace(/_/g, " ")} colorClass="bg-slate-600/40 text-slate-400 border-slate-600/40" />
                          </div>
                          <span className="text-white font-bold text-sm">{fmtPct(s.totalPct, 4)}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-xs">
                          <div className="text-center p-1 bg-emerald-500/10 rounded">
                            <div className="text-emerald-400 font-semibold">{fmtPct(s.transferablePct, 2)}</div>
                            <div className="text-slate-500">Transferable</div>
                          </div>
                          <div className="text-center p-1 bg-slate-700/40 rounded">
                            <div className={`font-semibold ${s.lockedPct > 0 ? "text-amber-400" : "text-slate-500"}`}>{fmtPct(s.lockedPct, 2)}</div>
                            <div className="text-slate-500">Locked</div>
                          </div>
                          <div className="text-center p-1 bg-slate-700/40 rounded">
                            <div className={`font-semibold ${s.disputedPct > 0 ? "text-rose-400" : "text-slate-500"}`}>{fmtPct(s.disputedPct, 2)}</div>
                            <div className="text-slate-500">Disputed</div>
                          </div>
                          <div className="text-center p-1 bg-slate-700/40 rounded">
                            <div className={`font-semibold ${s.reservedPct > 0 ? "text-blue-400" : "text-slate-500"}`}>{fmtPct(s.reservedPct, 2)}</div>
                            <div className="text-slate-500">Reserved</div>
                          </div>
                        </div>
                        {s.hasDispute && s.disputeReason && (
                          <p className="text-rose-400 text-xs mt-2 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {s.disputeReason}
                          </p>
                        )}
                      </div>
                    ))}
                    {overview.unallocatedPct > 0 && (
                      <p className="text-slate-500 text-xs text-center mt-1">{fmtPct(overview.unallocatedPct, 2)} unallocated</p>
                    )}
                  </div>
                ) : (
                  <EmptyState icon={Users} label="No ownership states recorded" />
                )}
              </div>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Ownership Snapshots" value={String(overview.snapshots?.count ?? 0)} sub="Point-in-time records" icon={GitCompare} iconColor="text-cyan-400" />
              <KPICard label="Executed Transfers" value={String(overview.transfers?.executed ?? 0)} sub={`${fmtPct(overview.transfers?.totalPctTransferred, 2)} total transferred`} icon={ArrowRightLeft} iconColor="text-blue-400" />
              <KPICard label="Inheritance Claims" value={String(overview.inheritance?.claimCount ?? 0)} sub={`${overview.inheritance?.approvedCount ?? 0} approved`} icon={Heart} iconColor="text-rose-400" />
              <KPICard label="Economic Partners" value={String(overview.participation?.ownershipPartners ?? 0)} sub={`Land: ${overview.participation?.landPartners ?? 0} · Econ: ${overview.participation?.economicPartners ?? 0}`} icon={Layers} iconColor="text-violet-400" />
            </div>

            {/* Latest snapshot entries */}
            {overview.snapshots?.latestEntries?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={GitCompare} title="Latest Ownership Snapshot" sub="Most recent point-in-time record" />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner", "Land Amount", "Economic Amount", "Total Amount", "Ownership %"]} />
                    <tbody>
                      {overview.snapshots.latestEntries.map((e: {
                        partnerName: string; landAmount: number; economicAmount: number; totalAmount: number; percentage: number;
                      }, i: number) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 font-medium text-slate-200">{e.partnerName}</td>
                          <td className="px-3 py-2 text-emerald-400">{fmtINR(e.landAmount)}</td>
                          <td className="px-3 py-2 text-blue-400">{fmtINR(e.economicAmount)}</td>
                          <td className="px-3 py-2 text-white font-semibold">{fmtINR(e.totalAmount)}</td>
                          <td className="px-3 py-2 text-violet-400 font-bold">{fmtPct(e.percentage)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CONTRIBUTIONS ─────────────────────────────────────────────────── */}
        {activeTab === "Contributions" && contribs && (
          <div className="space-y-6">
            {/* Type totals */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Landmark className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 font-semibold text-sm">Land Contribution</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {fmtINR(contribs.byPartner?.reduce((s: number, p: { land: { verified: number } }) => s + p.land.verified, 0) ?? 0)}
                </div>
                <p className="text-emerald-400/70 text-xs mt-1">Verified land notional value</p>
                <p className="text-slate-500 text-xs mt-0.5">Immovable asset monetised as capital</p>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Coins className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-300 font-semibold text-sm">Economic Contribution</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {fmtINR(contribs.byPartner?.reduce((s: number, p: { economic: { verified: number } }) => s + p.economic.verified, 0) ?? 0)}
                </div>
                <p className="text-blue-400/70 text-xs mt-1">Verified cash / in-kind capital</p>
                <p className="text-slate-500 text-xs mt-0.5">Direct investment by any partner</p>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-rose-400" />
                  <span className="text-rose-300 font-semibold text-sm">Operational Burden</span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {fmtINR(contribs.byPartner?.reduce((s: number, p: { operational: { total: number } }) => s + p.operational.total, 0) ?? 0)}
                </div>
                <p className="text-rose-400/70 text-xs mt-1">Running costs (inputs, labour)</p>
                <p className="text-slate-500 text-xs mt-0.5">Does not affect ownership %</p>
              </div>
            </div>

            {/* Per-partner comparison table */}
            {contribs.byPartner?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Users} title="Per-Partner Contribution Breakdown" sub="Land vs Economic vs Operational — verified amounts" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner", "Role", "Land (Verified)", "Economic (Verified)", "Operational", "Total Ownership Contribution", "Ownership %"]} />
                    <tbody>
                      {contribs.byPartner.map((p: {
                        partnerId: string; partnerName: string; partnerRole: string;
                        land: { verified: number; total: number; count: number };
                        economic: { verified: number; total: number; count: number };
                        operational: { verified: number; total: number; count: number };
                        ownershipPct: number;
                      }, i: number) => {
                        const totalOwnership = p.land.verified + p.economic.verified;
                        return (
                          <tr key={p.partnerId} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ background: PARTNER_COLORS[i % PARTNER_COLORS.length] }} />
                                <span className="text-slate-200 font-medium">{p.partnerName}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Badge text={p.partnerRole.replace(/_/g, " ")} colorClass="bg-slate-600/40 text-slate-400 border-slate-600/40" />
                            </td>
                            <td className="px-3 py-2 text-emerald-400">{p.land.verified > 0 ? fmtINR(p.land.verified) : <span className="text-slate-600">—</span>}</td>
                            <td className="px-3 py-2 text-blue-400">{p.economic.verified > 0 ? fmtINR(p.economic.verified) : <span className="text-slate-600">—</span>}</td>
                            <td className="px-3 py-2 text-rose-400">{p.operational.total > 0 ? fmtINR(p.operational.total) : <span className="text-slate-600">—</span>}</td>
                            <td className="px-3 py-2 text-white font-semibold">{fmtINR(totalOwnership)}</td>
                            <td className="px-3 py-2 text-violet-400 font-bold">{p.ownershipPct > 0 ? fmtPct(p.ownershipPct) : <span className="text-slate-600">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Monthly trend chart */}
            {contribs.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Monthly Contribution Trend" sub="Land · Economic · Operational separated" />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={contribs.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                      labelStyle={{ color: "#94a3b8" }}
                      formatter={(v: number) => [fmtINR(v)]}
                    />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="landVerified" name="Land (Verified)" fill={TYPE_COLORS.land} stackId="verified" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="economicVerified" name="Economic (Verified)" fill={TYPE_COLORS.economic} stackId="verified" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="operational" name="Operational" fill={TYPE_COLORS.operational} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Cumulative trend */}
            {contribs.cumulativeTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Cumulative Contribution Growth" sub="Running total — land vs economic vs operational" />
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={contribs.cumulativeTrend}>
                    <defs>
                      <linearGradient id="gLand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gEcon" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gOp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                      labelStyle={{ color: "#94a3b8" }}
                      formatter={(v: number) => [fmtINR(v)]}
                    />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="land" name="Land" stroke="#10b981" fill="url(#gLand)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="economic" name="Economic" stroke="#3b82f6" fill="url(#gEcon)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="operational" name="Operational" stroke="#f43f5e" fill="url(#gOp)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Phase breakdown */}
            {contribs.phaseBreakdown?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={Layers} title="Phase-wise Contribution Breakdown" sub="Prematurity vs Mature Production" />
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={contribs.phaseBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <YAxis dataKey="phase" type="category" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} width={110} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="land" name="Land" fill="#10b981" radius={[0, 3, 3, 0]} />
                    <Bar dataKey="economic" name="Economic" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                    <Bar dataKey="operational" name="Operational" fill="#f43f5e" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {!contribs.byPartner?.length && <EmptyState icon={Coins} label="No contribution records found for this project" />}
          </div>
        )}

        {/* ── OWNERSHIP TIMELINE ───────────────────────────────────────────── */}
        {activeTab === "Ownership Timeline" && snapData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Total Snapshots" value={String(snapData.count ?? 0)} sub="Point-in-time records" icon={GitCompare} iconColor="text-cyan-400" />
              <KPICard label="Partners Tracked" value={String(snapData.partnerNames?.length ?? 0)} sub="Across all snapshots" icon={Users} iconColor="text-violet-400" />
              <KPICard label="Peak Land Total" value={fmtINR(snapData.snapshots?.[0]?.landTotal ?? 0)} sub="Latest snapshot" icon={Landmark} iconColor="text-emerald-400" />
              <KPICard label="Peak Economic Total" value={fmtINR(snapData.snapshots?.[0]?.economicTotal ?? 0)} sub="Latest snapshot" icon={Coins} iconColor="text-blue-400" />
            </div>

            {snapData.timeline?.length > 0 && snapData.partnerNames?.length > 0 ? (
              <>
                {/* Ownership % timeline */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={TrendingUp} title="Ownership % Evolution" sub="Per-partner ownership percentage over all snapshots" />
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={snapData.timeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="label" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                      <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={[0, "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                        labelStyle={{ color: "#94a3b8" }}
                        formatter={(v: number) => [`${v.toFixed(4)}%`]}
                      />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 11 }} />
                      {snapData.partnerNames.map((name: string, i: number) => (
                        <Line
                          key={name}
                          type="monotone"
                          dataKey={name}
                          name={name}
                          stroke={PARTNER_COLORS[i % PARTNER_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Land vs Economic over time */}
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={Scale} title="Land vs Economic Total — Snapshot History" sub="Project-level recognized amounts across snapshots" />
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={snapData.timeline}>
                      <defs>
                        <linearGradient id="gLT" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gET" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="label" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                      <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} formatter={(v: number) => [fmtINR(v)]} />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                      <Area type="monotone" dataKey="landTotal" name="Land Total" stroke="#10b981" fill="url(#gLT)" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="economicTotal" name="Economic Total" stroke="#3b82f6" fill="url(#gET)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Snapshot detail cards */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <SectionTitle icon={FileText} title="Snapshot Detail Records" sub={`${snapData.snapshots?.length} snapshots — click to expand`} />
                    <div className="flex gap-2 pb-4">
                      <button onClick={() => setSnapshotIndex(Math.max(0, snapshotIndex - 1))} disabled={snapshotIndex === 0} className="px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-xs disabled:opacity-30">← Prev</button>
                      <span className="text-slate-500 text-xs px-2 py-1">{snapshotIndex + 1} / {snapData.snapshots?.length}</span>
                      <button onClick={() => setSnapshotIndex(Math.min((snapData.snapshots?.length ?? 1) - 1, snapshotIndex + 1))} disabled={snapshotIndex >= (snapData.snapshots?.length ?? 1) - 1} className="px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-xs disabled:opacity-30">Next →</button>
                    </div>
                  </div>
                  {snapData.snapshots?.[snapshotIndex] && (() => {
                    const s = snapData.snapshots[snapshotIndex];
                    return (
                      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <div className="text-slate-200 font-semibold">{new Date(s.snapshotAt).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</div>
                            <div className="flex gap-2 mt-1">
                              <Badge text={s.snapshotType.replace(/_/g, " ")} colorClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/30" />
                              <Badge text={s.lifecycleStatus.replace(/_/g, " ")} colorClass="bg-slate-500/20 text-slate-400 border-slate-500/30" />
                            </div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="text-slate-300">Total: <span className="text-white font-bold">{fmtINR(s.totalRecognizedAmount)}</span></div>
                            <div className="text-slate-500 text-xs">Land: {fmtINR(s.landTotal)} · Econ: {fmtINR(s.economicTotal)}</div>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <TableHeader cols={["Partner", "Land Amount", "Economic Amount", "Total", "Ownership %"]} />
                            <tbody>
                              {s.entries?.map((e: { partnerName: string; landAmount: number; economicAmount: number; totalAmount: number; percentage: number }, ei: number) => (
                                <tr key={ei} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                                  <td className="px-3 py-2 text-slate-200 font-medium">{e.partnerName}</td>
                                  <td className="px-3 py-2 text-emerald-400">{e.landAmount > 0 ? fmtINR(e.landAmount) : "—"}</td>
                                  <td className="px-3 py-2 text-blue-400">{e.economicAmount > 0 ? fmtINR(e.economicAmount) : "—"}</td>
                                  <td className="px-3 py-2 text-white font-semibold">{fmtINR(e.totalAmount)}</td>
                                  <td className="px-3 py-2 text-violet-400 font-bold">{fmtPct(e.percentage)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {s.notes && <p className="text-slate-500 text-xs mt-3 italic">{s.notes}</p>}
                        {s.triggeredByName && <p className="text-slate-500 text-xs mt-1">Triggered by: {s.triggeredByName}</p>}
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : (
              <EmptyState icon={GitCompare} label="No ownership snapshots recorded yet" />
            )}
          </div>
        )}

        {/* ── TRANSFERS ─────────────────────────────────────────────────────── */}
        {activeTab === "Transfers" && transferData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Total Transfers" value={String(transferData.summary?.total ?? 0)} sub="All time" icon={ArrowRightLeft} iconColor="text-blue-400" />
              <KPICard label="Executed" value={String(transferData.summary?.executed ?? 0)} sub={`${fmtPct(transferData.summary?.totalPctTransferred, 2)} total ownership moved`} icon={CheckCircle2} iconColor="text-emerald-400" />
              <KPICard label="Pending" value={String(transferData.summary?.pending ?? 0)} sub="In-progress transfers" icon={Clock} iconColor={Number(transferData.summary?.pending) > 0 ? "text-amber-400" : "text-emerald-400"} />
              <KPICard label="Total Value Transferred" value={fmtINR(transferData.summary?.totalValueTransferred)} sub="Payable amount (executed)" icon={DollarSign} iconColor="text-violet-400" />
            </div>

            {/* By type summary */}
            {transferData.byType?.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {transferData.byType.map((t: { type: string; count: number; executed: number }) => (
                  <div key={t.type} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                    <div className="text-white text-lg font-bold">{t.count}</div>
                    <div className="text-slate-300 text-sm capitalize">{t.type.replace(/_/g, " ")}</div>
                    <div className="text-emerald-400 text-xs mt-1">{t.executed} executed</div>
                  </div>
                ))}
              </div>
            )}

            {/* Transfer history table */}
            {transferData.transfers?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={ArrowRightLeft} title="Transfer History" sub={`${transferData.transfers?.length} records`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Transferor", "Role", "Type", "% Offered", "Transfer Value", "Payable", "Paid", "Status", "Effective Date"]} />
                    <tbody>
                      {transferData.transfers.map((t: {
                        id: string; transferorName: string; transferorRole?: string;
                        offeredPct: number; transferType: string; status: string;
                        offeredValue?: number; transferValue?: number; payableAmount?: number; paidAmount?: number;
                        effectiveDate?: string; executedAt?: string; reason?: string;
                      }) => {
                        const st = TRANSFER_STATUS[t.status] ?? { label: t.status, color: "text-slate-400" };
                        return (
                          <tr key={t.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-200 font-medium">{t.transferorName}</td>
                            <td className="px-3 py-2">
                              {t.transferorRole && <Badge text={t.transferorRole.replace(/_/g, " ")} colorClass="bg-slate-600/40 text-slate-400 border-slate-600/40" />}
                            </td>
                            <td className="px-3 py-2 text-slate-400 capitalize">{t.transferType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-violet-400 font-bold">{fmtPct(t.offeredPct, 4)}</td>
                            <td className="px-3 py-2 text-slate-400">{t.transferValue ? fmtINR(t.transferValue) : "—"}</td>
                            <td className="px-3 py-2 text-blue-400">{t.payableAmount ? fmtINR(t.payableAmount) : "—"}</td>
                            <td className="px-3 py-2 text-emerald-400">{t.paidAmount ? fmtINR(t.paidAmount) : "—"}</td>
                            <td className="px-3 py-2"><span className={`font-medium text-xs ${st.color}`}>{st.label}</span></td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{t.effectiveDate ?? (t.executedAt ? new Date(t.executedAt).toLocaleDateString("en-IN") : "—")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState icon={ArrowRightLeft} label="No transfer records found for this project" />
            )}
          </div>
        )}

        {/* ── INHERITANCE ───────────────────────────────────────────────────── */}
        {activeTab === "Inheritance" && inheritData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Inheritance Claims" value={String(inheritData.summary?.totalClaims ?? 0)} sub="All claim types" icon={Heart} iconColor="text-rose-400" />
              <KPICard label="Approved" value={String(inheritData.summary?.approvedClaims ?? 0)} sub="Settled claims" icon={CheckCircle2} iconColor="text-emerald-400" />
              <KPICard label="Open" value={String(inheritData.summary?.openClaims ?? 0)} sub="Awaiting resolution" icon={Clock} iconColor={Number(inheritData.summary?.openClaims) > 0 ? "text-amber-400" : "text-emerald-400"} />
              <KPICard label="Ownership % Transferred" value={fmtPct(inheritData.summary?.totalPctTransferred, 4)} sub="Via inheritance settlements" icon={Repeat} iconColor="text-violet-400" />
            </div>

            {/* By-decedent grouping */}
            {inheritData.byDecedent?.length > 0 && (
              <div className="space-y-4">
                <SectionTitle icon={Users} title="Ownership Transfer History by Original Partner" sub="Inheritance settlements — who inherited from whom" />
                {inheritData.byDecedent.map((d: {
                  fromPartnerId: string; fromPartnerName: string; totalPctTransferred: number;
                  claimants: { claimantName: string; sharePct: number; effectiveDate: string | null; claimId: string }[];
                }) => (
                  <div key={d.fromPartnerId} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-rose-400" />
                        <span className="text-slate-200 font-semibold">{d.fromPartnerName}</span>
                        <Badge text="Original Partner" colorClass="bg-rose-500/20 text-rose-400 border-rose-500/30" />
                      </div>
                      <span className="text-rose-400 font-bold text-sm">{fmtPct(d.totalPctTransferred, 4)} transferred</span>
                    </div>
                    <div className="space-y-2">
                      {d.claimants.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 p-2 bg-slate-900/40 rounded-lg border border-slate-700/40">
                          <ChevronRight className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                          <span className="text-slate-300 text-sm flex-1">{c.claimantName}</span>
                          <span className="text-emerald-400 font-semibold text-sm">{fmtPct(c.sharePct, 4)}</span>
                          {c.effectiveDate && (
                            <span className="text-slate-500 text-xs">
                              {new Date(c.effectiveDate).toLocaleDateString("en-IN")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Claims table */}
            {inheritData.claims?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FileText} title="Inheritance Claims" sub={`${inheritData.claims?.length} claims`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner (Decedent)", "Role", "Claim Type", "Status", "Filed On"]} />
                    <tbody>
                      {inheritData.claims.map((c: {
                        id: string; partnerName?: string; partnerRole?: string;
                        claimType: string; status: string; createdAt?: string;
                      }) => {
                        const st = CLAIM_STATUS[c.status] ?? { label: c.status, color: "text-slate-400" };
                        return (
                          <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-200 font-medium">{c.partnerName ?? "—"}</td>
                            <td className="px-3 py-2">
                              {c.partnerRole && <Badge text={c.partnerRole.replace(/_/g, " ")} colorClass="bg-slate-600/40 text-slate-400 border-slate-600/40" />}
                            </td>
                            <td className="px-3 py-2 text-slate-400 capitalize">{c.claimType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2"><span className={`font-medium text-xs ${st.color}`}>{st.label}</span></td>
                            <td className="px-3 py-2 text-slate-500 text-xs">
                              {c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Inheritance history table */}
            {inheritData.history?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Repeat} title="Ownership Transfer Audit Log" sub="Write-once inheritance history records" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["From Partner", "To Claimant", "Share %", "Effective Date", "Recorded On"]} />
                    <tbody>
                      {inheritData.history.map((h: {
                        id: string; fromPartnerName: string; claimantName: string;
                        sharePct: number; effectiveDate?: string; createdAt?: string;
                      }) => (
                        <tr key={h.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300 font-medium">{h.fromPartnerName}</td>
                          <td className="px-3 py-2 text-emerald-400 font-medium">{h.claimantName}</td>
                          <td className="px-3 py-2 text-violet-400 font-bold">{fmtPct(h.sharePct, 4)}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">
                            {h.effectiveDate ? new Date(h.effectiveDate).toLocaleDateString("en-IN") : "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">
                            {h.createdAt ? new Date(h.createdAt).toLocaleDateString("en-IN") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {inheritData.claims?.length === 0 && inheritData.history?.length === 0 && (
              <EmptyState icon={Heart} label="No inheritance records found for this project" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
