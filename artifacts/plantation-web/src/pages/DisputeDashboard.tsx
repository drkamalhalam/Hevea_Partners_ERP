import { useState, useMemo } from "react";
import {
  useListDisputes,
  useGetDisputePendingSummary,
  useGetDispute,
  useAddDisputeEvent,
  useCreateDispute,
} from "@workspace/api-client-react";
import { useListProjects } from "@workspace/api-client-react";
import { useRole } from "../contexts/RoleContext";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { AlertTriangle, AlertCircle, CheckCircle2, Clock, ChevronLeft, ChevronRight, Plus, ArrowUpCircle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Dispute {
  id: string;
  projectId: string;
  projectName?: string | null;
  disputeType: string;
  status: string;
  severity: string;
  title: string;
  description?: string | null;
  raisedByName?: string | null;
  raisedByRole?: string | null;
  raisedAt: string;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  resolvedAt?: string | null;
  resolvedByName?: string | null;
  resolutionSummary?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface DisputeEvent {
  id: string;
  eventType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  description?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  performedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DISPUTE_TYPES = [
  "contribution",
  "expenditure",
  "settlement",
  "ownership",
  "inheritance",
  "governance",
];

const SEVERITIES = ["low", "medium", "high", "critical"];

const STATUSES = ["open", "under_review", "escalated", "resolved", "withdrawn"];

const EVENT_TYPES = [
  { value: "reviewed", label: "Mark Under Review" },
  { value: "note_added", label: "Add Note" },
  { value: "resolved", label: "Resolve" },
  { value: "escalated", label: "Escalate" },
  { value: "withdrawn", label: "Withdraw" },
];

const TERMINAL_STATUSES = ["resolved", "withdrawn"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function capitalize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityColor(s: string) {
  if (s === "critical") return "bg-red-600 text-white";
  if (s === "high") return "bg-orange-500 text-white";
  if (s === "medium") return "bg-yellow-500 text-black";
  return "bg-gray-400 text-white";
}

function statusColor(s: string) {
  if (s === "open") return "bg-red-100 text-red-700 border-red-200";
  if (s === "under_review") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (s === "escalated") return "bg-orange-100 text-orange-700 border-orange-200";
  if (s === "resolved") return "bg-green-100 text-green-700 border-green-200";
  if (s === "withdrawn") return "bg-gray-100 text-gray-500 border-gray-200";
  return "bg-gray-100 text-gray-600";
}

function eventIcon(type: string) {
  if (type === "raised") return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (type === "reviewed") return <Clock className="h-4 w-4 text-yellow-500" />;
  if (type === "resolved") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (type === "escalated") return <ArrowUpCircle className="h-4 w-4 text-orange-500" />;
  return <AlertTriangle className="h-4 w-4 text-gray-400" />;
}

// ── Detail Dialog ─────────────────────────────────────────────────────────────

function DisputeDetailDialog({
  disputeId,
  open,
  onClose,
  onEventAdded,
}: {
  disputeId: string | null;
  open: boolean;
  onClose: () => void;
  onEventAdded: () => void;
}) {
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [eventType, setEventType] = useState("note_added");
  const [eventDesc, setEventDesc] = useState("");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useGetDispute(disputeId ?? "");

  const addEventMutation = useAddDisputeEvent();

  const dispute = data?.dispute as Dispute | undefined;
  const events = (data?.events ?? []) as DisputeEvent[];

  const isTerminal = dispute ? TERMINAL_STATUSES.includes(dispute.status) : false;

  async function handleAddEvent() {
    if (!disputeId || !eventDesc.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addEventMutation.mutateAsync({
        id: disputeId,
        data: {
          eventType,
          description: eventDesc.trim(),
          resolutionSummary: eventType === "resolved" ? resolutionSummary.trim() || undefined : undefined,
        },
      });
      setAddEventOpen(false);
      setEventDesc("");
      setResolutionSummary("");
      setEventType("note_added");
      onEventAdded();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add event";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {isLoading || !dispute ? (
          <div className="py-12 text-center text-gray-400">Loading…</div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <DialogTitle className="text-lg font-semibold leading-tight">
                    {dispute.title}
                  </DialogTitle>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge className={`text-xs ${statusColor(dispute.status)}`}>
                      {capitalize(dispute.status)}
                    </Badge>
                    <Badge className={`text-xs ${severityColor(dispute.severity)}`}>
                      {capitalize(dispute.severity)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {capitalize(dispute.disputeType)}
                    </Badge>
                  </div>
                </div>
              </div>
            </DialogHeader>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-sm border rounded-lg p-3 bg-gray-50">
              <div>
                <span className="text-gray-500 text-xs">Project</span>
                <p className="font-medium">{dispute.projectName ?? dispute.projectId}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Raised</span>
                <p className="font-medium">{fmtDateTime(dispute.raisedAt)}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Raised By</span>
                <p className="font-medium">
                  {dispute.raisedByName ?? "—"}
                  {dispute.raisedByRole && (
                    <span className="text-gray-400 text-xs ml-1">({dispute.raisedByRole})</span>
                  )}
                </p>
              </div>
              {dispute.relatedTable && (
                <div>
                  <span className="text-gray-500 text-xs">Linked Record</span>
                  <p className="font-mono text-xs text-gray-600">
                    {dispute.relatedTable} / {dispute.relatedRecordId?.slice(0, 8)}…
                  </p>
                </div>
              )}
              {dispute.resolvedAt && (
                <>
                  <div>
                    <span className="text-gray-500 text-xs">Resolved</span>
                    <p className="font-medium">{fmtDateTime(dispute.resolvedAt)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Resolved By</span>
                    <p className="font-medium">{dispute.resolvedByName ?? "—"}</p>
                  </div>
                </>
              )}
            </div>

            {/* Description */}
            {dispute.description && (
              <div className="text-sm text-gray-700 border rounded-lg p-3 bg-white">
                <p className="text-xs text-gray-400 mb-1">Description</p>
                <p className="whitespace-pre-wrap">{dispute.description}</p>
              </div>
            )}

            {/* Resolution summary */}
            {dispute.resolutionSummary && (
              <div className="text-sm text-green-800 border border-green-200 rounded-lg p-3 bg-green-50">
                <p className="text-xs text-green-600 mb-1 font-medium">Resolution Summary</p>
                <p className="whitespace-pre-wrap">{dispute.resolutionSummary}</p>
              </div>
            )}

            {/* Event timeline */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Resolution Timeline ({events.length} events)
              </h3>
              <div className="space-y-3">
                {events.map((ev, i) => (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="mt-0.5">{eventIcon(ev.eventType)}</div>
                      {i < events.length - 1 && (
                        <div className="w-px flex-1 bg-gray-200 mt-1" />
                      )}
                    </div>
                    <div className="flex-1 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-700">
                          {capitalize(ev.eventType)}
                        </span>
                        <span className="text-xs text-gray-400">{fmtDateTime(ev.performedAt)}</span>
                      </div>
                      {(ev.previousStatus || ev.newStatus) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {ev.previousStatus && (
                            <>
                              <span className="line-through">{capitalize(ev.previousStatus)}</span>
                              {" → "}
                            </>
                          )}
                          {ev.newStatus && (
                            <span className={`font-medium ${statusColor(ev.newStatus)} px-1 py-0.5 rounded`}>
                              {capitalize(ev.newStatus)}
                            </span>
                          )}
                        </p>
                      )}
                      {ev.description && (
                        <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
                          {ev.description}
                        </p>
                      )}
                      {ev.actorName && (
                        <p className="text-xs text-gray-400 mt-1">
                          by {ev.actorName}
                          {ev.actorRole && ` (${ev.actorRole})`}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Add event */}
            {!isTerminal && (
              <div>
                {!addEventOpen ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddEventOpen(true)}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" /> Add Resolution Event
                  </Button>
                ) : (
                  <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                    <h4 className="text-sm font-semibold text-gray-700">Add Event</h4>
                    <div>
                      <Label className="text-xs text-gray-500 mb-1 block">Event Type</Label>
                      <Select value={eventType} onValueChange={setEventType}>
                        <SelectTrigger className="text-sm h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EVENT_TYPES.map((et) => (
                            <SelectItem key={et.value} value={et.value}>
                              {et.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-gray-500 mb-1 block">Description *</Label>
                      <Textarea
                        value={eventDesc}
                        onChange={(e) => setEventDesc(e.target.value)}
                        rows={3}
                        placeholder="Describe the action taken or note added…"
                        className="text-sm"
                      />
                    </div>
                    {eventType === "resolved" && (
                      <div>
                        <Label className="text-xs text-gray-500 mb-1 block">Resolution Summary</Label>
                        <Textarea
                          value={resolutionSummary}
                          onChange={(e) => setResolutionSummary(e.target.value)}
                          rows={2}
                          placeholder="Summarise how this dispute was resolved…"
                          className="text-sm"
                        />
                      </div>
                    )}
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setAddEventOpen(false); setError(null); }}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleAddEvent} disabled={submitting || !eventDesc.trim()}>
                        {submitting ? "Saving…" : "Save Event"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Create Dispute Dialog ─────────────────────────────────────────────────────

function CreateDisputeDialog({
  open,
  onClose,
  onCreated,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  projects: { id: string; name: string }[];
}) {
  const [projectId, setProjectId] = useState("");
  const [disputeType, setDisputeType] = useState("governance");
  const [severity, setSeverity] = useState("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateDispute();

  async function handleCreate() {
    if (!projectId || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMutation.mutateAsync({
        data: { projectId, disputeType, severity, title: title.trim(), description: description.trim() || undefined },
      });
      setProjectId(""); setDisputeType("governance"); setSeverity("medium");
      setTitle(""); setDescription("");
      onCreated();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create dispute");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log New Dispute</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">Project *</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select project…" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Dispute Type *</Label>
              <Select value={disputeType} onValueChange={setDisputeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISPUTE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{capitalize(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the dispute…"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Context, parties involved, timeline…"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting || !projectId || !title.trim()}>
            {submitting ? "Logging…" : "Log Dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DisputeDashboard() {
  const { role } = useRole();
  const canWrite = role === "admin" || role === "developer";

  const [filterProject, setFilterProject] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const PAGE_SIZE = 20;

  const listParams = {
    projectId: filterProject !== "all" ? filterProject : undefined,
    disputeType: filterType !== "all" ? filterType : undefined,
    status: filterStatus !== "all" ? filterStatus : undefined,
    severity: filterSeverity !== "all" ? filterSeverity : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data: listData, isLoading: listLoading, refetch: refetchList } = useListDisputes(listParams);
  const { data: summaryData, refetch: refetchSummary } = useGetDisputePendingSummary({});
  const { data: projectsData } = useListProjects({});

  const disputes = useMemo(() => (listData?.disputes ?? []) as Dispute[], [listData]);
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const projects = useMemo(() => {
    const raw = projectsData;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as { id: string; name: string }[];
    if (Array.isArray((raw as { projects?: unknown }).projects)) {
      return (raw as { projects: { id: string; name: string }[] }).projects;
    }
    return [];
  }, [projectsData]);

  const summary = summaryData as {
    totalOpen?: number;
    totalUnderReview?: number;
    totalEscalated?: number;
    totalResolved?: number;
    highSeverityOpen?: number;
    byType?: { disputeType: string; open: number; underReview: number; escalated: number }[];
    urgent?: Dispute[];
  } | undefined;

  function openDetail(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  function handleRefresh() {
    void refetchList();
    void refetchSummary();
  }

  const urgentDisputes = summary?.urgent ?? [];
  const hasUrgent = urgentDisputes.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Disputes & Conflicts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Unified traceability of all operational and governance disputes
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Log Dispute
          </Button>
        )}
      </div>

      {/* Governance Warning Banner */}
      {hasUrgent && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
            <h2 className="text-sm font-bold text-red-800">
              {urgentDisputes.length} Urgent Dispute{urgentDisputes.length !== 1 ? "s" : ""} Require Attention
            </h2>
          </div>
          <div className="space-y-2">
            {urgentDisputes.slice(0, 5).map((d) => (
              <button
                key={d.id}
                className="w-full text-left flex items-center justify-between gap-3 rounded-md border border-red-200 bg-white px-3 py-2 text-xs hover:bg-red-50 transition-colors"
                onClick={() => openDetail(d.id)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Badge className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${severityColor(d.severity)}`}>
                    {d.severity.toUpperCase()}
                  </Badge>
                  <span className="font-medium text-red-900 truncate">{d.title}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 text-red-600">
                  <span className="text-gray-400">{d.projectName ?? "—"}</span>
                  <span>{fmtDate(d.raisedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Open", value: summary?.totalOpen ?? 0, color: "text-red-600", bg: "bg-red-50" },
          { label: "Under Review", value: summary?.totalUnderReview ?? 0, color: "text-yellow-600", bg: "bg-yellow-50" },
          { label: "Escalated", value: summary?.totalEscalated ?? 0, color: "text-orange-600", bg: "bg-orange-50" },
          { label: "High Severity", value: summary?.highSeverityOpen ?? 0, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Resolved", value: summary?.totalResolved ?? 0, color: "text-green-600", bg: "bg-green-50" },
        ].map((card) => (
          <Card key={card.label} className={`${card.bg} border-0`}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-500 mb-1">{card.label}</p>
              <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Type Breakdown */}
      {(summary?.byType ?? []).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {(summary?.byType ?? []).map((bt) => (
            <div
              key={bt.disputeType}
              className="border rounded-lg p-3 bg-white text-center hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => { setFilterType(bt.disputeType); setPage(0); }}
            >
              <p className="text-xs font-medium text-gray-700 mb-2">{capitalize(bt.disputeType)}</p>
              <div className="flex justify-center gap-2 text-xs">
                {bt.open > 0 && <span className="text-red-600 font-semibold">{bt.open} open</span>}
                {bt.underReview > 0 && <span className="text-yellow-600">{bt.underReview} review</span>}
                {bt.escalated > 0 && <span className="text-orange-600 font-semibold">{bt.escalated} esc.</span>}
                {bt.open === 0 && bt.underReview === 0 && bt.escalated === 0 && (
                  <span className="text-gray-400">clear</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-gray-50 rounded-lg border">
        <Select value={filterProject} onValueChange={(v) => { setFilterProject(v); setPage(0); }}>
          <SelectTrigger className="w-44 bg-white text-sm h-8">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
          <SelectTrigger className="w-40 bg-white text-sm h-8">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {DISPUTE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{capitalize(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
          <SelectTrigger className="w-40 bg-white text-sm h-8">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterSeverity} onValueChange={(v) => { setFilterSeverity(v); setPage(0); }}>
          <SelectTrigger className="w-36 bg-white text-sm h-8">
            <SelectValue placeholder="All Severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterProject !== "all" || filterType !== "all" || filterStatus !== "all" || filterSeverity !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setFilterProject("all"); setFilterType("all");
              setFilterStatus("all"); setFilterSeverity("all"); setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="text-xs">Dispute</TableHead>
              <TableHead className="text-xs w-28">Type</TableHead>
              <TableHead className="text-xs w-24">Severity</TableHead>
              <TableHead className="text-xs w-28">Status</TableHead>
              <TableHead className="text-xs w-32">Project</TableHead>
              <TableHead className="text-xs w-28">Raised</TableHead>
              <TableHead className="text-xs w-28">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  Loading disputes…
                </TableCell>
              </TableRow>
            ) : disputes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  No disputes found
                </TableCell>
              </TableRow>
            ) : (
              disputes.map((d) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => openDetail(d.id)}
                >
                  <TableCell className="py-2.5">
                    <p className="text-sm font-medium text-gray-900 line-clamp-1">{d.title}</p>
                    {d.description && (
                      <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{d.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-600">{capitalize(d.disputeType)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${severityColor(d.severity)}`}>
                      {capitalize(d.severity)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs border ${statusColor(d.status)}`}>
                      {capitalize(d.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-600 truncate max-w-[8rem]">
                    {d.projectName ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">{fmtDate(d.raisedAt)}</TableCell>
                  <TableCell className="text-xs text-gray-500">{d.raisedByName ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <DisputeDetailDialog
        disputeId={selectedId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onEventAdded={handleRefresh}
      />

      <CreateDisputeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleRefresh}
        projects={projects}
      />
    </div>
  );
}
