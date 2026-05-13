import { useState } from "react";
import {
  useGetMissingDeveloperCase,
  useFileMissingDeveloperCase,
  useUpdateMissingDeveloperCase,
  getGetMissingDeveloperCaseQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  CheckCircle2,
  FileText,
  User,
  Timer,
  Flag,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  projectId: string;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: "Waiting Period Active", color: "bg-amber-100 text-amber-800 border-amber-200" },
  nominee_eligible: { label: "Nominee Eligible", color: "bg-red-100 text-red-800 border-red-200" },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-800 border-green-200" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-800 border-gray-200" },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function CountdownBar({ daysElapsed, daysRemaining, isEligible }: {
  daysElapsed: number;
  daysRemaining: number;
  isEligible: boolean;
}) {
  const total = 45;
  const progress = Math.min(100, Math.round((daysElapsed / total) * 100));
  const barColor = isEligible ? "bg-red-500" : daysElapsed >= 35 ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="font-medium">{daysElapsed} days elapsed</span>
        {isEligible ? (
          <span className="text-red-700 font-semibold">Waiting period complete</span>
        ) : (
          <span>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining</span>
        )}
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground/70">
        <span>GD Filed</span>
        <span className="font-medium text-foreground">45-day mark</span>
      </div>
    </div>
  );
}

function GovernanceTimeline({ gdEntryDate, nomineeEligibleAt, daysElapsed, isEligible }: {
  gdEntryDate: string;
  nomineeEligibleAt: string;
  daysElapsed: number;
  isEligible: boolean;
}) {
  const steps = [
    {
      label: "GD Filed",
      desc: `Entry date: ${gdEntryDate}`,
      done: true,
      icon: <Flag className="w-3.5 h-3.5" />,
    },
    {
      label: "45-Day Waiting Period",
      desc: daysElapsed < 45 ? `${daysElapsed}/45 days elapsed` : "Completed",
      done: daysElapsed >= 45,
      icon: <Timer className="w-3.5 h-3.5" />,
    },
    {
      label: "Nominee Eligible for Activation",
      desc: isEligible ? `Eligible since ${formatDate(nomineeEligibleAt)}` : `Eligible on ${formatDate(nomineeEligibleAt)}`,
      done: isEligible,
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="space-y-0">
      {steps.map((step, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
              step.done
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "bg-background border-muted-foreground/30 text-muted-foreground"
            }`}>
              {step.icon}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-0.5 h-6 mt-0.5 ${step.done ? "bg-emerald-400" : "bg-muted"}`} />
            )}
          </div>
          <div className="pb-4 pt-0.5">
            <p className={`text-sm font-medium ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
              {step.label}
            </p>
            <p className="text-xs text-muted-foreground">{step.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FileReportDialog({ projectId, onSuccess }: { projectId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [gdEntryDate, setGdEntryDate] = useState("");
  const [gdNumber, setGdNumber] = useState("");
  const [gdDocumentUrl, setGdDocumentUrl] = useState("");
  const [remarks, setRemarks] = useState("");
  const { toast } = useToast();
  const fileMutation = useFileMissingDeveloperCase();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gdEntryDate) return;
    fileMutation.mutate(
      {
        id: projectId,
        data: {
          gdEntryDate,
          ...(gdNumber ? { gdNumber } : {}),
          ...(gdDocumentUrl ? { gdDocumentUrl } : {}),
          ...(remarks ? { remarks } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Missing developer case filed", description: "45-day waiting period has started." });
          setOpen(false);
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to file case";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50">
          <AlertTriangle className="w-4 h-4" />
          File Missing Developer Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">File Missing Developer Report</DialogTitle>
          <DialogDescription>
            Filing this report will change the project status to{" "}
            <strong>Missing Developer</strong> and start the 45-day governance waiting period.
            The project continues operating normally during this time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="gdEntryDate">GD Entry Date <span className="text-destructive">*</span></Label>
            <Input
              id="gdEntryDate"
              type="date"
              value={gdEntryDate}
              onChange={(e) => setGdEntryDate(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Date when the General Diary was filed at the police station. The 45-day countdown starts from this date.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gdNumber">GD Reference Number</Label>
            <Input
              id="gdNumber"
              placeholder="e.g. GD/TRP/2026/00123"
              value={gdNumber}
              onChange={(e) => setGdNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gdDocumentUrl">GD Document URL</Label>
            <Input
              id="gdDocumentUrl"
              placeholder="https://... (placeholder)"
              value={gdDocumentUrl}
              onChange={(e) => setGdDocumentUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remarks">Governance Remarks</Label>
            <Textarea
              id="remarks"
              placeholder="Context, observations, or instructions for this case..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              className="flex-1"
              disabled={!gdEntryDate || fileMutation.isPending}
            >
              {fileMutation.isPending ? "Filing..." : "File Report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({ projectId, caseId, onSuccess }: { projectId: string; caseId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"resolved" | "cancelled">("resolved");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const { toast } = useToast();
  const updateMutation = useUpdateMissingDeveloperCase();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate(
      {
        id: projectId,
        data: {
          status: action,
          ...(resolutionNotes ? { resolutionNotes } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: action === "resolved" ? "Case resolved" : "Case cancelled",
            description: "Project status has been restored.",
          });
          setOpen(false);
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to update case";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
          <XCircle className="w-4 h-4" />
          Close Case
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Close Missing Developer Case</DialogTitle>
          <DialogDescription>
            Closing this case will restore the project's previous status.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Resolution Type</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction("resolved")}
                className={`flex-1 text-sm px-3 py-2 rounded-lg border transition-colors ${
                  action === "resolved"
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-medium"
                    : "bg-background border-border text-muted-foreground"
                }`}
              >
                Resolved — Developer returned
              </button>
              <button
                type="button"
                onClick={() => setAction("cancelled")}
                className={`flex-1 text-sm px-3 py-2 rounded-lg border transition-colors ${
                  action === "cancelled"
                    ? "bg-gray-100 border-gray-300 text-gray-800 font-medium"
                    : "bg-background border-border text-muted-foreground"
                }`}
              >
                Cancelled — Filed in error
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resolutionNotes">Resolution Notes</Label>
            <Textarea
              id="resolutionNotes"
              placeholder="Optional notes about how this case was resolved..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Keep Open
            </Button>
            <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Closing..." : "Close Case"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MissingDeveloperPanel({ projectId }: Props) {
  const queryClient = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === "admin";
  const canFile = role === "admin" || role === "developer";

  const queryKey = getGetMissingDeveloperCaseQueryKey(projectId);
  const { data: activeCase, isLoading, error } = useGetMissingDeveloperCase(projectId, {
    query: { retry: false, queryKey },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent><Skeleton className="h-32 rounded-lg" /></CardContent>
      </Card>
    );
  }

  // No active case — show "File Report" button if eligible
  if (error || !activeCase) {
    if (!canFile) return null;
    return (
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="font-serif text-base text-muted-foreground">Missing Developer Workflow</CardTitle>
            </div>
            <FileReportDialog projectId={projectId} onSuccess={invalidate} />
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            If the project developer is unreachable, file a General Diary report to begin the 45-day governance waiting period.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const meta = STATUS_META[activeCase.status] ?? STATUS_META.active;

  return (
    <Card className="border-amber-200 bg-amber-50/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <CardTitle className="font-serif text-base">Missing Developer Case</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${meta.color}`}>
              {meta.label}
            </span>
            {isAdmin && (
              <ResolveDialog projectId={projectId} caseId={activeCase.id} onSuccess={invalidate} />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 ml-6">
          Project continues operating normally. Nominee becomes eligible for activation after the 45-day waiting period.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Countdown progress */}
        <CountdownBar
          daysElapsed={activeCase.daysElapsed}
          daysRemaining={activeCase.daysRemaining}
          isEligible={activeCase.isNomineeEligible}
        />

        {/* Eligibility alert */}
        {activeCase.isNomineeEligible && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50/50 text-sm">
            <CheckCircle2 className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-red-800">Nominee Eligible for Activation</p>
              <p className="text-xs text-red-700 mt-0.5">
                The 45-day waiting period has elapsed. The registered governance nominee is now eligible for activation as project developer continuity representative.
              </p>
            </div>
          </div>
        )}

        {/* Governance timeline */}
        <div className="pt-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Governance Timeline</p>
          <GovernanceTimeline
            gdEntryDate={activeCase.gdEntryDate}
            nomineeEligibleAt={activeCase.nomineeEligibleAt}
            daysElapsed={activeCase.daysElapsed}
            isEligible={activeCase.isNomineeEligible}
          />
        </div>

        {/* Case details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-1">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
            <CalendarDays className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">GD Entry Date</p>
              <p className="font-medium">{activeCase.gdEntryDate}</p>
            </div>
          </div>
          {activeCase.gdNumber && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
              <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">GD Reference</p>
                <p className="font-medium font-mono text-sm">{activeCase.gdNumber}</p>
              </div>
            </div>
          )}
          {activeCase.reportedByName && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
              <User className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Reported By</p>
                <p className="font-medium">{activeCase.reportedByName}</p>
              </div>
            </div>
          )}
          {activeCase.gdDocumentUrl && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
              <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">GD Document</p>
                <a
                  href={activeCase.gdDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline truncate block max-w-[180px]"
                >
                  View Document
                </a>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
            <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Case Filed</p>
              <p className="font-medium">{formatDate(activeCase.createdAt)}</p>
            </div>
          </div>
        </div>

        {/* Remarks */}
        {activeCase.remarks && (
          <div className="p-3 rounded-lg border bg-background">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Governance Remarks</p>
            <p className="text-sm text-muted-foreground">{activeCase.remarks}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
