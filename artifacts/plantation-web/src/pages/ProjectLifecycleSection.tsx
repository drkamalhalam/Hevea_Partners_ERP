import { useState } from "react";
import {
  useGetProjectLifecycle,
  useTransitionProjectLifecycle,
  getGetProjectLifecycleQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRole } from "@/contexts/RoleContext";
import LifecycleBadge, {
  type LifecycleStatus,
} from "@/components/lifecycle/LifecycleBadge";
import LifecycleTimeline from "@/components/lifecycle/LifecycleTimeline";
import { History, ArrowRight, AlertTriangle, User, Clock } from "lucide-react";

const ALLOWED_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  prematurity: ["mature_production", "closed"],
  mature_production: ["closed"],
  closed: [],
};

const TRANSITION_LABELS: Record<LifecycleStatus, string> = {
  prematurity: "Prematurity",
  mature_production: "Mature Production",
  closed: "Closed",
};

const TRANSITION_WARNINGS: Partial<Record<LifecycleStatus, string>> = {
  mature_production:
    "This action is irreversible. Once marked as Mature Production, the project cannot revert to Prematurity.",
  closed:
    "This action is irreversible. Closing a project is a permanent action and cannot be undone.",
};

interface TransitionDialogProps {
  projectId: string;
  currentStatus: LifecycleStatus;
  onSuccess: () => void;
}

function TransitionDialog({
  projectId,
  currentStatus,
  onSuccess,
}: TransitionDialogProps) {
  const [open, setOpen] = useState(false);
  const [toStatus, setToStatus] = useState<LifecycleStatus | "">("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useTransitionProjectLifecycle();
  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] ?? [];

  function handleSubmit() {
    if (!toStatus) return;
    setError(null);
    mutation.mutate(
      {
        id: projectId,
        data: { toStatus: toStatus as "mature_production" | "closed", remarks: remarks || undefined },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setToStatus("");
          setRemarks("");
          onSuccess();
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Transition failed";
          setError(msg);
        },
      },
    );
  }

  if (!allowedNext.length) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <ArrowRight className="w-4 h-4" />
          Advance Lifecycle
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Advance Project Lifecycle</DialogTitle>
          <DialogDescription>
            Select the next lifecycle phase. This action creates a permanent
            audit record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Transition To</Label>
            <Select
              value={toStatus}
              onValueChange={(v) => {
                setToStatus(v as LifecycleStatus);
                setError(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select next phase…" />
              </SelectTrigger>
              <SelectContent>
                {allowedNext.map((s) => (
                  <SelectItem key={s} value={s}>
                    {TRANSITION_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {toStatus && TRANSITION_WARNINGS[toStatus as LifecycleStatus] && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                {TRANSITION_WARNINGS[toStatus as LifecycleStatus]}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>
              Remarks{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              placeholder="Add context for this lifecycle change…"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!toStatus || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Confirm Transition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectLifecycleSectionProps {
  projectId: string;
}

export default function ProjectLifecycleSection({
  projectId,
}: ProjectLifecycleSectionProps) {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const canTransition = role === "admin" || role === "developer";

  const { data, isLoading } = useGetProjectLifecycle(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectLifecycleQueryKey(projectId),
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: getGetProjectLifecycleQueryKey(projectId),
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const currentStatus = data.currentStatus as LifecycleStatus;
  const history = data.history ?? [];
  const isTerminal = currentStatus === "closed";

  const transitionDate: Record<string, string> = {};
  for (const entry of history) {
    transitionDate[entry.toStatus] = entry.changedAt;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CardTitle className="font-serif">Project Lifecycle</CardTitle>
          <LifecycleBadge status={currentStatus} />
        </div>
        {canTransition && !isTerminal && (
          <TransitionDialog
            projectId={projectId}
            currentStatus={currentStatus}
            onSuccess={invalidate}
          />
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        <LifecycleTimeline
          currentStatus={currentStatus}
          transitionDate={transitionDate}
        />

        {isTerminal && (
          <Alert className="border-gray-200 bg-gray-50">
            <AlertDescription className="text-gray-600 text-sm">
              This project is closed. No further lifecycle transitions are
              possible.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">
              Status History
            </h4>
          </div>

          {!history.length ? (
            <p className="text-sm text-muted-foreground py-3 text-center">
              No lifecycle transitions recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
                >
                  <div className="shrink-0 mt-0.5">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                      <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      {entry.fromStatus ? (
                        <>
                          <LifecycleBadge
                            status={entry.fromStatus}
                            size="sm"
                          />
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        </>
                      ) : null}
                      <LifecycleBadge status={entry.toStatus} size="sm" />
                    </div>
                    {entry.remarks && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {entry.remarks}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      {entry.changedByName && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {entry.changedByName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(entry.changedAt).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
