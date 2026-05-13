import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPendingVerifications,
  useGetExpenditureVerification,
  useApproveExpenditureVerification,
  useRejectExpenditureVerification,
  useRequestExpenditureVerificationOtp,
  useConfirmExpenditureVerificationOtp,
  getListPendingVerificationsQueryKey,
  getGetExpenditureVerificationQueryKey,
  getListExpendituresQueryKey,
  getGetExpenditureSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  ExpenditureVerificationDetail,
  PendingVerificationItem,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Shield,
  ChevronDown,
  ChevronUp,
  User,
  ArrowRight,
  RotateCcw,
  KeyRound,
  Info,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EVENT_META: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  submitted: {
    label: "Submitted",
    icon: <ArrowRight className="h-3.5 w-3.5" />,
    color: "text-blue-400 bg-blue-900/40",
  },
  resubmitted: {
    label: "Re-submitted",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
    color: "text-blue-400 bg-blue-900/40",
  },
  routing_assigned: {
    label: "Routed",
    icon: <User className="h-3.5 w-3.5" />,
    color: "text-slate-400 bg-slate-700/60",
  },
  approved: {
    label: "Approved",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    color: "text-emerald-400 bg-emerald-900/40",
  },
  rejected: {
    label: "Rejected",
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: "text-red-400 bg-red-900/40",
  },
  otp_requested: {
    label: "OTP Sent",
    icon: <KeyRound className="h-3.5 w-3.5" />,
    color: "text-violet-400 bg-violet-900/40",
  },
  otp_verified: {
    label: "OTP Verified",
    icon: <KeyRound className="h-3.5 w-3.5" />,
    color: "text-emerald-400 bg-emerald-900/40",
  },
};

const REQUEST_STATUS_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Awaiting Verification",
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
  cancelled: {
    label: "Cancelled",
    color: "bg-slate-700 text-slate-400",
    icon: <XCircle className="h-3 w-3" />,
  },
};

function RequestStatusBadge({ status }: { status: string }) {
  const meta = REQUEST_STATUS_META[status] ?? REQUEST_STATUS_META.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ── OTP Dialog ────────────────────────────────────────────────────────────────

function OtpDialog({
  expenditureId,
  open,
  onClose,
}: {
  expenditureId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [otpCode, setOtpCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [error, setError] = useState<string | null>(null);

  const requestMutation = useRequestExpenditureVerificationOtp({
    mutation: {
      onSuccess: (data) => {
        setGeneratedCode(data.otpCode ?? null);
        setExpiresAt(data.expiresAt ?? null);
        setStep("confirm");
        setError(null);
      },
      onError: (err: unknown) => {
        setError((err as { message?: string })?.message ?? "Failed to send OTP");
      },
    },
  });

  const confirmMutation = useConfirmExpenditureVerificationOtp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingVerificationsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetExpenditureVerificationQueryKey(expenditureId),
        });
        queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
        onClose();
        setStep("request");
        setOtpCode("");
        setGeneratedCode(null);
      },
      onError: (err: unknown) => {
        setError((err as { message?: string })?.message ?? "Incorrect OTP");
      },
    },
  });

  function handleClose() {
    onClose();
    setStep("request");
    setOtpCode("");
    setGeneratedCode(null);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-slate-100 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-violet-400" />
            OTP Verification
          </DialogTitle>
        </DialogHeader>

        {step === "request" ? (
          <>
            <div className="rounded-lg bg-violet-900/20 border border-violet-700/30 p-3 text-sm text-violet-300 flex gap-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                A 6-digit OTP will be generated. In production this would be
                sent via SMS to the designated verifier's registered mobile number.
              </span>
            </div>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <DialogFooter className="mt-2">
              <Button
                variant="ghost"
                onClick={handleClose}
                className="text-slate-400"
              >
                Cancel
              </Button>
              <Button
                className="bg-violet-700 hover:bg-violet-600 text-white"
                disabled={requestMutation.isPending}
                onClick={() =>
                  requestMutation.mutate({ id: expenditureId })
                }
              >
                {requestMutation.isPending ? "Sending…" : "Generate OTP"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {generatedCode && (
              <div className="rounded-lg bg-emerald-900/20 border border-emerald-700/30 p-3 flex flex-col gap-1">
                <p className="text-xs text-emerald-400 font-medium">
                  PLACEHOLDER — OTP code (visible in dev only):
                </p>
                <p className="text-3xl font-mono font-bold text-emerald-300 tracking-widest">
                  {generatedCode}
                </p>
                {expiresAt && (
                  <p className="text-xs text-slate-400">
                    Expires: {formatDate(expiresAt)}
                  </p>
                )}
              </div>
            )}
            <p className="text-sm text-slate-400">Enter the 6-digit OTP:</p>
            <Input
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="text-center text-2xl tracking-widest font-mono bg-slate-700 border-slate-600 text-slate-100"
              maxLength={6}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={handleClose} className="text-slate-400">
                Cancel
              </Button>
              <Button
                className="bg-violet-700 hover:bg-violet-600 text-white"
                disabled={otpCode.length !== 6 || confirmMutation.isPending}
                onClick={() =>
                  confirmMutation.mutate({
                    id: expenditureId,
                    data: { otpCode },
                  })
                }
              >
                {confirmMutation.isPending ? "Verifying…" : "Confirm OTP"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Approve Dialog ────────────────────────────────────────────────────────────

function ApproveDialog({
  item,
  open,
  onClose,
}: {
  item: PendingVerificationItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useApproveExpenditureVerification({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingVerificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
        if (item)
          queryClient.invalidateQueries({
            queryKey: getGetExpenditureVerificationQueryKey(item.expenditure.id),
          });
        onClose();
        setNotes("");
      },
      onError: (err: unknown) => {
        setError((err as { message?: string })?.message ?? "Failed to approve");
      },
    },
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-400" />
            Approve Expenditure
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-700/50 p-3 space-y-1">
            <p className="text-slate-300 font-medium">{item.expenditure.description}</p>
            <p className="text-slate-400">
              {item.expenditure.projectName} ·{" "}
              <span className="text-emerald-400 font-semibold">
                {formatINR(Number(item.expenditure.amount))}
              </span>
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Approval notes (optional)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any comments…"
              className="bg-slate-700 border-slate-600 text-slate-100"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} className="text-slate-400">
            Cancel
          </Button>
          <Button
            className="bg-emerald-700 hover:bg-emerald-600 text-white"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                id: item.expenditure.id,
                data: { notes: notes || undefined },
              })
            }
          >
            {mutation.isPending ? "Approving…" : "Confirm Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

function VerifierRejectDialog({
  item,
  open,
  onClose,
}: {
  item: PendingVerificationItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useRejectExpenditureVerification({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingVerificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListExpendituresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetExpenditureSummaryQueryKey() });
        if (item)
          queryClient.invalidateQueries({
            queryKey: getGetExpenditureVerificationQueryKey(item.expenditure.id),
          });
        onClose();
        setNotes("");
      },
      onError: (err: unknown) => {
        setError((err as { message?: string })?.message ?? "Failed to reject");
      },
    },
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-400" />
            Reject Expenditure
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-700/50 p-3 space-y-1">
            <p className="text-slate-300 font-medium">{item.expenditure.description}</p>
            <p className="text-slate-400">
              {item.expenditure.projectName} ·{" "}
              <span className="text-red-400 font-semibold">
                {formatINR(Number(item.expenditure.amount))}
              </span>
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Rejection reason <span className="text-red-400">*</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain why this expenditure is being rejected…"
              rows={3}
              className="w-full rounded-md bg-slate-700 border border-slate-600 text-slate-100 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
          <div className="rounded-lg bg-amber-900/20 border border-amber-700/30 p-3 text-xs text-amber-300 flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              The submitter will be notified and can re-submit after addressing
              the issue. Unresolved rejections block the project's maturity
              declaration.
            </span>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} className="text-slate-400">
            Cancel
          </Button>
          <Button
            className="bg-red-700 hover:bg-red-600 text-white"
            disabled={!notes.trim() || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                id: item.expenditure.id,
                data: { notes },
              })
            }
          >
            {mutation.isPending ? "Rejecting…" : "Confirm Rejection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Timeline Drawer ───────────────────────────────────────────────────────────

function VerificationTimeline({
  expenditureId,
  onApprove,
  onReject,
  onOtp,
  item,
}: {
  expenditureId: string;
  onApprove: () => void;
  onReject: () => void;
  onOtp: () => void;
  item: PendingVerificationItem;
}) {
  const { role } = useRole();
  const isAdminOrDev = role === "admin" || role === "developer";

  const { data, isLoading } = useGetExpenditureVerification(expenditureId, {
    query: {
      queryKey: getGetExpenditureVerificationQueryKey(expenditureId),
    },
  });

  const request = data?.request ?? null;
  const events = data?.events ?? [];
  const isPending = request?.status === "pending";
  const isRejected = request?.status === "rejected";

  return (
    <div className="border-t border-slate-700 bg-slate-800/60 px-4 pb-4 pt-3 space-y-4">
      {/* Routing info */}
      {request && (
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
              Routing
            </p>
            <p className="text-sm text-slate-200">{request.routingReason}</p>
            {request.requiredVerifierName && (
              <p className="text-xs text-slate-400">
                Assigned to:{" "}
                <span className="text-slate-200">{request.requiredVerifierName}</span>
                {" "}
                <span className="text-slate-500">
                  ({request.requiredVerifierRole})
                </span>
              </p>
            )}
          </div>
          <RequestStatusBadge status={request.status} />
        </div>
      )}

      {/* Rejection notes */}
      {isRejected && request?.resolverNotes && (
        <div className="rounded-lg bg-red-900/20 border border-red-700/30 p-3 text-sm">
          <p className="text-xs text-red-400 font-medium mb-1">Rejection reason:</p>
          <p className="text-slate-300">{request.resolverNotes}</p>
          <p className="text-xs text-slate-500 mt-1">
            — {request.resolvedByName ?? "Unknown"},{" "}
            {request.resolvedAt ? relativeTime(request.resolvedAt) : ""}
          </p>
        </div>
      )}

      {/* Timeline events */}
      {isLoading ? (
        <p className="text-xs text-slate-500">Loading timeline…</p>
      ) : events.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
            Verification Timeline
          </p>
          <ol className="relative border-l border-slate-700 ml-2 space-y-3">
            {[...events].reverse().map((ev) => {
              const meta = EVENT_META[ev.eventType] ?? {
                label: ev.eventType,
                icon: <Info className="h-3.5 w-3.5" />,
                color: "text-slate-400 bg-slate-700/60",
              };
              return (
                <li key={ev.id} className="ml-4">
                  <span
                    className={`absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full ${meta.color}`}
                  >
                    {meta.icon}
                  </span>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">
                        {meta.label}
                      </p>
                      {ev.notes && (
                        <p className="text-xs text-slate-400 mt-0.5">{ev.notes}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ev.actorName ?? "System"}{" "}
                        {ev.actorRole && (
                          <span className="text-slate-600">· {ev.actorRole}</span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {relativeTime(ev.createdAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {/* Action row for verifiers */}
      {(isPending || isRejected) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {isPending && (
            <>
              <Button
                size="sm"
                className="bg-emerald-700 hover:bg-emerald-600 text-white"
                onClick={onApprove}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-700 text-red-400 hover:bg-red-900/30"
                onClick={onReject}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </Button>
              {(isAdminOrDev ||
                role === "landowner") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-violet-700 text-violet-400 hover:bg-violet-900/30"
                  onClick={onOtp}
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                  Verify via OTP
                </Button>
              )}
            </>
          )}
          {isRejected && isAdminOrDev && (
            <Button
              size="sm"
              className="bg-emerald-700 hover:bg-emerald-600 text-white"
              onClick={onApprove}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Override — Approve Anyway
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pending Item Row ──────────────────────────────────────────────────────────

function PendingItemRow({
  item,
  onApprove,
  onReject,
}: {
  item: PendingVerificationItem;
  onApprove: (item: PendingVerificationItem) => void;
  onReject: (item: PendingVerificationItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);

  const exp = item.expenditure;
  const req = item.request;

  return (
    <>
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <button
          type="button"
          className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-750 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-slate-100 truncate">
                {exp.description}
              </span>
              <span className="text-xs text-amber-400 font-semibold">
                {formatINR(Number(exp.amount))}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
              <span>{exp.projectName ?? "—"}</span>
              <span>·</span>
              <span className="capitalize">{exp.category.replace(/_/g, " ")}</span>
              <span>·</span>
              <span>{exp.expenditureDate}</span>
              {req.requiredVerifierRole && (
                <>
                  <span>·</span>
                  <span>
                    Needs{" "}
                    <span className="text-slate-300 capitalize">
                      {req.requiredVerifierRole.replace(/_/g, " ")}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RequestStatusBadge status={req.status} />
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-500" />
            )}
          </div>
        </button>

        {expanded && (
          <VerificationTimeline
            expenditureId={exp.id}
            item={item}
            onApprove={() => onApprove(item)}
            onReject={() => onReject(item)}
            onOtp={() => setOtpOpen(true)}
          />
        )}
      </div>
      <OtpDialog
        expenditureId={exp.id}
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
      />
    </>
  );
}

// ── Main Tab Component ────────────────────────────────────────────────────────

export default function ExpenditureVerificationTab() {
  const { role } = useRole();
  const isVerifier =
    role === "admin" ||
    role === "developer" ||
    role === "landowner";

  const { data, isLoading } = useListPendingVerifications({
    query: {
      queryKey: getListPendingVerificationsQueryKey(),
      enabled: isVerifier,
    },
  });

  const items: PendingVerificationItem[] = data?.items ?? [];

  const [approveItem, setApproveItem] = useState<PendingVerificationItem | null>(null);
  const [rejectItem, setRejectItem] = useState<PendingVerificationItem | null>(null);

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="rounded-xl bg-slate-800 border border-slate-700 p-4 flex items-start gap-3">
        <Shield className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-200">
            Expenditure Verification System
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            All submitted expenditures are routed to the appropriate verifier
            based on role (developer-submitted → landowner verifies;
            landowner-submitted → developer verifies; 50% revenue agreements →
            always landowner). Rejected records block maturity declaration
            until resolved.
          </p>
        </div>
      </div>

      {/* Role-specific message for non-verifiers */}
      {!isVerifier && (
        <div className="rounded-xl bg-slate-800 border border-slate-700 p-6 text-center">
          <Clock className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            Your submitted expenditures are awaiting review by a designated
            verifier. You can track status in the Overview tab.
          </p>
        </div>
      )}

      {/* Pending approval queue */}
      {isVerifier && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-100 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" />
              Pending Your Verification
              {items.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-800/60 text-amber-200 text-xs font-bold px-1.5">
                  {items.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                Loading pending verifications…
              </p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
                <p className="text-sm text-slate-400">
                  No pending verifications — all clear!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <PendingItemRow
                    key={item.request.id}
                    item={item}
                    onApprove={setApproveItem}
                    onReject={setRejectItem}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <ApproveDialog
        item={approveItem}
        open={!!approveItem}
        onClose={() => setApproveItem(null)}
      />
      <VerifierRejectDialog
        item={rejectItem}
        open={!!rejectItem}
        onClose={() => setRejectItem(null)}
      />
    </div>
  );
}
