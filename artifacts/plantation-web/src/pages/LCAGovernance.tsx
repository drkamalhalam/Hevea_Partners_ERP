import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useRole } from "@/contexts/RoleContext";
import {
  useGetLcaGovernanceSummary,
  getGetLcaGovernanceSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  LcaGovernanceSummary,
  LcaGovernanceAlert,
  LcaEligibleProjectStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Banknote,
  CalendarClock,
  GitFork,
  Landmark,
  ListChecks,
  TrendingDown,
  ClipboardList,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useListLcaConfigs } from "@workspace/api-client-react";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function severityColor(s: string) {
  switch (s) {
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "high":     return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "medium":   return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    default:         return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  }
}

function severityDot(s: string) {
  switch (s) {
    case "critical": return "bg-red-500";
    case "high":     return "bg-orange-500";
    case "medium":   return "bg-yellow-500";
    default:         return "bg-blue-500";
  }
}

function alertTypeLabel(t: string) {
  switch (t) {
    case "missing_config":         return "Missing Config";
    case "overdue_payment":        return "Overdue Payment";
    case "pending_payment":        return "Payment Due";
    case "carry_forward":          return "Carry-Forward";
    case "no_ledger_entries":      return "No Schedule";
    case "lifecycle_mismatch":     return "Lifecycle Mismatch";
    case "revenue_model_mismatch": return "Model Mismatch";
    default:                       return t;
  }
}

function alertTypeIcon(t: string) {
  switch (t) {
    case "missing_config":         return <Landmark className="h-4 w-4" />;
    case "overdue_payment":        return <CalendarClock className="h-4 w-4" />;
    case "pending_payment":        return <Banknote className="h-4 w-4" />;
    case "carry_forward":          return <TrendingDown className="h-4 w-4" />;
    case "no_ledger_entries":      return <ClipboardList className="h-4 w-4" />;
    case "lifecycle_mismatch":     return <GitFork className="h-4 w-4" />;
    case "revenue_model_mismatch": return <ShieldX className="h-4 w-4" />;
    default:                       return <AlertTriangle className="h-4 w-4" />;
  }
}

function healthBadge(critCount: number, highCount: number) {
  if (critCount > 0)
    return (
      <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
        <ShieldX className="h-4 w-4" /> Critical Issues
      </span>
    );
  if (highCount > 0)
    return (
      <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
        <ShieldAlert className="h-4 w-4" /> Attention Required
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
      <ShieldCheck className="h-4 w-4" /> All Clear
    </span>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color ?? "text-white"}`}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
          </div>
          {icon && (
            <div className="p-2 rounded-lg bg-gray-700/60 text-gray-400">{icon}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Alert Row ─────────────────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: LcaGovernanceAlert }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-lg mb-2 ${severityColor(alert.severity)}`}>
      <button
        className="w-full flex items-start gap-3 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${severityDot(alert.severity)}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide">
              {alertTypeIcon(alert.alertType)}
              {alertTypeLabel(alert.alertType)}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-current">
              {alert.severity}
            </Badge>
            <span className="text-xs text-gray-300">{alert.projectName}</span>
            {alert.year && (
              <span className="text-xs text-gray-400">· {alert.year}</span>
            )}
            {alert.amount != null && (
              <span className="text-xs font-medium ml-auto">{fmt(alert.amount)}</span>
            )}
          </div>
          <p className="text-xs text-gray-300 mt-1 leading-relaxed">{alert.message}</p>
        </div>
        <span className="text-gray-400 flex-shrink-0 ml-1">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-0">
          <div className="border-t border-current/20 pt-2.5 flex items-start gap-2">
            <ListChecks className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{alert.suggestedAction}</p>
          </div>
          {(alert.configId || alert.ledgerEntryId) && (
            <div className="mt-2 flex gap-2">
              <Link href="/lca-config">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-current/30 text-inherit bg-transparent hover:bg-white/10">
                  <ExternalLink className="h-3 w-3" /> Go to LCA Config
                </Button>
              </Link>
              {alert.ledgerEntryId && (
                <Link href="/lca-ledger">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-current/30 text-inherit bg-transparent hover:bg-white/10">
                    <ExternalLink className="h-3 w-3" /> Go to LCA Ledger
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Project Task Row ──────────────────────────────────────────────────────────

function ProjectTaskRow({ p }: { p: LcaEligibleProjectStatus }) {
  const healthColor =
    p.overdueCount > 0 ? "text-red-400"
    : p.pendingCount > 0 ? "text-yellow-400"
    : !p.hasActiveConfig ? "text-orange-400"
    : "text-emerald-400";

  const healthLabel =
    p.overdueCount > 0 ? "Overdue"
    : p.pendingCount > 0 ? "Payment due"
    : !p.hasActiveConfig ? "No config"
    : p.ledgerEntryCount === 0 ? "No schedule"
    : "Up to date";

  return (
    <TableRow className="border-gray-700 hover:bg-gray-700/30">
      <TableCell>
        <Link href={`/projects/${p.projectId}`}>
          <span className="text-blue-400 hover:underline text-sm font-medium">{p.projectName}</span>
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
          Mature Production
        </Badge>
      </TableCell>
      <TableCell>
        {p.hasActiveConfig ? (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
            Configured
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/30">
            Missing
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-center text-sm text-gray-300">{p.ledgerEntryCount}</TableCell>
      <TableCell className="text-center">
        {p.overdueCount > 0 ? (
          <span className="text-red-400 font-semibold text-sm">{p.overdueCount}</span>
        ) : (
          <span className="text-gray-500 text-sm">—</span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm font-mono text-gray-300">
        {p.totalBalance > 0 ? fmt(p.totalBalance) : <span className="text-gray-500">—</span>}
      </TableCell>
      <TableCell className="text-right text-sm font-mono">
        {p.totalCarryForward > 0 ? (
          <span className="text-orange-400">{fmt(p.totalCarryForward)}</span>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </TableCell>
      <TableCell>
        <span className={`text-xs font-semibold ${healthColor}`}>{healthLabel}</span>
      </TableCell>
    </TableRow>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LCAGovernance() {
  const { role } = useRole();
  const qc = useQueryClient();

  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const params = projectFilter !== "all" ? { projectId: projectFilter } : {};

  const { data, isLoading, error } = useGetLcaGovernanceSummary(params);

  const { data: configs } = useListLcaConfigs({});

  const projectOptions = useMemo(() => {
    if (!data?.eligibleProjects) return [];
    const seen = new Map<string, string>();
    for (const p of data.eligibleProjects) seen.set(p.projectId, p.projectName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const filteredAlerts = useMemo(() => {
    if (!data?.alerts) return [];
    return data.alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (typeFilter !== "all" && a.alertType !== typeFilter) return false;
      return true;
    });
  }, [data?.alerts, severityFilter, typeFilter]);

  const critCount = data?.alerts.filter((a) => a.severity === "critical").length ?? 0;
  const highCount  = data?.alerts.filter((a) => a.severity === "high").length ?? 0;

  function refresh() {
    qc.invalidateQueries({ queryKey: getGetLcaGovernanceSummaryQueryKey(params) });
  }

  if (!["admin", "developer"].includes(role ?? "")) {
    return (
      <div className="p-6 text-gray-400 text-sm">
        LCA Governance monitoring is available to admin and developer roles only.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-gray-700 rounded animate-pulse" />
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-red-400 text-sm">
        Failed to load LCA governance data.{" "}
        <button onClick={refresh} className="underline">Retry</button>
      </div>
    );
  }

  const { stats, eligibleProjects, alerts } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-amber-400" />
            LCA Governance Monitor
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Alerts, compliance checks and task tracking for Land Contribution Adjustment (LCA) obligations.
            Active only for <span className="text-emerald-400 font-medium">mature production</span> projects with{" "}
            <span className="text-blue-400 font-medium">contribution</span> model agreements.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {healthBadge(critCount, highCount)}
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Eligible Projects"
          value={stats.eligibleProjectCount}
          sub={`${stats.configuredCount} configured`}
          icon={<Landmark className="h-5 w-5" />}
        />
        <KpiCard
          label="Missing Configs"
          value={stats.missingConfigCount}
          sub="need LCA setup"
          color={stats.missingConfigCount > 0 ? "text-orange-400" : "text-emerald-400"}
          icon={<ShieldX className="h-5 w-5" />}
        />
        <KpiCard
          label="Overdue Payments"
          value={stats.overdueCount}
          sub={`${stats.currentYearPendingCount} due this year`}
          color={stats.overdueCount > 0 ? "text-red-400" : "text-emerald-400"}
          icon={<CalendarClock className="h-5 w-5" />}
        />
        <KpiCard
          label="Carry-Forward Entries"
          value={stats.carryForwardCount}
          sub={stats.totalCarryForward > 0 ? fmt(stats.totalCarryForward) : "None outstanding"}
          color={stats.carryForwardCount > 0 ? "text-orange-400" : "text-emerald-400"}
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <KpiCard
          label="Total Outstanding"
          value={stats.totalOutstanding > 0 ? fmt(stats.totalOutstanding) : "₹0"}
          sub={`${stats.mismatchCount > 0 ? stats.mismatchCount + " mismatch" : "No mismatches"}`}
          color={stats.totalOutstanding > 0 ? "text-yellow-400" : "text-emerald-400"}
          icon={<Banknote className="h-5 w-5" />}
        />
      </div>

      {/* Eligibility summary note */}
      {stats.eligibleProjectCount === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-5 flex items-center gap-3 text-gray-400 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
            No projects are currently LCA-eligible. Projects become eligible when they transition to
            the <span className="text-emerald-400 font-medium mx-1">mature production</span>
            lifecycle phase and have an active{" "}
            <span className="text-blue-400 font-medium mx-1">contribution model</span> agreement.
          </CardContent>
        </Card>
      )}

      {/* Alert Panel */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Governance Alerts
              {alerts.length > 0 && (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                  {alerts.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="h-8 w-36 bg-gray-700 border-gray-600 text-gray-300 text-xs">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-44 bg-gray-700 border-gray-600 text-gray-300 text-xs">
                  <SelectValue placeholder="Alert Type" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="missing_config">Missing Config</SelectItem>
                  <SelectItem value="overdue_payment">Overdue Payment</SelectItem>
                  <SelectItem value="pending_payment">Payment Due</SelectItem>
                  <SelectItem value="carry_forward">Carry-Forward</SelectItem>
                  <SelectItem value="no_ledger_entries">No Schedule</SelectItem>
                  <SelectItem value="lifecycle_mismatch">Lifecycle Mismatch</SelectItem>
                  <SelectItem value="revenue_model_mismatch">Model Mismatch</SelectItem>
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-8 w-44 bg-gray-700 border-gray-600 text-gray-300 text-xs">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="all">All Projects</SelectItem>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredAlerts.length === 0 ? (
            <div className="flex items-center gap-3 py-6 text-gray-500 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              {alerts.length === 0
                ? "No governance alerts — all LCA obligations are up to date."
                : "No alerts match the current filters."}
            </div>
          ) : (
            <div>
              {/* Group by severity */}
              {(["critical", "high", "medium", "low"] as const).map((sev) => {
                const group = filteredAlerts.filter((a) => a.severity === sev);
                if (group.length === 0) return null;
                return (
                  <div key={sev} className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">
                      {sev} · {group.length}
                    </p>
                    {group.map((a) => (
                      <AlertRow key={a.id} alert={a} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-project task center */}
      {eligibleProjects.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-400" />
              LCA Task Center
              <span className="text-sm font-normal text-gray-400">— per eligible project</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700 hover:bg-transparent">
                  <TableHead className="text-gray-400 text-xs">Project</TableHead>
                  <TableHead className="text-gray-400 text-xs">Lifecycle</TableHead>
                  <TableHead className="text-gray-400 text-xs">LCA Config</TableHead>
                  <TableHead className="text-gray-400 text-xs text-center">Schedule</TableHead>
                  <TableHead className="text-gray-400 text-xs text-center">Overdue</TableHead>
                  <TableHead className="text-gray-400 text-xs text-right">Balance</TableHead>
                  <TableHead className="text-gray-400 text-xs text-right">Carry-Fwd</TableHead>
                  <TableHead className="text-gray-400 text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleProjects.map((p) => (
                  <ProjectTaskRow key={p.projectId} p={p} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Escalation tracking panel */}
      {(stats.overdueCount > 0 || stats.carryForwardCount > 0) && (
        <Card className="bg-gray-800 border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-orange-400 text-base flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              Escalation Tracker
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-400">
              LCA amounts escalate annually by the configured escalation percentage. Unpaid balances carry
              forward and are added to the following year's total due. Compounding carry-forwards can
              significantly increase the outstanding balance over time.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Overdue (past years)</p>
                <p className="text-lg font-bold text-red-400 mt-1">{stats.overdueCount} entries</p>
                <p className="text-xs text-gray-500 mt-0.5">Immediate action required</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Carry-Forward Entries</p>
                <p className="text-lg font-bold text-orange-400 mt-1">{stats.carryForwardCount} entries</p>
                <p className="text-xs text-gray-500 mt-0.5">{fmt(stats.totalCarryForward)} rolling over</p>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Total Outstanding</p>
                <p className="text-lg font-bold text-yellow-400 mt-1">{fmt(stats.totalOutstanding)}</p>
                <p className="text-xs text-gray-500 mt-0.5">Across all projects</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Link href="/lca-ledger">
                <Button size="sm" variant="outline" className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 gap-1.5 text-xs">
                  <ExternalLink className="h-3 w-3" /> Open LCA Ledger
                </Button>
              </Link>
              <Link href="/lca-config">
                <Button size="sm" variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1.5 text-xs">
                  <ExternalLink className="h-3 w-3" /> Manage Configs
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Eligibility rule explanation */}
      <Card className="bg-gray-800/50 border-gray-700/50">
        <CardContent className="p-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">LCA Eligibility Rule:</span>{" "}
            Land Contribution Adjustment (LCA) is a recurring annual obligation that applies exclusively to
            projects in the <span className="text-emerald-400">mature production</span> lifecycle phase
            that have an active agreement using the <span className="text-blue-400">contribution</span> revenue model.
            Projects using the 50% revenue-sharing model are not subject to LCA charges.
            Missing configs, overdue payments, and carry-forward balances all represent governance
            compliance gaps requiring resolution.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
