import { useState, useMemo } from "react";
import {
  useGetLandownerProfitabilityAnalytics,
  useListProjects,
  useListPartners,
} from "@workspace/api-client-react";
import type {
  LandownerProfitabilityAnalytics,
  YearlyProfitabilityRow,
  ProjectProfitabilityRow,
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  IndianRupee,
  AlertTriangle,
  CheckCircle2,
  Minus,
  BarChart3,
  ShieldCheck,
  Activity,
  Layers,
  Scale,
  Info,
} from "lucide-react";

// ── Formatters ────────────────────────────────────────────────────────────────
// NPF Stage 2 — accept string|number from server (numeric(15,2) columns).
import { parseNumeric } from "@/lib/numeric";

function fmt(raw: number | string | null | undefined): string {
  const n = parseNumeric(raw);
  const abs = Math.abs(n);
  if (abs >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtFull(raw: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(parseNumeric(raw));
}

function pct(raw: number | string | null | undefined): string {
  return `${parseNumeric(raw).toFixed(1)}%`;
}

// ── Rating helpers ─────────────────────────────────────────────────────────────

const PROFITABILITY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  strong:   { label: "Strong",   color: "text-emerald-400 bg-emerald-400/10 border-emerald-500/30", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  moderate: { label: "Moderate", color: "text-amber-400 bg-amber-400/10 border-amber-500/30",      icon: <Minus className="w-3.5 h-3.5" /> },
  at_risk:  { label: "At Risk",  color: "text-orange-400 bg-orange-400/10 border-orange-500/30",   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  critical: { label: "Critical", color: "text-rose-400 bg-rose-400/10 border-rose-500/30",         icon: <TrendingDown className="w-3.5 h-3.5" /> },
};

const COST_BURDEN_CONFIG: Record<string, { label: string; color: string }> = {
  low:      { label: "Low",      color: "text-emerald-400 bg-emerald-400/10 border-emerald-500/30" },
  moderate: { label: "Moderate", color: "text-amber-400 bg-amber-400/10 border-amber-500/30" },
  high:     { label: "High",     color: "text-orange-400 bg-orange-400/10 border-orange-500/30" },
  critical: { label: "Critical", color: "text-rose-400 bg-rose-400/10 border-rose-500/30" },
};

const LCA_CONFIG: Record<string, { label: string; color: string }> = {
  compliant:   { label: "Compliant",   color: "text-emerald-400 bg-emerald-400/10 border-emerald-500/30" },
  partial:     { label: "Partial",     color: "text-amber-400 bg-amber-400/10 border-amber-500/30" },
  outstanding: { label: "Outstanding", color: "text-rose-400 bg-rose-400/10 border-rose-500/30" },
};

const RECOVERY_CONFIG: Record<string, { label: string; color: string }> = {
  excellent: { label: "Excellent", color: "text-emerald-400 bg-emerald-400/10 border-emerald-500/30" },
  good:      { label: "Good",      color: "text-sky-400 bg-sky-400/10 border-sky-500/30" },
  lagging:   { label: "Lagging",   color: "text-amber-400 bg-amber-400/10 border-amber-500/30" },
  critical:  { label: "Critical",  color: "text-rose-400 bg-rose-400/10 border-rose-500/30" },
};

const OVERALL_CONFIG: Record<string, { label: string; color: string; barColor: string }> = {
  strong:   { label: "Operationally Sustainable",  color: "text-emerald-300 bg-emerald-900/40 border-emerald-600/40", barColor: "#10b981" },
  moderate: { label: "Moderately Sustainable",     color: "text-amber-300 bg-amber-900/40 border-amber-600/40",       barColor: "#f59e0b" },
  at_risk:  { label: "Sustainability at Risk",     color: "text-orange-300 bg-orange-900/40 border-orange-600/40",    barColor: "#f97316" },
  critical: { label: "Critically Unsustainable",   color: "text-rose-300 bg-rose-900/40 border-rose-600/40",          barColor: "#f43f5e" },
};

function RatingBadge({ value, config }: { value: string; config: Record<string, { label: string; color: string; icon?: React.ReactNode }> }) {
  const cfg = config[value] ?? { label: value, color: "text-zinc-400 bg-zinc-800 border-zinc-600" };
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium", cfg.color)}>
      {"icon" in cfg && cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  positive?: boolean | null;
}

function KpiCard({ label, value, sub, icon, color, positive }: KpiCardProps) {
  return (
    <Card className="bg-zinc-900 border-zinc-700/60">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 truncate">{label}</p>
            <p className={cn("text-2xl font-bold mt-0.5 tabular-nums", color)}>{value}</p>
            {sub && <p className="text-xs text-zinc-600 mt-0.5 truncate">{sub}</p>}
          </div>
          <div className={cn("p-2 rounded-lg shrink-0", color.replace("text-", "bg-").replace("-400", "-400/10").replace("-300", "-300/10"))}>
            {icon}
          </div>
        </div>
        {positive !== null && positive !== undefined && (
          <div className={cn("flex items-center gap-1 mt-2 text-xs", positive ? "text-emerald-400" : "text-rose-400")}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {positive ? "Net positive" : "Net negative"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Custom chart tooltip ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl text-xs">
      <p className="text-zinc-300 font-semibold mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="text-white font-medium tabular-nums">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Sustainability scorecard ───────────────────────────────────────────────────

interface ScoreCardProps {
  indicators: LandownerProfitabilityAnalytics["sustainabilityIndicators"];
}

function SustainabilityScorecard({ indicators }: ScoreCardProps) {
  const overall = OVERALL_CONFIG[indicators.overallSustainability] ?? OVERALL_CONFIG.moderate;
  const rows = [
    {
      label: "Profitability",
      desc: "Net revenue vs cost burden",
      value: indicators.profitabilityScore,
      config: PROFITABILITY_CONFIG,
    },
    {
      label: "Cost Burden",
      desc: "Operational costs vs gross entitlement",
      value: indicators.costBurdenRating,
      config: COST_BURDEN_CONFIG,
    },
    {
      label: "LCA Compliance",
      desc: "Land Contribution Adjustment status",
      value: indicators.lcaComplianceRating,
      config: LCA_CONFIG,
    },
    {
      label: "Recovery Efficiency",
      desc: "Burden recovery rate",
      value: indicators.recoveryRating,
      config: RECOVERY_CONFIG,
    },
  ];

  return (
    <Card className="bg-zinc-900 border-zinc-700/60">
      <CardHeader className="pb-2 px-5 pt-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            Sustainability Assessment
          </CardTitle>
          <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold", overall.color)}>
            <Activity className="w-3.5 h-3.5" />
            {overall.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="grid grid-cols-2 gap-3 mt-1">
          {rows.map((row) => {
            const cfg = (row.config as Record<string, { label: string; color: string; icon?: React.ReactNode }>)[row.value]
              ?? { label: row.value, color: "text-zinc-400 bg-zinc-800 border-zinc-600" };
            return (
              <div key={row.label} className="bg-zinc-800/60 rounded-lg p-3 border border-zinc-700/40">
                <p className="text-xs text-zinc-500 mb-1">{row.label}</p>
                <p className="text-[10px] text-zinc-600 mb-2 leading-tight">{row.desc}</p>
                <RatingBadge value={row.value} config={row.config} />
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-zinc-600 mt-3 flex items-start gap-1">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          Overall rating is driven by the worst-performing dimension. In the 50% revenue model, economic participant share is NOT reduced by operational costs — this is purely landowner accounting.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Trend chart ────────────────────────────────────────────────────────────────

function YearlyTrendChart({ data }: { data: YearlyProfitabilityRow[] }) {
  if (data.length === 0) {
    return (
      <div className="h-60 flex items-center justify-center text-zinc-600 text-sm">
        No confirmed entries to chart yet
      </div>
    );
  }

  const chartData = data.map((r) => ({
    year: String(r.year),
    "Gross Entitlement": r.grossEntitlement,
    "Operational Burden": r.operationalBurden,
    "LCA Income": r.lcaIncome,
    "Rec. Adjustment": r.recoverableAdj,
    "Net Profit": r.netProfitability,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis dataKey="year" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} width={56} />
        <Tooltip content={<ChartTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: "#a1a1aa", paddingTop: 8 }}
          formatter={(v) => <span style={{ color: "#a1a1aa" }}>{v}</span>}
        />
        <ReferenceLine y={0} stroke="#3f3f46" />
        <Bar dataKey="Gross Entitlement" stackId="a" fill="#22d3ee" radius={0} />
        <Bar dataKey="Operational Burden" stackId="b" fill="#f87171" radius={0} />
        <Bar dataKey="LCA Income" stackId="a" fill="#34d399" radius={[0, 0, 0, 0]} />
        <Line
          type="monotone"
          dataKey="Net Profit"
          stroke="#facc15"
          strokeWidth={2}
          dot={{ fill: "#facc15", r: 3 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Cost burden category chart ─────────────────────────────────────────────────

function CostBurdenChart({ byCategory }: { byCategory: { category: string; amount: number }[] }) {
  if (byCategory.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-600 text-sm">
        No burden recovery adjustments recorded
      </div>
    );
  }
  const data = byCategory.slice(0, 8).map((c) => ({
    category: c.category.length > 14 ? c.category.slice(0, 14) + "…" : c.category,
    fullCategory: c.category,
    Amount: c.amount,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
        <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
        <YAxis type="category" dataKey="category" tick={{ fill: "#a1a1aa", fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0];
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs shadow-xl">
                <p className="text-zinc-300 mb-1">{(d.payload as { fullCategory: string }).fullCategory}</p>
                <p className="text-orange-400 font-semibold">{fmtFull(d.value as number)}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="Amount" fill="#f97316" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Per-project breakdown table ────────────────────────────────────────────────

function ProjectBreakdownTable({ rows }: { rows: ProjectProfitabilityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-zinc-600 text-sm">No project-level data available</div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-700/60">
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Project</th>
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Landowner</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Gross Entitlement</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Op. Burden</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">LCA Income</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Rec. Adj</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Net Profit</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Cost/Rev %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const net = row.netProfitability;
            const isPositive = net >= 0;
            return (
              <tr
                key={`${row.projectId}:${row.partnerId}`}
                className={cn(
                  "border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/30",
                  i % 2 === 0 ? "" : "bg-zinc-800/20",
                )}
              >
                <td className="py-2.5 px-3 text-zinc-200 font-medium max-w-[140px] truncate">{row.projectName}</td>
                <td className="py-2.5 px-3 text-zinc-400 max-w-[120px] truncate">{row.partnerName}</td>
                <td className="py-2.5 px-3 text-right text-cyan-400 tabular-nums">{fmt(row.grossEntitlement)}</td>
                <td className="py-2.5 px-3 text-right text-red-400 tabular-nums">{fmt(row.operationalBurden)}</td>
                <td className="py-2.5 px-3 text-right text-emerald-400 tabular-nums">{fmt(row.lcaIncome)}</td>
                <td className={cn("py-2.5 px-3 text-right tabular-nums", row.recoverableAdj >= 0 ? "text-emerald-400" : "text-orange-400")}>
                  {row.recoverableAdj >= 0 ? "+" : ""}{fmt(row.recoverableAdj)}
                </td>
                <td className={cn("py-2.5 px-3 text-right font-semibold tabular-nums", isPositive ? "text-emerald-400" : "text-rose-400")}>
                  {isPositive ? "+" : ""}{fmt(net)}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    row.costBurdenRatio < 20 ? "bg-emerald-900/50 text-emerald-400" :
                    row.costBurdenRatio < 40 ? "bg-amber-900/50 text-amber-400" :
                    row.costBurdenRatio < 70 ? "bg-orange-900/50 text-orange-400" :
                    "bg-rose-900/50 text-rose-400",
                  )}>
                    {pct(row.costBurdenRatio)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Net position formula bar ───────────────────────────────────────────────────

function NetFormula({ data }: { data: LandownerProfitabilityAnalytics["summary"] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 bg-zinc-800/50 rounded-lg px-4 py-2.5 border border-zinc-700/40">
      <span className="text-cyan-400 font-semibold">{fmt(data.grossEntitlement)}</span>
      <span className="text-zinc-600">Gross</span>
      <span className="text-zinc-600">−</span>
      <span className="text-red-400 font-semibold">{fmt(data.operationalBurden)}</span>
      <span className="text-zinc-600">Burden</span>
      <span className="text-zinc-600">+</span>
      <span className="text-emerald-400 font-semibold">{fmt(data.lcaIncome)}</span>
      <span className="text-zinc-600">LCA</span>
      <span className="text-zinc-600">{data.recoverableAdj >= 0 ? "+" : "−"}</span>
      <span className={cn("font-semibold", data.recoverableAdj >= 0 ? "text-emerald-400" : "text-orange-400")}>
        {fmt(Math.abs(data.recoverableAdj))}
      </span>
      <span className="text-zinc-600">Adj</span>
      <span className="text-zinc-600">=</span>
      <span className={cn("font-bold text-sm", data.netProfitability >= 0 ? "text-emerald-300" : "text-rose-400")}>
        {data.netProfitability >= 0 ? "+" : ""}{fmt(data.netProfitability)}
      </span>
      <span className="text-zinc-500 ml-1">Net Position</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function LandownerProfitability() {
  const { role, canAccessAllProjects } = useRole();

  const [projectId, setProjectId] = useState<string>("all");
  const [partnerId, setPartnerId] = useState<string>("all");
  const [fromYear, setFromYear] = useState<string>("all");
  const [toYear, setToYear] = useState<string>("all");

  const projectsQuery = useListProjects();
  const partnersQuery = useListPartners();

  const analyticsQuery = useGetLandownerProfitabilityAnalytics({
    ...(projectId !== "all" ? { projectId } : {}),
    ...(partnerId !== "all" ? { partnerId } : {}),
    ...(fromYear !== "all" ? { fromYear: parseInt(fromYear) } : {}),
    ...(toYear !== "all" ? { toYear: parseInt(toYear) } : {}),
  });

  const data = analyticsQuery.data;
  const isLoading = analyticsQuery.isLoading;

  const allProjects = projectsQuery.data ?? [];
  const allPartners = partnersQuery.data ?? [];

  const filteredPartners = useMemo(() => {
    if (!canAccessAllProjects && role !== "landowner") return allPartners;
    return allPartners;
  }, [allPartners, canAccessAllProjects, role]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64 bg-zinc-800" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 bg-zinc-800" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72 bg-zinc-800" />
          <Skeleton className="h-72 bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-zinc-500 text-sm">
        Unable to load profitability data. Try refreshing.
      </div>
    );
  }

  const { summary, yearlyBreakdown, costBurdenAnalysis, sustainabilityIndicators, projects } = data;

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            Landowner Profitability Analytics
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            50% revenue model — informational analysis only. Does not affect ownership or participant shares.
          </p>
        </div>
        <div className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold",
          (OVERALL_CONFIG[sustainabilityIndicators.overallSustainability] ?? OVERALL_CONFIG.moderate).color,
        )}>
          <Activity className="w-3.5 h-3.5" />
          {(OVERALL_CONFIG[sustainabilityIndicators.overallSustainability] ?? OVERALL_CONFIG.moderate).label}
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-44 bg-zinc-800 border-zinc-700 text-zinc-200 h-8 text-xs">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all" className="text-zinc-200 text-xs">All Projects</SelectItem>
            {allProjects.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-zinc-200 text-xs">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={partnerId} onValueChange={setPartnerId}>
          <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700 text-zinc-200 h-8 text-xs">
            <SelectValue placeholder="All Landowners" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all" className="text-zinc-200 text-xs">All Landowners</SelectItem>
            {filteredPartners.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-zinc-200 text-xs">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <Select value={fromYear} onValueChange={setFromYear}>
            <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 text-zinc-200 h-8 text-xs">
              <SelectValue placeholder="From Year" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all" className="text-zinc-200 text-xs">From Year</SelectItem>
              {YEAR_OPTIONS.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-zinc-200 text-xs">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-zinc-600 text-xs">–</span>
          <Select value={toYear} onValueChange={setToYear}>
            <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 text-zinc-200 h-8 text-xs">
              <SelectValue placeholder="To Year" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all" className="text-zinc-200 text-xs">To Year</SelectItem>
              {YEAR_OPTIONS.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-zinc-200 text-xs">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Net position formula ────────────────────────────────────────── */}
      <NetFormula data={summary} />

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Gross Entitlement"
          value={fmt(summary.grossEntitlement)}
          sub={`Revenue share credits`}
          icon={<IndianRupee className="w-4 h-4 text-cyan-400" />}
          color="text-cyan-400"
        />
        <KpiCard
          label="Operational Burden"
          value={fmt(summary.operationalBurden)}
          sub={`${pct(summary.costBurdenRatio)} of gross`}
          icon={<Scale className="w-4 h-4 text-red-400" />}
          color="text-red-400"
        />
        <KpiCard
          label="LCA Income"
          value={fmt(summary.lcaIncome)}
          sub={`${pct(summary.lcaDependencyRatio)} of gross`}
          icon={<Layers className="w-4 h-4 text-emerald-400" />}
          color="text-emerald-400"
        />
        <KpiCard
          label="Recoverable Adj."
          value={(summary.recoverableAdj >= 0 ? "+" : "") + fmt(summary.recoverableAdj)}
          sub={`${fmtFull(summary.totalLcaReceivable)} LCA receivable`}
          icon={<CheckCircle2 className="w-4 h-4 text-amber-400" />}
          color={summary.recoverableAdj >= 0 ? "text-emerald-400" : "text-orange-400"}
        />
        <KpiCard
          label="Net Profitability"
          value={(summary.netProfitability >= 0 ? "+" : "") + fmt(summary.netProfitability)}
          sub={fmtFull(summary.netProfitability)}
          icon={summary.netProfitability >= 0
            ? <TrendingUp className="w-4 h-4 text-emerald-400" />
            : <TrendingDown className="w-4 h-4 text-rose-400" />}
          color={summary.netProfitability >= 0 ? "text-emerald-400" : "text-rose-400"}
          positive={summary.netProfitability >= 0}
        />
      </div>

      {/* ── Trend chart + Sustainability scorecard ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-zinc-900 border-zinc-700/60 lg:col-span-2">
          <CardHeader className="pb-2 px-5 pt-4">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              Year-wise Profitability Trend
            </CardTitle>
            <p className="text-xs text-zinc-600 mt-0.5">
              Cyan bars = revenue entitlement · Red bars = operational burden · Green bars = LCA income · Yellow line = net position
            </p>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <YearlyTrendChart data={yearlyBreakdown} />
          </CardContent>
        </Card>

        <SustainabilityScorecard indicators={sustainabilityIndicators} />
      </div>

      {/* ── Cost burden analysis ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-zinc-900 border-zinc-700/60 lg:col-span-2">
          <CardHeader className="pb-2 px-5 pt-4">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Scale className="w-4 h-4 text-orange-400" />
              Cost Burden Analysis
            </CardTitle>
            <p className="text-xs text-zinc-600 mt-0.5">
              Recoverable operational costs by category (from Burden Recovery module)
            </p>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <CostBurdenChart byCategory={costBurdenAnalysis.byCategory} />
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-700/60">
          <CardHeader className="pb-2 px-5 pt-4">
            <CardTitle className="text-sm font-semibold text-zinc-200">Recovery Status</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Total Recoverable", value: fmt(costBurdenAnalysis.totalBurdenRecoverable), color: "text-zinc-200" },
                { label: "Recovered",         value: fmt(costBurdenAnalysis.totalBurdenRecovered),  color: "text-emerald-400" },
                { label: "Pending",           value: fmt(costBurdenAnalysis.totalBurdenPending),    color: "text-amber-400" },
                { label: "Efficiency",        value: pct(summary.recoveryEfficiency),               color: "text-sky-400" },
              ].map((item) => (
                <div key={item.label} className="bg-zinc-800/60 rounded-lg p-2.5 border border-zinc-700/40">
                  <p className="text-[10px] text-zinc-500">{item.label}</p>
                  <p className={cn("text-base font-bold tabular-nums mt-0.5", item.color)}>{item.value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 mt-2">
              <p className="text-[10px] text-zinc-500 mb-2">Adjustments by Status</p>
              {[
                { label: "Pending",   count: costBurdenAnalysis.byStatus.pending,   color: "bg-amber-500" },
                { label: "Partial",   count: costBurdenAnalysis.byStatus.partial,   color: "bg-sky-500" },
                { label: "Recovered", count: costBurdenAnalysis.byStatus.recovered, color: "bg-emerald-500" },
                { label: "Waived",    count: costBurdenAnalysis.byStatus.waived,    color: "bg-zinc-500" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", s.color)} />
                  <span className="text-xs text-zinc-400 flex-1">{s.label}</span>
                  <span className="text-xs text-zinc-300 font-medium tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Per-project breakdown ────────────────────────────────────────── */}
      {projects.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-700/60">
          <CardHeader className="pb-2 px-5 pt-4">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" />
              Project-wise Breakdown
            </CardTitle>
            <p className="text-xs text-zinc-600 mt-0.5">
              Net profitability per (project, landowner) pair · Confirmed entries only
            </p>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <ProjectBreakdownTable rows={projects} />
          </CardContent>
        </Card>
      )}

      {/* ── Accounting disclaimer ────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-[11px] text-zinc-600 bg-zinc-900/40 border border-zinc-800 rounded-lg px-4 py-3">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-zinc-500" />
        <span>
          <strong className="text-zinc-500">Accounting note:</strong> This dashboard reflects the landowner-side ledger (confirmed entries). In the 50% revenue model, economic participant shares are independent and are NOT reduced by operational cost burden. LCA receivable shown is the outstanding balance from the LCA ledger. All figures are informational and do not constitute legal financial statements.
        </span>
      </div>
    </div>
  );
}
