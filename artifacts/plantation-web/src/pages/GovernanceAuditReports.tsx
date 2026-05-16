import { useState, useEffect } from "react";
import { useAuthFetcher } from "../lib/authFetch";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  ShieldCheck, AlertTriangle, Scale, FileText, Users, GitMerge,
  ClipboardList, Eye, TrendingUp, CheckCircle2, XCircle, Clock,
  Activity, Globe, ArrowUpRight, ArrowDownRight, Minus,
  BookOpen, FolderOpen, UserCheck, Gavel, Database, Lock,
  BarChart2, CircleDot,
} from "lucide-react";

// ── API ───────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────
const TABS = [
  "Health Dashboard", "Governance Alerts", "Dispute Monitoring",
  "Override Audit", "Nominee Status", "Claims & Claimants",
  "Evidence Archive", "Audit Log",
] as const;
type Tab = (typeof TABS)[number];

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#94a3b8",
};
const STATUS_BADGE: Record<string, string> = {
  open:          "bg-rose-500/20 text-rose-400 border-rose-500/30",
  under_review:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  escalated:     "bg-red-600/20 text-red-400 border-red-600/30",
  resolved:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  withdrawn:     "bg-slate-600/30 text-slate-400 border-slate-600/30",
  acknowledged:  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pending:       "bg-amber-500/20 text-amber-400 border-amber-500/30",
  activated:     "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  revoked:       "bg-rose-500/20 text-rose-400 border-rose-500/30",
  approved:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  rejected:      "bg-rose-500/20 text-rose-400 border-rose-500/30",
  settled:       "bg-violet-500/20 text-violet-400 border-violet-500/30",
  verified:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  proposed:      "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  disputed:      "bg-orange-500/20 text-orange-400 border-orange-500/30",
  active:        "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  superseded:    "bg-slate-600/30 text-slate-400 border-slate-600/30",
  archived:      "bg-slate-600/30 text-slate-400 border-slate-600/30",
  registered:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
  scheduled:     "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  completed:     "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  cancelled:     "bg-slate-600/30 text-slate-400 border-slate-600/30",
  INSERT:        "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  UPDATE:        "bg-amber-500/20 text-amber-400 border-amber-500/30",
  DELETE:        "bg-rose-500/20 text-rose-400 border-rose-500/30",
  critical:      "bg-red-600/20 text-red-400 border-red-600/30",
  high:          "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium:        "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low:           "bg-slate-600/30 text-slate-400 border-slate-600/30",
};
const HEALTH_COLOR: Record<string, { bg: string; text: string; border: string; label: string }> = {
  healthy:   { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40", label: "Healthy" },
  attention: { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/40",   label: "Needs Attention" },
  warning:   { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/40",  label: "Warning" },
  critical:  { bg: "bg-rose-500/15",    text: "text-rose-400",    border: "border-rose-500/40",    label: "Critical" },
};
const PIE_COLORS = ["#ef4444","#f97316","#f59e0b","#10b981","#3b82f6","#8b5cf6","#06b6d4","#ec4899"];

// ── Helpers ───────────────────────────────────────────────────────────────
const fmtDate = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d: unknown) =>
  d ? new Date(String(d)).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// ── Shared UI ─────────────────────────────────────────────────────────────
function Badge({ text, colorClass }: { text: string; colorClass?: string }) {
  const cls = colorClass ?? STATUS_BADGE[text] ?? "bg-slate-600/30 text-slate-400 border-slate-600/30";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{text.replace(/_/g, " ")}</span>;
}

function KPICard({ label, value, sub, icon: Icon, iconColor = "text-slate-400", alert = false, onClick }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; iconColor?: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className={`rounded-xl p-4 border text-left w-full transition-colors ${alert ? "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15" : "bg-slate-800/60 border-slate-700 hover:bg-slate-700/50"} ${onClick ? "cursor-pointer" : "cursor-default"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-400 text-xs font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className={`text-xl font-bold ${alert ? "text-rose-300" : "text-white"}`}>{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </button>
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

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-700">
        {cols.map(c => <th key={c} className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">{c}</th>)}
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

function SeverityDot({ severity }: { severity: string }) {
  return <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: SEVERITY_COLOR[severity] ?? "#94a3b8" }} />;
}

// ── Main Component ────────────────────────────────────────────────────────
export default function GovernanceAuditReports() {
  const fetcher = useAuthFetcher();
  const [tab, setTab] = useState<Tab>("Health Dashboard");
  const [projectId, setProjectId] = useState("");

  const { data: projectsData } = useQuery({
    queryKey: ["gar-projects"],
    queryFn: () => fetcher("/api/governance-reports/projects") as Promise<{
      projects: { id: string; name: string; projectCode?: string; lifecycleStatus: string; activationStatus: string }[];
    }>,
  });
  const projects = projectsData?.projects ?? [];
  useEffect(() => { if (projects.length > 0 && !projectId) setProjectId(projects[0].id); }, [projects, projectId]);
  const selectedProject = projects.find(p => p.id === projectId);

  const enabled = !!projectId;

  const { data: overviewData, isLoading: ovLoading } = useQuery({
    queryKey: ["gar-overview", projectId], enabled: enabled && tab === "Health Dashboard",
    queryFn: () => fetcher(`/api/governance-reports/overview?projectId=${projectId}`),
  });
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ["gar-alerts", projectId], enabled: enabled && tab === "Governance Alerts",
    queryFn: () => fetcher(`/api/governance-reports/alerts?projectId=${projectId}`),
  });
  const { data: disputesData, isLoading: disputesLoading } = useQuery({
    queryKey: ["gar-disputes", projectId], enabled: enabled && tab === "Dispute Monitoring",
    queryFn: () => fetcher(`/api/governance-reports/disputes?projectId=${projectId}`),
  });
  const { data: overridesData, isLoading: overridesLoading } = useQuery({
    queryKey: ["gar-overrides", projectId], enabled: enabled && tab === "Override Audit",
    queryFn: () => fetcher(`/api/governance-reports/overrides?projectId=${projectId}`),
  });
  const { data: nomineesData, isLoading: nomineesLoading } = useQuery({
    queryKey: ["gar-nominees", projectId], enabled: enabled && tab === "Nominee Status",
    queryFn: () => fetcher(`/api/governance-reports/nominees?projectId=${projectId}`),
  });
  const { data: claimsData, isLoading: claimsLoading } = useQuery({
    queryKey: ["gar-claims", projectId], enabled: enabled && tab === "Claims & Claimants",
    queryFn: () => fetcher(`/api/governance-reports/claims?projectId=${projectId}`),
  });
  const { data: evidenceData, isLoading: evidenceLoading } = useQuery({
    queryKey: ["gar-evidence", projectId], enabled: enabled && tab === "Evidence Archive",
    queryFn: () => fetcher(`/api/governance-reports/evidence?projectId=${projectId}`),
  });
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["gar-audit", projectId], enabled: enabled && tab === "Audit Log",
    queryFn: () => fetcher(`/api/governance-reports/audit-log?projectId=${projectId}&limit=200`),
  });

  const isLoading = ovLoading || alertsLoading || disputesLoading || overridesLoading ||
    nomineesLoading || claimsLoading || evidenceLoading || auditLoading;

  const health = overviewData ? HEALTH_COLOR[overviewData.healthLabel as string] ?? HEALTH_COLOR.critical : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-violet-400" />
              Governance & Audit Reports
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">Legal traceability · Compliance monitoring · Dispute & override audit</p>
          </div>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[200px]">
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {selectedProject && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {selectedProject.projectCode && <span className="text-slate-500 text-xs font-mono border border-slate-700 px-2 py-0.5 rounded">{selectedProject.projectCode}</span>}
            <Badge text={selectedProject.lifecycleStatus} colorClass="bg-slate-500/20 text-slate-400 border-slate-500/30" />
            <span className="text-slate-600 text-xs">Admin/Developer view</span>
          </div>
        )}
        <div className="flex gap-1 mt-3 border-b border-slate-800 -mb-4 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap flex-shrink-0 ${tab === t ? "text-violet-400 border-b-2 border-violet-400 bg-slate-800/40" : "text-slate-400 hover:text-slate-200"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        {!projectId && <EmptyState icon={Globe} label="Select a project to view governance reports" />}
        {projectId && isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Activity className="w-8 h-8 mb-3 animate-pulse opacity-40" />
            <p>Loading governance data…</p>
          </div>
        )}

        {/* ── HEALTH DASHBOARD ─────────────────────────────────────────── */}
        {tab === "Health Dashboard" && overviewData && !ovLoading && (
          <div className="space-y-6">
            {/* Governance Health Score */}
            {health && (
              <div className={`rounded-2xl p-6 border ${health.bg} ${health.border}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm font-medium mb-1">Governance Health Score</p>
                    <div className={`text-5xl font-black ${health.text}`}>{overviewData.healthScore}</div>
                    <p className={`text-lg font-semibold mt-1 ${health.text}`}>{health.label}</p>
                    <p className="text-slate-500 text-xs mt-1">Score based on open alerts, disputes, pending nominees, and claims</p>
                  </div>
                  <ShieldCheck className={`w-20 h-20 opacity-20 ${health.text}`} />
                </div>
                {/* Score bar */}
                <div className="mt-4 h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${health.text.replace("text-", "bg-")} opacity-70`}
                    style={{ width: `${overviewData.healthScore}%` }} />
                </div>
              </div>
            )}

            {/* Alert KPIs */}
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Operational Alerts</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard label="Critical Open" value={String(overviewData.alerts?.critical ?? 0)} icon={AlertTriangle} iconColor="text-red-400"
                  alert={overviewData.alerts?.critical > 0} sub="Requires immediate action" onClick={() => setTab("Governance Alerts")} />
                <KPICard label="High Priority Open" value={String(overviewData.alerts?.high ?? 0)} icon={AlertTriangle} iconColor="text-orange-400"
                  sub="Needs urgent attention" onClick={() => setTab("Governance Alerts")} />
                <KPICard label="Total Open Alerts" value={String(overviewData.alerts?.open ?? 0)} icon={Activity} iconColor="text-amber-400"
                  sub={`${overviewData.alerts?.resolved ?? 0} resolved`} onClick={() => setTab("Governance Alerts")} />
                <KPICard label="Acknowledged" value={String(overviewData.alerts?.acknowledged ?? 0)} icon={CheckCircle2} iconColor="text-blue-400"
                  sub="Pending resolution" />
              </div>
            </div>

            {/* Dispute KPIs */}
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Disputes & Conflicts</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard label="Escalated" value={String(overviewData.disputes?.escalated ?? 0)} icon={ArrowUpRight} iconColor="text-red-400"
                  alert={overviewData.disputes?.escalated > 0} sub="Urgent escalation" onClick={() => setTab("Dispute Monitoring")} />
                <KPICard label="Open Disputes" value={String(overviewData.disputes?.open ?? 0)} icon={Gavel} iconColor="text-rose-400"
                  sub="Awaiting resolution" onClick={() => setTab("Dispute Monitoring")} />
                <KPICard label="Under Review" value={String(overviewData.disputes?.underReview ?? 0)} icon={Eye} iconColor="text-amber-400"
                  sub="In active review" onClick={() => setTab("Dispute Monitoring")} />
                <KPICard label="Total Resolved" value={String(overviewData.disputes?.resolved ?? 0)} icon={CheckCircle2} iconColor="text-emerald-400"
                  sub="Successfully closed" />
              </div>
            </div>

            {/* Governance KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Manual Overrides" value={String(overviewData.overrides?.total ?? 0)} icon={GitMerge} iconColor="text-violet-400"
                sub={`${overviewData.overrides?.last30Days ?? 0} in last 30 days`} onClick={() => setTab("Override Audit")} />
              <KPICard label="Pending Nominees" value={String(overviewData.nominees?.pending ?? 0)} icon={UserCheck} iconColor="text-cyan-400"
                alert={overviewData.nominees?.pending > 0} sub="Awaiting activation" onClick={() => setTab("Nominee Status")} />
              <KPICard label="Open Claims" value={String(overviewData.claims?.open ?? 0)} icon={ClipboardList} iconColor="text-blue-400"
                sub={`${overviewData.claims?.approved ?? 0} approved`} onClick={() => setTab("Claims & Claimants")} />
              <KPICard label="Evidence Documents" value={String(overviewData.evidence?.total ?? 0)} icon={FolderOpen} iconColor="text-slate-300"
                sub={`${overviewData.evidence?.active ?? 0} active`} onClick={() => setTab("Evidence Archive")} />
            </div>

            {/* Audit + Meetings row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard label="Audit Log Entries" value={String(overviewData.audit?.totalEntries ?? 0)} icon={Database} iconColor="text-slate-400"
                sub={`${overviewData.audit?.uniqueActors ?? 0} actors`} onClick={() => setTab("Audit Log")} />
              <KPICard label="Modules Overridden" value={String(overviewData.overrides?.modulesAffected ?? 0)} icon={BarChart2} iconColor="text-violet-400"
                sub="Unique modules with overrides" />
              <KPICard label="Governance Meetings" value={String(overviewData.meetings?.total ?? 0)} icon={Users} iconColor="text-emerald-400"
                sub={`${overviewData.meetings?.completed ?? 0} completed · ${overviewData.meetings?.scheduled ?? 0} scheduled`} />
              <KPICard label="Nominees Activated" value={String(overviewData.nominees?.activated ?? 0)} icon={CheckCircle2} iconColor="text-emerald-400"
                sub={`${overviewData.nominees?.revoked ?? 0} revoked`} />
            </div>

            {/* Compliance checklist summary */}
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <SectionTitle icon={Lock} title="Compliance Status Summary" sub="Live governance coverage across all modules" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { label: "Alerts — Critical Open", value: overviewData.alerts?.critical ?? 0, good: 0, icon: AlertTriangle },
                  { label: "Disputes — Escalated", value: overviewData.disputes?.escalated ?? 0, good: 0, icon: ArrowUpRight },
                  { label: "Nominees Pending", value: overviewData.nominees?.pending ?? 0, good: 0, icon: UserCheck },
                  { label: "Open Claims", value: overviewData.claims?.open ?? 0, good: 0, icon: ClipboardList },
                  { label: "Evidence Documents", value: overviewData.evidence?.total ?? 0, good: 1, icon: FolderOpen, inverse: true },
                  { label: "Override Events (30d)", value: overviewData.overrides?.last30Days ?? 0, good: 0, icon: GitMerge },
                ].map(item => {
                  const isGood = item.inverse ? item.value >= item.good : item.value === item.good;
                  return (
                    <div key={item.label} className={`flex items-center gap-3 p-3 rounded-lg border ${isGood ? "bg-emerald-500/10 border-emerald-500/20" : "bg-rose-500/10 border-rose-500/20"}`}>
                      <item.icon className={`w-4 h-4 flex-shrink-0 ${isGood ? "text-emerald-400" : "text-rose-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400 truncate">{item.label}</p>
                        <p className={`font-bold text-sm ${isGood ? "text-emerald-300" : "text-rose-300"}`}>{item.value}</p>
                      </div>
                      {isGood ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── GOVERNANCE ALERTS ────────────────────────────────────────── */}
        {tab === "Governance Alerts" && alertsData && !alertsLoading && (
          <div className="space-y-6">
            {/* Severity summary */}
            {alertsData.bySeverity?.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {alertsData.bySeverity.map((s: { severity: string; total: number; open: number; resolved: number }) => (
                  <div key={s.severity} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <SeverityDot severity={s.severity} />
                      <span className="capitalize text-slate-300 text-sm font-medium">{s.severity}</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{s.total}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.open} open · {s.resolved} resolved</div>
                  </div>
                ))}
              </div>
            )}

            {/* Monthly trend */}
            {alertsData.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Alert Trend" sub="Monthly detected vs resolved" />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={alertsData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="detected" name="Detected" fill="#f97316" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="highSeverity" name="High/Critical" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Alert type breakdown */}
            {alertsData.byType?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={BarChart2} title="Alerts by Type" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Alert Type", "Total", "Open", "Last Detected"]} />
                    <tbody>
                      {alertsData.byType.map((t: { alertType: string; total: number; open: number; lastDetected: unknown }) => (
                        <tr key={t.alertType} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 capitalize">{String(t.alertType).replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-white font-bold">{t.total}</td>
                          <td className="px-3 py-2">
                            {t.open > 0 ? <span className="text-rose-400 font-semibold">{t.open}</span> : <span className="text-emerald-400">0</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDateTime(t.lastDetected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Alert list */}
            {alertsData.alerts?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={AlertTriangle} title="All Alerts" sub={`${alertsData.alerts.length} records — sorted by severity then status`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Severity", "Type", "Title", "Entity", "Detected", "Status", "Resolved By"]} />
                    <tbody>
                      {alertsData.alerts.map((a: {
                        id: string; severity: string; alertType: string; title: string;
                        entityType: string | null; entityRef: string | null; detectedAt: unknown;
                        status: string; resolvedByName: string | null; acknowledgedByName: string | null;
                      }) => (
                        <tr key={a.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${a.severity === "critical" ? "bg-red-500/5" : a.severity === "high" ? "bg-orange-500/5" : ""}`}>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-1.5 text-xs font-medium capitalize" style={{ color: SEVERITY_COLOR[a.severity] ?? "#94a3b8" }}>
                              <SeverityDot severity={a.severity} />{a.severity}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{a.alertType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200 max-w-xs">{a.title}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{a.entityType ?? "—"}{a.entityRef ? ` · ${a.entityRef}` : ""}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(a.detectedAt)}</td>
                          <td className="px-3 py-2"><Badge text={a.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{a.resolvedByName ?? a.acknowledgedByName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={CheckCircle2} label="No alerts found for this project" />}
          </div>
        )}

        {/* ── DISPUTE MONITORING ───────────────────────────────────────── */}
        {tab === "Dispute Monitoring" && disputesData && !disputesLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By type */}
              {disputesData.byType?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={Gavel} title="Disputes by Type" sub="With avg resolution time" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Type", "Total", "Open", "Escalated", "Resolved", "Avg Days"]} />
                      <tbody>
                        {disputesData.byType.map((t: { disputeType: string; total: number; open: number; escalated: number; resolved: number; avgResolutionDays: number }) => (
                          <tr key={t.disputeType} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-200 capitalize">{t.disputeType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-white font-bold">{t.total}</td>
                            <td className="px-3 py-2">{t.open > 0 ? <span className="text-rose-400">{t.open}</span> : "0"}</td>
                            <td className="px-3 py-2">{t.escalated > 0 ? <span className="text-red-400 font-bold">{t.escalated}</span> : "—"}</td>
                            <td className="px-3 py-2 text-emerald-400">{t.resolved}</td>
                            <td className="px-3 py-2 text-slate-400">{t.avgResolutionDays > 0 ? `${t.avgResolutionDays}d` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* Severity pie */}
              {disputesData.bySeverity?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={CircleDot} title="Disputes by Severity" sub="Active only" />
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={disputesData.bySeverity} dataKey="total" nameKey="severity" cx="50%" cy="50%" outerRadius={70} label={e => `${e.severity} (${e.total})`} labelLine={false}>
                        {disputesData.bySeverity.map((s: { severity: string }, i: number) => (
                          <Cell key={s.severity} fill={SEVERITY_COLOR[s.severity] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-3 mt-2 justify-center">
                    {disputesData.bySeverity.map((s: { severity: string; total: number; active: number }) => (
                      <span key={s.severity} className="flex items-center gap-1.5 text-xs text-slate-400">
                        <SeverityDot severity={s.severity} />{s.severity}: {s.total} ({s.active} active)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Monthly trend */}
            {disputesData.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Dispute Trend" sub="Monthly raised vs resolved" />
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={disputesData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Line type="monotone" dataKey="raised" name="Raised" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="highSeverity" name="High/Critical" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Aging analysis */}
            {disputesData.aging?.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {disputesData.aging.map((a: { status: string; count: number; avgAgeDays: number; maxAgeDays: number }) => (
                  <div key={a.status} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                    <Badge text={a.status} />
                    <div className="text-2xl font-bold text-white mt-2">{a.count}</div>
                    <div className="text-xs text-slate-500 mt-1">avg {a.avgAgeDays}d · max {a.maxAgeDays}d</div>
                  </div>
                ))}
              </div>
            )}

            {/* Dispute list */}
            {disputesData.disputes?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Gavel} title="All Disputes" sub={`${disputesData.disputes.length} records`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Sev.", "Type", "Title", "Raised By", "Raised", "Status", "Resolved"]} />
                    <tbody>
                      {disputesData.disputes.map((d: {
                        id: string; severity: string; disputeType: string; title: string;
                        raisedByName: string | null; raisedByRole: string | null; raisedAt: unknown;
                        status: string; resolvedAt: unknown; resolvedByName: string | null;
                      }) => (
                        <tr key={d.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${d.severity === "critical" ? "bg-red-500/5" : ""}`}>
                          <td className="px-3 py-2">
                            <span style={{ color: SEVERITY_COLOR[d.severity] ?? "#94a3b8" }} className="text-xs font-bold capitalize">{d.severity.charAt(0).toUpperCase()}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{d.disputeType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200 max-w-xs truncate">{d.title}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{d.raisedByName ?? "—"}{d.raisedByRole ? ` (${d.raisedByRole})` : ""}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(d.raisedAt)}</td>
                          <td className="px-3 py-2"><Badge text={d.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{d.resolvedByName ? `${d.resolvedByName} · ${fmtDate(d.resolvedAt)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={Gavel} label="No disputes found for this project" />}

            {/* Resolution events */}
            {disputesData.events?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Activity} title="Resolution Event Timeline" sub={`${disputesData.events.length} immutable audit events`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Event", "Dispute", "Type", "Status Change", "Actor", "Performed"]} />
                    <tbody>
                      {disputesData.events.map((e: {
                        id: string; eventType: string; disputeTitle: string; disputeType: string;
                        previousStatus: string | null; newStatus: string | null; actorName: string | null;
                        actorRole: string | null; performedAt: unknown;
                      }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300 capitalize text-xs">{e.eventType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200 max-w-xs truncate text-xs">{e.disputeTitle}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{e.disputeType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {e.previousStatus && <Badge text={e.previousStatus} />}
                              {e.newStatus && <><Minus className="w-3 h-3 text-slate-600" /><Badge text={e.newStatus} /></>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{e.actorName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDateTime(e.performedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── OVERRIDE AUDIT ───────────────────────────────────────────── */}
        {tab === "Override Audit" && overridesData && !overridesLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By module */}
              {overridesData.byModule?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={BarChart2} title="Overrides by Module" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Module", "Count", "Types", "Actors", "Last"]} />
                      <tbody>
                        {overridesData.byModule.map((m: { module: string; count: number; overrideTypes: number; actors: number; lastOverride: unknown }) => (
                          <tr key={m.module} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-200 capitalize">{m.module.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-white font-bold">{m.count}</td>
                            <td className="px-3 py-2 text-slate-400">{m.overrideTypes}</td>
                            <td className="px-3 py-2 text-slate-400">{m.actors}</td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(m.lastOverride)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* By actor */}
              {overridesData.byActor?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={Users} title="Overrides by Actor" sub="Who made the most overrides" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Actor", "Role", "Total", "Modules", "Last"]} />
                      <tbody>
                        {overridesData.byActor.map((a: { actorName: string; actorRole: string | null; total: number; modules: number; lastOverride: unknown }) => (
                          <tr key={a.actorName} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-200">{a.actorName}</td>
                            <td className="px-3 py-2 text-slate-500 text-xs capitalize">{a.actorRole ?? "—"}</td>
                            <td className="px-3 py-2 text-white font-bold">{a.total}</td>
                            <td className="px-3 py-2 text-slate-400">{a.modules}</td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(a.lastOverride)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Monthly trend */}
            {overridesData.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Override Activity Trend" sub="Monthly override events · modules · actors" />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={overridesData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="total" name="Total Overrides" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="modules" name="Modules Affected" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Override log */}
            {overridesData.overrides?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Lock} title="Override Audit Log" sub={`${overridesData.overrides.length} immutable entries — write-once`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Date", "Module", "Override Type", "Title", "Actor", "Role", "Reason"]} />
                    <tbody>
                      {overridesData.overrides.map((o: {
                        id: string; occurredAt: unknown; module: string; overrideType: string; title: string;
                        actorName: string | null; actorRole: string | null; overrideReason: string | null;
                      }) => (
                        <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-400 text-xs">{fmtDateTime(o.occurredAt)}</td>
                          <td className="px-3 py-2 text-slate-300 capitalize text-xs">{o.module.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-violet-400 text-xs capitalize">{o.overrideType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200 max-w-xs truncate">{o.title}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{o.actorName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{o.actorRole ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">{o.overrideReason ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={GitMerge} label="No governance overrides found for this project" />}
          </div>
        )}

        {/* ── NOMINEE STATUS ───────────────────────────────────────────── */}
        {tab === "Nominee Status" && nomineesData && !nomineesLoading && (
          <div className="space-y-6">
            {/* Status summary */}
            {nomineesData.statusSummary?.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {nomineesData.statusSummary.map((s: { activationStatus: string; count: number; current: number }) => (
                  <div key={s.activationStatus} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                    <Badge text={s.activationStatus} />
                    <div className="text-3xl font-bold text-white mt-2">{s.count}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.current} currently active</div>
                  </div>
                ))}
              </div>
            )}

            {/* Nominees list */}
            {nomineesData.nominees?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={UserCheck} title="Nominees" sub="Current and historical" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Name", "Relationship", "Phone", "Status", "Active", "Activated", "Replaced", "Notes"]} />
                    <tbody>
                      {nomineesData.nominees.map((n: {
                        id: string; nomineeName: string; relationship: string; phone: string;
                        activationStatus: string; isActive: boolean; activatedAt: unknown;
                        replacedAt: unknown; activationNotes: string | null;
                      }) => (
                        <tr key={n.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${!n.isActive ? "opacity-50" : ""}`}>
                          <td className="px-3 py-2 text-slate-200 font-medium">{n.nomineeName}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{n.relationship}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs font-mono">{n.phone}</td>
                          <td className="px-3 py-2"><Badge text={n.activationStatus} /></td>
                          <td className="px-3 py-2">{n.isActive ? <span className="text-emerald-400 text-xs">Yes</span> : <span className="text-slate-500 text-xs">No</span>}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(n.activatedAt)}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(n.replacedAt)}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">{n.activationNotes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={UserCheck} label="No nominees found for this project" />}

            {/* Activation workflows */}
            {nomineesData.workflows?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Activity} title="Activation Workflows" sub="Death-based · Voluntary handover pathways" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Nominee", "Type", "Status", "Docs", "OTP Verified", "Admin Verified", "Activated", "Rejected", "Remarks"]} />
                    <tbody>
                      {nomineesData.workflows.map((w: {
                        id: string; nomineeName: string; activationType: string; status: string;
                        hasDeathCert: boolean; hasDeed: boolean; otpVerifiedAt: unknown;
                        otpVerifiedByName: string | null; verifiedAt: unknown; verifiedByName: string | null;
                        activatedAt: unknown; activatedByName: string | null;
                        rejectedAt: unknown; rejectedByName: string | null; rejectionReason: string | null;
                        governanceRemarks: string | null;
                      }) => (
                        <tr key={w.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200">{w.nomineeName}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{w.activationType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2"><Badge text={w.status} /></td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {w.hasDeathCert && <span className="text-xs text-emerald-400">DC</span>}
                              {w.hasDeed && <span className="text-xs text-emerald-400">Deed</span>}
                              {!w.hasDeathCert && !w.hasDeed && <span className="text-slate-600 text-xs">—</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{w.otpVerifiedAt ? `${fmtDate(w.otpVerifiedAt)} · ${w.otpVerifiedByName ?? ""}` : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{w.verifiedAt ? `${fmtDate(w.verifiedAt)} · ${w.verifiedByName ?? ""}` : "—"}</td>
                          <td className="px-3 py-2 text-emerald-400 text-xs">{w.activatedAt ? `${fmtDate(w.activatedAt)} · ${w.activatedByName ?? ""}` : "—"}</td>
                          <td className="px-3 py-2 text-rose-400 text-xs">{w.rejectedAt ? `${fmtDate(w.rejectedAt)}` : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">{w.governanceRemarks ?? w.rejectionReason ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CLAIMS & CLAIMANTS ───────────────────────────────────────── */}
        {tab === "Claims & Claimants" && claimsData && !claimsLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Status summary */}
              {claimsData.byStatus?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={ClipboardList} title="Claims by Status" />
                  <div className="flex flex-wrap gap-3 mt-2">
                    {claimsData.byStatus.map((s: { status: string; count: number }) => (
                      <div key={s.status} className="text-center">
                        <Badge text={s.status} />
                        <div className="text-xl font-bold text-white mt-1">{s.count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Doc checklist */}
              {claimsData.docChecklist?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={FileText} title="Document Verification Status" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Doc Type", "Total", "Verified", "Pending", "Rejected", "Missing"]} />
                      <tbody>
                        {claimsData.docChecklist.map((d: { documentType: string; total: number; verified: number; pending: number; rejected: number; missingFile: number }) => (
                          <tr key={d.documentType} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-300 capitalize text-xs">{d.documentType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-white">{d.total}</td>
                            <td className="px-3 py-2 text-emerald-400">{d.verified}</td>
                            <td className="px-3 py-2 text-amber-400">{d.pending}</td>
                            <td className="px-3 py-2 text-rose-400">{d.rejected}</td>
                            <td className="px-3 py-2">{d.missingFile > 0 ? <span className="text-orange-400 font-bold">{d.missingFile}</span> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Claims list */}
            {claimsData.claims?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={ClipboardList} title="Inheritance Claims" sub={`${claimsData.claims.length} records — full governance trail`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Partner", "Type", "Status", "Initiated By", "Dev Approved", "Final Approval", "Shares", "Docs", "Filed"]} />
                    <tbody>
                      {claimsData.claims.map((c: {
                        id: string; partnerName: string; claimType: string; status: string;
                        initiatedByName: string | null; developerApprovedByName: string | null; developerApprovedAt: unknown;
                        approvedByName: string | null; approvedAt: unknown;
                        rejectedByName: string | null; rejectedAt: unknown; rejectionReason: string | null;
                        shareCount: number; docCount: number; verifiedDocs: number; createdAt: unknown;
                      }) => (
                        <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 font-medium">{c.partnerName}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{c.claimType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2"><Badge text={c.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{c.initiatedByName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{c.developerApprovedByName ? `${c.developerApprovedByName} · ${fmtDate(c.developerApprovedAt)}` : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{c.approvedByName ? <span className="text-emerald-400">{c.approvedByName}</span> : c.rejectedByName ? <span className="text-rose-400">{c.rejectedByName}</span> : "—"}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{c.shareCount}</td>
                          <td className="px-3 py-2">
                            <span className={c.verifiedDocs < c.docCount ? "text-amber-400 text-xs" : "text-emerald-400 text-xs"}>
                              {c.verifiedDocs}/{c.docCount}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(c.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={ClipboardList} label="No inheritance claims found for this project" />}

            {/* Claimants */}
            {claimsData.claimants?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Users} title="Registered Claimants" sub={`${claimsData.claimants.length} claimants`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Name", "Relationship", "Partner", "Status", "Active", "Registered"]} />
                    <tbody>
                      {claimsData.claimants.map((c: { id: string; claimantName: string; relationship: string; partnerName: string; status: string; isActive: boolean; createdAt: unknown }) => (
                        <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 font-medium">{c.claimantName}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{c.relationship}</td>
                          <td className="px-3 py-2 text-slate-400 text-sm">{c.partnerName}</td>
                          <td className="px-3 py-2"><Badge text={c.status} /></td>
                          <td className="px-3 py-2">{c.isActive ? <span className="text-emerald-400 text-xs">Yes</span> : <span className="text-slate-500 text-xs">No</span>}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(c.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Shares with disputes */}
            {claimsData.shares?.some((s: { status: string }) => s.status === "disputed") && (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-orange-500/30">
                  <SectionTitle icon={AlertTriangle} title="Disputed Share Proposals" sub="Requires immediate admin review" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Claimant", "Share %", "Status", "Proposed By", "Dispute Notes"]} />
                    <tbody>
                      {claimsData.shares.filter((s: { status: string }) => s.status === "disputed").map((s: { id: string; claimantName: string; proposedSharePct: number; status: string; proposedByName: string | null; disputeNotes: string | null }) => (
                        <tr key={s.id} className="border-b border-orange-500/20 hover:bg-orange-500/10">
                          <td className="px-3 py-2 text-slate-200">{s.claimantName}</td>
                          <td className="px-3 py-2 text-orange-400 font-bold">{s.proposedSharePct.toFixed(2)}%</td>
                          <td className="px-3 py-2"><Badge text={s.status} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{s.proposedByName ?? "—"}</td>
                          <td className="px-3 py-2 text-orange-300 text-xs max-w-xs truncate">{s.disputeNotes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── EVIDENCE ARCHIVE ─────────────────────────────────────────── */}
        {tab === "Evidence Archive" && evidenceData && !evidenceLoading && (
          <div className="space-y-6">
            {/* Missing doc types alert */}
            {evidenceData.missingDocTypes?.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 font-semibold text-sm">Missing Document Categories</p>
                    <p className="text-slate-400 text-xs mt-1 mb-2">The following expected legal document types have no records in the archive for this project:</p>
                    <div className="flex flex-wrap gap-2">
                      {evidenceData.missingDocTypes.map((t: string) => (
                        <span key={t} className="px-2 py-1 bg-amber-500/20 border border-amber-500/30 rounded text-amber-300 text-xs capitalize">{t.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* By doc type */}
            {evidenceData.byType?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={FolderOpen} title="Documents by Type" sub="Archive status coverage" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Document Type", "Total", "Current", "Superseded", "Missing File", "Last Uploaded"]} />
                    <tbody>
                      {evidenceData.byType.map((t: { documentType: string; total: number; current: number; superseded: number; missingFile: number; lastUploaded: unknown }) => (
                        <tr key={t.documentType} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 capitalize">{t.documentType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-white font-bold">{t.total}</td>
                          <td className="px-3 py-2 text-emerald-400">{t.current}</td>
                          <td className="px-3 py-2 text-slate-500">{t.superseded}</td>
                          <td className="px-3 py-2">{t.missingFile > 0 ? <span className="text-orange-400 font-bold">{t.missingFile}</span> : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(t.lastUploaded)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Version chain */}
            {evidenceData.versionChain?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={GitMerge} title="Document Version Chain" sub="Documents with multiple versions" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Type", "Title", "Version", "Status", "Latest", "Uploaded By", "Date"]} />
                    <tbody>
                      {evidenceData.versionChain.map((v: { documentType: string; title: string; versionNumber: number; archiveStatus: string; isLatestVersion: boolean; uploadedByName: string | null; createdAt: unknown }, i: number) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{v.documentType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200">{v.title}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">v{v.versionNumber}</td>
                          <td className="px-3 py-2"><Badge text={v.archiveStatus} /></td>
                          <td className="px-3 py-2">{v.isLatestVersion ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Minus className="w-4 h-4 text-slate-600" />}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{v.uploadedByName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(v.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Document archive list */}
            {evidenceData.documents?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={BookOpen} title="Legal Evidence Archive" sub={`${evidenceData.documents.length} records — immutable references`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Type", "Title", "Ref #", "Version", "Has File", "Status", "Uploaded By", "Date"]} />
                    <tbody>
                      {evidenceData.documents.slice(0, 80).map((d: {
                        id: string; documentType: string; title: string; referenceNumber: string | null;
                        versionNumber: number; isLatestVersion: boolean; hasFile: boolean;
                        archiveStatus: string; uploadedByName: string | null; createdAt: unknown;
                      }) => (
                        <tr key={d.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${!d.isLatestVersion ? "opacity-60" : ""}`}>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{d.documentType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200">{d.title}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{d.referenceNumber ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 font-mono text-xs">v{d.versionNumber}{!d.isLatestVersion ? " (old)" : ""}</td>
                          <td className="px-3 py-2">{d.hasFile ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-orange-400" />}</td>
                          <td className="px-3 py-2"><Badge text={d.archiveStatus} /></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{d.uploadedByName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(d.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={FolderOpen} label="No evidence documents found for this project" />}

            {/* Access log */}
            {evidenceData.accessLog?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Eye} title="Evidence Access Log" sub={`${evidenceData.accessLog.length} recent access events — immutable`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Access Type", "Document", "Doc Type", "Actor", "Role", "IP", "When"]} />
                    <tbody>
                      {evidenceData.accessLog.map((a: { id: string; accessType: string; documentTitle: string; documentType: string; actorName: string | null; actorRole: string | null; ipAddress: string | null; accessedAt: unknown }) => (
                        <tr key={a.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-300 capitalize text-xs">{a.accessType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-200 max-w-xs truncate">{a.documentTitle}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{a.documentType.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{a.actorName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{a.actorRole ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-600 text-xs font-mono">{a.ipAddress ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDateTime(a.accessedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT LOG ────────────────────────────────────────────────── */}
        {tab === "Audit Log" && auditData && !auditLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By module */}
              {auditData.byModule?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <SectionTitle icon={Database} title="Audit Activity by Module" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader cols={["Module", "Entries", "Action Types", "Actors", "Last"]} />
                      <tbody>
                        {auditData.byModule.map((m: { module: string; count: number; actionTypes: number; actors: number; lastEntry: unknown }) => (
                          <tr key={m.module} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                            <td className="px-3 py-2 text-slate-200 capitalize">{m.module.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-white font-bold">{m.count}</td>
                            <td className="px-3 py-2 text-slate-400">{m.actionTypes}</td>
                            <td className="px-3 py-2 text-slate-400">{m.actors}</td>
                            <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(m.lastEntry)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* By operation */}
              {auditData.byOperation?.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                  <SectionTitle icon={CircleDot} title="Operations Distribution" />
                  <div className="flex flex-col gap-3 mt-2">
                    {auditData.byOperation.map((o: { operation: string; count: number }) => {
                      const total = auditData.byOperation.reduce((s: number, r: { count: number }) => s + r.count, 0);
                      const pct = total > 0 ? (o.count / total) * 100 : 0;
                      return (
                        <div key={o.operation}>
                          <div className="flex justify-between mb-1">
                            <div className="flex items-center gap-2"><Badge text={o.operation} /><span className="text-slate-400 text-xs">{o.count} entries</span></div>
                            <span className="text-slate-400 text-xs">{pct.toFixed(1)}%</span>
                          </div>
                          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${pct}%`,
                              background: o.operation === "INSERT" ? "#10b981" : o.operation === "UPDATE" ? "#f59e0b" : "#ef4444",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Monthly trend */}
            {auditData.monthlyTrend?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
                <SectionTitle icon={TrendingUp} title="Audit Activity Trend" sub="Monthly entries by operation type" />
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={auditData.monthlyTrend}>
                    <defs>
                      <linearGradient id="gInsert" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gUpdate" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area type="monotone" dataKey="inserts" name="Inserts" stroke="#10b981" fill="url(#gInsert)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="updates" name="Updates" stroke="#f59e0b" fill="url(#gUpdate)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="deletes" name="Deletes" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* By actor */}
            {auditData.byActor?.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Users} title="Audit Activity by Actor" sub="Top users by audit event volume" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["User", "Role", "Total Entries", "Tables", "First Activity", "Last Activity"]} />
                    <tbody>
                      {auditData.byActor.map((a: { userName: string; userRole: string | null; total: number; tables: number; first: unknown; last: unknown }) => (
                        <tr key={a.userName} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2 text-slate-200 font-medium">{a.userName}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{a.userRole ?? "—"}</td>
                          <td className="px-3 py-2 text-white font-bold">{a.total}</td>
                          <td className="px-3 py-2 text-slate-400">{a.tables}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(a.first)}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDate(a.last)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Audit entries */}
            {auditData.entries?.length > 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                  <SectionTitle icon={Lock} title="Audit Log Entries" sub={`Showing ${auditData.entries.length} of ${auditData.limit}+ entries — immutable compliance log`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader cols={["Operation", "Module", "Action", "Table", "Record ID", "Actor", "Role", "When"]} />
                    <tbody>
                      {auditData.entries.map((e: { id: string; operation: string; module: string | null; actionType: string | null; tableName: string; recordId: string; userName: string | null; userRole: string | null; createdAt: unknown }) => (
                        <tr key={e.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="px-3 py-2"><Badge text={e.operation} /></td>
                          <td className="px-3 py-2 text-slate-400 text-xs capitalize">{e.module ? e.module.replace(/_/g, " ") : "—"}</td>
                          <td className="px-3 py-2 text-slate-300 text-xs capitalize">{e.actionType ? e.actionType.replace(/_/g, " ") : "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs font-mono">{e.tableName}</td>
                          <td className="px-3 py-2 text-slate-600 text-xs font-mono truncate max-w-xs">{e.recordId.slice(0, 8)}…</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{e.userName ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs capitalize">{e.userRole ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{fmtDateTime(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState icon={Database} label="No audit log entries found for this project" />}
          </div>
        )}
      </div>
    </div>
  );
}
