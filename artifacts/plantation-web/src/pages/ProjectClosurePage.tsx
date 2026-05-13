import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetProjectClosureWorkflow,
  useInitiateProjectClosure,
  useSendClosureAcknowledgmentOtp,
  useAcknowledgeProjectClosure,
  useUpdateProjectClosureWorkflow,
  getGetProjectClosureWorkflowQueryKey,
  useGetProject,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import type { ProjectClosureWorkflow } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
  Send,
  KeyRound,
  Ban,
  History,
  Info,
  ChevronRight,
} from "lucide-react";

// ── Status badge ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending_acknowledgment: { label: "Pending Acknowledgment", className: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock },
  acknowledged: { label: "Acknowledged", className: "bg-blue-100 text-blue-800 border-blue-200", icon: CheckCircle2 },
  closed: { label: "Closed", className: "bg-gray-100 text-gray-800 border-gray-200", icon: Archive },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 border-red-200", icon: XCircle },
};

function ClosureStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending_acknowledgment;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ── Timeline step ───────────────────────────────────────────────────────────

function TimelineStep({ done, active, label, sub }: { done: boolean; active: boolean; label: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        done ? "bg-emerald-500 text-white" :
        active ? "bg-amber-500 text-white" :
        "bg-muted text-muted-foreground"
      }`}>
        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className="text-xs font-bold">{active ? "●" : "○"}</span>}
      </div>
      <div>
        <p className={`text-sm font-medium ${active ? "text-foreground" : done ? "text-emerald-700" : "text-muted-foreground"}`}>{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ── Audit entry ─────────────────────────────────────────────────────────────

function auditEntries(w: ProjectClosureWorkflow) {
  const entries: { date: string; label: string; by?: string | null }[] = [];
  entries.push({ date: w.initiatedAt, label: "Closure workflow initiated", by: w.initiatedByName });
  if (w.otpSentAt) entries.push({ date: w.otpSentAt, label: "Acknowledgment OTP sent" });
  if (w.acknowledgmentWaived && w.waivedAt)
    entries.push({ date: w.waivedAt, label: "Acknowledgment waived by admin", by: w.waivedByName });
  if (w.otpVerifiedAt && !w.acknowledgmentWaived)
    entries.push({ date: w.otpVerifiedAt, label: "OTP verified", by: w.acknowledgedByName });
  if (w.acknowledgedAt && !w.acknowledgmentWaived && !w.otpVerifiedAt)
    entries.push({ date: w.acknowledgedAt, label: "Closure acknowledged", by: w.acknowledgedByName });
  if (w.cancelledAt) entries.push({ date: w.cancelledAt, label: "Workflow cancelled", by: w.cancelledByName });
  return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ProjectClosurePage() {
  const [, params] = useRoute("/projects/:id/closure");
  const projectId = params?.id ?? "";
  const { role } = useRole();
  const isAdmin = role === "admin";
  const isDeveloper = role === "developer";
  const canManage = isAdmin || isDeveloper;

  const queryClient = useQueryClient();
  const closureKey = getGetProjectClosureWorkflowQueryKey(projectId);

  const { data: workflow, isLoading: wLoading } = useGetProjectClosureWorkflow(projectId, {
    query: { enabled: !!projectId, retry: false, queryKey: getGetProjectClosureWorkflowQueryKey(projectId) },
  });
  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const initiateMutation = useInitiateProjectClosure({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: closureKey }) },
  });
  const sendOtpMutation = useSendClosureAcknowledgmentOtp({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: closureKey }) },
  });
  const acknowledgeMutation = useAcknowledgeProjectClosure({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: closureKey }) },
  });
  const updateMutation = useUpdateProjectClosureWorkflow({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: closureKey }) },
  });

  // ── Local state ──────────────────────────────────────────────────────────
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [closureReason, setClosureReason] = useState("");
  const [closureRemarks, setClosureRemarks] = useState("");

  const [otpInput, setOtpInput] = useState("");
  const [ackNotes, setAckNotes] = useState("");
  const [ackOpen, setAckOpen] = useState(false);

  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [mutationError, setMutationError] = useState<string | null>(null);

  const clearError = () => setMutationError(null);

  const isActive = workflow && ["pending_acknowledgment", "acknowledged"].includes(workflow.status);
  const isPendingAck = workflow?.status === "pending_acknowledgment";
  const isAcknowledged = workflow?.status === "acknowledged";

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleInitiate() {
    if (!closureReason.trim()) return;
    clearError();
    try {
      await initiateMutation.mutateAsync({
        id: projectId,
        data: { closureReason: closureReason.trim(), closureRemarks: closureRemarks.trim() || undefined },
      });
      setInitiateOpen(false);
      setClosureReason("");
      setClosureRemarks("");
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to initiate closure");
    }
  }

  async function handleSendOtp() {
    clearError();
    try {
      await sendOtpMutation.mutateAsync({ id: projectId });
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to send OTP");
    }
  }

  async function handleAcknowledge() {
    if (!otpInput.trim()) return;
    clearError();
    try {
      await acknowledgeMutation.mutateAsync({
        id: projectId,
        data: { otpCode: otpInput.trim(), acknowledgmentNotes: ackNotes.trim() || undefined },
      });
      setAckOpen(false);
      setOtpInput("");
      setAckNotes("");
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to acknowledge");
    }
  }

  async function handleWaive() {
    clearError();
    try {
      await updateMutation.mutateAsync({
        id: projectId,
        data: { action: "waive", reason: waiveReason.trim() || undefined },
      });
      setWaiveOpen(false);
      setWaiveReason("");
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to waive acknowledgment");
    }
  }

  async function handleCancel() {
    clearError();
    try {
      await updateMutation.mutateAsync({
        id: projectId,
        data: { action: "cancel", reason: cancelReason.trim() || undefined },
      });
      setCancelOpen(false);
      setCancelReason("");
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to cancel workflow");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/projects/${projectId}`}>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back to Project
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold">Project Closure</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {project?.name && <span className="font-medium text-foreground">{project.name} — </span>}
            Operational closure workflow with landowner acknowledgment
          </p>
        </div>
        {workflow && <ClosureStatusBadge status={workflow.status} />}
      </div>

      {/* Governance disclaimer */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">Operational Closure Only</p>
              <p className="text-amber-800 mt-0.5">
                Project closure is an operational governance action. All agreements, production records, financial data,
                and historical information are <strong>permanently preserved</strong> and remain accessible. Closure does
                not affect ownership stakes or partner entitlements.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {mutationError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-3 pb-3">
            <p className="text-sm text-red-700 flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              {mutationError}
            </p>
          </CardContent>
        </Card>
      )}

      {/* No workflow yet */}
      {!wLoading && !workflow && canManage && (
        <Card>
          <CardContent className="pt-6 pb-6 text-center space-y-4">
            <Archive className="w-10 h-10 mx-auto text-muted-foreground" />
            <div>
              <p className="font-medium">No active closure workflow</p>
              <p className="text-sm text-muted-foreground mt-1">
                Initiate a closure workflow to begin the governance acknowledgment process.
              </p>
            </div>
            <Button onClick={() => setInitiateOpen(true)} className="gap-2">
              <Archive className="w-4 h-4" />
              Initiate Project Closure
            </Button>
          </CardContent>
        </Card>
      )}

      {!wLoading && !workflow && !canManage && (
        <Card>
          <CardContent className="pt-6 pb-6 text-center">
            <p className="text-muted-foreground text-sm">No active closure workflow for this project.</p>
          </CardContent>
        </Card>
      )}

      {/* Active workflow */}
      {workflow && (
        <>
          {/* Progress timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Closure Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TimelineStep
                done={true}
                active={false}
                label="Closure Initiated"
                sub={`By ${workflow.initiatedByName ?? "unknown"} · ${new Date(workflow.initiatedAt).toLocaleDateString()}`}
              />
              <TimelineStep
                done={!!workflow.otpSentAt || workflow.acknowledgmentWaived}
                active={isPendingAck && !workflow.otpSentAt}
                label="OTP Sent to Landowner"
                sub={workflow.otpSentAt
                  ? `Sent ${new Date(workflow.otpSentAt).toLocaleString()}`
                  : workflow.acknowledgmentWaived ? "Waived by admin" : "Pending — use Send OTP button below"}
              />
              <TimelineStep
                done={isAcknowledged || workflow.status === "closed"}
                active={isPendingAck && !!workflow.otpSentAt}
                label="Landowner Acknowledgment"
                sub={workflow.acknowledgedAt
                  ? `Acknowledged by ${workflow.acknowledgedByName ?? "landowner"} on ${new Date(workflow.acknowledgedAt).toLocaleDateString()}`
                  : workflow.status === "cancelled" ? "Workflow cancelled" : "Awaiting landowner OTP confirmation"}
              />
              <TimelineStep
                done={workflow.status === "closed"}
                active={isAcknowledged}
                label="Project Lifecycle Closed"
                sub={workflow.status === "closed" ? "Project lifecycle transitioned to Closed" : "Pending — admin to finalise"}
              />
            </CardContent>
          </Card>

          {/* Closure details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-base">Closure Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">Closure Reason</p>
                <p className="font-medium">{workflow.closureReason}</p>
              </div>
              {workflow.closureRemarks && (
                <div>
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">Remarks</p>
                  <p className="text-muted-foreground">{workflow.closureRemarks}</p>
                </div>
              )}
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs">Initiated By</p>
                  <p className="font-medium">{workflow.initiatedByName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Initiated At</p>
                  <p className="font-medium">{new Date(workflow.initiatedAt).toLocaleString()}</p>
                </div>
                {workflow.acknowledgedAt && (
                  <>
                    <div>
                      <p className="text-muted-foreground text-xs">Acknowledged By</p>
                      <p className="font-medium">
                        {workflow.acknowledgedByName ?? "—"}
                        {workflow.acknowledgmentWaived && <span className="ml-1 text-xs text-amber-600">(waived)</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Acknowledged At</p>
                      <p className="font-medium">{new Date(workflow.acknowledgedAt).toLocaleString()}</p>
                    </div>
                  </>
                )}
                {workflow.cancelledAt && (
                  <>
                    <div>
                      <p className="text-muted-foreground text-xs">Cancelled By</p>
                      <p className="font-medium">{workflow.cancelledByName ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Cancelled At</p>
                      <p className="font-medium">{new Date(workflow.cancelledAt).toLocaleString()}</p>
                    </div>
                  </>
                )}
              </div>
              {workflow.cancellationReason && (
                <div className="border rounded-lg p-3 bg-red-50 border-red-100">
                  <p className="text-xs text-muted-foreground mb-1">Cancellation Reason</p>
                  <p className="text-sm text-red-800">{workflow.cancellationReason}</p>
                </div>
              )}
              {workflow.waivedReason && (
                <div className="border rounded-lg p-3 bg-amber-50 border-amber-100">
                  <p className="text-xs text-muted-foreground mb-1">Waiver Reason</p>
                  <p className="text-sm text-amber-800">{workflow.waivedReason}</p>
                </div>
              )}
              {workflow.acknowledgmentNotes && (
                <div className="border rounded-lg p-3 bg-blue-50 border-blue-100">
                  <p className="text-xs text-muted-foreground mb-1">Acknowledgment Notes</p>
                  <p className="text-sm text-blue-800">{workflow.acknowledgmentNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* OTP section — only when pending acknowledgment */}
          {isPendingAck && (
            <Card className="border-amber-200">
              <CardHeader className="pb-3">
                <CardTitle className="font-serif text-base flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-amber-600" />
                  Pending Landowner Acknowledgment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded-lg p-3 border border-amber-100">
                  <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                  <p>
                    An OTP must be sent to the assigned landowner for this project. Once they confirm with the OTP,
                    the closure workflow moves to <strong>Acknowledged</strong> status.
                  </p>
                </div>

                {workflow.otpCode && (
                  <div className="rounded-lg bg-muted/60 border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">OTP Code (dev mode)</p>
                    <p className="text-2xl font-mono font-bold tracking-widest">{workflow.otpCode}</p>
                    {workflow.otpExpiresAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Expires: {new Date(workflow.otpExpiresAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleSendOtp}
                      disabled={sendOtpMutation.isPending}
                    >
                      <Send className="w-3.5 h-3.5" />
                      {workflow.otpSentAt ? "Resend OTP" : "Send OTP"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setAckOpen(true)}
                    disabled={!workflow.otpCode}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Confirm Acknowledgment
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => setWaiveOpen(true)}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Waive Acknowledgment
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Acknowledged — pending finalisation */}
          {isAcknowledged && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
                  <div>
                    <p className="font-medium text-blue-900 text-sm">Acknowledgment Received</p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      {workflow.acknowledgmentWaived
                        ? `Acknowledgment was waived by admin (${workflow.waivedByName ?? "unknown"})`
                        : `Acknowledged by ${workflow.acknowledgedByName ?? "landowner"}`}
                      . The project lifecycle has been transitioned to <strong>Closed</strong>.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Admin actions */}
          {isActive && isAdmin && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setCancelOpen(true)}
              >
                <Ban className="w-3.5 h-3.5" />
                Cancel Closure Workflow
              </Button>
            </div>
          )}

          {/* Audit history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-base flex items-center gap-2">
                <History className="w-4 h-4" />
                Audit History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {auditEntries(workflow).length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No audit entries.</p>
              ) : (
                <div className="space-y-3">
                  {auditEntries(workflow).map((e, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{e.label}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{new Date(e.date).toLocaleString()}</span>
                          {e.by && <><ChevronRight className="w-3 h-3" /><span>{e.by}</span></>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}

      {/* Initiate dialog */}
      <Dialog open={initiateOpen} onOpenChange={setInitiateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Project Closure</DialogTitle>
            <DialogDescription>
              This begins the governance closure workflow. A landowner acknowledgment OTP will be required
              unless waived by admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Closure Reason <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g. Term expired, All production goals met"
                value={closureReason}
                onChange={(e) => setClosureReason(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Additional Remarks <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                placeholder="Any additional context or governance notes..."
                value={closureRemarks}
                onChange={(e) => setClosureRemarks(e.target.value)}
                className="mt-1 resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInitiateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleInitiate}
              disabled={!closureReason.trim() || initiateMutation.isPending}
            >
              {initiateMutation.isPending ? "Initiating..." : "Initiate Closure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Acknowledge dialog */}
      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Acknowledgment</DialogTitle>
            <DialogDescription>
              Enter the OTP sent to the landowner to confirm acknowledgment of project closure.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>OTP Code <span className="text-red-500">*</span></Label>
              <Input
                placeholder="6-digit code"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                className="mt-1 font-mono text-lg tracking-widest text-center"
                maxLength={6}
              />
            </div>
            <div>
              <Label>Acknowledgment Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                placeholder="Any remarks from the landowner..."
                value={ackNotes}
                onChange={(e) => setAckNotes(e.target.value)}
                className="mt-1 resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAcknowledge}
              disabled={!otpInput.trim() || acknowledgeMutation.isPending}
            >
              {acknowledgeMutation.isPending ? "Confirming..." : "Confirm Acknowledgment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waive dialog */}
      <AlertDialog open={waiveOpen} onOpenChange={setWaiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Waive Landowner Acknowledgment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will bypass the OTP acknowledgment requirement and immediately advance the project lifecycle to
              <strong> Closed</strong>. This action is irreversible. Please provide a reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Reason for waiving acknowledgment..."
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              className="resize-none"
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={handleWaive}
            >
              Waive & Close Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Closure Workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the current closure workflow. The project lifecycle will remain unchanged.
              You can initiate a new closure workflow later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Reason for cancellation..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="resize-none"
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Workflow</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleCancel}
            >
              Cancel Workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
