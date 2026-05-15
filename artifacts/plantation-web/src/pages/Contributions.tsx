import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListContributions,
  useCreateContribution,
  useUpdateContribution,
  useDeleteContribution,
  useSubmitContributionForVerification,
  useVerifyContribution,
  useRejectContribution,
  useGetContributionSummary,
  useListProjects,
  useListAgreements,
  getListContributionsQueryKey,
  getGetContributionSummaryQueryKey,
} from "@workspace/api-client-react";
import type { ContributionEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HandCoins,
  Plus,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Send,
  Pencil,
  Trash2,
  AlertTriangle,
  Info,
  TrendingUp,
  Landmark,
  Wrench,
  RotateCcw,
  SlidersHorizontal,
  IndianRupee,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type ContributionType =
  | "land_notional"
  | "economic_investment"
  | "operational_cost"
  | "recoverable_advance"
  | "manual_adjustment"
  | "all";

type VerificationStatus =
  | "draft"
  | "pending_verification"
  | "verified"
  | "rejected"
  | "all";

// ── Constants & helpers ────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  Exclude<ContributionType, "all">,
  {
    label: string;
    color: string;
    bg: string;
    icon: React.ComponentType<{ className?: string }>;
    affectsOwnership: boolean;
    description: string;
  }
> = {
  land_notional: {
    label: "Land Notional",
    color: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    icon: Landmark,
    affectsOwnership: true,
    description: "Landowner's land value monetised as capital contribution",
  },
  economic_investment: {
    label: "Economic Investment",
    color: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    icon: TrendingUp,
    affectsOwnership: true,
    description: "Cash or in-kind capital invested by any partner",
  },
  operational_cost: {
    label: "Operational Cost",
    color: "text-orange-700 dark:text-orange-400",
    bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800",
    icon: Wrench,
    affectsOwnership: false,
    description: "Running costs — does NOT create ownership rights",
  },
  recoverable_advance: {
    label: "Recoverable Advance",
    color: "text-purple-700 dark:text-purple-400",
    bg: "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
    icon: RotateCcw,
    affectsOwnership: true,
    description: "Bridge funding expected to be recovered from revenue",
  },
  manual_adjustment: {
    label: "Manual Adjustment",
    color: "text-slate-700 dark:text-slate-400",
    bg: "bg-slate-50 border-slate-200 dark:bg-slate-950/30 dark:border-slate-800",
    icon: SlidersHorizontal,
    affectsOwnership: true,
    description: "Admin-initiated correction or reconciliation entry",
  },
};

const STATUS_CONFIG: Record<
  Exclude<VerificationStatus, "all">,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className: string }
> = {
  draft: {
    label: "Draft",
    variant: "outline",
    className: "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
  },
  pending_verification: {
    label: "Pending Review",
    variant: "outline",
    className: "border-amber-400 text-amber-700 bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:bg-amber-950/30",
  },
  verified: {
    label: "Verified",
    variant: "outline",
    className: "border-emerald-400 text-emerald-700 bg-emerald-50 dark:border-emerald-600 dark:text-emerald-400 dark:bg-emerald-950/30",
  },
  rejected: {
    label: "Rejected",
    variant: "outline",
    className: "border-red-300 text-red-600 bg-red-50 dark:border-red-700 dark:text-red-400 dark:bg-red-950/30",
  },
};

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function TypeBadge({ type }: { type: Exclude<ContributionType, "all"> }) {
  const cfg = TYPE_CONFIG[type];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border",
        cfg.bg,
        cfg.color,
      )}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: Exclude<VerificationStatus, "all"> }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Badge variant={cfg.variant} className={cn("text-xs", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

// ── Contribution form dialog ───────────────────────────────────────────────────

interface ContributionFormProps {
  open: boolean;
  onClose: () => void;
  editEntry?: ContributionEntry | null;
  projects: { id: string; name: string }[];
  agreements: { id: string; projectId: string; status: string }[];
  onSuccess: () => void;
}

function ContributionFormDialog({
  open,
  onClose,
  editEntry,
  projects,
  agreements,
  onSuccess,
}: ContributionFormProps) {
  const isEdit = !!editEntry;
  const [projectId, setProjectId] = useState(editEntry?.projectId ?? "");
  const [partnerName, setPartnerName] = useState(editEntry?.partnerName ?? "");
  const [cType, setCType] = useState<Exclude<ContributionType, "all">>(
    (editEntry?.contributionType as Exclude<ContributionType, "all">) ?? "economic_investment",
  );
  const [amount, setAmount] = useState(editEntry?.amount?.toString() ?? "");
  const [date, setDate] = useState(editEntry?.contributionDate ?? new Date().toISOString().slice(0, 10));
  const [agreementId, setAgreementId] = useState(editEntry?.agreementId ?? "");
  const [referenceNumber, setReferenceNumber] = useState(editEntry?.referenceNumber ?? "");
  const [remarks, setRemarks] = useState(editEntry?.remarks ?? "");
  const [affectsOwnership, setAffectsOwnership] = useState(editEntry?.affectsOwnership ?? true);
  const [error, setError] = useState("");

  const createMutation = useCreateContribution();
  const updateMutation = useUpdateContribution();

  const filteredAgreements = agreements.filter((a) => !projectId || a.projectId === projectId);

  const handleSubmit = async () => {
    setError("");
    const parsedAmount = parseFloat(amount);
    if (!projectId) return setError("Project is required");
    if (!partnerName.trim()) return setError("Partner name is required");
    if (isNaN(parsedAmount) || parsedAmount <= 0) return setError("Amount must be a positive number");
    if (!date) return setError("Contribution date is required");

    try {
      if (isEdit && editEntry) {
        await updateMutation.mutateAsync({
          id: editEntry.id,
          data: {
            contributionType: cType,
            amount: parsedAmount,
            contributionDate: date,
            agreementId: agreementId || undefined,
            referenceNumber: referenceNumber || undefined,
            remarks: remarks || undefined,
            ...(cType === "manual_adjustment" ? { affectsOwnership } : {}),
          },
        });
      } else {
        await createMutation.mutateAsync({
          data: {
            projectId,
            partnerName: partnerName.trim(),
            contributionType: cType,
            amount: parsedAmount,
            contributionDate: date,
            agreementId: agreementId || undefined,
            referenceNumber: referenceNumber || undefined,
            remarks: remarks || undefined,
            ...(cType === "manual_adjustment" ? { affectsOwnership } : {}),
          },
        });
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "An error occurred");
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="w-5 h-5 text-primary" />
            {isEdit ? "Edit Contribution" : "Record Contribution"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Project */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Project <span className="text-red-500">*</span></Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Partner name */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Partner Name <span className="text-red-500">*</span></Label>
              <Input
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="e.g. Ramesh Kumar"
              />
            </div>
          )}

          {/* Type */}
          <div className="space-y-1.5">
            <Label>Contribution Type <span className="text-red-500">*</span></Label>
            <Select value={cType} onValueChange={(v) => setCType(v as Exclude<ContributionType, "all">)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_CONFIG) as Exclude<ContributionType, "all">[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    <div className="flex flex-col">
                      <span>{TYPE_CONFIG[t].label}</span>
                      <span className="text-xs text-muted-foreground">{TYPE_CONFIG[t].description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cType === "operational_cost" && (
              <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Operational costs do not create ownership rights.
              </p>
            )}
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (₹) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contribution Date <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {/* Agreement */}
          <div className="space-y-1.5">
            <Label>Linked Agreement <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={agreementId || "none"} onValueChange={(v) => setAgreementId(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="No agreement linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No agreement</SelectItem>
                {filteredAgreements.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    Agreement {a.id.slice(0, 8)}… ({a.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reference */}
          <div className="space-y-1.5">
            <Label>Reference Number <span className="text-muted-foreground text-xs">(voucher/transaction)</span></Label>
            <Input
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="e.g. TXN/2026/001"
            />
          </div>

          {/* Manual adjustment override */}
          {cType === "manual_adjustment" && (
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-slate-50 dark:bg-slate-900/50">
              <input
                type="checkbox"
                id="affectsOwnership"
                checked={affectsOwnership}
                onChange={(e) => setAffectsOwnership(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="affectsOwnership" className="text-sm cursor-pointer">
                This adjustment affects ownership guidance
              </label>
            </div>
          )}

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes about this contribution…"
              rows={2}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save Changes" : "Record Contribution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Verify / Reject dialog ─────────────────────────────────────────────────────

function VerifyRejectDialog({
  entry,
  action,
  onClose,
  onSuccess,
}: {
  entry: ContributionEntry;
  action: "verify" | "reject";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const verifyMutation = useVerifyContribution();
  const rejectMutation = useRejectContribution();

  const handleSubmit = async () => {
    setError("");
    try {
      if (action === "verify") {
        await verifyMutation.mutateAsync({ id: entry.id, data: { notes: notes || undefined } });
      } else {
        await rejectMutation.mutateAsync({ id: entry.id, data: { notes: notes || undefined } });
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "An error occurred");
    }
  };

  const isPending = verifyMutation.isPending || rejectMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", action === "verify" ? "text-emerald-700" : "text-red-700")}>
            {action === "verify" ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {action === "verify" ? "Verify Contribution" : "Reject Contribution"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-medium">{entry.partnerName}</div>
            <div className="text-muted-foreground">
              <TypeBadge type={entry.contributionType as Exclude<ContributionType, "all">} />
              <span className="ml-2">{formatINR(entry.amount)}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={action === "verify" ? "Verification notes…" : "Reason for rejection…"}
              rows={2}
            />
          </div>
          {action === "verify" && entry.lifecyclePhaseSnapshot === "prematurity" && entry.affectsOwnership && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              This entry was recorded during <strong>prematurity phase</strong> — verifying it makes it eligible to influence ownership guidance.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            variant={action === "verify" ? "default" : "destructive"}
          >
            {isPending ? "Processing…" : action === "verify" ? "Verify" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Contributions page ────────────────────────────────────────────────────

export default function Contributions() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  // Filters
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<ContributionType>("all");
  const [statusFilter, setStatusFilter] = useState<VerificationStatus>("all");
  const [search, setSearch] = useState("");

  // Dialogs
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<ContributionEntry | null>(null);
  const [verifyEntry, setVerifyEntry] = useState<{ entry: ContributionEntry; action: "verify" | "reject" } | null>(null);

  // Data
  const { data: projectsData } = useListProjects();
  const { data: agreementsData } = useListAgreements();
  const projects = useMemo(() => projectsData ?? [], [projectsData]);
  const agreements = useMemo(
    () => (agreementsData ?? []).map((a) => ({
      id: a.id,
      projectId: a.projectId,
      status: a.status ?? "",
    })),
    [agreementsData],
  );

  const listParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (selectedProjectId !== "all") p.projectId = selectedProjectId;
    if (typeFilter !== "all") p.contributionType = typeFilter;
    if (statusFilter !== "all") p.verificationStatus = statusFilter;
    return p;
  }, [selectedProjectId, typeFilter, statusFilter]);

  const { data: contributionsData, isLoading } = useListContributions(listParams);
  const { data: summaryData } = useGetContributionSummary(
    selectedProjectId !== "all" ? { projectId: selectedProjectId } : {},
  );

  const contributions = useMemo(() => {
    const all = contributionsData?.contributions ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (c) =>
        c.partnerName.toLowerCase().includes(q) ||
        c.projectName?.toLowerCase().includes(q) ||
        c.referenceNumber?.toLowerCase().includes(q) ||
        c.remarks?.toLowerCase().includes(q),
    );
  }, [contributionsData, search]);

  const totals = summaryData?.totals;

  const submitMutation = useSubmitContributionForVerification();
  const deleteMutation = useDeleteContribution();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListContributionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetContributionSummaryQueryKey() });
  }

  async function handleSubmitForVerification(id: string) {
    await submitMutation.mutateAsync({ id });
    invalidate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Permanently remove this contribution record? This cannot be undone.")) return;
    await deleteMutation.mutateAsync({ id });
    invalidate();
  }

  // ── Summary KPI cards ────────────────────────────────────────────────────────

  const kpis = [
    {
      label: "Total Recorded",
      value: formatINR(totals?.totalAmount ?? 0),
      sub: `${totals?.count ?? 0} entries`,
      icon: IndianRupee,
      color: "text-slate-600",
    },
    {
      label: "Verified Amount",
      value: formatINR(totals?.verifiedAmount ?? 0),
      sub: "Admin-confirmed",
      icon: CheckCircle2,
      color: "text-emerald-600",
    },
    {
      label: "Ownership-Eligible",
      value: formatINR(totals?.ownershipEligibleAmount ?? 0),
      sub: "Verified prematurity contributions",
      icon: TrendingUp,
      color: "text-blue-600",
      tooltip: "Sum of verified contributions recorded during prematurity phase that are flagged as affecting ownership.",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <HandCoins className="w-6 h-6 text-primary" />
            Contribution Ledger
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Capital contributions, investments, and operational costs across all plantation projects.
          </p>
        </div>
        {isAdminOrDev && (
          <Button onClick={() => { setEditEntry(null); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            Record Contribution
          </Button>
        )}
      </div>

      {/* Accounting rule notice */}
      <div className="flex items-start gap-3 p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Ownership guidance</strong> is influenced only by contributions that are{" "}
          <strong>verified</strong>, recorded during the <strong>prematurity phase</strong>, and
          flagged as affecting ownership. Operational costs never create ownership rights.
        </span>
      </div>

      {/* 50% revenue model guard — shown when a 50% project is selected */}
      {(() => {
        if (selectedProjectId === "all") return null;
        const selProject = projects.find((p) => p.id === selectedProjectId);
        if (!selProject || selProject.commercialModel !== "fifty_percent_revenue") return null;
        return (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">
                50% Revenue Share Model — No Ownership Equity
              </p>
              <p>
                <strong>{selProject.name}</strong> operates under the{" "}
                <strong>50% Revenue Share</strong> model. This model has no land notional value
                and no ownership equity. Contributions recorded here are for operational cost
                tracking only — they will never affect ownership percentages or participant
                shares, regardless of how they are flagged.
              </p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Ownership-affecting contribution types (Land Notional, Economic Investment,
                Recoverable Advance) are blocked at the API level for this project.
              </p>
            </div>
          </div>
        );
      })()}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                      {kpi.label}
                      {kpi.tooltip && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3 h-3 inline ml-1 cursor-help opacity-60" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">{kpi.tooltip}</TooltipContent>
                        </Tooltip>
                      )}
                    </p>
                    <p className="text-xl font-semibold tabular-nums">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                  </div>
                  <div className={cn("p-2 rounded-lg bg-muted/60", kpi.color)}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Per-project summary strip (admin/dev) */}
      {isAdminOrDev && summaryData && summaryData.projects.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Project Breakdown</CardTitle>
            <CardDescription className="text-xs">Ownership-eligible = verified prematurity entries that affect ownership</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Verified</TableHead>
                  <TableHead className="text-right">Ownership-Eligible</TableHead>
                  <TableHead className="text-right">Draft / Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryData.projects.map((p) => (
                  <TableRow key={p.projectId}>
                    <TableCell className="font-medium">{p.projectName}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(p.totalAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatINR(p.verifiedAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-blue-700 dark:text-blue-400 font-medium">
                      {formatINR(p.ownershipEligibleAmount)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {p.draftCount ?? 0} / {p.pendingCount ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search by partner, project, reference…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-64"
            />
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="sm:w-48">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as VerificationStatus)}>
              <SelectTrigger className="sm:w-44">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_verification">Pending Review</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Type filter tabs */}
          <div className="mt-3">
            <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as ContributionType)}>
              <TabsList className="h-8 flex flex-wrap gap-1">
                <TabsTrigger value="all" className="h-7 text-xs">All Types</TabsTrigger>
                {(Object.keys(TYPE_CONFIG) as Exclude<ContributionType, "all">[]).map((t) => (
                  <TabsTrigger key={t} value={t} className="h-7 text-xs">
                    {TYPE_CONFIG[t].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Ledger table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Ledger Entries</span>
            {!isLoading && (
              <span className="text-xs text-muted-foreground font-normal">
                {contributions.length} {contributions.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : contributions.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <HandCoins className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No contribution entries found.</p>
              {isAdminOrDev && (
                <Button size="sm" variant="outline" onClick={() => { setEditEntry(null); setShowForm(true); }}>
                  <Plus className="w-4 h-4 mr-1" /> Record First Contribution
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ownership</TableHead>
                    {isAdminOrDev && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contributions.map((c) => (
                    <TableRow key={c.id} className="group">
                      <TableCell>
                        <div className="font-medium text-sm">{c.partnerName}</div>
                        {c.referenceNumber && (
                          <div className="text-xs text-muted-foreground font-mono">{c.referenceNumber}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <TypeBadge type={c.contributionType as Exclude<ContributionType, "all">} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatINR(c.amount)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {c.contributionDate}
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded font-medium",
                          c.lifecyclePhaseSnapshot === "prematurity"
                            ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
                            : c.lifecyclePhaseSnapshot === "mature_production"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                        )}>
                          {c.lifecyclePhaseSnapshot === "prematurity"
                            ? "Prematurity"
                            : c.lifecyclePhaseSnapshot === "mature_production"
                              ? "Mature"
                              : "Closed"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.projectName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.verificationStatus as Exclude<VerificationStatus, "all">} />
                      </TableCell>
                      <TableCell>
                        {c.affectsOwnership ? (
                          <Tooltip>
                            <TooltipTrigger>
                              <CheckCircle2 className="w-4 h-4 text-blue-500" />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Eligible for ownership guidance</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger>
                              <XCircle className="w-4 h-4 text-muted-foreground/40" />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Does not affect ownership</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      {isAdminOrDev && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {/* Edit — only if not verified/rejected */}
                              {(c.verificationStatus === "draft" || c.verificationStatus === "pending_verification" || isAdmin) && (
                                <DropdownMenuItem
                                  onClick={() => { setEditEntry(c); setShowForm(true); }}
                                >
                                  <Pencil className="w-4 h-4 mr-2" /> Edit
                                </DropdownMenuItem>
                              )}

                              {/* Submit for verification */}
                              {c.verificationStatus === "draft" && (
                                <DropdownMenuItem
                                  onClick={() => handleSubmitForVerification(c.id)}
                                  disabled={submitMutation.isPending}
                                >
                                  <Send className="w-4 h-4 mr-2" /> Submit for Verification
                                </DropdownMenuItem>
                              )}

                              {/* Admin-only verify / reject */}
                              {isAdmin && c.verificationStatus !== "verified" && (
                                <DropdownMenuItem
                                  onClick={() => setVerifyEntry({ entry: c, action: "verify" })}
                                  className="text-emerald-700 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="w-4 h-4 mr-2" /> Verify
                                </DropdownMenuItem>
                              )}
                              {isAdmin && c.verificationStatus !== "rejected" && (
                                <DropdownMenuItem
                                  onClick={() => setVerifyEntry({ entry: c, action: "reject" })}
                                  className="text-red-600 dark:text-red-400"
                                >
                                  <XCircle className="w-4 h-4 mr-2" /> Reject
                                </DropdownMenuItem>
                              )}

                              {/* Delete */}
                              {isAdmin && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(c.id)}
                                    className="text-red-600 dark:text-red-400"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {showForm && (
        <ContributionFormDialog
          open={showForm}
          onClose={() => { setShowForm(false); setEditEntry(null); }}
          editEntry={editEntry}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          agreements={agreements}
          onSuccess={invalidate}
        />
      )}

      {verifyEntry && (
        <VerifyRejectDialog
          entry={verifyEntry.entry}
          action={verifyEntry.action}
          onClose={() => setVerifyEntry(null)}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}
