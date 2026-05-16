import { useState } from "react";
import { useAuthFetch } from "../lib/authFetch";
import { useQuery } from "@tanstack/react-query";
import { useProjectFilter } from "../contexts/ProjectFilterContext";
import { useRole } from "../contexts/RoleContext";
import { Link } from "wouter";
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  ChevronRight,
  Clock,
  Filter,
  Info,
  ListTodo,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GovernanceMonitoringAlert {
  id: string;
  type: string;
  category: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  projectId?: string | null;
  projectName?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  actionPath?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface GovernanceMonitoringEvent {
  id: string;
  type: string;
  category: string;
  timestamp: string;
  projectId?: string | null;
  projectName?: string | null;
  actor?: string | null;
  title: string;
  description: string;
  severity: string;
  entityId?: string | null;
  entityType?: string | null;
  actionPath?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface GovernanceMonitoringTask {
  id: string;
  type: string;
  category: string;
  priority: "urgent" | "high" | "medium" | "low";
  title: string;
  description: string;
  projectId?: string | null;
  projectName?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  actionPath?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: {
    label: "Critical",
    icon: ShieldAlert,
    badgeClass: "bg-red-900/40 text-red-300 border border-red-700/40",
    cardBorder: "border-l-4 border-l-red-500",
    iconClass: "text-red-400",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    badgeClass: "bg-yellow-900/40 text-yellow-300 border border-yellow-700/40",
    cardBorder: "border-l-4 border-l-yellow-500",
    iconClass: "text-yellow-400",
  },
  info: {
    label: "Info",
    icon: Info,
    badgeClass: "bg-blue-900/40 text-blue-300 border border-blue-700/40",
    cardBorder: "border-l-4 border-l-blue-500",
    iconClass: "text-blue-400",
  },
} as const;

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent", badgeClass: "bg-red-900/40 text-red-300 border border-red-700/40" },
  high: { label: "High", badgeClass: "bg-orange-900/40 text-orange-300 border border-orange-700/40" },
  medium: { label: "Medium", badgeClass: "bg-yellow-900/40 text-yellow-300 border border-yellow-700/40" },
  low: { label: "Low", badgeClass: "bg-slate-700/60 text-slate-300 border border-slate-600/40" },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  ownership: "Ownership",
  succession: "Succession",
  inheritance: "Inheritance",
  nominee: "Nominee",
  transfer: "Transfer",
  missing_developer: "Missing Developer",
  settlement: "Settlement",
};

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ");
}

function formatRelativeTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: GovernanceMonitoringAlert }) {
  const sev = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  const Icon = sev.icon;
  return (
    <Card className={`bg-slate-800/60 border-slate-700/50 ${sev.cardBorder} hover:bg-slate-800/80 transition-colors`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${sev.iconClass}`} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-slate-100 text-sm font-medium">{alert.title}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sev.badgeClass}`}>
                  {sev.label}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/40">
                  {categoryLabel(alert.category)}
                </span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">{alert.description}</p>
              {alert.projectName && (
                <p className="text-slate-500 text-xs mt-1.5">
                  Project: <span className="text-slate-400">{alert.projectName}</span>
                </p>
              )}
            </div>
          </div>
          {alert.actionPath && (
            <Link href={alert.actionPath}>
              <Button size="sm" variant="ghost" className="shrink-0 text-slate-400 hover:text-slate-100 h-7 px-2">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TimelineEvent({ event }: { event: GovernanceMonitoringEvent }) {
  const sev = SEVERITY_CONFIG[event.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.info;
  return (
    <div className="flex gap-3 py-3 border-b border-slate-700/40 last:border-0">
      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
        event.severity === "critical" ? "bg-red-400" :
        event.severity === "warning" ? "bg-yellow-400" : "bg-blue-400"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className="text-slate-200 text-sm font-medium">{event.title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${sev.badgeClass}`}>
            {categoryLabel(event.category)}
          </span>
        </div>
        <p className="text-slate-400 text-xs leading-relaxed">{event.description}</p>
        <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-500">
          {event.actor && <span>By: <span className="text-slate-400">{event.actor}</span></span>}
          {event.projectName && <span>Project: <span className="text-slate-400">{event.projectName}</span></span>}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>
      </div>
      {event.actionPath && (
        <Link href={event.actionPath}>
          <Button size="sm" variant="ghost" className="shrink-0 text-slate-400 hover:text-slate-100 h-7 px-2">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </Link>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: GovernanceMonitoringTask }) {
  const pri = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-700/40 last:border-0">
      <ListTodo className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className="text-slate-200 text-sm font-medium">{task.title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${pri.badgeClass}`}>
            {pri.label}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/40">
            {categoryLabel(task.category)}
          </span>
        </div>
        <p className="text-slate-400 text-xs leading-relaxed">{task.description}</p>
        <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
          {task.projectName && <span>Project: <span className="text-slate-400">{task.projectName}</span></span>}
          {task.dueDate && (
            <span className="flex items-center gap-1 text-orange-400">
              <Clock className="w-3 h-3" />
              Due: {new Date(task.dueDate).toLocaleDateString("en-IN")}
            </span>
          )}
        </div>
      </div>
      {task.actionPath && (
        <Link href={task.actionPath}>
          <Button size="sm" variant="outline" className="shrink-0 border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700 h-7 text-xs px-2">
            Act
          </Button>
        </Link>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function GovernanceAlertCenter() {
  const authFetch = useAuthFetch();
  const { selectedProjectId } = useProjectFilter();
  const { role } = useRole();
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [tab, setTab] = useState("alerts");

  const queryParams = new URLSearchParams();
  if (selectedProjectId) queryParams.set("projectId", selectedProjectId);

  const alertsQuery = useQuery<GovernanceMonitoringAlert[]>({
    queryKey: ["/api/governance-monitoring/alerts", selectedProjectId, severityFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      if (severityFilter !== "all") params.set("severity", severityFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/governance-monitoring/alerts?${params}`);
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
  });

  const timelineQuery = useQuery<GovernanceMonitoringEvent[]>({
    queryKey: ["/api/governance-monitoring/timeline", selectedProjectId, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      params.set("limit", "50");
      const res = await fetch(`/api/governance-monitoring/timeline?${params}`);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
    enabled: tab === "timeline",
  });

  const tasksQuery = useQuery<GovernanceMonitoringTask[]>({
    queryKey: ["/api/governance-monitoring/tasks", selectedProjectId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      const res = await fetch(`/api/governance-monitoring/tasks?${params}`);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
    enabled: tab === "tasks",
  });

  if (!["admin", "developer"].includes(role ?? "")) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">Access restricted to administrators and developers.</p>
        </div>
      </div>
    );
  }

  const alerts = alertsQuery.data ?? [];
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const tasks = tasksQuery.data ?? [];
  const urgentCount = tasks.filter((t) => t.priority === "urgent").length;

  const categories = Array.from(
    new Set([...(alertsQuery.data ?? []).map((a) => a.category)])
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-5 h-5 text-indigo-400" />
            <h1 className="text-xl font-semibold text-slate-100">Governance Alert Center</h1>
          </div>
          <p className="text-slate-400 text-sm">
            Real-time governance health monitoring — ownership, succession, inheritance, and transfer events.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700"
          onClick={() => {
            alertsQuery.refetch();
            timelineQuery.refetch();
            tasksQuery.refetch();
          }}
        >
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="bg-red-950/30 border-red-800/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs font-medium mb-1">Critical Alerts</p>
            <p className="text-red-300 text-2xl font-bold">
              {alertsQuery.isLoading ? <Skeleton className="h-8 w-12 bg-slate-700" /> : criticalCount}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-950/30 border-yellow-800/40">
          <CardContent className="p-4">
            <p className="text-yellow-400 text-xs font-medium mb-1">Warnings</p>
            <p className="text-yellow-300 text-2xl font-bold">
              {alertsQuery.isLoading ? <Skeleton className="h-8 w-12 bg-slate-700" /> : warningCount}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-orange-950/30 border-orange-800/40">
          <CardContent className="p-4">
            <p className="text-orange-400 text-xs font-medium mb-1">Urgent Tasks</p>
            <p className="text-orange-300 text-2xl font-bold">
              {tasksQuery.isLoading ? <Skeleton className="h-8 w-12 bg-slate-700" /> : urgentCount}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700/50">
          <CardContent className="p-4">
            <p className="text-slate-400 text-xs font-medium mb-1">Total Alerts</p>
            <p className="text-slate-200 text-2xl font-bold">
              {alertsQuery.isLoading ? <Skeleton className="h-8 w-12 bg-slate-700" /> : alerts.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Filter className="w-4 h-4 text-slate-500" />
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-slate-200 h-8 text-xs">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-200 text-xs">All Severities</SelectItem>
            <SelectItem value="critical" className="text-red-300 text-xs">Critical</SelectItem>
            <SelectItem value="warning" className="text-yellow-300 text-xs">Warning</SelectItem>
            <SelectItem value="info" className="text-blue-300 text-xs">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-slate-200 h-8 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all" className="text-slate-200 text-xs">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat} className="text-slate-200 text-xs">
                {categoryLabel(cat)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-slate-800/80 border border-slate-700/60 mb-4 h-9">
          <TabsTrigger value="alerts" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <Bell className="w-3.5 h-3.5 mr-1.5" />
            Alerts
            {criticalCount > 0 && (
              <span className="ml-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                {criticalCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <Clock className="w-3.5 h-3.5 mr-1.5" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <ListTodo className="w-3.5 h-3.5 mr-1.5" />
            Tasks
            {urgentCount > 0 && (
              <span className="ml-1.5 w-4 h-4 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center">
                {urgentCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Alerts Tab */}
        <TabsContent value="alerts">
          {alertsQuery.isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 bg-slate-800/60 rounded-lg" />
              ))}
            </div>
          ) : alertsQuery.isError ? (
            <Card className="bg-red-950/30 border-red-800/40">
              <CardContent className="p-6 text-center text-red-400">
                Failed to load alerts. Please try again.
              </CardContent>
            </Card>
          ) : alerts.length === 0 ? (
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardContent className="p-12 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-slate-300 font-medium mb-1">No alerts found</p>
                <p className="text-slate-500 text-sm">All governance conditions are healthy.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {/* Critical first */}
              {alerts
                .filter((a) => {
                  if (severityFilter !== "all" && a.severity !== severityFilter) return false;
                  if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
                  return true;
                })
                .sort((a, b) => {
                  const order = { critical: 0, warning: 1, info: 2 };
                  return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
                })
                .map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
            </div>
          )}
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline">
          <Card className="bg-slate-800/60 border-slate-700/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-slate-200 text-sm font-medium">
                Governance Event History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timelineQuery.isLoading ? (
                <div className="space-y-3">
                  {[...Array(8)].map((_, i) => (
                    <Skeleton key={i} className="h-16 bg-slate-700/60 rounded" />
                  ))}
                </div>
              ) : timelineQuery.isError ? (
                <p className="text-red-400 text-sm text-center py-4">Failed to load timeline.</p>
              ) : !timelineQuery.data?.length ? (
                <p className="text-slate-500 text-sm text-center py-8">No timeline events found.</p>
              ) : (
                <div>
                  {timelineQuery.data
                    .filter((e) => categoryFilter === "all" || e.category === categoryFilter)
                    .map((event) => (
                      <TimelineEvent key={event.id} event={event} />
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card className="bg-slate-800/60 border-slate-700/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-slate-200 text-sm font-medium">
                Pending Administrative Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tasksQuery.isLoading ? (
                <div className="space-y-3">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-16 bg-slate-700/60 rounded" />
                  ))}
                </div>
              ) : tasksQuery.isError ? (
                <p className="text-red-400 text-sm text-center py-4">Failed to load tasks.</p>
              ) : !tasksQuery.data?.length ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No pending tasks. Everything is in order.</p>
                </div>
              ) : (
                <div>
                  {tasksQuery.data
                    .sort((a, b) => {
                      const order = { urgent: 0, high: 1, medium: 2, low: 3 };
                      return (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
                    })
                    .map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
