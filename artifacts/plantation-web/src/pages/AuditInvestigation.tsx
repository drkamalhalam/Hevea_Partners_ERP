/**
 * AuditInvestigation.tsx
 *
 * Enterprise audit investigation and advanced search interface.
 *
 * Four tabs:
 *   Search      — advanced multi-dimensional search across all 6 audit sources
 *   Investigation — drill-down on a selected event with full context
 *   Analytics   — governance analytics charts (Recharts)
 *   Export      — export options (placeholders with status)
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListProjects } from "@workspace/api-client-react";
import {
  AlertTriangle,
  Archive,
  BarChart2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileText,
  Filter,
  GitCommit,
  Info,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Terminal,
  TrendingUp,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useRole } from "../contexts/RoleContext";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  source: string;
  timestamp: string;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  title: string;
  detail: string | null;
  module: string | null;
  actionType: string | null;
  status: string | null;
  severity: string | null;
  ipAddress: string | null;
  tags: string[];
  raw: Record<string, unknown>;
}

interface SearchResult {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

interface AnalyticsData {
  sourceTotals: { source: string; label: string; count: number }[];
  auditByModule: { name: string; value: number }[];
  auditByOperation: { name: string; value: number }[];
  disputesByType: { name: string; value: number }[];
  disputesByStatus: { name: string; value: number }[];
  disputesBySeverity: { name: string; value: number }[];
  overridesByType: { name: string; value: number }[];
  overridesByModule: { name: string; value: number }[];
  sessionsByRole: { name: string; value: number }[];
  activityTimeline: { day: string; count: number }[];
}

interface FilterOptions {
  modules: string[];
  actionTypes: string[];
  disputeTypes: string[];
  disputeStatuses: string[];
  severities: string[];
  users: { id: string; name: string | null; role: string }[];
  projects: { id: string; name: string }[];
}

interface ExportOption {
  id: string;
  label: string;
  description: string;
  format: string;
  status: "available" | "planned";
  note: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES = [
  { id: "audit_log", label: "Audit Log", icon: Terminal, color: "text-blue-400", ring: "ring-blue-500/30", bg: "bg-blue-950/30 border-blue-800/30" },
  { id: "governance", label: "Governance", icon: Shield, color: "text-purple-400", ring: "ring-purple-500/30", bg: "bg-purple-950/30 border-purple-800/30" },
  { id: "dispute", label: "Dispute", icon: ShieldAlert, color: "text-red-400", ring: "ring-red-500/30", bg: "bg-red-950/30 border-red-800/30" },
  { id: "session", label: "Session", icon: Users, color: "text-emerald-400", ring: "ring-emerald-500/30", bg: "bg-emerald-950/30 border-emerald-800/30" },
  { id: "financial", label: "Financial", icon: TrendingUp, color: "text-yellow-400", ring: "ring-yellow-500/30", bg: "bg-yellow-950/30 border-yellow-800/30" },
  { id: "snapshot", label: "Snapshot", icon: Archive, color: "text-cyan-400", ring: "ring-cyan-500/30", bg: "bg-cyan-950/30 border-cyan-800/30" },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-950/50 text-red-300 border-red-700/50",
  high: "bg-orange-950/50 text-orange-300 border-orange-700/50",
  medium: "bg-yellow-950/50 text-yellow-300 border-yellow-700/50",
  low: "bg-slate-800 text-slate-400 border-slate-600",
};

const STATUS_COLORS: Record<string, string> = {
  open: "text-yellow-400 bg-yellow-950/30 border-yellow-700/40",
  under_review: "text-blue-400 bg-blue-950/30 border-blue-700/40",
  resolved: "text-emerald-400 bg-emerald-950/30 border-emerald-700/40",
  escalated: "text-red-400 bg-red-950/30 border-red-700/40",
  withdrawn: "text-slate-400 bg-slate-800 border-slate-600",
};

const CHART_COLORS = [
  "#3b82f6", "#8b5cf6", "#ef4444", "#10b981",
  "#f59e0b", "#06b6d4", "#f97316", "#6366f1",
  "#84cc16", "#ec4899",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDT(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtRel(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) {
    const h = Math.floor(diff / 3600000);
    if (h === 0) { const m = Math.floor(diff / 60000); return m <= 1 ? "just now" : `${m}m ago`; }
    return `${h}h ago`;
  }
  return d < 30 ? `${d}d ago` : fmtDT(iso);
}

function cap(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourceInfo(src: string) {
  return SOURCES.find((s) => s.id === src) ?? {
    id: src, label: cap(src), icon: Database,
    color: "text-slate-400", ring: "ring-slate-500/30", bg: "bg-slate-800/30 border-slate-700/30",
  };
}

// ── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const s = sourceInfo(source);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${s.bg} ${s.color}`}>
      <s.icon className="h-2.5 w-2.5" />
      {s.label}
    </span>
  );
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.low}`}>
      {cap(severity)}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[status] ?? "text-slate-400 bg-slate-800 border-slate-600"}`}>
      {cap(status)}
    </span>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: AuditEvent;
  selected: boolean;
  onSelect: (e: AuditEvent) => void;
}) {
  const s = sourceInfo(event.source);
  return (
    <div
      onClick={() => onSelect(event)}
      className={`flex items-start gap-3 px-3 py-2.5 border-b border-slate-700/30 cursor-pointer transition-colors ${
        selected ? "bg-blue-950/25 border-l-2 border-l-blue-500" : "hover:bg-slate-800/40"
      }`}
    >
      <div className={`mt-0.5 p-1.5 rounded ${selected ? "bg-blue-900/40" : "bg-slate-800/60"}`}>
        <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <SourceBadge source={event.source} />
          {event.module && (
            <span className="text-[10px] text-slate-500">{cap(event.module)}</span>
          )}
          <StatusBadge status={event.status} />
          <SeverityBadge severity={event.severity} />
        </div>
        <p className="text-slate-200 text-xs font-medium truncate leading-snug">{event.title}</p>
        <div className="flex gap-2 mt-0.5 text-[10px] text-slate-500">
          {event.actorName && <span className="flex items-center gap-0.5"><User className="h-2.5 w-2.5" />{event.actorName}</span>}
          {event.projectName && <span className="flex items-center gap-0.5"><Database className="h-2.5 w-2.5" />{event.projectName}</span>}
          <span className="flex items-center gap-0.5 ml-auto"><Clock className="h-2.5 w-2.5" />{fmtRel(event.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Investigation detail panel ────────────────────────────────────────────────

function InvestigationPanel({ event, onClose }: { event: AuditEvent; onClose?: () => void }) {
  const detailQuery = useQuery({
    queryKey: ["/api/audit-investigation/detail", event.source, event.id],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/audit-investigation/detail/${event.source}/${event.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<Record<string, unknown>>;
    },
  });

  const s = sourceInfo(event.source);

  return (
    <div className="h-full flex flex-col bg-slate-900 border-l border-slate-700/60">
      {/* header */}
      <div className="flex items-start gap-3 p-4 border-b border-slate-700/60 shrink-0">
        <div className={`p-2 rounded-lg ${s.bg} border`}>
          <s.icon className={`h-5 w-5 ${s.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <SourceBadge source={event.source} />
            <StatusBadge status={event.status} />
            <SeverityBadge severity={event.severity} />
          </div>
          <p className="text-slate-100 text-sm font-semibold leading-snug">{event.title}</p>
          {event.detail && <p className="text-slate-400 text-xs mt-0.5">{event.detail}</p>}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-600 hover:text-slate-400 shrink-0">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* meta grid */}
      <div className="grid grid-cols-2 gap-px bg-slate-700/30 border-b border-slate-700/60 shrink-0">
        {[
          { label: "Timestamp", value: fmtDT(event.timestamp) },
          { label: "Source", value: cap(event.source) },
          { label: "Actor", value: event.actorName ?? "—" },
          { label: "Role", value: cap(event.actorRole) },
          { label: "Project", value: event.projectName ?? "—" },
          { label: "Module", value: cap(event.module) },
          { label: "Action Type", value: cap(event.actionType) },
          { label: "IP Address", value: event.ipAddress ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-800/60 px-3 py-2">
            <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</p>
            <p className="text-slate-300 text-xs font-mono truncate" title={value}>{value}</p>
          </div>
        ))}
      </div>

      {/* tags */}
      {event.tags.length > 0 && (
        <div className="px-4 py-2.5 border-b border-slate-700/40 shrink-0">
          <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Tags</p>
          <div className="flex flex-wrap gap-1">
            {event.tags.map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 font-mono">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* raw payload */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Raw Payload</p>
        {detailQuery.isLoading ? (
          <div className="space-y-1.5">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-5 bg-slate-800" />)}</div>
        ) : detailQuery.data ? (
          <pre className="text-[10px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap break-all bg-slate-800/60 rounded-lg p-3 border border-slate-700/40">
            {JSON.stringify(detailQuery.data, null, 2)}
          </pre>
        ) : (
          <p className="text-slate-600 text-xs italic">Failed to load full payload.</p>
        )}
      </div>
    </div>
  );
}

// ── Analytics chart ───────────────────────────────────────────────────────────

function MiniBar({ data, title, color = "#3b82f6" }: { data: { name: string; value: number }[]; title: string; color?: string }) {
  if (!data.length) return (
    <div className="flex items-center justify-center h-32 text-slate-600 text-xs italic">No data</div>
  );
  return (
    <div>
      <p className="text-xs text-slate-500 font-medium mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ left: -10, right: 4, top: 2, bottom: 2 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={(v: string) => cap(v).slice(0, 14)} />
          <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
          <RechartTooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: number) => [v, "Count"]}
            labelFormatter={(l: string) => cap(l)}
          />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniPie({ data, title }: { data: { name: string; value: number }[]; title: string }) {
  if (!data.length) return (
    <div className="flex items-center justify-center h-32 text-slate-600 text-xs italic">No data</div>
  );
  return (
    <div>
      <p className="text-xs text-slate-500 font-medium mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Legend iconSize={8} iconType="circle" formatter={(v: string) => <span style={{ fontSize: 10, color: "#94a3b8" }}>{cap(v)}</span>} />
          <RechartTooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: number, n: string) => [v, cap(n)]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Search filters panel ──────────────────────────────────────────────────────

interface SearchFilters {
  q: string;
  sources: string[];
  projectId: string;
  userId: string;
  dateFrom: string;
  dateTo: string;
  module: string;
  actionType: string;
  disputeType: string;
  disputeStatus: string;
  severity: string;
}

const DEFAULT_FILTERS: SearchFilters = {
  q: "",
  sources: [],
  projectId: "",
  userId: "",
  dateFrom: "",
  dateTo: "",
  module: "",
  actionType: "",
  disputeType: "",
  disputeStatus: "",
  severity: "",
};

function FilterPanel({
  filters,
  onChange,
  options,
}: {
  filters: SearchFilters;
  onChange: (f: Partial<SearchFilters>) => void;
  options: FilterOptions | undefined;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const toggleSource = (s: string) => {
    const cur = filters.sources;
    onChange({ sources: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
  };

  const activeCount = Object.entries(filters).filter(([k, v]) => {
    if (k === "q") return !!v;
    if (k === "sources") return (v as string[]).length > 0;
    return !!v;
  }).length;

  return (
    <div className={`shrink-0 bg-slate-900/80 border-b border-slate-700/60 transition-all ${collapsed ? "pb-0" : ""}`}>
      <button
        onClick={() => setCollapsed((x) => !x)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-800/40 transition-colors"
      >
        <Filter className="h-4 w-4 text-slate-500" />
        <span className="text-xs text-slate-400 font-medium">Advanced Filters</span>
        {activeCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/60 text-blue-300 border border-blue-700/50 font-medium">
            {activeCount} active
          </span>
        )}
        {activeCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange(DEFAULT_FILTERS); }}
            className="ml-auto text-[10px] text-slate-600 hover:text-slate-400 flex items-center gap-0.5"
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
        <ChevronDown className={`h-4 w-4 text-slate-600 transition-transform ml-auto ${collapsed ? "-rotate-90" : ""}`} />
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {/* Free text search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <Input
              value={filters.q}
              onChange={(e) => onChange({ q: e.target.value })}
              placeholder="Search across all sources…"
              className="pl-8 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-600 h-8 text-xs"
            />
          </div>

          {/* Source toggles */}
          <div>
            <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5 block">Sources</Label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => {
                const active = filters.sources.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleSource(s.id)}
                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border font-medium transition-colors ${
                      active ? `${s.bg} ${s.color} ring-1 ${s.ring}` : "bg-slate-800/60 border-slate-700/50 text-slate-500 hover:text-slate-400"
                    }`}
                  >
                    <s.icon className="h-2.5 w-2.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">Project</Label>
              <Select value={filters.projectId || "_all"} onValueChange={(v) => onChange({ projectId: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">All Projects</SelectItem>
                  {options?.projects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-slate-300 text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">User</Label>
              <Select value={filters.userId || "_all"} onValueChange={(v) => onChange({ userId: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">All Users</SelectItem>
                  {options?.users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-slate-300 text-xs">
                      {u.name ?? u.id.slice(0, 8)} ({cap(u.role)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">Financial Module</Label>
              <Select value={filters.module || "_all"} onValueChange={(v) => onChange({ module: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="All modules" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">All Modules</SelectItem>
                  {(options?.modules ?? []).map((m) => (
                    <SelectItem key={m} value={m} className="text-slate-300 text-xs">{cap(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">Action Type</Label>
              <Select value={filters.actionType || "_all"} onValueChange={(v) => onChange({ actionType: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="Any action" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">Any Action</SelectItem>
                  {(options?.actionTypes ?? []).map((a) => (
                    <SelectItem key={a} value={a} className="text-slate-300 text-xs">{cap(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">Dispute Type</Label>
              <Select value={filters.disputeType || "_all"} onValueChange={(v) => onChange({ disputeType: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="Any type" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">Any Type</SelectItem>
                  {(options?.disputeTypes ?? []).map((t) => (
                    <SelectItem key={t} value={t} className="text-slate-300 text-xs">{cap(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">Governance Status</Label>
              <Select value={filters.disputeStatus || "_all"} onValueChange={(v) => onChange({ disputeStatus: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">Any Status</SelectItem>
                  {(options?.disputeStatuses ?? []).map((s) => (
                    <SelectItem key={s} value={s} className="text-slate-300 text-xs">{cap(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">Severity</Label>
              <Select value={filters.severity || "_all"} onValueChange={(v) => onChange({ severity: v === "_all" ? "" : v })}>
                <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs">
                  <SelectValue placeholder="Any severity" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="_all" className="text-slate-300 text-xs">Any Severity</SelectItem>
                  {["critical", "high", "medium", "low"].map((s) => (
                    <SelectItem key={s} value={s} className="text-slate-300 text-xs">{cap(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">From Date</Label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => onChange({ dateFrom: e.target.value })}
                className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs"
              />
            </div>

            <div>
              <Label className="text-[10px] text-slate-600 uppercase tracking-wider mb-1 block">To Date</Label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => onChange({ dateTo: e.target.value })}
                className="h-7 bg-slate-800 border-slate-700 text-slate-300 text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditInvestigation() {
  const { role } = useRole();
  const [tab, setTab] = useState<"search" | "investigation" | "analytics" | "export">("search");
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const patchFilters = useCallback((patch: Partial<SearchFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOffset(0);
  }, []);

  // Build search params from filters
  const searchParams = useMemo(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (filters.q) p.set("q", filters.q);
    if (filters.sources.length) p.set("sources", filters.sources.join(","));
    if (filters.projectId) p.set("projectId", filters.projectId);
    if (filters.userId) p.set("userId", filters.userId);
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) p.set("dateTo", `${filters.dateTo}T23:59:59Z`);
    if (filters.module) p.set("module", filters.module);
    if (filters.actionType) p.set("actionType", filters.actionType);
    if (filters.disputeType) p.set("disputeType", filters.disputeType);
    if (filters.disputeStatus) p.set("disputeStatus", filters.disputeStatus);
    if (filters.severity) p.set("severity", filters.severity);
    return p.toString();
  }, [filters, offset]);

  const searchQuery = useQuery({
    queryKey: ["/api/audit-investigation/search", searchParams],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/audit-investigation/search?${searchParams}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<SearchResult>;
    },
  });

  const analyticsQuery = useQuery({
    queryKey: ["/api/audit-investigation/analytics", filters.projectId, filters.dateFrom, filters.dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filters.projectId) p.set("projectId", filters.projectId);
      if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) p.set("dateTo", `${filters.dateTo}T23:59:59Z`);
      const res = await fetch(`${BASE_URL}/api/audit-investigation/analytics?${p}`);
      if (!res.ok) throw new Error("Analytics failed");
      return res.json() as Promise<AnalyticsData>;
    },
    enabled: tab === "analytics",
  });

  const optionsQuery = useQuery({
    queryKey: ["/api/audit-investigation/filters/options"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/audit-investigation/filters/options`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const exportQuery = useQuery({
    queryKey: ["/api/audit-investigation/export"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/audit-investigation/export`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ available: ExportOption[] }>;
    },
    enabled: tab === "export",
  });

  // When selecting an event, switch to investigation tab
  const handleSelectEvent = useCallback((e: AuditEvent) => {
    setSelectedEvent(e);
    if (tab === "search") setTab("investigation");
  }, [tab]);

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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60">
            <Zap className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-100">Audit Investigation</h1>
              <Badge className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700">Enterprise</Badge>
            </div>
            <p className="text-slate-500 text-xs">Unified search across audit logs, governance, disputes, sessions, financial access, and snapshots.</p>
          </div>
        </div>

        {/* Source totals quick-bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {analyticsQuery.data?.sourceTotals.map((s) => {
            const info = sourceInfo(s.source);
            return (
              <div key={s.source} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs ${info.bg}`}>
                <info.icon className={`h-3 w-3 ${info.color}`} />
                <span className={`font-bold ${info.color}`}>{s.count.toLocaleString("en-IN")}</span>
                <span className="text-slate-500">{s.label}</span>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-slate-700 text-slate-400 hover:text-slate-200 text-xs"
            onClick={() => { void searchQuery.refetch(); void analyticsQuery.refetch(); }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
          </Button>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 px-5 border-b border-slate-700/60">
          <TabsList className="bg-transparent h-10 gap-1 p-0">
            {[
              { value: "search", icon: Search, label: "Advanced Search" },
              { value: "investigation", icon: GitCommit, label: "Investigation" },
              { value: "analytics", icon: BarChart2, label: "Governance Analytics" },
              { value: "export", icon: Download, label: "Export" },
            ].map(({ value, icon: Icon, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="text-xs px-3 h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-slate-100 text-slate-500 bg-transparent"
              >
                <Icon className="h-3.5 w-3.5 mr-1.5" />
                {label}
                {value === "investigation" && selectedEvent && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 inline-block" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── SEARCH TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="search" className="flex-1 flex flex-col min-h-0 mt-0">
          <FilterPanel filters={filters} onChange={patchFilters} options={optionsQuery.data} />

          {/* Results */}
          <div className="flex flex-1 min-h-0">
            {/* List */}
            <div className={`flex flex-col min-h-0 overflow-y-auto ${selectedEvent ? "w-5/12 border-r border-slate-700/50" : "flex-1"}`}>
              {/* list header */}
              <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-slate-700/40 bg-slate-900/60 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                  {searchQuery.isFetching && <RefreshCw className="h-3 w-3 text-blue-400 animate-spin" />}
                  <span className="text-xs text-slate-500">
                    {searchQuery.data
                      ? `${searchQuery.data.events.length} of ${searchQuery.data.total.toLocaleString("en-IN")} events`
                      : "Loading…"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                    className="text-xs px-2 py-0.5 rounded border border-slate-700 text-slate-500 disabled:opacity-30 hover:text-slate-300"
                  >
                    ← Prev
                  </button>
                  <span className="text-[10px] text-slate-600 px-1">
                    {Math.floor(offset / LIMIT) + 1}/{Math.ceil((searchQuery.data?.total ?? 0) / LIMIT) || 1}
                  </span>
                  <button
                    disabled={!searchQuery.data || offset + LIMIT >= searchQuery.data.total}
                    onClick={() => setOffset(offset + LIMIT)}
                    className="text-xs px-2 py-0.5 rounded border border-slate-700 text-slate-500 disabled:opacity-30 hover:text-slate-300"
                  >
                    Next →
                  </button>
                </div>
              </div>

              {/* rows */}
              {searchQuery.isLoading ? (
                <div className="space-y-px">
                  {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-16 bg-slate-800/50 rounded-none" />)}
                </div>
              ) : searchQuery.isError ? (
                <div className="flex items-center justify-center flex-1 py-12">
                  <div className="text-center">
                    <AlertTriangle className="h-8 w-8 text-red-500/60 mx-auto mb-2" />
                    <p className="text-red-400 text-sm">Search failed. Please try again.</p>
                  </div>
                </div>
              ) : !searchQuery.data?.events.length ? (
                <div className="flex items-center justify-center flex-1 py-12">
                  <div className="text-center">
                    <Search className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm font-medium">No events found</p>
                    <p className="text-slate-600 text-xs mt-1">Try adjusting or clearing your filters.</p>
                  </div>
                </div>
              ) : (
                searchQuery.data.events.map((e) => (
                  <EventRow
                    key={`${e.source}:${e.id}`}
                    event={e}
                    selected={selectedEvent?.id === e.id && selectedEvent?.source === e.source}
                    onSelect={handleSelectEvent}
                  />
                ))
              )}
            </div>

            {/* Inline detail pane */}
            {selectedEvent && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <InvestigationPanel
                  event={selectedEvent}
                  onClose={() => setSelectedEvent(null)}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── INVESTIGATION TAB ──────────────────────────────────────────────── */}
        <TabsContent value="investigation" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {selectedEvent ? (
            <div className="h-full overflow-y-auto">
              <InvestigationPanel event={selectedEvent} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-sm">
                <GitCommit className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">No event selected</p>
                <p className="text-slate-600 text-sm mt-1">
                  Run a search and click any event to open a full investigation view.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4 border-slate-700 text-slate-400"
                  onClick={() => setTab("search")}
                >
                  <Search className="h-4 w-4 mr-1.5" />
                  Go to Search
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── ANALYTICS TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="flex-1 min-h-0 mt-0 overflow-y-auto">
          {analyticsQuery.isLoading ? (
            <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 bg-slate-800/50 rounded-xl" />)}
            </div>
          ) : analyticsQuery.isError ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-red-400 text-sm">Failed to load analytics.</p>
            </div>
          ) : analyticsQuery.data ? (
            <div className="p-5 space-y-5">
              {/* Source totals row */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                {analyticsQuery.data.sourceTotals.map((s) => {
                  const info = sourceInfo(s.source);
                  return (
                    <Card key={s.source} className={`border ${info.bg}`}>
                      <CardContent className="p-3 text-center">
                        <info.icon className={`h-5 w-5 mx-auto mb-1 ${info.color}`} />
                        <p className={`text-2xl font-bold ${info.color}`}>{s.count.toLocaleString("en-IN")}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Activity timeline */}
              {analyticsQuery.data.activityTimeline.length > 0 && (
                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardHeader className="pb-1 pt-3 px-4">
                    <CardTitle className="text-xs text-slate-400 font-medium">Audit Log Activity — Last 30 Days</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={analyticsQuery.data.activityTimeline} margin={{ left: -10, right: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={(v: string) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                        <RechartTooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                          formatter={(v: number) => [v, "Events"]}
                        />
                        <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Charts grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniBar data={analyticsQuery.data.auditByModule} title="Audit Events by Module" color="#3b82f6" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniPie data={analyticsQuery.data.auditByOperation} title="Audit Events by Operation" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniPie data={analyticsQuery.data.disputesByStatus} title="Disputes by Status" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniBar data={analyticsQuery.data.disputesByType} title="Disputes by Type" color="#ef4444" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniPie data={analyticsQuery.data.disputesBySeverity} title="Disputes by Severity" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniBar data={analyticsQuery.data.overridesByModule} title="Governance Overrides by Module" color="#8b5cf6" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniBar data={analyticsQuery.data.overridesByType} title="Override Types" color="#6366f1" />
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4">
                    <MiniPie data={analyticsQuery.data.sessionsByRole} title="Login Sessions by Role" />
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </TabsContent>

        {/* ── EXPORT TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="export" className="flex-1 min-h-0 mt-0 overflow-y-auto">
          <div className="p-5 space-y-4 max-w-3xl">
            <div className="flex items-start gap-3 p-3 bg-slate-800/40 border border-slate-700/40 rounded-lg">
              <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                Exports generate a tamper-evident package of audit records. Planned formats include PDF compliance reports, CSV audit trails, and XLSX financial audits. Use the search filters to scope your export before downloading.
              </p>
            </div>

            {exportQuery.isLoading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800/50 rounded-xl" />)}</div>
            ) : (exportQuery.data?.available ?? []).map((opt) => (
              <div
                key={opt.id}
                className={`p-4 rounded-xl border flex items-start gap-4 ${
                  opt.status === "available"
                    ? "bg-slate-800/50 border-slate-700/50"
                    : "bg-slate-800/20 border-slate-700/30 opacity-70"
                }`}
              >
                <div className={`p-2.5 rounded-lg shrink-0 ${opt.status === "available" ? "bg-blue-950/40 border border-blue-800/30" : "bg-slate-800 border border-slate-700/40"}`}>
                  <FileText className={`h-5 w-5 ${opt.status === "available" ? "text-blue-400" : "text-slate-600"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-slate-200 text-sm font-medium">{opt.label}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                      opt.status === "available"
                        ? "text-emerald-400 bg-emerald-950/30 border-emerald-700/40"
                        : "text-slate-500 bg-slate-800 border-slate-700"
                    }`}>
                      {cap(opt.status)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 uppercase font-mono">
                      {opt.format}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mb-2">{opt.description}</p>
                  <p className="text-slate-600 text-[10px] italic">{opt.note}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={opt.status === "planned"}
                  className="shrink-0 border-slate-700 text-slate-400 hover:text-slate-200 text-xs h-8"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  {opt.status === "available" ? "Download" : "Planned"}
                </Button>
              </div>
            ))}

            <div className="p-3 bg-orange-950/20 border border-orange-800/30 rounded-lg flex items-start gap-2">
              <Lock className="h-3.5 w-3.5 text-orange-400 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-300">
                All exports are access-controlled. Only admin and developer roles can generate audit packages. Export actions are themselves recorded in the audit log.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
