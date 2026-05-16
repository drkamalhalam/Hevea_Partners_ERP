import { useState } from "react";
import { useAuthFetch } from "../lib/authFetch";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Leaf,
  Package,
  Warehouse,
  ClipboardList,
  ListChecks,
  FileText,
  UserCheck,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Zap,
  ChevronRight,
  Send,
  BarChart3,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useListProjects } from "@workspace/api-client-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldEvent {
  id: string;
  projectId: string | null;
  projectName: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  submittedByName: string | null;
  status: "pending" | "processed" | "conflict" | "rejected";
  conflictReason: string | null;
  eventedAt: string;
  processedAt: string | null;
  processedByName: string | null;
  resultEntityType: string | null;
  createdAt: string;
}

interface EventsResponse {
  events: FieldEvent[];
  counts: { pending: number; processed: number; conflict: number; rejected: number };
  total: number;
}

interface ProjectContext {
  project: {
    id: string;
    name: string;
    lifecycleStatus: string;
    activationStatus: string | null;
    commercialModel: string;
    configurationStatus: string;
  };
  stock: { stockType: string; unit: string; balance: number }[];
  pendingTaskCount: number;
  fetchedAt: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchFieldOps<T>(path: string): Promise<T> {
  return customFetch<T>(`/api/field-ops${path}`);
}

async function postEvent(body: Record<string, unknown>) {
  return customFetch("/api/field-ops/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchEventStatus(id: string, status: string, reason?: string) {
  return customFetch(`/api/field-ops/events/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, conflictReason: reason }),
  });
}

async function batchProcess(authFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const res = await authFetch("/api/field-ops/events/batch-process", { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Sub-components ────────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  quick_production: "Production Entry",
  quick_stock_intake: "Stock Intake",
  quick_expense: "Field Expense",
  attendance_check: "Attendance Check",
  stock_audit: "Stock Audit",
  field_note: "Field Note",
};

const STATUS_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; className: string; label: string }> = {
  pending: { icon: Clock, className: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Pending" },
  processed: { icon: CheckCircle2, className: "bg-green-500/15 text-green-300 border-green-500/30", label: "Processed" },
  conflict: { icon: AlertTriangle, className: "bg-orange-500/15 text-orange-300 border-orange-500/30", label: "Conflict" },
  rejected: { icon: XCircle, className: "bg-red-500/15 text-red-300 border-red-500/30", label: "Rejected" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ── Quick Action Cards ────────────────────────────────────────────────────────

interface QuickAction {
  title: string;
  description: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  roles: string[];
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    title: "Collection Entry",
    description: "Record daily latex / sheet collection",
    href: "/collection-entry",
    icon: Leaf,
    color: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
    roles: ["admin", "developer", "employee", "operational_staff"],
  },
  {
    title: "Store Intake",
    description: "Enter store receipts with numeric keypad",
    href: "/store-entry",
    icon: Package,
    color: "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10",
    roles: ["admin", "developer", "employee", "operational_staff"],
  },
  {
    title: "Stock Movement",
    description: "Log stock transfers and adjustments",
    href: "/stock",
    icon: Warehouse,
    color: "border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10",
    roles: ["admin", "developer", "employee", "operational_staff"],
  },
  {
    title: "Production Log",
    description: "Manage production batches and entries",
    href: "/production-log",
    icon: ClipboardList,
    color: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
    roles: ["admin", "developer", "employee", "operational_staff"],
  },
  {
    title: "My Tasks",
    description: "View and complete assigned tasks",
    href: "/tasks",
    icon: ListChecks,
    color: "border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10",
    roles: ["admin", "developer", "employee", "operational_staff"],
  },
  {
    title: "Production Dashboard",
    description: "View production analytics and KPIs",
    href: "/production-dashboard",
    icon: BarChart3,
    color: "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10",
    roles: ["admin", "developer"],
  },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FieldOperations() {
  const authFetch = useAuthFetch();
  const { role } = useRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin" || role === "developer";

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [fieldNoteText, setFieldNoteText] = useState("");
  const [rejectDialog, setRejectDialog] = useState<{ eventId: string; open: boolean }>({ eventId: "", open: false });
  const [rejectReason, setRejectReason] = useState("");

  const { data: projectsData } = useListProjects();
  const projects = (projectsData as unknown as { id: string; name: string; lifecycleStatus?: string }[] | undefined) ?? [];

  const contextQ = useQuery({
    queryKey: ["field-ops-context", selectedProjectId],
    queryFn: () => fetchFieldOps<ProjectContext>(`/context/${selectedProjectId}`),
    enabled: !!selectedProjectId,
  });

  const eventsQ = useQuery({
    queryKey: ["field-ops-events", statusFilter],
    queryFn: () => fetchFieldOps<EventsResponse>(`/events?status=${statusFilter}&limit=100`),
    refetchInterval: 30_000,
  });

  const submitNoteMut = useMutation({
    mutationFn: () =>
      postEvent({
        projectId: selectedProjectId || undefined,
        projectName: projects.find((p) => p.id === selectedProjectId)?.name,
        eventType: "field_note",
        payload: { note: fieldNoteText },
        eventedAt: new Date().toISOString(),
        idempotencyKey: `field_note_${Date.now()}`,
      }),
    onSuccess: () => {
      setFieldNoteText("");
      queryClient.invalidateQueries({ queryKey: ["field-ops-events"] });
      toast({ title: "Field note submitted", description: "Your observation has been queued for review." });
    },
    onError: (err) => toast({ title: "Submission failed", description: String(err), variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason?: string }) =>
      patchEventStatus(id, status, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["field-ops-events"] });
      setRejectDialog({ eventId: "", open: false });
      setRejectReason("");
      toast({ title: "Event updated" });
    },
    onError: (err) => toast({ title: "Update failed", description: String(err), variant: "destructive" }),
  });

  const batchMut = useMutation({
    mutationFn: () => batchProcess(authFetch),
    onSuccess: (data: { processed: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["field-ops-events"] });
      toast({ title: "Batch processed", description: data.message });
    },
    onError: (err) => toast({ title: "Batch failed", description: String(err), variant: "destructive" }),
  });

  const visibleActions = QUICK_ACTIONS.filter((a) => a.roles.includes(role ?? ""));

  const ctx = contextQ.data;

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            Field Operations
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quick-access hub for field workflows — submit events, view queue status, and access operational modules
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["field-ops-events"] })} disabled={eventsQ.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${eventsQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Event Queue Summary (admin) ──────────────────────────────────── */}
      {isAdmin && eventsQ.data && (
        <div className="grid grid-cols-4 gap-2">
          {(["pending", "processed", "conflict", "rejected"] as const).map((s) => {
            const cfg = STATUS_CONFIG[s];
            const Icon = cfg.icon;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg border p-2.5 text-center transition-all cursor-pointer ${cfg.className} ${statusFilter === s ? "ring-2 ring-white/20" : "opacity-70 hover:opacity-100"}`}
              >
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-lg font-bold">{eventsQ.data.counts[s]}</span>
                </div>
                <div className="text-xs capitalize">{s}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {visibleActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.title} href={action.href ?? "#"}>
                <div className={`rounded-lg border p-3 cursor-pointer transition-all ${action.color} group`}>
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="mt-2">
                    <div className="text-sm font-medium">{action.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{action.description}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Project Context ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Project Context</h2>
        <div className="flex items-center gap-2 mb-3">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a project…" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contextQ.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {selectedProjectId && ctx && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Card className="border-slate-700">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Project Status</div>
                <div className="font-medium text-sm">{ctx.project.name}</div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{ctx.project.lifecycleStatus.replace(/_/g, " ")}</Badge>
                  {ctx.project.activationStatus && (
                    <Badge variant="outline" className="text-xs">{ctx.project.activationStatus}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-700">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Current Stock</div>
                {ctx.stock.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">No stock movements recorded</div>
                ) : (
                  ctx.stock.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{s.stockType.replace(/_/g, " ")}</span>
                      <span className={`font-mono font-semibold ${s.balance < 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {s.balance.toFixed(2)} {s.unit}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card className="border-slate-700">
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Pending Tasks</div>
                <div className={`text-2xl font-bold ${ctx.pendingTaskCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {ctx.pendingTaskCount}
                </div>
                {ctx.pendingTaskCount > 0 && (
                  <Link href="/tasks">
                    <span className="text-xs text-blue-400 hover:underline">View tasks →</span>
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── Field Note Submission ────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Submit Field Note</h2>
        <Card className="border-slate-700">
          <CardContent className="p-3 space-y-2">
            <Textarea
              placeholder="Record a field observation, governance note, or attendance check…"
              value={fieldNoteText}
              onChange={(e) => setFieldNoteText(e.target.value)}
              className="text-sm min-h-[80px] resize-none"
              maxLength={1000}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{fieldNoteText.length}/1000</span>
              <Button
                size="sm"
                disabled={fieldNoteText.trim().length < 5 || submitNoteMut.isPending}
                onClick={() => submitNoteMut.mutate()}
                className="text-xs"
              >
                {submitNoteMut.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Submitting…</>
                ) : (
                  <><Send className="h-3.5 w-3.5 mr-1.5" />Submit to Queue</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Event Queue (admin view) ─────────────────────────────────────── */}
      {isAdmin && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Event Queue — {statusFilter}
            </h2>
            <div className="flex items-center gap-2">
              {statusFilter === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={batchMut.isPending}
                  onClick={() => batchMut.mutate()}
                >
                  {batchMut.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Processing…</>
                  ) : (
                    <>Auto-Process Notes & Attendance</>
                  )}
                </Button>
              )}
            </div>
          </div>

          {eventsQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading event queue…
            </div>
          ) : eventsQ.data && eventsQ.data.events.length === 0 ? (
            <Alert className="border-green-500/30 bg-green-500/5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-300 ml-2 text-xs">
                No {statusFilter} events in the queue.
              </AlertDescription>
            </Alert>
          ) : (
            <Card className="border-slate-700">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Project</TableHead>
                    <TableHead className="text-xs">Submitted By</TableHead>
                    <TableHead className="text-xs">Event Time</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Payload</TableHead>
                    {statusFilter === "pending" && <TableHead className="text-xs text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(eventsQ.data?.events ?? []).map((evt) => (
                    <TableRow key={evt.id}>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-xs">
                          {EVENT_TYPE_LABELS[evt.eventType] ?? evt.eventType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {evt.projectName ?? <span className="italic">No project</span>}
                      </TableCell>
                      <TableCell className="text-xs">{evt.submittedByName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(evt.eventedAt)}
                      </TableCell>
                      <TableCell><StatusBadge status={evt.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                        {evt.eventType === "field_note"
                          ? (evt.payload.note as string ?? "").slice(0, 80)
                          : <span className="font-mono text-[10px]">{JSON.stringify(evt.payload).slice(0, 60)}…</span>}
                        {evt.conflictReason && (
                          <div className="text-red-400 text-[10px] mt-0.5">{evt.conflictReason}</div>
                        )}
                        {evt.processedByName && evt.status === "processed" && (
                          <div className="text-green-400 text-[10px] mt-0.5">by {evt.processedByName}</div>
                        )}
                      </TableCell>
                      {statusFilter === "pending" && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {(evt.eventType === "field_note" || evt.eventType === "attendance_check") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs text-green-400 hover:text-green-300"
                                disabled={patchMut.isPending}
                                onClick={() => patchMut.mutate({ id: evt.id, status: "processed" })}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />Accept
                              </Button>
                            )}
                            {(evt.eventType === "quick_production" || evt.eventType === "quick_stock_intake") && (
                              <Link href={evt.eventType === "quick_production" ? "/production-log" : "/store-entry"}>
                                <Button size="sm" variant="ghost" className="h-6 text-xs text-blue-400 hover:text-blue-300">
                                  <FileText className="h-3 w-3 mr-1" />Route
                                </Button>
                              </Link>
                            )}
                            {evt.eventType === "stock_audit" && (
                              <Link href="/inventory">
                                <Button size="sm" variant="ghost" className="h-6 text-xs text-violet-400 hover:text-violet-300">
                                  <Warehouse className="h-3 w-3 mr-1" />Review
                                </Button>
                              </Link>
                            )}
                            {evt.eventType === "quick_expense" && (
                              <Link href="/expenditure">
                                <Button size="sm" variant="ghost" className="h-6 text-xs text-amber-400 hover:text-amber-300">
                                  <FileText className="h-3 w-3 mr-1" />Record
                                </Button>
                              </Link>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs text-red-400 hover:text-red-300"
                              disabled={patchMut.isPending}
                              onClick={() => { setRejectDialog({ eventId: evt.id, open: true }); setRejectReason(""); }}
                            >
                              <XCircle className="h-3 w-3 mr-1" />Reject
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ── My Recent Events (non-admin) ─────────────────────────────────── */}
      {!isAdmin && (
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">My Submitted Events</h2>
          {eventsQ.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : eventsQ.data && eventsQ.data.events.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No events submitted yet. Use the field note box above to submit your first observation.</p>
          ) : (
            <div className="space-y-1.5">
              {(eventsQ.data?.events ?? []).slice(0, 20).map((evt) => (
                <div key={evt.id} className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-800/30 px-3 py-2 text-xs">
                  <StatusBadge status={evt.status} />
                  <Badge variant="outline" className="text-[10px]">{EVENT_TYPE_LABELS[evt.eventType] ?? evt.eventType}</Badge>
                  <span className="text-muted-foreground">{fmtDate(evt.eventedAt)}</span>
                  {evt.projectName && <span className="text-muted-foreground">· {evt.projectName}</span>}
                  {evt.conflictReason && <span className="text-red-400">· {evt.conflictReason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reject Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={rejectDialog.open} onOpenChange={(o) => setRejectDialog((d) => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Field Event</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Provide a reason for rejection — this will be visible to the submitter.</p>
            <Textarea
              placeholder="e.g. Duplicate entry, incorrect project, payload validation failed…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="text-sm min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog({ eventId: "", open: false })}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 5 || patchMut.isPending}
              onClick={() => patchMut.mutate({ id: rejectDialog.eventId, status: "rejected", reason: rejectReason })}
            >
              {patchMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
