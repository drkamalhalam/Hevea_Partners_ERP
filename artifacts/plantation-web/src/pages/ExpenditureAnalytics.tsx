import { useState, useMemo } from "react";
import {
  useGetExpenditureSummary,
  useListExpenditures,
  useGetBurdenSummary,
  useGetAdvanceSummary,
  useListProjects,
} from "@workspace/api-client-react";
import type {
  ExpenditureEntry,
  ExpenditureSummaryProjectsItem,
  BurdenSummaryProjectsItem,
  AdvanceSummaryByPartyRoleItem,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  ReceiptText,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowLeftRight,
  HandCoins,
  ChevronDown,
  ChevronRight,
  IndianRupee,
  BarChart3,
} from "lucide-react";

// ── Format helpers ────────────────────────────────────────────────────────────

const INR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const SHORT = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};

const CATEGORY_COLORS: Record<string, string> = {
  labor: "#3b82f6",
  fertilizer: "#22c55e",
  transport: "#f59e0b",
  machinery: "#8b5cf6",
  maintenance: "#06b6d4",
  consumables: "#f97316",
  plantation_operations: "#10b981",
  miscellaneous: "#94a3b8",
};

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#10b981", "#94a3b8"];

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  isAmount?: boolean;
  sub?: string;
  color?: "blue" | "green" | "amber" | "red" | "purple" | "orange";
  Icon: React.ElementType;
  loading?: boolean;
}

function KpiCard({ label, value, isAmount, sub, color = "blue", Icon, loading }: KpiCardProps) {
  const colorMap = {
    blue: { bg: "bg-blue-50", icon: "text-blue-600", val: "text-blue-800", border: "border-blue-100" },
    green: { bg: "bg-emerald-50", icon: "text-emerald-600", val: "text-emerald-800", border: "border-emerald-100" },
    amber: { bg: "bg-amber-50", icon: "text-amber-600", val: "text-amber-800", border: "border-amber-100" },
    red: { bg: "bg-red-50", icon: "text-red-600", val: "text-red-800", border: "border-red-100" },
    purple: { bg: "bg-violet-50", icon: "text-violet-600", val: "text-violet-800", border: "border-violet-100" },
    orange: { bg: "bg-orange-50", icon: "text-orange-600", val: "text-orange-800", border: "border-orange-100" },
  };
  const c = colorMap[color];
  return (
    <Card className={cn("border", c.border)}>
      <CardContent className={cn("p-4", c.bg)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
            {loading ? (
              <Skeleton className="h-7 w-28 mt-1" />
            ) : (
              <p className={cn("text-xl font-bold leading-tight", c.val)}>
                {isAmount ? SHORT(Number(value)) : value}
              </p>
            )}
            {sub && !loading && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
          </div>
          <div className={cn("p-2 rounded-lg", c.bg, "shrink-0")}>
            <Icon className={cn("w-5 h-5", c.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Monthly Trend Chart ───────────────────────────────────────────────────────

function MonthlyTrendChart({ expenditures, loading }: { expenditures: ExpenditureEntry[]; loading: boolean }) {
  const data = useMemo(() => {
    const byMonth: Record<string, { total: number; approved: number; pending: number; rejected: number }> = {};
    for (const exp of expenditures) {
      const month = exp.expenditureDate.slice(0, 7);
      if (!byMonth[month]) byMonth[month] = { total: 0, approved: 0, pending: 0, rejected: 0 };
      // NPF-safe: exp.amount may become a decimal string post-migration.
      const amt = Number(exp.amount ?? 0);
      byMonth[month].total += amt;
      if (exp.verificationStatus === "approved") byMonth[month].approved += amt;
      else if (exp.verificationStatus === "pending_review") byMonth[month].pending += amt;
      else if (exp.verificationStatus === "rejected") byMonth[month].rejected += amt;
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-10)
      .map(([month, d]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        Total: d.total,
        Approved: d.approved,
        Pending: d.pending,
        Rejected: d.rejected,
      }));
  }, [expenditures]);

  if (loading) return <Skeleton className="h-56 w-full" />;
  if (data.length === 0)
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        No expenditure data available for trend
      </div>
    );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradApproved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => SHORT(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={60} />
        <Tooltip
          formatter={(v: number, name: string) => [INR(v), name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="Total" stroke="#3b82f6" strokeWidth={2} fill="url(#gradTotal)" dot={false} />
        <Area type="monotone" dataKey="Approved" stroke="#22c55e" strokeWidth={2} fill="url(#gradApproved)" dot={false} />
        <Area type="monotone" dataKey="Pending" stroke="#f59e0b" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
        <Area type="monotone" dataKey="Rejected" stroke="#ef4444" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Category Breakdown Chart ─────────────────────────────────────────────────

function CategoryBreakdownChart({ projects, loading }: { projects: ExpenditureSummaryProjectsItem[]; loading: boolean }) {
  const data = useMemo(() => {
    const cats: Record<string, number> = {};
    for (const p of projects) {
      for (const cat of p.categoryBreakdown) {
        cats[cat.category] = (cats[cat.category] ?? 0) + Number(cat.amount ?? 0);
      }
    }
    return Object.entries(cats)
      .sort(([, a], [, b]) => b - a)
      .map(([category, amount]) => ({
        name: category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: amount,
        raw: category,
      }));
  }, [projects]);

  if (loading) return <Skeleton className="h-56 w-full" />;
  if (data.length === 0)
    return (
      <div className="h-56 flex items-center justify-center text-sm text-zinc-400">
        No category data
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={36}>
            {data.map((entry, i) => (
              <Cell key={entry.raw} fill={CATEGORY_COLORS[entry.raw] ?? PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => [INR(v), ""]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
        {data.slice(0, 6).map((d, i) => (
          <div key={d.raw} className="flex items-center justify-between text-xs gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: CATEGORY_COLORS[d.raw] ?? PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="text-zinc-600 truncate">{d.name}</span>
            </div>
            <span className="font-medium text-zinc-700 shrink-0">{SHORT(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Project Cost Table ────────────────────────────────────────────────────────

function ProjectCostTable({ projects, loading }: { projects: ExpenditureSummaryProjectsItem[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading)
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );

  if (projects.length === 0)
    return <p className="text-sm text-zinc-400 text-center py-8">No project expenditure data</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50">
            <th className="text-left py-2.5 px-3 font-semibold text-zinc-600 text-xs uppercase tracking-wide">Project</th>
            <th className="text-right py-2.5 px-3 font-semibold text-zinc-600 text-xs uppercase tracking-wide">Total</th>
            <th className="text-right py-2.5 px-3 font-semibold text-zinc-600 text-xs uppercase tracking-wide">Approved</th>
            <th className="text-right py-2.5 px-3 font-semibold text-zinc-600 text-xs uppercase tracking-wide">Pending</th>
            <th className="text-right py-2.5 px-3 font-semibold text-zinc-600 text-xs uppercase tracking-wide">Records</th>
            <th className="text-right py-2.5 px-3 font-semibold text-zinc-600 text-xs uppercase tracking-wide">% Approved</th>
            <th className="py-2.5 px-3 w-8" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const pct = p.totalAmount > 0 ? Math.round((p.approvedAmount / p.totalAmount) * 100) : 0;
            const isOpen = expanded === p.projectId;
            return (
              <>
                <tr
                  key={p.projectId}
                  className="border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : p.projectId)}
                >
                  <td className="py-2.5 px-3 font-medium text-zinc-800">{p.projectName}</td>
                  <td className="py-2.5 px-3 text-right font-semibold text-zinc-800">{INR(p.totalAmount)}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-700">{INR(p.approvedAmount)}</td>
                  <td className="py-2.5 px-3 text-right text-amber-600">{INR(p.pendingAmount)}</td>
                  <td className="py-2.5 px-3 text-right text-zinc-500">{p.count}</td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-zinc-500 w-8 text-right">{pct}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                  </td>
                </tr>
                {isOpen && p.categoryBreakdown.length > 0 && (
                  <tr key={`${p.projectId}-exp`} className="bg-zinc-50/70">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {p.categoryBreakdown.map((cat) => (
                          <div
                            key={cat.category}
                            className="flex items-center justify-between bg-white border border-zinc-200 rounded-md px-2.5 py-1.5 text-xs"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: CATEGORY_COLORS[cat.category] ?? "#94a3b8" }}
                              />
                              <span className="text-zinc-600 truncate capitalize">
                                {cat.category.replace(/_/g, " ")}
                              </span>
                            </div>
                            <span className="font-semibold text-zinc-700 ml-2 shrink-0">{SHORT(cat.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
            <td className="py-2.5 px-3 text-zinc-700">All Projects</td>
            <td className="py-2.5 px-3 text-right text-zinc-800">
              {INR(projects.reduce((s, p) => s + Number(p.totalAmount ?? 0), 0))}
            </td>
            <td className="py-2.5 px-3 text-right text-emerald-700">
              {INR(projects.reduce((s, p) => s + Number(p.approvedAmount ?? 0), 0))}
            </td>
            <td className="py-2.5 px-3 text-right text-amber-600">
              {INR(projects.reduce((s, p) => s + Number(p.pendingAmount ?? 0), 0))}
            </td>
            <td className="py-2.5 px-3 text-right text-zinc-500">
              {projects.reduce((s, p) => s + p.count, 0)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Burden Analytics Chart ────────────────────────────────────────────────────

function BurdenAnalyticsSection({ projects, loading }: { projects: BurdenSummaryProjectsItem[]; loading: boolean }) {
  const data = useMemo(
    () =>
      projects
        .filter((p) => p.developerAdvanceAmount > 0 || p.landownerAdvanceAmount > 0)
        .sort((a, b) => b.developerAdvanceAmount + b.landownerAdvanceAmount - (a.developerAdvanceAmount + a.landownerAdvanceAmount))
        .slice(0, 8)
        .map((p) => ({
          name: p.projectName.length > 14 ? p.projectName.slice(0, 14) + "…" : p.projectName,
          "Dev Advance": p.developerAdvanceAmount,
          "Owner Advance": p.landownerAdvanceAmount,
          Recovered: p.recoveredAmount,
        })),
    [projects],
  );

  if (loading) return <Skeleton className="h-44 w-full" />;
  if (data.length === 0)
    return (
      <div className="h-44 flex items-center justify-center text-sm text-zinc-400">
        No unresolved burden imbalances
      </div>
    );

  return (
    <ResponsiveContainer width="100%" height={176}>
      <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => SHORT(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={50} />
        <Tooltip formatter={(v: number) => INR(v)} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
        <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Dev Advance" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        <Bar dataKey="Owner Advance" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
        <Bar dataKey="Recovered" fill="#22c55e" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Advances by Party Role ────────────────────────────────────────────────────

function AdvancesByRoleChart({ byRole, loading }: { byRole: AdvanceSummaryByPartyRoleItem[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-36 w-full" />;
  if (!byRole.length)
    return <p className="text-sm text-zinc-400 text-center py-8">No advance data</p>;

  return (
    <div className="space-y-2">
      {byRole.map((r, i) => (
        <div key={r.role} className="flex items-center gap-3">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-sm mb-0.5">
              <span className="capitalize font-medium text-zinc-700">{r.role.replace(/_/g, " ")}</span>
              <span className="font-semibold text-zinc-800">{SHORT(r.outstanding)}</span>
            </div>
            <div className="text-xs text-zinc-400">{r.count} advance{r.count !== 1 ? "s" : ""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Pending Approvals Mini-Table ──────────────────────────────────────────────

function PendingApprovalsTable({ expenditures, loading }: { expenditures: ExpenditureEntry[]; loading: boolean }) {
  const pending = useMemo(
    () => expenditures.filter((e) => e.verificationStatus === "pending_review").slice(0, 8),
    [expenditures],
  );

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (pending.length === 0)
    return (
      <div className="py-6 flex items-center justify-center gap-2 text-sm text-zinc-400">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        No pending approvals
      </div>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50">
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Date</th>
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Project</th>
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Category</th>
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Description</th>
            <th className="text-right py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Amount</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((e) => (
            <tr key={e.id} className="border-b border-zinc-50 hover:bg-amber-50/40">
              <td className="py-2 px-3 text-zinc-500">
                {new Date(e.expenditureDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </td>
              <td className="py-2 px-3 text-zinc-600 max-w-[120px] truncate">{e.projectName ?? "—"}</td>
              <td className="py-2 px-3">
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium capitalize"
                  style={{
                    background: (CATEGORY_COLORS[e.category] ?? "#94a3b8") + "22",
                    color: CATEGORY_COLORS[e.category] ?? "#64748b",
                  }}
                >
                  {e.category?.replace(/_/g, " ")}
                </span>
              </td>
              <td className="py-2 px-3 text-zinc-600 max-w-[180px] truncate">{e.description}</td>
              <td className="py-2 px-3 text-right font-semibold text-amber-700">{INR(e.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rejected Expenditures Table ───────────────────────────────────────────────

function RejectedTable({ expenditures, loading }: { expenditures: ExpenditureEntry[]; loading: boolean }) {
  const rejected = useMemo(
    () => expenditures.filter((e) => e.verificationStatus === "rejected").slice(0, 8),
    [expenditures],
  );

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (rejected.length === 0)
    return (
      <div className="py-6 flex items-center justify-center gap-2 text-sm text-zinc-400">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        No rejected expenditures
      </div>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50">
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Date</th>
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Project</th>
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Category</th>
            <th className="text-left py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Rejection Reason</th>
            <th className="text-right py-2 px-3 font-semibold text-zinc-500 uppercase tracking-wide">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rejected.map((e) => (
            <tr key={e.id} className="border-b border-zinc-50 hover:bg-red-50/40">
              <td className="py-2 px-3 text-zinc-500">
                {new Date(e.expenditureDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </td>
              <td className="py-2 px-3 text-zinc-600 max-w-[120px] truncate">{e.projectName ?? "—"}</td>
              <td className="py-2 px-3 capitalize text-zinc-600">{e.category?.replace(/_/g, " ")}</td>
              <td className="py-2 px-3 text-red-600 italic max-w-[200px] truncate">
                {e.verifierNotes ?? "No reason provided"}
              </td>
              <td className="py-2 px-3 text-right font-semibold text-red-700">{INR(e.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpenditureAnalytics() {
  const { role } = useRole();
  const [projectId, setProjectId] = useState<string>("all");

  const { data: projectsData } = useListProjects();
  const projects = projectsData ?? [];

  const pid = projectId === "all" ? undefined : projectId;

  const { data: summary, isLoading: loadingSummary } = useGetExpenditureSummary({ projectId: pid });
  const { data: expData, isLoading: loadingExp } = useListExpenditures({ projectId: pid });
  const { data: burdenData, isLoading: loadingBurden } = useGetBurdenSummary({ projectId: pid });
  const { data: advData, isLoading: loadingAdv } = useGetAdvanceSummary({ projectId: pid });

  const expenditures = expData?.expenditures ?? [];
  const expProjects = summary?.projects ?? [];
  const totals = summary?.totals;
  const burdenTotals = burdenData?.totals;
  const burdenProjects = burdenData?.projects ?? [];

  // Derived KPIs
  const rejectedCount = useMemo(
    () => expenditures.filter((e) => e.verificationStatus === "rejected").length,
    [expenditures],
  );

  const netBurdenImbalance = (burdenTotals?.developerAdvanceAmount ?? 0) + (burdenTotals?.landownerAdvanceAmount ?? 0);

  if (role !== "admin" && role !== "developer") {
    return (
      <div className="p-8 flex flex-col items-center gap-4 text-center">
        <BarChart3 className="w-12 h-12 text-zinc-300" />
        <div className="font-semibold text-zinc-600">Access Restricted</div>
        <p className="text-sm text-zinc-500">
          Expenditure analytics are available to Admin and Developer roles only.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* ERP Header */}
      <div className="bg-slate-900 text-white px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ReceiptText className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-bold tracking-tight">Operational Expenditure Dashboard</h1>
            </div>
            <p className="text-sm text-slate-400">
              Project-wise cost analytics, category breakdown, burden imbalances, and recoverable advances
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <label className="text-xs text-slate-400 font-medium uppercase tracking-wide">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-52 bg-slate-800 border-slate-700 text-white text-sm h-9">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p: { id: string; name: string }) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            label="Total Expenditure"
            value={totals?.totalAmount ?? 0}
            isAmount
            Icon={IndianRupee}
            color="blue"
            sub={`${totals?.count ?? 0} records`}
            loading={loadingSummary}
          />
          <KpiCard
            label="Approved"
            value={totals?.approvedAmount ?? 0}
            isAmount
            Icon={CheckCircle2}
            color="green"
            sub={totals ? `${Math.round((totals.approvedAmount / Math.max(totals.totalAmount, 1)) * 100)}% of total` : ""}
            loading={loadingSummary}
          />
          <KpiCard
            label="Pending Approval"
            value={totals?.pendingAmount ?? 0}
            isAmount
            Icon={Clock}
            color="amber"
            loading={loadingSummary}
          />
          <KpiCard
            label="Rejected"
            value={rejectedCount}
            Icon={XCircle}
            color="red"
            sub="expenditures"
            loading={loadingExp}
          />
          <KpiCard
            label="Advances Outstanding"
            value={advData?.totalOutstanding ?? 0}
            isAmount
            Icon={HandCoins}
            color="purple"
            sub={`${advData?.pendingCount ?? 0} pending`}
            loading={loadingAdv}
          />
          <KpiCard
            label="Burden Imbalance"
            value={netBurdenImbalance}
            isAmount
            Icon={ArrowLeftRight}
            color="orange"
            sub={`${burdenTotals?.recordCount ?? 0} records`}
            loading={loadingBurden}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Monthly Expenditure Trend</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <MonthlyTrendChart expenditures={expenditures} loading={loadingExp} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-violet-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Cost by Category</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <CategoryBreakdownChart projects={expProjects} loading={loadingSummary} />
            </CardContent>
          </Card>
        </div>

        {/* Project Cost Table */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-blue-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Project-wise Operational Cost</CardTitle>
              </div>
              <span className="text-xs text-zinc-400">Click row to expand category breakdown</span>
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ProjectCostTable projects={expProjects} loading={loadingSummary} />
          </CardContent>
        </Card>

        {/* Burden & Advances Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-orange-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Partner Burden Analytics</CardTitle>
              </div>
              {burdenTotals && (
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                    <span className="text-zinc-500">Dev Advance: </span>
                    <span className="font-semibold text-blue-700">{SHORT(burdenTotals.developerAdvanceAmount)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                    <span className="text-zinc-500">Owner Advance: </span>
                    <span className="font-semibold text-violet-700">{SHORT(burdenTotals.landownerAdvanceAmount)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                    <span className="text-zinc-500">Recovered: </span>
                    <span className="font-semibold text-emerald-700">{SHORT(burdenTotals.recoveredAmount)}</span>
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BurdenAnalyticsSection projects={burdenProjects} loading={loadingBurden} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <HandCoins className="w-4 h-4 text-violet-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Recoverable Advance Balances</CardTitle>
              </div>
              {advData && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { label: "Outstanding", val: advData.totalOutstanding, color: "text-violet-700" },
                    { label: "Overdue", val: advData.totalOverdue, color: "text-red-600" },
                    { label: "Recovered", val: advData.totalRecovered, color: "text-emerald-700" },
                    { label: "Written Off", val: advData.totalWrittenOff, color: "text-zinc-500" },
                  ].map((s) => (
                    <div key={s.label} className="bg-zinc-50 rounded-md px-2.5 py-2">
                      <div className="text-[10px] text-zinc-400 uppercase tracking-wide">{s.label}</div>
                      <div className={cn("text-sm font-bold", s.color)}>{SHORT(s.val)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <AdvancesByRoleChart byRole={advData?.byPartyRole ?? []} loading={loadingAdv} />
            </CardContent>
          </Card>
        </div>

        {/* Pending & Rejected Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Pending Approvals</CardTitle>
                {!loadingExp && (
                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200 text-xs ml-auto">
                    {expenditures.filter((e) => e.verificationStatus === "pending_review").length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <PendingApprovalsTable expenditures={expenditures} loading={loadingExp} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <CardTitle className="text-sm font-semibold text-zinc-700">Rejected Expenditures</CardTitle>
                {!loadingExp && (
                  <Badge variant="secondary" className="bg-red-100 text-red-700 border-red-200 text-xs ml-auto">
                    {rejectedCount}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <RejectedTable expenditures={expenditures} loading={loadingExp} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
