import { useState, useEffect, useMemo } from "react";
import {
  useCreateContribution,
  useCreateExpenditure,
  useListOnboardingParticipants,
  useListAgreements,
  getListOnboardingParticipantsQueryKey,
  getListContributionsQueryKey,
  getGetContributionSummaryQueryKey,
  getListExpendituresQueryKey,
  getGetExpenditureSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Info,
  Leaf,
  Banknote,
  RotateCcw,
  Landmark,
  SlidersHorizontal,
  Wrench,
  FlaskConical,
  Truck,
  Cog,
  Package,
  TreePine,
  CircleDollarSign,
  Hammer,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Project shape passed in (from parent context) ───────────────────────────

export type FinancialEntryProject = {
  id: string;
  name: string;
  commercialModel: string;
  lifecycleStatus: string;
};

// ── Unified entry type system ────────────────────────────────────────────────
//
// Each entry maps to either the contributions ledger or the expenditures ledger.
// The `ledger` field controls which API endpoint receives the write.

type EntryLedger = "contribution" | "expenditure";

type EntryTypeConfig = {
  label: string;
  ledger: EntryLedger;
  contributionType?: string;
  expenditureCategory?: string;
  icon: React.FC<{ className?: string }>;
  color: string;
  description: string;
  // lifecycle gate
  blockedInMature?: boolean;
  blockedInClosed?: boolean;
  blockedFor50pct?: boolean;
  onlyFor50pct?: boolean;
  ownershipAffecting?: boolean;
  requiresParticipant?: boolean;
  // post-mature behavior: force it to a safe category instead
};

const ENTRY_TYPES: Record<string, EntryTypeConfig> = {
  // ── Ownership / investment (contribution ledger) ──────────────────────────
  economic_investment: {
    label: "Economic Investment",
    ledger: "contribution",
    contributionType: "economic_investment",
    icon: Banknote,
    color: "text-blue-600",
    description: "Capital investment by a project participant",
    ownershipAffecting: true,
    requiresParticipant: true,
    blockedInMature: true,
    blockedInClosed: true,
  },
  land_notional: {
    label: "Land Notional Value",
    ledger: "contribution",
    contributionType: "land_notional",
    icon: Landmark,
    color: "text-violet-600",
    description: "Non-cash land contribution (landowner only, one-time, prematurity only)",
    ownershipAffecting: true,
    requiresParticipant: true,
    blockedInMature: true,
    blockedInClosed: true,
    blockedFor50pct: true,
  },
  recoverable_advance: {
    label: "Recoverable Advance",
    ledger: "contribution",
    contributionType: "recoverable_advance",
    icon: RotateCcw,
    color: "text-purple-600",
    description: "Bridge funding to be recovered from future revenue",
    ownershipAffecting: false,
    requiresParticipant: true,
    blockedInMature: true,
    blockedInClosed: true,
  },
  manual_adjustment: {
    label: "Manual Adjustment",
    ledger: "contribution",
    contributionType: "manual_adjustment",
    icon: SlidersHorizontal,
    color: "text-slate-600",
    description: "Admin-initiated correction or reconciliation",
    requiresParticipant: true,
    blockedInClosed: true,
  },
  // ── Operational costs (expenditure ledger) ────────────────────────────────
  operational_labor: {
    label: "Labour Cost",
    ledger: "expenditure",
    expenditureCategory: "labor",
    icon: Wrench,
    color: "text-indigo-600",
    description: "Wages, daily labour, and worker payments",
  },
  operational_fertilizer: {
    label: "Fertilizer & Agro-Inputs",
    ledger: "expenditure",
    expenditureCategory: "fertilizer",
    icon: FlaskConical,
    color: "text-green-600",
    description: "Fertilizers, pesticides, and agricultural inputs",
  },
  operational_transport: {
    label: "Transport",
    ledger: "expenditure",
    expenditureCategory: "transport",
    icon: Truck,
    color: "text-amber-600",
    description: "Freight, vehicle hire, and logistics",
  },
  operational_machinery: {
    label: "Machinery & Equipment",
    ledger: "expenditure",
    expenditureCategory: "machinery",
    icon: Cog,
    color: "text-blue-500",
    description: "Equipment purchase, hire, or lease",
  },
  operational_maintenance: {
    label: "Maintenance",
    ledger: "expenditure",
    expenditureCategory: "maintenance",
    icon: Hammer,
    color: "text-pink-600",
    description: "Repair and upkeep of infrastructure and equipment",
  },
  operational_consumables: {
    label: "Consumables",
    ledger: "expenditure",
    expenditureCategory: "consumables",
    icon: Package,
    color: "text-teal-600",
    description: "Supplies and materials used in plantation operations",
  },
  operational_plantation: {
    label: "Plantation Operations",
    ledger: "expenditure",
    expenditureCategory: "plantation_operations",
    icon: TreePine,
    color: "text-emerald-600",
    description: "Land preparation, planting, weeding, and field activities",
  },
  operational_miscellaneous: {
    label: "Miscellaneous Expense",
    ledger: "expenditure",
    expenditureCategory: "miscellaneous",
    icon: HelpCircle,
    color: "text-slate-500",
    description: "Other operational costs not covered by above categories",
  },
};

// ── Groups for the selector UI ──────────────────────────────────────────────

const ENTRY_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "Capital & Investment",
    keys: ["economic_investment", "land_notional", "recoverable_advance", "manual_adjustment"],
  },
  {
    label: "Operational Expenses",
    keys: [
      "operational_labor",
      "operational_fertilizer",
      "operational_transport",
      "operational_machinery",
      "operational_maintenance",
      "operational_consumables",
      "operational_plantation",
      "operational_miscellaneous",
    ],
  },
];

// ── Lifecycle / model guard logic ────────────────────────────────────────────

function getEntryBlockReason(
  key: string,
  lifecycle: string,
  model: string,
): string | null {
  const cfg = ENTRY_TYPES[key];
  if (!cfg) return null;
  const is50pct = model === "fifty_percent_revenue";
  const isMature = lifecycle === "mature_production";
  const isClosed = lifecycle === "closed";

  if (isClosed && cfg.blockedInClosed) return "Project is closed — this entry type is no longer permitted.";
  if (isMature && cfg.blockedInMature) return "Project has passed prematurity — this entry type is blocked.";
  if (is50pct && cfg.blockedFor50pct) return "Not available for 50% Revenue model projects.";
  return null;
}

function getEntryWarning(
  key: string,
  lifecycle: string,
  model: string,
): string | null {
  const cfg = ENTRY_TYPES[key];
  if (!cfg) return null;
  const is50pct = model === "fifty_percent_revenue";
  if (is50pct && cfg.ownershipAffecting) {
    return "50% Revenue model: this entry will not create any ownership equity.";
  }
  if (cfg.ownershipAffecting && lifecycle === "mature_production") {
    return "Project is in mature production — ownership is frozen. This entry will not affect shares.";
  }
  return null;
}

// ── Helper: lifecycle label ──────────────────────────────────────────────────

function lifecycleLabel(s: string): string {
  if (s === "prematurity") return "Prematurity";
  if (s === "mature_production") return "Mature Production";
  if (s === "closed") return "Closed";
  return s;
}

function modelLabel(m: string): string {
  if (m === "ownership_contribution") return "Contribution Model";
  if (m === "fifty_percent_revenue") return "50% Revenue Model";
  return m;
}

// ── Main dialog component ────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onClose: () => void;
  /** Pre-selected project (from card context). If not provided, project selector is shown. */
  initialProject?: FinancialEntryProject;
  /** All available projects (passed from parent so we can list them in the selector) */
  projects: FinancialEntryProject[];
  onSuccess?: () => void;
};

export function ProjectFinancialEntryDialog({
  open,
  onClose,
  initialProject,
  projects,
  onSuccess,
}: Props) {
  const qc = useQueryClient();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState(initialProject?.id ?? "");
  const [entryTypeKey, setEntryTypeKey] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedParticipantName, setSelectedParticipantName] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [agreementId, setAgreementId] = useState("");
  const [affectsOwnership, setAffectsOwnership] = useState(true);
  const [error, setError] = useState("");

  // ── Reset when project changes ─────────────────────────────────────────────
  useEffect(() => {
    setEntryTypeKey("");
    setSelectedParticipantName("");
    setError("");
  }, [projectId]);

  // ── Auto-reset blocked type when project changes ───────────────────────────
  const project = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  useEffect(() => {
    if (!project || !entryTypeKey) return;
    const blocked = getEntryBlockReason(entryTypeKey, project.lifecycleStatus, project.commercialModel);
    if (blocked) setEntryTypeKey("");
  }, [project, entryTypeKey]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: participantsData } = useListOnboardingParticipants(
    projectId || "00000000-0000-0000-0000-000000000000",
    {
      query: {
        enabled: open && !!projectId,
        queryKey: getListOnboardingParticipantsQueryKey(projectId || "00000000-0000-0000-0000-000000000000"),
      },
    },
  );
  const participants = participantsData?.participants ?? [];

  const { data: agreementsData } = useListAgreements();
  const agreements = useMemo(
    () => (agreementsData ?? []).filter((a) => !projectId || a.projectId === projectId),
    [agreementsData, projectId],
  );

  // ── Derived config ─────────────────────────────────────────────────────────
  const cfg = entryTypeKey ? ENTRY_TYPES[entryTypeKey] : null;
  const lifecycle = project?.lifecycleStatus ?? "";
  const model = project?.commercialModel ?? "";
  const is50pct = model === "fifty_percent_revenue";
  const isMature = lifecycle === "mature_production";
  const isClosed = lifecycle === "closed";
  const blockReason = entryTypeKey ? getEntryBlockReason(entryTypeKey, lifecycle, model) : null;
  const warning = entryTypeKey ? getEntryWarning(entryTypeKey, lifecycle, model) : null;
  const isManualAdj = entryTypeKey === "manual_adjustment";

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createContrib = useCreateContribution();
  const createExpend = useCreateExpenditure();
  const isPending = createContrib.isPending || createExpend.isPending;

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError("");
    if (!projectId) return setError("Please select a project.");
    if (!entryTypeKey) return setError("Please select an entry type.");
    if (blockReason) return setError(blockReason);
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return setError("Amount must be a positive number.");
    if (!date) return setError("Date is required.");

    if (!cfg) return setError("Invalid entry type.");

    try {
      if (cfg.ledger === "contribution") {
        if (!selectedParticipantName) return setError("Please select a project participant.");
        await createContrib.mutateAsync({
          data: {
            projectId,
            partnerName: selectedParticipantName,
            contributionType: cfg.contributionType! as
              | "land_notional"
              | "economic_investment"
              | "operational_cost"
              | "recoverable_advance"
              | "manual_adjustment",
            amount: parsedAmount,
            contributionDate: date,
            agreementId: agreementId || undefined,
            referenceNumber: referenceNumber || undefined,
            remarks: remarks || undefined,
            ...(isManualAdj ? { affectsOwnership } : {}),
          },
        });
        qc.invalidateQueries({ queryKey: getListContributionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetContributionSummaryQueryKey() });
      } else {
        if (!description.trim()) return setError("Description is required for expenses.");
        await createExpend.mutateAsync({
          data: {
            projectId,
            category: cfg.expenditureCategory! as
              | "labor"
              | "fertilizer"
              | "transport"
              | "machinery"
              | "maintenance"
              | "consumables"
              | "plantation_operations"
              | "miscellaneous",
            amount: parsedAmount,
            expenditureDate: date,
            description: description.trim(),
            notes: remarks || undefined,
          },
        });
        qc.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
        qc.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
      }

      onSuccess?.();
      handleClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "An error occurred. Please try again.");
    }
  }

  function handleClose() {
    setProjectId(initialProject?.id ?? "");
    setEntryTypeKey("");
    setAmount("");
    setDate(new Date().toISOString().slice(0, 10));
    setSelectedParticipantName("");
    setDescription("");
    setReferenceNumber("");
    setRemarks("");
    setAgreementId("");
    setAffectsOwnership(true);
    setError("");
    onClose();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDollarSign className="w-5 h-5 text-primary" />
            Record Financial Entry
          </DialogTitle>
          <DialogDescription>
            Capital contributions and operational expenses in one place — governed by project lifecycle.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* ── Step 1: Project ────────────────────────────────────────────── */}
          {!initialProject ? (
            <div className="space-y-1.5">
              <Label>Project <span className="text-red-500">*</span></Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Leaf className="w-3.5 h-3.5 text-emerald-600" />
              {initialProject.name}
            </div>
          )}

          {/* ── Project context badges ─────────────────────────────────────── */}
          {project && (
            <div className="flex items-center gap-2 flex-wrap -mt-1">
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
                is50pct
                  ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-400"
                  : "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-400",
              )}>
                {is50pct ? <ShieldAlert className="inline w-2.5 h-2.5 mr-0.5" /> : <ShieldCheck className="inline w-2.5 h-2.5 mr-0.5" />}
                {modelLabel(model)}
              </span>
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
                lifecycle === "prematurity"
                  ? "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-950/30 dark:border-sky-700 dark:text-sky-400"
                  : lifecycle === "mature_production"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-400"
                    : "bg-slate-100 border-slate-200 text-slate-500",
              )}>
                {lifecycleLabel(lifecycle)}
              </span>
              {isMature && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 flex items-center gap-0.5 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-400">
                  <Lock className="w-2.5 h-2.5" /> Ownership Frozen
                </span>
              )}
              {isClosed && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 flex items-center gap-0.5 dark:bg-red-950/30 dark:border-red-700 dark:text-red-400">
                  <Lock className="w-2.5 h-2.5" /> Project Closed
                </span>
              )}
            </div>
          )}

          {/* ── Step 2: Entry type selector ───────────────────────────────── */}
          {projectId && (
            <div className="space-y-2">
              <Label>What financial event happened? <span className="text-red-500">*</span></Label>
              <div className="space-y-3">
                {ENTRY_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {group.keys.map((key) => {
                        const typeCfg = ENTRY_TYPES[key];
                        const blocked = getEntryBlockReason(key, lifecycle, model);
                        const Icon = typeCfg.icon;
                        const isSelected = entryTypeKey === key;

                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={!!blocked}
                            onClick={() => setEntryTypeKey(key)}
                            className={cn(
                              "text-left rounded-lg border p-2 transition-all text-xs",
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : blocked
                                  ? "border-dashed opacity-40 cursor-not-allowed bg-muted/20"
                                  : "border-border hover:border-primary/50 hover:bg-muted/30 cursor-pointer",
                            )}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <Icon className={cn("w-3.5 h-3.5 shrink-0", typeCfg.color)} />
                              <span className={cn("font-medium leading-tight", blocked ? "line-through" : "")}>
                                {typeCfg.label}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-tight">
                              {blocked
                                ? "Blocked — " + (lifecycle === "mature_production" ? "post-maturity" : lifecycle === "closed" ? "project closed" : "model restriction")
                                : typeCfg.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 3: Contextual warnings ───────────────────────────────── */}
          {warning && (
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          )}

          {/* ── 50% model notice for expenditure types ─────────────────────── */}
          {is50pct && cfg?.ledger === "expenditure" && (
            <div className="flex items-start gap-2 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-700 rounded-lg p-2.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Operational expenses are tracked for burden accounting and settlement calculations under the 50% revenue model.</span>
            </div>
          )}

          {/* ── Fields (shown only when entry type is selected) ──────────── */}
          {cfg && !blockReason && (
            <>
              {/* Participant selector (contributions only) */}
              {cfg.ledger === "contribution" && (
                <div className="space-y-1.5">
                  <Label>Project Participant <span className="text-red-500">*</span></Label>
                  {participants.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No participants found for this project. Add participants first.
                    </p>
                  ) : (
                    <Select value={selectedParticipantName} onValueChange={setSelectedParticipantName}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select participant…" />
                      </SelectTrigger>
                      <SelectContent>
                        {participants.map((p) => (
                          <SelectItem key={p.id} value={p.fullName}>
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[9px] px-1 py-0.5 rounded font-semibold uppercase",
                                p.role === "landowner"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : p.role === "developer"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-slate-100 text-slate-600",
                              )}>
                                {p.role === "landowner" ? "LO" : p.role === "developer" ? "Dev" : p.role}
                              </span>
                              <span>{p.fullName}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Only participants linked to this project are shown.
                  </p>
                </div>
              )}

              {/* Amount */}
              <div className="space-y-1.5">
                <Label>Amount (₹) <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label>Date <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              {/* Description (expenditure only, required) */}
              {cfg.ledger === "expenditure" && (
                <div className="space-y-1.5">
                  <Label>Description <span className="text-red-500">*</span></Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of this expense…"
                  />
                </div>
              )}

              {/* Linked Agreement (contribution only, optional) */}
              {cfg.ledger === "contribution" && agreements.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Linked Agreement <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select value={agreementId} onValueChange={setAgreementId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agreement…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {agreements.map((a) => (
                        <SelectItem key={a.id} value={a.id}>Agreement {a.id.slice(0, 8)}…</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Reference number (contributions only) */}
              {cfg.ledger === "contribution" && (
                <div className="space-y-1.5">
                  <Label>Reference Number <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="Voucher / transaction ID…"
                  />
                </div>
              )}

              {/* Affects Ownership toggle (manual_adjustment only) */}
              {isManualAdj && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                  <Checkbox
                    id="affects-ownership"
                    checked={affectsOwnership}
                    onCheckedChange={(c) => setAffectsOwnership(!!c)}
                  />
                  <div className="flex-1">
                    <Label htmlFor="affects-ownership" className="cursor-pointer text-sm font-medium">
                      Affects ownership guidance
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      When checked, this adjustment is included in ownership pool calculations.
                    </p>
                  </div>
                </div>
              )}

              {/* Remarks / notes */}
              <div className="space-y-1.5">
                <Label>
                  {cfg.ledger === "expenditure" ? "Notes" : "Remarks"}{" "}
                  <span className="text-muted-foreground text-xs">
                    {isManualAdj ? "(audit reason recommended)" : "(optional)"}
                  </span>
                </Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    isManualAdj
                      ? "Audit reason: explain why this adjustment is needed…"
                      : cfg.ledger === "expenditure"
                        ? "Additional notes about this expense…"
                        : "Optional notes…"
                  }
                  rows={2}
                />
              </div>

              {/* Routing info */}
              <div className="flex items-start gap-2 text-[10px] text-muted-foreground bg-muted/20 rounded-lg p-2">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  This will be recorded in the{" "}
                  <strong>
                    {cfg.ledger === "contribution" ? "Contribution Ledger" : "Expenditure Ledger"}
                  </strong>
                  {cfg.ownershipAffecting && lifecycle === "prematurity" && !is50pct
                    ? " and may influence ownership guidance once verified."
                    : "."}
                </span>
              </div>
            </>
          )}

          {/* ── Error ───────────────────────────────────────────────────────── */}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !entryTypeKey || !projectId || !!blockReason}
          >
            {isPending ? "Recording…" : "Record Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
