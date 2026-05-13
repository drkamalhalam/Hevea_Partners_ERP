import { useGetDashboardSummary, useGetRecentActivity, useGetRevenueStats, useGetStockSummary, useListProjects } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Link } from "wouter";
import {
  Trees,
  Users,
  Wallet,
  Receipt,
  ClipboardCheck,
  CheckSquare,
  Warehouse,
  TrendingUp,
  Activity,
  AlertCircle,
  Clock,
  ArrowUpRight,
  MoreHorizontal,
  ChevronRight,
} from "lucide-react";
import { useRole, ROLE_LABELS } from "@/contexts/RoleContext";
import { useUser } from "@clerk/react";
import { format } from "date-fns";
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

// ── Placeholder data (replaced when Finance modules are built) ──────────────

const MOCK_REVENUE_MONTHLY = [
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

const MOCK_PENDING_APPROVALS = [
  {
    id: 1,
    title: "Agreement renewal",
    detail: "Manu Valley Plantation",
    due: "Overdue",
    priority: "high" as const,
  },
  {
    id: 2,
    title: "Land survey document",
    detail: "Gandacherra Block B",
    due: "Due today",
    priority: "medium" as const,
  },
  {
    id: 3,
    title: "Q1 2026 report sign-off",
    detail: "All projects",
    due: "In 3 days",
    priority: "low" as const,
  },
  {
    id: 4,
    title: "New partner agreement",
    detail: "Ambassa Northern Plot",
    due: "In 5 days",
    priority: "low" as const,
  },
];

const MOCK_PENDING_TASKS = [
  { id: 1, title: "Update production logs for May", module: "Production", priority: "high" as const },
  { id: 2, title: "Review expenditure report", module: "Finance", priority: "medium" as const },
  { id: 3, title: "Upload boundary survey — Manu Valley", module: "Documents", priority: "high" as const },
];

const priorityColors = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  developing: "bg-amber-100 text-amber-700",
  maturing: "bg-emerald-100 text-emerald-700",
  tapping: "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-600",
};

// ── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
      <Skeleton className="h-3 w-3 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

// ── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  actions,
  children,
  minHeight = 200,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  minHeight?: number;
}) {
  return (
    <Card className="border border-gray-200 shadow-none bg-white">
      <CardHeader className="pb-2 px-5 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold text-foreground">
              {title}
            </CardTitle>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5" style={{ minHeight }}>
        {children}
      </CardContent>
    </Card>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useUser();
  const { role } = useRole();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: isLoadingActivity } = useGetRecentActivity();
  const { data: revenue } = useGetRevenueStats();
  const { data: stock } = useGetStockSummary();
  const { data: projects = [] } = useListProjects();

  const totalStock = stock?.reduce((s, p) => s + p.currentStockKg, 0) ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-[1600px]">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">
            Good {getGreeting()},{" "}
            <span className="text-emerald-700">{user?.firstName ?? "Partner"}</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(), "EEEE, d MMMM yyyy")} · {ROLE_LABELS[role]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="text-[11px] gap-1.5 py-1 px-2.5 border-emerald-200 text-emerald-700 bg-emerald-50"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            All Systems Online
          </Badge>
        </div>
      </div>

      {/* ── Section 1: Metric cards ── */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard
            label="Total Projects"
            value={summary?.totalProjects ?? "—"}
            sub={summary ? `${summary.activeProjectsCount} active` : undefined}
            icon={Trees}
            iconColor="bg-blue-50 text-blue-600"
            trend={{ value: 0, label: "vs last year" }}
            isLoading={isLoadingSummary}
          />
          <MetricCard
            label="Total Revenue"
            value="₹24.5L"
            sub="YTD estimate"
            icon={Wallet}
            iconColor="bg-emerald-50 text-emerald-600"
            trend={{ value: 12, label: "vs last year" }}
          />
          <MetricCard
            label="Total Expenditure"
            value="₹8.2L"
            sub="YTD estimate"
            icon={Receipt}
            iconColor="bg-rose-50 text-rose-500"
            trend={{ value: -3, label: "vs last year" }}
          />
          <MetricCard
            label="Pending Approvals"
            value={MOCK_PENDING_APPROVALS.length}
            sub="2 overdue"
            icon={ClipboardCheck}
            iconColor="bg-amber-50 text-amber-600"
            trend={{ value: 1, label: "new this week" }}
          />
          <MetricCard
            label="Pending Tasks"
            value={MOCK_PENDING_TASKS.length}
            sub="3 high priority"
            icon={CheckSquare}
            iconColor="bg-violet-50 text-violet-600"
            trend={{ value: -2, label: "vs last week" }}
          />
          <MetricCard
            label="Stock on Hand"
            value={
              totalStock > 0
                ? `${totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`
                : "—"
            }
            sub="Current inventory"
            icon={Warehouse}
            iconColor="bg-teal-50 text-teal-600"
            isLoading={isLoadingSummary && totalStock === 0}
          />
        </div>
      </section>

      {/* ── Section 2: Analytics panels ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Revenue & Expenditure trend chart */}
        <div className="lg:col-span-7">
          <ChartCard
            title="Revenue & Expenditure"
            subtitle="Monthly trend — current financial year (placeholder)"
            actions={
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Placeholder data
              </Badge>
            }
            minHeight={220}
          >
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart
                data={MOCK_REVENUE_MONTHLY}
                margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
              >
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
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }}
                  formatter={(v: number, name: string) => [
                    `₹${v.toLocaleString("en-IN")}`,
                    name === "revenue" ? "Revenue" : "Expenditure",
                  ]}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} fill="url(#revGrad)" />
                <Area type="monotone" dataKey="expenditure" name="Expenditure" stroke="#ef4444" strokeWidth={2} fill="url(#expGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-5">
          <ChartCard
            title="Recent Activity"
            subtitle="Latest system events"
            actions={
              <Link href="/notifications">
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground">
                  View all <ChevronRight className="w-3 h-3" />
                </Button>
              </Link>
            }
            minHeight={220}
          >
            {isLoadingActivity ? (
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
              </div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-0 overflow-y-auto max-h-[210px] pr-1 -mr-2">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground leading-snug truncate">
                        {a.description}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(a.createdAt), "d MMM · h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Activity className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">No recent activity</p>
              </div>
            )}
          </ChartCard>
        </div>

        {/* Project Performance Chart */}
        <div className="lg:col-span-7">
          <ChartCard
            title="Project Performance"
            subtitle="Production vs sales by project — current season (placeholder)"
            actions={
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Placeholder data
              </Badge>
            }
            minHeight={200}
          >
            <ResponsiveContainer width="100%" height={190}>
              <BarChart
                data={MOCK_PROJECT_PERF}
                margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" vertical={false} />
                <XAxis dataKey="project" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v} kg`} />
                <Tooltip
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }}
                  formatter={(v: number, name: string) => [`${v} kg`, name === "production" ? "Produced" : name === "sales" ? "Sold" : "Target"]}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Bar dataKey="production" name="Produced" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="sales" name="Sold" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                <Bar dataKey="target" name="Target" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Pending Approvals & Tasks */}
        <div className="lg:col-span-5 space-y-4">

          {/* Pending Approvals */}
          <Card className="border border-gray-200 shadow-none bg-white">
            <CardHeader className="pb-2 px-5 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Pending Approvals</CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {MOCK_PENDING_APPROVALS.filter((a) => a.due === "Overdue").length} overdue
                  </p>
                </div>
                <AlertCircle className="w-4 h-4 text-amber-500" />
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="space-y-2">
                {MOCK_PENDING_APPROVALS.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.detail}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${priorityColors[item.priority]}`}
                      >
                        {item.due}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pending Tasks */}
          <Card className="border border-gray-200 shadow-none bg-white">
            <CardHeader className="pb-2 px-5 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Pending Tasks</CardTitle>
                <Clock className="w-4 h-4 text-violet-500" />
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="space-y-2">
                {MOCK_PENDING_TASKS.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground leading-snug">{task.title}</p>
                      <p className="text-[10px] text-muted-foreground">{task.module}</p>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${priorityColors[task.priority]}`}
                    >
                      {task.priority}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Section 3: Project Summary Table ── */}
      <section>
        <Card className="border border-gray-200 shadow-none bg-white">
          <CardHeader className="pb-2 px-5 pt-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold">Project Summary</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  All plantation projects under management
                </p>
              </div>
              <Link href="/projects">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                  Manage Projects <ArrowUpRight className="w-3 h-3" />
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
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden lg:table-cell">Est. Revenue</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground hidden lg:table-cell">Expenditure</th>
                    <th className="text-right px-5 py-2.5 font-semibold text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-muted-foreground">
                        No projects yet
                      </td>
                    </tr>
                  ) : (
                    projects.map((p, idx) => {
                      const stockEntry = stock?.find((s) => s.projectId === p.id);
                      return (
                        <tr
                          key={p.id}
                          className="border-b last:border-0 hover:bg-gray-50/70 transition-colors"
                        >
                          <td className="px-5 py-3 font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                {(idx + 1).toString().padStart(2, "0")}
                              </div>
                              <span className="truncate max-w-[140px]">{p.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                            {p.district ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[p.status] ?? "bg-gray-100 text-gray-600"}`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                            {p.landArea ? `${p.landArea} kani` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            <span className="font-medium text-emerald-700">
                              ₹{((p.landArea ?? 10) * 12).toFixed(0)}k
                            </span>
                            <span className="text-muted-foreground text-[10px] ml-0.5">est.</span>
                          </td>
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            <span className="font-medium text-rose-600">
                              ₹{((p.landArea ?? 10) * 4).toFixed(0)}k
                            </span>
                            <span className="text-muted-foreground text-[10px] ml-0.5">est.</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Link href={`/projects/${p.id}`}>
                              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-primary">
                                View <ChevronRight className="w-3 h-3" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
