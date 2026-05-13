import { useState } from "react";
import {
  useListPartnerClaimants,
  useAddPartnerClaimant,
  useUpdatePartnerClaimant,
  useRemovePartnerClaimant,
  useListProjects,
  getListPartnerClaimantsQueryKey,
} from "@workspace/api-client-react";
import type { PartnerClaimant } from "@workspace/api-client-react";
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
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  User,
  Phone,
  MapPin,
  FileText,
  Heart,
  FolderOpen,
  Info,
  ShieldAlert,
} from "lucide-react";

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  registered: "Registered",
  pending_verification: "Pending Verification",
  verified: "Verified",
  disputed: "Disputed",
};

const STATUS_COLORS: Record<string, string> = {
  registered: "bg-slate-100 text-slate-700 border-slate-200",
  pending_verification: "bg-amber-100 text-amber-800 border-amber-200",
  verified: "bg-green-100 text-green-800 border-green-200",
  disputed: "bg-red-100 text-red-800 border-red-200",
};

type ClaimantStatus = "registered" | "pending_verification" | "verified" | "disputed";

type ClaimantFormData = {
  projectId: string;
  claimantName: string;
  relationship: string;
  phone: string;
  address: string;
  claimDocumentsUrl: string;
  status: ClaimantStatus;
  notes: string;
};

function emptyForm(defaultProjectId?: string): ClaimantFormData {
  return {
    projectId: defaultProjectId ?? "",
    claimantName: "",
    relationship: "",
    phone: "",
    address: "",
    claimDocumentsUrl: "",
    status: "registered",
    notes: "",
  };
}

function fromClaimant(c: PartnerClaimant): ClaimantFormData {
  return {
    projectId: c.projectId,
    claimantName: c.claimantName,
    relationship: c.relationship,
    phone: c.phone,
    address: c.address,
    claimDocumentsUrl: c.claimDocumentsUrl ?? "",
    status: (c.status as ClaimantStatus) ?? "registered",
    notes: c.notes ?? "",
  };
}

// ── Form dialog ────────────────────────────────────────────────────────────

interface ClaimantFormDialogProps {
  title: string;
  description?: string;
  initial?: ClaimantFormData;
  projectOptions: { id: string; name: string }[];
  lockProject?: boolean;
  confirmLabel: string;
  open: boolean;
  isPending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (data: ClaimantFormData) => void;
}

function ClaimantFormDialog({
  title,
  description,
  initial,
  projectOptions,
  lockProject,
  confirmLabel,
  open,
  isPending,
  error,
  onClose,
  onSubmit,
}: ClaimantFormDialogProps) {
  const [form, setForm] = useState<ClaimantFormData>(initial ?? emptyForm());

  function set<K extends keyof ClaimantFormData>(k: K, v: ClaimantFormData[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  const isValid =
    form.projectId.trim() !== "" &&
    form.claimantName.trim() !== "" &&
    form.relationship.trim() !== "" &&
    form.phone.trim() !== "" &&
    form.address.trim() !== "";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Project selector */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />{" "}
              Project
            </Label>
            {lockProject ? (
              <p className="text-sm px-3 py-2 rounded-md border bg-muted text-muted-foreground">
                {projectOptions.find((p) => p.id === form.projectId)?.name ??
                  form.projectId}
              </p>
            ) : (
              <Select
                value={form.projectId}
                onValueChange={(v) => set("projectId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Claimant name */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted-foreground" /> Full Name
            </Label>
            <Input
              value={form.claimantName}
              onChange={(e) => set("claimantName", e.target.value)}
              placeholder="Claimant's full legal name"
            />
          </div>

          {/* Relationship */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-muted-foreground" />{" "}
              Relationship
            </Label>
            <Input
              value={form.relationship}
              onChange={(e) => set("relationship", e.target.value)}
              placeholder="e.g. Son, Daughter, Spouse, Sibling, Legal Heir"
            />
          </div>

          {/* Phone */}
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

          {/* Address */}
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

          {/* Claim documents URL */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" /> Claim
              Documents URL{" "}
              <span className="text-muted-foreground text-xs font-normal">
                (optional)
              </span>
            </Label>
            <Input
              value={form.claimDocumentsUrl}
              onChange={(e) => set("claimDocumentsUrl", e.target.value)}
              placeholder="https://… (succession deed / will / NOC)"
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => set("status", v as ClaimantStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>
              Notes{" "}
              <span className="text-muted-foreground text-xs font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Any relevant notes about this claimant"
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
          <Button onClick={() => onSubmit(form)} disabled={isPending || !isValid}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface PartnerClaimantsProps {
  partnerId: string;
}

export default function PartnerClaimants({ partnerId }: PartnerClaimantsProps) {
  const { role } = useRole();
  const canManage = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const qc = useQueryClient();
  const claimantsKey = getListPartnerClaimantsQueryKey(partnerId);

  const { data: claimants = [], isLoading } = useListPartnerClaimants(
    partnerId,
    {},
    { query: { enabled: !!partnerId, queryKey: claimantsKey } },
  );

  const { data: allProjects = [] } = useListProjects();

  const addMutation = useAddPartnerClaimant();
  const editMutation = useUpdatePartnerClaimant();
  const removeMutation = useRemovePartnerClaimant();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PartnerClaimant | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PartnerClaimant | null>(null);
  const [mutationError, setMutationError] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: claimantsKey });
  }

  async function handleAdd(data: ClaimantFormData) {
    setMutationError("");
    try {
      await addMutation.mutateAsync({
        id: partnerId,
        data: {
          projectId: data.projectId,
          claimantName: data.claimantName,
          relationship: data.relationship,
          phone: data.phone,
          address: data.address,
          claimDocumentsUrl: data.claimDocumentsUrl || undefined,
          status: data.status,
          notes: data.notes || undefined,
        },
      });
      setAddOpen(false);
      invalidate();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to add claimant");
    }
  }

  async function handleEdit(data: ClaimantFormData) {
    if (!editTarget) return;
    setMutationError("");
    try {
      await editMutation.mutateAsync({
        id: partnerId,
        claimantId: editTarget.id,
        data: {
          claimantName: data.claimantName,
          relationship: data.relationship,
          phone: data.phone,
          address: data.address,
          claimDocumentsUrl: data.claimDocumentsUrl || undefined,
          status: data.status,
          notes: data.notes || undefined,
        },
      });
      setEditTarget(null);
      invalidate();
    } catch (e: unknown) {
      setMutationError(e instanceof Error ? e.message : "Failed to update claimant");
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    try {
      await removeMutation.mutateAsync({
        id: partnerId,
        claimantId: removeTarget.id,
      });
      setRemoveTarget(null);
      invalidate();
    } catch {
      /* noop */
    }
  }

  // Group claimants by project
  const byProject = claimants.reduce<Record<string, PartnerClaimant[]>>(
    (acc, c) => {
      (acc[c.projectId] ??= []).push(c);
      return acc;
    },
    {},
  );

  const projectOptions = allProjects.map((p) => ({ id: p.id, name: p.name }));

  function projectName(id: string) {
    return allProjects.find((p) => p.id === id)?.name ?? id;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif flex items-center gap-2">
            <Users className="w-5 h-5" />
            Claimants
            {claimants.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({claimants.length})
              </span>
            )}
          </CardTitle>
          {canManage && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setMutationError("");
                setAddOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              Add Claimant
            </Button>
          )}
        </CardHeader>

        <CardContent>
          {/* Disclaimer */}
          <div className="flex gap-2 rounded-lg bg-muted/60 border p-3 text-xs text-muted-foreground mb-4">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Claimant records capture succession/inheritance information for
              future reference only. No inheritance settlement or transfer logic
              is active at this stage. Records are organised per project.
            </span>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Loading…
            </p>
          ) : claimants.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-5 text-center justify-center">
              <div>
                <p className="text-sm text-muted-foreground">
                  No claimants registered for this partner yet.
                </p>
                {canManage && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the "Add Claimant" button to record a claimant.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {Object.entries(byProject).map(([projectId, projectClaimants]) => (
                <div key={projectId}>
                  {/* Project group header */}
                  <div className="flex items-center gap-2 mb-2">
                    <FolderOpen className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">
                      {projectName(projectId)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({projectClaimants.length} claimant
                      {projectClaimants.length !== 1 ? "s" : ""})
                    </span>
                  </div>

                  <div className="space-y-3 pl-6">
                    {projectClaimants.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border bg-muted/20 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <User className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">
                                {c.claimantName}
                              </p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Heart className="w-3 h-3" />
                                {c.relationship}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STATUS_COLORS[c.status]}`}
                            >
                              {STATUS_LABELS[c.status]}
                            </span>
                            {canManage && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Edit claimant"
                                  onClick={() => {
                                    setMutationError("");
                                    setEditTarget(c);
                                  }}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                {isAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    title="Remove claimant"
                                    onClick={() => setRemoveTarget(c)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mt-3 pt-3 border-t">
                          <div className="flex items-start gap-2">
                            <Phone className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                            <span>{c.phone}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <MapPin className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                            <span className="break-words">{c.address}</span>
                          </div>
                          <div className="flex items-start gap-2 sm:col-span-2">
                            <FileText className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                            {c.claimDocumentsUrl ? (
                              <a
                                href={c.claimDocumentsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline underline-offset-2 text-xs"
                              >
                                View Claim Documents
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">
                                No documents uploaded
                              </span>
                            )}
                          </div>
                        </div>

                        {c.notes && (
                          <p className="text-xs text-muted-foreground italic mt-2 pt-2 border-t flex items-start gap-1">
                            <Info className="w-3 h-3 mt-0.5 shrink-0" />
                            {c.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add dialog */}
      <ClaimantFormDialog
        title="Add Claimant"
        description="Record a claimant for this partner's project stake."
        initial={emptyForm()}
        projectOptions={projectOptions}
        confirmLabel="Add Claimant"
        open={addOpen}
        isPending={addMutation.isPending}
        error={mutationError}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
      />

      {/* Edit dialog */}
      {editTarget && (
        <ClaimantFormDialog
          title="Edit Claimant"
          initial={fromClaimant(editTarget)}
          projectOptions={projectOptions}
          lockProject
          confirmLabel="Save Changes"
          open={!!editTarget}
          isPending={editMutation.isPending}
          error={mutationError}
          onClose={() => setEditTarget(null)}
          onSubmit={handleEdit}
        />
      )}

      {/* Remove confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Claimant</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{removeTarget?.claimantName}</strong> as a claimant
              for the{" "}
              <strong>{projectName(removeTarget?.projectId ?? "")}</strong>{" "}
              stake? The record will be archived and no longer active. This does
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
