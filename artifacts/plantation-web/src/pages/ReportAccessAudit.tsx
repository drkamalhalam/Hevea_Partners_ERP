/**
 * ReportAccessAudit.tsx
 *
 * Admin-only dashboard showing the report_access_audit log.
 * Who accessed which analytics/reporting module, when, and whether it was granted.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "../lib/authFetch";
import { useLocation } from "wouter";
import {
  Shield, RefreshCw, Filter, X, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, BarChart3, Users, Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useRole } from "@/contexts/RoleContext";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id:           string;
  userId:       string | null;
  userRole:     string | null;
  displayName:  string | null;
  module:       string;
  endpoint:     string;
  projectId:    string | null;
  projectName:  string | null;
  accessGranted: boolean;
  denyReason:   string | null;
  ipAddress:    string | null;
  userAgent:    string | null;
  accessedAt:   string | null;
}

interface AuditSummary {
  moduleStats:   Array<{ module: string; total_accesses: number; denied: number; granted: number; last_access: string }>;
  roleStats:     Array<{ user_role: string; total: number; denied: number }>;
  recentDenials: Array<{ module: string; endpoint: string; user_role: string; deny_reason: string | null; ip_address: string | null; accessed_at: string; display_name: string | null }>;
  dailyVolume:   Array<{ day: string; accesses: number; denials: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  financial_reports:    "Financial Reports",
  financial_analytics:  "Financial Analytics",
  settlement_analytics: "Settlement Analytics",
  ownership_analytics:  "Ownership Analytics",
  governance_reports:   "Governance Reports",
  analytics_hub:        "Analytics Hub",
  report_exports:       "Report Exports",
  global_analytics:     "Global Analytics",
};

const ROLE_COLORS: Record<string, string> = {
  admin:             "bg-purple-500/20 text-purple-300 border-purple-500/30",
  developer:         "bg-blue-500/20 text-blue-300 border-blue-500/30",
  landowner:         "bg-green-500/20 text-green-300 border-green-500/30",
  investor:          "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  employee:          "bg-slate-500/20 text-slate-300 border-slate-500/30",
  operational_staff: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

function RoleBadge({ role }: { role: string | null }) {
  const cls = role ? (ROLE_COLORS[role] ?? "bg-slate-700 text-slate-300") : "bg-slate-700 text-slate-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {role ?? "—"}
    </span>
  );
}

function GrantedBadge({ granted, reason }: { granted: boolean; reason?: string | null }) {
  if (granted) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
        <CheckCircle2 className="w-3 h-3" />
        Granted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/25" title={reason ?? ""}>
      <XCircle className="w-3 h-3" />
      Denied
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtModule(module: string, endpoint: string): string {
  const label = MODULE_LABELS[module] ?? module;
  const ep = endpoint.replace(/_/g, " ");
  return `${label} › ${ep}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportAccessAudit() {
  const authFetch = useAuthFetch();
  const { role } = useRole();
  const [, navigate] = useLocation();

  // Guard — admin/developer only
  useEffect(() => {
    if (role && role !== "admin" && role !== "developer") {
      navigate("/dashboard");
    }
  }, [role, navigate]);

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"log" | "summary">("log");

  // Filters
  const [filterModule,  setFilterModule]  = useState("");
  const [filterRole,    setFilterRole]    = useState("");
  const [filterGranted, setFilterGranted] = useState<"" | "true" | "false">("");
  const [filterFrom,    setFilterFrom]    = useState("");
  const [filterTo,      setFilterTo]      = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit",  String(limit));
    params.set("offset", String(page * limit));
    if (filterModule)  params.set("module",       filterModule);
    if (filterRole)    params.set("userRole",      filterRole);
    if (filterGranted) params.set("accessGranted", filterGranted);
    if (filterFrom)    params.set("dateFrom",      filterFrom);
    if (filterTo)      params.set("dateTo",        filterTo);
    return params.toString();
  }, [filterModule, filterRole, filterGranted, filterFrom, filterTo, page]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/report-access-audit?${buildQuery()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { logs: AuditEntry[]; total: number };
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/report-access-audit/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AuditSummary;
      setSummary(data);
    } catch {
      // non-fatal
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);
  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

  const applyFilters = () => { setPage(0); void fetchLogs(); };
  const clearFilters = () => {
    setFilterModule(""); setFilterRole(""); setFilterGranted("");
    setFilterFrom(""); setFilterTo(""); setPage(0);
  };
  const hasFilters = filterModule || filterRole || filterGranted || filterFrom || filterTo;

  const totalPages = Math.ceil(total / limit);

  if (role !== "admin" && role !== "developer") return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/25">
            <Shield className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Report Access Audit</h1>
            <p className="text-sm text-slate-400">Who accessed which analytics and reporting modules</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-300 hover:bg-slate-800 gap-1"
          onClick={() => { void fetchLogs(); void fetchSummary(); }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
        {(["log", "summary"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize
              ${activeTab === tab ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            {tab === "log" ? "Access Log" : "Summary"}
          </button>
        ))}
      </div>

      {/* ── ACCESS LOG TAB ─────────────────────────────────────────────────── */}
      {activeTab === "log" && (
        <>
          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-300">Filters</span>
              {hasFilters && (
                <button onClick={clearFilters} className="ml-auto text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Select value={filterModule || "__all__"} onValueChange={v => setFilterModule(v === "__all__" ? "" : v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-8">
                  <SelectValue placeholder="All modules" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="__all__">All modules</SelectItem>
                  {Object.entries(MODULE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterRole || "__all__"} onValueChange={v => setFilterRole(v === "__all__" ? "" : v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-8">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="__all__">All roles</SelectItem>
                  {["admin","developer","landowner","investor","employee","operational_staff"].map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterGranted || "__all__"} onValueChange={v => setFilterGranted(v === "__all__" ? "" : v as "" | "true" | "false")}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-8">
                  <SelectValue placeholder="All results" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="__all__">All results</SelectItem>
                  <SelectItem value="true">Granted only</SelectItem>
                  <SelectItem value="false">Denied only</SelectItem>
                </SelectContent>
              </Select>

              <Input
                type="date"
                value={filterFrom}
                onChange={e => setFilterFrom(e.target.value)}
                placeholder="From date"
                className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-8"
              />
              <Input
                type="date"
                value={filterTo}
                onChange={e => setFilterTo(e.target.value)}
                placeholder="To date"
                className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-8"
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-500">{total.toLocaleString()} entries</span>
              <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white" onClick={applyFilters}>
                Apply Filters
              </Button>
            </div>
          </div>

          {/* Table */}
          {error && (
            <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-sm rounded-lg p-4 mb-4">
              Failed to load audit log: {error}
            </div>
          )}
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/80">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Role</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Module › Endpoint</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Project</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Result</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-slate-800/50">
                        {Array.from({ length: 7 }).map((__, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 bg-slate-800 rounded animate-pulse w-24" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">
                        No audit entries found
                      </td>
                    </tr>
                  ) : (
                    logs.map(entry => (
                      <tr key={entry.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${!entry.accessGranted ? "bg-red-950/10" : ""}`}>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap font-mono">
                          {fmtTime(entry.accessedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-200">{entry.displayName ?? "—"}</div>
                          {entry.userId && (
                            <div className="text-xs text-slate-500 font-mono">{entry.userId.slice(0, 8)}…</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={entry.userRole} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-300">{fmtModule(entry.module, entry.endpoint)}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {entry.projectName ?? (entry.projectId ? entry.projectId.slice(0, 8) + "…" : "—")}
                        </td>
                        <td className="px-4 py-3">
                          <GrantedBadge granted={entry.accessGranted} reason={entry.denyReason} />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                          {entry.ipAddress ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Page {page + 1} of {totalPages} ({total.toLocaleString()} total)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="h-7 w-7 p-0 border-slate-700 text-slate-400"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    className="h-7 w-7 p-0 border-slate-700 text-slate-400"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── SUMMARY TAB ───────────────────────────────────────────────────── */}
      {activeTab === "summary" && (
        <div className="space-y-6">
          {summaryLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg p-4 h-32 animate-pulse" />
              ))}
            </div>
          ) : summary ? (
            <>
              {/* Module stats */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-medium text-slate-200">Module Access (Last 30 Days)</h3>
                </div>
                <div className="space-y-3">
                  {summary.moduleStats.length === 0 ? (
                    <p className="text-sm text-slate-500">No data yet</p>
                  ) : (
                    summary.moduleStats.map(m => (
                      <div key={m.module} className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 w-40 truncate">{MODULE_LABELS[m.module] ?? m.module}</span>
                        <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${Math.min(100, (m.granted / Math.max(1, m.total_accesses)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-300 w-12 text-right">{m.total_accesses.toLocaleString()}</span>
                        {m.denied > 0 && (
                          <span className="text-xs text-red-400 w-16">{m.denied} denied</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Role breakdown */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-slate-200">Role Breakdown</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {summary.roleStats.length === 0 ? (
                    <p className="text-sm text-slate-500">No data yet</p>
                  ) : (
                    summary.roleStats.map(r => (
                      <div key={r.user_role} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
                        <RoleBadge role={r.user_role} />
                        <div className="mt-2 text-lg font-semibold text-slate-100">{r.total.toLocaleString()}</div>
                        {r.denied > 0 && (
                          <div className="text-xs text-red-400">{r.denied} denied</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recent denials */}
              {summary.recentDenials.length > 0 && (
                <div className="bg-slate-900 border border-red-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <h3 className="text-sm font-medium text-slate-200">Recent Denied Attempts</h3>
                  </div>
                  <div className="space-y-2">
                    {summary.recentDenials.map((d, i) => (
                      <div key={i} className="flex items-start justify-between gap-4 text-xs py-2 border-b border-slate-800/50 last:border-0">
                        <div>
                          <span className="text-slate-300">{d.display_name ?? "Unknown"}</span>
                          <span className="text-slate-500 mx-2">·</span>
                          <RoleBadge role={d.user_role} />
                          <span className="text-slate-500 mx-2">→</span>
                          <span className="text-slate-400">{fmtModule(d.module, d.endpoint)}</span>
                        </div>
                        <div className="text-slate-500 whitespace-nowrap">{fmtTime(d.accessed_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Daily volume */}
              {summary.dailyVolume.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-medium text-slate-200">Daily Access Volume (Last 30 Days)</h3>
                  </div>
                  <div className="flex items-end gap-1 h-24">
                    {summary.dailyVolume.map((d, i) => {
                      const max = Math.max(...summary.dailyVolume.map(x => x.accesses), 1);
                      const pct = (d.accesses / max) * 100;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={`${d.day}: ${d.accesses} accesses`}>
                          <div
                            className="w-full bg-amber-500/60 rounded-sm min-h-0.5"
                            style={{ height: `${Math.max(2, pct)}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-slate-500">{summary.dailyVolume[0]?.day}</span>
                    <span className="text-xs text-slate-500">{summary.dailyVolume[summary.dailyVolume.length - 1]?.day}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-slate-500 p-8 text-center">Could not load summary data</div>
          )}
        </div>
      )}
    </div>
  );
}
