import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  useGetProjectNominee,
  useGetNomineeActivationWorkflow,
  useInitiateNomineeActivation,
  useSendNomineeActivationOtp,
  useVerifyNomineeActivation,
  useUpdateNomineeActivationWorkflow,
  getGetNomineeActivationWorkflowQueryKey,
  getGetProjectNomineeQueryKey,
} from "@workspace/api-client-react";
import type { NomineeActivationWorkflow } from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ShieldAlert,
  FileWarning,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Circle,
  Lock,
  User,
  FileText,
  KeyRound,
  RefreshCw,
  XCircle,
  AlertTriangle,
  ScrollText,
  CalendarDays,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  death_based: "Death-Based Activation",
  voluntary_handover: "Voluntary Handover",
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_verification: {
    label: "Pending Admin Verification",
    color: "bg-amber-100 text-amber-800 border-amber-200",
  },
  pending_otp: {
    label: "Pending OTP Verification",
    color: "bg-blue-100 text-blue-800 border-blue-200",
  },
  activated: {
    label: "Activated",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-100 text-red-800 border-red-200",
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-gray-100 text-gray-800 border-gray-200",
  },
};

function formatTs(iso: string | null | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

// ── Timeline ─────────────────────────────────────────────────────────────────

type StepState = "done" | "current" | "future";

interface Step {
  label: string;
  description: string;
  state: StepState;
  timestamp?: string | null;
}

function ActivationTimeline({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-0">
      {steps.map((step, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                step.state === "done"
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : step.state === "current"
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-background border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {step.state === "done" ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : step.state === "current" ? (
                <Circle className="w-4 h-4 fill-current" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-0.5 h-8 mt-0.5 ${step.state === "done" ? "bg-emerald-400" : "bg-muted"}`}
              />
            )}
          </div>
          <div className="pb-4 pt-0.5 min-w-0">
            <p
              className={`text-sm font-semibold ${step.state === "future" ? "text-muted-foreground" : "text-foreground"}`}
            >
              {step.label}
            </p>
            <p className="text-xs text-muted-foreground">{step.description}</p>
            {step.timestamp && (
              <p className="text-xs text-emerald-700 mt-0.5 font-medium">{step.timestamp}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildSteps(wf: NomineeActivationWorkflow): Step[] {
  const isDeathBased = wf.activationType === "death_based";
  const isDone = (v: string | null | undefined): boolean => !!v;

  if (isDeathBased) {
    return [
      {
        label: "Workflow Initiated",
        description: "Death certificate submitted and workflow created",
        state: "done",
        timestamp: formatTs(wf.createdAt),
      },
      {
        label: "Admin Document Verification",
        description: "Admin reviews and verifies the death certificate",
        state:
          wf.status === "pending_verification"
            ? "current"
            : isDone(wf.verifiedAt)
              ? "done"
              : "future",
        timestamp: formatTs(wf.verifiedAt),
      },
      {
        label: "Nominee Activated",
        description: "Nominee granted operational governance authority",
        state: isDone(wf.activatedAt) ? "done" : "future",
        timestamp: formatTs(wf.activatedAt),
      },
    ];
  }

  return [
    {
      label: "Workflow Initiated",
      description: "Declaration deed submitted and OTP sent to developer",
      state: "done",
      timestamp: formatTs(wf.createdAt),
    },
    {
      label: "Developer OTP Verification",
      description: "Current project developer confirms handover via OTP",
      state:
        wf.status === "pending_otp" ? "current" : isDone(wf.otpVerifiedAt) ? "done" : "future",
      timestamp: formatTs(wf.otpVerifiedAt),
    },
    {
      label: "Nominee Activated",
      description: "Nominee granted operational governance authority",
      state: isDone(wf.activatedAt) ? "done" : "future",
      timestamp: formatTs(wf.activatedAt),
    },
  ];
}

// ── Governance History ────────────────────────────────────────────────────────

function GovernanceHistory({ wf }: { wf: NomineeActivationWorkflow }) {
  const events: { label: string; ts: string; by?: string | null; notes?: string | null; color: string }[] = [];

  events.push({
    label: "Workflow Initiated",
    ts: wf.createdAt,
    by: wf.createdByName,
    color: "bg-blue-500",
  });

  if (wf.otpSentAt) {
    events.push({ label: "OTP Sent", ts: wf.otpSentAt, by: null, color: "bg-amber-500" });
  }
  if (wf.otpVerifiedAt) {
    events.push({
      label: "OTP Verified",
      ts: wf.otpVerifiedAt,
      by: wf.otpVerifiedByName,
      color: "bg-emerald-500",
    });
  }
  if (wf.verifiedAt) {
    events.push({
      label: "Documents Verified by Admin",
      ts: wf.verifiedAt,
      by: wf.verifiedByName,
      notes: wf.verificationNotes,
      color: "bg-emerald-500",
    });
  }
  if (wf.activatedAt) {
    events.push({
      label: "Nominee Activated",
      ts: wf.activatedAt,
      by: wf.activatedByName,
      color: "bg-emerald-600",
    });
  }
  if (wf.rejectedAt) {
    events.push({
      label: wf.status === "cancelled" ? "Workflow Cancelled" : "Workflow Rejected",
      ts: wf.rejectedAt,
      by: wf.rejectedByName,
      notes: wf.rejectionReason,
      color: "bg-red-500",
    });
  }

  events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  return (
    <div className="space-y-3">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${ev.color}`} />
          <div className="min-w-0">
            <p className="text-sm font-medium">{ev.label}</p>
            {ev.by && <p className="text-xs text-muted-foreground">By {ev.by}</p>}
            {ev.notes && (
              <p className="text-xs text-muted-foreground italic mt-0.5">"{ev.notes}"</p>
            )}
            <p className="text-xs text-muted-foreground/70">{formatTs(ev.ts)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mode Selection (no workflow yet) ─────────────────────────────────────────

function ModeSelector({
  projectId,
  onSuccess,
}: {
  projectId: string;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<"death_based" | "voluntary_handover" | null>(null);
  const [deathCertUrl, setDeathCertUrl] = useState("");
  const [declarationDeedUrl, setDeclarationDeedUrl] = useState("");
  const [remarks, setRemarks] = useState("");
  const { toast } = useToast();
  const initMutation = useInitiateNomineeActivation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) return;
    initMutation.mutate(
      {
        id: projectId,
        data: {
          activationType: mode,
          ...(mode === "death_based" && deathCertUrl ? { deathCertificateUrl: deathCertUrl } : {}),
          ...(mode === "voluntary_handover" && declarationDeedUrl
            ? { declarationDeedUrl }
            : {}),
          ...(remarks ? { governanceRemarks: remarks } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Activation workflow initiated",
            description:
              mode === "voluntary_handover"
                ? "OTP has been generated. Share it with the project developer."
                : "Workflow is now pending admin document verification.",
          });
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to initiate activation";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Death-Based card */}
        <button
          type="button"
          onClick={() => setMode("death_based")}
          className={`text-left rounded-xl border-2 p-4 transition-all space-y-2 ${
            mode === "death_based"
              ? "border-red-400 bg-red-50/50"
              : "border-muted hover:border-muted-foreground/40 bg-background"
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${mode === "death_based" ? "bg-red-100" : "bg-muted"}`}
            >
              <FileWarning
                className={`w-4 h-4 ${mode === "death_based" ? "text-red-600" : "text-muted-foreground"}`}
              />
            </div>
            <p className="font-semibold text-sm">Death-Based Activation</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The registered nominee is activated following the verified death of the project
            developer. Requires death certificate upload and admin verification.
          </p>
          <div className="flex flex-wrap gap-1 pt-0.5">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">Death Certificate</span>
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">Admin Verification</span>
          </div>
        </button>

        {/* Voluntary Handover card */}
        <button
          type="button"
          onClick={() => setMode("voluntary_handover")}
          className={`text-left rounded-xl border-2 p-4 transition-all space-y-2 ${
            mode === "voluntary_handover"
              ? "border-blue-400 bg-blue-50/50"
              : "border-muted hover:border-muted-foreground/40 bg-background"
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${mode === "voluntary_handover" ? "bg-blue-100" : "bg-muted"}`}
            >
              <ArrowRightLeft
                className={`w-4 h-4 ${mode === "voluntary_handover" ? "text-blue-600" : "text-muted-foreground"}`}
              />
            </div>
            <p className="font-semibold text-sm">Voluntary Handover</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The current project developer voluntarily hands over governance authority to the
            nominee. Requires declaration deed and OTP confirmation.
          </p>
          <div className="flex flex-wrap gap-1 pt-0.5">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">Declaration Deed</span>
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">Developer OTP</span>
          </div>
        </button>
      </div>

      {/* Document input based on mode */}
      {mode === "death_based" && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="deathCertUrl">Death Certificate URL</Label>
            <Input
              id="deathCertUrl"
              placeholder="https://... (document placeholder)"
              value={deathCertUrl}
              onChange={(e) => setDeathCertUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Upload a scanned copy of the death certificate. Document storage is a placeholder —
              provide a URL reference.
            </p>
          </div>
        </div>
      )}

      {mode === "voluntary_handover" && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="declarationDeedUrl">Declaration Deed URL</Label>
            <Input
              id="declarationDeedUrl"
              placeholder="https://... (document placeholder)"
              value={declarationDeedUrl}
              onChange={(e) => setDeclarationDeedUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The signed declaration deed confirming voluntary transfer of governance authority.
              Document storage is a placeholder.
            </p>
          </div>
        </div>
      )}

      {mode && (
        <div className="space-y-1.5">
          <Label htmlFor="remarks">Governance Remarks</Label>
          <Textarea
            id="remarks"
            placeholder="Context, notes, or instructions for this activation..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
          />
        </div>
      )}

      {mode && (
        <Button
          type="submit"
          className="w-full"
          disabled={!mode || initMutation.isPending}
        >
          {initMutation.isPending
            ? "Initiating..."
            : mode === "death_based"
              ? "Initiate Death-Based Activation"
              : "Initiate Voluntary Handover"}
        </Button>
      )}
    </form>
  );
}

// ── OTP Section (voluntary handover, pending_otp) ───────────────────────────

function OtpVerificationSection({
  workflow,
  projectId,
  onSuccess,
}: {
  workflow: NomineeActivationWorkflow;
  projectId: string;
  onSuccess: () => void;
}) {
  const [otpInput, setOtpInput] = useState("");
  const { toast } = useToast();
  const sendOtpMutation = useSendNomineeActivationOtp();
  const verifyMutation = useVerifyNomineeActivation();

  const isExpired =
    workflow.otpExpiresAt ? new Date() > new Date(workflow.otpExpiresAt) : false;

  function handleSendOtp() {
    sendOtpMutation.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          toast({ title: "OTP sent", description: "New OTP generated and ready." });
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to send OTP";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!otpInput.trim()) return;
    verifyMutation.mutate(
      { id: projectId, data: { otpCode: otpInput.trim() } },
      {
        onSuccess: () => {
          toast({
            title: "Nominee activated",
            description: "OTP verified. Governance authority transferred.",
          });
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "OTP verification failed";
          toast({ title: "Incorrect OTP", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* Dev-mode OTP display */}
      {workflow.otpCode && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <KeyRound className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-800 mb-1">
              DEV MODE — OTP (share with project developer)
            </p>
            <p className="font-mono text-2xl font-bold text-amber-900 tracking-[0.3em]">
              {workflow.otpCode}
            </p>
            {workflow.otpExpiresAt && (
              <p className={`text-xs mt-1 ${isExpired ? "text-red-600 font-medium" : "text-amber-700"}`}>
                {isExpired
                  ? "Expired — resend to generate a new OTP"
                  : `Expires: ${formatTs(workflow.otpExpiresAt)}`}
              </p>
            )}
          </div>
        </div>
      )}

      {!workflow.otpCode && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <AlertTriangle className="w-4 h-4" />
          OTP not yet sent. Click "Send OTP" to generate one.
        </div>
      )}

      <form onSubmit={handleVerify} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="otpInput">Enter OTP</Label>
          <div className="flex gap-2">
            <Input
              id="otpInput"
              className="font-mono text-center text-lg tracking-widest max-w-[180px]"
              placeholder="••••••"
              maxLength={6}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
              disabled={!workflow.otpCode || isExpired}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={handleSendOtp}
              disabled={sendOtpMutation.isPending}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sendOtpMutation.isPending ? "animate-spin" : ""}`} />
              {workflow.otpCode ? "Resend OTP" : "Send OTP"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter the 6-digit OTP provided to the current project developer.
          </p>
        </div>
        <Button
          type="submit"
          className="gap-1.5"
          disabled={otpInput.length !== 6 || !workflow.otpCode || isExpired || verifyMutation.isPending}
        >
          <CheckCircle2 className="w-4 h-4" />
          {verifyMutation.isPending ? "Verifying..." : "Verify & Activate Nominee"}
        </Button>
      </form>
    </div>
  );
}

// ── Document Verification Section (death-based, pending_verification) ────────

function DocumentVerificationSection({
  workflow,
  projectId,
  isAdmin,
  onSuccess,
}: {
  workflow: NomineeActivationWorkflow;
  projectId: string;
  isAdmin: boolean;
  onSuccess: () => void;
}) {
  const [verificationNotes, setVerificationNotes] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const verifyMutation = useVerifyNomineeActivation();

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    verifyMutation.mutate(
      { id: projectId, data: { verificationNotes: verificationNotes || undefined } },
      {
        onSuccess: () => {
          toast({
            title: "Nominee activated",
            description: "Death certificate verified. Governance authority transferred.",
          });
          setOpen(false);
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Verification failed";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* Death certificate display */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText className="w-4 h-4 text-muted-foreground" />
          Death Certificate
        </div>
        {workflow.deathCertificateUrl ? (
          <a
            href={workflow.deathCertificateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5" />
            View Uploaded Document
          </a>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No document URL provided (placeholder)
          </p>
        )}
      </div>

      {isAdmin ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Verify Documents & Activate Nominee
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-serif">Verify & Activate Nominee</DialogTitle>
              <DialogDescription>
                By verifying these documents you confirm that the death certificate has been
                reviewed and authenticated. The nominee will immediately receive operational
                governance authority. <strong>This action cannot be undone.</strong>
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleVerify} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="verNotes">Verification Notes</Label>
                <Textarea
                  id="verNotes"
                  placeholder="Document ID, issuing authority, date of verification..."
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={verifyMutation.isPending}>
                  {verifyMutation.isPending ? "Activating..." : "Confirm Activation"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/20 text-sm text-muted-foreground">
          <Clock className="w-4 h-4 flex-shrink-0" />
          Awaiting admin document verification. Only administrators can complete this step.
        </div>
      )}
    </div>
  );
}

// ── Reject / Cancel Dialog ────────────────────────────────────────────────────

function RejectCancelDialog({
  projectId,
  workflow,
  onSuccess,
}: {
  projectId: string;
  workflow: NomineeActivationWorkflow;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"rejected" | "cancelled">("cancelled");
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const updateMutation = useUpdateNomineeActivationWorkflow();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate(
      {
        id: projectId,
        data: { status: action, ...(reason ? { rejectionReason: reason } : {}) },
      },
      {
        onSuccess: () => {
          toast({
            title: action === "cancelled" ? "Workflow cancelled" : "Workflow rejected",
            description: "Activation workflow has been closed.",
          });
          setOpen(false);
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to update workflow";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
          <XCircle className="w-4 h-4" />
          Reject / Cancel Workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Close Activation Workflow</DialogTitle>
          <DialogDescription>
            Choose whether to reject (documents invalid) or cancel (initiated in error) this
            workflow. A new workflow can be started afterwards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction("cancelled")}
              className={`flex-1 text-sm px-3 py-2 rounded-lg border transition-colors ${
                action === "cancelled"
                  ? "bg-gray-100 border-gray-300 text-gray-800 font-medium"
                  : "bg-background border-border text-muted-foreground"
              }`}
            >
              Cancel — Initiated in error
            </button>
            <button
              type="button"
              onClick={() => setAction("rejected")}
              className={`flex-1 text-sm px-3 py-2 rounded-lg border transition-colors ${
                action === "rejected"
                  ? "bg-red-50 border-red-300 text-red-800 font-medium"
                  : "bg-background border-border text-muted-foreground"
              }`}
            >
              Reject — Documents invalid
            </button>
          </div>
          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Textarea
              placeholder="Reason for rejection or cancellation..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Keep Active
            </Button>
            <Button
              type="submit"
              variant={action === "rejected" ? "destructive" : "default"}
              className="flex-1"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Closing..." : action === "rejected" ? "Reject" : "Cancel Workflow"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NomineeActivationPage() {
  const [, params] = useRoute("/projects/:id/nominee/activation");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === "admin";
  const isAdminOrDev = role === "admin" || role === "developer";

  const { data: projects } = useListProjects();
  const project = projects?.find((p) => p.id === id);

  const { data: nominee, isLoading: nomineeLoading } = useGetProjectNominee(id);
  const {
    data: workflow,
    isLoading: workflowLoading,
    error: workflowError,
  } = useGetNomineeActivationWorkflow(id, {
    query: { retry: false, queryKey: getGetNomineeActivationWorkflowQueryKey(id) },
  });

  const noWorkflow = !workflowLoading && (workflowError || !workflow);
  const isActiveWorkflow =
    workflow &&
    (workflow.status === "pending_verification" || workflow.status === "pending_otp");
  const isTerminal =
    workflow &&
    (workflow.status === "activated" ||
      workflow.status === "rejected" ||
      workflow.status === "cancelled");

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getGetNomineeActivationWorkflowQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetProjectNomineeQueryKey(id) });
  }

  const statusMeta = workflow ? (STATUS_META[workflow.status] ?? STATUS_META.pending_verification) : null;

  return (
    <div className="space-y-5 max-w-3xl mx-auto py-6 px-4">
      {/* Back breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={`/projects/${id}`}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {project?.name ?? "Project"}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground font-medium">Nominee Activation</span>
      </div>

      {/* Page title */}
      <div>
        <h1 className="font-serif text-2xl font-bold">Nominee Activation Workflow</h1>
        {nominee && (
          <p className="text-muted-foreground mt-0.5">
            Nominee:{" "}
            <span className="text-foreground font-medium">{nominee.nomineeName}</span>
            {nominee.relationship && (
              <span className="text-muted-foreground"> · {nominee.relationship}</span>
            )}
          </p>
        )}
      </div>

      {/* Governance disclaimer */}
      <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50/40 p-4 text-sm">
        <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-900">Operational Governance Only</p>
          <p className="text-amber-800 leading-relaxed text-xs">
            Nominee activation transfers <strong>operational governance authority only</strong>. It
            does not constitute an ownership transfer, equity assignment, or legal succession. All
            financial interests, land rights, and partnership equity remain with the original
            developer's estate and are governed by separate legal instruments.
          </p>
        </div>
      </div>

      {/* No nominee registered */}
      {!nomineeLoading && !nominee && (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-sm">No nominee registered</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                A governance continuity nominee must be registered before activation can be
                initiated.{" "}
                <Link href={`/projects/${id}`} className="text-blue-600 hover:underline">
                  Register a nominee
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nominee already activated — show info */}
      {nominee?.activationStatus === "activated" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50/40">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-emerald-900 text-sm">Nominee Currently Active</p>
            <p className="text-xs text-emerald-800 mt-0.5">
              {nominee.nomineeName} has operational governance authority for this project.
              {nominee.activatedAt && (
                <span> Activated {formatTs(nominee.activatedAt)}.</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {(nomineeLoading || workflowLoading) && (
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}

      {/* No active workflow — show initiation UI */}
      {!nomineeLoading && !workflowLoading && noWorkflow && nominee && isAdminOrDev && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-base">Initiate Activation Workflow</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose the activation mode based on the circumstances.
            </p>
          </CardHeader>
          <CardContent>
            <ModeSelector projectId={id} onSuccess={invalidateAll} />
          </CardContent>
        </Card>
      )}

      {/* Active / terminal workflow display */}
      {!workflowLoading && workflow && (
        <>
          {/* Status card */}
          <Card
            className={
              isActiveWorkflow
                ? "border-primary/40 bg-primary/5"
                : workflow.status === "activated"
                  ? "border-emerald-200 bg-emerald-50/20"
                  : "border-muted"
            }
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {workflow.activationType === "death_based" ? (
                    <FileWarning className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
                  )}
                  <CardTitle className="font-serif text-base">
                    {TYPE_LABELS[workflow.activationType] ?? workflow.activationType}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {statusMeta && (
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusMeta.color}`}
                    >
                      {statusMeta.label}
                    </span>
                  )}
                  {isAdmin && isActiveWorkflow && (
                    <RejectCancelDialog
                      projectId={id}
                      workflow={workflow}
                      onSuccess={invalidateAll}
                    />
                  )}
                </div>
              </div>
              {workflow.governanceRemarks && (
                <p className="text-xs text-muted-foreground mt-1 ml-6 italic">
                  "{workflow.governanceRemarks}"
                </p>
              )}
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Timeline */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Activation Timeline
                </p>
                <ActivationTimeline steps={buildSteps(workflow)} />
              </div>

              {/* Action section — active workflows only */}
              {isAdminOrDev && isActiveWorkflow && (
                <div className="pt-1 border-t">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    {workflow.status === "pending_otp"
                      ? "OTP Verification"
                      : "Document Verification"}
                  </p>
                  {workflow.status === "pending_otp" ? (
                    <OtpVerificationSection
                      workflow={workflow}
                      projectId={id}
                      onSuccess={invalidateAll}
                    />
                  ) : (
                    <DocumentVerificationSection
                      workflow={workflow}
                      projectId={id}
                      isAdmin={isAdmin}
                      onSuccess={invalidateAll}
                    />
                  )}
                </div>
              )}

              {/* Rejected / Cancelled details */}
              {isTerminal && workflow.status !== "activated" && workflow.rejectionReason && (
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    {workflow.status === "rejected" ? "Rejection Reason" : "Cancellation Reason"}
                  </p>
                  <p className="text-sm text-muted-foreground">{workflow.rejectionReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Document cards */}
          {(workflow.deathCertificateUrl || workflow.declarationDeedUrl) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-sm text-muted-foreground uppercase tracking-wide">
                  Submitted Documents
                </CardTitle>
              </CardHeader>
              <CardContent>
                {workflow.deathCertificateUrl && (
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                    <ScrollText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Death Certificate</p>
                      <a
                        href={workflow.deathCertificateUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate block max-w-xs"
                      >
                        View Document
                      </a>
                    </div>
                  </div>
                )}
                {workflow.declarationDeedUrl && (
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Declaration Deed</p>
                      <a
                        href={workflow.declarationDeedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate block max-w-xs"
                      >
                        View Document
                      </a>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Governance history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-base flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                Governance Audit Log
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Immutable record of all actions taken in this activation workflow.
              </p>
            </CardHeader>
            <CardContent>
              <GovernanceHistory wf={workflow} />
            </CardContent>
          </Card>

          {/* Start new workflow when terminal */}
          {isAdminOrDev && isTerminal && nominee?.activationStatus !== "activated" && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  queryClient.removeQueries({
                    queryKey: getGetNomineeActivationWorkflowQueryKey(id),
                  });
                  queryClient.invalidateQueries({
                    queryKey: getGetNomineeActivationWorkflowQueryKey(id),
                  });
                }}
              >
                Start New Activation Workflow
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
