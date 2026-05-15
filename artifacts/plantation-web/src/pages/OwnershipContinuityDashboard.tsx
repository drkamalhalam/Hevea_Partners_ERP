/**
 * OwnershipContinuityDashboard.tsx
 *
 * Central governance panel consolidating:
 *   - Live ownership structure across all projects
 *   - Pending share transfers (full state-machine view)
 *   - Inheritance claims pipeline
 *   - Nominee activation workflows
 *   - Prematurity succession monitoring
 *   - Governance alerts and historical ownership visualization
 *
 * Design: ERP / legal-governance dark-accent with amber alert rails.
 */

import { useMemo } from "react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import {
  useGetOwnershipSummary,
  useGetOwnershipTransferDashboard,
  useGetInheritanceDashboard,
  useGetNomineeSuccessionDashboard,
  useGetPrematuritySuccessionDashboard,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import {
  Scale,
  ArrowLeftRight,
  Gavel,
  UserCheck,
  Sprout,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Activity,
  Layers,
  RefreshCw,
  ArrowRight,
  Clock,
  CheckCircle2,
  XCircle,
  Circle,
  Info,
  Lock,
  User,
  Heart,
  Handshake,
  Search,
  FileText,
  TrendingUp,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

// ── Colour tokens ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  // Transfers
  draft: "#94a3b8",
  pending_rofr: "#f59e0b",
  rofr_accepted: "#3b82f6",
  rofr_rejected: "#ef4444",
  pending_approval: "#f59e0b",
  approved: "#10b981",
  executed: "#22c55e",
  cancelled: "#6b7280",
  expired: "#9ca3af",
  // Inheritance
  open: "#f59e0b",
  under_review: "#3b82f6",
  developer_approved: "#8b5cf6",
  documents_verified: "#06b6d4",
  settled: "#22c55e",
  rejected: "#ef4444",
  // Nominee
  pending_verification: "#f59e0b",
  pending_otp: "#3b82f6",
  activated: "#22c55e",
  revoked: "#ef4444",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "dd MMM yyyy");
}

function ago(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return formatDistanceToNow(new Date(d), { addSuffix: true });
}

function transferStatusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-slate-100 text-slate-600 border-slate-200" },
    pending_rofr: { label: "ROFR Pending", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    rofr_accepted: { label: "ROFR Accepted", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    rofr_rejected: { label: "ROFR Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
    pending_approval: { label: "Pending Approval", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    executed: { label: "Executed", cls: "bg-green-50 text-green-700 border-green-200" },
    cancelled: { label: "Cancelled", cls: "bg-gray-100 text-gray-500 border-gray-200" },
    expired: { label: "Expired", cls: "bg-gray-100 text-gray-400 border-gray-200" },
  };
  const v = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <Badge variant="outline" className={`text-xs ${v.cls}`}>{v.label}</Badge>
  );
}

function claimStatusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "Open", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    under_review: { label: "Under Review", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    developer_approved: { label: "Dev Approved", cls: "bg-violet-50 text-violet-700 border-violet-200" },
    documents_verified: { label: "Docs Verified", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
    approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    settled: { label: "Settled", cls: "bg-green-50 text-green-700 border-green-200" },
    rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const v = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <Badge variant="outline" className={`text-xs ${v.cls}`}>{v.label}</Badge>
  );
}

function nomineeWorkflowBadge(type: string, status: string) {
  const typeIcon =
    type === "death_based" ? <Heart className="w-3 h-3" /> :
    type === "voluntary_handover" ? <Handshake className="w-3 h-3" /> :
    <Search className="w-3 h-3" />;
  const typeLabel =
    type === "death_based" ? "Death-Based" :
    type === "voluntary_handover" ? "Living Handover" : "Missing Dev";
  const statusCls =
    status === "activated" ? "bg-green-50 text-green-700 border-green-200" :
    status === "pending_verification" ? "bg-amber-50 text-amber-700 border-amber-200" :
    status === "pending_otp" ? "bg-blue-50 text-blue-700 border-blue-200" :
    "bg-gray-100 text-gray-500 border-gray-200";
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className={`text-xs gap-1 ${statusCls}`}>
        {typeIcon} {typeLabel}
      </Badge>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  alert?: boolean;
  warn?: boolean;
}

function KpiCard({ icon, label, value, sub, alert, warn }: KpiCardProps) {
  return (
    <Card className={`relative overflow-hidden ${alert ? "border-red-200 bg-red-50/40" : warn ? "border-amber-200 bg-amber-50/30" : "border-slate-200 bg-white"}`}>
      {(alert || warn) && (
        <div className={`absolute top-0 left-0 w-1 h-full ${alert ? "bg-red-400" : "bg-amber-400"}`} />
      )}
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-2xl font-bold ${alert ? "text-red-700" : warn ? "text-amber-700" : "text-slate-800"}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg ${alert ? "bg-red-100 text-red-600" : warn ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-600"}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, sub, href, hrefLabel }: { icon: React.ReactNode; title: string; sub?: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-slate-800 rounded-md text-white">{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {sub && <p className="text-xs text-slate-400">{sub}</p>}
        </div>
      </div>
      {href && (
        <Link href={href}>
          <Button variant="ghost" size="sm" className="text-xs text-slate-500 gap-1 h-7">
            {hrefLabel ?? "View All"} <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      )}
    </div>
  );
}

// ── Governance Alert Row ───────────────────────────────────────────────────────

function AlertRow({ level, title, body, href }: { level: "critical" | "warning" | "info"; title: string; body: string; href?: string }) {
  const cls =
    level === "critical" ? "bg-red-50 border-red-200 text-red-800" :
    level === "warning" ? "bg-amber-50 border-amber-200 text-amber-800" :
    "bg-blue-50 border-blue-200 text-blue-800";
  const Icon = level === "critical" ? AlertTriangle : level === "warning" ? AlertCircle : Info;
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${cls}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-xs opacity-80 mt-0.5">{body}</p>
      </div>
      {href && (
        <Link href={href}>
          <ChevronRight className="w-4 h-4 opacity-60 shrink-0 mt-0.5" />
        </Link>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
      <div className="opacity-40">{icon}</div>
      <p className="text-xs">{text}</p>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingRows({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-md" />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function OwnershipContinuityDashboard() {
  const ownershipQ = useGetOwnershipSummary({});
  const transferQ = useGetOwnershipTransferDashboard();
  const inheritanceQ = useGetInheritanceDashboard({});
  const nomineeQ = useGetNomineeSuccessionDashboard();
  const prematurityQ = useGetPrematuritySuccessionDashboard({});

  const isLoading =
    ownershipQ.isLoading ||
    transferQ.isLoading ||
    inheritanceQ.isLoading ||
    nomineeQ.isLoading ||
    prematurityQ.isLoading;

  function refetchAll() {
    ownershipQ.refetch();
    transferQ.refetch();
    inheritanceQ.refetch();
    nomineeQ.refetch();
    prematurityQ.refetch();
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const ownership = ownershipQ.data?.projects ?? [];
  const transfers = transferQ.data;
  const inheritance = inheritanceQ.data?.dashboard;
  const nominee = nomineeQ.data;
  const prematurity = prematurityQ.data?.summary;

  const pendingTransfers = transfers?.totalPending ?? 0;
  const openClaims = inheritance?.pendingGovernance ?? 0;
  const activeNomineeWorkflows = nominee?.kpis?.totalActiveWorkflows ?? 0;
  const disputedParticipations = prematurity?.disputedParticipations ?? 0;
  const projectsWithoutNominee = nominee?.kpis?.projectsWithoutNominee ?? 0;

  const totalAlerts = pendingTransfers + openClaims + activeNomineeWorkflows + disputedParticipations + projectsWithoutNominee;
  const criticalAlerts = (nominee?.kpis?.nomineeEligibleCases ?? 0) + (prematurityQ.data?.governanceFlags?.hasDisputedClaimants ? 1 : 0);

  // ── Ownership chart data ─────────────────────────────────────────────────────

  const ownershipChartData = useMemo(() => {
    return ownership.slice(0, 8).map((proj: any) => {
      const partners: Record<string, number> = {};
      const entries: any[] = proj.partners ?? [];
      let other = 100;
      entries.slice(0, 4).forEach((p: any) => {
        const pct = parseFloat(p.ownershipPct ?? "0");
        partners[p.partnerName?.split(" ")[0] ?? "P"] = pct;
        other -= pct;
      });
      if (entries.length > 4) partners["Others"] = Math.max(0, other);
      return { name: proj.projectName?.substring(0, 14) ?? proj.projectId, ...partners };
    });
  }, [ownership]);

  const chartPartnerKeys = useMemo(() => {
    const keys = new Set<string>();
    ownershipChartData.forEach((d) => Object.keys(d).filter((k) => k !== "name").forEach((k) => keys.add(k)));
    return Array.from(keys);
  }, [ownershipChartData]);

  const CHART_PALETTE = ["#1e3a5f", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d"];

  // ── Inheritance pipeline chart ───────────────────────────────────────────────

  const inheritancePipelineData = useMemo(() => {
    if (!inheritance) return [];
    return [
      { name: "Open", value: inheritance.open, fill: "#f59e0b" },
      { name: "Under Review", value: inheritance.underReview, fill: "#3b82f6" },
      { name: "Dev Approved", value: inheritance.developerApproved, fill: "#8b5cf6" },
      { name: "Docs Verified", value: inheritance.documentsVerified, fill: "#06b6d4" },
      { name: "Approved", value: inheritance.approved, fill: "#10b981" },
      { name: "Settled", value: inheritance.settled, fill: "#22c55e" },
    ].filter((d) => (d.value ?? 0) > 0);
  }, [inheritance]);

  // ── Governance alerts ────────────────────────────────────────────────────────

  const alerts = useMemo(() => {
    const list: Array<{ level: "critical" | "warning" | "info"; title: string; body: string; href?: string }> = [];

    if ((nominee?.kpis?.nomineeEligibleCases ?? 0) > 0) {
      list.push({
        level: "critical",
        title: "Nominee Eligibility Triggered",
        body: `${nominee!.kpis?.nomineeEligibleCases ?? 0} missing-developer case(s) have exceeded the 45-day wait period. Nominee activation is now eligible.`,
        href: "/nominee-succession",
      });
    }
    if ((nominee?.kpis?.projectsWithoutNominee ?? 0) > 0) {
      list.push({
        level: "critical",
        title: "Projects Without Active Nominee",
        body: `${nominee!.kpis?.projectsWithoutNominee ?? 0} project(s) have no registered nominee, creating a governance continuity gap.`,
        href: "/nominee-succession",
      });
    }
    if ((prematurity?.disputedParticipations ?? 0) > 0) {
      list.push({
        level: "warning",
        title: "Disputed Claimant Participations",
        body: `${prematurity!.disputedParticipations} prematurity participation(s) are marked disputed. Fund accumulation may be ongoing.`,
        href: "/prematurity-succession",
      });
    }
    if ((prematurity?.pendingOtpCount ?? 0) > 0) {
      list.push({
        level: "warning",
        title: "OTP-Pending Contributions",
        body: `${prematurity!.pendingOtpCount} contribution(s) are awaiting OTP verification before being accepted.`,
        href: "/prematurity-succession",
      });
    }
    if ((inheritance?.pendingDocCount ?? 0) > 0) {
      list.push({
        level: "warning",
        title: "Inheritance Documents Unverified",
        body: `${inheritance!.pendingDocCount} document(s) across inheritance claims require verification.`,
        href: "/inheritance-claims",
      });
    }
    if ((inheritance?.pendingShareCount ?? 0) > 0) {
      list.push({
        level: "warning",
        title: "Share Proposals Awaiting Approval",
        body: `${inheritance!.pendingShareCount} proposed share allocation(s) are pending admin approval.`,
        href: "/inheritance-claims",
      });
    }
    if (pendingTransfers > 0) {
      list.push({
        level: "info",
        title: "Ownership Transfers In Pipeline",
        body: `${pendingTransfers} transfer request(s) are active in the ROFR or approval workflow.`,
        href: "/ownership-transfers",
      });
    }
    if (activeNomineeWorkflows > 0) {
      list.push({
        level: "info",
        title: "Nominee Activation Workflows Active",
        body: `${activeNomineeWorkflows} workflow(s) are open for succession governance authority transfer.`,
        href: "/nominee-succession",
      });
    }
    return list;
  }, [nominee, prematurity, inheritance, pendingTransfers, activeNomineeWorkflows]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Page header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-lg">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                Ownership Continuity & Succession
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Live governance dashboard — ownership structure, transfers, inheritance, and nominee succession
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refetchAll}
            disabled={isLoading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* ── KPI Bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            icon={<ArrowLeftRight className="w-4 h-4" />}
            label="Pending Transfers"
            value={isLoading ? "—" : pendingTransfers}
            sub="in ROFR / approval"
            warn={pendingTransfers > 0}
          />
          <KpiCard
            icon={<Gavel className="w-4 h-4" />}
            label="Open Claims"
            value={isLoading ? "—" : openClaims}
            sub="inheritance governance"
            warn={openClaims > 0}
          />
          <KpiCard
            icon={<UserCheck className="w-4 h-4" />}
            label="Active Workflows"
            value={isLoading ? "—" : activeNomineeWorkflows}
            sub="nominee succession"
            warn={activeNomineeWorkflows > 0}
          />
          <KpiCard
            icon={<Sprout className="w-4 h-4" />}
            label="Disputed Participations"
            value={isLoading ? "—" : disputedParticipations}
            sub="prematurity succession"
            alert={disputedParticipations > 0}
          />
          <KpiCard
            icon={<ShieldAlert className="w-4 h-4" />}
            label="Without Nominee"
            value={isLoading ? "—" : projectsWithoutNominee}
            sub="projects at governance risk"
            alert={projectsWithoutNominee > 0}
          />
        </div>

        {/* ── Governance Alert Rail ── */}
        {alerts.length > 0 && (
          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2 text-slate-800">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                Governance Alerts
                <Badge className="ml-1 text-xs bg-amber-500 hover:bg-amber-500 text-white">
                  {alerts.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <AlertRow key={i} level={a.level} title={a.title} body={a.body} href={a.href} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {alerts.length === 0 && !isLoading && (
          <Card className="border-green-200 bg-green-50/40">
            <CardContent className="px-4 py-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-green-600" />
              <p className="text-sm text-green-700 font-medium">
                No active governance alerts — all succession and ownership workflows are clear.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Main two-column: Ownership Structure + Transfers ── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

          {/* Ownership Structure */}
          <div className="xl:col-span-3">
            <Card className="border-slate-200">
              <CardHeader className="pb-2 pt-4 px-4">
                <SectionHeader
                  icon={<Scale className="w-3.5 h-3.5" />}
                  title="Ownership Structure"
                  sub="Live calculated equity across all active projects"
                  href="/ownership"
                  hrefLabel="Ownership Guidance"
                />
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-4">
                {ownershipQ.isLoading && <LoadingRows n={4} />}
                {!ownershipQ.isLoading && ownership.length === 0 && (
                  <EmptyState icon={<Scale className="w-8 h-8" />} text="No ownership records found" />
                )}
                {ownership.length > 0 && (
                  <>
                    {/* Stacked bar chart */}
                    {ownershipChartData.length > 0 && (
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={ownershipChartData} margin={{ top: 4, right: 4, left: -20, bottom: 24 }}>
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 9, fill: "#64748b" }}
                              angle={-30}
                              textAnchor="end"
                              interval={0}
                            />
                            <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} domain={[0, 100]} unit="%" />
                            <Tooltip
                              formatter={(v: number) => `${v.toFixed(2)}%`}
                              contentStyle={{ fontSize: 11 }}
                            />
                            {chartPartnerKeys.map((k, i) => (
                              <Bar key={k} dataKey={k} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === chartPartnerKeys.length - 1 ? [3, 3, 0, 0] : undefined} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Per-project table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="text-left py-2 pr-3 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Project</th>
                            <th className="text-left py-2 pr-3 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Partners</th>
                            <th className="text-center py-2 pr-3 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Frozen</th>
                            <th className="text-left py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {ownership.map((proj: any) => (
                            <tr key={proj.projectId} className="hover:bg-slate-50/60">
                              <td className="py-2.5 pr-3 font-medium text-slate-800 max-w-[140px] truncate">{proj.projectName}</td>
                              <td className="py-2.5 pr-3 text-slate-500">{proj.partners?.length ?? 0} partner{(proj.partners?.length ?? 0) !== 1 ? "s" : ""}</td>
                              <td className="py-2.5 pr-3 text-center">
                                {proj.isFrozen ? (
                                  <Lock className="w-3.5 h-3.5 text-blue-500 mx-auto" />
                                ) : (
                                  <Circle className="w-3.5 h-3.5 text-slate-300 mx-auto" />
                                )}
                              </td>
                              <td className="py-2.5">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${proj.lifecycleStatus === "mature_production" ? "bg-green-50 text-green-700 border-green-200" : proj.lifecycleStatus === "prematurity" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}
                                >
                                  {proj.lifecycleStatus?.replace(/_/g, " ") ?? "—"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pending Ownership Transfers */}
          <div className="xl:col-span-2">
            <Card className="border-slate-200 h-full">
              <CardHeader className="pb-2 pt-4 px-4">
                <SectionHeader
                  icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
                  title="Pending Share Transfers"
                  sub={transfers ? `${transfers.totalPending} active` : ""}
                  href="/ownership-transfers"
                />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {transferQ.isLoading && <LoadingRows n={4} />}
                {!transferQ.isLoading && (transfers?.pendingTransfers?.length ?? 0) === 0 && (
                  <EmptyState icon={<ArrowLeftRight className="w-7 h-7" />} text="No pending transfers" />
                )}

                {/* Status breakdown pills */}
                {transfers && Object.keys(transfers.byStatus ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.entries(transfers.byStatus).map(([status, count]) => (
                      <div key={status} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium border border-slate-200">
                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: STATUS_COLORS[status] ?? "#94a3b8" }} />
                        {status.replace(/_/g, " ")} ({count as number})
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {(transfers?.pendingTransfers ?? []).slice(0, 6).map((t: any) => (
                    <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">{t.projectName ?? t.projectId}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {t.transferType === "internal" ? "Internal" : "Third-Party"} · {parseFloat(t.offeredPercentage ?? "0").toFixed(2)}%
                          {t.offeredValue ? ` · ₹${Number(t.offeredValue).toLocaleString("en-IN")}` : ""}
                        </p>
                      </div>
                      {transferStatusBadge(t.status)}
                    </div>
                  ))}
                </div>

                {(transfers?.totalPending ?? 0) > 6 && (
                  <div className="mt-2 text-center">
                    <Link href="/ownership-transfers">
                      <Button variant="ghost" size="sm" className="text-xs text-slate-400 gap-1 h-6">
                        +{(transfers?.totalPending ?? 0) - 6} more <ArrowRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Middle: Inheritance + Nominee ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Inheritance Claims */}
          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4 px-4">
              <SectionHeader
                icon={<Gavel className="w-3.5 h-3.5" />}
                title="Inheritance Claims Pipeline"
                sub={inheritance ? `${inheritance.total} total · ${inheritance.pendingGovernance} pending governance` : ""}
                href="/inheritance-claims"
              />
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              {inheritanceQ.isLoading && <LoadingRows n={3} />}
              {!inheritanceQ.isLoading && !inheritance && (
                <EmptyState icon={<Gavel className="w-7 h-7" />} text="No inheritance data" />
              )}

              {inheritance && (
                <>
                  {/* Status funnel */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Open", value: inheritance.open, color: "text-amber-700 bg-amber-50 border-amber-100" },
                      { label: "Under Review", value: inheritance.underReview, color: "text-blue-700 bg-blue-50 border-blue-100" },
                      { label: "Dev Approved", value: inheritance.developerApproved, color: "text-violet-700 bg-violet-50 border-violet-100" },
                      { label: "Docs Verified", value: inheritance.documentsVerified, color: "text-cyan-700 bg-cyan-50 border-cyan-100" },
                      { label: "Approved", value: inheritance.approved, color: "text-emerald-700 bg-emerald-50 border-emerald-100" },
                      { label: "Settled", value: inheritance.settled, color: "text-green-700 bg-green-50 border-green-100" },
                    ].map((s) => (
                      <div key={s.label} className={`text-center rounded-lg border p-2 ${s.color}`}>
                        <p className="text-lg font-bold">{s.value}</p>
                        <p className="text-[9px] font-medium uppercase tracking-wider">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Supplemental KPIs */}
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {inheritance.pendingDocCount ?? 0} docs pending
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {inheritance.pendingShareCount ?? 0} share proposals
                    </span>
                    <span className="flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      {inheritance.projectsWithActiveClaims ?? 0} projects affected
                    </span>
                  </div>

                  {/* Pipeline bar */}
                  {inheritancePipelineData.length > 0 && (
                    <div className="h-28">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={inheritancePipelineData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#64748b" }} />
                          <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} allowDecimals={false} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                            {inheritancePipelineData.map((d, i) => (
                              <Cell key={i} fill={d.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Recent claims */}
                  {(inheritanceQ.data?.dashboard?.recentClaims ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Recent Claims</p>
                      {(inheritanceQ.data?.dashboard?.recentClaims ?? []).slice(0, 4).map((c: any) => (
                        <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-100">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{c.description ?? "Claim"}</p>
                            <p className="text-[10px] text-slate-400">{c.claimType} · {ago(c.createdAt)}</p>
                          </div>
                          {claimStatusBadge(c.status)}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Nominee Succession */}
          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4 px-4">
              <SectionHeader
                icon={<UserCheck className="w-3.5 h-3.5" />}
                title="Nominee Succession Monitoring"
                sub={nominee ? `${nominee.kpis?.totalActiveWorkflows ?? 0} active workflow(s)` : ""}
                href="/nominee-succession"
              />
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              {nomineeQ.isLoading && <LoadingRows n={3} />}
              {!nomineeQ.isLoading && !nominee && (
                <EmptyState icon={<UserCheck className="w-7 h-7" />} text="No nominee data" />
              )}

              {nominee && (
                <>
                  {/* KPI row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: "Death-Based", value: nominee.kpis?.deathBasedPending ?? 0, color: "bg-red-50 text-red-700 border-red-100" },
                      { label: "Voluntary", value: nominee.kpis?.voluntaryHandoverPending ?? 0, color: "bg-blue-50 text-blue-700 border-blue-100" },
                      { label: "Missing Dev", value: nominee.kpis?.missingDeveloperCases ?? 0, color: "bg-amber-50 text-amber-700 border-amber-100" },
                      { label: "Eligible Now", value: nominee.kpis?.nomineeEligibleCases ?? 0, color: (nominee.kpis?.nomineeEligibleCases ?? 0) > 0 ? "bg-red-100 text-red-800 border-red-200" : "bg-green-50 text-green-700 border-green-100" },
                    ].map((s) => (
                      <div key={s.label} className={`text-center rounded-lg border p-2 ${s.color}`}>
                        <p className="text-lg font-bold">{s.value}</p>
                        <p className="text-[9px] font-medium uppercase tracking-wider">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Projects without nominee */}
                  {(nominee.projectsWithoutNominee ?? []).length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
                      <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Projects Missing a Nominee
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(nominee.projectsWithoutNominee ?? []).slice(0, 6).map((p: any) => (
                          <Badge key={p.id} variant="outline" className="text-[10px] bg-white text-red-700 border-red-200">
                            {p.name}
                          </Badge>
                        ))}
                        {(nominee.projectsWithoutNominee ?? []).length > 6 && (
                          <Badge variant="outline" className="text-[10px] bg-white text-slate-500 border-slate-200">
                            +{(nominee.projectsWithoutNominee ?? []).length - 6} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Active workflows list */}
                  {(nominee.activeWorkflows ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Active Workflows</p>
                      {(nominee.activeWorkflows ?? []).slice(0, 4).map((w: any) => (
                        <div key={w.id} className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-slate-50 border border-slate-100">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{w.projectName ?? "Project"}</p>
                            <p className="text-[10px] text-slate-400">
                              Nominee: {w.nomineeName} · {ago(w.createdAt)}
                            </p>
                          </div>
                          {nomineeWorkflowBadge(w.activationType, w.status)}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Missing developer cases */}
                  {(nominee.missingDeveloperCases ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Missing Developer Cases</p>
                      {(nominee.missingDeveloperCases ?? []).slice(0, 3).map((c: any) => (
                        <div key={c.id} className={`flex items-center gap-2 px-2.5 py-2 rounded-md border ${c.isNomineeEligible ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-100"}`}>
                          <Search className={`w-3.5 h-3.5 shrink-0 ${c.isNomineeEligible ? "text-red-500" : "text-slate-400"}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{c.projectName}</p>
                            <p className="text-[10px] text-slate-400">
                              GD: {c.gdNumber ?? "—"} · Day {c.daysElapsed ?? 0}/45
                              {c.isNomineeEligible ? " · Eligible for Activation" : ""}
                            </p>
                          </div>
                          {c.isNomineeEligible && (
                            <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200 shrink-0">
                              Act. Eligible
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recently activated */}
                  {(nominee.recentActivations ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Recently Activated (30d)</p>
                      {(nominee.recentActivations ?? []).slice(0, 3).map((a: any) => (
                        <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-green-50 border border-green-100">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-green-800 truncate">{a.projectName}</p>
                            <p className="text-[10px] text-green-600">
                              {a.nomineeName} · {ago(a.activatedAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Prematurity Succession ── */}
        {(prematurity?.totalParticipations ?? 0) > 0 && (
          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4 px-4">
              <SectionHeader
                icon={<Sprout className="w-3.5 h-3.5" />}
                title="Prematurity Succession Monitoring"
                sub="Claimant participation, OTP contributions, and disputed accumulation"
                href="/prematurity-succession"
              />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-2xl font-bold text-slate-800">{prematurity?.totalParticipations ?? 0}</p>
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-1">Total Participations</p>
                </div>
                <div className={`text-center rounded-lg border p-3 ${(prematurity?.disputedParticipations ?? 0) > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                  <p className={`text-2xl font-bold ${(prematurity?.disputedParticipations ?? 0) > 0 ? "text-red-700" : "text-slate-800"}`}>{prematurity?.disputedParticipations ?? 0}</p>
                  <p className="text-[10px] font-medium uppercase tracking-wider mt-1 text-slate-500">Disputed</p>
                </div>
                <div className={`text-center rounded-lg border p-3 ${(prematurity?.pendingOtpCount ?? 0) > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                  <p className={`text-2xl font-bold ${(prematurity?.pendingOtpCount ?? 0) > 0 ? "text-amber-700" : "text-slate-800"}`}>{prematurity?.pendingOtpCount ?? 0}</p>
                  <p className="text-[10px] font-medium uppercase tracking-wider mt-1 text-slate-500">OTP Pending</p>
                </div>
                <div className={`text-center rounded-lg border p-3 ${(prematurity?.totalAccumulatedAmount ?? 0) > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                  <p className={`text-xl font-bold ${(prematurity?.totalAccumulatedAmount ?? 0) > 0 ? "text-amber-700" : "text-slate-800"}`}>
                    ₹{Number(prematurity?.totalAccumulatedAmount ?? 0).toLocaleString("en-IN")}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wider mt-1 text-slate-500">Accumulated (Disputed)</p>
                </div>
              </div>

              {(prematurity?.disputedParticipations ?? 0) > 0 || (prematurity?.pendingOtpCount ?? 0) > 0 ? (
                <div className="mt-3 flex justify-end">
                  <Link href="/prematurity-succession">
                    <Button variant="outline" size="sm" className="text-xs gap-1.5">
                      Manage Succession <ArrowRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* ── Ownership History Timeline ── */}
        <Card className="border-slate-200">
          <CardHeader className="pb-2 pt-4 px-4">
            <SectionHeader
              icon={<Activity className="w-3.5 h-3.5" />}
              title="Ownership Continuity Overview"
              sub="Current equity distribution across all active projects"
            />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {ownershipQ.isLoading && <Skeleton className="h-48 w-full" />}
            {!ownershipQ.isLoading && ownership.length === 0 && (
              <EmptyState icon={<Activity className="w-7 h-7" />} text="No ownership data available" />
            )}
            {ownership.length > 0 && (
              <div className="space-y-3">
                {ownership.map((proj: any) => {
                  const partners: any[] = proj.partners ?? [];
                  const total = partners.reduce((s: number, p: any) => s + parseFloat(p.ownershipPct ?? "0"), 0);
                  return (
                    <div key={proj.projectId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-700">{proj.projectName}</p>
                          <Badge variant="outline" className={`text-[10px] ${proj.isFrozen ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                            {proj.isFrozen ? <><Lock className="w-2.5 h-2.5 mr-1" />Frozen</> : "Live"}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-slate-400">{partners.length} partner(s) · {total.toFixed(1)}% accounted</p>
                      </div>
                      {/* Stacked percentage bar */}
                      <div className="flex h-5 rounded-full overflow-hidden gap-px bg-slate-200">
                        {partners.slice(0, 6).map((p: any, i: number) => {
                          const pct = parseFloat(p.ownershipPct ?? "0");
                          return (
                            <div
                              key={p.partnerId ?? i}
                              title={`${p.partnerName}: ${pct.toFixed(2)}%`}
                              className="h-full transition-all"
                              style={{
                                width: `${pct}%`,
                                background: CHART_PALETTE[i % CHART_PALETTE.length],
                                minWidth: pct > 0 ? "2px" : "0",
                              }}
                            />
                          );
                        })}
                        {total < 100 && (
                          <div
                            title={`Unallocated: ${(100 - total).toFixed(2)}%`}
                            className="h-full bg-slate-200"
                            style={{ width: `${100 - total}%` }}
                          />
                        )}
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {partners.slice(0, 6).map((p: any, i: number) => (
                          <span key={p.partnerId ?? i} className="flex items-center gap-1 text-[9px] text-slate-500">
                            <span
                              className="inline-block w-2 h-2 rounded-sm"
                              style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }}
                            />
                            {p.partnerName?.split(" ")[0] ?? "Partner"} {parseFloat(p.ownershipPct ?? "0").toFixed(1)}%
                          </span>
                        ))}
                        {partners.length > 6 && (
                          <span className="text-[9px] text-slate-400">+{partners.length - 6} more</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Quick links footer ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pt-1">
          {[
            { href: "/ownership", label: "Ownership Guidance", icon: <Scale className="w-3.5 h-3.5" /> },
            { href: "/ownership-transfers", label: "Share Transfers", icon: <ArrowLeftRight className="w-3.5 h-3.5" /> },
            { href: "/inheritance-claims", label: "Inheritance Claims", icon: <Gavel className="w-3.5 h-3.5" /> },
            { href: "/nominee-succession", label: "Nominee Succession", icon: <UserCheck className="w-3.5 h-3.5" /> },
            { href: "/prematurity-succession", label: "Succession Workflow", icon: <Sprout className="w-3.5 h-3.5" /> },
          ].map((l) => (
            <Link key={l.href} href={l.href}>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer">
                <div className="text-slate-500">{l.icon}</div>
                <p className="text-xs text-slate-600 font-medium truncate">{l.label}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
