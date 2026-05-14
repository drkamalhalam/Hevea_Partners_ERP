/**
 * NomineeSuccessionDashboard
 *
 * Global view of all nominee succession activation workflows across all projects.
 * Covers Death-Based, Living Handover, and Missing Developer pathways.
 * Tracks governance authority transfers (NOT ownership).
 */

import { useState } from "react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import {
  useGetNomineeSuccessionDashboard,
  useListNomineeAuthorityLog,
  useListMissingDeveloperCases,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  ShieldCheck,
  UserCheck,
  Clock,
  AlertTriangle,
  FileText,
  Activity,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  User,
  Heart,
  Handshake,
  Search,
  CalendarClock,
  MapPin,
  ScrollText,
  ClipboardList,
  Info,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivationType = "death_based" | "voluntary_handover";
type WorkflowStatus = "pending_verification" | "pending_otp" | "activated" | "rejected" | "cancelled";

// ── Helpers ────────────────────────────────────────────────────────────────────

function activationTypeBadge(type: ActivationType) {
  if (type === "death_based") {
    return (
      <Badge variant="outline" className="text-xs bg-slate-50 text-slate-700 border-slate-300 gap-1">
        <Heart className="w-3 h-3" /> Death-Based
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200 gap-1">
      <Handshake className="w-3 h-3" /> Living Handover
    </Badge>
  );
}

function workflowStatusBadge(status: WorkflowStatus) {
  const map: Record<string, { label: string; className: string }> = {
    pending_verification: { label: "Pending Verification", className: "bg-amber-50 text-amber-700 border-amber-200" },
    pending_otp: { label: "Awaiting OTP", className: "bg-sky-50 text-sky-700 border-sky-200" },
    activated: { label: "Activated", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
    cancelled: { label: "Cancelled", className: "bg-gray-50 text-gray-500 border-gray-200" },
  };
  const cfg = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>;
}

function missingStatusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: "Waiting Period", className: "bg-amber-50 text-amber-700 border-amber-200" },
    nominee_eligible: { label: "Nominee Eligible", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    resolved: { label: "Resolved", className: "bg-sky-50 text-sky-700 border-sky-200" },
    cancelled: { label: "Cancelled", className: "bg-gray-50 text-gray-500 border-gray-200" },
  };
  const cfg = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>;
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tab nav ────────────────────────────────────────────────────────────────────

type Tab = "dashboard" | "workflows" | "missing" | "authority-log";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <Activity className="w-3.5 h-3.5" /> },
  { id: "workflows", label: "Active Workflows", icon: <ClipboardList className="w-3.5 h-3.5" /> },
  { id: "missing", label: "Missing Developer", icon: <Search className="w-3.5 h-3.5" /> },
  { id: "authority-log", label: "Authority Log", icon: <ScrollText className="w-3.5 h-3.5" /> },
];

// ── Dashboard tab ──────────────────────────────────────────────────────────────

function DashboardTab() {
  const { data, isLoading, refetch, isFetching } = useGetNomineeSuccessionDashboard();

  if (isLoading) {
    return <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  }

  const kpis = data?.kpis;
  const activeWorkflows = data?.activeWorkflows ?? [];
  const missingCases = data?.missingDeveloperCases ?? [];
  const recentActivations = data?.recentActivations ?? [];
  const projectsWithoutNominee = data?.projectsWithoutNominee ?? [];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard
          icon={<ClipboardList className="w-5 h-5 text-amber-700" />}
          label="Active Workflows"
          value={kpis?.totalActiveWorkflows ?? 0}
          color="bg-amber-100"
        />
        <KpiCard
          icon={<Search className="w-5 h-5 text-red-700" />}
          label="Missing Developer Cases"
          value={kpis?.missingDeveloperCases ?? 0}
          color="bg-red-100"
        />
        <KpiCard
          icon={<UserCheck className="w-5 h-5 text-emerald-700" />}
          label="Nominees Eligible"
          value={kpis?.nomineeEligibleCases ?? 0}
          color="bg-emerald-100"
        />
        <KpiCard
          icon={<CheckCircle2 className="w-5 h-5 text-sky-700" />}
          label="Activated (30 days)"
          value={kpis?.recentlyActivated ?? 0}
          color="bg-sky-100"
        />
      </div>

      {/* Sub-KPIs row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3 flex items-center gap-2">
            <Heart className="w-4 h-4 text-slate-500 shrink-0" />
            <div>
              <p className="font-semibold">{kpis?.deathBasedPending ?? 0}</p>
              <p className="text-xs text-muted-foreground">Death-Based Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 flex items-center gap-2">
            <Handshake className="w-4 h-4 text-sky-500 shrink-0" />
            <div>
              <p className="font-semibold">{kpis?.voluntaryHandoverPending ?? 0}</p>
              <p className="text-xs text-muted-foreground">Handover OTP Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
            <div>
              <p className="font-semibold">{kpis?.projectsWithoutNominee ?? 0}</p>
              <p className="text-xs text-muted-foreground">Projects Without Nominee</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {(activeWorkflows.length > 0 || missingCases.some((c: any) => c.isNomineeEligible)) && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Action Required
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-2">
            {activeWorkflows.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-amber-100">
                <div className="flex items-center gap-2 min-w-0">
                  {w.activationType === "death_based"
                    ? <Heart className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    : <Handshake className="w-3.5 h-3.5 text-sky-500 shrink-0" />}
                  <span className="text-xs font-medium truncate">{w.projectName ?? w.projectId}</span>
                  <span className="text-xs text-muted-foreground">— {w.nomineeName}</span>
                  {workflowStatusBadge(w.status)}
                </div>
                <Button size="sm" variant="outline" className="text-xs shrink-0 gap-1 h-7" asChild>
                  <Link href={`/projects/${w.projectId}/nominee/activation`}>
                    Manage <ArrowRight className="w-3 h-3" />
                  </Link>
                </Button>
              </div>
            ))}
            {missingCases.filter((c: any) => c.isNomineeEligible).map((c: any) => (
              <div key={c.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-emerald-100">
                <div className="flex items-center gap-2 min-w-0">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="text-xs font-medium truncate">{c.projectName ?? c.projectId}</span>
                  <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">Nominee Eligible</Badge>
                </div>
                <Button size="sm" variant="outline" className="text-xs shrink-0 gap-1 h-7" asChild>
                  <Link href={`/projects/${c.projectId}`}>
                    View <ArrowRight className="w-3 h-3" />
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent activations */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Recent Authority Transfers</h3>
        {recentActivations.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No activations in the last 30 days.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentActivations.map((a: any) => (
              <Card key={a.id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1.5 rounded-full bg-emerald-100">
                        <ShieldCheck className="w-4 h-4 text-emerald-700" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{a.projectName ?? a.projectId}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.nomineeName} · {a.activationType === "death_based" ? "Death-Based" : "Living Handover"} ·{" "}
                          {a.activatedAt ? formatDistanceToNow(new Date(a.activatedAt), { addSuffix: true }) : "—"}
                        </p>
                      </div>
                    </div>
                    {activationTypeBadge(a.activationType)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Projects without nominees */}
      {projectsWithoutNominee.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/30">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-orange-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {projectsWithoutNominee.length} Project{projectsWithoutNominee.length > 1 ? "s" : ""} Without a Registered Nominee
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex flex-wrap gap-2">
              {projectsWithoutNominee.map((p: any) => (
                <Button key={p.id} variant="outline" size="sm" className="text-xs h-7 gap-1" asChild>
                  <Link href={`/projects/${p.id}`}>{p.name} <ArrowRight className="w-3 h-3" /></Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Governance notice */}
      <Card className="border-sky-200 bg-sky-50/30">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-800 leading-relaxed">
              <strong>Governance Authority Only.</strong> Nominee activation transfers operational governance authority over a project —
              it does not transfer ownership, equity, or financial entitlements. All ownership matters require a separate
              inheritance settlement process with appropriate legal documentation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Active Workflows tab ───────────────────────────────────────────────────────

function WorkflowsTab() {
  const { data, isLoading, refetch, isFetching } = useGetNomineeSuccessionDashboard();
  const workflows = data?.activeWorkflows ?? [];

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;
  }

  if (workflows.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <p className="font-semibold">No active workflows</p>
          <p className="text-sm text-muted-foreground mt-1">All nominee activation workflows are completed or none have been initiated.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{workflows.length} active workflow{workflows.length !== 1 ? "s" : ""} pending action</p>
        <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      {workflows.map((w: any) => (
        <Card key={w.id} className="hover:border-primary/40 transition-colors">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2 flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate">{w.projectName ?? w.projectId}</h3>
                  {activationTypeBadge(w.activationType)}
                  {workflowStatusBadge(w.status)}
                </div>

                {/* Details */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" /> Nominee: <strong className="text-foreground">{w.nomineeName}</strong>
                  </span>
                  {w.projectLocation && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {w.projectLocation}
                    </span>
                  )}
                  {w.createdByName && <span>Initiated by {w.createdByName}</span>}
                  {w.createdAt && <span>{formatDistanceToNow(new Date(w.createdAt), { addSuffix: true })}</span>}
                </div>

                {/* OTP expiry warning */}
                {w.status === "pending_otp" && w.otpExpiresAt && new Date(w.otpExpiresAt) > new Date() && (
                  <div className="flex items-center gap-1.5 text-xs text-sky-700">
                    <Clock className="w-3 h-3" />
                    OTP expires {formatDistanceToNow(new Date(w.otpExpiresAt), { addSuffix: true })}
                  </div>
                )}
                {w.status === "pending_otp" && w.otpExpiresAt && new Date(w.otpExpiresAt) <= new Date() && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertTriangle className="w-3 h-3" /> OTP expired — resend required
                  </div>
                )}

                {w.governanceRemarks && (
                  <p className="text-xs text-muted-foreground italic">"{w.governanceRemarks}"</p>
                )}
              </div>

              <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" asChild>
                <Link href={`/projects/${w.projectId}/nominee/activation`}>
                  Manage <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Missing Developer tab ──────────────────────────────────────────────────────

function MissingDeveloperTab() {
  const [includeResolved, setIncludeResolved] = useState(false);
  const { data: cases, isLoading, refetch, isFetching } = useListMissingDeveloperCases(
    { includeResolved },
    { query: { queryKey: ["missing-developer-cases", includeResolved] } }
  );

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>;
  }

  const items = (cases as any[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {items.length} case{items.length !== 1 ? "s" : ""} {includeResolved ? "(including resolved)" : "(active only)"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant={includeResolved ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIncludeResolved(!includeResolved)}
          >
            {includeResolved ? "Hide Resolved" : "Show Resolved"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* 45-day rule explanation */}
      <Card className="border-amber-200 bg-amber-50/30">
        <CardContent className="pt-3 pb-3">
          <div className="flex gap-2">
            <CalendarClock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <strong>45-Day Waiting Period:</strong> Once a General Diary (GD) entry is filed, the nominee becomes eligible for governance
              authority activation after 45 calendar days. This waiting period ensures the developer has an opportunity to resume operations.
            </p>
          </div>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No missing developer cases found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((c: any) => {
            const pct = Math.min(100, Math.round((c.daysElapsed / 45) * 100));
            return (
              <Card key={c.id} className={c.isNomineeEligible ? "border-emerald-200" : "hover:border-primary/30 transition-colors"}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-2 flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{c.projectName ?? c.projectId}</h3>
                        {missingStatusBadge(c.status)}
                      </div>

                      {/* GD details */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          GD: {c.gdNumber ? `#${c.gdNumber}` : "Filed"} on {format(new Date(c.gdEntryDate + "T00:00:00"), "dd MMM yyyy")}
                        </span>
                        {c.reportedByName && <span>Reported by {c.reportedByName}</span>}
                        {c.projectLocation && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {c.projectLocation}
                          </span>
                        )}
                      </div>

                      {/* Countdown bar */}
                      {c.isActive && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Waiting period: {c.daysElapsed}/45 days elapsed</span>
                            {c.isNomineeEligible ? (
                              <span className="text-emerald-600 font-medium">Eligible for activation</span>
                            ) : (
                              <span className="text-muted-foreground">{Math.max(0, c.daysRemaining)} days remaining</span>
                            )}
                          </div>
                          <Progress value={pct} className={`h-1.5 ${c.isNomineeEligible ? "[&>div]:bg-emerald-500" : "[&>div]:bg-amber-500"}`} />
                        </div>
                      )}

                      {/* Eligible callout */}
                      {c.isNomineeEligible && c.isActive && (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                          <UserCheck className="w-3.5 h-3.5" /> Nominee is eligible — governance authority activation may proceed
                        </div>
                      )}

                      {c.remarks && <p className="text-xs text-muted-foreground italic">"{c.remarks}"</p>}
                      {c.resolutionNotes && (
                        <p className="text-xs text-muted-foreground">Resolution: {c.resolutionNotes}</p>
                      )}
                    </div>

                    <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" asChild>
                      <Link href={`/projects/${c.projectId}`}>
                        View Project <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Authority Log tab ──────────────────────────────────────────────────────────

function AuthorityLogTab() {
  const { data, isLoading, refetch, isFetching } = useListNomineeAuthorityLog();
  const records = (data as any[]) ?? [];

  if (isLoading) {
    return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">{records.length} authority transfer{records.length !== 1 ? "s" : ""} recorded</p>
        <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Immutability notice */}
      <Card className="border-sky-200 bg-sky-50/30">
        <CardContent className="pt-3 pb-3">
          <div className="flex gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-800">
              <strong>Immutable Audit Trail.</strong> This log records all governance authority transfers. Entries cannot be deleted or modified.
              Each entry reflects the verified activation of a nominee's operational authority over the project — not ownership.
            </p>
          </div>
        </CardContent>
      </Card>

      {records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ScrollText className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No authority transfers recorded yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((r: any) => (
            <Card key={r.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-4 flex-wrap">
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="p-2 rounded-full bg-emerald-100">
                      <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    </div>
                  </div>

                  <div className="space-y-1.5 flex-1 min-w-0">
                    {/* Project + nominee */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.projectName ?? r.projectId}</span>
                      {activationTypeBadge(r.activationType)}
                    </div>

                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium">{r.nomineeName}</span>
                      <span className="text-muted-foreground">assumed governance authority</span>
                    </div>

                    {/* Activation details */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {r.activatedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(r.activatedAt), "dd MMM yyyy, HH:mm")}
                        </span>
                      )}
                      {r.activatedByName && <span>Activated by {r.activatedByName}</span>}
                      {r.activationType === "death_based" && r.verifiedByName && (
                        <span>Doc verified by {r.verifiedByName}</span>
                      )}
                      {r.activationType === "voluntary_handover" && r.otpVerifiedByName && (
                        <span>OTP confirmed by {r.otpVerifiedByName}</span>
                      )}
                      {r.projectLocation && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {r.projectLocation}
                        </span>
                      )}
                    </div>

                    {/* Docs */}
                    <div className="flex gap-2 flex-wrap">
                      {r.deathCertificateUrl && (
                        <a href={r.deathCertificateUrl} target="_blank" rel="noopener noreferrer">
                          <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-muted">
                            <FileText className="w-3 h-3" /> Death Certificate
                          </Badge>
                        </a>
                      )}
                      {r.declarationDeedUrl && (
                        <a href={r.declarationDeedUrl} target="_blank" rel="noopener noreferrer">
                          <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-muted">
                            <FileText className="w-3 h-3" /> Declaration Deed
                          </Badge>
                        </a>
                      )}
                    </div>

                    {r.verificationNotes && (
                      <p className="text-xs text-muted-foreground italic">"{r.verificationNotes}"</p>
                    )}
                    {r.governanceRemarks && (
                      <p className="text-xs text-muted-foreground">Remarks: {r.governanceRemarks}</p>
                    )}
                  </div>

                  <Button size="sm" variant="ghost" className="text-xs shrink-0 gap-1 h-7" asChild>
                    <Link href={`/projects/${r.projectId}`}>
                      View Project <ArrowRight className="w-3 h-3" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function NomineeSuccessionDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold font-serif tracking-tight">Nominee Succession</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Governance authority succession system — manage nominee activation workflows, missing developer cases,
          and the operational authority transfer audit log.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "dashboard" && <DashboardTab />}
        {activeTab === "workflows" && <WorkflowsTab />}
        {activeTab === "missing" && <MissingDeveloperTab />}
        {activeTab === "authority-log" && <AuthorityLogTab />}
      </div>
    </div>
  );
}
