import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListPendingVerificationContributions,
  useListContributions,
  useRequestContributionVerification,
  useVerifyContribution,
  useRejectContribution,
  useSubmitContributionForVerification,
  useCreateContribution,
  useListContributionVerificationHistory,
  useListProjects,
  useListUsers,
  useGetMe,
  getListPendingVerificationContributionsQueryKey,
  getListContributionsQueryKey,
  getListContributionVerificationHistoryQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { ContributionEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  Plus,
  CheckCircle2,
  XCircle,
  Send,
  AlertTriangle,
  Info,
  Clock,
  ChevronDown,
  ChevronRight,
  History,
  UserCheck,
  AlertCircle,
  ShieldCheck,
  Smartphone,
  ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function VerificationBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; className: string }> = {
    draft: {
      label: "Draft",
      className: "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
    },
    pending_verification: {
      label: "Pending Review",
      className: "border-amber-400 text-amber-700 bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:bg-amber-950/30",
    },
    verified: {
      label: "Verified",
      className: "border-emerald-400 text-emerald-700 bg-emerald-50 dark:border-emerald-600 dark:text-emerald-400 dark:bg-emerald-950/30",
    },
    rejected: {
      label: "Rejected",
      className: "border-red-300 text-red-600 bg-red-50 dark:border-red-700 dark:text-red-400 dark:bg-red-950/30",
    },
  };
  const config = configs[status] ?? configs.draft;
  return (
    <Badge variant="outline" className={cn("text-xs", config.className)}>
      {config.label}
    </Badge>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
    verification_requested: {
      label: "Verification Requested",
      icon: <Send className="w-3 h-3" />,
      className: "text-blue-700 dark:text-blue-400",
    },
    approved: {
      label: "Approved",
      icon: <CheckCircle2 className="w-3 h-3" />,
      className: "text-emerald-700 dark:text-emerald-400",
    },
    rejected: {
      label: "Rejected",
      icon: <XCircle className="w-3 h-3" />,
      className: "text-red-700 dark:text-red-400",
    },
    re_approved: {
      label: "Re-approved",
      icon: <CheckCircle2 className="w-3 h-3" />,
      className: "text-emerald-700 dark:text-emerald-400",
    },
    verifier_changed: {
      label: "Verifier Changed",
      icon: <UserCheck className="w-3 h-3" />,
      className: "text-purple-700 dark:text-purple-400",
    },
    otp_sent: {
      label: "OTP Sent",
      icon: <Smartphone className="w-3 h-3" />,
      className: "text-slate-600 dark:text-slate-400",
    },
    otp_verified: {
      label: "OTP Verified",
      icon: <ShieldCheck className="w-3 h-3" />,
      className: "text-sky-700 dark:text-sky-400",
    },
    dispute_raised: {
      label: "Dispute Raised",
      icon: <AlertTriangle className="w-3 h-3" />,
      className: "text-amber-700 dark:text-amber-400",
    },
    dispute_resolved: {
      label: "Dispute Resolved",
      icon: <CheckCircle2 className="w-3 h-3" />,
      className: "text-emerald-700 dark:text-emerald-400",
    },
    dispute_overridden: {
      label: "Admin Override",
      icon: <AlertCircle className="w-3 h-3" />,
      className: "text-red-700 dark:text-red-400",
    },
  };
  const config = configs[type] ?? { label: type, icon: null, className: "" };
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", config.className)}>
      {config.icon}
      {config.label}
    </span>
  );
}

// ── Verification Timeline ──────────────────────────────────────────────────────

function VerificationTimeline({ contributionId }: { contributionId: string }) {
  const { data } = useListContributionVerificationHistory(
    contributionId,
    { query: { queryKey: getListContributionVerificationHistoryQueryKey(contributionId) } },
  );

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 italic">
        No verification events recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-2 mt-2">
      {[...events].reverse().map((e) => (
        <div key={e.id} className="flex gap-3 text-xs">
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 mt-0.5 shrink-0" />
            <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-0.5" />
          </div>
          <div className="pb-3 flex-1">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <EventTypeBadge type={e.eventType} />
              <span className="text-muted-foreground text-xs">
                {new Date(e.createdAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
            {e.actorName && (
              <p className="text-muted-foreground mt-0.5">by {e.actorName}</p>
            )}
            {e.targetUserName && (
              <p className="text-muted-foreground">→ {e.targetUserName}</p>
            )}
            {e.notes && (
              <p className="mt-0.5 italic text-slate-600 dark:text-slate-400">
                "{e.notes}"
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Assign Verifier Dialog ─────────────────────────────────────────────────────

function AssignVerifierDialog({
  entry,
  onClose,
  onSuccess,
}: {
  entry: ContributionEntry;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [verifierUserId, setVerifierUserId] = useState(entry.designatedVerifierId ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const { data: usersData } = useListUsers();
  const users = useMemo(() => usersData ?? [], [usersData]);
  const requestMutation = useRequestContributionVerification();

  const handleSubmit = async () => {
    setError("");
    if (!verifierUserId) return setError("Please select a verifier");
    try {
      await requestMutation.mutateAsync({
        id: entry.id,
        data: { verifierUserId, notes: notes || undefined },
      });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "An error occurred");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-blue-600" />
            {entry.designatedVerifierId ? "Change Verifier" : "Assign Verifier"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{entry.partnerName}</p>
            <p className="text-lg font-semibold tabular-nums">{formatINR(entry.amount)}</p>
            <p className="text-xs text-muted-foreground">Dated {entry.contributionDate}</p>
          </div>
          {entry.designatedVerifierName && (
            <p className="text-xs text-muted-foreground">
              Current verifier: <span className="font-medium">{entry.designatedVerifierName}</span>
            </p>
          )}
          <div className="space-y-1.5">
            <Label>
              Assign Verifier <span className="text-red-500">*</span>
            </Label>
            <Select value={verifierUserId} onValueChange={setVerifierUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a user…" />
              </SelectTrigger>
              <SelectContent>
                {users.filter((u) => !!u.id).map((u) => (
                  <SelectItem key={u.id!} value={u.id!}>
                    {u.displayName ?? u.clerkUserId} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for the verifier…"
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={requestMutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={requestMutation.isPending}>
            {requestMutation.isPending ? "Saving…" : "Assign Verifier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Approve / Reject Dialog ────────────────────────────────────────────────────

function ApproveRejectDialog({
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
  const isReApproval = action === "verify" && entry.verificationStatus === "rejected";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={cn(
            "flex items-center gap-2",
            action === "verify" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
          )}>
            {action === "verify"
              ? <CheckCircle2 className="w-5 h-5" />
              : <XCircle className="w-5 h-5" />}
            {isReApproval ? "Re-approve Contribution" : action === "verify" ? "Approve Contribution" : "Reject Contribution"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <p className="font-medium">{entry.partnerName}</p>
            <p className="text-lg font-semibold tabular-nums">{formatINR(entry.amount)}</p>
            <p className="text-xs text-muted-foreground">Dated {entry.contributionDate} • {entry.projectName}</p>
          </div>

          {isReApproval && (
            <div className="flex items-start gap-2 p-2 rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This contribution was previously rejected. Re-approving will set it to verified and make it eligible to affect ownership guidance.
            </div>
          )}

          {action === "reject" && (
            <div className="flex items-start gap-2 p-2 rounded-lg border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Rejected contributions do not affect ownership guidance and will appear as a governance alert until resolved.
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              {action === "reject" ? "Rejection remarks" : "Notes"}{" "}
              {action === "reject" && <span className="text-red-500">*</span>}
              {action === "verify" && <span className="text-xs text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                action === "verify"
                  ? "Approval notes or verification reference…"
                  : "Reason for rejection (required for audit trail)…"
              }
              rows={3}
            />
          </div>

          {/* OTP placeholder */}
          <div className="flex items-center gap-2 p-2 rounded-lg border bg-slate-50 dark:bg-slate-900/40 text-xs text-slate-500">
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>OTP verification — counterparty authentication will be available in a future release.</span>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || (action === "reject" && !notes.trim())}
            variant={action === "verify" ? "default" : "destructive"}
          >
            {isPending ? "Processing…" : isReApproval ? "Re-approve" : action === "verify" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record Contribution Dialog ─────────────────────────────────────────────────

function RecordContributionDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [designatedVerifierId, setDesignatedVerifierId] = useState("");
  const [error, setError] = useState("");

  const createMutation = useCreateContribution();
  const { data: projectsData } = useListProjects();
  const { data: usersData } = useListUsers();
  const projects = useMemo(() => projectsData ?? [], [projectsData]);
  const users = useMemo(() => usersData ?? [], [usersData]);

  const handleSubmit = async () => {
    setError("");
    if (!projectId) return setError("Project is required");
    if (!partnerName.trim()) return setError("Contributing partner name is required");
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return setError("Amount must be a positive number");
    if (!date) return setError("Contribution date is required");

    try {
      await createMutation.mutateAsync({
        data: {
          projectId,
          partnerName: partnerName.trim(),
          contributionType: "economic_investment",
          amount: parsedAmount,
          contributionDate: date,
          remarks: remarks || undefined,
          referenceNumber: referenceNumber || undefined,
          designatedVerifierId: designatedVerifierId || undefined,
        },
      });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "An error occurred");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <TrendingUp className="w-5 h-5" />
            Record Economic Contribution
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-medium flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Economic Investment Contribution</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Cash or in-kind capital invested by a partner</li>
              <li>Affects ownership guidance when verified</li>
              <li>Requires counterparty verification before becoming effective</li>
              <li>Rejected contributions surface as governance alerts</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label>Project <span className="text-red-500">*</span></Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select project…" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Contributing Partner <span className="text-red-500">*</span></Label>
            <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (₹) <span className="text-red-500">*</span></Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Contribution Date <span className="text-red-500">*</span></Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reference Number <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Bank transfer ID, voucher number…" />
          </div>

          <div className="space-y-1.5">
            <Label>Remarks <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Nature of investment, tranche details…" />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-blue-600" />
              Assign Verifier <span className="text-xs text-muted-foreground">(optional — can be set later)</span>
            </Label>
            <Select value={designatedVerifierId} onValueChange={setDesignatedVerifierId}>
              <SelectTrigger><SelectValue placeholder="No verifier assigned yet…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— No verifier —</SelectItem>
                {users.filter((u) => !!u.id).map((u) => (
                  <SelectItem key={u.id!} value={u.id!}>
                    {u.displayName ?? u.clerkUserId} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">The designated verifier will see this as a pending task.</p>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Recording…" : "Record Contribution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Contribution Row ───────────────────────────────────────────────────────────

function ContributionRow({
  entry,
  isAdminOrDev,
  isAdmin,
  isDesignatedVerifier,
  onRefresh,
}: {
  entry: ContributionEntry;
  isAdminOrDev: boolean;
  isAdmin: boolean;
  isDesignatedVerifier: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [assignDialog, setAssignDialog] = useState(false);
  const [actionDialog, setActionDialog] = useState<"verify" | "reject" | null>(null);
  const submitMutation = useSubmitContributionForVerification();
  const canApproveReject = isAdminOrDev || isDesignatedVerifier;

  const isRejected = entry.verificationStatus === "rejected";
  const isPending = entry.verificationStatus === "pending_verification";

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <TableRow
          className={cn(
            "cursor-pointer hover:bg-muted/40",
            isRejected && "bg-red-50/60 dark:bg-red-950/10",
          )}
        >
          <TableCell>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-sm font-medium text-left w-full">
                {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                {isRejected && (
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>Rejected — governance alert raised</TooltipContent>
                  </Tooltip>
                )}
                {entry.partnerName}
              </button>
            </CollapsibleTrigger>
          </TableCell>
          <TableCell className="text-right tabular-nums font-medium">{formatINR(entry.amount)}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{entry.contributionDate}</TableCell>
          <TableCell>
            <VerificationBadge status={entry.verificationStatus} />
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {entry.designatedVerifierName ?? (
              <span className="text-slate-400 italic text-xs">Unassigned</span>
            )}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">{entry.projectName ?? "—"}</TableCell>
          <TableCell>
            <div className="flex gap-1 justify-end">
              {entry.verificationStatus === "draft" && isAdminOrDev && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAssignDialog(true)}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        {entry.designatedVerifierId ? "Change" : "Assign"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Assign/change counterparty verifier</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => { await submitMutation.mutateAsync({ id: entry.id }); onRefresh(); }}
                        disabled={submitMutation.isPending}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Submit
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Submit for verification</TooltipContent>
                  </Tooltip>
                </>
              )}
              {isPending && isAdminOrDev && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAssignDialog(true)}
                      className="h-7 px-2 text-xs gap-1"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Re-assign
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Change the designated verifier</TooltipContent>
                </Tooltip>
              )}
              {(isPending || isRejected) && canApproveReject && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActionDialog("verify")}
                    className="h-7 px-2 text-xs gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {isRejected ? "Re-approve" : "Approve"}
                  </Button>
                  {!isRejected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActionDialog("reject")}
                      className="h-7 px-2 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </Button>
                  )}
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
        <CollapsibleContent asChild>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={7} className="bg-muted/20 border-b">
              <div className="py-3 px-2 space-y-3">
                <div className="grid grid-cols-3 gap-4 text-xs">
                  {entry.remarks && (
                    <div>
                      <span className="text-muted-foreground block">Remarks</span>
                      <span>{entry.remarks}</span>
                    </div>
                  )}
                  {entry.referenceNumber && (
                    <div>
                      <span className="text-muted-foreground block">Reference</span>
                      <span className="font-mono">{entry.referenceNumber}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground block">Phase at recording</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
                      <Clock className="w-3 h-3" />
                      {entry.lifecyclePhaseSnapshot}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Recorded by</span>
                    <span>{entry.recordedByName ?? "—"}</span>
                  </div>
                  {entry.verifiedByName && (
                    <div>
                      <span className="text-muted-foreground block">
                        {entry.verificationStatus === "rejected" ? "Rejected by" : "Verified by"}
                      </span>
                      <span>{entry.verifiedByName}</span>
                      {entry.verifiedAt && (
                        <span className="text-muted-foreground block">
                          {new Date(entry.verifiedAt).toLocaleDateString("en-IN")}
                        </span>
                      )}
                    </div>
                  )}
                  {entry.verifierNotes && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground block">
                        {entry.verificationStatus === "rejected" ? "Rejection remarks" : "Verifier notes"}
                      </span>
                      <span className="italic">{entry.verifierNotes}</span>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Verification Timeline
                  </p>
                  <VerificationTimeline contributionId={entry.id} />
                </div>
              </div>
            </TableCell>
          </TableRow>
        </CollapsibleContent>
      </Collapsible>

      {assignDialog && (
        <AssignVerifierDialog entry={entry} onClose={() => setAssignDialog(false)} onSuccess={onRefresh} />
      )}
      {actionDialog && (
        <ApproveRejectDialog
          entry={entry}
          action={actionDialog}
          onClose={() => setActionDialog(null)}
          onSuccess={onRefresh}
        />
      )}
    </>
  );
}

// ── Pending Verification Card ──────────────────────────────────────────────────

function PendingCard({
  entry,
  isAdminOrDev,
  isDesignatedVerifier,
  onRefresh,
}: {
  entry: ContributionEntry;
  isAdminOrDev: boolean;
  isDesignatedVerifier: boolean;
  onRefresh: () => void;
}) {
  const [actionDialog, setActionDialog] = useState<"verify" | "reject" | null>(null);

  return (
    <>
      <Card className="border-amber-200 dark:border-amber-800">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-sm">{entry.partnerName}</p>
              <p className="text-xs text-muted-foreground">{entry.projectName}</p>
            </div>
            <VerificationBadge status={entry.verificationStatus} />
          </div>

          <div className="flex items-end gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Amount</p>
              <p className="text-xl font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                {formatINR(entry.amount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Dated</p>
              <p className="text-sm">{entry.contributionDate}</p>
            </div>
          </div>

          {entry.remarks && (
            <p className="text-xs text-muted-foreground italic">"{entry.remarks}"</p>
          )}

          {/* OTP placeholder */}
          <div className="flex items-center gap-2 p-2 rounded border bg-slate-50 dark:bg-slate-900/40 text-xs text-slate-500">
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <div className="flex-1">OTP verification — coming soon</div>
            <Button size="sm" variant="outline" className="h-6 text-xs px-2" disabled>
              Send OTP
            </Button>
          </div>

          <div className="flex gap-2 pt-1 border-t">
            <Button
              size="sm"
              onClick={() => setActionDialog("verify")}
              className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setActionDialog("reject")}
              className="flex-1 gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>

      {actionDialog && (
        <ApproveRejectDialog
          entry={entry}
          action={actionDialog}
          onClose={() => setActionDialog(null)}
          onSuccess={onRefresh}
        />
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function EconomicContributions() {
  const { role } = useRole();
  const { data: myProfile } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const myUserId = myProfile?.id ?? null;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [showRecord, setShowRecord] = useState(false);

  const pendingQuery = useListPendingVerificationContributions(
    {},
    { query: { queryKey: getListPendingVerificationContributionsQueryKey({}) } },
  );

  const allQuery = useListContributions(
    { contributionType: "economic_investment" },
    { query: { queryKey: getListContributionsQueryKey({ contributionType: "economic_investment" }) } },
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListPendingVerificationContributionsQueryKey({}) });
    qc.invalidateQueries({ queryKey: getListContributionsQueryKey({ contributionType: "economic_investment" }) });
  }

  const pendingItems = pendingQuery.data?.contributions ?? [];
  const allItems = allQuery.data?.contributions ?? [];

  const rejectedItems = allItems.filter((c) => c.verificationStatus === "rejected");
  const verifiedItems = allItems.filter((c) => c.verificationStatus === "verified");
  const draftItems = allItems.filter((c) => c.verificationStatus === "draft");

  const verifiedTotal = verifiedItems.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/contributions")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-600" />
              Economic Contributions
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Capital investments by partners — require counterparty verification to affect ownership guidance.
            </p>
          </div>
        </div>
        {isAdminOrDev && (
          <Button onClick={() => setShowRecord(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            Record Contribution
          </Button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Recorded</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{allItems.length}</p>
            <p className="text-xs text-muted-foreground">entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Review</p>
            <p className={cn("text-2xl font-semibold mt-1 tabular-nums", pendingItems.length > 0 && "text-amber-600 dark:text-amber-400")}>
              {pendingItems.length}
            </p>
            <p className="text-xs text-muted-foreground">awaiting approval</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Verified Total</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatINR(verifiedTotal)}
            </p>
            <p className="text-xs text-muted-foreground">affects ownership guidance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Rejected</p>
            <p className={cn("text-2xl font-semibold mt-1 tabular-nums", rejectedItems.length > 0 && "text-red-600 dark:text-red-400")}>
              {rejectedItems.length}
            </p>
            <p className="text-xs text-muted-foreground">governance alert raised</p>
          </CardContent>
        </Card>
      </div>

      {/* Rejected governance alert */}
      {rejectedItems.length > 0 && (
        <Card className="border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-950/10">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-red-800 dark:text-red-300 text-sm">
                {rejectedItems.length} rejected contribution{rejectedItems.length > 1 ? "s require" : " requires"} resolution
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                Rejected contributions do not affect ownership guidance and have raised governance alerts. The designated verifier (or admin) can re-approve them after review.
              </p>
              <div className="mt-2 space-y-1">
                {rejectedItems.slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                    <XCircle className="w-3 h-3 shrink-0" />
                    <span>{c.partnerName} — {formatINR(c.amount)} ({c.projectName})</span>
                    {c.verifierNotes && <span className="italic text-red-600">"{c.verifierNotes}"</span>}
                  </div>
                ))}
                {rejectedItems.length > 3 && (
                  <p className="text-xs text-red-600 dark:text-red-400">…and {rejectedItems.length - 3} more</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={pendingItems.length > 0 ? "pending" : "all"}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="w-3.5 h-3.5" />
            Pending Verification
            {pendingItems.length > 0 && (
              <Badge className="ml-1 h-5 w-5 rounded-full p-0 justify-center text-xs bg-amber-500">
                {pendingItems.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            All Economic Contributions
          </TabsTrigger>
        </TabsList>

        {/* Pending Verification tab */}
        <TabsContent value="pending" className="mt-4">
          {pendingQuery.isLoading ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Loading…</CardContent></Card>
          ) : pendingItems.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/50" />
                <p className="text-sm font-medium">No pending verifications</p>
                <p className="text-xs text-muted-foreground">All economic contributions are either verified, in draft, or rejected.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {pendingItems.length} contribution{pendingItems.length > 1 ? "s" : ""} awaiting your verification.
                {!isAdminOrDev && " Only items designated to you are shown."}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingItems.map((entry) => (
                  <PendingCard
                    key={entry.id}
                    entry={entry}
                    isAdminOrDev={isAdminOrDev}
                    isDesignatedVerifier={entry.designatedVerifierId === myUserId}
                    onRefresh={invalidate}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* All contributions tab */}
        <TabsContent value="all" className="mt-4">
          {allQuery.isLoading ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Loading…</CardContent></Card>
          ) : allItems.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center space-y-2">
                <TrendingUp className="w-8 h-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm font-medium">No economic contributions recorded yet</p>
                {isAdminOrDev && (
                  <Button onClick={() => setShowRecord(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Record First Contribution
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Partner</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Verifier</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allItems.map((entry) => (
                      <ContributionRow
                        key={entry.id}
                        entry={entry}
                        isAdminOrDev={isAdminOrDev}
                        isAdmin={isAdmin}
                        isDesignatedVerifier={entry.designatedVerifierId === myUserId}
                        onRefresh={invalidate}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {showRecord && (
        <RecordContributionDialog
          open={showRecord}
          onClose={() => setShowRecord(false)}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}
