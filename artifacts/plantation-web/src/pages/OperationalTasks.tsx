import { useState } from "react";
import { format, isPast, isToday } from "date-fns";
import {
  CheckSquare2,
  Clock,
  AlertTriangle,
  Plus,
  ClipboardList,
  PackageOpen,
  Search,
  CheckCheck,
  CircleDot,
  XCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Calendar,
  User,
  FolderKanban,
  Loader2,
  Play,
  X,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import {
  useListTasks,
  useGetTaskSummary,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useListProjects,
  getListTasksQueryKey,
  getGetTaskSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  OperationalTask,
  CreateTaskBody,
  UpdateTaskBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PersonMasterSelector,
  type PersonSummary,
  derivePersonId,
} from "@/components/PersonMasterSelector";

// ── Helpers ───────────────────────────────────────────────────────────────

function taskTypeLabel(t: string) {
  return (
    {
      production_entry: "Production Entry",
      stock_update: "Stock Update",
      inspection: "Inspection",
      general: "General",
    }[t] ?? t
  );
}

function taskTypeIcon(t: string) {
  if (t === "production_entry") return <ClipboardList className="w-3.5 h-3.5" />;
  if (t === "stock_update") return <PackageOpen className="w-3.5 h-3.5" />;
  if (t === "inspection") return <Search className="w-3.5 h-3.5" />;
  return <CheckSquare2 className="w-3.5 h-3.5" />;
}

function statusConfig(s: string) {
  return (
    {
      pending: { label: "Pending", color: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="w-3 h-3" /> },
      in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <CircleDot className="w-3 h-3" /> },
      completed: { label: "Completed", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCheck className="w-3 h-3" /> },
      cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500 border-gray-200", icon: <XCircle className="w-3 h-3" /> },
    }[s] ?? { label: s, color: "bg-gray-100 text-gray-700 border-gray-200", icon: null }
  );
}

function priorityConfig(p: string) {
  return (
    {
      urgent: { label: "Urgent", dot: "bg-red-500" },
      high: { label: "High", dot: "bg-orange-400" },
      normal: { label: "Normal", dot: "bg-blue-400" },
      low: { label: "Low", dot: "bg-gray-300" },
    }[p] ?? { label: p, dot: "bg-gray-300" }
  );
}

function dueDateLabel(dueDate: string | null | undefined, status: string) {
  if (!dueDate || status === "completed" || status === "cancelled") return null;
  const d = new Date(dueDate);
  if (isToday(d)) return { label: "Due today", className: "text-amber-600 font-medium" };
  if (isPast(d)) return { label: `Overdue · ${format(d, "d MMM")}`, className: "text-red-600 font-medium" };
  return { label: `Due ${format(d, "d MMM")}`, className: "text-muted-foreground" };
}

/** Resolve the best display name for an assignee from a task record */
function resolveAssigneeName(task: OperationalTask): string | null {
  return task.assignedToPersonName ?? task.assignedToName ?? null;
}

// ── Task Card ─────────────────────────────────────────────────────────────

function TaskCard({
  task,
  canManage,
  onStatusChange,
  onEdit,
  onDelete,
}: {
  task: OperationalTask;
  canManage: boolean;
  onStatusChange: (id: string, status: string, notes?: string) => void;
  onEdit: (task: OperationalTask) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sc = statusConfig(task.status);
  const pc = priorityConfig(task.priority);
  const due = dueDateLabel(task.dueDate, task.status);
  const assigneeName = resolveAssigneeName(task);

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-all ${
        task.status === "completed"
          ? "opacity-70"
          : task.priority === "urgent"
          ? "border-red-200"
          : task.priority === "high"
          ? "border-orange-200"
          : "border-gray-200"
      }`}
    >
      {/* Header row */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Priority dot */}
        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${pc.dot}`} />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span
              className={`text-sm font-medium ${
                task.status === "completed" ? "line-through text-muted-foreground" : ""
              }`}
            >
              {task.title}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${sc.color}`}
            >
              {sc.icon} {sc.label}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {taskTypeIcon(task.taskType)}
              {taskTypeLabel(task.taskType)}
            </span>
            {task.projectName && (
              <span className="inline-flex items-center gap-1">
                <FolderKanban className="w-3 h-3" />
                {task.projectName}
              </span>
            )}
            {assigneeName && (
              <span className="inline-flex items-center gap-1">
                {task.assignedToPersonId ? (
                  <UserCheck className="w-3 h-3 text-emerald-500" />
                ) : (
                  <User className="w-3 h-3" />
                )}
                {assigneeName}
              </span>
            )}
            {due && (
              <span className={`inline-flex items-center gap-1 ${due.className}`}>
                <Calendar className="w-3 h-3" />
                {due.label}
              </span>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-1.5">
          {task.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(task.id, "in_progress");
              }}
            >
              <Play className="w-3 h-3" /> Start
            </Button>
          )}
          {task.status === "in_progress" && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(task.id, "completed");
              }}
            >
              <CheckCheck className="w-3 h-3" /> Complete
            </Button>
          )}
          {canManage && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
              >
                <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </Button>
            </>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100 space-y-3">
          {task.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{task.description}</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block mb-0.5">Priority</span>
              <span className="font-medium">{priorityConfig(task.priority).label}</span>
            </div>
            {assigneeName && (
              <div>
                <span className="text-muted-foreground block mb-0.5">Assigned to</span>
                <span className="font-medium flex items-center gap-1">
                  {task.assignedToPersonId && (
                    <UserCheck className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                  )}
                  {assigneeName}
                </span>
                {task.assignedToPersonId && (
                  <span className="text-muted-foreground font-mono text-[10px]">
                    Registry identity
                  </span>
                )}
              </div>
            )}
            {task.assignedByName && (
              <div>
                <span className="text-muted-foreground block mb-0.5">Assigned by</span>
                <span className="font-medium">{task.assignedByName}</span>
              </div>
            )}
            {task.dueDate && (
              <div>
                <span className="text-muted-foreground block mb-0.5">Due date</span>
                <span className="font-medium">{format(new Date(task.dueDate), "d MMM yyyy")}</span>
              </div>
            )}
            {task.completedAt && (
              <div>
                <span className="text-muted-foreground block mb-0.5">Completed</span>
                <span className="font-medium text-emerald-700">
                  {format(new Date(task.completedAt), "d MMM, h:mm a")}
                </span>
              </div>
            )}
          </div>
          {task.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create/Edit Dialog ────────────────────────────────────────────────────

function TaskFormDialog({
  open,
  onClose,
  editTask,
}: {
  open: boolean;
  onClose: () => void;
  editTask?: OperationalTask;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: projects = [] } = useListProjects();
  const createMut = useCreateTask();
  const updateMut = useUpdateTask();

  const isEdit = !!editTask;

  // Person assignment state
  const [assignedPerson, setAssignedPerson] = useState<PersonSummary | null>(null);
  // For edit mode: track whether the user has actively changed the assignment
  const [assignmentChanged, setAssignmentChanged] = useState(false);

  const [form, setForm] = useState({
    title: editTask?.title ?? "",
    description: editTask?.description ?? "",
    taskType: (editTask?.taskType ?? "general") as
      | "production_entry"
      | "stock_update"
      | "inspection"
      | "general",
    priority: (editTask?.priority ?? "normal") as "low" | "normal" | "high" | "urgent",
    projectId: editTask?.projectId ?? "",
    dueDate: editTask?.dueDate ?? "",
    notes: editTask?.notes ?? "",
  });

  // Current assignee display (edit mode — before any change)
  const currentAssigneeName =
    editTask?.assignedToPersonName ?? editTask?.assignedToName ?? null;
  const currentAssigneeIsRegistry = !!editTask?.assignedToPersonId;

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      // Resolve assignment fields
      const personId = assignmentChanged
        ? (assignedPerson?.id ?? undefined)
        : (isEdit ? editTask?.assignedToPersonId ?? undefined : undefined);
      const personName = assignmentChanged
        ? (assignedPerson?.fullName ?? undefined)
        : (isEdit ? editTask?.assignedToPersonName ?? undefined : undefined);

      const body = {
        title: form.title,
        description: form.description || undefined,
        taskType: form.taskType,
        priority: form.priority,
        projectId: form.projectId || undefined,
        projectName: projects.find((p) => p.id === form.projectId)?.name,
        assignedToPersonId: personId,
        assignedToPersonName: personName,
        dueDate: form.dueDate || undefined,
        notes: form.notes || undefined,
      };

      if (isEdit) {
        await updateMut.mutateAsync({ id: editTask!.id, data: body as UpdateTaskBody });
        toast({ title: "Task updated" });
      } else {
        await createMut.mutateAsync({ data: body as CreateTaskBody });
        toast({ title: "Task created" });
      }
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      onClose();
    } catch {
      toast({ title: "Failed to save task", variant: "destructive" });
    }
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Task" : "Create Task"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Task title"
            />
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.taskType}
                onValueChange={(v) => setForm((f) => ({ ...f, taskType: v as any }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production_entry">Production Entry</SelectItem>
                  <SelectItem value="stock_update">Stock Update</SelectItem>
                  <SelectItem value="inspection">Inspection</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => setForm((f) => ({ ...f, priority: v as any }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">🔴 Urgent</SelectItem>
                  <SelectItem value="high">🟠 High</SelectItem>
                  <SelectItem value="normal">🔵 Normal</SelectItem>
                  <SelectItem value="low">⚪ Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Project */}
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select
              value={form.projectId || "__none__"}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, projectId: v === "__none__" ? "" : v }))
              }
            >
              <SelectTrigger><SelectValue placeholder="Any project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Assignee — Person Master */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              Assign to (Person Registry)
            </Label>

            {/* Edit mode: show current assignee before any change */}
            {isEdit && !assignmentChanged && currentAssigneeName && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <UserCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-900 truncate">{currentAssigneeName}</p>
                  {currentAssigneeIsRegistry && (
                    <p className="text-[11px] text-emerald-600">Registry identity</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-emerald-700 hover:bg-emerald-100 flex-shrink-0"
                  onClick={() => setAssignmentChanged(true)}
                >
                  Change
                </Button>
              </div>
            )}

            {/* Show selector when: create mode, or edit mode after "Change" clicked */}
            {(!isEdit || assignmentChanged || !currentAssigneeName) && (
              <>
                {assignedPerson ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <UserCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-emerald-900 truncate">
                        {assignedPerson.fullName}
                      </p>
                      <p className="text-[11px] text-emerald-600 font-mono">
                        {derivePersonId(assignedPerson.id, assignedPerson.createdAt)}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-emerald-700 hover:bg-emerald-100 flex-shrink-0"
                      onClick={() => {
                        setAssignedPerson(null);
                        if (isEdit) setAssignmentChanged(false);
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <PersonMasterSelector
                    selectedPerson={assignedPerson}
                    onSelect={(p) => {
                      setAssignedPerson(p);
                      if (p) setAssignmentChanged(true);
                    }}
                  />
                )}
                <p className="text-[11px] text-muted-foreground">
                  Search the Person Registry by name, mobile, or Aadhaar. Workers without
                  login accounts can still receive tasks.
                </p>
              </>
            )}
          </div>

          {/* Due Date */}
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What needs to be done?"
              rows={3}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes for assignee</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any instructions or context"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function OperationalTasks() {
  const { role } = useRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = role === "admin" || role === "developer";

  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<OperationalTask | undefined>();

  const queryStatus =
    statusFilter === "active" || statusFilter === "all" ? undefined : statusFilter;

  const { data: tasks = [], isLoading } = useListTasks({
    status: queryStatus as any,
  });
  const { data: summary } = useGetTaskSummary();
  const updateMut = useUpdateTask();
  const deleteMut = useDeleteTask();

  const filtered = tasks.filter((t) => {
    if (statusFilter === "active" && (t.status === "completed" || t.status === "cancelled"))
      return false;
    if (statusFilter !== "active" && statusFilter !== "all" && t.status !== statusFilter)
      return false;
    if (typeFilter !== "all" && t.taskType !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = (t.assignedToPersonName ?? t.assignedToName ?? "").toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        (t.projectName ?? "").toLowerCase().includes(q) ||
        name.includes(q)
      );
    }
    return true;
  });

  const active = filtered.filter((t) => t.status === "pending" || t.status === "in_progress");
  const done = filtered.filter((t) => t.status === "completed" || t.status === "cancelled");

  async function handleStatusChange(id: string, status: string) {
    try {
      await updateMut.mutateAsync({ id, data: { status: status as any } });
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      toast({ title: status === "completed" ? "Task completed!" : "Task updated" });
    } catch {
      toast({ title: "Failed to update task", variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMut.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTaskSummaryQueryKey() });
      toast({ title: "Task removed" });
    } catch {
      toast({ title: "Failed to remove task", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5 max-w-[900px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Operational Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {canManage
              ? "Assign tasks to any registered person — no login account required"
              : "Your assigned tasks"}
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditTask(undefined);
              setShowForm(true);
            }}
            className="gap-1.5 h-9"
          >
            <Plus className="w-4 h-4" /> New Task
          </Button>
        )}
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-white p-3.5 shadow-sm">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold text-amber-600 mt-0.5">{summary.pending}</p>
          </div>
          <div className="rounded-xl border bg-white p-3.5 shadow-sm">
            <p className="text-xs text-muted-foreground">In Progress</p>
            <p className="text-2xl font-bold text-blue-600 mt-0.5">{summary.inProgress}</p>
          </div>
          <div className="rounded-xl border bg-white p-3.5 shadow-sm">
            <p className="text-xs text-muted-foreground">Urgent</p>
            <p
              className={`text-2xl font-bold mt-0.5 ${
                summary.urgent > 0 ? "text-red-600" : "text-gray-400"
              }`}
            >
              {summary.urgent}
            </p>
          </div>
          <div className="rounded-xl border bg-white p-3.5 shadow-sm">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p
              className={`text-2xl font-bold mt-0.5 ${
                summary.overdue > 0 ? "text-red-600" : "text-gray-400"
              }`}
            >
              {summary.overdue}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-9 text-sm"
            placeholder="Search tasks or assignees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 text-sm w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 text-sm w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="production_entry">Production</SelectItem>
            <SelectItem value="stock_update">Stock</SelectItem>
            <SelectItem value="inspection">Inspection</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckSquare2 className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No tasks found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {canManage
              ? "Create a task and assign it to anyone in the Person Registry"
              : "No tasks assigned to you yet"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {active.length > 0 && (
            <div className="space-y-2">
              {statusFilter === "all" && (
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Active · {active.length}
                </p>
              )}
              {active.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  canManage={canManage}
                  onStatusChange={handleStatusChange}
                  onEdit={(task) => {
                    setEditTask(task);
                    setShowForm(true);
                  }}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-2">
              {(statusFilter === "all" || statusFilter === "active") && (
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Completed / Cancelled · {done.length}
                </p>
              )}
              {done.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  canManage={canManage}
                  onStatusChange={handleStatusChange}
                  onEdit={(task) => {
                    setEditTask(task);
                    setShowForm(true);
                  }}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit dialog */}
      {showForm && (
        <TaskFormDialog
          open={showForm}
          onClose={() => {
            setShowForm(false);
            setEditTask(undefined);
          }}
          editTask={editTask}
        />
      )}
    </div>
  );
}
