import { useState } from "react";
import { useAuthFetcher } from "../lib/authFetch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  TrendingUp,
  Shield,
  Zap,
  RefreshCw,
  Loader2,
  Lock,
  Activity,
  Package,
  Users,
  GitCompare,
  BarChart3,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnterpriseSummary {
  portfolioSize: number;
  lifecycleDistribution: { status: string; count: number; pct: number }[];
  financial: {
    verifiedCapital: number;
    reimbursementExposure: number;
    pendingOwnershipValue: number;
  };
  governance: {
    configurationWarnings: number;
    governanceLocked: number;
    crystallizedProjects: number;
    crystallizationGaps: number;
  };
  fetchedAt: string;
}

interface RiskFlag {
  projectId: string;
  projectName: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "inventory" | "financial" | "governance" | "ownership" | "operational";
  code: string;
  message: string;
}

interface RiskFlagsResponse {
  flags: RiskFlag[];
  counts: { critical: number; high: number; medium: number; low: number; total: number };
  fetchedAt: string;
}

interface ProjectScore {
  projectId: string;
  projectName: string;
  lifecycleStatus: string;
  commercialModel: string;
  score: number;
  label: string;
  tier: "green" | "yellow" | "orange" | "red";
  breakdown: {
    verificationPts: number;
    crystalPts: number;
    stalePts: number;
    stockPts: number;
    govPts: number;
    verifiedRate: number;
    totalContributions: number;
  };
}

interface ProjectScoresResponse {
  scores: ProjectScore[];
  fetchedAt: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCrore(v: number) {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const LIFECYCLE_COLORS: Record<string, string> = {
  prematurity: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  mature_production: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-500 text-black",
  low: "bg-blue-500 text-white",
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/5",
  high: "border-orange-500/40 bg-orange-500/5",
  medium: "border-amber-500/40 bg-amber-500/5",
  low: "border-blue-500/40 bg-blue-500/5",
};

const TIER_BAR: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-400",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const TIER_TEXT: Record<string, string> = {
  green: "text-emerald-400",
  yellow: "text-yellow-400",
  orange: "text-orange-400",
  red: "text-red-400",
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  inventory: Package,
  financial: TrendingUp,
  governance: Shield,
  ownership: Lock,
  operational: Activity,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBar({ score, tier }: { score: number; tier: string }) {
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${TIER_BAR[tier] ?? "bg-slate-500"}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-xs font-bold tabular-nums w-7 text-right ${TIER_TEXT[tier] ?? "text-slate-400"}`}>
        {score}
      </span>
    </div>
  );
}

function RiskSection({
  severity,
  flags,
}: {
  severity: "critical" | "high" | "medium" | "low";
  flags: RiskFlag[];
}) {
  const [open, setOpen] = useState(severity === "critical" || severity === "high");
  if (flags.length === 0) return null;
  const Icon = severity === "critical" || severity === "high" ? AlertTriangle : Shield;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={`border ${SEVERITY_BORDER[severity]}`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none py-2.5 px-4 hover:bg-white/5 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium capitalize">{severity} Severity</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[severity]}`}>
                  {flags.length}
                </span>
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-3">
            <div className="space-y-2">
              {flags.map((f, i) => {
                const CatIcon = CATEGORY_ICONS[f.category] ?? Activity;
                return (
                  <div key={i} className="flex items-start gap-2.5 text-xs rounded-md border border-slate-700/50 bg-slate-800/30 p-2.5">
                    <CatIcon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/projects/${f.projectId}`} className="font-medium text-blue-400 hover:underline">
                          {f.projectName}
                        </Link>
                        <Badge variant="outline" className="text-[10px] font-mono px-1 py-0">{f.code}</Badge>
                        <Badge variant="outline" className="text-[10px] capitalize px-1 py-0">{f.category}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5 leading-relaxed">{f.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EnterpriseIntelligence() {
  const _fetchEI = useAuthFetcher();
  const fetchEI = <T,>(path: string): Promise<T> => _fetchEI(`/api/enterprise-intelligence${path}`) as Promise<T>;
  const queryClient = useQueryClient();
  const [showAllScores, setShowAllScores] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["ei-summary"],
    queryFn: () => fetchEI<EnterpriseSummary>("/summary"),
    refetchInterval: 120_000,
  });

  const flagsQ = useQuery({
    queryKey: ["ei-risk-flags"],
    queryFn: () => fetchEI<RiskFlagsResponse>("/risk-flags"),
    refetchInterval: 120_000,
  });

  const scoresQ = useQuery({
    queryKey: ["ei-project-scores"],
    queryFn: () => fetchEI<ProjectScoresResponse>("/project-scores"),
    refetchInterval: 120_000,
  });

  const isLoading = summaryQ.isLoading || flagsQ.isLoading || scoresQ.isLoading;
  const s = summaryQ.data;
  const f = flagsQ.data;
  const sc = scoresQ.data;

  const displayedScores = showAllScores
    ? (sc?.scores ?? [])
    : (sc?.scores ?? []).slice(0, 10);

  const atRiskCount = (sc?.scores ?? []).filter((p) => p.tier === "red").length;

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["ei-summary"] });
    queryClient.invalidateQueries({ queryKey: ["ei-risk-flags"] });
    queryClient.invalidateQueries({ queryKey: ["ei-project-scores"] });
  }

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6 text-violet-400" />
            Enterprise Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Strategic governance intelligence — portfolio-wide risk analysis, health scores,
            and financial aggregates across all projects
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Portfolio KPIs ──────────────────────────────────────────────── */}
      {s ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-violet-300">{s.portfolioSize}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Projects</div>
            </CardContent>
          </Card>
          {s.lifecycleDistribution.map((row) => (
            <Card key={row.status} className={`border ${row.status === "mature_production" ? "border-emerald-500/30 bg-emerald-500/5" : row.status === "closed" ? "border-slate-600" : "border-blue-500/30 bg-blue-500/5"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${row.status === "mature_production" ? "text-emerald-300" : row.status === "closed" ? "text-slate-400" : "text-blue-300"}`}>
                  {row.count}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 capitalize">{row.status.replace(/_/g, " ")}</div>
                <div className="text-xs text-muted-foreground">{row.pct}%</div>
              </CardContent>
            </Card>
          ))}
          {atRiskCount > 0 && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{atRiskCount}</div>
                <div className="text-xs text-muted-foreground mt-0.5">At Risk</div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio summary…
        </div>
      )}

      {/* ── Financial Intelligence ─────────────────────────────────────── */}
      {s && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardHeader className="py-2 px-4">
              <CardDescription className="text-xs flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Verified Capital</CardDescription>
              <CardTitle className="text-xl font-bold text-emerald-300">
                {fmtCrore(s.financial.verifiedCapital)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-xs text-muted-foreground">Total verified ownership-affecting contributions across all projects</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="py-2 px-4">
              <CardDescription className="text-xs flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Reimbursement Exposure</CardDescription>
              <CardTitle className="text-xl font-bold text-amber-300">
                {fmtCrore(s.financial.reimbursementExposure)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-xs text-muted-foreground">Total verified operational burden flagged for reimbursement</p>
            </CardContent>
          </Card>
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardHeader className="py-2 px-4">
              <CardDescription className="text-xs flex items-center gap-1.5"><GitCompare className="h-3.5 w-3.5" /> Pending Capital</CardDescription>
              <CardTitle className="text-xl font-bold text-blue-300">
                {fmtCrore(s.financial.pendingOwnershipValue)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-xs text-muted-foreground">Ownership-affecting contributions awaiting verification</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Governance Intelligence ─────────────────────────────────────── */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className={`border ${s.governance.configurationWarnings > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}`}>
            <CardContent className="p-3 text-center">
              <div className={`text-xl font-bold ${s.governance.configurationWarnings > 0 ? "text-amber-400" : "text-green-400"}`}>
                {s.governance.configurationWarnings > 0 ? s.governance.configurationWarnings : "✓"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Config Warnings</div>
            </CardContent>
          </Card>
          <Card className={`border ${s.governance.governanceLocked > 0 ? "border-red-500/30 bg-red-500/5" : "border-green-500/30 bg-green-500/5"}`}>
            <CardContent className="p-3 text-center">
              <div className={`text-xl font-bold ${s.governance.governanceLocked > 0 ? "text-red-400" : "text-green-400"}`}>
                {s.governance.governanceLocked > 0 ? s.governance.governanceLocked : "✓"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Gov. Locked</div>
            </CardContent>
          </Card>
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardContent className="p-3 text-center">
              <div className="text-xl font-bold text-violet-300">{s.governance.crystallizedProjects}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Crystallized</div>
            </CardContent>
          </Card>
          <Card className={`border ${s.governance.crystallizationGaps > 0 ? "border-orange-500/30 bg-orange-500/5" : "border-green-500/30 bg-green-500/5"}`}>
            <CardContent className="p-3 text-center">
              <div className={`text-xl font-bold ${s.governance.crystallizationGaps > 0 ? "text-orange-400" : "text-green-400"}`}>
                {s.governance.crystallizationGaps > 0 ? s.governance.crystallizationGaps : "✓"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Crystal Gaps</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Risk Intelligence ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Risk Intelligence
          </h2>
          {f && (
            <div className="flex items-center gap-1.5">
              {(["critical", "high", "medium", "low"] as const).map((s) =>
                f.counts[s] > 0 ? (
                  <span key={s} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[s]}`}>
                    {f.counts[s]} {s}
                  </span>
                ) : null,
              )}
            </div>
          )}
        </div>

        {flagsQ.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Scanning for risk flags…
          </div>
        ) : f && f.flags.length === 0 ? (
          <Alert className="border-green-500/30 bg-green-500/5">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <AlertDescription className="text-green-300 ml-2">
              No active risk flags detected across the entire portfolio. All governance checks are passing.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {(["critical", "high", "medium", "low"] as const).map((sev) => (
              <RiskSection
                key={sev}
                severity={sev}
                flags={(f?.flags ?? []).filter((flag) => flag.severity === sev)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Project Health Leaderboard ──────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Project Health Scores
          </h2>
          <p className="text-xs text-muted-foreground">
            Composite score: verification (25) + crystallization (20) + no stale entries (25) + no negative stock (20) + governance (10)
          </p>
        </div>

        {scoresQ.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Computing health scores…
          </div>
        ) : sc ? (
          <Card className="border-slate-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Project</TableHead>
                  <TableHead className="text-xs">Lifecycle</TableHead>
                  <TableHead className="text-xs">Model</TableHead>
                  <TableHead className="text-xs">Health Score</TableHead>
                  <TableHead className="text-xs">Label</TableHead>
                  <TableHead className="text-xs">Verif. Rate</TableHead>
                  <TableHead className="text-xs">Entries</TableHead>
                  <TableHead className="text-xs text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedScores.map((row) => (
                  <TableRow key={row.projectId} className={row.tier === "red" ? "bg-red-500/5" : ""}>
                    <TableCell className="text-xs font-medium">
                      <Link href={`/projects/${row.projectId}`} className="text-blue-400 hover:underline">
                        {row.projectName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${LIFECYCLE_COLORS[row.lifecycleStatus] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
                        {row.lifecycleStatus.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.commercialModel === "ownership_contribution" ? "OC" : "50%"}
                    </TableCell>
                    <TableCell className="text-xs min-w-[120px]">
                      <ScoreBar score={row.score} tier={row.tier} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={`font-semibold ${TIER_TEXT[row.tier]}`}>{row.label}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.breakdown.verifiedRate}%
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.breakdown.totalContributions}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {row.breakdown.stalePts === 0 && (
                          <Badge className="bg-amber-600 text-white text-[10px] px-1">stale</Badge>
                        )}
                        {row.breakdown.stockPts === 0 && (
                          <Badge className="bg-red-600 text-white text-[10px] px-1">-stock</Badge>
                        )}
                        {row.breakdown.crystalPts === 0 && (
                          <Badge className="bg-violet-600 text-white text-[10px] px-1">-crystal</Badge>
                        )}
                        {row.breakdown.govPts < 5 && (
                          <Badge className="bg-slate-600 text-white text-[10px] px-1">gov⚠</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sc.scores.length > 10 && (
              <div className="px-4 py-3 border-t border-slate-700">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowAllScores(!showAllScores)}
                >
                  {showAllScores
                    ? "Show top 10 only"
                    : `Show all ${sc.scores.length} projects`}
                </Button>
              </div>
            )}
          </Card>
        ) : null}
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap border-t border-slate-800 pt-4">
        <Link href="/data-health">
          <Button variant="outline" size="sm" className="text-xs">
            <Shield className="h-3.5 w-3.5 mr-1.5" />
            Data Health
          </Button>
        </Link>
        <Link href="/global-analytics">
          <Button variant="outline" size="sm" className="text-xs">
            <Globe className="h-3.5 w-3.5 mr-1.5" />
            Global Analytics
          </Button>
        </Link>
        <Link href="/governance-audit-reports">
          <Button variant="outline" size="sm" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Governance Reports
          </Button>
        </Link>
        <Link href="/disputes">
          <Button variant="outline" size="sm" className="text-xs">
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
            Disputes
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground ml-auto">
          {s && `Last refreshed ${new Date(s.fetchedAt).toLocaleTimeString("en-IN")}`}
        </p>
      </div>
    </div>
  );
}
