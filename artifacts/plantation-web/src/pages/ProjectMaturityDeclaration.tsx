import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useGetProjectMaturity,
  useGetMaturityBlockers,
  useInitiateMaturityDeclaration,
  useCancelMaturityDeclaration,
  useSendMaturityOtp,
  useVerifyMaturityOtp,
  getGetProjectMaturityQueryKey,
  getGetMaturityBlockersQueryKey,
  type MaturityDeclaration,
  type MaturityOtpVerification,
  type MaturityBlockerItem,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useRole } from "@/contexts/RoleContext";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Shield,
  User,
  Building2,
  Lock,
  Send,
  ArrowLeft,
  RefreshCw,
  KeyRound,
  ChevronRight,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Blocker Icons ──────────────────────────────────────────────────────────

const BLOCKER_ICON: Record<string, React.ReactNode> = {
  already_mature: <Lock className="w-4 h-4" />,
  active_declaration: <RefreshCw className="w-4 h-4" />,
  pending_agreement: <Building2 className="w-4 h-4" />,
  disputed_claimant: <AlertTriangle className="w-4 h-4" />,
  no_agreements: <Building2 className="w-4 h-4" />,
};

// ── Declaration status helpers ──────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  pending_otp: {
    label: "Awaiting Verification",
    className: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-gray-100 text-gray-600 border-gray-200",
    icon: <Ban className="w-3.5 h-3.5" />,
  },
};

const OTP_STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Pending",
    className: "bg-gray-100 text-gray-600",
    icon: <Clock className="w-3 h-3" />,
  },
  sent: {
    label: "OTP Sent",
    className: "bg-blue-100 text-blue-700",
    icon: <Send className="w-3 h-3" />,
  },
  verified: {
    label: "Verified",
    className: "bg-emerald-100 text-emerald-700",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700",
    icon: <XCircle className="w-3 h-3" />,
  },
  expired: {
    label: "Expired",
    className: "bg-orange-100 text-orange-700",
    icon: <Clock className="w-3 h-3" />,
  },
};

// ── Sub-components ──────────────────────────────────────────────────────────

function BlockersPanel({
  blockers,
  canProceed,
  isLoading,
}: {
  blockers: MaturityBlockerItem[];
  canProceed: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Shield
            className={cn(
              "w-5 h-5",
              canProceed ? "text-emerald-600" : "text-red-500",
            )}
          />
          <CardTitle className="font-serif text-base">
            Pre-Declaration Verification Check
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {canProceed ? (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-100">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">
              All pre-conditions are satisfied. You may proceed with the maturity declaration.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-3">
              The following issues must be resolved before a maturity declaration can be initiated:
            </p>
            {blockers.map((b, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg border border-red-100 bg-red-50"
              >
                <span className="text-red-500 mt-0.5 shrink-0">
                  {BLOCKER_ICON[b.type] ?? <XCircle className="w-4 h-4" />}
                </span>
                <p className="text-sm text-red-800">{b.message}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OtpVerificationCard({
  verification,
  declarationId,
  projectId,
  isEditable,
  onUpdate,
}: {
  verification: MaturityOtpVerification;
  declarationId: string;
  projectId: string;
  isEditable: boolean;
  onUpdate: () => void;
}) {
  const [otpInput, setOtpInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sendMutation = useSendMaturityOtp();
  const verifyMutation = useVerifyMaturityOtp();

  const cfg = OTP_STATUS_CONFIG[verification.status] ?? OTP_STATUS_CONFIG.pending;

  function handleSend() {
    setError(null);
    sendMutation.mutate(
      { id: projectId, verificationId: verification.id },
      {
        onSuccess: onUpdate,
        onError: () => setError("Failed to send OTP"),
      },
    );
  }

  function handleVerify() {
    if (!otpInput.trim()) return;
    setError(null);
    verifyMutation.mutate(
      {
        id: projectId,
        verificationId: verification.id,
        data: { otpCode: otpInput.trim() },
      },
      {
        onSuccess: () => {
          setOtpInput("");
          onUpdate();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Verification failed";
          setError(msg);
        },
      },
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        verification.status === "verified"
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-gray-200 bg-white",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
              verification.partyRole === "developer"
                ? "bg-violet-100 text-violet-600"
                : "bg-sky-100 text-sky-600",
            )}
          >
            {verification.partyRole === "developer" ? (
              <User className="w-4 h-4" />
            ) : (
              <Building2 className="w-4 h-4" />
            )}
          </div>
          <div>
            <p className="font-medium text-sm">{verification.partyName}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {verification.partyRole}
              {verification.partyPhone && ` · ${verification.partyPhone}`}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
            cfg.className,
          )}
        >
          {cfg.icon}
          {cfg.label}
        </span>
      </div>

      {/* Dev mode OTP placeholder */}
      {verification.otpCodePlaceholder && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50">
          <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800">
            <span className="font-semibold">Dev mode — OTP code:</span>{" "}
            <span className="font-mono font-bold tracking-widest">
              {verification.otpCodePlaceholder}
            </span>
          </p>
        </div>
      )}

      {/* Expiry warning */}
      {verification.expiresAt &&
        verification.status === "sent" &&
        new Date(verification.expiresAt) > new Date() && (
          <p className="text-xs text-muted-foreground">
            Expires{" "}
            {new Date(verification.expiresAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}

      {/* OTP input */}
      {isEditable && verification.status === "sent" && (
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Enter 6-digit OTP</Label>
            <Input
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="font-mono tracking-widest text-center text-base h-9"
              maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            />
          </div>
          <Button
            size="sm"
            onClick={handleVerify}
            disabled={otpInput.length !== 6 || verifyMutation.isPending}
          >
            {verifyMutation.isPending ? "Verifying…" : "Verify"}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Action buttons */}
      {isEditable && verification.status !== "verified" && (
        <div className="flex gap-2 pt-1">
          {(verification.status === "pending" ||
            verification.status === "failed" ||
            verification.status === "expired") && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={handleSend}
              disabled={sendMutation.isPending}
            >
              <Send className="w-3 h-3" />
              {verification.status === "failed" || verification.status === "expired"
                ? "Resend OTP"
                : "Send OTP"}
            </Button>
          )}
          {verification.status === "sent" && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 text-xs text-muted-foreground"
              onClick={handleSend}
              disabled={sendMutation.isPending}
            >
              <RefreshCw className="w-3 h-3" />
              Resend
            </Button>
          )}
        </div>
      )}

      {verification.status === "verified" && verification.verifiedAt && (
        <p className="text-xs text-emerald-600 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Verified{" "}
          {new Date(verification.verifiedAt).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}

const TIMELINE_STEPS = [
  {
    key: "initiated",
    label: "Declaration Initiated",
    desc: "Pre-conditions verified. OTP codes generated for all parties.",
  },
  {
    key: "otp_pending",
    label: "Party Verifications",
    desc: "Developer and each landowner must verify their OTP.",
  },
  {
    key: "ownership_snapshot",
    label: "Ownership Freeze",
    desc: "Ownership becomes permanently frozen upon completion.",
  },
  {
    key: "lifecycle_advanced",
    label: "Lifecycle Advanced",
    desc: "Project status transitions to Mature Production.",
  },
];

function MaturityTimeline({ declaration }: { declaration: MaturityDeclaration | null }) {
  const activeStep = !declaration
    ? -1
    : declaration.status === "completed"
      ? 3
      : declaration.status === "cancelled"
        ? -1
        : 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-base">Workflow Steps</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {TIMELINE_STEPS.map((step, idx) => {
            const isDone = idx <= activeStep;
            const isCurrent = idx === activeStep + 1 || (activeStep === -1 && idx === 0);
            return (
              <div key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0",
                      isDone
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : isCurrent
                          ? "border-emerald-500 bg-white text-emerald-600"
                          : "border-gray-200 bg-white text-gray-300",
                    )}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <span className="text-xs font-bold">{idx + 1}</span>
                    )}
                  </div>
                  {idx < TIMELINE_STEPS.length - 1 && (
                    <div
                      className={cn(
                        "w-0.5 h-8 my-1",
                        isDone ? "bg-emerald-400" : "bg-gray-100",
                      )}
                    />
                  )}
                </div>
                <div className="pb-6">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      isDone
                        ? "text-emerald-700"
                        : isCurrent
                          ? "text-foreground"
                          : "text-gray-400",
                    )}
                  >
                    {step.label}
                  </p>
                  <p
                    className={cn(
                      "text-xs mt-0.5",
                      isDone || isCurrent
                        ? "text-muted-foreground"
                        : "text-gray-300",
                    )}
                  >
                    {step.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovalStatusPanel({ declaration }: { declaration: MaturityDeclaration }) {
  const total = declaration.otpVerifications.length;
  const verified = declaration.otpVerifications.filter((v) => v.status === "verified").length;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;

  const cfg = STATUS_CONFIG[declaration.status] ?? STATUS_CONFIG.pending_otp;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-serif text-base">Approval Status</CardTitle>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
              cfg.className,
            )}
          >
            {cfg.icon}
            {cfg.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>{verified} of {total} parties verified</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                pct === 100 ? "bg-emerald-500" : "bg-amber-400",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {declaration.status === "completed" && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle className="text-emerald-800 font-semibold text-sm">
              Maturity Declaration Completed
            </AlertTitle>
            <AlertDescription className="text-emerald-700 text-xs">
              All parties have verified. Project lifecycle has advanced to Mature Production.
              Ownership is now permanently frozen.
            </AlertDescription>
          </Alert>
        )}

        {declaration.status === "cancelled" && (
          <Alert className="border-gray-200 bg-gray-50">
            <Ban className="h-4 w-4 text-gray-500" />
            <AlertTitle className="text-gray-700 font-semibold text-sm">
              Declaration Cancelled
            </AlertTitle>
            <AlertDescription className="text-gray-600 text-xs">
              {declaration.cancellationReason
                ? `Reason: ${declaration.cancellationReason}`
                : "This declaration was cancelled before completion."}
              {declaration.cancelledAt && (
                <span className="block mt-0.5">
                  {new Date(declaration.cancelledAt).toLocaleString("en-IN")}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t">
          <p>
            <span className="font-medium">Initiated by:</span>{" "}
            {declaration.initiatedByName ?? "Unknown"}
          </p>
          <p>
            <span className="font-medium">Started:</span>{" "}
            {new Date(declaration.createdAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-2">
            Ownership snapshot: <em>Placeholder — calculations not yet implemented</em>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Cancel dialog ───────────────────────────────────────────────────────────

function CancelDialog({
  projectId,
  onSuccess,
}: {
  projectId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = useCancelMaturityDeclaration();

  function handleCancel() {
    mutation.mutate(
      { id: projectId, data: { reason: reason || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          setReason("");
          onSuccess();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/5">
          <Ban className="w-4 h-4" />
          Cancel Declaration
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Cancel Maturity Declaration</DialogTitle>
          <DialogDescription>
            This will cancel the active declaration. All pending OTP verifications will be discarded.
            You may initiate a new declaration afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Reason for cancellation (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this declaration is being cancelled…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            Keep Declaration
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Cancelling…" : "Cancel Declaration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Initiate dialog ─────────────────────────────────────────────────────────

function InitiateDialog({
  projectId,
  onSuccess,
}: {
  projectId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const mutation = useInitiateMaturityDeclaration();

  function handleInitiate() {
    mutation.mutate(
      { id: projectId, data: { remarks: remarks || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          setRemarks("");
          onSuccess();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <ChevronRight className="w-4 h-4" />
          Initiate Maturity Declaration
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Initiate Maturity Declaration</DialogTitle>
          <DialogDescription>
            This is a major governance event. OTP verification codes will be generated for the
            Project Developer and each Landowner. All parties must verify before maturity is confirmed.
          </DialogDescription>
        </DialogHeader>
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            Once all parties verify, the project lifecycle permanently advances to{" "}
            <strong>Mature Production</strong> and ownership is frozen. This cannot be reversed.
          </AlertDescription>
        </Alert>
        <div className="space-y-2 py-1">
          <Label>Remarks (optional)</Label>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add context for this maturity declaration…"
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleInitiate} disabled={mutation.isPending}>
            {mutation.isPending ? "Initiating…" : "Confirm & Generate OTPs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ProjectMaturityDeclaration() {
  const [, params] = useRoute("/projects/:id/maturity");
  const projectId = params?.id ?? "";
  const { role } = useRole();
  const queryClient = useQueryClient();

  const canAct = role === "admin" || role === "developer";

  const { data: project, isLoading: projectLoading } = useGetProject(projectId);

  const {
    data: declaration,
    isLoading: declarationLoading,
  } = useGetProjectMaturity(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectMaturityQueryKey(projectId), retry: false },
  });

  const { data: blockers, isLoading: blockersLoading } = useGetMaturityBlockers(
    projectId,
    { query: { enabled: !!projectId, queryKey: getGetMaturityBlockersQueryKey(projectId) } },
  );

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: getGetProjectMaturityQueryKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: getGetMaturityBlockersQueryKey(projectId) });
  }

  const isLoading = projectLoading || declarationLoading || blockersLoading;
  const hasActiveDeclaration = declaration && declaration.status === "pending_otp";
  const isCompleted = declaration?.status === "completed";
  const isCancelled = declaration?.status === "cancelled";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/projects/${projectId}`}>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {projectLoading ? "Project" : project?.name ?? "Project"}
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold">Maturity Declaration</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Governance workflow to advance project lifecycle to Mature Production
          </p>
        </div>
        {canAct && hasActiveDeclaration && (
          <CancelDialog projectId={projectId} onSuccess={invalidateAll} />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Left column */}
          <div className="space-y-6">
            {/* Blockers panel — always shown */}
            <BlockersPanel
              blockers={blockers?.blockers ?? []}
              canProceed={blockers?.canProceed ?? false}
              isLoading={blockersLoading}
            />

            {/* Initiate button — shown when no active declaration and can proceed */}
            {!hasActiveDeclaration && !isCompleted && canAct && (
              <div className="flex justify-center py-2">
                <InitiateDialog projectId={projectId} onSuccess={invalidateAll} />
              </div>
            )}

            {/* OTP Verification cards */}
            {(hasActiveDeclaration || isCompleted) && declaration && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="font-serif text-base">
                    Party Verifications
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Each party must receive and verify their OTP to confirm consent.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {declaration.otpVerifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No verification parties found.
                    </p>
                  ) : (
                    declaration.otpVerifications.map((v) => (
                      <OtpVerificationCard
                        key={v.id}
                        verification={v}
                        declarationId={declaration.id}
                        projectId={projectId}
                        isEditable={canAct && !!hasActiveDeclaration}
                        onUpdate={invalidateAll}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            )}

            {/* Cancelled state + re-initiate option */}
            {isCancelled && declaration && (
              <div className="space-y-4">
                <ApprovalStatusPanel declaration={declaration} />
                {canAct && blockers?.canProceed && (
                  <div className="flex justify-center">
                    <InitiateDialog projectId={projectId} onSuccess={invalidateAll} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <MaturityTimeline declaration={declaration ?? null} />
            {declaration && <ApprovalStatusPanel declaration={declaration} />}
          </div>
        </div>
      )}
    </div>
  );
}
