import { useState } from "react";
import { format, isPast, parseISO } from "date-fns";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useListWorkAssignments,
  useCreateWorkAssignment,
  useActivateWorkAssignment,
  useCompleteWorkAssignment,
  useArchiveWorkAssignment,
  useRestoreWorkAssignment,
  useGetWorkAssignmentAudit,
  useListProjects,
  useListStores,
  getListWorkAssignmentsQueryKey,
} from "@workspace/api-client-react";
import {
  Users,
  Plus,
  Eye,
  UserCheck,
  ShoppingCart,
  ShieldCheck,
  Briefcase,
  Loader2,
  AlertTriangle,
  History,
  ArchiveRestore,
  CheckCircle2,
  XCircle,
  Archive,
  PhoneCall,
  ChevronDown,
  Info,
  Filter,
  Building2,
  MapPin,
  Receipt,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PersonMasterSelector, type PersonSummary } from "@/components/PersonMasterSelector";
import { useRole } from "@/contexts/RoleContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type AssignmentType =
  | "store_entry"
  | "observer"
  | "store_sale_operator"
  | "general_responsibility";

type AssignmentStatus = "pending" | "active" | "completed" | "expired" | "archived";

// ── Config ────────────────────────────────────────────────────────────────────

const ASSIGNMENT_TYPE_CONFIG: Record<
  AssignmentType,
  {
    label: string;
    icon: React.ElementType;
    color: string;
    badgeColor: string;
    description: string;
  }
> = {
  store_entry: {
    label: "Store Entry",
    icon: Building2,
    color: "text-amber-300",
    badgeColor: "bg-amber-900/30 text-amber-300 border-amber-800/50",
    description: "Authorised to submit store-in entries at a specific location",
  },
  observer: {
    label: "Observer",
    icon: Eye,
    color: "text-purple-300",
    badgeColor: "bg-purple-900/30 text-purple-300 border-purple-800/50",
    description: "Observes project operations over a defined date range",
  },
  store_sale_operator: {
    label: "Store Sale Operator",
    icon: ShoppingCart,
    color: "text-emerald-300",
    badgeColor: "bg-emerald-900/30 text-emerald-300 border-emerald-800/50",
    description: "Authorised to perform sales within a specific store",
  },
  general_responsibility: {
    label: "General Responsibility",
    icon: Briefcase,
    color: "text-blue-300",
    badgeColor: "bg-blue-900/30 text-blue-300 border-blue-800/50",
    description: "Accountability and tracking assignment",
  },
};

const STATUS_CONFIG: Record<
  AssignmentStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  pending: {
    label: "Pending",
    color: "bg-yellow-900/30 text-yellow-300 border-yellow-800/40",
    icon: Info,
  },
  active: {
    label: "Active",
    color: "bg-emerald-900/30 text-emerald-300 border-emerald-800/40",
    icon: CheckCircle2,
  },
  completed: {
    label: "Completed",
    color: "bg-slate-700/40 text-slate-400 border-slate-600/40",
    icon: CheckCircle2,
  },
  expired: {
    label: "Expired",
    color: "bg-red-900/20 text-red-400 border-red-800/30",
    icon: XCircle,
  },
  archived: {
    label: "Archived",
    color: "bg-slate-800/60 text-slate-500 border-slate-700/30",
    icon: Archive,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return format(new Date(d), "d MMM yyyy");
  } catch {
    return d;
  }
}

function isExpired(endDate: string | null | undefined, status: string) {
  if (status !== "active") return false;
  if (!endDate) return false;
  try {
    return isPast(parseISO(endDate));
  } catch {
    return false;
  }
}

// ── Assignment summary builder ────────────────────────────────────────────────

function AssignmentSummaryPills({ a }: { a: any }) {
  const type = a.assignmentType as AssignmentType;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {type === "observer" && a.projectCoverage && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
          {a.projectCoverage === "all_projects" ? "All Projects" : "Selected Projects"}
        </span>
      )}
      {a.projectNameSnapshot && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
          {a.projectNameSnapshot}
        </span>
      )}
      {a.storeNameSnapshot && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-400/70 border border-slate-700 flex items-center gap-0.5">
          <Building2 className="w-2.5 h-2.5" />
          {a.storeNameSnapshot}
        </span>
      )}
      {a.place && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-0.5">
          <MapPin className="w-2.5 h-2.5" />
          {a.place}
        </span>
      )}
      {a.expenditurePermission && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400 border border-orange-800/40 flex items-center gap-0.5">
          <Receipt className="w-2.5 h-2.5" />
          Expenditure
        </span>
      )}
      {(a.startDate || a.endDate) && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
          {fmtDate(a.startDate)} → {a.endDate ? fmtDate(a.endDate) : "open"}
        </span>
      )}
    </div>
  );
}

// ── Audit History Dialog ──────────────────────────────────────────────────────

function AuditHistoryDialog({
  open,
  onClose,
  assignmentId,
  personName,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  personName: string;
}) {
  const auditQ = useGetWorkAssignmentAudit(assignmentId, {
    query: { enabled: open, queryKey: ["work-assignment-audit", assignmentId] },
  });
  const events: any[] = (auditQ.data as any) ?? [];

  const EVENT_LABELS: Record<string, string> = {
    created: "Created",
    activated: "Activated",
    edited: "Edited",
    completed: "Completed",
    expired: "Expired",
    archived: "Archived",
    restored: "Restored",
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <History className="w-4 h-4 text-slate-400" />
            Assignment History — {personName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {auditQ.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading audit…
            </div>
          ) : events.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">No audit events recorded.</p>
          ) : (
            events.map((e: any) => (
              <div
                key={e.id}
                className="flex items-start gap-3 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2.5"
              >
                <div className="mt-0.5">
                  <span className="text-xs font-medium text-slate-300">
                    {EVENT_LABELS[e.eventType] ?? e.eventType}
                  </span>
                  {e.oldStatus && e.newStatus && (
                    <span className="text-xs text-slate-500 ml-2">
                      {e.oldStatus} → {e.newStatus}
                    </span>
                  )}
                  {e.reason && (
                    <p className="text-xs text-slate-500 mt-0.5 italic">{e.reason}</p>
                  )}
                </div>
                <div className="ml-auto text-right shrink-0">
                  <p className="text-[10px] text-slate-500">
                    {e.performedByName ?? "System"}
                  </p>
                  <p className="text-[10px] text-slate-600">
                    {e.createdAt ? format(new Date(e.createdAt), "d MMM yy, HH:mm") : "—"}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Lifecycle Action Dialog (reason prompt) ───────────────────────────────────

function ActionDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmClass,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmClass: string;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <p className="text-slate-400 text-sm">{description}</p>
        <div>
          <Label className="text-slate-400 text-xs mb-1.5 block">Reason (optional)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Brief reason for this action…"
            rows={2}
            className="bg-slate-900 border-slate-700 text-slate-100 text-sm resize-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} className="text-slate-400 text-sm">
            Cancel
          </Button>
          <Button
            onClick={() => { onConfirm(reason); setReason(""); }}
            disabled={isPending}
            className={`text-sm ${confirmClass}`}
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Assignment Dialog ──────────────────────────────────────────────────

function CreateAssignmentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<"type" | "form">("type");
  const [assignmentType, setAssignmentType] = useState<AssignmentType | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonSummary | null>(null);
  const [projectId, setProjectId] = useState("");
  const [projectCoverage, setProjectCoverage] = useState<"all_projects" | "selected_projects">("selected_projects");
  const [storeId, setStoreId] = useState("");
  const [place, setPlace] = useState("");
  const [expenditurePermission, setExpenditurePermission] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [initialStatus, setInitialStatus] = useState<"active" | "pending">("active");
  const [error, setError] = useState("");

  const projectsQ = useListProjects({ query: { queryKey: ["projects"] } });
  const storesQ = useListStores({}, { query: { queryKey: ["stores"] } });
  const projects: any[] = (projectsQ.data as any) ?? [];
  const stores: any[] = (storesQ.data as any) ?? [];

  const createMut = useCreateWorkAssignment();

  function reset() {
    setStep("type");
    setAssignmentType(null);
    setSelectedPerson(null);
    setProjectId("");
    setProjectCoverage("selected_projects");
    setStoreId("");
    setPlace("");
    setExpenditurePermission(false);
    setTitle("");
    setDescription("");
    setStartDate("");
    setEndDate("");
    setNotes("");
    setInitialStatus("active");
    setError("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function selectType(t: AssignmentType) {
    setAssignmentType(t);
    setStep("form");
  }

  async function handleSubmit() {
    if (!assignmentType || !selectedPerson) {
      setError("Person is required.");
      return;
    }
    if (assignmentType === "store_entry" && !storeId) {
      setError("Store is required for Store Entry assignments.");
      return;
    }
    if (assignmentType === "store_sale_operator" && !storeId) {
      setError("Store is required for Store Sale Operator assignments.");
      return;
    }
    if (assignmentType === "general_responsibility" && !title.trim()) {
      setError("Title is required for General Responsibility assignments.");
      return;
    }

    setError("");
    setCreatePending(true);
    try {
      await createMut.mutateAsync({
        data: {
          assignmentType,
          personMasterId: selectedPerson.id,
          projectId: projectId || undefined,
          projectCoverage: assignmentType === "observer" ? projectCoverage : undefined,
          storeId: storeId || undefined,
          place: place || undefined,
          expenditurePermission,
          title: title || undefined,
          description: description || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          notes: notes || undefined,
          status: initialStatus,
        } as any,
      });
      onCreated();
      handleClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to create assignment.");
    } finally {
      setCreatePending(false);
    }
  }

  if (!open) return null;

  const cfg = assignmentType ? ASSIGNMENT_TYPE_CONFIG[assignmentType] : null;
  const TypeIcon = cfg?.icon;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {TypeIcon ? (
              <TypeIcon className={`w-4 h-4 ${cfg?.color}`} />
            ) : (
              <Plus className="w-4 h-4 text-blue-400" />
            )}
            {step === "type" ? "Assign Work — Select Type" : `Assign Work — ${cfg?.label}`}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: type selection ─────────────────────────────────────── */}
        {step === "type" && (
          <div className="grid grid-cols-1 gap-2 mt-1">
            {(Object.entries(ASSIGNMENT_TYPE_CONFIG) as [AssignmentType, typeof ASSIGNMENT_TYPE_CONFIG[AssignmentType]][]).map(
              ([type, c]) => {
                const Icon = c.icon;
                return (
                  <button
                    key={type}
                    onClick={() => selectType(type)}
                    className="flex items-start gap-3 bg-slate-900/60 border border-slate-700 hover:border-slate-500 rounded-lg px-4 py-3 text-left transition-all group"
                  >
                    <Icon className={`w-5 h-5 ${c.color} mt-0.5 shrink-0`} />
                    <div>
                      <p className="text-slate-200 text-sm font-medium group-hover:text-white">{c.label}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{c.description}</p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-slate-600 ml-auto mt-1 -rotate-90" />
                  </button>
                );
              },
            )}
          </div>
        )}

        {/* ── Step 2: assignment form ────────────────────────────────────── */}
        {step === "form" && assignmentType && (
          <div className="space-y-4 mt-1">
            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            {/* Back */}
            <button
              onClick={() => { setStep("type"); setError(""); }}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
            >
              ← Change type
            </button>

            {/* Person selector */}
            <div className="[&_.bg-indigo-50]:bg-slate-900/60 [&_.border-indigo-200]:border-slate-700 [&_.text-indigo-900]:text-slate-100 [&_.text-indigo-700]:text-blue-300 [&_.text-indigo-600]:text-blue-400 [&_.bg-white]:bg-slate-900 [&_.text-slate-900]:text-slate-100 [&_.text-slate-700]:text-slate-300 [&_.text-slate-500]:text-slate-500 [&_.border-indigo-300]:border-slate-600 [&_.bg-indigo-100]:bg-slate-800 [&_.border]:border-slate-700">
              <PersonMasterSelector
                selectedPerson={selectedPerson}
                onSelect={setSelectedPerson}
                label="Assign To (Person Registry)"
              />
            </div>

            {/* Observer: project coverage */}
            {assignmentType === "observer" && (
              <div>
                <Label className="text-slate-300 mb-1.5 block text-sm">Project Coverage</Label>
                <Select value={projectCoverage} onValueChange={(v) => setProjectCoverage(v as any)}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_projects">All Projects</SelectItem>
                    <SelectItem value="selected_projects">Selected Projects</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Project (observer selected_projects, store_entry, general_responsibility) */}
            {(assignmentType === "store_entry" ||
              assignmentType === "general_responsibility" ||
              (assignmentType === "observer" && projectCoverage === "selected_projects")) && (
              <div>
                <Label className="text-slate-300 mb-1.5 block text-sm">
                  Project{assignmentType === "general_responsibility" ? " (optional)" : ""}
                </Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 text-sm">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignmentType === "general_responsibility" && (
                      <SelectItem value="">No specific project</SelectItem>
                    )}
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Store (store_entry, store_sale_operator) */}
            {(assignmentType === "store_entry" || assignmentType === "store_sale_operator") && (
              <div>
                <Label className="text-slate-300 mb-1.5 block text-sm">Store</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 text-sm">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Place (store_entry only) */}
            {assignmentType === "store_entry" && (
              <div>
                <Label className="text-slate-300 mb-1.5 block text-sm">Place (optional)</Label>
                <Input
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  placeholder="e.g. Warehouse A, North Wing"
                  className="bg-slate-900/60 border-slate-700 text-slate-100 text-sm"
                />
              </div>
            )}

            {/* Expenditure permission (store_entry) */}
            {assignmentType === "store_entry" && (
              <div className="flex items-center gap-2.5 bg-slate-900/40 border border-slate-700/50 rounded-lg px-3 py-2.5">
                <Checkbox
                  id="expPerm"
                  checked={expenditurePermission}
                  onCheckedChange={(c) => setExpenditurePermission(!!c)}
                  className="border-slate-600"
                />
                <label htmlFor="expPerm" className="text-sm text-slate-300 cursor-pointer select-none flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-orange-400" />
                  Expenditure Permission
                </label>
              </div>
            )}

            {/* Title & description (general_responsibility) */}
            {assignmentType === "general_responsibility" && (
              <>
                <div>
                  <Label className="text-slate-300 mb-1.5 block text-sm">Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Site Safety Officer, Logistics Coordinator"
                    className="bg-slate-900/60 border-slate-700 text-slate-100 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 mb-1.5 block text-sm">Description (optional)</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the responsibility…"
                    rows={2}
                    className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none text-sm"
                  />
                </div>
              </>
            )}

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 mb-1.5 block text-sm">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-900/60 border-slate-700 text-slate-100 text-sm"
                />
              </div>
              <div>
                <Label className="text-slate-300 mb-1.5 block text-sm">
                  End Date
                  {assignmentType === "observer" && (
                    <span className="text-slate-500 text-[10px] ml-1">(auto-expires)</span>
                  )}
                </Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-900/60 border-slate-700 text-slate-100 text-sm"
                />
              </div>
            </div>

            {/* Initial status */}
            <div>
              <Label className="text-slate-300 mb-1.5 block text-sm">Initial Status</Label>
              <Select value={initialStatus} onValueChange={(v) => setInitialStatus(v as any)}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active — effective immediately</SelectItem>
                  <SelectItem value="pending">Pending — activate manually later</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-slate-300 mb-1.5 block text-sm">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any context about this assignment…"
                rows={2}
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button
                variant="ghost"
                onClick={handleClose}
                className="text-slate-400 text-sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createPending || !selectedPerson}
                className="bg-blue-700 hover:bg-blue-600 text-white text-sm"
              >
                {createPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                ) : (
                  <Plus className="w-4 h-4 mr-1.5" />
                )}
                Create Assignment
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Assignment Row ────────────────────────────────────────────────────────────

function AssignmentRow({
  a,
  isAdmin,
  onRefresh,
}: {
  a: any;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const [showAudit, setShowAudit] = useState(false);
  const [actionDialog, setActionDialog] = useState<
    "activate" | "complete" | "archive" | "restore" | null
  >(null);

  const activateMut = useActivateWorkAssignment();
  const completeMut = useCompleteWorkAssignment();
  const archiveMut = useArchiveWorkAssignment();
  const restoreMut = useRestoreWorkAssignment();

  const type = a.assignmentType as AssignmentType;
  const status = a.status as AssignmentStatus;
  const expired = isExpired(a.endDate, status);

  const cfg = ASSIGNMENT_TYPE_CONFIG[type] ?? ASSIGNMENT_TYPE_CONFIG.general_responsibility;
  const statusCfg = STATUS_CONFIG[expired ? "expired" : status] ?? STATUS_CONFIG.active;
  const TypeIcon = cfg.icon;
  const StatusIcon = statusCfg.icon;

  async function doAction(action: "activate" | "complete" | "archive" | "restore", reason: string) {
    try {
      if (action === "activate") await activateMut.mutateAsync({ id: a.id, data: { reason } as any });
      if (action === "complete") await completeMut.mutateAsync({ id: a.id, data: { reason } as any });
      if (action === "archive") await archiveMut.mutateAsync({ id: a.id, data: { reason } as any });
      if (action === "restore") await restoreMut.mutateAsync({ id: a.id, data: { reason } as any });
      onRefresh();
    } catch {
      /* will show in next render */
    } finally {
      setActionDialog(null);
    }
  }

  const isPendingAction =
    activateMut.isPending ||
    completeMut.isPending ||
    archiveMut.isPending ||
    restoreMut.isPending;

  return (
    <>
      <tr className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors group">
        {/* Type */}
        <td className="px-4 py-3 w-36">
          <div className="flex items-center gap-1.5">
            <TypeIcon className={`w-3.5 h-3.5 ${cfg.color} shrink-0`} />
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
        </td>

        {/* Person */}
        <td className="px-4 py-3">
          <Link href={`/people/${a.personMasterId}`}>
            <span className="flex items-center gap-1 text-slate-100 text-sm font-medium hover:text-blue-400 cursor-pointer group">
              {a.personNameSnapshot ?? "—"}
              <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
            </span>
          </Link>
          <div className="flex items-center gap-2 mt-0.5">
            {a.personMobile && (
              <span className="text-slate-600 text-xs flex items-center gap-1">
                <PhoneCall className="w-2.5 h-2.5" /> {a.personMobile}
              </span>
            )}
          </div>
        </td>

        {/* Summary */}
        <td className="px-4 py-3">
          {a.title && <p className="text-slate-300 text-xs font-medium mb-0.5">{a.title}</p>}
          <AssignmentSummaryPills a={a} />
        </td>

        {/* Status */}
        <td className="px-4 py-3 w-24">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0.5 gap-1 ${statusCfg.color}`}
          >
            <StatusIcon className="w-2.5 h-2.5" />
            {expired ? "Expired" : statusCfg.label}
          </Badge>
        </td>

        {/* Actions */}
        {isAdmin && (
          <td className="px-3 py-3 w-28">
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {status === "pending" && (
                <button
                  onClick={() => setActionDialog("activate")}
                  disabled={isPendingAction}
                  title="Activate"
                  className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              )}
              {(status === "active" || status === "pending") && (
                <button
                  onClick={() => setActionDialog("complete")}
                  disabled={isPendingAction}
                  title="Complete"
                  className="p-1 text-slate-500 hover:text-blue-400 transition-colors"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                </button>
              )}
              {status !== "archived" && (
                <button
                  onClick={() => setActionDialog("archive")}
                  disabled={isPendingAction}
                  title="Archive"
                  className="p-1 text-slate-500 hover:text-orange-400 transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              )}
              {status === "archived" && (
                <button
                  onClick={() => setActionDialog("restore")}
                  disabled={isPendingAction}
                  title="Restore"
                  className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
                >
                  <ArchiveRestore className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setShowAudit(true)}
                title="View history"
                className="p-1 text-slate-600 hover:text-slate-300 transition-colors"
              >
                <History className="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
        )}
      </tr>

      {/* Audit dialog */}
      <AuditHistoryDialog
        open={showAudit}
        onClose={() => setShowAudit(false)}
        assignmentId={a.id}
        personName={a.personNameSnapshot ?? "—"}
      />

      {/* Action dialogs */}
      <ActionDialog
        open={actionDialog === "activate"}
        onClose={() => setActionDialog(null)}
        onConfirm={(r) => doAction("activate", r)}
        title="Activate Assignment"
        description="This will move the assignment from Pending to Active."
        confirmLabel="Activate"
        confirmClass="bg-emerald-700 hover:bg-emerald-600 text-white"
        isPending={activateMut.isPending}
      />
      <ActionDialog
        open={actionDialog === "complete"}
        onClose={() => setActionDialog(null)}
        onConfirm={(r) => doAction("complete", r)}
        title="Complete Assignment"
        description="Mark this assignment as completed. The assignment will no longer be active."
        confirmLabel="Complete"
        confirmClass="bg-blue-700 hover:bg-blue-600 text-white"
        isPending={completeMut.isPending}
      />
      <ActionDialog
        open={actionDialog === "archive"}
        onClose={() => setActionDialog(null)}
        onConfirm={(r) => doAction("archive", r)}
        title="Archive Assignment"
        description="Archive this assignment. It will be preserved for audit but removed from active views."
        confirmLabel="Archive"
        confirmClass="bg-orange-800 hover:bg-orange-700 text-white"
        isPending={archiveMut.isPending}
      />
      <ActionDialog
        open={actionDialog === "restore"}
        onClose={() => setActionDialog(null)}
        onConfirm={(r) => doAction("restore", r)}
        title="Restore Assignment"
        description="Restore this archived assignment to Active status."
        confirmLabel="Restore"
        confirmClass="bg-emerald-700 hover:bg-emerald-600 text-white"
        isPending={restoreMut.isPending}
      />
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssignWork() {
  const qc = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const [filterType, setFilterType] = useState<string>("__all__");
  const [filterStatus, setFilterStatus] = useState<string>("__active__");
  const [filterProject, setFilterProject] = useState<string>("__all__");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const projectsQ = useListProjects({ query: { queryKey: ["projects"] } });
  const projects: any[] = (projectsQ.data as any) ?? [];

  const queryParams: Record<string, string | undefined> = {};
  if (filterType !== "__all__") queryParams.assignmentType = filterType;
  if (filterStatus === "__active__") queryParams.status = "active";
  else if (filterStatus !== "__all__") queryParams.status = filterStatus;
  if (filterProject !== "__all__") queryParams.projectId = filterProject;

  const assignmentsQ = useListWorkAssignments(queryParams, {
    query: {
      queryKey: ["work-assignments", filterType, filterStatus, filterProject],
    },
  });
  const assignments: any[] = (assignmentsQ.data as any) ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListWorkAssignmentsQueryKey() });
  }

  // Counts per type for the type filter pills
  const allQ = useListWorkAssignments(
    { status: filterStatus === "__active__" ? "active" : filterStatus !== "__all__" ? filterStatus : undefined },
    { query: { queryKey: ["work-assignments-all", filterStatus] } },
  );
  const allAssignments: any[] = (allQ.data as any) ?? [];
  const countsByType = allAssignments.reduce(
    (acc: Record<string, number>, a: any) => {
      acc[a.assignmentType] = (acc[a.assignmentType] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-slate-100 text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
            Assign Work
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Unified operational assignments — determines dashboard visibility, workflow access, and contact routing
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="bg-blue-700 hover:bg-blue-600 text-white gap-2"
          >
            <Plus className="w-4 h-4" /> New Assignment
          </Button>
        )}
      </div>

      {/* ── Type filter pills ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilterType("__all__")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            filterType === "__all__"
              ? "bg-slate-700 text-white border-slate-600"
              : "bg-transparent text-slate-400 border-slate-700 hover:border-slate-500"
          }`}
        >
          <Filter className="w-3 h-3" />
          All Types
          <span className="ml-0.5 text-[10px] opacity-70">{allAssignments.length}</span>
        </button>
        {(Object.entries(ASSIGNMENT_TYPE_CONFIG) as [AssignmentType, typeof ASSIGNMENT_TYPE_CONFIG[AssignmentType]][]).map(
          ([type, c]) => {
            const Icon = c.icon;
            const count = countsByType[type] ?? 0;
            return (
              <button
                key={type}
                onClick={() => setFilterType(type === filterType ? "__all__" : type)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filterType === type
                    ? `${c.badgeColor} border-current`
                    : "bg-transparent text-slate-400 border-slate-700 hover:border-slate-500"
                }`}
              >
                <Icon className="w-3 h-3" />
                {c.label}
                {count > 0 && (
                  <span className="text-[10px] opacity-70">{count}</span>
                )}
              </button>
            );
          },
        )}
      </div>

      {/* ── Status + Project filters ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 bg-slate-900 border-slate-700 text-slate-300 text-sm h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__active__">Active only</SelectItem>
            <SelectItem value="__all__">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-48 bg-slate-900 border-slate-700 text-slate-300 text-sm h-8">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Projects</SelectItem>
            {projects.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {assignmentsQ.isFetching && (
          <RefreshCw className="w-3.5 h-3.5 text-slate-600 animate-spin" />
        )}
      </div>

      {/* ── Assignment table ─────────────────────────────────────────────── */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        {assignmentsQ.isLoading ? (
          <div className="flex items-center gap-3 py-12 justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading assignments…
          </div>
        ) : assignments.length === 0 ? (
          <div className="py-14 text-center space-y-3">
            <Users className="w-10 h-10 text-slate-700 mx-auto" />
            <p className="text-slate-500 text-sm">No assignments found.</p>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCreateDialog(true)}
                className="border-slate-700 text-slate-400 mt-2"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New Assignment
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-slate-500 font-medium text-xs">Type</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium text-xs">Person</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium text-xs">Assignment Details</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium text-xs">Status</th>
                  {isAdmin && <th className="w-28 px-3" />}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a: any) => (
                  <AssignmentRow
                    key={a.id}
                    a={a}
                    isAdmin={isAdmin}
                    onRefresh={invalidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Legend / info strip ──────────────────────────────────────────── */}
      <div className="flex items-start gap-4 flex-wrap text-xs text-slate-600 border-t border-slate-800/50 pt-3">
        <div className="flex items-center gap-1.5">
          <Info className="w-3 h-3" />
          <span>Assignments drive dashboard cards, available actions, and contact routing.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Eye className="w-3 h-3 text-purple-500" />
          <span>Observer access auto-expires after end date.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Archive className="w-3 h-3 text-orange-500/60" />
          <span>Archive preserves history — assignments are never deleted.</span>
        </div>
      </div>

      {/* Create dialog */}
      <CreateAssignmentDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={invalidate}
      />
    </div>
  );
}
