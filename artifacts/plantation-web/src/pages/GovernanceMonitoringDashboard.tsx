/**
 * GovernanceMonitoringDashboard.tsx
 *
 * Governance monitoring & legal traceability dashboard.
 * Covers: suspicious overrides, settlement deviations, missing documents,
 * long-pending disputes, audit gaps, incomplete maturity workflows,
 * and cross-project compliance status.
 */

import { useState, useMemo } from "react";
import { useAuthFetch } from "../lib/authFetch";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useProjectFilter } from "../contexts/ProjectFilterContext";
import { useRole } from "../contexts/RoleContext";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileWarning,
  Gavel,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  TriangleAlert,
  XCircle,
  Activity,
  BookOpen,
  ClipboardList,
  Search,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Skeleton } from "../components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComplianceAlert {
  id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  projectId?: string | null;
  projectName?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  actionPath?: string | null;
  daysOpen: number;
  metadata?: Record<string, unknown> | null;
  detectedAt: string;
}

interface ComplianceSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  byCategory: Record<string, number>;
}

interface ComplianceResponse {
  summary: ComplianceSummary;
  alerts: ComplianceAlert[];
  projectMatrix: ProjectComplianceStatus[];
}

interface ProjectComplianceStatus {
  projectId: string;
  projectName: string;
  lifecycleStatus: string;
  overallRisk: "critical" | "high" | "medium" | "low" | "healthy";
  checks: {
    hasNominee: boolean;
    hasGovernanceDocs: boolean;
    hasCompletedMaturity: boolean;
    hasOpenDisputes: boolean;
    hasAuditTrail: boolean;
    hasOverrideIssues: boolean;
  };
  alertCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: {
    label: "Critical",
    badge: "bg-red-950 text-red-300 border border-red-700/50",
    border: "border-l-4 border-l-red-500",
    dot: "bg-red-500",
    icon: ShieldX,
    iconClass: "text-red-400",
    bg: "bg-red-950/20",
  },
  high: {
    label: "High",
    badge: "bg-orange-950 text-orange-300 border border-orange-700/50",
    border: "border-l-4 border-l-orange-500",
    dot: "bg-orange-500",
    icon: AlertTriangle,
    iconClass: "text-orange-400",
    bg: "bg-orange-950/20",
  },
  medium: {
    label: "Medium",
    badge: "bg-yellow-950 text-yellow-300 border border-yellow-700/50",
    border: "border-l-4 border-l-yellow-500",
    dot: "bg-yellow-500",
    icon: TriangleAlert,
    iconClass: "text-yellow-400",
    bg: "bg-yellow-950/20",
  },
  low: {
    label: "Low",
    badge: "bg-slate-800 text-slate-400 border border-slate-600/50",
    border: "border-l-4 border-l-slate-500",
    dot: "bg-slate-500",
    icon: AlertTriangle,
    iconClass: "text-slate-400",
    bg: "bg-slate-800/30",
  },
  info: {
    label: "Info",
    badge: "bg-blue-950 text-blue-300 border border-blue-700/50",
    border: "border-l-4 border-l-blue-500",
    dot: "bg-blue-500",
    icon: Activity,
    iconClass: "text-blue-400",
    bg: "bg-blue-950/20",
  },
} as const;

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  suspicious_override: { label: "Suspicious Override", icon: SlidersHorizontal, color: "text-orange-400" },
  excessive_settlement: { label: "Settlement Deviation", icon: Scale, color: "text-yellow-400" },
  missing_governance_doc: { label: "Missing Gov. Doc", icon: FileWarning, color: "text-red-400" },
  long_pending_dispute: { label: "Stalled Dispute", icon: Gavel, color: "text-orange-400" },
  audit_gap: { label: "Audit Gap", icon: ClipboardList, color: "text-red-400" },
  incomplete_maturity: { label: "Maturity Incomplete", icon: BookOpen, color: "text-yellow-400" },
  missing_nominee: { label: "Missing Nominee", icon: ShieldAlert, color: "text-red-400" },
  missing_claimant_doc: { label: "Claimant Docs", icon: FileWarning, color: "text-orange-400" },
};

const RISK_CONFIG = {
  critical: { label: "Critical", cls: "text-red-400 bg-red-950/50 border-red-700/50", dot: "bg-red-500" },
  high: { label: "High Risk", cls: "text-orange-400 bg-orange-950/50 border-orange-700/50", dot: "bg-orange-500" },
  medium: { label: "Medium Risk", cls: "text-yellow-400 bg-yellow-950/50 border-yellow-700/50", dot: "bg-yellow-500" },
  low: { label: "Low Risk", cls: "text-blue-400 bg-blue-950/50 border-blue-700/50", dot: "bg-blue-500" },
  healthy: { label: "Healthy", cls: "text-emerald-400 bg-emerald-950/50 border-emerald-700/50", dot: "bg-emerald-500" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d}d ago`;
}

function capitalize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Alert Card ────────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: ComplianceAlert }) {
  const sev = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.medium;
  const cat = CATEGORY_CONFIG[alert.category];
  const Icon = sev.icon;

  return (
    <div className={`rounded-lg border border-slate-700/50 ${sev.bg} ${sev.border} p-4 hover:border-slate-600/70 transition-colors`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${sev.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-slate-100 text-sm font-medium">{alert.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sev.badge}`}>
              {sev.label}
            </span>
            {cat && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/50">
                {cat.label}
              </span>
            )}
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">{alert.description}</p>
          <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-500">
            {alert.projectName && (
              <span>
                Project: <span className="text-slate-400">{alert.projectName}</span>
              </span>
            )}
            {alert.daysOpen > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {alert.daysOpen}d open
              </span>
            )}
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              Detected {fmtRelative(alert.detectedAt)}
            </span>
          </div>
        </div>
        {alert.actionPath && (
          <Link href={alert.actionPath}>
            <Button size="sm" variant="ghost" className="shrink-0 text-slate-400 hover:text-slate-100 h-7 px-2">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Project Matrix Row ─────────────────────────────────────────────────────────

function ProjectMatrixRow({ proj }: { proj: ProjectComplianceStatus }) {
  const risk = RISK_CONFIG[proj.overallRisk];
  const checks = proj.checks;

  const CheckIcon = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex flex-col items-center gap-0.5" title={label}>
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <XCircle className="h-4 w-4 text-red-400" />
      )}
      <span className="text-[9px] text-slate-500 text-center leading-none w-14 truncate">{label}</span>
    </div>
  );

  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-700/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${risk.dot}`} />
          <p className="text-sm font-medium text-slate-200 truncate">{proj.projectName}</p>
        </div>
        <p className="text-xs text-slate-500 ml-4">{capitalize(proj.lifecycleStatus)}</p>
      </div>
      <div className="flex gap-3 flex-shrink-0">
        <CheckIcon ok={checks.hasNominee} label="Nominee" />
        <CheckIcon ok={checks.hasGovernanceDocs} label="Gov. Docs" />
        <CheckIcon ok={checks.hasCompletedMaturity} label="Maturity" />
        <CheckIcon ok={!checks.hasOpenDisputes} label="No Disputes" />
        <CheckIcon ok={checks.hasAuditTrail} label="Audit Trail" />
        <CheckIcon ok={!checks.hasOverrideIssues} label="Overrides OK" />
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 w-28 justify-end">
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${risk.cls}`}>
          {risk.label}
        </span>
        {proj.alertCount > 0 && (
          <span className="text-xs text-slate-500">
            {proj.alertCount} alert{proj.alertCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Risk Gauge ────────────────────────────────────────────────────────────────

function RiskGauge({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`font-medium ${color}`}>{value}</span>
      </div>
      <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color.replace("text-", "bg-")}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GovernanceMonitoringDashboard() {
  const authFetch = useAuthFetch();
  const { selectedProjectId } = useProjectFilter();
  const { role } = useRole();
  const [tab, setTab] = useState<"overview" | "alerts" | "matrix">("overview");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery<ComplianceResponse>({
    queryKey: ["/api/governance-monitoring/legal-compliance", selectedProjectId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      const res = await authFetch(`${BASE_URL}/api/governance-monitoring/legal-compliance?${params}`);
      if (!res.ok) throw new Error("Failed to fetch compliance data");
      return res.json() as Promise<ComplianceResponse>;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  if (!["admin", "developer"].includes(role ?? "")) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Lock className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Access restricted to administrators and developers.</p>
        </div>
      </div>
    );
  }

  const summary = data?.summary;
  const allAlerts = data?.alerts ?? [];
  const projectMatrix = data?.projectMatrix ?? [];

  const filteredAlerts = useMemo(() => {
    return allAlerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      return true;
    });
  }, [allAlerts, severityFilter, categoryFilter]);

  const categories = useMemo(() => Array.from(new Set(allAlerts.map((a) => a.category))), [allAlerts]);

  const criticalCount = summary?.critical ?? 0;
  const highCount = summary?.high ?? 0;
  const healthyProjects = projectMatrix.filter((p) => p.overallRisk === "healthy").length;
  const atRiskProjects = projectMatrix.filter((p) => ["critical", "high"].includes(p.overallRisk)).length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-6 space-y-5">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-800/40">
            <ShieldCheck className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-100">Governance Monitoring</h1>
              <Badge className="text-xs bg-slate-800 text-slate-400 border border-slate-700">Legal Traceability</Badge>
            </div>
            <p className="text-slate-400 text-sm mt-0.5">
              Audit consistency, override anomalies, settlement compliance, and cross-project risk status.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-slate-500">
              Updated {fmtRelative(new Date(dataUpdatedAt).toISOString())}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700"
            onClick={() => void refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── KPI Tiles ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Critical Issues", value: criticalCount, cls: "bg-red-950/40 border-red-800/40", vCls: "text-red-300", icon: ShieldX },
          { label: "High Risk", value: highCount, cls: "bg-orange-950/40 border-orange-800/40", vCls: "text-orange-300", icon: AlertTriangle },
          { label: "Total Alerts", value: summary?.total ?? 0, cls: "bg-slate-800/60 border-slate-700/50", vCls: "text-slate-200", icon: TriangleAlert },
          { label: "Projects At Risk", value: atRiskProjects, cls: "bg-amber-950/40 border-amber-800/40", vCls: "text-amber-300", icon: LayoutDashboard },
          { label: "Healthy Projects", value: healthyProjects, cls: "bg-emerald-950/40 border-emerald-800/40", vCls: "text-emerald-300", icon: ShieldCheck },
        ].map((tile) => (
          <Card key={tile.label} className={`${tile.cls} border`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <tile.icon className={`h-4 w-4 ${tile.vCls} opacity-70`} />
                <p className="text-xs text-slate-400">{tile.label}</p>
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-16 bg-slate-700" />
              ) : (
                <p className={`text-3xl font-bold ${tile.vCls}`}>{tile.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Risk Gauges ───────────────────────────────────────────────────────── */}
      {summary && (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 font-medium mb-3 uppercase tracking-wider">Alert Distribution by Severity</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <RiskGauge label="Critical" value={summary.critical} max={summary.total || 1} color="text-red-400" />
              <RiskGauge label="High" value={summary.high} max={summary.total || 1} color="text-orange-400" />
              <RiskGauge label="Medium" value={summary.medium} max={summary.total || 1} color="text-yellow-400" />
              <RiskGauge label="Low" value={summary.low} max={summary.total || 1} color="text-slate-400" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="bg-slate-800/80 border border-slate-700/60 h-9">
          <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
            Category Overview
          </TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
            All Alerts
            {criticalCount > 0 && (
              <span className="ml-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                {criticalCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="matrix" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Project Matrix
          </TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-40 bg-slate-800/60 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(CATEGORY_CONFIG).map(([catKey, catCfg]) => {
                const catAlerts = allAlerts.filter((a) => a.category === catKey);
                const criticals = catAlerts.filter((a) => a.severity === "critical").length;
                const highs = catAlerts.filter((a) => a.severity === "high").length;
                const CatIcon = catCfg.icon;

                return (
                  <Card key={catKey} className="bg-slate-800/50 border-slate-700/50 hover:border-slate-600/70 transition-colors">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CatIcon className={`h-4 w-4 ${catCfg.color}`} />
                          <CardTitle className="text-sm font-medium text-slate-200">
                            {catCfg.label}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {criticals > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-950 text-red-300 border border-red-700/50 font-medium">
                              {criticals} critical
                            </span>
                          )}
                          {highs > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-950 text-orange-300 border border-orange-700/50 font-medium">
                              {highs} high
                            </span>
                          )}
                          {catAlerts.length === 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-700/50">
                              ✓ Clear
                            </span>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      {catAlerts.length === 0 ? (
                        <div className="flex items-center gap-2 text-emerald-600 text-xs py-2">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>No issues detected in this category.</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {catAlerts.slice(0, 3).map((a) => {
                            const sev = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.medium;
                            return (
                              <div key={a.id} className={`text-xs rounded p-2 border ${sev.bg} ${sev.border} border-slate-700/30`}>
                                <div className="flex items-start gap-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${sev.dot}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-slate-300 font-medium">{a.title}</p>
                                    <p className="text-slate-500 mt-0.5 line-clamp-1">{a.description}</p>
                                    {a.projectName && (
                                      <p className="text-slate-600 mt-0.5">{a.projectName}</p>
                                    )}
                                  </div>
                                  {a.actionPath && (
                                    <Link href={a.actionPath}>
                                      <ChevronRight className="h-3.5 w-3.5 text-slate-500 hover:text-slate-300 flex-shrink-0" />
                                    </Link>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {catAlerts.length > 3 && (
                            <button
                              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                              onClick={() => { setTab("alerts"); setCategoryFilter(catKey); }}
                            >
                              +{catAlerts.length - 3} more
                            </button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── All Alerts Tab ────────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="mt-4">
          <div className="flex flex-wrap gap-3 mb-4">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-slate-200 h-8 text-xs">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all" className="text-slate-200 text-xs">All Severities</SelectItem>
                <SelectItem value="critical" className="text-red-300 text-xs">Critical</SelectItem>
                <SelectItem value="high" className="text-orange-300 text-xs">High</SelectItem>
                <SelectItem value="medium" className="text-yellow-300 text-xs">Medium</SelectItem>
                <SelectItem value="low" className="text-slate-300 text-xs">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-200 h-8 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all" className="text-slate-200 text-xs">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c} className="text-slate-200 text-xs">
                    {CATEGORY_CONFIG[c]?.label ?? capitalize(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(severityFilter !== "all" || categoryFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-slate-400 hover:text-slate-200"
                onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); }}
              >
                Clear filters
              </Button>
            )}
            <span className="ml-auto text-xs text-slate-500 self-center">
              {filteredAlerts.length} of {allAlerts.length} alerts
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800/60 rounded-lg" />)}
            </div>
          ) : isError ? (
            <Card className="bg-red-950/30 border-red-800/40">
              <CardContent className="p-6 text-center text-red-400 text-sm">
                Failed to load compliance alerts. Please try refreshing.
              </CardContent>
            </Card>
          ) : filteredAlerts.length === 0 ? (
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-slate-300 font-medium mb-1">No alerts matching filters</p>
                <p className="text-slate-500 text-sm">All monitored governance conditions are within acceptable parameters.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {filteredAlerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Project Matrix Tab ────────────────────────────────────────────── */}
        <TabsContent value="matrix" className="mt-4">
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-slate-200">
                  Per-Project Legal Traceability Matrix
                </CardTitle>
                <p className="text-xs text-slate-500">{projectMatrix.length} projects</p>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Six compliance checks evaluated per project. Red = failing, green = passing.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 bg-slate-700/60 rounded" />)}
                </div>
              ) : projectMatrix.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-8">No projects found.</p>
              ) : (
                <>
                  {/* Column headers */}
                  <div className="flex items-center gap-3 py-2 mb-1 border-b border-slate-700/50">
                    <div className="flex-1">
                      <p className="text-xs text-slate-500 font-medium">Project</p>
                    </div>
                    <div className="flex gap-3 flex-shrink-0 text-center">
                      {["Nominee", "Gov. Docs", "Maturity", "No Disputes", "Audit Trail", "Overrides OK"].map((h) => (
                        <span key={h} className="text-[9px] text-slate-500 w-14 leading-tight">{h}</span>
                      ))}
                    </div>
                    <div className="w-28 flex-shrink-0" />
                  </div>
                  <div>
                    {projectMatrix
                      .sort((a, b) => {
                        const order = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4 };
                        return (order[a.overallRisk] ?? 5) - (order[b.overallRisk] ?? 5);
                      })
                      .map((proj) => (
                        <ProjectMatrixRow key={proj.projectId} proj={proj} />
                      ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-3 px-1">
            {Object.entries(RISK_CONFIG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5 text-xs text-slate-500">
                <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span>{cfg.label}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Immutability notice ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 p-3 bg-slate-800/40 border border-slate-700/40 rounded-lg text-xs text-slate-500">
        <Lock className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
        <p>
          Governance overrides, audit entries, and dispute records are <span className="text-slate-400">write-once immutable</span> — this dashboard reads directly from the tamper-evident ledger. Alerts auto-refresh every 5 minutes.
        </p>
      </div>
    </div>
  );
}
