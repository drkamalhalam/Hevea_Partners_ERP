import { useUser } from "@clerk/react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GovernanceSummary } from "@workspace/api-client-react";
import { GovernanceAlertPanel, GovernanceStatusBadge } from "@/components/governance";
import { Link } from "wouter";
import { format, isThisMonth } from "date-fns";
import {
  Trees,
  Wallet,
  Receipt,
  ClipboardCheck,
  CheckSquare,
  Warehouse,
  FileSignature,
  MapPin,
  Scale,
  PackageOpen,
  Truck,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Activity,
  AlertCircle,
  Clock,
  TrendingUp,
  PieChart,
  Users,
  Archive,
  ShieldAlert,
  Sprout,
  Lock,
  UserX,
  CheckCircle2,
  FlaskConical,
  UserCog,
  Leaf,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useRole, ROLE_LABELS } from "@/contexts/RoleContext";
import {
  useGetDashboardSummary,
  useGetRecentActivity,
  useGetRevenueStats,
  useGetStockSummary,
  useListProjects,
  useListProductionRecords,
  useGetMyPortfolio,
  useListAgreements,
  useListUsers,
  useGetGovernanceSummary,
} from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Mock / placeholder data ───────────────────────────────────────────────

const MOCK_REVENUE = [
  { month: "Jul", revenue: 142000, expenditure: 48000 },
  { month: "Aug", revenue: 165000, expenditure: 52000 },
  { month: "Sep", revenue: 158000, expenditure: 51000 },
  { month: "Oct", revenue: 180000, expenditure: 55000 },
  { month: "Nov", revenue: 172000, expenditure: 49000 },
  { month: "Dec", revenue: 195000, expenditure: 60000 },
  { month: "Jan", revenue: 210000, expenditure: 63000 },
  { month: "Feb", revenue: 202000, expenditure: 58000 },
  { month: "Mar", revenue: 225000, expenditure: 67000 },
  { month: "Apr", revenue: 218000, expenditure: 64000 },
  { month: "May", revenue: 245000, expenditure: 72000 },
];

const MOCK_PROJECT_PERF = [
  { project: "Manu V.", production: 1840, sales: 1620, target: 2000 },
  { project: "Gandacherra", production: 960, sales: 810, target: 1200 },
  { project: "Ambassa", production: 2480, sales: 2250, target: 2400 },
];

const MOCK_APPROVALS = [
  { id: 1, title: "Agreement renewal", detail: "Manu Valley Plantation", due: "Overdue", priority: "high" as const },
  { id: 2, title: "Land survey document", detail: "Gandacherra Block B", due: "Due today", priority: "medium" as const },
  { id: 3, title: "Q1 2026 report sign-off", detail: "All projects", due: "In 3 days", priority: "low" as const },
  { id: 4, title: "New partner agreement", detail: "Ambassa Northern Plot", due: "In 5 days", priority: "low" as const },
];

const MOCK_TASKS = [
  { id: 1, title: "Update production logs for May", module: "Production", priority: "high" as const },
  { id: 2, title: "Review expenditure report", module: "Finance", priority: "medium" as const },
  { id: 3, title: "Upload boundary survey — Manu Valley", module: "Documents", priority: "high" as const },
];

const PRIORITY_COLORS = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  developing: "bg-amber-100 text-amber-700",
  maturing: "bg-emerald-100 text-emerald-700",
  tapping: "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-600",
};

// ── Shared helper components ──────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function WelcomeHeader() {
  const { user } = useUser();
  const { role } = useRole();
  return (
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-lg font-bold text-foreground">
          {getGreeting()},{" "}
          <span className="text-emerald-700">{user?.firstName ?? "Partner"}</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {format(new Date(), "EEEE, d MMMM yyyy")} · {ROLE_LABELS[role]}
        </p>
      </div>
      <Badge
        variant="outline"
        className="text-[11px] gap-1.5 py-1 px-2.5 border-emerald-200 text-emerald-700 bg-emerald-50"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
        All Systems Online
      </Badge>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  badge,
  children,
  minHeight = 200,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
  minHeight?: number;
}) {
  return (
    <Card className="border border-gray-200 shadow-none bg-white">
      <CardHeader className="pb-2 px-5 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {badge && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground flex-shrink-0">
              {badge}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5" style={{ minHeight }}>
        {children}
      </CardContent>
    </Card>
  );
}

function InfoPanel({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  iconColor?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border border-gray-200 shadow-none bg-white h-full">
      <CardHeader className="pb-2 px-5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {Icon && (
              <div className={`p-1.5 rounded-lg ${iconColor ?? "bg-gray-100 text-gray-600"}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            )}
            <div>
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
              {subtitle && (
                <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">{children}</CardContent>
    </Card>
  );
}

function ActivityPanel() {
  const { data: activities, isLoading } = useGetRecentActivity();
  return (
    <InfoPanel
      title="Recent Activity"
      subtitle="Latest system events"
      icon={Activity}
      iconColor="bg-blue-50 text-blue-600"
      action={
        <Link href="/notifications">
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground">
            All <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="h-2 w-2 rounded-full mt-1.5" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : activities && activities.length > 0 ? (
        <div className="space-y-0 overflow-y-auto max-h-[220px] pr-1">
          {activities.slice(0, 8).map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug truncate">{a.description}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {format(new Date(a.createdAt), "d MMM · h:mm a")}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
          <Activity className="w-8 h-8 mb-2 opacity-25" />
          <p className="text-xs">No recent activity</p>
        </div>
      )}
    </InfoPanel>
  );
}

function ProjectSummaryTable({ compact }: { compact?: boolean }) {
  const { data: projects = [], isLoading } = useListProjects();
  const { data: stock = [] } = useGetStockSummary();

  return (
    <Card className="border border-gray-200 shadow-none bg-white">
      <CardHeader className="pb-2 px-5 pt-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-sm font-semibold">Project Summary</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {compact ? "Your assigned plantation projects" : "All plantation projects under management"}
            </p>
          </div>
          <Link href="/projects">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              {compact ? "View Projects" : "Manage Projects"} <ArrowUpRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-5 py-2.5 font-semibold text-muted-foreground">Project</th>
                <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground hidden sm:table-cell">Location</th>
                <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden md:table-cell">Land Area</th>
                {!compact && (
                  <>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden lg:table-cell">Est. Revenue</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden lg:table-cell">Expenditure</th>
                  </>
                )}
                <th className="text-right px-5 py-2.5 font-semibold text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-5 py-3" colSpan={compact ? 5 : 7}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={compact ? 5 : 7} className="text-center py-8 text-muted-foreground text-sm">
                    No projects assigned
                  </td>
                </tr>
              ) : (
                projects.map((p, idx) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50/70 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {String(idx + 1).padStart(2, "0")}
                        </div>
                        <span className="truncate max-w-[140px]">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{p.district ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                      {p.landArea ? `${p.landArea} kani` : "—"}
                    </td>
                    {!compact && (
                      <>
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <span className="font-medium text-emerald-700">₹{((p.landArea ?? 10) * 12).toFixed(0)}k</span>
                          <span className="text-muted-foreground text-[10px] ml-0.5">est.</span>
                        </td>
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <span className="font-medium text-rose-600">₹{((p.landArea ?? 10) * 4).toFixed(0)}k</span>
                          <span className="text-muted-foreground text-[10px] ml-0.5">est.</span>
                        </td>
                      </>
                    )}
                    <td className="px-5 py-3 text-right">
                      <Link href={`/projects/${p.id}`}>
                        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-primary">
                          View <ChevronRight className="w-3 h-3" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Project Health Panel (Developer helper) ───────────────────────────────

const LIFECYCLE_PILL: Record<string, { label: string; className: string }> = {
  prematurity: { label: "Pre", className: "bg-sky-100 text-sky-700" },
  mature_production: { label: "Mature", className: "bg-emerald-100 text-emerald-700" },
  closed: { label: "Closed", className: "bg-gray-100 text-gray-600" },
};

function ProjectHealthPanel({
  projects,
  governance,
  isLoading,
}: {
  projects: Array<{ id: string; name: string; status: string; lifecycleStatus?: string | null }>;
  governance: GovernanceSummary | undefined;
  isLoading: boolean;
}) {
  const govMap = useMemo(
    () => new Map(governance?.projectAlerts.map((a) => [a.projectId, a]) ?? []),
    [governance],
  );
  const sorted = useMemo(() => {
    const ORDER: Record<string, number> = { attention_required: 0, incomplete: 1, pending: 2, complete: 3 };
    return [...projects].sort((a, b) => {
      const as = govMap.get(a.id)?.status ?? "complete";
      const bs = govMap.get(b.id)?.status ?? "complete";
      return (ORDER[as] ?? 3) - (ORDER[bs] ?? 3);
    });
  }, [projects, govMap]);

  return (
    <InfoPanel
      title="Project Health Summary"
      subtitle="Governance status per project"
      icon={Trees}
      iconColor="bg-blue-50 text-blue-600"
      action={
        <Link href="/projects">
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
            All Projects <ArrowUpRight className="w-3 h-3" />
          </Button>
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
          <Trees className="w-7 h-7 mb-1.5 opacity-25" />
          <p className="text-xs">No projects assigned</p>
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[280px] pr-0.5">
          {sorted.map((p) => {
            const alert = govMap.get(p.id);
            const govStatus = alert?.status ?? "complete";
            return (
              <div key={p.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link href={`/projects/${p.id}`}>
                      <p className="text-xs font-medium hover:text-primary cursor-pointer truncate">{p.name}</p>
                    </Link>
                    {p.lifecycleStatus && LIFECYCLE_PILL[p.lifecycleStatus] && (
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${LIFECYCLE_PILL[p.lifecycleStatus].className}`}>
                        {LIFECYCLE_PILL[p.lifecycleStatus].label}
                      </span>
                    )}
                  </div>
                  {alert && alert.issues.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {alert.issues[0].message}
                      {alert.issues.length > 1 ? ` · +${alert.issues.length - 1} more` : ""}
                    </p>
                  )}
                </div>
                <GovernanceStatusBadge status={govStatus} size="xs" />
              </div>
            );
          })}
        </div>
      )}
    </InfoPanel>
  );
}

// ── Closure Pending Panel (Admin/Developer helper) ────────────────────────

type PendingClosureEntry = {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  initiatedByName: string | null;
  initiatedAt: string;
  closureReason: string;
  otpSentAt: string | null;
};

function ClosurePendingPanel() {
  const { data = [], isLoading } = useQuery<PendingClosureEntry[]>({
    queryKey: ["projects", "closure", "pending"],
    queryFn: () =>
      fetch("/api/projects/closure/pending", { credentials: "include" }).then((r) => r.json()),
    staleTime: 60_000,
  });

  if (isLoading || data.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-base flex items-center gap-2">
          <Archive className="w-4 h-4 text-amber-600" />
          Pending Project Closures
          <span className="ml-1 bg-amber-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full">
            {data.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {data.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{w.projectName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {w.closureReason} · by {w.initiatedByName ?? "unknown"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    w.status === "pending_acknowledgment"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {w.status === "pending_acknowledgment" ? "Awaiting OTP" : "Acknowledged"}
                </span>
                <Link href={`/projects/${w.projectId}/closure`}>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                    Review
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Governance Task Center types ──────────────────────────────────────────

type GovernanceTasks = {
  lifecycleBreakdown: {
    prematurity: number;
    mature_production: number;
    closed: number;
    total: number;
  };
  pendingMaturityDeclarations: Array<{
    declarationId: string;
    projectId: string;
    projectName: string;
    status: string;
    initiatedByName: string | null;
    createdAt: string;
    totalVerifications: number;
    verifiedCount: number;
  }>;
  pendingNomineeActivations: Array<{
    workflowId: string;
    projectId: string;
    projectName: string;
    activationType: string;
    status: string;
    createdAt: string;
  }>;
  pendingClosureAcknowledgments: Array<{
    workflowId: string;
    projectId: string;
    projectName: string;
    status: string;
    initiatedByName: string | null;
    initiatedAt: string;
  }>;
  missingDeveloperCases: Array<{
    caseId: string;
    projectId: string;
    projectName: string;
    status: string;
    gdEntryDate: string;
    daysElapsed: number;
    daysRemaining: number;
    isNomineeEligible: boolean;
  }>;
};

// ── Lifecycle Analytics Section ───────────────────────────────────────────

function LifecycleAnalyticsSection({
  projects,
  isLoading,
}: {
  projects: Array<{ lifecycleStatus?: string | null }>;
  isLoading: boolean;
}) {
  const { data: tasks } = useQuery<GovernanceTasks>({
    queryKey: ["governance", "tasks"],
    queryFn: () =>
      fetch("/api/governance/tasks", { credentials: "include" }).then((r) => r.json()),
    staleTime: 60_000,
  });

  const prematurity = projects.filter((p) => !p.lifecycleStatus || p.lifecycleStatus === "prematurity").length;
  const mature = projects.filter((p) => p.lifecycleStatus === "mature_production").length;
  const closed = projects.filter((p) => p.lifecycleStatus === "closed").length;
  const total = projects.length;
  const missingDevCount = tasks?.missingDeveloperCases?.length ?? 0;

  if (total === 0 && !isLoading) return null;

  const barSegments: Array<{ value: number; color: string }> = [
    { value: prematurity, color: "bg-sky-400" },
    { value: mature, color: "bg-emerald-500" },
    { value: closed, color: "bg-gray-400" },
  ].filter((s) => s.value > 0);

  return (
    <Card className="border border-gray-200 shadow-none bg-white">
      <CardHeader className="pb-3 px-5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Trees className="w-4 h-4 text-emerald-600" />
              Project Lifecycle Overview
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Distribution across plantation phases
            </p>
          </div>
          <Link href="/projects">
            <Button variant="outline" size="sm" className="h-6 text-xs gap-1 flex-shrink-0">
              All Projects <ArrowUpRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-full rounded-full" />
            <div className="grid grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          </div>
        ) : (
          <>
            {/* Segmented bar */}
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-gray-100">
              {total === 0 ? (
                <div className="flex-1 bg-gray-200 rounded-full" />
              ) : (
                barSegments.map((seg, i) => (
                  <div
                    key={i}
                    className={`${seg.color} transition-all`}
                    style={{ flex: seg.value }}
                  />
                ))
              )}
            </div>

            {/* Phase cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-sky-50 border border-sky-100">
                <Sprout className="w-5 h-5 text-sky-500" />
                <span className="text-2xl font-bold text-sky-700 tabular-nums">{prematurity}</span>
                <span className="text-[10px] font-medium text-sky-600 text-center leading-tight">
                  Prematurity
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <Leaf className="w-5 h-5 text-emerald-500" />
                <span className="text-2xl font-bold text-emerald-700 tabular-nums">{mature}</span>
                <span className="text-[10px] font-medium text-emerald-600 text-center leading-tight">
                  Mature Production
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-gray-50 border border-gray-200">
                <Lock className="w-5 h-5 text-gray-400" />
                <span className="text-2xl font-bold text-gray-600 tabular-nums">{closed}</span>
                <span className="text-[10px] font-medium text-gray-500 text-center leading-tight">
                  Closed
                </span>
              </div>
              <div
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border ${
                  missingDevCount > 0
                    ? "bg-red-50 border-red-200"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <UserX className={`w-5 h-5 ${missingDevCount > 0 ? "text-red-500" : "text-gray-400"}`} />
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    missingDevCount > 0 ? "text-red-700" : "text-gray-600"
                  }`}
                >
                  {missingDevCount}
                </span>
                <span
                  className={`text-[10px] font-medium text-center leading-tight ${
                    missingDevCount > 0 ? "text-red-600" : "text-gray-500"
                  }`}
                >
                  Missing Developer
                </span>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground pt-0.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 flex-shrink-0" />
                Prematurity — trees growing, pre-tapping
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Mature Production — actively producing latex
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400 flex-shrink-0" />
                Closed — project concluded
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Governance Task Center ────────────────────────────────────────────────

function GovernanceTaskCenter() {
  const { data, isLoading, refetch, isFetching } = useQuery<GovernanceTasks>({
    queryKey: ["governance", "tasks"],
    queryFn: () =>
      fetch("/api/governance/tasks", { credentials: "include" }).then((r) => r.json()),
    staleTime: 60_000,
  });

  const totalTasks =
    (data?.pendingMaturityDeclarations?.length ?? 0) +
    (data?.pendingNomineeActivations?.length ?? 0) +
    (data?.pendingClosureAcknowledgments?.length ?? 0) +
    (data?.missingDeveloperCases?.length ?? 0);

  if (isLoading) {
    return (
      <Card className="border border-gray-200 shadow-none bg-white">
        <CardHeader className="pb-3 px-5 pt-4">
          <Skeleton className="h-5 w-56 rounded" />
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </CardContent>
      </Card>
    );
  }

  if (!data || totalTasks === 0) {
    return (
      <Card className="border border-gray-200 shadow-none bg-white">
        <CardContent className="px-5 py-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-700">No pending governance tasks</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              All maturity declarations, nominee activations, closure workflows, and developer assignments are up to date.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs gap-1 text-muted-foreground"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-violet-100 shadow-none bg-white">
      <CardHeader className="pb-3 px-5 pt-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Governance Task Center</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Pending actions requiring review</p>
            </div>
            <Badge className="bg-violet-100 text-violet-700 border-violet-200 text-[10px] ml-1">
              {totalTasks} pending
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.pendingMaturityDeclarations.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                <FlaskConical className="w-3 h-3" />
                {data.pendingMaturityDeclarations.length} Maturity
              </span>
            )}
            {data.pendingNomineeActivations.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                <UserCog className="w-3 h-3" />
                {data.pendingNomineeActivations.length} Nominees
              </span>
            )}
            {data.pendingClosureAcknowledgments.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                <Archive className="w-3 h-3" />
                {data.pendingClosureAcknowledgments.length} Closure
              </span>
            )}
            {data.missingDeveloperCases.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                <UserX className="w-3 h-3" />
                {data.missingDeveloperCases.length} Missing Dev
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-muted-foreground ml-1"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">

        {/* ── Maturity Declarations ── */}
        {data.pendingMaturityDeclarations.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
                Pending Maturity Declarations
              </span>
            </div>
            <div className="space-y-1.5">
              {data.pendingMaturityDeclarations.map((d) => (
                <div
                  key={d.declarationId}
                  className="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{d.projectName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {d.initiatedByName ? `Initiated by ${d.initiatedByName}` : "Awaiting OTP verification"}
                      {d.totalVerifications > 0 && (
                        <span className="ml-1.5">
                          ·{" "}
                          <span className={d.verifiedCount === d.totalVerifications ? "text-emerald-600 font-medium" : ""}>
                            {d.verifiedCount}/{d.totalVerifications} verified
                          </span>
                        </span>
                      )}
                    </p>
                  </div>
                  {d.totalVerifications > 0 && (
                    <div className="flex-shrink-0 w-24">
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-200">
                        <div
                          className="bg-emerald-500 transition-all"
                          style={{ width: `${(d.verifiedCount / d.totalVerifications) * 100}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-center text-muted-foreground mt-0.5">
                        {d.verifiedCount}/{d.totalVerifications}
                      </p>
                    </div>
                  )}
                  <Link href={`/projects/${d.projectId}/maturity`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-shrink-0">
                      Review <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Nominee Activations ── */}
        {data.pendingNomineeActivations.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <UserCog className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">
                Pending Nominee Activations
              </span>
            </div>
            <div className="space-y-1.5">
              {data.pendingNomineeActivations.map((w) => (
                <div
                  key={w.workflowId}
                  className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{w.projectName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {w.activationType === "death_based" ? "Death-based handover" : "Voluntary handover"}
                      <span className="mx-1">·</span>
                      <span className={w.status === "pending_verification" ? "text-amber-600 font-medium" : "text-blue-600 font-medium"}>
                        {w.status === "pending_verification" ? "Pending admin verification" : "Pending OTP confirmation"}
                      </span>
                    </p>
                  </div>
                  <Link href={`/projects/${w.projectId}/nominee/activation`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-shrink-0">
                      Review <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Closure Acknowledgments ── */}
        {data.pendingClosureAcknowledgments.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Archive className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
                Pending Closure Acknowledgments
              </span>
            </div>
            <div className="space-y-1.5">
              {data.pendingClosureAcknowledgments.map((w) => (
                <div
                  key={w.workflowId}
                  className="flex items-center gap-3 rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{w.projectName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {w.initiatedByName ? `Initiated by ${w.initiatedByName}` : "Awaiting acknowledgment"}
                      <span className="mx-1">·</span>
                      <span className={w.status === "pending_acknowledgment" ? "text-amber-600 font-medium" : "text-blue-600 font-medium"}>
                        {w.status === "pending_acknowledgment" ? "Awaiting OTP" : "Acknowledged"}
                      </span>
                    </p>
                  </div>
                  <Link href={`/projects/${w.projectId}/closure`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-shrink-0">
                      Review <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Missing Developer Cases ── */}
        {data.missingDeveloperCases.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <UserX className="w-3.5 h-3.5 text-red-600" />
              <span className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">
                Missing Developer Cases
              </span>
            </div>
            <div className="space-y-1.5">
              {data.missingDeveloperCases.map((c) => (
                <div
                  key={c.caseId}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                    c.isNomineeEligible
                      ? "border-red-200 bg-red-50/50"
                      : "border-orange-100 bg-orange-50/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{c.projectName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      <span className={c.isNomineeEligible ? "text-red-600 font-semibold" : ""}>
                        {c.daysElapsed} of 45 days elapsed
                      </span>
                      {c.isNomineeEligible && (
                        <span className="ml-1.5 text-red-600 font-semibold">
                          · Nominee eligible for activation
                        </span>
                      )}
                      {!c.isNomineeEligible && (
                        <span className="ml-1.5 text-muted-foreground">
                          · {c.daysRemaining} days remaining
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex-shrink-0 w-20">
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-200">
                      <div
                        className={`transition-all ${c.isNomineeEligible ? "bg-red-500" : "bg-orange-400"}`}
                        style={{ width: `${Math.min(100, (c.daysElapsed / 45) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-center text-muted-foreground mt-0.5">
                      {c.daysElapsed}/45 days
                    </p>
                  </div>
                  <Link href={`/projects/${c.projectId}/missing-developer`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 text-xs gap-1 flex-shrink-0 ${
                        c.isNomineeEligible ? "border-red-200 text-red-700 hover:bg-red-50" : ""
                      }`}
                    >
                      View <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Admin Dashboard ───────────────────────────────────────────────────────

function AdminDashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: users = [], isLoading: isLoadingUsers } = useListUsers();
  const { data: governance } = useGetGovernanceSummary();
  const { data: stock = [] } = useGetStockSummary();
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();

  const totalStock = stock.reduce((s, p) => s + p.currentStock, 0);
  const roleBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of users) counts[u.role] = (counts[u.role] ?? 0) + 1;
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [users]);

  const ROLE_BADGE: Record<string, string> = {
    admin: "bg-red-100 text-red-700",
    developer: "bg-violet-100 text-violet-700",
    landowner: "bg-emerald-100 text-emerald-700",
    investor: "bg-blue-100 text-blue-700",
    employee: "bg-amber-100 text-amber-700",
    operational_staff: "bg-gray-100 text-gray-700",
  };

  return (
    <div className="space-y-6 max-w-[1600px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard
            label="Total Projects"
            value={summary?.totalProjects ?? "—"}
            sub={summary ? `${summary.tappingProjectsCount} tapping` : undefined}
            icon={Trees}
            iconColor="bg-blue-50 text-blue-600"
            isLoading={isLoadingSummary}
          />
          <MetricCard
            label="Total Partners"
            value={summary?.totalPartners ?? "—"}
            sub="registered"
            icon={Users}
            iconColor="bg-emerald-50 text-emerald-600"
            isLoading={isLoadingSummary}
          />
          <MetricCard
            label="Agreements"
            value={summary?.totalAgreements ?? "—"}
            sub="active agreements"
            icon={FileSignature}
            iconColor="bg-amber-50 text-amber-600"
            isLoading={isLoadingSummary}
          />
          <MetricCard
            label="System Users"
            value={isLoadingUsers ? "—" : users.length}
            sub={roleBreakdown.length > 0 ? `${roleBreakdown.length} roles` : "all roles"}
            icon={Users}
            iconColor="bg-violet-50 text-violet-600"
            isLoading={isLoadingUsers}
          />
          <MetricCard
            label="Governance Issues"
            value={governance ? governance.totalIssues : "—"}
            sub={governance?.overallStatus === "complete" ? "all checks passed" : governance?.overallStatus?.replace(/_/g, " ") ?? "loading..."}
            icon={AlertCircle}
            iconColor={governance?.totalIssues ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600"}
          />
          <MetricCard
            label="Stock on Hand"
            value={totalStock > 0 ? `${totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg` : "—"}
            sub="current inventory"
            icon={Warehouse}
            iconColor="bg-teal-50 text-teal-600"
          />
        </div>
      </section>

      {/* Lifecycle overview */}
      <section>
        <LifecycleAnalyticsSection projects={projects} isLoading={isLoadingProjects} />
      </section>

      {/* Governance alerts */}
      <section>
        <GovernanceAlertPanel />
      </section>

      {/* Governance task center */}
      <section>
        <GovernanceTaskCenter />
      </section>

      {/* User stats + Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <InfoPanel
            title="System Users"
            subtitle="Registered users by role"
            icon={Users}
            iconColor="bg-violet-50 text-violet-600"
            action={
              <Link href="/admin">
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                  Manage Users <ArrowUpRight className="w-3 h-3" />
                </Button>
              </Link>
            }
          >
            {isLoadingUsers ? (
              <div className="space-y-1.5">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                <Users className="w-7 h-7 mb-1.5 opacity-25" />
                <p className="text-xs">No users registered</p>
              </div>
            ) : (
              <div className="space-y-1">
                {roleBreakdown.map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-gray-50/80 transition-colors">
                    <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${ROLE_BADGE[role] ?? "bg-gray-100 text-gray-700"}`}>
                      {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}
                    </span>
                    <span className="text-sm font-bold tabular-nums">{count}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50/80 border-t mt-0.5">
                  <span className="text-xs font-semibold text-muted-foreground">Total</span>
                  <span className="text-sm font-bold">{users.length}</span>
                </div>
              </div>
            )}
          </InfoPanel>
        </div>
        <div className="lg:col-span-5">
          <ActivityPanel />
        </div>
      </section>

      {/* Revenue chart + Approvals / Tasks */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <ChartCard title="Revenue & Expenditure" subtitle="Monthly trend — current financial year" badge="Placeholder data" minHeight={220}>
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={MOCK_REVENUE} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }} formatter={(v: number, name: string) => [`₹${v.toLocaleString("en-IN")}`, name === "revenue" ? "Revenue" : "Expenditure"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} fill="url(#revGrad)" />
                <Area type="monotone" dataKey="expenditure" name="Expenditure" stroke="#ef4444" strokeWidth={2} fill="url(#expGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
        <div className="lg:col-span-5 space-y-4">
          <InfoPanel title="Pending Approvals" subtitle={`${MOCK_APPROVALS.filter(a => a.due === "Overdue").length} overdue`} icon={AlertCircle} iconColor="bg-amber-50 text-amber-500">
            <div className="space-y-2">
              {MOCK_APPROVALS.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.detail}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${PRIORITY_COLORS[item.priority]}`}>{item.due}</span>
                </div>
              ))}
            </div>
          </InfoPanel>
          <InfoPanel title="Pending Tasks" icon={Clock} iconColor="bg-violet-50 text-violet-500">
            <div className="space-y-2">
              {MOCK_TASKS.map((task) => (
                <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-snug">{task.title}</p>
                    <p className="text-[10px] text-muted-foreground">{task.module}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                </div>
              ))}
            </div>
          </InfoPanel>
        </div>
      </section>

      {/* Project table */}
      <section>
        <ProjectSummaryTable />
      </section>
    </div>
  );
}

// ── Developer Dashboard ───────────────────────────────────────────────────

function DeveloperDashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: governance, isLoading: isLoadingGovernance } = useGetGovernanceSummary();
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();
  const { data: stock = [] } = useGetStockSummary();
  const { data: production = [] } = useListProductionRecords();

  const totalStock = stock.reduce((s, p) => s + p.currentStock, 0);
  const govIssues = governance?.totalIssues ?? 0;
  const attentionCount = governance?.projectAlerts.filter(a => a.status === "attention_required").length ?? 0;
  const thisMonthKg = production
    .filter(p => { try { return isThisMonth(new Date(p.recordedAt)); } catch { return false; } })
    .reduce((sum, p) => sum + p.productionKg, 0);

  return (
    <div className="space-y-6 max-w-[1600px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          <MetricCard
            label="My Projects"
            value={projects.length}
            sub={summary ? `${summary.tappingProjectsCount} tapping` : undefined}
            icon={Trees}
            iconColor="bg-blue-50 text-blue-600"
            isLoading={isLoadingProjects}
          />
          <MetricCard
            label="Governance Issues"
            value={govIssues > 0 ? govIssues : governance ? "✓" : "—"}
            sub={govIssues === 0 && governance ? "all checks passed" : govIssues > 0 ? `${attentionCount} need immediate action` : "checking..."}
            icon={AlertCircle}
            iconColor={govIssues > 0 ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600"}
            isLoading={isLoadingGovernance}
          />
          <MetricCard
            label="Projects at Risk"
            value={attentionCount > 0 ? attentionCount : governance ? "None" : "—"}
            sub="attention required"
            icon={ClipboardCheck}
            iconColor={attentionCount > 0 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}
            isLoading={isLoadingGovernance}
          />
          <MetricCard
            label="Production This Month"
            value={thisMonthKg > 0 ? `${thisMonthKg.toLocaleString()} kg` : "—"}
            sub="rubber produced"
            icon={Scale}
            iconColor="bg-emerald-50 text-emerald-600"
          />
          <MetricCard
            label="Stock on Hand"
            value={totalStock > 0 ? `${totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg` : "—"}
            sub="current inventory"
            icon={Warehouse}
            iconColor="bg-teal-50 text-teal-600"
          />
        </div>
      </section>

      {/* Lifecycle overview */}
      <section>
        <LifecycleAnalyticsSection projects={projects} isLoading={isLoadingProjects} />
      </section>

      {/* Governance alerts */}
      <section>
        <GovernanceAlertPanel />
      </section>

      {/* Governance task center */}
      <section>
        <GovernanceTaskCenter />
      </section>

      {/* Project health + Pending approvals */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <ProjectHealthPanel
            projects={projects}
            governance={governance}
            isLoading={isLoadingProjects || isLoadingGovernance}
          />
        </div>
        <div className="lg:col-span-5 space-y-4">
          <InfoPanel
            title="Pending Approvals"
            subtitle={`${MOCK_APPROVALS.filter(a => a.due === "Overdue").length} overdue`}
            icon={AlertCircle}
            iconColor="bg-amber-50 text-amber-500"
          >
            <div className="space-y-2">
              {MOCK_APPROVALS.slice(0, 3).map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.detail}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${PRIORITY_COLORS[item.priority]}`}>{item.due}</span>
                </div>
              ))}
            </div>
          </InfoPanel>
          <ChartCard title="Project Performance" subtitle="Production vs sales — current season" badge="Placeholder" minHeight={170}>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={MOCK_PROJECT_PERF} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" vertical={false} />
                <XAxis dataKey="project" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }} formatter={(v: number, name: string) => [`${v} kg`, name === "production" ? "Produced" : "Sold"]} />
                <Bar dataKey="production" name="Produced" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="sales" name="Sold" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </section>

      {/* Project summary + Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <ProjectSummaryTable compact />
        </div>
        <div className="lg:col-span-4">
          <ActivityPanel />
        </div>
      </section>
    </div>
  );
}

// ── Landowner Dashboard ───────────────────────────────────────────────────

function LandownerDashboard() {
  const { data: portfolio, isLoading: isLoadingPortfolio } = useGetMyPortfolio();
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();

  const agreements = portfolio?.agreements ?? [];
  const activeAgreements = agreements.filter((a) => a.status === "active");
  const pendingAgreements = agreements.filter((a) => a.status !== "active");
  const totalLandKani = agreements.reduce((sum, a) => sum + (a.landArea ?? 0), 0);
  const avgOwnership =
    activeAgreements.length > 0
      ? activeAgreements.reduce((sum, a) => sum + (a.ownershipShareLandowner ?? 0), 0) /
        activeAgreements.length
      : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="My Projects"
            value={projects.length}
            icon={Trees}
            iconColor="bg-blue-50 text-blue-600"
            isLoading={isLoadingProjects}
          />
          <MetricCard
            label="Active Agreements"
            value={activeAgreements.length}
            icon={FileSignature}
            iconColor="bg-emerald-50 text-emerald-600"
            isLoading={isLoadingPortfolio}
          />
          <MetricCard
            label="Pending Verification"
            value={pendingAgreements.length > 0 ? pendingAgreements.length : "None"}
            sub={pendingAgreements.length > 0 ? "requires attention" : "all up to date"}
            icon={ClipboardCheck}
            iconColor={pendingAgreements.length > 0 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}
            isLoading={isLoadingPortfolio}
          />
          <MetricCard
            label="Land Under Agreement"
            value={totalLandKani > 0 ? `${totalLandKani} kani` : "—"}
            sub={avgOwnership > 0 ? `${avgOwnership.toFixed(1)}% avg ownership` : "total land area"}
            icon={MapPin}
            iconColor="bg-violet-50 text-violet-600"
            isLoading={isLoadingPortfolio}
          />
        </div>
      </section>

      {/* Pending Verifications (only shown when relevant) */}
      {pendingAgreements.length > 0 && (
        <section>
          <InfoPanel
            title="Pending Verifications"
            subtitle="Agreements awaiting your attention"
            icon={ClipboardCheck}
            iconColor="bg-amber-50 text-amber-600"
          >
            <div className="space-y-2">
              {pendingAgreements.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-100 bg-amber-50/40 hover:bg-amber-50/70 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{a.projectName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {a.landArea} {a.landAreaUnit} · {a.termYears}yr term
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">
                      {a.status.replace(/_/g, " ")}
                    </span>
                    <Link href="/agreements">
                      <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-primary px-2">
                        View <ChevronRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </InfoPanel>
        </section>
      )}

      {/* Agreements + Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <InfoPanel
            title="My Agreements"
            subtitle="Land contribution agreements"
            icon={FileSignature}
            iconColor="bg-amber-50 text-amber-600"
            action={
              <Link href="/agreements">
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                  View All <ArrowUpRight className="w-3 h-3" />
                </Button>
              </Link>
            }
          >
            {isLoadingPortfolio ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : agreements.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                <FileSignature className="w-7 h-7 mb-1.5 opacity-25" />
                <p className="text-xs">No agreements found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-semibold text-muted-foreground">Project</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground">Land Area</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground hidden sm:table-cell">Ownership</th>
                      <th className="text-left py-2 font-semibold text-muted-foreground pl-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agreements.map((a) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50/60">
                        <td className="py-2.5 font-medium">{a.projectName}</td>
                        <td className="py-2.5 text-right text-muted-foreground">
                          {a.landArea} {a.landAreaUnit}
                        </td>
                        <td className="py-2.5 text-right hidden sm:table-cell text-emerald-700 font-medium">
                          {a.ownershipShareLandowner != null ? `${a.ownershipShareLandowner}%` : "—"}
                        </td>
                        <td className="py-2.5 pl-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${a.status === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </InfoPanel>
        </div>
        <div className="lg:col-span-5">
          <ActivityPanel />
        </div>
      </section>

      {/* Project summary */}
      <section>
        <ProjectSummaryTable compact />
      </section>
    </div>
  );
}

// ── Investor Dashboard ────────────────────────────────────────────────────

function InvestorDashboard() {
  const { data: portfolio, isLoading: isLoadingPortfolio } = useGetMyPortfolio();
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();
  const { data: revenueStats = [] } = useGetRevenueStats();

  const agreements = portfolio?.agreements ?? [];
  const totalLandKani = agreements.reduce((sum, a) => sum + (a.landArea ?? 0), 0);
  const totalOwnership = agreements.reduce((sum, a) => sum + (a.ownershipShareDeveloper ?? 0), 0);

  const revenueChartData = revenueStats.map((s) => ({
    project: s.projectName.split(" ")[0],
    revenue: s.revenue,
    profit: s.profit,
  }));

  return (
    <div className="space-y-6 max-w-[1400px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="My Projects"
            value={projects.length}
            icon={Trees}
            iconColor="bg-blue-50 text-blue-600"
            isLoading={isLoadingProjects}
          />
          <MetricCard
            label="Agreements"
            value={agreements.length}
            sub="investment agreements"
            icon={FileSignature}
            iconColor="bg-amber-50 text-amber-600"
            isLoading={isLoadingPortfolio}
          />
          <MetricCard
            label="Land Portfolio"
            value={totalLandKani > 0 ? `${totalLandKani} kani` : "—"}
            sub="total land area"
            icon={MapPin}
            iconColor="bg-emerald-50 text-emerald-600"
            isLoading={isLoadingPortfolio}
          />
          <MetricCard
            label="Total Ownership Share"
            value={totalOwnership > 0 ? `${totalOwnership.toFixed(1)}%` : "—"}
            sub="across all agreements"
            icon={TrendingUp}
            iconColor="bg-violet-50 text-violet-600"
            isLoading={isLoadingPortfolio}
          />
        </div>
      </section>

      {/* Participation overview + Revenue chart */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5">
          <InfoPanel
            title="Participation Overview"
            subtitle="Your investment agreements"
            icon={FileSignature}
            iconColor="bg-amber-50 text-amber-600"
            action={
              <Link href="/agreements">
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground">
                  All <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            }
          >
            {isLoadingPortfolio ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : agreements.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                <FileSignature className="w-7 h-7 mb-1.5 opacity-25" />
                <p className="text-xs">No agreements found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {agreements.map((a) => (
                  <div key={a.id} className="p-3 rounded-lg border bg-gray-50/60 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{a.projectName}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {a.landArea} {a.landAreaUnit} · {a.termYears}yr term
                        </p>
                        <span className={`mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${a.status === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {a.status}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-base font-bold text-emerald-700">
                          {a.ownershipShareDeveloper != null ? `${a.ownershipShareDeveloper}%` : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">ownership</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </InfoPanel>
        </div>

        <div className="lg:col-span-7">
          {revenueChartData.length > 0 ? (
            <ChartCard title="Revenue by Project" subtitle="Actual production revenue from records">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={revenueChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" vertical={false} />
                  <XAxis dataKey="project" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#059669" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <ChartCard title="Revenue Projections" subtitle="Annual income estimates (placeholder)" badge="Placeholder">
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={MOCK_REVENUE.slice(-6)} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="invGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Revenue"]} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#7c3aed" strokeWidth={2} fill="url(#invGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      </section>

      {/* Project table + Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <ProjectSummaryTable compact />
        </div>
        <div className="lg:col-span-4">
          <ActivityPanel />
        </div>
      </section>
    </div>
  );
}

// ── Employee Dashboard ────────────────────────────────────────────────────

function EmployeeDashboard() {
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();
  const { data: production = [], isLoading: isLoadingProduction } = useListProductionRecords();
  const { data: stock = [] } = useGetStockSummary();

  const thisMonthKg = production
    .filter((p) => {
      try { return isThisMonth(new Date(p.recordedAt)); }
      catch { return false; }
    })
    .reduce((sum, p) => sum + p.productionKg, 0);

  const totalStock = stock.reduce((sum, s) => sum + s.currentStock, 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Assigned Projects" value={projects.length} icon={Trees} iconColor="bg-blue-50 text-blue-600" isLoading={isLoadingProjects} />
          <MetricCard label="Production This Month" value={thisMonthKg > 0 ? `${thisMonthKg.toLocaleString()} kg` : "—"} sub="rubber produced" icon={Scale} iconColor="bg-emerald-50 text-emerald-600" isLoading={isLoadingProduction} />
          <MetricCard label="Stock on Hand" value={totalStock > 0 ? `${totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg` : "—"} sub="current inventory" icon={Warehouse} iconColor="bg-teal-50 text-teal-600" />
        </div>
      </section>

      {/* Quick actions + Production records */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Quick actions */}
        <div className="lg:col-span-4">
          <InfoPanel title="Quick Actions" subtitle="Your most-used operations" icon={CheckSquare} iconColor="bg-violet-50 text-violet-600">
            <div className="space-y-2">
              <Link href="/production">
                <Button className="w-full justify-start gap-2.5 h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                  <Plus className="w-3.5 h-3.5" />
                  Log Production Entry
                </Button>
              </Link>
              <Link href="/inventory">
                <Button variant="outline" className="w-full justify-start gap-2.5 h-9 text-xs">
                  <PackageOpen className="w-3.5 h-3.5 text-blue-500" />
                  Update Inventory
                </Button>
              </Link>
              <Link href="/stock">
                <Button variant="outline" className="w-full justify-start gap-2.5 h-9 text-xs">
                  <Warehouse className="w-3.5 h-3.5 text-teal-500" />
                  View Stock Register
                </Button>
              </Link>
              <Link href="/projects">
                <Button variant="outline" className="w-full justify-start gap-2.5 h-9 text-xs">
                  <Trees className="w-3.5 h-3.5 text-emerald-500" />
                  My Projects
                </Button>
              </Link>
            </div>
          </InfoPanel>
        </div>

        {/* Recent production */}
        <div className="lg:col-span-8">
          <InfoPanel
            title="Recent Production Records"
            subtitle="Latest entries across your projects"
            icon={Scale}
            iconColor="bg-emerald-50 text-emerald-600"
            action={
              <Link href="/production">
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                  All Records <ArrowUpRight className="w-3 h-3" />
                </Button>
              </Link>
            }
          >
            {isLoadingProduction ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
              </div>
            ) : production.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-28 text-muted-foreground">
                <Scale className="w-7 h-7 mb-1.5 opacity-25" />
                <p className="text-xs">No production records yet</p>
                <Link href="/production">
                  <Button size="sm" className="mt-2 h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Plus className="w-3 h-3" /> Log First Entry
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-semibold text-muted-foreground">Date</th>
                      <th className="text-left py-2 font-semibold text-muted-foreground hidden sm:table-cell">Project</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground">Produced</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground">Sold</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground hidden sm:table-cell">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {production.slice(0, 6).map((p) => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50/60">
                        <td className="py-2.5 text-muted-foreground">{format(new Date(p.recordedAt), "d MMM")}</td>
                        <td className="py-2.5 font-medium hidden sm:table-cell truncate max-w-[120px]">{p.projectName}</td>
                        <td className="py-2.5 text-right font-medium">{p.productionKg} kg</td>
                        <td className="py-2.5 text-right text-blue-700">{p.soldKg} kg</td>
                        <td className="py-2.5 text-right text-emerald-700 font-medium hidden sm:table-cell">
                          ₹{p.revenue.toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </InfoPanel>
        </div>
      </section>

      {/* Activity */}
      <section>
        <ActivityPanel />
      </section>
    </div>
  );
}

// ── Operational Staff Dashboard ───────────────────────────────────────────

function StaffDashboard() {
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();
  const { data: stock = [], isLoading: isLoadingStock } = useGetStockSummary();

  const totalStock = stock.reduce((sum, s) => sum + s.currentStock, 0);
  const totalProduced = stock.reduce((sum, s) => sum + s.totalProduced, 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Assigned Projects" value={projects.length} icon={Trees} iconColor="bg-blue-50 text-blue-600" isLoading={isLoadingProjects} />
          <MetricCard label="Total Stock" value={totalStock > 0 ? `${totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg` : "—"} sub="on hand" icon={Warehouse} iconColor="bg-teal-50 text-teal-600" isLoading={isLoadingStock} />
          <MetricCard label="Pending Distribution" value="0" sub="placeholder" icon={Truck} iconColor="bg-amber-50 text-amber-600" />
        </div>
      </section>

      {/* Stock + Quick actions */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4">
          <InfoPanel title="Quick Actions" subtitle="Your day-to-day tasks" icon={CheckSquare} iconColor="bg-violet-50 text-violet-600">
            <div className="space-y-2">
              <Link href="/stock">
                <Button className="w-full justify-start gap-2.5 h-9 bg-teal-600 hover:bg-teal-700 text-white text-xs">
                  <Warehouse className="w-3.5 h-3.5" />
                  Update Stock Register
                </Button>
              </Link>
              <Link href="/inventory">
                <Button variant="outline" className="w-full justify-start gap-2.5 h-9 text-xs">
                  <PackageOpen className="w-3.5 h-3.5 text-blue-500" />
                  Inventory Check
                </Button>
              </Link>
              <Link href="/distribution">
                <Button variant="outline" className="w-full justify-start gap-2.5 h-9 text-xs">
                  <Truck className="w-3.5 h-3.5 text-amber-500" />
                  Distribution Log
                </Button>
              </Link>
            </div>
          </InfoPanel>
        </div>

        {/* Stock overview */}
        <div className="lg:col-span-8">
          <InfoPanel
            title="Stock Overview"
            subtitle="Current rubber stock by project"
            icon={Warehouse}
            iconColor="bg-teal-50 text-teal-600"
            action={
              <Link href="/stock">
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
                  Full Register <ArrowUpRight className="w-3 h-3" />
                </Button>
              </Link>
            }
          >
            {isLoadingStock ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
              </div>
            ) : stock.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                <Warehouse className="w-7 h-7 mb-1.5 opacity-25" />
                <p className="text-xs">No stock data available</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-semibold text-muted-foreground">Project</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground">Produced</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground">Sold</th>
                      <th className="text-right py-2 font-semibold text-muted-foreground">In Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((s) => (
                      <tr key={s.projectId} className="border-b last:border-0 hover:bg-gray-50/60">
                        <td className="py-2.5 font-medium truncate max-w-[140px]">{s.projectName}</td>
                        <td className="py-2.5 text-right text-muted-foreground">{s.totalProduced.toLocaleString()} kg</td>
                        <td className="py-2.5 text-right text-blue-700">{s.totalSold.toLocaleString()} kg</td>
                        <td className="py-2.5 text-right">
                          <span className={`font-semibold ${s.currentStock > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                            {s.currentStock.toLocaleString()} kg
                          </span>
                        </td>
                      </tr>
                    ))}
                    {stock.length > 1 && (
                      <tr className="bg-gray-50 font-semibold">
                        <td className="py-2 px-0 text-xs text-muted-foreground">Total</td>
                        <td className="py-2 text-right text-xs">{totalProduced.toLocaleString()} kg</td>
                        <td className="py-2 text-right text-xs">{stock.reduce((s, p) => s + p.totalSold, 0).toLocaleString()} kg</td>
                        <td className="py-2 text-right text-xs text-emerald-700">{totalStock.toLocaleString()} kg</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </InfoPanel>
        </div>
      </section>

      {/* Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <ProjectSummaryTable compact />
        </div>
        <div className="lg:col-span-4">
          <ActivityPanel />
        </div>
      </section>
    </div>
  );
}

// ── Root router ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { role, canAccessAllProjects, isLoading } = useRole();

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1600px]">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Skeleton className="lg:col-span-7 h-64 rounded-xl" />
          <Skeleton className="lg:col-span-5 h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (role === "admin") return <AdminDashboard />;
  if (role === "developer") return <DeveloperDashboard />;
  if (role === "landowner") return <LandownerDashboard />;
  if (role === "investor") return <InvestorDashboard />;
  if (role === "employee") return <EmployeeDashboard />;
  return <StaffDashboard />;
}
