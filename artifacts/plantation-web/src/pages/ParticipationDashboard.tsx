import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import {
  useListContributions,
  useListPendingVerificationContributions,
  useGetOwnershipSummary,
  useGetGovernanceSummary,
  useListProjects,
  getListContributionsQueryKey,
  getListPendingVerificationContributionsQueryKey,
  getGetOwnershipSummaryQueryKey,
  getGetGovernanceSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  ContributionEntry,
  OwnershipPartnerEntry,
  ProjectOwnershipDetail,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Scale,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  Landmark,
  Users,
  ArrowRight,
  Info,
  BarChart3,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Palette ────────────────────────────────────────────────────────────────────

const PARTNER_COLORS = [
  "#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444",
  "#06b6d4","#ec4899","#14b8a6","#f97316","#6366f1",
];
function partnerColor(i: number) { return PARTNER_COLORS[i % PARTNER_COLORS.length]; }

const TYPE_COLOR: Record<string, string> = {
  land_notional: "#10b981",
  economic_investment: "#3b82f6",
  operational_cost: "#f59e0b",
};
const TYPE_LABEL: Record<string, string> = {
  land_notional: "Land Notional",
  economic_investment: "Economic Investment",
  operational_cost: "Operational Cost",
};

const STATUS_COLOR: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending_verification: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function fmtCompact(n: number) {
  if (n >= 10_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  return fmt(n);
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          {Icon && <Icon className="w-3 h-3" />} {label}
        </p>
        <p className={cn("text-2xl font-semibold tabular-nums leading-none", accent)}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Ownership guidance cards ──────────────────────────────────────────────────

function OwnershipGuidanceCards({ projects }: { projects: ProjectOwnershipDetail[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-muted-foreground text-sm gap-2">
        <Scale className="w-8 h-8 opacity-30" />
        <p>No verified contributions to compute ownership yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {projects.map((p) => {
        const isOpen = expanded === p.projectId;
        const top = p.entries[0];
        return (
          <Card
            key={p.projectId}
            className={cn(
              "cursor-pointer hover:shadow-md transition-shadow",
              p.isFrozen && "border-amber-300 dark:border-amber-700",
            )}
            onClick={() => setExpanded(isOpen ? null : p.projectId)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-semibold">{p.projectName}</CardTitle>
                  <p className="text-xs text-muted-foreground capitalize">{p.lifecycleStatus.replace(/_/g, " ")}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {p.isFrozen && (
                    <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 text-xs">Frozen</Badge>
                  )}
                  <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {p.totalRecognizedAmount === 0 ? (
                <p className="text-xs text-muted-foreground">No verified contributions yet.</p>
              ) : (
                <>
                  {/* Stacked bar */}
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden flex">
                    {p.entries.map((e, idx) => (
                      <Tooltip key={e.partnerKey}>
                        <TooltipTrigger asChild>
                          <div className="h-full" style={{ width: `${e.percentage}%`, background: partnerColor(idx) }} />
                        </TooltipTrigger>
                        <TooltipContent>{e.partnerName}: {e.percentage.toFixed(2)}%</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  {/* Top partner */}
                  {top && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: partnerColor(0) }} />
                        <span className="font-medium truncate">{top.partnerName}</span>
                      </span>
                      <span className="font-bold">{top.percentage.toFixed(2)}%</span>
                    </div>
                  )}
                  {/* Expanded breakdown */}
                  {isOpen && (
                    <div className="pt-1 space-y-1.5 border-t mt-2">
                      {p.entries.map((e, idx) => (
                        <div key={e.partnerKey} className="flex items-center gap-2 text-xs">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: partnerColor(idx) }} />
                          <span className="flex-1 truncate">{e.partnerName}</span>
                          <span className="tabular-nums text-muted-foreground">{fmt(e.totalAmount)}</span>
                          <span className="tabular-nums font-semibold w-14 text-right">{e.percentage.toFixed(2)}%</span>
                        </div>
                      ))}
                      <div className="pt-1 border-t flex items-center justify-between text-xs text-muted-foreground">
                        <span>Total recognized</span>
                        <span className="font-medium">{fmt(p.totalRecognizedAmount)}</span>
                      </div>
                      <Link href="/ownership">
                        <a className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1">
                          Full detail <ArrowRight className="w-3 h-3" />
                        </a>
                      </Link>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Partner-wise contribution table ──────────────────────────────────────────

function PartnerContributionTable({ contributions }: { contributions: ContributionEntry[] }) {
  type Row = {
    partnerKey: string;
    partnerName: string;
    land: number;
    economic: number;
    operational: number;
    total: number;
    verified: number;
    pending: number;
    rejected: number;
  };

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const c of contributions) {
      const key = c.partnerId ?? c.partnerName;
      const existing = map.get(key) ?? {
        partnerKey: key,
        partnerName: c.partnerName,
        land: 0, economic: 0, operational: 0, total: 0,
        verified: 0, pending: 0, rejected: 0,
      };
      const amt = c.amount ?? 0;
      existing.total += amt;
      if (c.contributionType === "land_notional") existing.land += amt;
      else if (c.contributionType === "economic_investment") existing.economic += amt;
      else existing.operational += amt;
      if (c.verificationStatus === "verified") existing.verified += amt;
      else if (c.verificationStatus === "pending_verification") existing.pending += amt;
      else if (c.verificationStatus === "rejected") existing.rejected += amt;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [contributions]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No contribution data available.</p>;
  }

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partner</TableHead>
            <TableHead className="text-right">
              <span className="flex items-center justify-end gap-1"><Landmark className="w-3.5 h-3.5" />Land</span>
            </TableHead>
            <TableHead className="text-right">
              <span className="flex items-center justify-end gap-1"><TrendingUp className="w-3.5 h-3.5" />Economic</span>
            </TableHead>
            <TableHead className="text-right font-semibold">Total</TableHead>
            <TableHead className="text-right text-emerald-600">Verified</TableHead>
            <TableHead className="text-right text-amber-600">Pending</TableHead>
            <TableHead className="text-right text-red-600">Rejected</TableHead>
            <TableHead className="text-right">% of Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, idx) => (
            <TableRow key={r.partnerKey}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: partnerColor(idx) }} />
                  <span className="font-medium text-sm">{r.partnerName}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{r.land > 0 ? fmt(r.land) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{r.economic > 0 ? fmt(r.economic) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold text-sm">{fmt(r.total)}</TableCell>
              <TableCell className="text-right tabular-nums text-sm text-emerald-600">{r.verified > 0 ? fmt(r.verified) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums text-sm text-amber-600">{r.pending > 0 ? fmt(r.pending) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums text-sm text-red-600">{r.rejected > 0 ? fmt(r.rejected) : "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${grandTotal > 0 ? (r.total / grandTotal) * 100 : 0}%`, background: partnerColor(idx) }} />
                  </div>
                  <span className="tabular-nums text-xs font-medium w-10 text-right">
                    {grandTotal > 0 ? ((r.total / grandTotal) * 100).toFixed(1) : "0"}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 bg-muted/30">
            <TableCell className="font-semibold text-sm">Total</TableCell>
            <TableCell className="text-right tabular-nums font-medium text-sm">{fmt(rows.reduce((s, r) => s + r.land, 0))}</TableCell>
            <TableCell className="text-right tabular-nums font-medium text-sm">{fmt(rows.reduce((s, r) => s + r.economic, 0))}</TableCell>
            <TableCell className="text-right tabular-nums font-bold text-sm">{fmt(grandTotal)}</TableCell>
            <TableCell className="text-right tabular-nums font-medium text-sm text-emerald-600">{fmt(rows.reduce((s, r) => s + r.verified, 0))}</TableCell>
            <TableCell className="text-right tabular-nums font-medium text-sm text-amber-600">{fmt(rows.reduce((s, r) => s + r.pending, 0))}</TableCell>
            <TableCell className="text-right tabular-nums font-medium text-sm text-red-600">{fmt(rows.reduce((s, r) => s + r.rejected, 0))}</TableCell>
            <TableCell className="text-right font-bold text-sm">100%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

// ── Contribution trend chart ──────────────────────────────────────────────────

function ContributionTrendChart({ contributions }: { contributions: ContributionEntry[] }) {
  const chartData = useMemo(() => {
    // Group by month × contributionType — only verified entries
    const verified = contributions.filter((c) => c.verificationStatus === "verified");
    if (verified.length === 0) return [];

    const monthMap = new Map<string, { land: number; economic: number; total: number }>();
    for (const c of verified) {
      const key = monthKey(c.createdAt ?? c.verifiedAt ?? new Date().toISOString());
      const existing = monthMap.get(key) ?? { land: 0, economic: 0, total: 0 };
      const amt = c.amount ?? 0;
      existing.total += amt;
      if (c.contributionType === "land_notional") existing.land += amt;
      else if (c.contributionType === "economic_investment") existing.economic += amt;
      monthMap.set(key, existing);
    }

    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        month: monthLabel(key),
        Land: Math.round(v.land / 1000),
        Economic: Math.round(v.economic / 1000),
        Total: Math.round(v.total / 1000),
      }));
  }, [contributions]);

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <BarChart3 className="w-8 h-8 opacity-30" />
        <p>No verified contributions yet — trend will appear once contributions are verified.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v: number) => `₹${v}K`} tick={{ fontSize: 11 }} />
        <ReTooltip
          formatter={(v: number, name: string) => [`₹${v.toLocaleString("en-IN")}K`, name]}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
        />
        <Legend />
        <Bar dataKey="Land" fill="#10b981" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Economic" fill="#3b82f6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Contribution breakdown donut ──────────────────────────────────────────────

function ContributionBreakdownChart({ contributions }: { contributions: ContributionEntry[] }) {
  const verified = contributions.filter((c) => c.verificationStatus === "verified");
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of verified) {
      map.set(c.contributionType, (map.get(c.contributionType) ?? 0) + (c.amount ?? 0));
    }
    return [...map.entries()].map(([type, value]) => ({
      name: TYPE_LABEL[type] ?? type,
      value,
      fill: TYPE_COLOR[type] ?? "#94a3b8",
    }));
  }, [verified]);

  if (byType.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <BarChart3 className="w-8 h-8 opacity-30" />
        <p>No verified data yet.</p>
      </div>
    );
  }

  const total = byType.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-col items-center gap-4">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={byType} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2} dataKey="value">
            {byType.map((d, i) => <Cell key={i} fill={d.fill} stroke="transparent" />)}
          </Pie>
          <ReTooltip
            formatter={(v: number) => [fmt(v), ""]}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 w-full">
        {byType.map((d) => (
          <div key={d.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
              {d.name}
            </span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-muted-foreground">{fmt(d.value)}</span>
              <span className="font-semibold w-10 text-right">{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Contribution history timeline ─────────────────────────────────────────────

function ContributionTimeline({ contributions }: { contributions: ContributionEntry[] }) {
  const recent = useMemo(
    () =>
      [...contributions]
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, 15),
    [contributions],
  );

  if (recent.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No contributions recorded.</p>;
  }

  return (
    <div className="relative pl-6 space-y-0">
      {/* Vertical line */}
      <div className="absolute left-2.5 top-2 bottom-2 w-px bg-border" />

      {recent.map((c) => {
        const statusColor = {
          verified: "bg-emerald-500",
          pending_verification: "bg-amber-400",
          draft: "bg-slate-400",
          rejected: "bg-red-500",
          disputed: "bg-red-600",
          submitted: "bg-blue-400",
        }[c.verificationStatus] ?? "bg-slate-400";

        return (
          <div key={c.id} className="relative py-2.5">
            <span className={cn("absolute -left-[14px] top-[18px] w-3 h-3 rounded-full border-2 border-background", statusColor)} />
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-sm">{c.partnerName}</span>
                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                    {TYPE_LABEL[c.contributionType] ?? c.contributionType}
                  </Badge>
                  <Badge className={cn("text-xs px-1.5 py-0", STATUS_COLOR[c.verificationStatus] ?? "")}>
                    {c.verificationStatus.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.projectName && <span className="text-foreground/70">{c.projectName} · </span>}
                  {c.remarks ? c.remarks.slice(0, 60) + (c.remarks.length > 60 ? "…" : "") : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-sm tabular-nums">{fmt(c.amount ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{shortDate(c.createdAt ?? new Date().toISOString())}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Pending verifications panel ───────────────────────────────────────────────

function PendingVerificationsPanel({ contributions }: { contributions: ContributionEntry[] }) {
  if (contributions.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-emerald-600">
        <CheckCircle2 className="w-4 h-4" />
        <span>No pending verifications — all contributions are up to date.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contributions.map((c) => (
        <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800">
          <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium">{c.partnerName}</span>
            <span className="text-muted-foreground"> · {TYPE_LABEL[c.contributionType] ?? c.contributionType}</span>
            {c.projectName && <span className="text-muted-foreground"> · {c.projectName}</span>}
            {c.remarks && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.remarks}</p>}
          </div>
          <span className="tabular-nums font-semibold text-sm shrink-0">{fmt(c.amount ?? 0)}</span>
        </div>
      ))}
      <Link href="/contributions/economic">
        <a className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline pt-1">
          Manage verifications <ArrowRight className="w-3 h-3" />
        </a>
      </Link>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function ParticipationDashboard() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const effectiveProject = selectedProjectId ?? (projectFilter !== "all" ? projectFilter : undefined);

  // Data fetches
  const allContributionsQuery = useListContributions(
    effectiveProject ? { projectId: effectiveProject } : {},
    { query: { queryKey: getListContributionsQueryKey(effectiveProject ? { projectId: effectiveProject } : {}) } },
  );
  const pendingQuery = useListPendingVerificationContributions(
    {},
    { query: { queryKey: getListPendingVerificationContributionsQueryKey({}) } },
  );
  const ownershipQuery = useGetOwnershipSummary(
    effectiveProject ? { projectId: effectiveProject } : {},
    { query: { queryKey: getGetOwnershipSummaryQueryKey(effectiveProject ? { projectId: effectiveProject } : {}) } },
  );
  const governanceQuery = useGetGovernanceSummary({
    query: { queryKey: getGetGovernanceSummaryQueryKey() },
  });
  const projectsQuery = useListProjects({
    query: { queryKey: ["projects"] },
  });

  const allContributions: ContributionEntry[] = allContributionsQuery.data?.contributions ?? [];
  const pendingItems: ContributionEntry[] = pendingQuery.data?.contributions ?? [];
  const ownershipProjects: ProjectOwnershipDetail[] = ownershipQuery.data?.projects ?? [];
  const projects = projectsQuery.data ?? [];

  // Derived KPIs
  const verified = allContributions.filter((c) => c.verificationStatus === "verified");
  const rejected = allContributions.filter((c) => c.verificationStatus === "rejected");
  const verifiedTotal = verified.reduce((s, c) => s + (c.amount ?? 0), 0);
  const landTotal = verified.filter((c) => c.contributionType === "land_notional").reduce((s, c) => s + (c.amount ?? 0), 0);
  const economicTotal = verified.filter((c) => c.contributionType === "economic_investment").reduce((s, c) => s + (c.amount ?? 0), 0);

  const uniquePartners = new Set(allContributions.map((c) => c.partnerId ?? c.partnerName)).size;

  // Governance rejected alerts
  const rejectedAlerts = (governanceQuery.data?.projectAlerts ?? []).flatMap((pa) =>
    pa.issues.filter((a: { code: string }) => a.code === "REJECTED_CONTRIBUTION"),
  );

  const isAdminOrDev = role === "admin" || role === "developer";

  return (
    <div className="p-6 space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Scale className="w-6 h-6 text-blue-600" />
            Prematurity Ownership &amp; Economic Participation
          </h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0" />
            All ownership guidance shown here is{" "}
            <strong className="text-amber-600 dark:text-amber-400">Prematurity Ownership Guidance</strong>
            {" "}— not legally binding until the maturity declaration freeze.
          </p>
        </div>
        {projects.length > 0 && !selectedProjectId && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-48 h-8 text-sm">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {(projects as Array<{ id: string; name: string }>).filter((p) => p.id).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Guidance disclaimer banner ──────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-amber-50/60 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-sm">Prematurity Ownership Guidance</span>
          <p className="mt-0.5">
            Ownership percentages are dynamic approximations based on verified recognized contributions (land notional + economic investment). They will fluctuate as new contributions are added and verified. The formal ownership structure is locked only when the Maturity Declaration workflow is completed by an admin. Operational costs are excluded from ownership calculations.
          </p>
        </div>
      </div>

      {/* ── Rejected contribution alerts ──────────────────────────────────── */}
      {(rejected.length > 0 || rejectedAlerts.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-red-50/60 dark:bg-red-950/10 border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            <XCircle className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">{rejected.length} rejected contribution{rejected.length !== 1 ? "s" : ""}</span>
              {" "}require resolution. Rejected contributions are excluded from ownership calculations and surfaced as governance alerts.
            </div>
            <Link href="/contributions/economic">
              <a className="flex items-center gap-1 text-xs hover:underline shrink-0">
                Review <ArrowRight className="w-3 h-3" />
              </a>
            </Link>
          </div>
          {rejected.slice(0, 3).map((c) => (
            <div key={c.id} className="flex items-start gap-3 p-2.5 rounded border bg-red-50/30 dark:bg-red-950/5 border-red-100 dark:border-red-900 ml-2 text-sm">
              <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              <span className="font-medium">{c.partnerName}</span>
              <span className="text-muted-foreground">{TYPE_LABEL[c.contributionType] ?? c.contributionType}</span>
              {c.projectName && <span className="text-muted-foreground">· {c.projectName}</span>}
              <span className="ml-auto tabular-nums font-medium text-red-700">{fmt(c.amount ?? 0)}</span>
            </div>
          ))}
          {rejected.length > 3 && (
            <p className="text-xs text-muted-foreground ml-2">+{rejected.length - 3} more — <Link href="/contributions/economic"><a className="text-blue-600 hover:underline">view all</a></Link></p>
          )}
        </div>
      )}

      {/* ── KPI row ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Verified Contributions"
          value={verified.length}
          sub={`${allContributions.length} total records`}
          icon={CheckCircle2}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label="Total Verified Amount"
          value={fmtCompact(verifiedTotal)}
          sub="land + economic"
          icon={Scale}
          accent="text-blue-600 dark:text-blue-400"
        />
        <KpiCard
          label="Land Notional"
          value={fmtCompact(landTotal)}
          sub={verifiedTotal > 0 ? `${((landTotal / verifiedTotal) * 100).toFixed(1)}% of verified` : "—"}
          icon={Landmark}
        />
        <KpiCard
          label="Economic Investment"
          value={fmtCompact(economicTotal)}
          sub={verifiedTotal > 0 ? `${((economicTotal / verifiedTotal) * 100).toFixed(1)}% of verified` : "—"}
          icon={TrendingUp}
        />
        <KpiCard
          label="Pending Verification"
          value={pendingItems.length}
          sub="awaiting review"
          icon={Clock}
          accent={pendingItems.length > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
        <KpiCard
          label="Active Partners"
          value={uniquePartners}
          sub="with contributions"
          icon={Users}
          accent={uniquePartners === 0 ? "text-muted-foreground" : undefined}
        />
      </div>

      {/* ── Ownership guidance + charts row ──────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Ownership guidance cards — takes 2 columns */}
        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-blue-600" />
              Prematurity Ownership Guidance
            </h2>
            <Link href="/ownership">
              <a className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                Full ownership view <ArrowRight className="w-3 h-3" />
              </a>
            </Link>
          </div>
          {ownershipQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-4">
              {[1, 2].map((i) => <Card key={i} className="h-24 animate-pulse" />)}
            </div>
          ) : (
            <OwnershipGuidanceCards projects={ownershipProjects.filter((p) => p.totalRecognizedAmount > 0)} />
          )}
          {ownershipProjects.length > 0 && ownershipProjects.every((p) => p.totalRecognizedAmount === 0) && (
            <p className="text-sm text-muted-foreground">No verified contributions yet — ownership cannot be computed.</p>
          )}
        </div>

        {/* Breakdown donut — 1 column */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Verified by Type</CardTitle>
            <CardDescription className="text-xs">Land notional vs. economic investment (verified only)</CardDescription>
          </CardHeader>
          <CardContent>
            <ContributionBreakdownChart contributions={allContributions} />
          </CardContent>
        </Card>
      </div>

      {/* ── Trend chart ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            Contribution Trend (Verified, by Month)
          </CardTitle>
          <CardDescription className="text-xs">Monthly verified land + economic contributions in thousands INR</CardDescription>
        </CardHeader>
        <CardContent>
          <ContributionTrendChart contributions={allContributions} />
        </CardContent>
      </Card>

      {/* ── Partner-wise contribution table ──────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-600" />
                Partner-wise Contribution Summary
              </CardTitle>
              <CardDescription className="text-xs">All contribution types, all statuses — aggregated by partner</CardDescription>
            </div>
            <Link href="/contributions">
              <a className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                Manage <ArrowRight className="w-3 h-3" />
              </a>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {allContributionsQuery.isLoading ? (
            <div className="h-20 animate-pulse m-4 rounded" />
          ) : (
            <PartnerContributionTable contributions={allContributions} />
          )}
        </CardContent>
      </Card>

      {/* ── Pending verifications + Timeline row ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-600" />
                  Pending Verifications
                  {pendingItems.length > 0 && (
                    <Badge className="ml-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">
                      {pendingItems.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Contributions awaiting your review or action</CardDescription>
              </div>
              {isAdminOrDev && (
                <Link href="/contributions/economic" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                  Review all <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <PendingVerificationsPanel contributions={pendingItems} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Contribution History</CardTitle>
            <CardDescription className="text-xs">Most recent 15 contributions across all types and statuses</CardDescription>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto pr-1">
            {allContributionsQuery.isLoading ? (
              <div className="h-20 animate-pulse rounded" />
            ) : (
              <ContributionTimeline contributions={allContributions} />
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
