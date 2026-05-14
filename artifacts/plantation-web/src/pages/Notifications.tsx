import { useState } from "react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useGetUnreadNotificationCount,
  getListNotificationsQueryKey,
  getGetUnreadNotificationCountQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  Info,
  AlertTriangle,
  FileText,
  ClipboardList,
  RefreshCw,
  Circle,
  CircleCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, React.ElementType> = {
  agreement_renewal: FileText,
  payment_due: AlertTriangle,
  system_alert: AlertTriangle,
  task_assigned: ClipboardList,
  report_ready: FileText,
  general: Info,
};

const TYPE_COLORS: Record<string, string> = {
  agreement_renewal: "text-blue-400",
  payment_due: "text-amber-400",
  system_alert: "text-red-400",
  task_assigned: "text-purple-400",
  report_ready: "text-green-400",
  general: "text-slate-400",
};

const TYPE_BG: Record<string, string> = {
  agreement_renewal: "bg-blue-900/30 border-blue-800/40",
  payment_due: "bg-amber-900/30 border-amber-800/40",
  system_alert: "bg-red-900/30 border-red-800/40",
  task_assigned: "bg-purple-900/30 border-purple-800/40",
  report_ready: "bg-green-900/30 border-green-800/40",
  general: "bg-slate-800/40 border-slate-700/40",
};

const TYPE_LABELS: Record<string, string> = {
  agreement_renewal: "Agreement",
  payment_due: "Payment",
  system_alert: "Alert",
  task_assigned: "Task",
  report_ready: "Report",
  general: "General",
};

type FilterTab = "all" | "unread" | "system_alert" | "task_assigned" | "agreement_renewal" | "payment_due";

export default function Notifications() {
  useRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  const unreadOnly = tab === "unread" ? "true" : undefined;
  const typeFilter = (tab !== "all" && tab !== "unread") ? tab : undefined;

  const notifParams = { unreadOnly, type: typeFilter };
  const { data, isLoading, refetch } = useListNotifications(
    notifParams,
    { query: { refetchInterval: 30000, queryKey: getListNotificationsQueryKey(notifParams) } },
  );

  const { data: countData } = useGetUnreadNotificationCount({
    query: { refetchInterval: 30000, queryKey: getGetUnreadNotificationCountQueryKey() },
  });

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteN = useDeleteNotification();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
  };

  const handleMarkRead = (id: string, isRead: boolean) => {
    markRead.mutate({ id, data: { isRead: !isRead } }, { onSuccess: invalidate });
  };

  const handleMarkAll = () => {
    markAllRead.mutate(undefined, { onSuccess: invalidate });
  };

  const handleDelete = (id: string) => {
    deleteN.mutate({ id }, { onSuccess: invalidate });
  };

  const all = data?.notifications ?? [];
  const notifications = all.filter((n) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return n.title?.toLowerCase().includes(q) || n.message?.toLowerCase().includes(q);
  });

  const unreadCount = countData?.count ?? 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">Notifications</h1>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white min-w-[1.5rem]">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">System alerts, reminders, and communications</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-700 text-slate-300 hover:text-white"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button
              size="sm"
              onClick={handleMarkAll}
              disabled={markAllRead.isPending}
              className="bg-blue-700 hover:bg-blue-600 text-white"
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: data?.total ?? 0, color: "text-white" },
          { label: "Unread", value: unreadCount, color: "text-blue-400" },
          {
            label: "Alerts",
            value: all.filter((n) => n.type === "system_alert").length,
            color: "text-red-400",
          },
          {
            label: "Tasks",
            value: all.filter((n) => n.type === "task_assigned").length,
            color: "text-purple-400",
          },
        ].map((stat) => (
          <Card key={stat.label} className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <p className="text-xs text-slate-400">{stat.label}</p>
              <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            <TabsTrigger value="unread" className="text-xs">
              Unread
              {unreadCount > 0 && (
                <span className="ml-1 rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                  {unreadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="system_alert" className="text-xs">Alerts</TabsTrigger>
            <TabsTrigger value="task_assigned" className="text-xs">Tasks</TabsTrigger>
            <TabsTrigger value="agreement_renewal" className="text-xs">Agreements</TabsTrigger>
            <TabsTrigger value="payment_due" className="text-xs">Payments</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search notifications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white placeholder-slate-400 h-9 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex gap-3 p-3">
                  <Skeleton className="h-10 w-10 rounded-full bg-slate-700" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48 bg-slate-700" />
                    <Skeleton className="h-3 w-72 bg-slate-700" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <BellOff className="h-12 w-12 text-slate-600 mb-4" />
              <p className="text-slate-400 font-medium">No notifications</p>
              <p className="text-slate-500 text-sm mt-1">
                {tab === "unread" ? "You're all caught up!" : "Nothing to show for this filter."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type ?? "general"] ?? Info;
                const colorClass = TYPE_COLORS[n.type ?? "general"] ?? "text-slate-400";
                const bgClass = TYPE_BG[n.type ?? "general"] ?? "bg-slate-800/40 border-slate-700/40";

                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-4 p-4 transition-colors",
                      !n.isRead ? "bg-slate-700/20" : "hover:bg-slate-700/10",
                    )}
                  >
                    <div
                      className={cn(
                        "flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center border",
                        bgClass,
                      )}
                    >
                      <Icon className={cn("h-5 w-5", colorClass)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {!n.isRead && (
                            <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-0.5" />
                          )}
                          <p className={cn(
                            "text-sm font-medium truncate",
                            n.isRead ? "text-slate-300" : "text-white",
                          )}>
                            {n.title}
                          </p>
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-slate-600 text-slate-400 flex-shrink-0"
                          >
                            {TYPE_LABELS[n.type ?? "general"] ?? n.type}
                          </Badge>
                        </div>
                        <span className="text-xs text-slate-500 flex-shrink-0 mt-0.5">
                          {formatDistanceToNow(parseISO(n.createdAt!), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-400 mt-0.5 leading-relaxed">{n.message}</p>
                      {n.readAt && (
                        <p className="text-xs text-slate-600 mt-1">
                          Read {format(parseISO(n.readAt), "d MMM yyyy, HH:mm")}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleMarkRead(n.id!, n.isRead ?? false)}
                        className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                        title={n.isRead ? "Mark as unread" : "Mark as read"}
                      >
                        {n.isRead ? <Circle className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(n.id!)}
                        className="p-1.5 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {notifications.length > 0 && (
        <p className="text-xs text-slate-500 text-center">
          Showing {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
          {search && " matching your search"}
        </p>
      )}
    </div>
  );
}
