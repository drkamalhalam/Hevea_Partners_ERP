import { useGetDashboardSummary, useGetRecentActivity, useGetRevenueStats, useGetStockSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Trees,
  Users,
  FileText,
  Map,
  FolderKanban,
  FileSignature,
  HandCoins,
  Receipt,
  PackageOpen,
  ShoppingCart,
  Truck,
  BarChart3,
  Files,
  Building2,
  Bell,
  ShieldCheck,
  Warehouse,
  Scale,
  Activity,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";
import { useRole, ROLE_LABELS } from "@/contexts/RoleContext";
import { useUser } from "@clerk/react";
import { format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const modules = [
  { name: "Projects", href: "/projects", icon: FolderKanban, color: "bg-blue-50 text-blue-700 border-blue-100" },
  { name: "Agreements", href: "/agreements", icon: FileSignature, color: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  { name: "Contributions", href: "/contributions", icon: HandCoins, color: "bg-amber-50 text-amber-700 border-amber-100" },
  { name: "Expenditure", href: "/expenditure", icon: Receipt, color: "bg-rose-50 text-rose-700 border-rose-100" },
  { name: "Inventory", href: "/inventory", icon: PackageOpen, color: "bg-teal-50 text-teal-700 border-teal-100" },
  { name: "Sales", href: "/sales", icon: ShoppingCart, color: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  { name: "Distribution", href: "/distribution", icon: Truck, color: "bg-cyan-50 text-cyan-700 border-cyan-100" },
  { name: "Reports", href: "/reports", icon: BarChart3, color: "bg-violet-50 text-violet-700 border-violet-100" },
  { name: "Documents", href: "/documents", icon: Files, color: "bg-slate-50 text-slate-700 border-slate-100" },
  { name: "Governance", href: "/governance", icon: Building2, color: "bg-orange-50 text-orange-700 border-orange-100" },
  { name: "Stock", href: "/stock", icon: Warehouse, color: "bg-green-50 text-green-700 border-green-100" },
  { name: "Production", href: "/production", icon: Scale, color: "bg-lime-50 text-lime-700 border-lime-100" },
];

function StatCard({ label, value, sub, icon: Icon, isLoading }: {
  label: string; value?: string | number; sub?: string; icon: React.ElementType; isLoading: boolean;
}) {
  return (
    <Card className="border border-gray-200 shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">{label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-16 mt-1.5" />
            ) : (
              <p className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{value ?? "—"}</p>
            )}
            {sub && !isLoading && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-gray-50 border border-gray-100 ml-3 flex-shrink-0">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useUser();
  const { role } = useRole();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: isLoadingActivity } = useGetRecentActivity();
  const { data: revenue, isLoading: isLoadingRevenue } = useGetRevenueStats();
  const { data: stock } = useGetStockSummary();

  const totalStock = stock?.reduce((s, p) => s + p.currentStockKg, 0) ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">

      {/* Welcome banner */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), "EEEE, d MMMM yyyy")} · {ROLE_LABELS[role]}
          </p>
        </div>
        <Badge variant="outline" className="text-xs gap-1.5 py-1 px-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          System Online
        </Badge>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <StatCard label="Projects" value={summary?.totalProjects} sub={`${summary?.activeProjectsCount ?? 0} active`} icon={Trees} isLoading={isLoadingSummary} />
        <StatCard label="Partners" value={summary?.totalPartners} icon={Users} isLoading={isLoadingSummary} />
        <StatCard label="Agreements" value={summary?.totalAgreements} icon={FileText} isLoading={isLoadingSummary} />
        <StatCard label="Land Area" value={summary?.totalLandArea ? `${summary.totalLandArea} ha` : "—"} sub="Under management" icon={Map} isLoading={isLoadingSummary} />
        <StatCard label="Stock (kg)" value={totalStock.toLocaleString("en-IN", { maximumFractionDigits: 0 })} sub="Current inventory" icon={Warehouse} isLoading={isLoadingSummary} />
      </div>

      {/* Module quick access */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">Modules</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.name} href={m.href}>
                <span className={`flex flex-col items-center gap-2 p-3 rounded-xl border cursor-pointer hover:shadow-sm transition-all group ${m.color}`}>
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium text-center leading-tight">{m.name}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Charts + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Revenue chart */}
        <Card className="border border-gray-200 shadow-none lg:col-span-3">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">Revenue Overview</CardTitle>
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoadingRevenue ? (
              <Skeleton className="h-48 w-full" />
            ) : revenue && revenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={revenue} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "12px" }}
                    formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, undefined]}
                  />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                No revenue data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card className="border border-gray-200 shadow-none lg:col-span-2">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">Recent Activity</CardTitle>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoadingActivity ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-2 w-2 mt-1.5 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-2.5 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-4 overflow-y-auto max-h-[200px] pr-1">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-foreground leading-snug">{activity.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(activity.createdAt), "d MMM · h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
