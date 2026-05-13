import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useLocation } from "wouter";
import {
  useGetLandNotionalContribution,
  useGetLandNotionalHistory,
  useCreateContribution,
  useVerifyContribution,
  useRejectContribution,
  useSubmitContributionForVerification,
  useListProjects,
  getGetLandNotionalContributionQueryKey,
  getGetLandNotionalHistoryQueryKey,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Landmark,
  Plus,
  CheckCircle2,
  XCircle,
  Send,
  AlertTriangle,
  Info,
  Lock,
  Banknote,
  TrendingDown,
  Clock,
  ShieldCheck,
  ArrowLeft,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function VerificationBadge({
  status,
}: {
  status: "draft" | "pending_verification" | "verified" | "rejected";
}) {
  const config = {
    draft: {
      label: "Draft",
      className:
        "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
    },
    pending_verification: {
      label: "Pending Review",
      className:
        "border-amber-400 text-amber-700 bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:bg-amber-950/30",
    },
    verified: {
      label: "Verified",
      className:
        "border-emerald-400 text-emerald-700 bg-emerald-50 dark:border-emerald-600 dark:text-emerald-400 dark:bg-emerald-950/30",
    },
    rejected: {
      label: "Rejected",
      className:
        "border-red-300 text-red-600 bg-red-50 dark:border-red-700 dark:text-red-400 dark:bg-red-950/30",
    },
  }[status];

  return (
    <Badge variant="outline" className={cn("text-xs", config.className)}>
      {config.label}
    </Badge>
  );
}

// ── Fixed-value indicators ─────────────────────────────────────────────────────

function FixedValueIndicators() {
  const indicators = [
    {
      icon: Banknote,
      label: "Non-cash",
      description: "This is a notional recognition of land value, not an actual cash payment.",
      color: "text-slate-600 dark:text-slate-400",
      bg: "bg-slate-50 dark:bg-slate-900/40",
    },
    {
      icon: TrendingDown,
      label: "Fixed — no escalation",
      description: "The notional value is fixed at the time of recording and does not change over time.",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/30",
    },
    {
      icon: Clock,
      label: "Prematurity phase only",
      description: "Land notional contributions can only be recognised during the prematurity phase of a project.",
      color: "text-sky-600 dark:text-sky-400",
      bg: "bg-sky-50 dark:bg-sky-900/30",
    },
    {
      icon: ShieldCheck,
      label: "Affects ownership",
      description: "Once verified, this contribution is eligible to inform ownership guidance calculations.",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/30",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {indicators.map((ind) => {
        const Icon = ind.icon;
        return (
          <Tooltip key={ind.label}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-default",
                  ind.bg,
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0", ind.color)} />
                <span className={cn("text-xs font-medium", ind.color)}>
                  {ind.label}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {ind.description}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ── Record Land Notional Dialog ────────────────────────────────────────────────

function RecordLandNotionalDialog({
  open,
  onClose,
  projectId,
  projectName,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onSuccess: () => void;
}) {
  const [partnerName, setPartnerName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const createMutation = useCreateContribution();

  const handleSubmit = async () => {
    setError("");
    if (!partnerName.trim()) return setError("Landowner name is required");
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0)
      return setError("Notional value must be a positive number");
    if (!date) return setError("Entry date is required");
    if (!confirmed)
      return setError(
        "Please confirm that you understand the nature of land notional contribution",
      );

    try {
      await createMutation.mutateAsync({
        data: {
          projectId,
          partnerName: partnerName.trim(),
          contributionType: "land_notional",
          amount: parsedAmount,
          contributionDate: date,
          remarks: remarks || undefined,
        },
      });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "An error occurred. Please try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Landmark className="w-5 h-5" />
            Record Land Notional Value
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Project (read-only) */}
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Input value={projectName} disabled className="bg-muted" />
          </div>

          {/* Fixed-value indicators reminder */}
          <div className="p-3 rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-medium flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> About land notional contributions
            </p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>This is a non-cash recognition of the land value brought into the project</li>
              <li>The notional value is <strong>fixed permanently</strong> and does not escalate</li>
              <li>Only one land notional contribution is allowed per project</li>
              <li>It must be recorded in the <strong>prematurity phase</strong> only</li>
            </ul>
          </div>

          {/* Landowner name */}
          <div className="space-y-1.5">
            <Label>
              Landowner Name <span className="text-red-500">*</span>
            </Label>
            <Input
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
            />
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Notional Value (₹) <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                As agreed in the partnership deed
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>
                Entry Date <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Reference to deed clause, survey number, or other context…"
              rows={2}
            />
          </div>

          {/* Confirmation checkbox */}
          <div className="flex items-start gap-3 p-3 rounded-lg border bg-slate-50 dark:bg-slate-900/50">
            <input
              type="checkbox"
              id="confirmLandNotional"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-primary"
            />
            <label
              htmlFor="confirmLandNotional"
              className="text-sm cursor-pointer"
            >
              I confirm that this land notional value is fixed, non-cash, and
              separate from any operational costs or advance payments. It
              represents the agreed land contribution for the partnership.
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || !confirmed}
          >
            {createMutation.isPending ? "Recording…" : "Record Land Notional Value"}
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
        await verifyMutation.mutateAsync({
          id: entry.id,
          data: { notes: notes || undefined },
        });
      } else {
        await rejectMutation.mutateAsync({
          id: entry.id,
          data: { notes: notes || undefined },
        });
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
          <DialogTitle
            className={cn(
              "flex items-center gap-2",
              action === "verify"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-700 dark:text-red-400",
            )}
          >
            {action === "verify" ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <XCircle className="w-5 h-5" />
            )}
            {action === "verify"
              ? "Verify Land Notional Value"
              : "Reject Land Notional Entry"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-medium">{entry.partnerName}</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatINR(entry.amount)}
            </div>
            <div className="text-xs text-muted-foreground">
              Dated {entry.contributionDate}
            </div>
          </div>
          {action === "verify" && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Verifying this entry makes the land notional value eligible to
              inform ownership guidance for this project.
            </p>
          )}
          {action === "reject" && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Rejecting allows a new land notional entry to be recorded. The
              rejected entry is retained in the audit history.
            </p>
          )}
          <div className="space-y-1.5">
            <Label>
              Notes{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                action === "verify"
                  ? "Verification notes or reference…"
                  : "Reason for rejection…"
              }
              rows={2}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            variant={action === "verify" ? "default" : "destructive"}
          >
            {isPending
              ? "Processing…"
              : action === "verify"
                ? "Verify"
                : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LandContribution() {
  const { role } = useRole();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [showRecord, setShowRecord] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [verifyEntry, setVerifyEntry] = useState<{
    entry: ContributionEntry;
    action: "verify" | "reject";
  } | null>(null);

  const { data: projectsData } = useListProjects();
  const projects = useMemo(() => projectsData ?? [], [projectsData]);

  // Auto-select first project if none selected
  const effectiveProjectId =
    selectedProjectId || projects[0]?.id || "";

  const { data: landState, isLoading } = useGetLandNotionalContribution(
    { projectId: effectiveProjectId },
    { query: { enabled: !!effectiveProjectId, queryKey: getGetLandNotionalContributionQueryKey({ projectId: effectiveProjectId }) } },
  );

  const { data: historyData } = useGetLandNotionalHistory(
    { projectId: effectiveProjectId },
    { query: { enabled: !!effectiveProjectId && showHistory, queryKey: getGetLandNotionalHistoryQueryKey({ projectId: effectiveProjectId }) } },
  );

  const submitMutation = useSubmitContributionForVerification();

  function invalidate() {
    qc.invalidateQueries({
      queryKey: getGetLandNotionalContributionQueryKey({ projectId: effectiveProjectId }),
    });
    qc.invalidateQueries({
      queryKey: getGetLandNotionalHistoryQueryKey({ projectId: effectiveProjectId }),
    });
  }

  async function handleSubmitForVerification(id: string) {
    await submitMutation.mutateAsync({ id });
    invalidate();
  }

  const entry = landState?.entry ?? null;
  const canRecord = landState?.canRecord ?? false;
  const isLocked = landState?.isLocked ?? false;
  const lifecycleStatus = landState?.lifecycleStatus ?? "prematurity";
  const projectName =
    landState?.projectName ??
    projects.find((p) => p.id === effectiveProjectId)?.name ??
    "";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate("/contributions")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-600" />
            Land Notional Value
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Fixed non-cash land contribution — recognised once per project during the prematurity phase.
          </p>
        </div>
      </div>

      {/* Fixed-value rule panel */}
      <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <Info className="w-4 h-4" />
            What is land notional contribution?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-emerald-900 dark:text-emerald-200 space-y-1.5">
          <p>
            The landowner brings their land into the partnership. Rather than a cash payment, the
            agreed land value is recorded as a <strong>notional contribution</strong> — a fixed
            recognition of the land's economic value.
          </p>
          <p>
            This contribution is <strong>permanent and non-escalating</strong>. It is kept entirely
            separate from operational costs and land compensation advances (LCA). Once verified, it
            becomes part of the ownership guidance calculation for the prematurity phase.
          </p>
        </CardContent>
      </Card>

      {/* Project selector */}
      <div className="flex items-center gap-3">
        <Label className="shrink-0 text-sm">Project</Label>
        <Select
          value={effectiveProjectId}
          onValueChange={setSelectedProjectId}
        >
          <SelectTrigger className="w-72">
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
      </div>

      {/* Phase lock banner */}
      {isLocked && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-600 dark:text-slate-400">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            This project has advanced beyond the prematurity phase (
            <strong className="capitalize">{lifecycleStatus.replace("_", " ")}</strong>
            ). New land notional contributions cannot be recorded.
          </span>
        </div>
      )}

      {!effectiveProjectId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Landmark className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              Select a project to view its land notional contribution.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Loading…
          </CardContent>
        </Card>
      ) : entry ? (
        /* ── Entry exists ──────────────────────────────────────────────────── */
        <div className="space-y-4">
          <Card
            className={cn(
              "border-2",
              entry.verificationStatus === "verified"
                ? "border-emerald-300 dark:border-emerald-700"
                : entry.verificationStatus === "pending_verification"
                  ? "border-amber-300 dark:border-amber-700"
                  : "border-slate-200 dark:border-slate-700",
            )}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-emerald-600" />
                  Land Notional Contribution
                  {entry.verificationStatus === "verified" && (
                    <Lock className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                </CardTitle>
                <VerificationBadge
                  status={
                    entry.verificationStatus as
                      | "draft"
                      | "pending_verification"
                      | "verified"
                      | "rejected"
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Value display */}
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Notional Value
                  </p>
                  <p className="text-3xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatINR(entry.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Recorded {entry.contributionDate}
                  </p>
                </div>
                {entry.verificationStatus === "verified" && (
                  <div className="mb-1">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Landowner</span>
                  <p className="font-medium mt-0.5">{entry.partnerName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Phase at recording</span>
                  <p className="mt-0.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
                      <Clock className="w-3 h-3" />
                      {entry.lifecyclePhaseSnapshot === "prematurity"
                        ? "Prematurity"
                        : entry.lifecyclePhaseSnapshot}
                    </span>
                  </p>
                </div>
                {entry.remarks && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Remarks</span>
                    <p className="mt-0.5 text-sm">{entry.remarks}</p>
                  </div>
                )}
                {entry.verificationStatus === "verified" && entry.verifiedByName && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Verified by</span>
                    <p className="mt-0.5">
                      {entry.verifiedByName}{" "}
                      {entry.verifiedAt && (
                        <span className="text-muted-foreground">
                          on {new Date(entry.verifiedAt).toLocaleDateString("en-IN")}
                        </span>
                      )}
                    </p>
                    {entry.verifierNotes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">
                        "{entry.verifierNotes}"
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Recorded by</span>
                  <p className="mt-0.5">{entry.recordedByName ?? "—"}</p>
                </div>
              </div>

              {/* Fixed-value indicators */}
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Nature of this contribution
                </p>
                <FixedValueIndicators />
              </div>

              {/* Action buttons */}
              {isAdminOrDev && entry.verificationStatus !== "verified" && (
                <div className="flex gap-2 pt-1 border-t">
                  {entry.verificationStatus === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSubmitForVerification(entry.id)}
                      disabled={submitMutation.isPending}
                      className="gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Submit for Verification
                    </Button>
                  )}
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          setVerifyEntry({ entry, action: "verify" })
                        }
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setVerifyEntry({ entry, action: "reject" })
                        }
                        className="gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Verified lock notice */}
              {entry.verificationStatus === "verified" && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  This entry is verified and locked. The notional value is
                  permanent and contributes to ownership guidance for this
                  project.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ── No entry yet ────────────────────────────────────────────────────── */
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-4">
            <Landmark className="w-12 h-12 mx-auto text-muted-foreground/30" />
            <div>
              <p className="font-medium text-sm">
                No land notional value recorded yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Record the landowner's land notional contribution for{" "}
                <strong>{projectName}</strong>.
              </p>
            </div>
            {canRecord && isAdminOrDev ? (
              <Button
                onClick={() => setShowRecord(true)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Record Land Notional Value
              </Button>
            ) : !canRecord && !isLocked ? (
              <p className="text-xs text-muted-foreground">
                No project selected or project not in prematurity phase.
              </p>
            ) : isLocked ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Lock className="w-4 h-4" />
                Project is past prematurity — recording is no longer available.
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* History toggle */}
      {effectiveProjectId && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
            className="gap-2 text-muted-foreground"
          >
            <History className="w-4 h-4" />
            {showHistory ? "Hide" : "Show"} Full History
          </Button>

          {showHistory && (
            <Card className="mt-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Land Notional History</CardTitle>
                <CardDescription className="text-xs">
                  All land notional entries including rejected records — immutable audit trail.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!historyData || historyData.history.length === 0 ? (
                  <p className="p-6 text-sm text-center text-muted-foreground">
                    No history entries found.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Landowner</TableHead>
                        <TableHead className="text-right">Notional Value</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Recorded by</TableHead>
                        <TableHead>Verified by</TableHead>
                        <TableHead>Remarks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyData.history.map((h) => (
                        <TableRow
                          key={h.id}
                          className={cn(
                            h.verificationStatus === "rejected" &&
                              "opacity-60 bg-red-50/50 dark:bg-red-950/10",
                          )}
                        >
                          <TableCell className="font-medium text-sm">
                            {h.partnerName}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatINR(h.amount)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {h.contributionDate}
                          </TableCell>
                          <TableCell>
                            <VerificationBadge
                              status={
                                h.verificationStatus as
                                  | "draft"
                                  | "pending_verification"
                                  | "verified"
                                  | "rejected"
                              }
                            />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {h.recordedByName ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {h.verifiedByName ?? "—"}
                            {h.verifiedAt && (
                              <span className="block text-xs">
                                {new Date(h.verifiedAt).toLocaleDateString("en-IN")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                            {h.verifierNotes ?? h.remarks ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Dialogs */}
      {showRecord && effectiveProjectId && (
        <RecordLandNotionalDialog
          open={showRecord}
          onClose={() => setShowRecord(false)}
          projectId={effectiveProjectId}
          projectName={projectName}
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
