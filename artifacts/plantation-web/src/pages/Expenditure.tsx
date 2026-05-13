import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListExpenditures,
  useCreateExpenditure,
  useUpdateExpenditure,
  useDeleteExpenditure,
  useSubmitExpenditure,
  useApproveExpenditure,
  useRejectExpenditure,
  useGetExpenditureSummary,
  useListProjects,
  getListExpendituresQueryKey,
  getGetExpenditureSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  ExpenditureEntry,
  Project,
  ListExpendituresParams,
  GetExpenditureSummaryParams,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Plus,
  Search,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Banknote,
  TrendingDown,
  Upload,
  AlertTriangle,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "labor", label: "Labor" },
  { value: "fertilizer", label: "Fertilizer" },
  { value: "transport", label: "Transport" },
  { value: "machinery", label: "Machinery" },
  { value: "maintenance", label: "Maintenance" },
  { value: "consumables", label: "Consumables" },
  { value: "plantation_operations", label: "Plantation Operations" },
  { value: "miscellaneous", label: "Miscellaneous" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  labor: "#6366f1",
  fertilizer: "#22c55e",
  transport: "#f59e0b",
  machinery: "#3b82f6",
  maintenance: "#ec4899",
  consumables: "#14b8a6",
  plantation_operations: "#a855f7",
  miscellaneous: "#94a3b8",
};

const STATUS_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  draft: {
    label: "Draft",
    color: "bg-slate-700 text-slate-200",
    icon: <FileText className="h-3 w-3" />,
  },
  pending_review: {
    label: "Pending Review",
    color: "bg-amber-800/60 text-amber-200",
    icon: <Clock className="h-3 w-3" />,
  },
  approved: {
    label: "Approved",
    color: "bg-emerald-800/60 text-emerald-200",
    icon: <CheckCircle className="h-3 w-3" />,
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-800/60 text-red-200",
    icon: <XCircle className="h-3 w-3" />,
  },
};

const LIFECYCLE_LABELS: Record<string, string> = {
  prematurity: "Pre-maturity",
  mature_production: "Mature Production",
  closed: "Closed",
};

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function categoryLabel(cat: string): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    color: "bg-slate-700 text-slate-200",
    icon: null,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon,
  accent,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400 mb-1">{title}</p>
            <p className={`text-xl font-bold ${accent}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-slate-700/50 ${accent}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Expenditure Form Dialog ───────────────────────────────────────────────────

interface FormState {
  projectId: string;
  category: string;
  amount: string;
  expenditureDate: string;
  description: string;
  paidByName: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  projectId: "",
  category: "",
  amount: "",
  expenditureDate: new Date().toISOString().slice(0, 10),
  description: "",
  paidByName: "",
  notes: "",
};

function ExpenditureFormDialog({
  open,
  onClose,
  editing,
  preselectedProjectId,
}: {
  open: boolean;
  onClose: () => void;
  editing?: ExpenditureEntry | null;
  preselectedProjectId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: projectsData } = useListProjects();
  const projects: Project[] = projectsData ?? [];

  const [form, setForm] = useState<FormState>(() =>
    editing
      ? {
          projectId: editing.projectId,
          category: editing.category,
          amount: String(editing.amount),
          expenditureDate: editing.expenditureDate,
          description: editing.description,
          paidByName: editing.paidByName ?? "",
          notes: editing.notes ?? "",
        }
      : { ...EMPTY_FORM, projectId: preselectedProjectId ?? "" },
  );
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
  };

  const createMutation = useCreateExpenditure({
    mutation: {
      onSuccess: () => { invalidate(); onClose(); },
      onError: (e: unknown) =>
        setFormError((e as Error).message ?? "Failed to save expenditure."),
    },
  });

  const updateMutation = useUpdateExpenditure({
    mutation: {
      onSuccess: () => { invalidate(); onClose(); },
      onError: (e: unknown) =>
        setFormError((e as Error).message ?? "Failed to update expenditure."),
    },
  });

  function field(k: keyof FormState, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setFormError(null);
  }

  function handleSubmit() {
    if (!form.projectId || !form.category || !form.amount || !form.expenditureDate || !form.description) {
      setFormError("Project, category, amount, date, and description are required.");
      return;
    }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setFormError("Amount must be a positive number.");
      return;
    }
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: {
          category: form.category,
          amount,
          expenditureDate: form.expenditureDate,
          description: form.description,
          paidByName: form.paidByName || undefined,
          notes: form.notes || undefined,
        },
      });
    } else {
      createMutation.mutate({
        data: {
          projectId: form.projectId,
          category: form.category,
          amount,
          expenditureDate: form.expenditureDate,
          description: form.description,
          paidByName: form.paidByName || undefined,
          notes: form.notes || undefined,
        },
      });
    }
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit Expenditure" : "Record Expenditure"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {!editing && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Project *</label>
              <Select value={form.projectId} onValueChange={(v) => field("projectId", v)}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-100">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {projects.filter((p) => !!p.id).map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-slate-100">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Category *</label>
              <Select value={form.category} onValueChange={(v) => field("category", v)}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-100">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value} className="text-slate-100">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Amount (INR) *</label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={form.amount}
                onChange={(e) => field("amount", e.target.value)}
                className="bg-slate-700 border-slate-600 text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Expenditure Date *</label>
            <Input
              type="date"
              value={form.expenditureDate}
              onChange={(e) => field("expenditureDate", e.target.value)}
              className="bg-slate-700 border-slate-600 text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Description *</label>
            <Input
              placeholder="What was this expenditure for?"
              value={form.description}
              onChange={(e) => field("description", e.target.value)}
              className="bg-slate-700 border-slate-600 text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Paid By</label>
            <Input
              placeholder="Person / vendor who paid or received payment"
              value={form.paidByName}
              onChange={(e) => field("paidByName", e.target.value)}
              className="bg-slate-700 border-slate-600 text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Notes</label>
            <Input
              placeholder="Additional notes (optional)"
              value={form.notes}
              onChange={(e) => field("notes", e.target.value)}
              className="bg-slate-700 border-slate-600 text-slate-100"
            />
          </div>

          {/* Invoice upload placeholder */}
          <div className="border border-dashed border-slate-600 rounded-lg p-3 text-center">
            <Upload className="h-4 w-4 text-slate-500 mx-auto mb-1" />
            <p className="text-xs text-slate-500">Invoice / Receipt upload — coming soon</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Attach PDF or image of supporting document
            </p>
          </div>

          {formError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {formError}
            </p>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isBusy}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isBusy ? "Saving…" : editing ? "Save Changes" : "Record Expenditure"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

function RejectDialog({
  open,
  entry,
  onClose,
}: {
  open: boolean;
  entry: ExpenditureEntry | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rejectMutation = useRejectExpenditure({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
        onClose();
        setNotes("");
      },
      onError: (e: unknown) =>
        setError((e as Error).message ?? "Failed to reject."),
    },
  });

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-slate-100 max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject Expenditure</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400 mt-1">
          Provide a reason — it will be visible to the person who recorded this entry.
        </p>
        <Input
          placeholder="Reason for rejection…"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setError(null);
          }}
          className="mt-3 bg-slate-700 border-slate-600 text-slate-100"
        />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        <DialogFooter className="mt-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-slate-400"
          >
            Cancel
          </Button>
          <Button
            className="bg-red-700 hover:bg-red-600 text-white"
            disabled={rejectMutation.isPending}
            onClick={() => {
              if (!notes.trim()) {
                setError("Rejection reason is required.");
                return;
              }
              rejectMutation.mutate({ id: entry.id, data: { notes } });
            }}
          >
            {rejectMutation.isPending ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Expenditure Row ───────────────────────────────────────────────────────────

function ExpenditureRow({
  entry,
  canApprove,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onReject,
}: {
  entry: ExpenditureEntry;
  canApprove: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (e: ExpenditureEntry) => void;
  onDelete: (e: ExpenditureEntry) => void;
  onReject: (e: ExpenditureEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
  };

  const submitMutation = useSubmitExpenditure({
    mutation: { onSuccess: invalidate },
  });
  const approveMutation = useApproveExpenditure({
    mutation: { onSuccess: invalidate },
  });

  return (
    <>
      <TableRow
        className="border-slate-700 hover:bg-slate-750 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell className="text-slate-300 font-mono text-xs pl-4">
          {entry.expenditureDate}
        </TableCell>
        <TableCell>
          <span
            className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{
              backgroundColor: CATEGORY_COLORS[entry.category] ?? "#94a3b8",
            }}
          >
            {categoryLabel(entry.category)}
          </span>
        </TableCell>
        <TableCell className="text-slate-300 max-w-[220px] truncate">
          {entry.description}
        </TableCell>
        <TableCell className="text-slate-200 text-right font-semibold">
          {formatINR(entry.amount)}
        </TableCell>
        <TableCell>
          <StatusBadge status={entry.verificationStatus} />
        </TableCell>
        <TableCell className="text-slate-400 text-xs">
          {entry.projectName ?? "—"}
        </TableCell>
        <TableCell className="text-right pr-3">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400 inline" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400 inline" />
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="border-slate-700 bg-slate-800/60">
          <TableCell colSpan={7} className="py-3 px-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-3">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Paid By</p>
                <p className="text-slate-300">{entry.paidByName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Recorded By</p>
                <p className="text-slate-300">{entry.recordedByName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Lifecycle Phase</p>
                <p className="text-slate-300">
                  {LIFECYCLE_LABELS[entry.lifecyclePhaseSnapshot] ??
                    entry.lifecyclePhaseSnapshot}
                </p>
              </div>
              {entry.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 mb-0.5">Notes</p>
                  <p className="text-slate-300">{entry.notes}</p>
                </div>
              )}
              {entry.verifiedByName && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">
                    {entry.verificationStatus === "approved"
                      ? "Approved By"
                      : "Reviewed By"}
                  </p>
                  <p className="text-slate-300">{entry.verifiedByName}</p>
                </div>
              )}
              {entry.verifierNotes && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 mb-0.5">Reviewer Notes</p>
                  <p
                    className={
                      entry.verificationStatus === "rejected"
                        ? "text-red-400"
                        : "text-slate-300"
                    }
                  >
                    {entry.verifierNotes}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Invoice / Receipt</p>
                <p className="text-slate-500 text-xs italic">
                  {entry.invoiceObjectPath ? "Attached" : "Not uploaded"}
                </p>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              {canEdit && entry.verificationStatus === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(entry);
                  }}
                >
                  Edit
                </Button>
              )}
              {entry.verificationStatus === "draft" && (
                <Button
                  size="sm"
                  className="bg-indigo-700 hover:bg-indigo-600 text-white text-xs"
                  disabled={submitMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    submitMutation.mutate({ id: entry.id });
                  }}
                >
                  Submit for Review
                </Button>
              )}
              {canApprove && entry.verificationStatus === "pending_review" && (
                <>
                  <Button
                    size="sm"
                    className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs"
                    disabled={approveMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      approveMutation.mutate({ id: entry.id, data: {} });
                    }}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-800 hover:bg-red-700 text-white text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReject(entry);
                    }}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Reject
                  </Button>
                </>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400 hover:text-red-300 hover:bg-slate-700 text-xs ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(entry);
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Expenditure() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();

  const canCreate =
    role === "admin" ||
    role === "developer" ||
    role === "employee" ||
    role === "operational_staff";
  const canApprove = role === "admin" || role === "developer";
  const canDelete = role === "admin";
  const canViewSummary =
    role === "admin" ||
    role === "developer" ||
    role === "landowner" ||
    role === "investor";

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterProject, setFilterProject] = useState<string>(
    selectedProjectId ?? "__all__",
  );
  const [filterCategory, setFilterCategory] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [search, setSearch] = useState("");

  const filtersActive =
    filterProject !== "__all__" ||
    filterCategory !== "__all__" ||
    filterStatus !== "__all__" ||
    !!filterDateFrom ||
    !!filterDateTo ||
    !!search;

  const listParams = useMemo((): ListExpendituresParams => {
    const p: ListExpendituresParams = {};
    if (filterProject !== "__all__") p.projectId = filterProject;
    if (filterCategory !== "__all__") p.category = filterCategory;
    if (filterStatus !== "__all__") p.status = filterStatus;
    if (filterDateFrom) p.dateFrom = filterDateFrom;
    if (filterDateTo) p.dateTo = filterDateTo;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [filterProject, filterCategory, filterStatus, filterDateFrom, filterDateTo, search]);

  const { data: listData, isLoading } = useListExpenditures(listParams);
  const expenditures = listData?.expenditures ?? [];

  const summaryParams = useMemo((): GetExpenditureSummaryParams => {
    const p: GetExpenditureSummaryParams = {};
    if (filterProject !== "__all__") p.projectId = filterProject;
    return p;
  }, [filterProject]);

  const { data: summaryData } = useGetExpenditureSummary(summaryParams, {
    query: {
      enabled: canViewSummary,
      queryKey: getGetExpenditureSummaryQueryKey(summaryParams),
    },
  });
  const summary = summaryData ?? null;

  const { data: projectsData } = useListProjects();
  const projects: Project[] = projectsData ?? [];

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ExpenditureEntry | null>(null);
  const [rejectEntry, setRejectEntry] = useState<ExpenditureEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ExpenditureEntry | null>(null);

  const queryClient = useQueryClient();
  const deleteMutation = useDeleteExpenditure({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetExpenditureSummaryQueryKey(),
        });
        setDeleteEntry(null);
      },
    },
  });

  // ── Category breakdown chart data ──────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!summary) return [];
    const totals: Record<string, number> = {};
    for (const proj of summary.projects) {
      for (const cat of proj.categoryBreakdown) {
        totals[cat.category] = (totals[cat.category] ?? 0) + cat.amount;
      }
    }
    return CATEGORIES.map((c) => ({
      name: c.label,
      amount: totals[c.value] ?? 0,
      key: c.value,
    })).filter((d) => d.amount > 0);
  }, [summary]);

  const pendingCount = expenditures.filter(
    (e) => e.verificationStatus === "pending_review",
  ).length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Operational Expenditure
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Day-to-day plantation running costs — entirely separate from
            ownership contributions
          </p>
        </div>
        {canCreate && (
          <Button
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Record Expenditure
          </Button>
        )}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      {canViewSummary && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            title="Total Expenditure"
            value={formatINR(summary.totals.totalAmount)}
            sub={`${summary.totals.count} record${summary.totals.count !== 1 ? "s" : ""}`}
            icon={<TrendingDown className="h-5 w-5" />}
            accent="text-slate-200"
          />
          <KpiCard
            title="Approved"
            value={formatINR(summary.totals.approvedAmount)}
            icon={<CheckCircle className="h-5 w-5" />}
            accent="text-emerald-400"
          />
          <KpiCard
            title="Pending Review"
            value={formatINR(summary.totals.pendingAmount)}
            icon={<Clock className="h-5 w-5" />}
            accent="text-amber-400"
          />
          <KpiCard
            title="Projects Tracked"
            value={String(summary.projects.filter((p) => p.count > 0).length)}
            sub="with expenditure records"
            icon={<Banknote className="h-5 w-5" />}
            accent="text-indigo-400"
          />
        </div>
      )}

      {/* ── Charts + per-project table ──────────────────────────────────────── */}
      {canViewSummary && summary && summary.totals.count > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {chartData.length > 0 && (
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-300">
                  Expenditure by Category
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) =>
                        v >= 100000
                          ? `${(v / 100000).toFixed(1)}L`
                          : v >= 1000
                          ? `${(v / 1000).toFixed(0)}K`
                          : String(v)
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: "6px",
                        color: "#f1f5f9",
                        fontSize: "12px",
                      }}
                      formatter={(v: number) => [formatINR(v), "Amount"]}
                    />
                    <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={CATEGORY_COLORS[entry.key] ?? "#94a3b8"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300">
                Project-wise Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-400 text-xs py-2 pl-4">
                      Project
                    </TableHead>
                    <TableHead className="text-slate-400 text-xs py-2 text-right">
                      Total
                    </TableHead>
                    <TableHead className="text-slate-400 text-xs py-2 text-right">
                      Approved
                    </TableHead>
                    <TableHead className="text-slate-400 text-xs py-2 text-right pr-4">
                      Records
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.projects
                    .filter((p) => p.count > 0)
                    .sort((a, b) => b.totalAmount - a.totalAmount)
                    .map((p) => (
                      <TableRow key={p.projectId} className="border-slate-700">
                        <TableCell className="text-slate-300 text-sm py-2 pl-4">
                          {p.projectName}
                        </TableCell>
                        <TableCell className="text-slate-200 text-sm text-right py-2">
                          {formatINR(p.totalAmount)}
                        </TableCell>
                        <TableCell className="text-emerald-400 text-sm text-right py-2">
                          {formatINR(p.approvedAmount)}
                        </TableCell>
                        <TableCell className="text-slate-400 text-sm text-right py-2 pr-4">
                          {p.count}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Pending review alert ─────────────────────────────────────────────── */}
      {canApprove && pendingCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-2.5 text-sm text-amber-300">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            <strong>{pendingCount}</strong> expenditure
            {pendingCount !== 1 ? "s" : ""} awaiting your review.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-amber-300 hover:text-amber-200 hover:bg-amber-900/40 text-xs"
            onClick={() => setFilterStatus("pending_review")}
          >
            Show pending
          </Button>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search description, project…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 bg-slate-700 border-slate-600 text-slate-100"
              />
            </div>

            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-100">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="__all__" className="text-slate-100">
                  All projects
                </SelectItem>
                {projects.filter((p) => !!p.id).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-100">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-100">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="__all__" className="text-slate-100">
                  All categories
                </SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem
                    key={c.value}
                    value={c.value}
                    className="text-slate-100"
                  >
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-100">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="__all__" className="text-slate-100">
                  All statuses
                </SelectItem>
                <SelectItem value="draft" className="text-slate-100">
                  Draft
                </SelectItem>
                <SelectItem value="pending_review" className="text-slate-100">
                  Pending Review
                </SelectItem>
                <SelectItem value="approved" className="text-slate-100">
                  Approved
                </SelectItem>
                <SelectItem value="rejected" className="text-slate-100">
                  Rejected
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-1">
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="bg-slate-700 border-slate-600 text-slate-100 text-xs"
                title="From date"
              />
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="bg-slate-700 border-slate-600 text-slate-100 text-xs"
                title="To date"
              />
            </div>
          </div>

          {filtersActive && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-slate-500">Filters active —</span>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-indigo-400 hover:text-indigo-300 h-6 px-2"
                onClick={() => {
                  setFilterProject("__all__");
                  setFilterCategory("__all__");
                  setFilterStatus("__all__");
                  setFilterDateFrom("");
                  setFilterDateTo("");
                  setSearch("");
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Expenditure list ─────────────────────────────────────────────────── */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-slate-300">
              Expenditure Records
            </CardTitle>
            <span className="text-xs text-slate-500">
              {isLoading
                ? "Loading…"
                : `${expenditures.length} record${expenditures.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              Loading expenditures…
            </div>
          ) : expenditures.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              {filtersActive
                ? "No records match the current filters."
                : "No expenditure records yet."}
              {canCreate && !filtersActive && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                    onClick={() => setAddOpen(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Record first expenditure
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400 text-xs pl-4">
                    Date
                  </TableHead>
                  <TableHead className="text-slate-400 text-xs">
                    Category
                  </TableHead>
                  <TableHead className="text-slate-400 text-xs">
                    Description
                  </TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">
                    Amount
                  </TableHead>
                  <TableHead className="text-slate-400 text-xs">
                    Status
                  </TableHead>
                  <TableHead className="text-slate-400 text-xs">
                    Project
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenditures.map((e) => (
                  <ExpenditureRow
                    key={e.id}
                    entry={e}
                    canApprove={canApprove}
                    canEdit={canCreate}
                    canDelete={canDelete}
                    onEdit={setEditEntry}
                    onDelete={setDeleteEntry}
                    onReject={setRejectEntry}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      <ExpenditureFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        preselectedProjectId={
          filterProject !== "__all__" ? filterProject : null
        }
      />
      <ExpenditureFormDialog
        open={!!editEntry}
        onClose={() => setEditEntry(null)}
        editing={editEntry}
      />
      <RejectDialog
        open={!!rejectEntry}
        entry={rejectEntry}
        onClose={() => setRejectEntry(null)}
      />

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteEntry}
        onOpenChange={(v) => !v && setDeleteEntry(null)}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-100 max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Expenditure?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-400 mt-1">
            This will remove the record from reports. Financial records are
            retained for audit but will no longer be visible.
          </p>
          <DialogFooter className="mt-4">
            <Button
              variant="ghost"
              onClick={() => setDeleteEntry(null)}
              className="text-slate-400"
            >
              Cancel
            </Button>
            <Button
              className="bg-red-700 hover:bg-red-600 text-white"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteEntry && deleteMutation.mutate({ id: deleteEntry.id })
              }
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
