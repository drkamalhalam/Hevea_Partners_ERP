import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListOperationalAccessLogs,
  useGetOperationalAccessLogSummary,
} from "@workspace/api-client-react";
import type { AccessLogEntry } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ScanSearch,
  ShieldAlert,
  Eye,
  ListFilter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertOctagon,
  User,
  Server,
  Activity,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESOURCE_LABELS: Record<string, string> = {
  production_batch: "Production Batch",
  production_entry: "Production Entry",
  inventory_balance: "Inventory Balance",
  inventory_movement: "Inventory Movement",
  inventory_analytics: "Inventory Analytics",
  sale_transaction: "Sale Transaction",
  sale_detail: "Sale Detail",
  sale_analytics: "Sale Analytics",
  sale_summary: "Sale Summary",
};

const ACTION_LABELS: Record<string, string> = {
  list: "List",
  view: "View",
  analytics: "Analytics",
  summary: "Summary",
  export: "Export",
  denied: "Denied",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-violet-900/40 text-violet-300 border-violet-700/50",
  developer: "bg-blue-900/40 text-blue-300 border-blue-700/50",
  landowner: "bg-amber-900/40 text-amber-300 border-amber-700/50",
  investor: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50",
  employee: "bg-sky-900/40 text-sky-300 border-sky-700/50",
  operational_staff: "bg-slate-700/60 text-slate-300 border-slate-600/50",
  unknown: "bg-gray-800 text-gray-400 border-gray-700",
};

function roleBadgeClass(role: string): string {
  return ROLE_COLORS[role] ?? ROLE_COLORS.unknown;
}

function actionBadgeClass(action: string): string {
  if (action === "denied") return "bg-red-900/40 text-red-300 border-red-700/50";
  if (action === "analytics") return "bg-purple-900/40 text-purple-300 border-purple-700/50";
  if (action === "view") return "bg-blue-900/40 text-blue-300 border-blue-700/50";
  return "bg-slate-700/60 text-slate-300 border-slate-600/50";
}

function resourceBadgeClass(rt: string): string {
  if (rt.includes("sale")) return "bg-emerald-900/40 text-emerald-300 border-emerald-700/50";
  if (rt.includes("inventory")) return "bg-sky-900/40 text-sky-300 border-sky-700/50";
  if (rt.includes("production")) return "bg-amber-900/40 text-amber-300 border-amber-700/50";
  return "bg-slate-700/60 text-slate-300 border-slate-600/50";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OperationalAccessLog() {
  const { role } = useRole();

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterResource, setFilterResource] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [filterDenied, setFilterDenied] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: summary, isLoading: summaryLoading } =
    useGetOperationalAccessLogSummary();

  const queryParams = {
    ...(filterRole !== "all" ? { userId: undefined } : {}),
    ...(filterResource !== "all" ? { resourceType: filterResource } : {}),
    ...(filterAction !== "all" ? { action: filterAction } : {}),
    ...(filterDenied === "true" ? { accessDenied: "true" as const } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data: logPage, isLoading: logsLoading, refetch } =
    useListOperationalAccessLogs(queryParams);

  if (role !== "admin" && role !== "developer") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400 text-lg">Access restricted</p>
        <p className="text-slate-500 text-sm">Only admins and developers can view the access audit log.</p>
      </div>
    );
  }

  const logs = logPage?.logs ?? [];
  const total = logPage?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side search filter on userName/userRole/resourceRef/projectName
  const filtered = search.trim()
    ? logs.filter((l) =>
        [l.userName, l.userRole, l.resourceRef, l.projectName, l.resourceType, l.action, l.clientIp]
          .some((v) => v?.toLowerCase().includes(search.toLowerCase()))
      )
    : logs;

  const deniedCount = summary?.totalDenied ?? 0;
  const totalCount = summary?.total ?? 0;

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-900/30 rounded-lg border border-violet-700/40">
              <ScanSearch className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Operational Access Log</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Audit trail — who accessed production, inventory, and sales records
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider mb-1">
              <Activity className="w-3.5 h-3.5" /> Total Events
            </div>
            <span className="text-2xl font-bold text-white">
              {summaryLoading ? "—" : totalCount.toLocaleString()}
            </span>
          </div>
          <div className="bg-slate-900/60 border border-red-900/40 rounded-xl p-4 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-red-400 text-xs uppercase tracking-wider mb-1">
              <AlertOctagon className="w-3.5 h-3.5" /> Denied Access
            </div>
            <span className="text-2xl font-bold text-red-400">
              {summaryLoading ? "—" : deniedCount.toLocaleString()}
            </span>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider mb-1">
              <User className="w-3.5 h-3.5" /> Active Roles
            </div>
            <span className="text-2xl font-bold text-white">
              {summaryLoading ? "—" : (summary?.byRole.length ?? 0)}
            </span>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider mb-1">
              <Server className="w-3.5 h-3.5" /> Resource Types
            </div>
            <span className="text-2xl font-bold text-white">
              {summaryLoading ? "—" : (summary?.byResourceType.length ?? 0)}
            </span>
          </div>
        </div>

        {/* Role breakdown strip */}
        {summary && summary.byRole.length > 0 && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Access by Role</p>
            <div className="flex flex-wrap gap-2">
              {summary.byRole.map((r) => (
                <div
                  key={r.role}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all ${roleBadgeClass(r.role)} ${filterRole === r.role ? "ring-1 ring-white/20" : ""}`}
                  onClick={() => setFilterRole(filterRole === r.role ? "all" : r.role)}
                >
                  <span className="capitalize">{r.role.replace("_", " ")}</span>
                  <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">{r.count}</span>
                  {r.denied > 0 && (
                    <span className="bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded text-[10px]">
                      {r.denied} denied
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Search user, project, resource ref, IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-900/60 border-slate-700 text-slate-200 placeholder:text-slate-500 h-9 w-64"
          />
          <Select value={filterResource} onValueChange={(v) => { setFilterResource(v); setPage(0); }}>
            <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 h-9 w-44">
              <ListFilter className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
              <SelectValue placeholder="Resource type" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="all">All resources</SelectItem>
              {Object.entries(RESOURCE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterAction} onValueChange={(v) => { setFilterAction(v); setPage(0); }}>
            <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 h-9 w-36">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="all">All actions</SelectItem>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterDenied} onValueChange={(v) => { setFilterDenied(v); setPage(0); }}>
            <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 h-9 w-36">
              <SelectValue placeholder="Access status" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
              <SelectItem value="all">All access</SelectItem>
              <SelectItem value="true">Denied only</SelectItem>
            </SelectContent>
          </Select>
          {(filterRole !== "all" || filterResource !== "all" || filterAction !== "all" || filterDenied !== "all" || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setFilterRole("all"); setFilterResource("all"); setFilterAction("all"); setFilterDenied("all"); setSearch(""); setPage(0); }}
              className="text-slate-400 hover:text-slate-200 h-9 px-3"
            >
              Clear filters
            </Button>
          )}
          <span className="text-xs text-slate-500 ml-auto">
            {total.toLocaleString()} total entries
          </span>
        </div>

        {/* Log table */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
          {logsLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-3" />
              Loading audit records…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <Eye className="w-8 h-8 opacity-30" />
              <p className="text-sm">No access records match your filters</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60">
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">Resource</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">Action</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">Project</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <AccessLogRow
                    key={log.id}
                    log={log}
                    expanded={expandedId === log.id}
                    onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              Page {page + 1} of {totalPages} ({total.toLocaleString()} records)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

function AccessLogRow({
  log,
  expanded,
  onToggle,
}: {
  log: AccessLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-slate-800/60 hover:bg-slate-800/30 cursor-pointer transition-colors ${log.accessDenied ? "bg-red-950/10" : ""}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
          {formatTime(log.accessedAt)}
        </td>
        <td className="px-4 py-3">
          <span className="text-slate-200 text-xs">
            {log.userName ?? <span className="text-slate-600 italic">unknown</span>}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${roleBadgeClass(log.userRole)}`}>
            {log.userRole.replace("_", " ")}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${resourceBadgeClass(log.resourceType)}`}>
            {RESOURCE_LABELS[log.resourceType] ?? log.resourceType}
          </span>
          {log.resourceRef && (
            <span className="ml-2 text-xs text-slate-500 font-mono">{log.resourceRef}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${actionBadgeClass(log.action)}`}>
            {ACTION_LABELS[log.action] ?? log.action}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-slate-400">
          {log.projectName ?? <span className="text-slate-600">—</span>}
        </td>
        <td className="px-4 py-3">
          {log.accessDenied ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-900/40 text-red-400 border border-red-800/50">
              <AlertOctagon className="w-2.5 h-2.5" /> Denied
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">
              Allowed
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-slate-500">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-800/60 bg-slate-900/50">
          <td colSpan={8} className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-slate-500 uppercase tracking-wider mb-1">Log ID</p>
                <p className="font-mono text-slate-400 break-all">{log.id}</p>
              </div>
              {log.userId && (
                <div>
                  <p className="text-slate-500 uppercase tracking-wider mb-1">User ID</p>
                  <p className="font-mono text-slate-400 break-all">{log.userId}</p>
                </div>
              )}
              {log.resourceId && (
                <div>
                  <p className="text-slate-500 uppercase tracking-wider mb-1">Resource ID</p>
                  <p className="font-mono text-slate-400 break-all">{log.resourceId}</p>
                </div>
              )}
              {log.clientIp && (
                <div>
                  <p className="text-slate-500 uppercase tracking-wider mb-1">Client IP</p>
                  <p className="font-mono text-slate-400">{log.clientIp}</p>
                </div>
              )}
              {log.projectId && (
                <div>
                  <p className="text-slate-500 uppercase tracking-wider mb-1">Project ID</p>
                  <p className="font-mono text-slate-400 break-all">{log.projectId}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
