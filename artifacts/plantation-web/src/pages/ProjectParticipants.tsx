import { useState } from "react";
import {
  useListProjectParticipants,
  useAddProjectParticipant,
  useUpdateProjectParticipant,
  useRemoveProjectParticipant,
  useListUsers,
  getListProjectParticipantsQueryKey,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import type { ProjectParticipant, UserProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { UserPlus, Pencil, Trash2, Users } from "lucide-react";

type ParticipantRole =
  | "landowner"
  | "developer"
  | "investor"
  | "operational_staff"
  | "employee";

const ROLE_LABELS: Record<ParticipantRole, string> = {
  landowner: "Landowner",
  developer: "Project Developer",
  investor: "Investor",
  operational_staff: "Operational Staff",
  employee: "Employee",
};

const ROLE_ORDER: ParticipantRole[] = [
  "landowner",
  "developer",
  "investor",
  "operational_staff",
  "employee",
];

const EXCLUSIVE_ROLES: ParticipantRole[] = ["landowner", "developer"];

const ROLE_COLORS: Record<ParticipantRole, string> = {
  landowner: "bg-emerald-100 text-emerald-800 border-emerald-200",
  developer: "bg-blue-100 text-blue-800 border-blue-200",
  investor: "bg-violet-100 text-violet-800 border-violet-200",
  operational_staff: "bg-amber-100 text-amber-800 border-amber-200",
  employee: "bg-gray-100 text-gray-700 border-gray-200",
};

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface AddEditDialogProps {
  projectId: string;
  existingParticipant?: ProjectParticipant;
  existingParticipants: ProjectParticipant[];
  allUsers: UserProfile[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function AddEditDialog({
  projectId,
  existingParticipant,
  existingParticipants,
  allUsers,
  open,
  onClose,
  onSuccess,
}: AddEditDialogProps) {
  const isEdit = !!existingParticipant;
  const addMutation = useAddProjectParticipant();
  const updateMutation = useUpdateProjectParticipant();

  const [clerkUserId, setClerkUserId] = useState(
    existingParticipant?.clerkUserId ?? "",
  );
  const [projectRole, setProjectRole] = useState<ParticipantRole>(
    (existingParticipant?.projectRole as ParticipantRole) ?? "employee",
  );
  const [joinDate, setJoinDate] = useState(
    existingParticipant?.joinDate ?? "",
  );
  const [isActive, setIsActive] = useState(
    existingParticipant?.isActive ?? true,
  );
  const [remarks, setRemarks] = useState(existingParticipant?.remarks ?? "");
  const [participationNotes, setParticipationNotes] = useState(
    existingParticipant?.participationNotes ?? "",
  );
  const [error, setError] = useState("");

  const alreadyAssignedIds = new Set(
    existingParticipants.map((p) => p.clerkUserId),
  );
  const availableUsers = isEdit
    ? allUsers
    : allUsers.filter((u) => !alreadyAssignedIds.has(u.clerkUserId));

  async function handleSubmit() {
    setError("");
    if (!isEdit && !clerkUserId) {
      setError("Please select a user.");
      return;
    }
    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          id: projectId,
          assignmentId: existingParticipant!.id,
          data: {
            projectRole,
            isActive,
            joinDate: joinDate || undefined,
            remarks: remarks || undefined,
            participationNotes: participationNotes || undefined,
          },
        });
      } else {
        await addMutation.mutateAsync({
          id: projectId,
          data: {
            clerkUserId,
            projectRole,
            joinDate: joinDate || undefined,
            remarks: remarks || undefined,
            participationNotes: participationNotes || undefined,
          },
        });
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Failed to save participant";
      setError(msg);
    }
  }

  const isPending = addMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {isEdit ? "Edit Participant" : "Add Participant"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>User</Label>
              <Select value={clerkUserId} onValueChange={setClerkUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user…" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u) => (
                    <SelectItem key={u.clerkUserId} value={u.clerkUserId}>
                      {u.displayName ?? u.email ?? u.clerkUserId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Project Role</Label>
            <Select
              value={projectRole}
              onValueChange={(v) => setProjectRole(v as ParticipantRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_ORDER.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                    {EXCLUSIVE_ROLES.includes(r) ? " (max 1)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Join Date</Label>
            <Input
              type="date"
              value={joinDate}
              onChange={(e) => setJoinDate(e.target.value)}
            />
          </div>

          {isEdit && (
            <div className="flex items-center gap-3">
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                id="is-active"
              />
              <Label htmlFor="is-active">Active Participant</Label>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Admin remarks about this assignment…"
              className="resize-none"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Participation Notes</Label>
            <Textarea
              value={participationNotes}
              onChange={(e) => setParticipationNotes(e.target.value)}
              placeholder="Details about this participant's role…"
              className="resize-none"
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save Changes" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectParticipantsProps {
  projectId: string;
}

export default function ProjectParticipants({ projectId }: ProjectParticipantsProps) {
  const { role } = useRole();
  const canManage = role === "admin" || role === "developer";
  const qc = useQueryClient();

  const { data: participants = [], isLoading } = useListProjectParticipants(
    projectId,
    {
      query: {
        enabled: !!projectId,
        queryKey: getListProjectParticipantsQueryKey(projectId),
      },
    },
  );

  const { data: allUsersData } = useListUsers({
    query: {
      enabled: canManage,
      queryKey: getListUsersQueryKey(),
    },
  });

  const allUsers: UserProfile[] = allUsersData ?? [];

  const removeMutation = useRemoveProjectParticipant();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectParticipant | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectParticipant | null>(null);

  function invalidate() {
    qc.invalidateQueries({
      queryKey: getListProjectParticipantsQueryKey(projectId),
    });
  }

  async function handleRemove() {
    if (!removeTarget) return;
    await removeMutation.mutateAsync({
      id: projectId,
      assignmentId: removeTarget.id,
    });
    setRemoveTarget(null);
    invalidate();
  }

  const grouped = ROLE_ORDER.reduce<Record<ParticipantRole, ProjectParticipant[]>>(
    (acc, r) => {
      acc[r] = participants.filter((p) => p.projectRole === r);
      return acc;
    },
    {
      landowner: [],
      developer: [],
      investor: [],
      operational_staff: [],
      employee: [],
    },
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif flex items-center gap-2">
            <Users className="w-5 h-5" />
            Project Team
          </CardTitle>
          {canManage && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setAddDialogOpen(true)}
            >
              <UserPlus className="w-4 h-4" />
              Add Participant
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Loading…
            </p>
          ) : participants.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No participants assigned to this project yet.
            </p>
          ) : (
            <div className="space-y-5">
              {ROLE_ORDER.map((r) => {
                const group = grouped[r];
                if (group.length === 0) return null;
                return (
                  <div key={r}>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium border ${ROLE_COLORS[r]}`}
                      >
                        {ROLE_LABELS[r]}
                      </span>
                      {EXCLUSIVE_ROLES.includes(r) && (
                        <span className="text-xs text-muted-foreground">
                          (1 per project)
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {group.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-start justify-between p-3 rounded-lg border bg-muted/20 gap-3"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <Avatar className="h-9 w-9 shrink-0">
                              {p.avatarUrl && (
                                <AvatarImage src={p.avatarUrl} alt={p.displayName ?? ""} />
                              )}
                              <AvatarFallback className="text-xs font-medium">
                                {getInitials(p.displayName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {p.displayName ?? p.email ?? p.clerkUserId}
                              </p>
                              {p.email && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {p.email}
                                </p>
                              )}
                              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                {p.joinDate && (
                                  <span className="text-xs text-muted-foreground">
                                    Joined {p.joinDate}
                                  </span>
                                )}
                                {!p.isActive && (
                                  <Badge variant="secondary" className="text-xs h-4">
                                    Inactive
                                  </Badge>
                                )}
                              </div>
                              {p.participationNotes && (
                                <p className="text-xs text-muted-foreground mt-1 italic">
                                  {p.participationNotes}
                                </p>
                              )}
                            </div>
                          </div>
                          {canManage && (
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditTarget(p)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setRemoveTarget(p)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && addDialogOpen && (
        <AddEditDialog
          projectId={projectId}
          existingParticipants={participants}
          allUsers={allUsers}
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onSuccess={invalidate}
        />
      )}

      {canManage && editTarget && (
        <AddEditDialog
          projectId={projectId}
          existingParticipant={editTarget}
          existingParticipants={participants}
          allUsers={allUsers}
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={invalidate}
        />
      )}

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Participant</AlertDialogTitle>
            <AlertDialogDescription>
              Remove{" "}
              <strong>
                {removeTarget?.displayName ??
                  removeTarget?.email ??
                  "this participant"}
              </strong>{" "}
              from the project? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
