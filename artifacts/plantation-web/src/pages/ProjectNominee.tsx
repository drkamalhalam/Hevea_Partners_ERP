import { useState } from "react";
import {
  useGetProjectNominee,
  useAddProjectNominee,
  useEditProjectNominee,
  useReplaceProjectNominee,
  useRemoveProjectNominee,
  getGetProjectNomineeQueryKey,
} from "@workspace/api-client-react";
import type { ProjectNominee } from "@workspace/api-client-react";
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
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  UserCheck,
  Pencil,
  RefreshCw,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  Info,
  User,
  Phone,
  MapPin,
  FileText,
  Heart,
} from "lucide-react";

const ACTIVATION_LABELS: Record<string, string> = {
  pending: "Pending",
  activated: "Activated",
  revoked: "Revoked",
};

const ACTIVATION_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  activated: "bg-green-100 text-green-800 border-green-200",
  revoked: "bg-red-100 text-red-800 border-red-200",
};

type NomineeFormData = {
  nomineeName: string;
  relationship: string;
  phone: string;
  address: string;
  idDocumentUrl: string;
};

function emptyForm(): NomineeFormData {
  return {
    nomineeName: "",
    relationship: "",
    phone: "",
    address: "",
    idDocumentUrl: "",
  };
}

function fromNominee(n: ProjectNominee): NomineeFormData {
  return {
    nomineeName: n.nomineeName,
    relationship: n.relationship,
    phone: n.phone,
    address: n.address,
    idDocumentUrl: n.idDocumentUrl ?? "",
  };
}

interface NomineeFormDialogProps {
  title: string;
  description?: string;
  initialData?: NomineeFormData;
  isWarning?: boolean;
  confirmLabel: string;
  open: boolean;
  isPending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (data: NomineeFormData) => void;
}

function NomineeFormDialog({
  title,
  description,
  initialData,
  isWarning,
  confirmLabel,
  open,
  isPending,
  error,
  onClose,
  onSubmit,
}: NomineeFormDialogProps) {
  const [form, setForm] = useState<NomineeFormData>(
    initialData ?? emptyForm(),
  );

  function set(field: keyof NomineeFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit() {
    if (!form.nomineeName.trim() || !form.relationship.trim() || !form.phone.trim() || !form.address.trim()) {
      return;
    }
    onSubmit(form);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            {isWarning && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        {isWarning && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The previous nominee will be archived. This action is for
              governance continuity only and confers no ownership rights.
            </span>
          </div>
        )}

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted-foreground" /> Full Name
            </Label>
            <Input
              value={form.nomineeName}
              onChange={(e) => set("nomineeName", e.target.value)}
              placeholder="Nominee's full legal name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-muted-foreground" />{" "}
              Relationship
            </Label>
            <Input
              value={form.relationship}
              onChange={(e) => set("relationship", e.target.value)}
              placeholder="e.g. Spouse, Sibling, Son, Daughter, Colleague"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-muted-foreground" /> Mobile
              Number
            </Label>
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+91 XXXXX XXXXX"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" /> Address
            </Label>
            <Textarea
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Full residential address"
              className="resize-none"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />{" "}
              Identity Document URL
              <span className="text-muted-foreground text-xs font-normal">
                (optional)
              </span>
            </Label>
            <Input
              value={form.idDocumentUrl}
              onChange={(e) => set("idDocumentUrl", e.target.value)}
              placeholder="https://… (Aadhaar / PAN / Passport scan)"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending ||
              !form.nomineeName.trim() ||
              !form.relationship.trim() ||
              !form.phone.trim() ||
              !form.address.trim()
            }
            variant={isWarning ? "destructive" : "default"}
          >
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectNomineeProps {
  projectId: string;
  isDevOrAdmin?: boolean;
}

export default function ProjectNomineeSection({
  projectId,
  isDevOrAdmin,
}: ProjectNomineeProps) {
  const { role } = useRole();
  const canManage = isDevOrAdmin ?? (role === "admin" || role === "developer");
  const isAdmin = role === "admin";

  const qc = useQueryClient();
  const nomineeQueryKey = getGetProjectNomineeQueryKey(projectId);

  const { data: nominee, isLoading } = useGetProjectNominee(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: nomineeQueryKey,
    },
  });

  const addMutation = useAddProjectNominee();
  const editMutation = useEditProjectNominee();
  const replaceMutation = useReplaceProjectNominee();
  const removeMutation = useRemoveProjectNominee();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [mutationError, setMutationError] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: nomineeQueryKey });
  }

  async function handleAdd(data: NomineeFormData) {
    setMutationError("");
    try {
      await addMutation.mutateAsync({
        id: projectId,
        data: {
          nomineeName: data.nomineeName,
          relationship: data.relationship,
          phone: data.phone,
          address: data.address,
          idDocumentUrl: data.idDocumentUrl || undefined,
        },
      });
      setAddOpen(false);
      invalidate();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to add nominee");
    }
  }

  async function handleEdit(data: NomineeFormData) {
    setMutationError("");
    try {
      await editMutation.mutateAsync({
        id: projectId,
        data: {
          nomineeName: data.nomineeName,
          relationship: data.relationship,
          phone: data.phone,
          address: data.address,
          idDocumentUrl: data.idDocumentUrl || undefined,
        },
      });
      setEditOpen(false);
      invalidate();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to edit nominee");
    }
  }

  async function handleReplace(data: NomineeFormData) {
    setMutationError("");
    try {
      await replaceMutation.mutateAsync({
        id: projectId,
        data: {
          nomineeName: data.nomineeName,
          relationship: data.relationship,
          phone: data.phone,
          address: data.address,
          idDocumentUrl: data.idDocumentUrl || undefined,
        },
      });
      setReplaceOpen(false);
      invalidate();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to replace nominee");
    }
  }

  async function handleRemove() {
    try {
      await removeMutation.mutateAsync({ id: projectId });
      setRemoveOpen(false);
      invalidate();
    } catch {
      /* handled by mutation state */
    }
  }

  const activationStatus = nominee?.activationStatus ?? "pending";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif flex items-center gap-2">
            <UserCheck className="w-5 h-5" />
            Governance Continuity Nominee
          </CardTitle>
          {canManage && !nominee && !isLoading && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setMutationError("");
                setAddOpen(true);
              }}
            >
              <UserCheck className="w-4 h-4" />
              Add Nominee
            </Button>
          )}
        </CardHeader>

        <CardContent>
          {/* Governance disclaimer */}
          <div className="flex gap-2 rounded-lg bg-muted/60 border p-3 text-xs text-muted-foreground mb-4">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <span>
              A nominee is registered for <strong>operational governance
              continuity only</strong>. Nomination confers no equity, ownership,
              or automatic transfer of rights. Activation is a separate
              administrative action.
            </span>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Loading…
            </p>
          ) : !nominee ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">
                  No nominee registered
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {canManage
                    ? "Please add a nominee to complete your project governance setup."
                    : "Awaiting nominee registration by the project developer."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Nominee card */}
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">
                        {nominee.nomineeName}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Heart className="w-3 h-3" /> {nominee.relationship}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border ${ACTIVATION_COLORS[activationStatus]}`}
                    >
                      {ACTIVATION_LABELS[activationStatus]}
                    </span>
                    {canManage && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit nominee details"
                          onClick={() => {
                            setMutationError("");
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-amber-600 hover:text-amber-700"
                          title="Replace nominee"
                          onClick={() => {
                            setMutationError("");
                            setReplaceOpen(true);
                          }}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Remove nominee"
                            onClick={() => setRemoveOpen(true)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm pt-1 border-t">
                  <div className="flex items-start gap-2">
                    <Phone className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <span>{nominee.phone}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <span className="break-words">{nominee.address}</span>
                  </div>
                  <div className="flex items-start gap-2 sm:col-span-2">
                    <FileText className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    {nominee.idDocumentUrl ? (
                      <a
                        href={nominee.idDocumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2 text-xs"
                      >
                        View ID Document
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">
                        No ID document uploaded
                      </span>
                    )}
                  </div>
                </div>

                {nominee.activationNotes && (
                  <p className="text-xs text-muted-foreground italic pt-1 border-t">
                    {nominee.activationNotes}
                  </p>
                )}
              </div>

              {activationStatus === "pending" && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  Activation is a separate administrative action and will only
                  be triggered in a governance continuity event.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add dialog */}
      <NomineeFormDialog
        title="Add Governance Nominee"
        confirmLabel="Add Nominee"
        open={addOpen}
        isPending={addMutation.isPending}
        error={mutationError}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
      />

      {/* Edit dialog */}
      <NomineeFormDialog
        title="Edit Nominee Details"
        confirmLabel="Save Changes"
        initialData={nominee ? fromNominee(nominee) : undefined}
        open={editOpen}
        isPending={editMutation.isPending}
        error={mutationError}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEdit}
      />

      {/* Replace dialog */}
      <NomineeFormDialog
        title="Replace Nominee"
        description="Enter the details of the new nominee. The current nominee will be archived."
        isWarning
        confirmLabel="Replace Nominee"
        open={replaceOpen}
        isPending={replaceMutation.isPending}
        error={mutationError}
        onClose={() => setReplaceOpen(false)}
        onSubmit={handleReplace}
      />

      {/* Remove confirmation */}
      <AlertDialog open={removeOpen} onOpenChange={(v) => !v && setRemoveOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Nominee</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{nominee?.nomineeName}</strong> as the governance
              nominee for this project? The record will be archived. This does
              not affect any ownership or equity.
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
