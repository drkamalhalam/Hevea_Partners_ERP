import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
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
  Activity,
  Users,
  GitCompare,
  Package,
  Lock,
  Clock,
  RefreshCw,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────

interface DataHealthSummary {
  orphanContributors: number;
  lifecycleViolations: number;
  stockNegatives: number;
  ownershipGaps: number;
  staleContributions: number;
  totalIssues: number;
  fetchedAt: string;
}

interface OrphanContributor {
  id: string;
  partnerName: string | null;
  projectId: string;
  contributionType: string;
  amount: string;
  verificationStatus: string;
  createdAt: string;
}

interface LifecycleViolation {
  id: string;
  partnerName: string | null;
  projectId: string;
  contributionType: string;
  amount: string;
  affectsOwnership: boolean;
  lifecyclePhaseSnapshot: string;
  verificationStatus: string;
  reimbursementFlag: boolean;
  createdAt: string;
}

interface StockNegative {
  projectId: string;
  stockType: string;
  unit: string;
  confirmedIn: number;
  confirmedOut: number;
  balance: number;
}

interface OwnershipGap {
  id: string;
  name: string;
  lifecycleStatus: string;
  commercialModel: string;
  ownershipFrozenAt: string | null;
}

interface StaleContribution {
  id: string;
  partnerName: string | null;
  projectId: string;
  contributionType: string;
  amount: string;
  verificationStatus: string;
  affectsOwnership: boolean;
  createdAt: string;
}

interface BackfillResult {
  ok: boolean;
  processed: number;
  crystallized: number;
  errors: number;
  results: Array<{
    projectId: string;
    projectName: string;
    status: "crystallized" | "skipped" | "error";
    partnerCount?: number;
    error?: string;
  }>;
  message?: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchDataHealth<T>(path: string): Promise<T> {
  const res = await fetch(`/api/admin/data-health${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postBackfill(): Promise<BackfillResult> {
  const res = await fetch("/api/admin/data-health/backfill-crystallization", {
    method: "POST",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<BackfillResult>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionWrapper({
  title,
  icon: Icon,
  count,
  severity,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  severity: "critical" | "warning" | "info" | "ok";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const colorMap = {
    critical: "border-red-500/40 bg-red-500/5",
    warning: "border-amber-500/40 bg-amber-500/5",
    info: "border-blue-500/40 bg-blue-500/5",
    ok: "border-green-500/40 bg-green-500/5",
  };

  const badgeMap = {
    critical: "bg-red-600 text-white",
    warning: "bg-amber-500 text-white",
    info: "bg-blue-600 text-white",
    ok: "bg-green-600 text-white",
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={`border ${colorMap[severity]} transition-colors`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-white/5 rounded-t-lg py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeMap[severity]}`}>
                  {count}
                </span>
                {open ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtCurrency(v: string | number) {
  return `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DataHealth() {
  const { role } = useRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const summaryQ = useQuery({
    queryKey: ["data-health-summary"],
    queryFn: () => fetchDataHealth<DataHealthSummary>("/summary"),
    refetchInterval: 60_000,
  });

  const orphansQ = useQuery({
    queryKey: ["data-health-orphans"],
    queryFn: () => fetchDataHealth<{ items: OrphanContributor[]; count: number }>("/orphan-contributors"),
  });

  const violationsQ = useQuery({
    queryKey: ["data-health-violations"],
    queryFn: () => fetchDataHealth<{ items: LifecycleViolation[]; count: number }>("/lifecycle-violations"),
  });

  const stockNegQ = useQuery({
    queryKey: ["data-health-stock-negatives"],
    queryFn: () => fetchDataHealth<{ items: StockNegative[]; count: number }>("/stock-negatives"),
  });

  const ownershipGapsQ = useQuery({
    queryKey: ["data-health-ownership-gaps"],
    queryFn: () => fetchDataHealth<{ items: OwnershipGap[]; count: number }>("/ownership-gaps"),
  });

  const staleQ = useQuery({
    queryKey: ["data-health-stale"],
    queryFn: () => fetchDataHealth<{ items: StaleContribution[]; count: number }>("/stale-contributions"),
  });

  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);

  const backfillMut = useMutation({
    mutationFn: postBackfill,
    onSuccess: (data) => {
      setBackfillResult(data);
      queryClient.invalidateQueries({ queryKey: ["data-health-summary"] });
      queryClient.invalidateQueries({ queryKey: ["data-health-ownership-gaps"] });
      toast({
        title: data.ok ? "Backfill complete" : "Backfill finished with errors",
        description: `${data.crystallized} project(s) crystallized, ${data.errors} error(s).`,
        variant: data.ok ? "default" : "destructive",
      });
    },
    onError: (err) => {
      toast({
        title: "Backfill failed",
        description: String(err),
        variant: "destructive",
      });
    },
  });

  const summary = summaryQ.data;
  const isAdmin = role === "admin";

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-emerald-400" />
            Data Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ERP data quality monitoring — orphan records, lifecycle violations, inventory
            mismatches, and ownership normalization
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["data-health-summary"] });
            queryClient.invalidateQueries({ queryKey: ["data-health-orphans"] });
            queryClient.invalidateQueries({ queryKey: ["data-health-violations"] });
            queryClient.invalidateQueries({ queryKey: ["data-health-stock-negatives"] });
            queryClient.invalidateQueries({ queryKey: ["data-health-ownership-gaps"] });
            queryClient.invalidateQueries({ queryKey: ["data-health-stale"] });
          }}
          disabled={summaryQ.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summaryQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      {summary ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className={`border ${summary.totalIssues === 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${summary.totalIssues === 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.totalIssues}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Total Issues</div>
              </CardContent>
            </Card>
            <Card className={`border ${summary.orphanContributors > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-slate-700"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${summary.orphanContributors > 0 ? "text-amber-400" : "text-slate-400"}`}>
                  {summary.orphanContributors}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Orphan Entries</div>
              </CardContent>
            </Card>
            <Card className={`border ${summary.lifecycleViolations > 0 ? "border-red-500/30 bg-red-500/5" : "border-slate-700"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${summary.lifecycleViolations > 0 ? "text-red-400" : "text-slate-400"}`}>
                  {summary.lifecycleViolations}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Lifecycle Violations</div>
              </CardContent>
            </Card>
            <Card className={`border ${summary.stockNegatives > 0 ? "border-red-500/30 bg-red-500/5" : "border-slate-700"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${summary.stockNegatives > 0 ? "text-red-400" : "text-slate-400"}`}>
                  {summary.stockNegatives}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Stock Negatives</div>
              </CardContent>
            </Card>
            <Card className={`border ${summary.ownershipGaps > 0 ? "border-violet-500/30 bg-violet-500/5" : "border-slate-700"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${summary.ownershipGaps > 0 ? "text-violet-400" : "text-slate-400"}`}>
                  {summary.ownershipGaps}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Ownership Gaps</div>
              </CardContent>
            </Card>
            <Card className={`border ${summary.staleContributions > 0 ? "border-blue-500/30 bg-blue-500/5" : "border-slate-700"}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${summary.staleContributions > 0 ? "text-blue-400" : "text-slate-400"}`}>
                  {summary.staleContributions}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Stale (30d+)</div>
              </CardContent>
            </Card>
          </div>
          {summary.totalIssues === 0 && (
            <Alert className="border-green-500/30 bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-300 ml-2">
                All data health checks passed — no issues detected. Last checked{" "}
                {new Date(summary.fetchedAt).toLocaleTimeString("en-IN")}.
              </AlertDescription>
            </Alert>
          )}
        </>
      ) : summaryQ.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading health summary…
        </div>
      ) : (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Failed to load health summary. Check API connectivity.</AlertDescription>
        </Alert>
      )}

      {/* ── Backfill Panel ───────────────────────────────────────────── */}
      {summary && summary.ownershipGaps > 0 && isAdmin && (
        <Card className="border-violet-500/40 bg-violet-500/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              Retroactive Crystallization
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {summary.ownershipGaps} mature project(s) have no ownership snapshot — these predate the Phase 6
              auto-crystallization engine. This action runs the crystallization engine against all verified contributions
              for each gap project and permanently locks ownership records. This action is irreversible.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {backfillResult && (
              <div className="mb-3 rounded-md border border-slate-700 p-3 text-xs space-y-1">
                <div className="font-medium text-slate-300">
                  Last run: {backfillResult.crystallized} crystallized, {backfillResult.errors} errors
                  {backfillResult.message && ` — ${backfillResult.message}`}
                </div>
                {backfillResult.results.map((r) => (
                  <div
                    key={r.projectId}
                    className={`flex items-center gap-2 ${r.status === "error" ? "text-red-400" : "text-green-400"}`}
                  >
                    {r.status === "crystallized" ? (
                      <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                    )}
                    <span>
                      {r.projectName}
                      {r.status === "crystallized" && r.partnerCount !== undefined
                        ? ` — ${r.partnerCount} partner(s) crystallized`
                        : r.error
                        ? ` — ${r.error}`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Button
              size="sm"
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={backfillMut.isPending}
              onClick={() => backfillMut.mutate()}
            >
              {backfillMut.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Running crystallization…
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  Backfill Ownership Crystallization ({summary.ownershipGaps} projects)
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Issue Sections ───────────────────────────────────────────── */}
      <div className="space-y-3">

        {/* Orphan Contributors */}
        <SectionWrapper
          title="Orphan Contributors"
          icon={Users}
          count={orphansQ.data?.count ?? summary?.orphanContributors ?? 0}
          severity={orphansQ.data && orphansQ.data.count > 0 ? "warning" : "ok"}
        >
          <p className="text-xs text-muted-foreground mb-3">
            Contribution entries with no linked partner ID — recorded as free-text names only.
            These cannot be attributed to a canonical person record and may skew ownership calculations.
          </p>
          {orphansQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : orphansQ.data && orphansQ.data.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Partner Name (free text)</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs">Project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orphansQ.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-mono">{row.partnerName ?? <span className="text-red-400 italic">null</span>}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-xs">{row.contributionType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{fmtCurrency(row.amount)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant={row.verificationStatus === "verified" ? "default" : "secondary"} className="text-xs">
                        {row.verificationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(row.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      <Link href={`/projects/${row.projectId}/contributions`} className="text-blue-400 hover:underline font-mono text-[10px]">
                        {row.projectId.slice(0, 8)}…
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <CheckCircle2 className="h-3 w-3" /> No orphan contributors found.
            </div>
          )}
        </SectionWrapper>

        {/* Lifecycle Violations */}
        <SectionWrapper
          title="Lifecycle Violations"
          icon={GitCompare}
          count={violationsQ.data?.count ?? summary?.lifecycleViolations ?? 0}
          severity={violationsQ.data && violationsQ.data.count > 0 ? "critical" : "ok"}
        >
          <p className="text-xs text-muted-foreground mb-3">
            Contributions flagged <strong>affectsOwnership=true</strong> but recorded in a post-prematurity lifecycle phase.
            Ownership-forming entries are only valid during prematurity. These entries may have been migrated from a
            legacy module or recorded erroneously. Review each entry and set <code className="text-xs">reimbursementFlag=true</code> or
            remove the ownership flag via the Contributions page.
          </p>
          {violationsQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : violationsQ.data && violationsQ.data.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Partner</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Phase Recorded</TableHead>
                  <TableHead className="text-xs">Reimbursable</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {violationsQ.data.items.map((row) => (
                  <TableRow key={row.id} className="bg-red-500/5">
                    <TableCell className="text-xs">{row.partnerName ?? <span className="text-muted-foreground italic">unlinked</span>}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-xs">{row.contributionType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{fmtCurrency(row.amount)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge className="bg-red-600 text-white text-xs">{row.lifecyclePhaseSnapshot}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.reimbursementFlag ? (
                        <span className="text-green-400 text-xs">Yes</span>
                      ) : (
                        <span className="text-red-400 text-xs font-semibold">No ⚠</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary" className="text-xs">{row.verificationStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Link href={`/projects/${row.projectId}/contributions`} className="text-blue-400 hover:underline font-mono text-[10px]">
                        {row.projectId.slice(0, 8)}…
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <CheckCircle2 className="h-3 w-3" /> No lifecycle violations detected.
            </div>
          )}
        </SectionWrapper>

        {/* Stock Negatives */}
        <SectionWrapper
          title="Negative Stock Balances"
          icon={Package}
          count={stockNegQ.data?.count ?? summary?.stockNegatives ?? 0}
          severity={stockNegQ.data && stockNegQ.data.count > 0 ? "critical" : "ok"}
        >
          <p className="text-xs text-muted-foreground mb-3">
            Projects and stock types where confirmed outbound movements exceed confirmed inbound — resulting in a
            negative balance. This indicates either missing inbound entries, duplicate outbound records, or
            un-confirmed receipt movements. Resolve in the Inventory module.
          </p>
          {stockNegQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : stockNegQ.data && stockNegQ.data.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Project</TableHead>
                  <TableHead className="text-xs">Stock Type</TableHead>
                  <TableHead className="text-xs">Unit</TableHead>
                  <TableHead className="text-xs">Confirmed In</TableHead>
                  <TableHead className="text-xs">Confirmed Out</TableHead>
                  <TableHead className="text-xs text-red-400">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockNegQ.data.items.map((row, i) => (
                  <TableRow key={i} className="bg-red-500/5">
                    <TableCell className="text-xs">
                      <Link href={`/projects/${row.projectId}/inventory`} className="text-blue-400 hover:underline font-mono text-[10px]">
                        {row.projectId.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-xs">{row.stockType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.unit}</TableCell>
                    <TableCell className="text-xs text-green-400">{Number(row.confirmedIn).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-xs text-amber-400">{Number(row.confirmedOut).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell className="text-xs font-bold text-red-400">
                      {Number(row.balance).toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <CheckCircle2 className="h-3 w-3" /> No negative stock balances found.
            </div>
          )}
        </SectionWrapper>

        {/* Ownership Gaps */}
        <SectionWrapper
          title="Ownership Crystallization Gaps"
          icon={Lock}
          count={ownershipGapsQ.data?.count ?? summary?.ownershipGaps ?? 0}
          severity={ownershipGapsQ.data && ownershipGapsQ.data.count > 0 ? "warning" : "ok"}
        >
          <p className="text-xs text-muted-foreground mb-3">
            Mature or closed projects that have no ownership crystallization record. These projects transitioned
            to <code className="text-xs">mature_production</code> before the auto-crystallization engine was deployed.
            Use the <strong>Backfill</strong> action above to retroactively freeze their ownership.
          </p>
          {ownershipGapsQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : ownershipGapsQ.data && ownershipGapsQ.data.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Project Name</TableHead>
                  <TableHead className="text-xs">Lifecycle Status</TableHead>
                  <TableHead className="text-xs">Commercial Model</TableHead>
                  <TableHead className="text-xs">Frozen At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ownershipGapsQ.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-medium">
                      <Link href={`/projects/${row.id}`} className="text-blue-400 hover:underline">
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge className="bg-amber-600 text-white text-xs">{row.lifecycleStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.commercialModel}</TableCell>
                    <TableCell className="text-xs text-red-400 italic">not crystallized</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <CheckCircle2 className="h-3 w-3" /> All mature projects have crystallized ownership.
            </div>
          )}
        </SectionWrapper>

        {/* Stale Contributions */}
        <SectionWrapper
          title="Stale Pending Contributions (30+ days)"
          icon={Clock}
          count={staleQ.data?.count ?? summary?.staleContributions ?? 0}
          severity={staleQ.data && staleQ.data.count > 0 ? "info" : "ok"}
        >
          <p className="text-xs text-muted-foreground mb-3">
            Contributions that have been in <strong>draft</strong> or <strong>pending_verification</strong> status for
            over 30 days. Stale entries that affect ownership reduce confidence in the ownership ledger.
            Review each entry in the Contributions module and either verify or void it.
          </p>
          {staleQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : staleQ.data && staleQ.data.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Partner</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Ownership?</TableHead>
                  <TableHead className="text-xs">Submitted</TableHead>
                  <TableHead className="text-xs">Project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staleQ.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{row.partnerName ?? <span className="text-muted-foreground italic">unlinked</span>}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-xs">{row.contributionType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{fmtCurrency(row.amount)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary" className="text-xs">{row.verificationStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.affectsOwnership ? (
                        <span className="text-amber-400 font-semibold text-xs">Yes</span>
                      ) : (
                        <span className="text-slate-500 text-xs">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(row.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      <Link href={`/projects/${row.projectId}/contributions`} className="text-blue-400 hover:underline font-mono text-[10px]">
                        {row.projectId.slice(0, 8)}…
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <CheckCircle2 className="h-3 w-3" /> No stale contributions found.
            </div>
          )}
        </SectionWrapper>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Data Health is a read-only diagnostic view. To correct issues, use the Contributions, Inventory, or Project modules directly.
        {summary && (
          <> Last refreshed at {new Date(summary.fetchedAt).toLocaleTimeString("en-IN")}.</>
        )}
      </p>
    </div>
  );
}
