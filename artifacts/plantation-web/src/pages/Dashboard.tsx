import { useUser } from "@clerk/react";
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

// ── Admin / Developer Dashboard ───────────────────────────────────────────

function AdminDeveloperDashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: stock = [] } = useGetStockSummary();

  const totalStock = stock.reduce((s, p) => s + p.currentStockKg, 0);

  return (
    <div className="space-y-6 max-w-[1600px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard label="Total Projects" value={summary?.totalProjects ?? "—"} sub={summary ? `${summary.activeProjectsCount} active` : undefined} icon={Trees} iconColor="bg-blue-50 text-blue-600" trend={{ value: 0 }} isLoading={isLoadingSummary} />
          <MetricCard label="Total Revenue" value="₹24.5L" sub="YTD estimate" icon={Wallet} iconColor="bg-emerald-50 text-emerald-600" trend={{ value: 12 }} />
          <MetricCard label="Total Expenditure" value="₹8.2L" sub="YTD estimate" icon={Receipt} iconColor="bg-rose-50 text-rose-500" trend={{ value: -3 }} />
          <MetricCard label="Pending Approvals" value={MOCK_APPROVALS.length} sub="2 overdue" icon={ClipboardCheck} iconColor="bg-amber-50 text-amber-600" trend={{ value: 1 }} />
          <MetricCard label="Pending Tasks" value={MOCK_TASKS.length} sub="3 high priority" icon={CheckSquare} iconColor="bg-violet-50 text-violet-600" trend={{ value: -2 }} />
          <MetricCard
            label="Stock on Hand"
            value={totalStock > 0 ? `${totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg` : "—"}
            sub="Current inventory"
            icon={Warehouse}
            iconColor="bg-teal-50 text-teal-600"
          />
        </div>
      </section>

      {/* Analytics row 1 */}
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
        <div className="lg:col-span-5">
          <ActivityPanel />
        </div>
      </section>

      {/* Analytics row 2 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <ChartCard title="Project Performance" subtitle="Production vs sales — current season" badge="Placeholder data" minHeight={200}>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={MOCK_PROJECT_PERF} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" vertical={false} />
                <XAxis dataKey="project" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v} kg`} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "11px" }} formatter={(v: number, name: string) => [`${v} kg`, name === "production" ? "Produced" : name === "sales" ? "Sold" : "Target"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Bar dataKey="production" name="Produced" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="sales" name="Sold" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                <Bar dataKey="target" name="Target" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="lg:col-span-5 space-y-4">
          {/* Pending Approvals */}
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

          {/* Pending Tasks */}
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

// ── Landowner Dashboard ───────────────────────────────────────────────────

function LandownerDashboard() {
  const { data: portfolio, isLoading: isLoadingPortfolio } = useGetMyPortfolio();
  const { data: projects = [], isLoading: isLoadingProjects } = useListProjects();

  const agreements = portfolio?.agreements ?? [];
  const totalLand = portfolio?.totalLandArea ?? 0;
  const ownershipShare = portfolio?.totalOwnershipShare ?? 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <WelcomeHeader />

      {/* KPI Cards */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="My Projects" value={projects.length} icon={Trees} iconColor="bg-blue-50 text-blue-600" isLoading={isLoadingProjects} />
          <MetricCard label="My Agreements" value={agreements.length} icon={FileSignature} iconColor="bg-amber-50 text-amber-600" isLoading={isLoadingPortfolio} />
          <MetricCard label="Land Under Agreement" value={totalLand > 0 ? `${totalLand} kani` : "—"} sub="total area" icon={MapPin} iconColor="bg-emerald-50 text-emerald-600" isLoading={isLoadingPortfolio} />
          <MetricCard label="Ownership Share" value={ownershipShare > 0 ? `${ownershipShare.toFixed(1)}%` : "—"} sub="avg across agreements" icon={PieChart} iconColor="bg-violet-50 text-violet-600" isLoading={isLoadingPortfolio} />
        </div>
      </section>

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
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${a.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
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
  const totalLand = portfolio?.totalLandArea ?? 0;
  const ownershipShare = portfolio?.totalOwnershipShare ?? 0;

  const projectedRevenue = totalLand > 0 ? `₹${(totalLand * 12).toFixed(0)}k` : "—";

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
          <MetricCard label="My Projects" value={projects.length} icon={Trees} iconColor="bg-blue-50 text-blue-600" isLoading={isLoadingProjects} />
          <MetricCard label="Agreements" value={agreements.length} icon={FileSignature} iconColor="bg-amber-50 text-amber-600" isLoading={isLoadingPortfolio} />
          <MetricCard label="Land Portfolio" value={totalLand > 0 ? `${totalLand} kani` : "—"} sub="across agreements" icon={MapPin} iconColor="bg-emerald-50 text-emerald-600" isLoading={isLoadingPortfolio} />
          <MetricCard label="Projected Revenue" value={projectedRevenue} sub="annual estimate" icon={TrendingUp} iconColor="bg-violet-50 text-violet-600" isLoading={isLoadingPortfolio} />
        </div>
      </section>

      {/* Investment details + Revenue chart */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5">
          <InfoPanel
            title="Investment Details"
            subtitle="Your project agreements"
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
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : agreements.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                <FileSignature className="w-7 h-7 mb-1.5 opacity-25" />
                <p className="text-xs">No agreements found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {agreements.map((a) => (
                  <div key={a.id} className="p-3 rounded-lg border bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold">{a.projectName}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {a.landArea} {a.landAreaUnit} · {a.termYears}yr term
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-emerald-700">
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

  const totalStock = stock.reduce((sum, s) => sum + s.currentStockKg, 0);

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

  const totalStock = stock.reduce((sum, s) => sum + s.currentStockKg, 0);
  const totalProduced = stock.reduce((sum, s) => sum + s.totalProducedKg, 0);

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
                        <td className="py-2.5 text-right text-muted-foreground">{s.totalProducedKg.toLocaleString()} kg</td>
                        <td className="py-2.5 text-right text-blue-700">{s.totalSoldKg.toLocaleString()} kg</td>
                        <td className="py-2.5 text-right">
                          <span className={`font-semibold ${s.currentStockKg > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                            {s.currentStockKg.toLocaleString()} kg
                          </span>
                        </td>
                      </tr>
                    ))}
                    {stock.length > 1 && (
                      <tr className="bg-gray-50 font-semibold">
                        <td className="py-2 px-0 text-xs text-muted-foreground">Total</td>
                        <td className="py-2 text-right text-xs">{totalProduced.toLocaleString()} kg</td>
                        <td className="py-2 text-right text-xs">{stock.reduce((s, p) => s + p.totalSoldKg, 0).toLocaleString()} kg</td>
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

  if (canAccessAllProjects) return <AdminDeveloperDashboard />;
  if (role === "landowner") return <LandownerDashboard />;
  if (role === "investor") return <InvestorDashboard />;
  if (role === "employee") return <EmployeeDashboard />;
  return <StaffDashboard />;
}
