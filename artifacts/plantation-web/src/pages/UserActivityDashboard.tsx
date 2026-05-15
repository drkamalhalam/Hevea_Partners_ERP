/**
 * UserActivityDashboard.tsx
 *
 * User activity traceability and legal accountability dashboard.
 * Covers: login history, approval/edit/financial/governance/document actions,
 * per-user summaries, role-wise breakdowns, sensitive action monitoring,
 * and per-project accountability reports.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useProjectFilter } from "../contexts/ProjectFilterContext";
import { useRole } from "../contexts/RoleContext";
import { useListProjects } from "@workspace/api-client-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Lock,
  Monitor,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  User,
  Users,
  Fingerprint,
  TrendingUp,
  BookOpen,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
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

interface AuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  tableName: string;
  recordId: string;
  operation: string;
  module: string | null;
  actionType: string | null;
  projectId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  isSensitive: boolean;
  createdAt: string;
}

interface UserSummary {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean;
  createdAt: string;
  totalActions: number;
  last30DayActions: number;
  sensitiveActions: number;
  lastActivity: string | null;
  sessionCount: number;
  lastLogin: string | null;
}

interface RoleSummary {
  role: string;
  totalActions: number;
  uniqueActiveUsers: number;
  totalUsers: number;
  activeUsers: number;
  lastActivity: string | null;
  actionsLast30Days: number;
}

interface Session {
  id: string;
  userId: string | null;
  clerkUserId: string | null;
  displayName: string | null;
  userRole: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ProjectActivity {
  project: { id: string; name: string; lifecycleStatus: string } | null;
  entries: AuditEntry[];
  total: number;
  byUser: {
    userId: string | null;
    userName: string | null;
    userRole: string | null;
    totalActions: number;
    sensitiveActions: number;
    lastAction: string | null;
    firstAction: string | null;
  }[];
  byModule: { module: string; count: number }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin: "text-red-400 bg-red-950/60 border-red-800/50",
  developer: "text-purple-400 bg-purple-950/60 border-purple-800/50",
  landowner: "text-emerald-400 bg-emerald-950/60 border-emerald-800/50",
  investor: "text-blue-400 bg-blue-950/60 border-blue-800/50",
  employee: "text-slate-300 bg-slate-800/60 border-slate-600/50",
  operational_staff: "text-yellow-400 bg-yellow-950/60 border-yellow-800/50",
};

const OP_COLORS: Record<string, string> = {
  INSERT: "text-emerald-400 bg-emerald-950/50",
  UPDATE: "text-yellow-400 bg-yellow-950/50",
  DELETE: "text-red-400 bg-red-950/50",
};

const MODULE_ICONS: Record<string, React.ElementType> = {
  governance: Shield,
  settlement: BarChart3,
  contributions: FileText,
  expenditures: FileText,
  lca: TrendingUp,
  inheritance: BookOpen,
  evidence: FileText,
  documents: FileText,
  sales: BarChart3,
};

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) {
    const h = Math.floor(diff / 3600000);
    if (h === 0) return "just now";
    return `${h}h ago`;
  }
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

function cap(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function RoleBadge({ role }: { role: string | null | undefined }) {
  const cls = ROLE_COLORS[role ?? ""] ?? "text-slate-400 bg-slate-800 border-slate-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {cap(role)}
    </span>
  );
}

// ── Entry Row ─────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: AuditEntry }) {
  const opCls = OP_COLORS[entry.operation] ?? "text-slate-400 bg-slate-800/50";
  return (
    <div className={`flex items-start gap-3 py-3 border-b border-slate-700/30 last:border-0 ${entry.isSensitive ? "bg-orange-950/10" : ""}`}>
      {entry.isSensitive && <ShieldAlert className="h-3.5 w-3.5 text-orange-400 mt-1 shrink-0" />}
      {!entry.isSensitive && <Activity className="h-3.5 w-3.5 text-slate-500 mt-1 shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className="text-slate-200 text-xs font-medium">
            {cap(entry.actionType) || cap(entry.tableName)}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${opCls}`}>
            {entry.operation}
          </span>
          {entry.module && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
              {cap(entry.module)}
            </span>
          )}
          {entry.isSensitive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-950 text-orange-300 border border-orange-700/50">
              Sensitive
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mt-0.5">
          {entry.userName && <span>By: <span className="text-slate-400">{entry.userName}</span></span>}
          {entry.userRole && <RoleBadge role={entry.userRole} />}
          {entry.ipAddress && (
            <span className="flex items-center gap-1">
              <Globe className="h-2.5 w-2.5" />{entry.ipAddress}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />{fmtRelative(entry.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── User Card ─────────────────────────────────────────────────────────────────

function UserCard({ user, onSelect }: { user: UserSummary; onSelect: (u: UserSummary) => void }) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:border-slate-600/70 hover:bg-slate-800/80 transition-colors cursor-pointer"
      onClick={() => onSelect(user)}
    >
      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
        <User className="h-4 w-4 text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-slate-200 text-sm font-medium truncate">
            {user.displayName ?? user.email ?? "Unknown User"}
          </p>
          {!user.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-950 text-red-400 border border-red-800/50">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <RoleBadge role={user.role} />
          {user.email && <p className="text-slate-500 text-xs truncate">{user.email}</p>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-slate-200 text-sm font-semibold">{user.totalActions.toLocaleString()}</p>
        <p className="text-slate-500 text-[10px]">actions</p>
        {user.sensitiveActions > 0 && (
          <p className="text-orange-400 text-[10px]">{user.sensitiveActions} sensitive</p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-slate-600 shrink-0" />
    </div>
  );
}

// ── Session Row ───────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: Session }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-700/30 last:border-0">
      <Monitor className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-slate-200 text-sm font-medium">{session.displayName ?? "Unknown"}</span>
          <RoleBadge role={session.userRole} />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {session.ipAddress && (
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />{session.ipAddress}
            </span>
          )}
          {session.userAgent && (
            <span className="truncate max-w-48" title={session.userAgent}>
              {session.userAgent.substring(0, 40)}{session.userAgent.length > 40 ? "…" : ""}
            </span>
          )}
          <span className="flex items-center gap-1 text-slate-400">
            <Clock className="h-3 w-3" />{fmtDateTime(session.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UserActivityDashboard() {
  const { selectedProjectId } = useProjectFilter();
  const { role } = useRole();
  const [tab, setTab] = useState<"overview" | "users" | "sensitive" | "projects" | "sessions">("overview");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [selectedProjectIdForReport, setSelectedProjectIdForReport] = useState<string>("");
  const [sensitiveFrom, setSensitiveFrom] = useState("");
  const [sensitiveTo, setSensitiveTo] = useState("");

  const projectsQuery = useListProjects();
  const projectList = (projectsQuery.data as { id: string; name: string }[] | undefined) ?? [];

  const summaryQuery = useQuery({
    queryKey: ["/api/user-activity/summary"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/user-activity/summary`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{
        totals: { allTime: number; last30Days: number; sensitiveActions: number; loginSessions: number };
        byRole: { role: string; count: number }[];
        byModule: { module: string; count: number }[];
        topUsers: { userId: string | null; userName: string | null; userRole: string | null; actionCount: number; lastAction: string | null }[];
        recentFeed: AuditEntry[];
      }>;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const roleSummaryQuery = useQuery({
    queryKey: ["/api/user-activity/role-summary"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/user-activity/role-summary`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ byRole: RoleSummary[] }>;
    },
    enabled: tab === "overview",
  });

  const usersQuery = useQuery({
    queryKey: ["/api/user-activity/users"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/user-activity/users`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ users: UserSummary[] }>;
    },
    enabled: tab === "users",
  });

  const userDetailQuery = useQuery({
    queryKey: ["/api/user-activity/user", selectedUser?.id],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/user-activity/user/${selectedUser!.id}?limit=30`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{
        user: UserSummary | null;
        entries: AuditEntry[];
        total: number;
        moduleSummary: { module: string; count: number }[];
        sessions: { id: string; ipAddress: string | null; userAgent: string | null; createdAt: string }[];
      }>;
    },
    enabled: !!selectedUser,
  });

  const sensitiveQuery = useQuery({
    queryKey: ["/api/user-activity/sensitive", selectedProjectId, sensitiveFrom, sensitiveTo],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      if (sensitiveFrom) params.set("from", sensitiveFrom);
      if (sensitiveTo) params.set("to", sensitiveTo);
      const res = await fetch(`${BASE_URL}/api/user-activity/sensitive?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ entries: AuditEntry[]; total: number }>;
    },
    enabled: tab === "sensitive",
  });

  const projectReportQuery = useQuery({
    queryKey: ["/api/user-activity/project", selectedProjectIdForReport],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/user-activity/project/${selectedProjectIdForReport}?limit=20`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<ProjectActivity>;
    },
    enabled: tab === "projects" && !!selectedProjectIdForReport,
  });

  const sessionsQuery = useQuery({
    queryKey: ["/api/user-activity/sessions"],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/user-activity/sessions?limit=50`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ sessions: Session[]; total: number }>;
    },
    enabled: tab === "sessions",
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

  const totals = summaryQuery.data?.totals;
  const filteredUsers = useMemo(() => {
    const all = usersQuery.data?.users ?? [];
    if (!userSearch.trim()) return all;
    const q = userSearch.toLowerCase();
    return all.filter(
      (u) =>
        u.displayName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q),
    );
  }, [usersQuery.data, userSearch]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-950/60 border border-blue-800/40">
            <Fingerprint className="h-6 w-6 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-100">User Activity Traceability</h1>
              <Badge className="text-xs bg-slate-800 text-slate-400 border border-slate-700">Accountability</Badge>
            </div>
            <p className="text-slate-400 text-sm mt-0.5">
              Login history, approval trails, financial actions, and governance accountability per user and project.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700"
          onClick={() => {
            void summaryQuery.refetch();
            void roleSummaryQuery.refetch();
            void usersQuery.refetch();
          }}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* ── KPI Tiles ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Audit Entries", value: totals?.allTime, cls: "bg-slate-800/60 border-slate-700/50", vCls: "text-slate-200", icon: Activity },
          { label: "Last 30 Days", value: totals?.last30Days, cls: "bg-blue-950/40 border-blue-800/40", vCls: "text-blue-300", icon: TrendingUp },
          { label: "Sensitive Actions", value: totals?.sensitiveActions, cls: "bg-orange-950/40 border-orange-800/40", vCls: "text-orange-300", icon: ShieldAlert },
          { label: "Login Sessions (30d)", value: totals?.loginSessions, cls: "bg-emerald-950/40 border-emerald-800/40", vCls: "text-emerald-300", icon: Monitor },
        ].map((tile) => (
          <Card key={tile.label} className={`${tile.cls} border`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <tile.icon className={`h-4 w-4 ${tile.vCls} opacity-70`} />
                <p className="text-xs text-slate-400">{tile.label}</p>
              </div>
              {summaryQuery.isLoading ? (
                <Skeleton className="h-8 w-16 bg-slate-700" />
              ) : (
                <p className={`text-3xl font-bold ${tile.vCls}`}>
                  {tile.value?.toLocaleString() ?? "—"}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="bg-slate-800/80 border border-slate-700/60 h-9 flex-wrap gap-0.5">
          {[
            { value: "overview", icon: BarChart3, label: "Overview" },
            { value: "users", icon: Users, label: "Users" },
            { value: "sensitive", icon: ShieldAlert, label: "Sensitive Actions" },
            { value: "projects", icon: BookOpen, label: "Project Reports" },
            { value: "sessions", icon: Monitor, label: "Login History" },
          ].map(({ value, icon: Icon, label }) => (
            <TabsTrigger key={value} value={value} className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Role activity breakdown */}
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-400" />
                  Role-wise Activity (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {roleSummaryQuery.isLoading ? (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 bg-slate-700/60 rounded" />)}</div>
                ) : (
                  <div className="space-y-2">
                    {(roleSummaryQuery.data?.byRole ?? []).map((r) => {
                      const maxActions = Math.max(...(roleSummaryQuery.data?.byRole ?? []).map((x) => x.actionsLast30Days), 1);
                      const pct = Math.min((r.actionsLast30Days / maxActions) * 100, 100);
                      return (
                        <div key={r.role} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <RoleBadge role={r.role} />
                              <span className="text-slate-500">{r.activeUsers}/{r.totalUsers} users</span>
                            </div>
                            <span className="text-slate-300 font-medium">{r.actionsLast30Days.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top modules */}
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  Activity by Module (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {summaryQuery.isLoading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 bg-slate-700/60 rounded" />)}</div>
                ) : (
                  <div className="space-y-2">
                    {(summaryQuery.data?.byModule ?? []).slice(0, 8).map((m) => {
                      const maxCount = Math.max(...(summaryQuery.data?.byModule ?? []).map((x) => x.count), 1);
                      const pct = Math.min((m.count / maxCount) * 100, 100);
                      const ModIcon = MODULE_ICONS[m.module] ?? FileText;
                      return (
                        <div key={m.module} className="flex items-center gap-2">
                          <ModIcon className="h-3 w-3 text-slate-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-slate-400">{cap(m.module)}</span>
                              <span className="text-slate-300 font-medium">{m.count.toLocaleString()}</span>
                            </div>
                            <div className="h-1 bg-slate-700/60 rounded-full overflow-hidden">
                              <div className="h-full bg-purple-500/60 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top active users */}
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Most Active Users (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {summaryQuery.isLoading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 bg-slate-700/60 rounded" />)}</div>
                ) : !summaryQuery.data?.topUsers.length ? (
                  <p className="text-slate-500 text-sm text-center py-4">No activity recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {summaryQuery.data.topUsers.map((u, i) => (
                      <div key={u.userId ?? i} className="flex items-center gap-2 p-2 rounded bg-slate-700/30">
                        <span className="text-slate-600 text-xs w-5 text-right">{i + 1}</span>
                        <User className="h-3.5 w-3.5 text-slate-500" />
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-300 text-xs font-medium truncate">{u.userName ?? "Unknown"}</p>
                          <RoleBadge role={u.userRole} />
                        </div>
                        <div className="text-right">
                          <p className="text-slate-200 text-xs font-semibold">{u.actionCount}</p>
                          <p className="text-slate-600 text-[10px]">{fmtRelative(u.lastAction)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent activity feed */}
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-slate-400" />
                  Recent Activity Feed
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {summaryQuery.isLoading ? (
                  <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 bg-slate-700/60 rounded" />)}</div>
                ) : !summaryQuery.data?.recentFeed.length ? (
                  <p className="text-slate-500 text-sm text-center py-4">No recent activity.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto pr-1">
                    {summaryQuery.data.recentFeed.map((e) => <EntryRow key={e.id} entry={e} />)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── USERS TAB ────────────────────────────────────────────────────── */}
        <TabsContent value="users" className="mt-4">
          {selectedUser ? (
            <div className="space-y-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-100 mb-1"
                onClick={() => setSelectedUser(null)}
              >
                ← Back to Users
              </Button>
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                      <User className="h-6 w-6 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-slate-100 font-semibold">{selectedUser.displayName ?? "Unknown"}</p>
                      <p className="text-slate-400 text-sm">{selectedUser.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <RoleBadge role={selectedUser.role} />
                        {!selectedUser.isActive && <span className="text-xs text-red-400">Inactive</span>}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-2xl font-bold text-slate-200">{selectedUser.totalActions.toLocaleString()}</p>
                      <p className="text-slate-500 text-xs">total actions</p>
                      {selectedUser.sensitiveActions > 0 && (
                        <p className="text-orange-400 text-xs">{selectedUser.sensitiveActions} sensitive</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-slate-700/40 rounded-lg p-3 text-center">
                      <p className="text-slate-200 font-bold">{selectedUser.last30DayActions}</p>
                      <p className="text-slate-500 text-xs">Last 30 Days</p>
                    </div>
                    <div className="bg-slate-700/40 rounded-lg p-3 text-center">
                      <p className="text-slate-200 font-bold">{selectedUser.sessionCount}</p>
                      <p className="text-slate-500 text-xs">Sessions</p>
                    </div>
                    <div className="bg-slate-700/40 rounded-lg p-3 text-center">
                      <p className="text-slate-200 font-bold text-xs">{fmtRelative(selectedUser.lastLogin)}</p>
                      <p className="text-slate-500 text-xs">Last Login</p>
                    </div>
                  </div>

                  {/* Module breakdown */}
                  {userDetailQuery.data?.moduleSummary?.length ? (
                    <div className="mb-4">
                      <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wider">Activity by Module</p>
                      <div className="flex flex-wrap gap-2">
                        {userDetailQuery.data.moduleSummary.map((m) => (
                          <span key={m.module} className="text-xs px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-slate-300">
                            {cap(m.module)}: <span className="text-slate-100 font-medium">{m.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Recent activity */}
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-slate-200">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {userDetailQuery.isLoading ? (
                    <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 bg-slate-700/60 rounded" />)}</div>
                  ) : !userDetailQuery.data?.entries.length ? (
                    <p className="text-slate-500 text-sm text-center py-4">No activity found.</p>
                  ) : (
                    <div>
                      {userDetailQuery.data.entries.map((e) => <EntryRow key={e.id} entry={e} />)}
                      {userDetailQuery.data.total > 30 && (
                        <p className="text-xs text-slate-500 text-center mt-3">
                          Showing 30 of {userDetailQuery.data.total.toLocaleString()} entries. Use the Audit Log for full history.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Session history */}
              {userDetailQuery.data?.sessions?.length ? (
                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-slate-400" />
                      Recent Login Sessions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {userDetailQuery.data.sessions.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 py-2 border-b border-slate-700/30 last:border-0 text-xs">
                        <Globe className="h-3 w-3 text-slate-500" />
                        <span className="text-slate-400">{s.ipAddress ?? "—"}</span>
                        <span className="text-slate-500 flex-1 truncate">{s.userAgent?.substring(0, 40)}</span>
                        <span className="text-slate-500">{fmtDateTime(s.createdAt)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name, email, or role…"
                  className="pl-9 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 h-9"
                />
              </div>
              {usersQuery.isLoading ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 bg-slate-800/60 rounded-lg" />)}</div>
              ) : filteredUsers.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-8">No users found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredUsers
                    .sort((a, b) => b.totalActions - a.totalActions)
                    .map((u) => <UserCard key={u.id} user={u} onSelect={setSelectedUser} />)}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── SENSITIVE ACTIONS TAB ────────────────────────────────────────── */}
        <TabsContent value="sensitive" className="mt-4 space-y-4">
          <Card className="bg-orange-950/20 border-orange-800/30">
            <CardContent className="p-3 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-300">
                Sensitive actions include all governance overrides, financial approvals, settlement finalizations, ownership transfers, role changes, and document operations. These are highlighted for legal review.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">From:</span>
              <Input
                type="date"
                value={sensitiveFrom}
                onChange={(e) => setSensitiveFrom(e.target.value)}
                className="w-36 bg-slate-800 border-slate-700 text-slate-200 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">To:</span>
              <Input
                type="date"
                value={sensitiveTo}
                onChange={(e) => setSensitiveTo(e.target.value)}
                className="w-36 bg-slate-800 border-slate-700 text-slate-200 h-8 text-xs"
              />
            </div>
            {(sensitiveFrom || sensitiveTo) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400" onClick={() => { setSensitiveFrom(""); setSensitiveTo(""); }}>
                Clear
              </Button>
            )}
            {sensitiveQuery.data && (
              <span className="ml-auto self-center text-xs text-slate-500">{sensitiveQuery.data.total.toLocaleString()} entries</span>
            )}
          </div>

          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-4">
              {sensitiveQuery.isLoading ? (
                <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 bg-slate-700/60 rounded" />)}</div>
              ) : !sensitiveQuery.data?.entries.length ? (
                <p className="text-slate-500 text-sm text-center py-8">No sensitive actions in this period.</p>
              ) : (
                <div>
                  {sensitiveQuery.data.entries.map((e) => <EntryRow key={e.id} entry={e} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PROJECT REPORTS TAB ──────────────────────────────────────────── */}
        <TabsContent value="projects" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Select value={selectedProjectIdForReport} onValueChange={setSelectedProjectIdForReport}>
              <SelectTrigger className="w-64 bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                <SelectValue placeholder="Select a project…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {projectList.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-200 text-sm">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedProjectIdForReport ? (
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardContent className="p-12 text-center">
                <BookOpen className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">Select a project to view its accountability report</p>
                <p className="text-slate-500 text-sm mt-1">Shows per-user action counts, sensitive operations, and full activity timeline.</p>
              </CardContent>
            </Card>
          ) : projectReportQuery.isLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800/60 rounded-xl" />)}</div>
          ) : projectReportQuery.isError ? (
            <p className="text-red-400 text-sm text-center py-4">Failed to load project report.</p>
          ) : (
            <div className="space-y-4">
              {/* Project header */}
              {projectReportQuery.data?.project && (
                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div>
                      <p className="text-slate-100 font-semibold">{projectReportQuery.data.project.name}</p>
                      <p className="text-slate-400 text-sm">{cap(projectReportQuery.data.project.lifecycleStatus)}</p>
                    </div>
                    <div className="ml-auto flex gap-6 text-center">
                      <div>
                        <p className="text-2xl font-bold text-slate-200">{projectReportQuery.data.total.toLocaleString()}</p>
                        <p className="text-slate-500 text-xs">Total Actions</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-slate-200">{projectReportQuery.data.byUser.length}</p>
                        <p className="text-slate-500 text-xs">Contributors</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* By user accountability */}
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-slate-200">User Accountability</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {(projectReportQuery.data?.byUser ?? []).map((u) => (
                    <div key={u.userId ?? "anon"} className="flex items-center gap-3 py-3 border-b border-slate-700/30 last:border-0">
                      <User className="h-4 w-4 text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-200 text-sm font-medium">{u.userName ?? "Unknown"}</span>
                          <RoleBadge role={u.userRole} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          First: {fmtDate(u.firstAction)} · Last: {fmtDate(u.lastAction)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-slate-200 text-sm font-semibold">{u.totalActions} actions</p>
                        {u.sensitiveActions > 0 && (
                          <p className="text-orange-400 text-xs">{u.sensitiveActions} sensitive</p>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Module breakdown */}
              {(projectReportQuery.data?.byModule ?? []).length > 0 && (
                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium text-slate-200">Activity by Module</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="flex flex-wrap gap-2">
                      {(projectReportQuery.data?.byModule ?? []).map((m) => (
                        <span key={m.module} className="text-xs px-2.5 py-1 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-300">
                          {cap(m.module)}: <span className="text-slate-100 font-medium">{m.count}</span>
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent entries */}
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-slate-200">Recent Activity (Latest 20)</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {(projectReportQuery.data?.entries ?? []).map((e) => <EntryRow key={e.id} entry={e} />)}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── LOGIN HISTORY TAB ────────────────────────────────────────────── */}
        <TabsContent value="sessions" className="mt-4">
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-emerald-400" />
                  Login Session History
                </CardTitle>
                {sessionsQuery.data && (
                  <span className="text-xs text-slate-500">{sessionsQuery.data.total.toLocaleString()} sessions on record</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                One session recorded per user per hour. IP address and user-agent preserved for forensic use.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {sessionsQuery.isLoading ? (
                <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 bg-slate-700/60 rounded" />)}</div>
              ) : !sessionsQuery.data?.sessions.length ? (
                <div className="text-center py-8">
                  <Monitor className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">No sessions recorded yet.</p>
                  <p className="text-slate-500 text-sm mt-1">Sessions are recorded automatically on first API request each hour.</p>
                </div>
              ) : (
                <div>
                  {sessionsQuery.data.sessions.map((s) => <SessionRow key={s.id} session={s} />)}
                  {sessionsQuery.data.total > 50 && (
                    <p className="text-xs text-slate-500 text-center mt-3">
                      Showing 50 of {sessionsQuery.data.total.toLocaleString()} sessions.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Legal notice ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 p-3 bg-slate-800/40 border border-slate-700/40 rounded-lg text-xs text-slate-500">
        <Lock className="h-3.5 w-3.5 flex-shrink-0" />
        <p>
          All audit entries are <span className="text-slate-400">write-once and tamper-evident</span>. This dashboard reads directly from the immutable audit ledger and session registry. Data is preserved for legal accountability and operational compliance.
        </p>
      </div>
    </div>
  );
}
