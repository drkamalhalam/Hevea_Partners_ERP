import { useState } from "react";
import { format } from "date-fns";
import {
  useGetReportSummary,
  useGetPartnerStatementReport,
  useGetProductionReport,
  useGetGovernanceHealthReport,
  useGetActivityReport,
  useListProjects,
  useListPartners,
  getGetReportSummaryQueryKey,
  getGetPartnerStatementReportQueryKey,
  getGetProductionReportQueryKey,
  getGetGovernanceHealthReportQueryKey,
  getGetActivityReportQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  BarChart3,
  Users,
  FileText,
  TrendingUp,
  ShieldCheck,
  Activity,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Leaf,
} from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(n: number | string | undefined | null, prefix = "") {
  const v = parseFloat(String(n ?? 0));
  if (isNaN(v)) return `${prefix}0`;
  if (v >= 1_00_00_000) return `${prefix}${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (v >= 1_00_000) return `${prefix}${(v / 1_00_000).toFixed(2)} L`;
  return `${prefix}${v.toLocaleString("en-IN")}`;
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "text-white",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="p-4 flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-400 mb-1">{label}</p>
          <p className={cn("text-2xl font-bold", color)}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <Icon className="h-8 w-8 text-slate-600" />
      </CardContent>
    </Card>
  );
}

function GovernanceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    complete: { label: "Complete", cls: "bg-emerald-900/40 text-emerald-400 border-emerald-800/40" },
    incomplete: { label: "Incomplete", cls: "bg-amber-900/40 text-amber-400 border-amber-800/40" },
    attention_required: { label: "Attention", cls: "bg-red-900/40 text-red-400 border-red-800/40" },
    pending: { label: "Pending", cls: "bg-blue-900/40 text-blue-400 border-blue-800/40" },
  };
  const d = map[status] ?? { label: status, cls: "bg-slate-800 text-slate-400 border-slate-700" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", d.cls)}>
      {d.label}
    </span>
  );
}

function LifecycleChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    prematurity: "bg-sky-900/40 text-sky-300 border-sky-800/40",
    mature_production: "bg-emerald-900/40 text-emerald-300 border-emerald-800/40",
    closed: "bg-slate-700 text-slate-400 border-slate-600",
  };
  const labels: Record<string, string> = {
    prematurity: "Prematurity",
    mature_production: "Mature",
    closed: "Closed",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs border", map[status] ?? "")}>
      {labels[status] ?? status}
    </span>
  );
}

export default function Reports() {
  const { role, canAccessAllProjects } = useRole();
  const [activeTab, setActiveTab] = useState("summary");
  const [partnerId, setPartnerId] = useState<string>("_all");
  const [projectId, setProjectId] = useState<string>("_all");

  const { data: projects } = useListProjects();
  const { data: partners } = useListPartners();

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useGetReportSummary();
  const partnerParams = { partnerId: partnerId !== "_all" ? partnerId : undefined };
  const { data: partnerReport, isLoading: partnerLoading } = useGetPartnerStatementReport(
    partnerParams,
    { query: { enabled: activeTab === "partners", queryKey: getGetPartnerStatementReportQueryKey(partnerParams) } },
  );
  const prodParams = { projectId: projectId !== "_all" ? projectId : undefined };
  const { data: productionReport, isLoading: productionLoading } = useGetProductionReport(
    prodParams,
    { query: { enabled: activeTab === "production", queryKey: getGetProductionReportQueryKey(prodParams) } },
  );
  const { data: govHealth, isLoading: govLoading } = useGetGovernanceHealthReport({
    query: { enabled: activeTab === "governance", queryKey: getGetGovernanceHealthReportQueryKey() },
  });
  const activityParams = { projectId: projectId !== "_all" ? projectId : undefined, limit: "100" };
  const { data: activityReport, isLoading: activityLoading } = useGetActivityReport(
    activityParams,
    { query: { enabled: activeTab === "activity", queryKey: getGetActivityReportQueryKey(activityParams) } },
  );

  const generatedAt = summary?.generatedAt
    ? format(new Date(summary.generatedAt), "d MMM yyyy, HH:mm")
    : null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reports</h1>
          <p className="text-sm text-slate-400 mt-1">
            Cross-project financial, operational and governance reports
            {generatedAt && <span className="ml-2 text-slate-500">· Generated {generatedAt}</span>}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchSummary()}
          className="border-slate-700 text-slate-300 hover:text-white"
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="summary" className="text-xs gap-1">
            <BarChart3 className="h-3.5 w-3.5" />Summary
          </TabsTrigger>
          <TabsTrigger value="partners" className="text-xs gap-1">
            <Users className="h-3.5 w-3.5" />Partners
          </TabsTrigger>
          <TabsTrigger value="production" className="text-xs gap-1">
            <Leaf className="h-3.5 w-3.5" />Production
          </TabsTrigger>
          <TabsTrigger value="governance" className="text-xs gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />Governance
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-xs gap-1">
            <Activity className="h-3.5 w-3.5" />Activity
          </TabsTrigger>
        </TabsList>

        {/* ── SUMMARY ─────────────────────────────────────────── */}
        <TabsContent value="summary" className="mt-4 space-y-6">
          {summaryLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-4">
                    <Skeleton className="h-3 w-24 bg-slate-700 mb-2" />
                    <Skeleton className="h-7 w-16 bg-slate-700" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Total Projects" value={summary?.projects?.total ?? 0} icon={BarChart3} color="text-blue-400" />
                <KpiCard label="Total Partners" value={summary?.partners?.total ?? 0} icon={Users} color="text-purple-400" />
                <KpiCard label="Total Agreements" value={summary?.agreements?.total ?? 0} sub={`${summary?.agreements?.active ?? 0} active`} icon={FileText} color="text-emerald-400" />
                <KpiCard label="Production Records" value={summary?.production?.recordCount ?? 0} icon={Leaf} color="text-amber-400" />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Contributions (INR)" value={fmt(summary?.contributions?.totalAmount, "₹")} icon={TrendingUp} color="text-cyan-400" />
                <KpiCard label="Production (kg)" value={fmt(summary?.production?.totalKg)} icon={Leaf} color="text-green-400" />
                <KpiCard label="Production Revenue" value={fmt(summary?.production?.totalRevenue, "₹")} icon={TrendingUp} color="text-emerald-400" />
                <KpiCard label="Total Sales" value={fmt(summary?.sales?.totalValue, "₹")} sub={`${summary?.sales?.transactionCount ?? 0} transactions`} icon={TrendingUp} color="text-orange-400" />
              </div>

              {/* Lifecycle + Agreements */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-slate-300">Project Lifecycle Distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "Prematurity", key: "prematurity", color: "bg-sky-500", cls: "text-sky-400" },
                      { label: "Mature Production", key: "mature_production", color: "bg-emerald-500", cls: "text-emerald-400" },
                      { label: "Closed", key: "closed", color: "bg-slate-500", cls: "text-slate-400" },
                    ].map((item) => {
                      const val = (summary?.projects?.lifecycle as any)?.[item.key] ?? 0;
                      const total = summary?.projects?.total ?? 1;
                      const pct = total ? Math.round((val / total) * 100) : 0;
                      return (
                        <div key={item.key}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className={item.cls}>{item.label}</span>
                            <span className="text-slate-400">{val} ({pct}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-700">
                            <div
                              className={cn("h-2 rounded-full", item.color)}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-slate-300">Agreement Status Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {Object.entries(summary?.agreements?.byStatus ?? {}).map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between">
                        <span className="text-sm text-slate-400 capitalize">{status.replace(/_/g, " ")}</span>
                        <span className="text-sm font-medium text-white">{count as number}</span>
                      </div>
                    ))}
                    {!Object.keys(summary?.agreements?.byStatus ?? {}).length && (
                      <p className="text-sm text-slate-500">No agreements yet</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Project list */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-slate-300">All Projects</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Name</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Location</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Status</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Lifecycle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {(summary?.projects?.list as any[] ?? []).map((p: any) => (
                          <tr key={p.id} className="hover:bg-slate-700/20">
                            <td className="px-4 py-2 text-white font-medium">{p.name}</td>
                            <td className="px-4 py-2 text-slate-400">{p.location}</td>
                            <td className="px-4 py-2">
                              <span className="text-xs text-slate-400 capitalize">{p.status?.replace(/_/g, " ")}</span>
                            </td>
                            <td className="px-4 py-2">
                              <LifecycleChip status={p.lifecycleStatus} />
                            </td>
                          </tr>
                        ))}
                        {!(summary?.projects?.list as any[])?.length && (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No projects</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── PARTNERS ────────────────────────────────────────── */}
        <TabsContent value="partners" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-56 text-sm">
                <SelectValue placeholder="All partners" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="_all" className="text-slate-300">All partners</SelectItem>
                {(partners ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-300">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-slate-500">
              {partnerReport?.statements?.length ?? 0} partner{(partnerReport?.statements?.length ?? 0) !== 1 ? "s" : ""} shown
            </span>
          </div>

          {partnerLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-4 space-y-2">
                    <Skeleton className="h-4 w-40 bg-slate-700" />
                    <Skeleton className="h-3 w-64 bg-slate-700" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (partnerReport?.statements ?? []).length === 0 ? (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="py-16 text-center">
                <Users className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No partner statements found</p>
              </CardContent>
            </Card>
          ) : (
            (partnerReport?.statements ?? []).map((stmt: any, i: number) => (
              <Card key={i} className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-3 flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="text-base text-white">{stmt.partner?.name}</CardTitle>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {stmt.partner?.phone && `📞 ${stmt.partner.phone}`}
                      {stmt.partner?.address && ` · ${stmt.partner.address}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">
                    {stmt.claimants ?? 0} claimant{(stmt.claimants ?? 0) !== 1 ? "s" : ""}
                  </Badge>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-700/30 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-2">Agreements</p>
                    <p className="text-lg font-bold text-white">{stmt.agreements?.total ?? 0}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {stmt.agreements?.active ?? 0} active · {(stmt.agreements?.totalLandArea ?? 0).toFixed(2)} kani
                    </p>
                  </div>
                  <div className="bg-slate-700/30 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-2">Contributions</p>
                    <p className="text-lg font-bold text-emerald-400">
                      {fmt(stmt.contributions?.totalAmount, "₹")}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {fmt(stmt.contributions?.verifiedAmount, "₹")} verified
                    </p>
                  </div>
                  <div className="bg-slate-700/30 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-2">By Contribution Type</p>
                    {Object.entries(stmt.contributions?.byType ?? {}).length > 0 ? (
                      Object.entries(stmt.contributions?.byType ?? {}).map(([type, amt]) => (
                        <div key={type} className="flex justify-between text-xs">
                          <span className="text-slate-400 capitalize">{type.replace(/_/g, " ")}</span>
                          <span className="text-white">{fmt(amt as number, "₹")}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500">No contributions</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── PRODUCTION ──────────────────────────────────────── */}
        <TabsContent value="production" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-56 text-sm">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="_all" className="text-slate-300">All projects</SelectItem>
                {(projects ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-300">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {productionLoading ? (
            <Skeleton className="h-64 w-full bg-slate-700/50 rounded-lg" />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {(() => {
                  const pt = productionReport?.production?.totals as any;
                  const st = productionReport?.sales?.totals as any;
                  return (
                    <>
                      <KpiCard label="Total Production (kg)" value={fmt(pt?.totalKg)} icon={Leaf} color="text-green-400" />
                      <KpiCard label="Production Revenue" value={fmt(pt?.totalRevenue, "₹")} icon={TrendingUp} color="text-emerald-400" />
                      <KpiCard label="Sales Value" value={fmt(st?.totalSales, "₹")} icon={TrendingUp} color="text-cyan-400" />
                      <KpiCard label="Transactions" value={st?.transactionCount ?? 0} icon={FileText} color="text-blue-400" />
                    </>
                  );
                })()}
              </div>

              {/* Monthly production chart */}
              {(productionReport?.production?.byMonth as any[])?.length > 0 && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-slate-300">Monthly Production vs. Sales (kg)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={(productionReport?.production?.byMonth as any[]).map((row: any) => {
                          const salesRow = (productionReport?.sales?.byMonth as any[])?.find(
                            (s: any) => s.month === row.month,
                          );
                          return {
                            month: String(row.month ?? ""),
                            production: parseFloat(String(row.totalKg ?? "0")),
                            sales: parseFloat(String(salesRow?.totalQuantityKg ?? "0")),
                          };
                        })}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", color: "#f8fafc" }}
                        />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Bar dataKey="production" fill="#22c55e" name="Production (kg)" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="sales" fill="#06b6d4" name="Sales Qty (kg)" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Monthly table */}
              {(productionReport?.production?.byMonth as any[])?.length > 0 && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-slate-300">Monthly Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Month</th>
                            <th className="px-4 py-2 text-right text-xs text-slate-400 font-medium">Production (kg)</th>
                            <th className="px-4 py-2 text-right text-xs text-slate-400 font-medium">Revenue (₹)</th>
                            <th className="px-4 py-2 text-right text-xs text-slate-400 font-medium">Sales Value (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {(productionReport?.production?.byMonth as any[]).map((row: any) => {
                            const salesRow = (productionReport?.sales?.byMonth as any[])?.find(
                              (s: any) => s.month === row.month,
                            );
                            return (
                              <tr key={row.month} className="hover:bg-slate-700/20">
                                <td className="px-4 py-2 text-white">{row.month}</td>
                                <td className="px-4 py-2 text-right text-slate-300">{fmt(row.totalKg)}</td>
                                <td className="px-4 py-2 text-right text-slate-300">{fmt(row.revenue, "₹")}</td>
                                <td className="px-4 py-2 text-right text-emerald-400">{fmt(salesRow?.totalSales, "₹")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!(productionReport?.production?.byMonth as any[])?.length && !productionLoading && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="py-16 text-center">
                    <Leaf className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">No production records found</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── GOVERNANCE ──────────────────────────────────────── */}
        <TabsContent value="governance" className="mt-4 space-y-4">
          {govLoading ? (
            <Skeleton className="h-64 w-full bg-slate-700/50 rounded-lg" />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Overall Score" value={`${govHealth?.overallScore ?? 0}%`} icon={ShieldCheck} color={
                  (govHealth?.overallScore ?? 0) >= 80 ? "text-emerald-400" :
                  (govHealth?.overallScore ?? 0) >= 50 ? "text-amber-400" : "text-red-400"
                } />
                <KpiCard label="Complete" value={govHealth?.completeCount ?? 0} icon={CheckCircle2} color="text-emerald-400" />
                <KpiCard label="Needs Attention" value={govHealth?.attentionCount ?? 0} icon={AlertTriangle} color="text-red-400" />
                <KpiCard label="Incomplete" value={govHealth?.incompleteCount ?? 0} icon={XCircle} color="text-amber-400" />
              </div>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-slate-300">Project Governance Health</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Project</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Lifecycle</th>
                          <th className="px-4 py-2 text-center text-xs text-slate-400 font-medium">Nominee</th>
                          <th className="px-4 py-2 text-center text-xs text-slate-400 font-medium">Agreements</th>
                          <th className="px-4 py-2 text-center text-xs text-slate-400 font-medium">Score</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Status</th>
                          <th className="px-4 py-2 text-left text-xs text-slate-400 font-medium">Issues</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {(govHealth?.projects as any[] ?? []).map((p: any) => (
                          <tr key={p.projectId} className="hover:bg-slate-700/20">
                            <td className="px-4 py-2 text-white font-medium">{p.projectName}</td>
                            <td className="px-4 py-2"><LifecycleChip status={p.lifecycleStatus} /></td>
                            <td className="px-4 py-2 text-center">
                              {p.hasNominee
                                ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                                : <XCircle className="h-4 w-4 text-red-400 mx-auto" />}
                            </td>
                            <td className="px-4 py-2 text-center text-slate-300">
                              {p.activeAgreements}/{p.totalAgreements}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className={cn(
                                "font-bold text-sm",
                                p.score >= 80 ? "text-emerald-400" : p.score >= 50 ? "text-amber-400" : "text-red-400",
                              )}>
                                {p.score}%
                              </span>
                            </td>
                            <td className="px-4 py-2"><GovernanceStatusBadge status={p.status} /></td>
                            <td className="px-4 py-2">
                              {(p.issues as string[]).length > 0 ? (
                                <ul className="text-xs text-slate-400 space-y-0.5">
                                  {(p.issues as string[]).map((issue: string, i: number) => (
                                    <li key={i}>{issue}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-xs text-emerald-400">All clear</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!(govHealth?.projects as any[])?.length && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                              No projects found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── ACTIVITY ────────────────────────────────────────── */}
        <TabsContent value="activity" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-56 text-sm">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="_all" className="text-slate-300">All projects</SelectItem>
                {(projects ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-300">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-slate-500">{activityReport?.total ?? 0} events</span>
          </div>

          {activityLoading ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full bg-slate-700/50 rounded-lg" />
              ))}
            </div>
          ) : (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-0">
                {(activityReport?.activities ?? []).length === 0 ? (
                  <div className="py-16 text-center">
                    <Activity className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">No activity found</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700/50">
                    {(activityReport?.activities as any[]).map((a: any) => (
                      <div key={a.id} className="flex gap-3 px-4 py-3 hover:bg-slate-700/20">
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center mt-0.5">
                          <Activity className="h-4 w-4 text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white">{a.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-500">
                              {a.entityType} · {a.type}
                            </span>
                            {a.projectId && (
                              <span className="text-xs text-blue-400">project</span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-slate-500 flex-shrink-0">
                          {format(new Date(a.createdAt), "d MMM, HH:mm")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
