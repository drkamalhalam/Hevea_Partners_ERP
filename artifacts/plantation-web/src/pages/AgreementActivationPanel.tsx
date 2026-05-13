/**
 * AgreementActivationPanel
 *
 * Embedded in AgreementDetails. Manages the full activation lifecycle:
 *   draft            → "Initiate Activation" button
 *   pending_activation → OTP task cards per party + Cancel button
 *   active           → completion badge
 *
 * OTP codes are shown as placeholders (simulated dispatch — production would
 * use SMS/email and never expose the code in the UI).
 */

import { useState } from "react";
import { format } from "date-fns";
import {
  useGetAgreementActivation,
  getGetAgreementActivationQueryKey,
  useInitiateAgreementActivation,
  useCancelAgreementActivation,
  useSendAgreementActivationOtp,
  useVerifyAgreementActivationOtp,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ShieldCheck,
  ShieldX,
  Clock,
  CheckCircle2,
  XCircle,
  SendHorizonal,
  KeyRound,
  AlertTriangle,
  Zap,
  RotateCcw,
} from "lucide-react";

interface Props {
  agreementId: string;
  agreementStatus: string;
}

// ── Status badge helpers ──────────────────────────────────────────────────────

const OTP_STATUS_CONFIG = {
  pending: { label: "Pending", color: "bg-gray-100 text-gray-600 border-gray-200", icon: <Clock className="w-3 h-3" /> },
  sent: { label: "Awaiting Verification", color: "bg-amber-100 text-amber-800 border-amber-200", icon: <KeyRound className="w-3 h-3" /> },
  verified: { label: "Verified", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 border-red-200", icon: <XCircle className="w-3 h-3" /> },
  expired: { label: "Expired", color: "bg-orange-100 text-orange-800 border-orange-200", icon: <AlertTriangle className="w-3 h-3" /> },
};

const ACTIVATION_STATUS_CONFIG = {
  pending_otp: { label: "Pending Verification", color: "bg-amber-100 text-amber-800" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-600" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800" },
};

// ── OTP task card ─────────────────────────────────────────────────────────────

interface OtpCardProps {
  agreementId: string;
  activationId: string;
  otp: {
    id: string;
    partyRole: string;
    partyName: string;
    partyPhone?: string | null;
    status: string;
    otpCodePlaceholder?: string | null;
    sentAt?: string | null;
    verifiedAt?: string | null;
    expiresAt?: string | null;
    attempts: number;
  };
  canManage: boolean;
  onMutated: () => void;
}

function OtpTaskCard({ agreementId, activationId, otp, canManage, onMutated }: OtpCardProps) {
  const [otpInput, setOtpInput] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const sendMutation = useSendAgreementActivationOtp();
  const verifyMutation = useVerifyAgreementActivationOtp();

  const statusConfig = OTP_STATUS_CONFIG[otp.status as keyof typeof OTP_STATUS_CONFIG] ?? OTP_STATUS_CONFIG.pending;
  const isVerified = otp.status === "verified";
  const canSend = canManage && (otp.status === "pending" || otp.status === "failed" || otp.status === "expired");
  const canResend = canManage && otp.status === "sent";
  const canVerify = otp.status === "sent";

  const expiresAt = otp.expiresAt ? new Date(otp.expiresAt) : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  async function handleSend() {
    setSending(true);
    try {
      await sendMutation.mutateAsync({ id: agreementId, activationId, otpId: otp.id });
      onMutated();
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    if (!otpInput.trim()) return;
    setVerifyError(null);
    setVerifying(true);
    try {
      await verifyMutation.mutateAsync({
        id: agreementId,
        activationId,
        otpId: otp.id,
        data: { otpCode: otpInput.trim() },
      });
      onMutated();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message :
        (typeof err === "object" && err !== null && "response" in err
          ? "Invalid OTP code. Please check and try again."
          : "Verification failed");
      setVerifyError(msg);
    } finally {
      setVerifying(false);
      setOtpInput("");
    }
  }

  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-colors ${isVerified ? "border-emerald-200 bg-emerald-50/30" : "border-border bg-card"}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
              {otp.partyRole}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${statusConfig.color}`}
            >
              {statusConfig.icon}
              {statusConfig.label}
            </span>
          </div>
          <p className="font-medium text-sm">{otp.partyName}</p>
          {otp.partyPhone && (
            <p className="text-xs text-muted-foreground">{otp.partyPhone}</p>
          )}
        </div>
        {isVerified && otp.verifiedAt && (
          <p className="text-xs text-emerald-700">
            Verified {format(new Date(otp.verifiedAt), "dd MMM yyyy, HH:mm")}
          </p>
        )}
      </div>

      {/* OTP placeholder (simulated delivery) */}
      {otp.status === "sent" && otp.otpCodePlaceholder && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-amber-800">OTP Code (Placeholder — Simulated Dispatch)</p>
            <p className="text-xs text-amber-700">
              In production this would be sent via SMS to {otp.partyPhone ?? "the party's phone"}.
            </p>
          </div>
          <code className="text-2xl font-mono font-bold text-amber-900 tracking-widest">
            {otp.otpCodePlaceholder}
          </code>
        </div>
      )}

      {otp.status === "sent" && expiresAt && !isExpired && (
        <p className="text-xs text-muted-foreground">
          Expires at {format(expiresAt, "HH:mm")} · {otp.attempts} attempt{otp.attempts !== 1 ? "s" : ""} used
        </p>
      )}

      {otp.sentAt && otp.status !== "verified" && (
        <p className="text-xs text-muted-foreground">
          Sent {format(new Date(otp.sentAt), "dd MMM, HH:mm")}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {(canSend || canResend) && (
          <Button
            variant={canResend ? "ghost" : "outline"}
            size="sm"
            className="gap-1.5 text-xs"
            disabled={sending}
            onClick={handleSend}
          >
            {canResend ? (
              <><RotateCcw className="w-3.5 h-3.5" /> Resend OTP</>
            ) : (
              <><SendHorizonal className="w-3.5 h-3.5" /> Send OTP</>
            )}
          </Button>
        )}

        {canVerify && (
          <div className="flex items-center gap-1.5 flex-1">
            <Input
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder="Enter 6-digit code"
              maxLength={6}
              className="h-8 text-sm font-mono w-36"
            />
            <Button
              size="sm"
              className="gap-1.5 text-xs h-8"
              disabled={verifying || otpInput.length < 4}
              onClick={handleVerify}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Verify
            </Button>
          </div>
        )}
      </div>

      {verifyError && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <XCircle className="w-3.5 h-3.5" /> {verifyError}
        </p>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AgreementActivationPanel({ agreementId, agreementStatus }: Props) {
  const { isAdmin, isDeveloper } = useRole();
  const canManage = isAdmin || isDeveloper;

  const queryClient = useQueryClient();
  const queryKey = getGetAgreementActivationQueryKey(agreementId);

  const { data: activation, isLoading, refetch } = useGetAgreementActivation(
    agreementId,
    { query: { enabled: agreementStatus !== "draft", queryKey } },
  );

  const [initiating, setInitiating] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [initiateNotes, setInitiateNotes] = useState("");
  const [initiateOpen, setInitiateOpen] = useState(false);

  const initiateMutation = useInitiateAgreementActivation();
  const cancelMutation = useCancelAgreementActivation();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey });
  }

  async function handleInitiate() {
    setInitiating(true);
    try {
      await initiateMutation.mutateAsync({
        id: agreementId,
        data: { notes: initiateNotes || undefined },
      });
      queryClient.invalidateQueries({ queryKey });
      setInitiateOpen(false);
      setInitiateNotes("");
    } finally {
      setInitiating(false);
    }
  }

  async function handleCancel() {
    if (!activation) return;
    setCancelling(true);
    try {
      await cancelMutation.mutateAsync({
        id: agreementId,
        activationId: activation.id,
        data: { cancellationReason: cancelReason || undefined },
      });
      queryClient.invalidateQueries({ queryKey });
      setCancelOpen(false);
      setCancelReason("");
    } finally {
      setCancelling(false);
    }
  }

  const verifiedCount = activation?.otpTasks?.filter((t) => t.status === "verified").length ?? 0;
  const totalCount = activation?.otpTasks?.length ?? 0;
  const progressPct = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0;

  // ── Draft — show initiation prompt ─────────────────────────────────────────
  if (agreementStatus === "draft") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-serif flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-muted-foreground" />
            Agreement Activation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-800 space-y-1">
            <p className="font-semibold">Ready to activate this agreement?</p>
            <p className="text-xs text-sky-700">
              Activation sends an OTP verification request to both the landowner and developer.
              Once both parties verify, the agreement becomes Active.
            </p>
          </div>
          {canManage && (
            <>
              <Button
                className="gap-2"
                onClick={() => setInitiateOpen(true)}
              >
                <Zap className="w-4 h-4" /> Initiate Activation
              </Button>
              <AlertDialog open={initiateOpen} onOpenChange={setInitiateOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Initiate Agreement Activation</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will send OTP verification requests to the landowner and developer.
                      The agreement status will change to <strong>Pending Activation</strong>.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="px-1">
                    <Textarea
                      placeholder="Notes (optional)"
                      value={initiateNotes}
                      onChange={(e) => setInitiateNotes(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleInitiate} disabled={initiating}>
                      {initiating ? "Initiating…" : "Initiate"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Active — show completion badge ──────────────────────────────────────────
  if (agreementStatus === "active") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-serif flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Agreement Activation
            <Badge className="ml-auto bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-800">Agreement is Active</p>
              <p className="text-xs text-emerald-700">
                Both parties have verified their OTPs. This agreement is now legally active.
              </p>
            </div>
          </div>
          {activation?.completedAt && (
            <p className="text-xs text-muted-foreground mt-3">
              Activated on {format(new Date(activation.completedAt), "dd MMM yyyy, HH:mm")}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Pending / loading state ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-serif flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Agreement Activation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-4 rounded bg-muted animate-pulse w-2/3" />
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Pending activation — OTP tasks ──────────────────────────────────────────
  const activationStatus = activation?.status ?? "pending_otp";
  const statusConfig = ACTIVATION_STATUS_CONFIG[activationStatus as keyof typeof ACTIVATION_STATUS_CONFIG];

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="font-serif flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Agreement Activation
          </CardTitle>
          <div className="flex items-center gap-2">
            {statusConfig && (
              <Badge className={`text-xs ${statusConfig.color}`}>{statusConfig.label}</Badge>
            )}
            {canManage && activationStatus === "pending_otp" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 text-destructive hover:text-destructive"
                onClick={() => setCancelOpen(true)}
              >
                <ShieldX className="w-3.5 h-3.5" /> Cancel
              </Button>
            )}
          </div>
        </div>
        {activation?.initiatedByName && (
          <p className="text-xs text-muted-foreground">
            Initiated by {activation.initiatedByName} ·{" "}
            {format(new Date(activation.createdAt), "dd MMM yyyy, HH:mm")}
          </p>
        )}
        {activation?.notes && (
          <p className="text-xs text-muted-foreground italic">"{activation.notes}"</p>
        )}
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Progress bar */}
        {activationStatus === "pending_otp" && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Verification progress</span>
              <span className={verifiedCount === totalCount ? "text-emerald-600 font-medium" : ""}>
                {verifiedCount}/{totalCount} verified
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* OTP task cards */}
        {activation?.otpTasks?.map((otp) => (
          <OtpTaskCard
            key={otp.id}
            agreementId={agreementId}
            activationId={activation.id}
            otp={otp}
            canManage={canManage}
            onMutated={() => { invalidate(); refetch(); }}
          />
        ))}

        {/* Cancelled/rejected state */}
        {(activationStatus === "cancelled" || activationStatus === "rejected") && (
          <div className="rounded-xl bg-gray-50 border px-4 py-3 space-y-1">
            <p className="text-sm font-medium text-muted-foreground capitalize">
              {activationStatus}
              {activation?.cancelledAt && ` on ${format(new Date(activation.cancelledAt), "dd MMM yyyy")}`}
            </p>
            {activation?.cancellationReason && (
              <p className="text-xs text-muted-foreground italic">
                Reason: "{activation.cancellationReason}"
              </p>
            )}
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5 text-xs"
                onClick={() => setInitiateOpen(true)}
              >
                <Zap className="w-3.5 h-3.5" /> Reinitiate Activation
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {/* Cancel dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Activation Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the activation workflow and revert the agreement to <strong>Draft</strong> status.
              You can initiate a new activation later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Textarea
              placeholder="Reason for cancellation (optional)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Active</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? "Cancelling…" : "Cancel Activation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-initiate dialog (after cancel/reject) */}
      <AlertDialog open={initiateOpen} onOpenChange={setInitiateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reinitiate Agreement Activation</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a fresh activation workflow with new OTP codes for both parties.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Textarea
              placeholder="Notes (optional)"
              value={initiateNotes}
              onChange={(e) => setInitiateNotes(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleInitiate} disabled={initiating}>
              {initiating ? "Initiating…" : "Initiate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
