import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGovernanceMeetings,
  useCreateGovernanceMeeting,
  useGetGovernanceMeeting,
  useUpdateGovernanceMeeting,
  useUpdateGovernanceMeetingStatus,
  useDeleteGovernanceMeeting,
  useCreateGovernanceResolution,
  useUpdateGovernanceResolution,
  useDeleteGovernanceResolution,
  useListProjects,
  getListGovernanceMeetingsQueryKey,
  getGetGovernanceMeetingQueryKey,
} from "@workspace/api-client-react";
import type { GovernanceMeeting, GovernanceResolution } from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Plus,
  ChevronRight,
  Calendar,
  MapPin,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  Vote,
  Pencil,
  Trash2,
  ArrowRight,
  RefreshCw,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Status helpers ─────────────────────────────────────────────────────────

const MEETING_STATUS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  scheduled: { label: "Scheduled", color: "bg-blue-900/40 text-blue-400 border-blue-800/40", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-amber-900/40 text-amber-400 border-amber-800/40", icon: RefreshCw },
  completed: { label: "Completed", color: "bg-emerald-900/40 text-emerald-400 border-emerald-800/40", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "bg-slate-700 text-slate-400 border-slate-600", icon: XCircle },
};

const RESOLUTION_STATUS: Record<string, { label: string; color: string }> = {
  proposed: { label: "Proposed", color: "bg-blue-900/40 text-blue-300 border-blue-800/40" },
  passed: { label: "Passed", color: "bg-emerald-900/40 text-emerald-300 border-emerald-800/40" },
  rejected: { label: "Rejected", color: "bg-red-900/40 text-red-300 border-red-800/40" },
  deferred: { label: "Deferred", color: "bg-amber-900/40 text-amber-300 border-amber-800/40" },
  implemented: { label: "Implemented", color: "bg-purple-900/40 text-purple-300 border-purple-800/40" },
};

const MEETING_TYPES = ["general", "committee", "emergency", "annual_review", "project_review"];
const VOTING_METHODS = ["show_of_hands", "written_ballot", "consensus", "unanimous"];

// ── Small helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; color: string; icon?: React.ElementType }> }) {
  const d = map[status] ?? { label: status, color: "bg-slate-700 text-slate-400 border-slate-600" };
  const Icon = d.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border", d.color)}>
      {Icon && <Icon className="h-3 w-3" />}
      {d.label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Governance() {
  const { role } = useRole();
  const qc = useQueryClient();
  const canEdit = role === "admin" || role === "developer";

  const [tab, setTab] = useState<"all" | "scheduled" | "completed">("all");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("_all");

  // Detail view
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  // Create meeting dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    meetingType: "general",
    meetingDate: "",
    meetingTime: "",
    venue: "",
    agenda: "",
    projectId: "_none",
  });

  // Edit meeting
  const [editMeetingOpen, setEditMeetingOpen] = useState(false);
  const [editMeetingForm, setEditMeetingForm] = useState<{
    title: string; meetingTime: string; venue: string;
    agenda: string; minutes: string; quorumMet: boolean; totalAttendees: string;
  }>({ title: "", meetingTime: "", venue: "", agenda: "", minutes: "", quorumMet: false, totalAttendees: "" });

  // Create resolution dialog
  const [createResOpen, setCreateResOpen] = useState(false);
  const [resForm, setResForm] = useState({
    resolutionNumber: "",
    title: "",
    description: "",
    status: "proposed",
    votesFor: "0",
    votesAgainst: "0",
    votesAbstain: "0",
    votingMethod: "show_of_hands",
    implementationDeadline: "",
  });

  // Edit resolution
  const [editResolution, setEditResolution] = useState<GovernanceResolution | null>(null);

  const { data: projects } = useListProjects();

  const statusFilter = tab !== "all" ? tab : undefined;
  const { data: meetingsData, isLoading } = useListGovernanceMeetings({
    status: statusFilter,
    projectId: projectFilter !== "_all" ? projectFilter : undefined,
  });

  const { data: detailData, isLoading: detailLoading } = useGetGovernanceMeeting(
    selectedMeetingId ?? "",
    { query: { enabled: !!selectedMeetingId, queryKey: getGetGovernanceMeetingQueryKey(selectedMeetingId ?? "") } },
  );

  const createMeeting = useCreateGovernanceMeeting();
  const updateMeeting = useUpdateGovernanceMeeting();
  const updateStatus = useUpdateGovernanceMeetingStatus();
  const deleteMeeting = useDeleteGovernanceMeeting();
  const createRes = useCreateGovernanceResolution();
  const updateRes = useUpdateGovernanceResolution();
  const deleteRes = useDeleteGovernanceResolution();

  const invalidateMeetings = () => qc.invalidateQueries({ queryKey: getListGovernanceMeetingsQueryKey() });
  const invalidateDetail = (id: string) => qc.invalidateQueries({ queryKey: getGetGovernanceMeetingQueryKey(id) });

  const meetings = (meetingsData?.meetings ?? []).filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.title?.toLowerCase().includes(q) || (m as any).projectName?.toLowerCase().includes(q);
  });

  const selectedMeeting = detailData?.meeting as GovernanceMeeting | undefined;
  const resolutions = (detailData?.resolutions ?? []) as GovernanceResolution[];

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreateMeeting = () => {
    if (!createForm.title || !createForm.meetingDate) return;
    createMeeting.mutate(
      {
        data: {
          title: createForm.title,
          meetingType: createForm.meetingType,
          meetingDate: createForm.meetingDate,
          meetingTime: createForm.meetingTime || undefined,
          venue: createForm.venue || undefined,
          agenda: createForm.agenda || undefined,
          projectId: createForm.projectId !== "_none" ? createForm.projectId : undefined,
        },
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setCreateForm({ title: "", meetingType: "general", meetingDate: "", meetingTime: "", venue: "", agenda: "", projectId: "_none" });
          invalidateMeetings();
        },
      },
    );
  };

  const openEditMeeting = (m: GovernanceMeeting) => {
    setEditMeetingForm({
      title: m.title ?? "",
      meetingTime: m.meetingTime ?? "",
      venue: m.venue ?? "",
      agenda: m.agenda ?? "",
      minutes: m.minutes ?? "",
      quorumMet: m.quorumMet ?? false,
      totalAttendees: String(m.totalAttendees ?? ""),
    });
    setEditMeetingOpen(true);
  };

  const handleUpdateMeeting = () => {
    if (!selectedMeetingId) return;
    updateMeeting.mutate(
      {
        id: selectedMeetingId,
        data: {
          title: editMeetingForm.title || undefined,
          meetingTime: editMeetingForm.meetingTime || undefined,
          venue: editMeetingForm.venue || undefined,
          agenda: editMeetingForm.agenda || undefined,
          minutes: editMeetingForm.minutes || undefined,
          quorumMet: editMeetingForm.quorumMet,
          totalAttendees: editMeetingForm.totalAttendees ? parseInt(editMeetingForm.totalAttendees) : undefined,
        },
      },
      {
        onSuccess: () => {
          setEditMeetingOpen(false);
          invalidateDetail(selectedMeetingId);
          invalidateMeetings();
        },
      },
    );
  };

  const handleStatusTransition = (toStatus: string) => {
    if (!selectedMeetingId) return;
    updateStatus.mutate(
      { id: selectedMeetingId, data: { status: toStatus } },
      {
        onSuccess: () => {
          invalidateDetail(selectedMeetingId);
          invalidateMeetings();
        },
      },
    );
  };

  const handleDeleteMeeting = (id: string) => {
    if (!confirm("Archive this meeting? It will be hidden from the list.")) return;
    deleteMeeting.mutate(
      { id },
      {
        onSuccess: () => {
          setSelectedMeetingId(null);
          invalidateMeetings();
        },
      },
    );
  };

  const handleCreateResolution = () => {
    if (!selectedMeetingId || !resForm.title) return;
    createRes.mutate(
      {
        id: selectedMeetingId,
        data: {
          title: resForm.title,
          resolutionNumber: resForm.resolutionNumber || undefined,
          description: resForm.description || undefined,
          status: resForm.status,
          votesFor: parseInt(resForm.votesFor) || 0,
          votesAgainst: parseInt(resForm.votesAgainst) || 0,
          votesAbstain: parseInt(resForm.votesAbstain) || 0,
          votingMethod: resForm.votingMethod,
          implementationDeadline: resForm.implementationDeadline || undefined,
        },
      },
      {
        onSuccess: () => {
          setCreateResOpen(false);
          setResForm({ resolutionNumber: "", title: "", description: "", status: "proposed", votesFor: "0", votesAgainst: "0", votesAbstain: "0", votingMethod: "show_of_hands", implementationDeadline: "" });
          invalidateDetail(selectedMeetingId);
        },
      },
    );
  };

  const handleUpdateResolution = () => {
    if (!editResolution || !selectedMeetingId) return;
    updateRes.mutate(
      {
        id: selectedMeetingId,
        resolutionId: editResolution.id!,
        data: {
          title: editResolution.title,
          description: editResolution.description ?? undefined,
          status: editResolution.status,
          votesFor: editResolution.votesFor ?? 0,
          votesAgainst: editResolution.votesAgainst ?? 0,
          votesAbstain: editResolution.votesAbstain ?? 0,
          votingMethod: editResolution.votingMethod ?? undefined,
          implementationDeadline: editResolution.implementationDeadline ?? undefined,
          implementationNotes: editResolution.implementationNotes ?? undefined,
        },
      },
      {
        onSuccess: () => {
          setEditResolution(null);
          invalidateDetail(selectedMeetingId);
        },
      },
    );
  };

  const handleDeleteResolution = (resId: string) => {
    if (!selectedMeetingId || !confirm("Remove this resolution?")) return;
    deleteRes.mutate(
      { id: selectedMeetingId, resolutionId: resId },
      { onSuccess: () => invalidateDetail(selectedMeetingId) },
    );
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (selectedMeetingId) {
    return (
      <MeetingDetail
        meeting={selectedMeeting}
        resolutions={resolutions}
        isLoading={detailLoading}
        canEdit={canEdit}
        onBack={() => setSelectedMeetingId(null)}
        onEdit={() => selectedMeeting && openEditMeeting(selectedMeeting)}
        onStatusChange={handleStatusTransition}
        onDelete={() => selectedMeetingId && handleDeleteMeeting(selectedMeetingId)}
        onAddResolution={() => setCreateResOpen(true)}
        onEditResolution={setEditResolution}
        onDeleteResolution={handleDeleteResolution}
        updatingStatus={updateStatus.isPending}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Governance</h1>
          <p className="text-sm text-slate-400 mt-1">
            Partnership meeting minutes, resolutions, and committee decisions
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="bg-emerald-700 hover:bg-emerald-600 text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            Schedule Meeting
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: meetingsData?.total ?? 0, color: "text-white" },
          { label: "Scheduled", value: (meetingsData?.meetings ?? []).filter((m) => m.status === "scheduled").length, color: "text-blue-400" },
          { label: "Completed", value: (meetingsData?.meetings ?? []).filter((m) => m.status === "completed").length, color: "text-emerald-400" },
          {
            label: "Total Resolutions",
            value: (meetingsData?.meetings ?? []).reduce((s) => s, 0),
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            <TabsTrigger value="scheduled" className="text-xs">Scheduled</TabsTrigger>
            <TabsTrigger value="completed" className="text-xs">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-44 text-sm h-8">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="_all" className="text-slate-300">All projects</SelectItem>
            {(projects ?? []).map((p: any) => (
              <SelectItem key={p.id} value={p.id} className="text-slate-300">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search meetings..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white placeholder-slate-400 h-8 text-sm max-w-xs"
        />
      </div>

      {/* Meeting list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-56 bg-slate-700" />
                <Skeleton className="h-3 w-40 bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : meetings.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="py-20 flex flex-col items-center text-center">
            <Building2 className="h-12 w-12 text-slate-600 mb-4" />
            <p className="text-slate-400 font-medium">No meetings found</p>
            <p className="text-slate-500 text-sm mt-1">
              {canEdit ? "Schedule a meeting to get started." : "No meetings have been scheduled yet."}
            </p>
            {canEdit && (
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="mt-4 bg-emerald-700 hover:bg-emerald-600 text-white"
              >
                <Plus className="h-4 w-4 mr-1" />
                Schedule First Meeting
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => {
            const statusInfo = MEETING_STATUS[m.status ?? "scheduled"] ?? MEETING_STATUS.scheduled;
            const StatusIcon = statusInfo.icon;
            return (
              <Card
                key={m.id}
                className="bg-slate-800/50 border-slate-700 cursor-pointer hover:border-slate-600 transition-colors"
                onClick={() => setSelectedMeetingId(m.id!)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-white font-medium">{m.title}</h3>
                        <StatusBadge status={m.status ?? "scheduled"} map={MEETING_STATUS} />
                        {m.meetingType && (
                          <Badge variant="outline" className="text-[10px] px-1.5 border-slate-600 text-slate-400 capitalize">
                            {(m.meetingType as string).replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {m.meetingDate ? format(parseISO(m.meetingDate + "T00:00:00"), "d MMM yyyy") : "—"}
                          {m.meetingTime && ` · ${m.meetingTime}`}
                        </span>
                        {m.venue && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {m.venue}
                          </span>
                        )}
                        {(m as any).projectName && (
                          <span className="text-blue-400">{(m as any).projectName}</span>
                        )}
                        {m.totalAttendees && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {m.totalAttendees} attendees
                          </span>
                        )}
                        {m.createdByName && (
                          <span className="text-slate-500">by {m.createdByName}</span>
                        )}
                      </div>
                      {m.agenda && (
                        <p className="text-xs text-slate-500 mt-2 line-clamp-2">{m.agenda}</p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-500 flex-shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Meeting Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule Meeting</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a new governance meeting record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Meeting Title *</Label>
              <Input
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Q1 Partner Review Meeting"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Type</Label>
                <Select value={createForm.meetingType} onValueChange={(v) => setCreateForm((f) => ({ ...f, meetingType: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {MEETING_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-slate-300 capitalize">{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Date *</Label>
                <Input
                  type="date"
                  value={createForm.meetingDate}
                  onChange={(e) => setCreateForm((f) => ({ ...f, meetingDate: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Time</Label>
                <Input
                  type="time"
                  value={createForm.meetingTime}
                  onChange={(e) => setCreateForm((f) => ({ ...f, meetingTime: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Project</Label>
                <Select value={createForm.projectId} onValueChange={(v) => setCreateForm((f) => ({ ...f, projectId: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-sm">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="_none" className="text-slate-300">JV-wide</SelectItem>
                    {(projects ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id} className="text-slate-300">{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Venue</Label>
              <Input
                value={createForm.venue}
                onChange={(e) => setCreateForm((f) => ({ ...f, venue: e.target.value }))}
                placeholder="e.g. Agartala Office, Room 2"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Agenda</Label>
              <Textarea
                value={createForm.agenda}
                onChange={(e) => setCreateForm((f) => ({ ...f, agenda: e.target.value }))}
                placeholder="Meeting agenda items..."
                rows={3}
                className="bg-slate-800 border-slate-700 text-white resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-slate-600 text-slate-300">
                Cancel
              </Button>
              <Button
                onClick={handleCreateMeeting}
                disabled={!createForm.title || !createForm.meetingDate || createMeeting.isPending}
                className="bg-emerald-700 hover:bg-emerald-600 text-white"
              >
                Schedule Meeting
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Meeting Dialog */}
      <Dialog open={editMeetingOpen} onOpenChange={setEditMeetingOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Meeting</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Title</Label>
              <Input
                value={editMeetingForm.title}
                onChange={(e) => setEditMeetingForm((f) => ({ ...f, title: e.target.value }))}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Time</Label>
                <Input
                  type="time"
                  value={editMeetingForm.meetingTime}
                  onChange={(e) => setEditMeetingForm((f) => ({ ...f, meetingTime: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Venue</Label>
                <Input
                  value={editMeetingForm.venue}
                  onChange={(e) => setEditMeetingForm((f) => ({ ...f, venue: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Total Attendees</Label>
                <Input
                  type="number"
                  value={editMeetingForm.totalAttendees}
                  onChange={(e) => setEditMeetingForm((f) => ({ ...f, totalAttendees: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5 flex items-end">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={editMeetingForm.quorumMet}
                    onChange={(e) => setEditMeetingForm((f) => ({ ...f, quorumMet: e.target.checked }))}
                    className="rounded border-slate-600"
                  />
                  <span className="text-slate-300 text-sm">Quorum met</span>
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Agenda</Label>
              <Textarea
                value={editMeetingForm.agenda}
                onChange={(e) => setEditMeetingForm((f) => ({ ...f, agenda: e.target.value }))}
                rows={3}
                className="bg-slate-800 border-slate-700 text-white resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Minutes</Label>
              <Textarea
                value={editMeetingForm.minutes}
                onChange={(e) => setEditMeetingForm((f) => ({ ...f, minutes: e.target.value }))}
                placeholder="Official meeting minutes..."
                rows={5}
                className="bg-slate-800 border-slate-700 text-white resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditMeetingOpen(false)} className="border-slate-600 text-slate-300">Cancel</Button>
              <Button
                onClick={handleUpdateMeeting}
                disabled={updateMeeting.isPending}
                className="bg-blue-700 hover:bg-blue-600 text-white"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Resolution Dialog */}
      <Dialog open={createResOpen} onOpenChange={setCreateResOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Resolution</DialogTitle>
            <DialogDescription className="text-slate-400">Record a formal resolution for this meeting.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Resolution No.</Label>
                <Input
                  value={resForm.resolutionNumber}
                  onChange={(e) => setResForm((f) => ({ ...f, resolutionNumber: e.target.value }))}
                  placeholder="e.g. RES-2025-01"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Status</Label>
                <Select value={resForm.status} onValueChange={(v) => setResForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {Object.entries(RESOLUTION_STATUS).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-slate-300">{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Title *</Label>
              <Input
                value={resForm.title}
                onChange={(e) => setResForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Resolution title"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Description</Label>
              <Textarea
                value={resForm.description}
                onChange={(e) => setResForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="bg-slate-800 border-slate-700 text-white resize-none"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">For</Label>
                <Input type="number" min={0} value={resForm.votesFor} onChange={(e) => setResForm((f) => ({ ...f, votesFor: e.target.value }))} className="bg-slate-800 border-slate-700 text-white text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Against</Label>
                <Input type="number" min={0} value={resForm.votesAgainst} onChange={(e) => setResForm((f) => ({ ...f, votesAgainst: e.target.value }))} className="bg-slate-800 border-slate-700 text-white text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Abstain</Label>
                <Input type="number" min={0} value={resForm.votesAbstain} onChange={(e) => setResForm((f) => ({ ...f, votesAbstain: e.target.value }))} className="bg-slate-800 border-slate-700 text-white text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Method</Label>
                <Select value={resForm.votingMethod} onValueChange={(v) => setResForm((f) => ({ ...f, votingMethod: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {VOTING_METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="text-slate-300 text-xs">{m.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Implementation Deadline</Label>
              <Input
                type="date"
                value={resForm.implementationDeadline}
                onChange={(e) => setResForm((f) => ({ ...f, implementationDeadline: e.target.value }))}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateResOpen(false)} className="border-slate-600 text-slate-300">Cancel</Button>
              <Button
                onClick={handleCreateResolution}
                disabled={!resForm.title || createRes.isPending}
                className="bg-purple-700 hover:bg-purple-600 text-white"
              >
                Add Resolution
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Resolution Dialog */}
      <Dialog open={!!editResolution} onOpenChange={(o) => !o && setEditResolution(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Resolution</DialogTitle>
          </DialogHeader>
          {editResolution && (
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Title</Label>
                <Input
                  value={editResolution.title ?? ""}
                  onChange={(e) => setEditResolution((r) => r ? { ...r, title: e.target.value } : r)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Status</Label>
                <Select
                  value={editResolution.status ?? "proposed"}
                  onValueChange={(v) => setEditResolution((r) => r ? { ...r, status: v } : r)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {Object.entries(RESOLUTION_STATUS).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-slate-300">{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Description</Label>
                <Textarea
                  value={editResolution.description ?? ""}
                  onChange={(e) => setEditResolution((r) => r ? { ...r, description: e.target.value } : r)}
                  rows={3}
                  className="bg-slate-800 border-slate-700 text-white resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Implementation Notes</Label>
                <Textarea
                  value={editResolution.implementationNotes ?? ""}
                  onChange={(e) => setEditResolution((r) => r ? { ...r, implementationNotes: e.target.value } : r)}
                  rows={2}
                  className="bg-slate-800 border-slate-700 text-white resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditResolution(null)} className="border-slate-600 text-slate-300">Cancel</Button>
                <Button
                  onClick={handleUpdateResolution}
                  disabled={updateRes.isPending}
                  className="bg-blue-700 hover:bg-blue-600 text-white"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Meeting Detail view ────────────────────────────────────────────────────

function MeetingDetail({
  meeting,
  resolutions,
  isLoading,
  canEdit,
  onBack,
  onEdit,
  onStatusChange,
  onDelete,
  onAddResolution,
  onEditResolution,
  onDeleteResolution,
  updatingStatus,
}: {
  meeting: GovernanceMeeting | undefined;
  resolutions: GovernanceResolution[];
  isLoading: boolean;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onStatusChange: (s: string) => void;
  onDelete: () => void;
  onAddResolution: () => void;
  onEditResolution: (r: GovernanceResolution) => void;
  onDeleteResolution: (id: string) => void;
  updatingStatus: boolean;
}) {
  if (isLoading || !meeting) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64 bg-slate-700" />
        <Skeleton className="h-32 w-full bg-slate-700/50 rounded-lg" />
        <Skeleton className="h-48 w-full bg-slate-700/50 rounded-lg" />
      </div>
    );
  }

  const status = meeting.status ?? "scheduled";
  const nextStatuses: Record<string, string[]> = {
    scheduled: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  const transitions = nextStatuses[status] ?? [];
  const transitionLabels: Record<string, string> = {
    in_progress: "Start Meeting",
    completed: "Complete Meeting",
    cancelled: "Cancel",
  };

  return (
    <div className="space-y-6 p-6">
      {/* Back + title */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-white mb-4 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to meetings
        </button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-white">{meeting.title}</h1>
              <StatusBadge status={status} map={MEETING_STATUS} />
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {meeting.meetingDate ? format(parseISO(meeting.meetingDate + "T00:00:00"), "EEEE, d MMMM yyyy") : "—"}
                {meeting.meetingTime && ` · ${meeting.meetingTime}`}
              </span>
              {meeting.venue && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {meeting.venue}
                </span>
              )}
              {(meeting as any).projectName && (
                <span className="text-blue-400">{(meeting as any).projectName}</span>
              )}
              {meeting.totalAttendees && (
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {meeting.totalAttendees} attendees
                  {meeting.quorumMet !== null && meeting.quorumMet !== undefined && (
                    <span className={cn("ml-1", meeting.quorumMet ? "text-emerald-400" : "text-red-400")}>
                      · Quorum {meeting.quorumMet ? "met" : "not met"}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 flex-wrap">
              {transitions.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  onClick={() => onStatusChange(t)}
                  disabled={updatingStatus}
                  variant={t === "cancelled" ? "outline" : "default"}
                  className={cn(
                    t === "completed" && "bg-emerald-700 hover:bg-emerald-600 text-white",
                    t === "in_progress" && "bg-blue-700 hover:bg-blue-600 text-white",
                    t === "cancelled" && "border-red-800 text-red-400 hover:bg-red-900/30",
                  )}
                >
                  <ArrowRight className="h-3.5 w-3.5 mr-1" />
                  {transitionLabels[t] ?? t}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                className="border-slate-600 text-slate-300"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onDelete}
                className="border-red-800 text-red-400 hover:bg-red-900/30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Agenda + Minutes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-1">
              <FileText className="h-4 w-4" />Agenda
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meeting.agenda ? (
              <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">{meeting.agenda}</p>
            ) : (
              <p className="text-sm text-slate-500 italic">No agenda recorded</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-1">
              <FileText className="h-4 w-4" />Minutes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meeting.minutes ? (
              <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">{meeting.minutes}</p>
            ) : (
              <p className="text-sm text-slate-500 italic">
                {status === "completed" ? "No minutes recorded" : "Minutes will be recorded after meeting completion"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resolutions */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-1">
            <Vote className="h-4 w-4" />
            Resolutions ({resolutions.length})
          </CardTitle>
          {canEdit && (
            <Button
              size="sm"
              onClick={onAddResolution}
              className="bg-purple-700 hover:bg-purple-600 text-white h-7 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Resolution
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {resolutions.length === 0 ? (
            <div className="py-10 text-center">
              <Vote className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No resolutions recorded</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {resolutions.map((r, idx) => (
                <div key={r.id} className="p-4 hover:bg-slate-700/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.resolutionNumber && (
                          <span className="text-xs font-mono text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
                            {r.resolutionNumber}
                          </span>
                        )}
                        <p className="text-white text-sm font-medium">{r.title}</p>
                        <StatusBadge status={r.status ?? "proposed"} map={RESOLUTION_STATUS} />
                      </div>
                      {r.description && (
                        <p className="text-sm text-slate-400 mt-1 leading-relaxed">{r.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                        {(r.votesFor !== null || r.votesAgainst !== null) && (
                          <span className="flex items-center gap-1">
                            <Vote className="h-3 w-3" />
                            <span className="text-emerald-400">{r.votesFor ?? 0}✓</span>
                            {" · "}
                            <span className="text-red-400">{r.votesAgainst ?? 0}✗</span>
                            {r.votesAbstain ? (` · ${r.votesAbstain} abstain`) : ""}
                            {r.votingMethod && ` · ${r.votingMethod.replace(/_/g, " ")}`}
                          </span>
                        )}
                        {r.implementationDeadline && (
                          <span>Deadline: {format(parseISO(r.implementationDeadline + "T00:00:00"), "d MMM yyyy")}</span>
                        )}
                        {r.recordedByName && <span>by {r.recordedByName}</span>}
                      </div>
                      {r.implementationNotes && (
                        <p className="text-xs text-slate-500 mt-1 italic">{r.implementationNotes}</p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => onEditResolution(r)}
                          className="p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteResolution(r.id!)}
                          className="p-1.5 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {meeting.completedByName && meeting.completedAt && (
        <p className="text-xs text-slate-500 text-center">
          Completed by {meeting.completedByName} on {format(parseISO(meeting.completedAt), "d MMM yyyy, HH:mm")}
        </p>
      )}
    </div>
  );
}
