import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { useListGovernanceTimeline } from "@workspace/api-client-react";
import { useListProjects } from "@workspace/api-client-react";
import {
  AlertTriangle,
  Info,
  Zap,
  Filter,
  ChevronDown,
  ChevronUp,
  User,
  Calendar,
  Link2,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  projectId: string;
  projectName?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  severity: "info" | "important" | "critical";
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  agreement_activated: "Agreement Activated",
  agreement_generated: "Agreement Generated",
  contribution_approved: "Contribution Approved",
  contribution_rejected: "Contribution Rejected",
  contribution_disputed: "Contribution Disputed",
  contribution_verified: "Contribution Verified",
  expenditure_approved: "Expenditure Approved",
  expenditure_rejected: "Expenditure Rejected",
  lifecycle_changed: "Lifecycle Changed",
  maturity_declared: "Maturity Declared",
  project_closed: "Project Closed",
  ownership_frozen: "Ownership Frozen",
  ownership_freeze_lifted: "Ownership Freeze Lifted",
  ownership_transfer_initiated: "Transfer Initiated",
  ownership_transfer_executed: "Transfer Executed",
  inheritance_claim_filed: "Inheritance Claim Filed",
  inheritance_claim_approved: "Inheritance Claim Approved",
  inheritance_ownership_recorded: "Ownership Recorded",
  nominee_activated: "Nominee Activated",
  nominee_workflow_initiated: "Nominee Workflow Initiated",
  distribution_session_opened: "Distribution Session Opened",
  settlement_distributed: "Settlement Distributed",
  distribution_override: "Distribution Override",
  lca_applied: "LCA Applied",
  governance_note: "Governance Note",
};

function eventLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <Zap className="w-4 h-4 text-red-400" />;
  if (severity === "important") return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <Info className="w-4 h-4 text-blue-400" />;
}

function severityDotClass(severity: string) {
  if (severity === "critical") return "bg-red-500 ring-red-500/30";
  if (severity === "important") return "bg-amber-500 ring-amber-500/30";
  return "bg-blue-500 ring-blue-500/30";
}

function severityBadgeVariant(severity: string): "destructive" | "secondary" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "important") return "secondary";
  return "outline";
}

const ALL_EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS);

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GovernanceTimeline() {
  const [filterProject, setFilterProject] = useState("all");
  const [filterEventType, setFilterEventType] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [page, setPage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const PAGE_SIZE = 50;

  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (filterProject !== "all") p.projectId = filterProject;
    if (filterEventType !== "all") p.eventType = filterEventType;
    if (filterSeverity !== "all") p.severity = filterSeverity;
    if (filterFrom) p.from = filterFrom;
    if (filterTo) p.to = filterTo;
    return p;
  }, [filterProject, filterEventType, filterSeverity, filterFrom, filterTo, page]);

  const { data, isLoading, isError } = useListGovernanceTimeline(queryParams as Parameters<typeof useListGovernanceTimeline>[0]);
  const { data: projectsData } = useListProjects();

  const events: TimelineEvent[] = (data?.events as TimelineEvent[]) ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const projects = (projectsData ?? []) as { id: string; name: string }[];

  function resetFilters() {
    setFilterProject("all");
    setFilterEventType("all");
    setFilterSeverity("all");
    setFilterFrom("");
    setFilterTo("");
    setPage(0);
  }

  const hasActiveFilters =
    filterProject !== "all" ||
    filterEventType !== "all" ||
    filterSeverity !== "all" ||
    filterFrom !== "" ||
    filterTo !== "";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Governance Timeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Immutable evidentiary record of all governance, financial, and operational events across projects.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              Clear filters
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="gap-1.5"
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <Card className="border-border/60">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Project</label>
                <Select value={filterProject} onValueChange={(v) => { setFilterProject(v); setPage(0); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Event type</label>
                <Select value={filterEventType} onValueChange={(v) => { setFilterEventType(v); setPage(0); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {ALL_EVENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Severity</label>
                <Select value={filterSeverity} onValueChange={(v) => { setFilterSeverity(v); setPage(0); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="important">Important</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">From date</label>
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={filterFrom}
                  onChange={(e) => { setFilterFrom(e.target.value); setPage(0); }}
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">To date</label>
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={filterTo}
                  onChange={(e) => { setFilterTo(e.target.value); setPage(0); }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary bar */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {isLoading ? "Loading…" : isError ? "Error loading events" : `${total.toLocaleString()} event${total !== 1 ? "s" : ""}`}
        </span>
        {totalPages > 1 && (
          <span>Page {page + 1} of {totalPages}</span>
        )}
      </div>

      {/* Timeline */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-muted mt-1" />
                <div className="w-px flex-1 bg-muted/40 mt-1 min-h-[40px]" />
              </div>
              <div className="pb-6 flex-1">
                <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted/60 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !isError && events.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Info className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No timeline events found{hasActiveFilters ? " for the current filters" : ""}.</p>
        </div>
      )}

      {!isLoading && events.length > 0 && (
        <div className="relative">
          {events.map((event, idx) => {
            const isLast = idx === events.length - 1;
            return (
              <div key={event.id} className="flex gap-4">
                {/* Spine */}
                <div className="flex flex-col items-center w-5 shrink-0">
                  <div
                    className={`w-3 h-3 rounded-full ring-4 ring-offset-1 ring-offset-background mt-1 shrink-0 ${severityDotClass(event.severity)}`}
                  />
                  {!isLast && <div className="w-px flex-1 bg-border/50 mt-1 min-h-[36px]" />}
                </div>

                {/* Event card */}
                <div
                  className="pb-5 flex-1 min-w-0 cursor-pointer group"
                  onClick={() => setSelectedEvent(event)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedEvent(event)}
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <SeverityIcon severity={event.severity} />
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors leading-tight">
                      {event.title}
                    </span>
                    <Badge
                      variant={severityBadgeVariant(event.severity)}
                      className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                    >
                      {event.severity}
                    </Badge>
                  </div>

                  <div className="mt-1 flex items-center gap-3 flex-wrap">
                    {event.projectName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        {event.projectName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {eventLabel(event.eventType)}
                    </span>
                    {event.actorName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {event.actorName}
                        {event.actorRole && (
                          <span className="opacity-60">({event.actorRole})</span>
                        )}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span title={format(new Date(event.occurredAt), "dd MMM yyyy, HH:mm")}>
                        {formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true })}
                      </span>
                    </span>
                  </div>

                  {event.description && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {event.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Event Detail Dialog */}
      {selectedEvent && (
        <Dialog open onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-medium">
                <SeverityIcon severity={selectedEvent.severity} />
                {selectedEvent.title}
              </DialogTitle>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-2">
                {/* Core details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-0.5">Severity</span>
                    <Badge variant={severityBadgeVariant(selectedEvent.severity)} className="capitalize text-xs">
                      {selectedEvent.severity}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block mb-0.5">Event type</span>
                    <span className="font-mono text-xs text-foreground">{selectedEvent.eventType}</span>
                  </div>
                  {selectedEvent.projectName && (
                    <div>
                      <span className="text-xs text-muted-foreground block mb-0.5">Project</span>
                      <span className="text-sm">{selectedEvent.projectName}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground block mb-0.5">Occurred at</span>
                    <span className="text-sm">{format(new Date(selectedEvent.occurredAt), "dd MMM yyyy, HH:mm:ss")}</span>
                  </div>
                  {selectedEvent.actorName && (
                    <div>
                      <span className="text-xs text-muted-foreground block mb-0.5">Actor</span>
                      <span className="text-sm">
                        {selectedEvent.actorName}
                        {selectedEvent.actorRole && (
                          <span className="text-muted-foreground ml-1">({selectedEvent.actorRole})</span>
                        )}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground block mb-0.5">Record ID</span>
                    <span className="font-mono text-xs text-foreground break-all">{selectedEvent.id}</span>
                  </div>
                </div>

                {selectedEvent.description && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1">Description</span>
                      <p className="text-sm">{selectedEvent.description}</p>
                    </div>
                  </>
                )}

                {(selectedEvent.relatedTable || selectedEvent.relatedRecordId) && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1.5">Related record</span>
                      <div className="flex items-center gap-1.5 text-sm">
                        <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                        {selectedEvent.relatedTable && (
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                            {selectedEvent.relatedTable}
                          </span>
                        )}
                        {selectedEvent.relatedRecordId && (
                          <span className="font-mono text-xs text-muted-foreground break-all">
                            {selectedEvent.relatedRecordId}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1.5">Metadata</span>
                      <pre className="text-xs bg-muted rounded p-3 overflow-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(selectedEvent.metadata, null, 2)}
                      </pre>
                    </div>
                  </>
                )}

                <Separator />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Created at: {format(new Date(selectedEvent.createdAt), "dd MMM yyyy, HH:mm:ss")}</span>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
