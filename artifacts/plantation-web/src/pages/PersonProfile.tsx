import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetPersonMaster,
  useGetPersonMasterAudit,
  useAssignPersonMasterRole,
  useRemovePersonMasterRole,
  useUpdatePersonMaster,
  getGetPersonMasterQueryKey,
  getGetPersonMasterAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Fingerprint,
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  Clock,
  ShieldAlert,
  CheckCircle2,
  UserPlus,
  X,
  Calendar,
  User2,
  FolderKanban,
  History,
  Tag,
  Building2,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function derivePersonId(id: string, createdAt: string): string {
  const year = new Date(createdAt).getFullYear();
  const hexSlice = id.replace(/-/g, "").slice(0, 5);
  const num = parseInt(hexSlice, 16) % 100000;
  return `PRS-${year}-${String(num).padStart(5, "0")}`;
}

const KYC_CONFIG: Record<string, { label: string; icon: React.ElementType; classes: string }> = {
  verified: { label: "KYC Verified", icon: ShieldCheck, classes: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  pending: { label: "KYC Pending", icon: Clock, classes: "bg-amber-100 text-amber-800 border-amber-200" },
  documents_submitted: { label: "Docs Submitted", icon: CheckCircle2, classes: "bg-blue-100 text-blue-800 border-blue-200" },
  flagged: { label: "Flagged", icon: ShieldAlert, classes: "bg-red-100 text-red-800 border-red-200" },
};

const ROLE_LABELS: Record<string, string> = {
  landowner: "Landowner",
  developer: "Developer",
  investor: "Investor",
  buyer: "Buyer",
  worker: "Worker",
  manager: "Manager",
  witness: "Witness",
  nominee: "Nominee",
  economic_participant: "Economic Participant",
  store_keeper: "Store Keeper",
  collection_agent: "Collection Agent",
  project_admin: "Project Admin",
};

const ROLE_COLORS: Record<string, string> = {
  landowner: "bg-emerald-100 text-emerald-800",
  developer: "bg-purple-100 text-purple-800",
  investor: "bg-blue-100 text-blue-800",
  buyer: "bg-orange-100 text-orange-800",
  worker: "bg-yellow-100 text-yellow-800",
  manager: "bg-indigo-100 text-indigo-800",
  witness: "bg-gray-100 text-gray-800",
  nominee: "bg-pink-100 text-pink-800",
  economic_participant: "bg-teal-100 text-teal-800",
  store_keeper: "bg-cyan-100 text-cyan-800",
  collection_agent: "bg-lime-100 text-lime-800",
  project_admin: "bg-rose-100 text-rose-800",
};

const ALL_ROLES = Object.keys(ROLE_LABELS);

function fmt(s?: string | null) {
  return s || "—";
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"details" | "roles" | "projects" | "audit">("details");
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [roleNotes, setRoleNotes] = useState("");

  const { data: person, isLoading } = useGetPersonMaster(id!);
  const { data: auditEvents = [] } = useGetPersonMasterAudit(id!, {
    query: { enabled: activeTab === "audit", queryKey: getGetPersonMasterAuditQueryKey(id!) },
  });

  const assignRole = useAssignPersonMasterRole();
  const removeRole = useRemovePersonMasterRole();
  const updatePerson = useUpdatePersonMaster();

  function handleAssignRole() {
    if (!selectedRole) return;
    assignRole.mutate(
      { id: id!, data: { role: selectedRole as any, notes: roleNotes || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPersonMasterQueryKey(id!) });
          toast({ title: "Role assigned" });
          setAddRoleOpen(false);
          setSelectedRole("");
          setRoleNotes("");
        },
        onError: () => toast({ title: "Failed to assign role", variant: "destructive" }),
      },
    );
  }

  function handleRemoveRole(roleId: string) {
    removeRole.mutate(
      { id: id!, roleId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPersonMasterQueryKey(id!) });
          toast({ title: "Role deactivated" });
        },
        onError: () => toast({ title: "Failed to remove role", variant: "destructive" }),
      },
    );
  }

  function handleKycChange(newStatus: string) {
    updatePerson.mutate(
      { id: id!, data: { kycStatus: newStatus as any } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPersonMasterQueryKey(id!) });
          toast({ title: `KYC status updated to ${newStatus.replace(/_/g, " ")}` });
        },
        onError: () => toast({ title: "Failed to update KYC status", variant: "destructive" }),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Person not found.{" "}
        <Link href="/person-registry">
          <Button variant="link">Back to registry</Button>
        </Link>
      </div>
    );
  }

  const pid = derivePersonId(person.id, person.createdAt);
  const kycCfg = KYC_CONFIG[person.kycStatus] ?? KYC_CONFIG.pending;
  const KycIcon = kycCfg.icon;
  const activeRoles = (person.roles ?? []).filter((r) => r.isActive);
  const projectLinks = person.projectLinks ?? [];

  const tabs: { key: typeof activeTab; label: string; icon: React.ElementType }[] = [
    { key: "details", label: "Details", icon: User2 },
    { key: "roles", label: `Roles (${activeRoles.length})`, icon: Tag },
    { key: "projects", label: `Projects (${projectLinks.length})`, icon: FolderKanban },
    { key: "audit", label: "Audit Trail", icon: History },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
      {/* Back */}
      <Link href="/person-registry">
        <Button variant="ghost" size="sm" className="gap-1 -ml-1">
          <ArrowLeft className="w-4 h-4" /> Person Registry
        </Button>
      </Link>

      {/* Profile header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-emerald-700">
              {person.fullName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-serif font-bold">{person.fullName}</h1>
            {person.sOnCOn && (
              <p className="text-sm text-muted-foreground">{person.sOnCOn}</p>
            )}
            <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">{pid}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium border ${kycCfg.classes}`}
          >
            <KycIcon className="w-3.5 h-3.5" />
            {kycCfg.label}
          </span>
          {person.aadhaarVerified === "yes" && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Fingerprint className="w-3 h-3" /> Aadhaar Verified
            </span>
          )}
        </div>
      </div>

      {/* Role chips */}
      {activeRoles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeRoles.map((r) => (
            <span
              key={r.id}
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS[r.role] ?? "bg-gray-100 text-gray-800"}`}
            >
              {ROLE_LABELS[r.role] ?? r.role}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b gap-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User2 className="w-4 h-4 text-muted-foreground" /> Personal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Father / Guardian" value={fmt(person.fatherGuardianName)} />
              <Row label="Date of Birth" value={fmtDate(person.dateOfBirth)} />
              <Row label="Gender" value={fmt(person.gender)} />
              <Separator />
              <Row
                label="Aadhaar"
                value={person.aadhaarLast4 ? `XXXX-XXXX-${person.aadhaarLast4}` : "—"}
              />
              <Row
                label="Aadhaar Verified"
                value={
                  <span className={person.aadhaarVerified === "yes" ? "text-emerald-700 font-medium" : ""}>
                    {person.aadhaarVerified === "yes" ? "Yes" : person.aadhaarVerified === "no" ? "No" : "Pending"}
                  </span>
                }
              />
              <Row label="OTP Verified" value={person.otpVerified === "yes" ? "Yes" : "No"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" /> Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Mobile" value={fmt(person.mobile)} />
              <Row label="Alternate Mobile" value={fmt(person.alternateMobile)} />
              <Row label="Email" value={fmt(person.email)} />
            </CardContent>
          </Card>

          <Card className="sm:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" /> Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Permanent Address" value={fmt(person.permanentAddress)} />
              <Row label="Current Address" value={fmt(person.currentAddress)} />
              <div className="grid grid-cols-3 gap-4">
                <Row label="Village" value={fmt(person.village)} />
                <Row label="District" value={fmt(person.district)} />
                <Row label="State" value={fmt(person.state)} />
              </div>
              <Row label="Country" value={fmt(person.country)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-muted-foreground" /> KYC Governance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Current Status" value={<KycBadge status={person.kycStatus} />} />
              <div>
                <p className="text-xs text-muted-foreground mb-1">Update KYC Status</p>
                <Select onValueChange={handleKycChange} value={person.kycStatus}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="documents_submitted">Documents Submitted</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" /> System
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Person ID" value={<span className="font-mono">{pid}</span>} />
              <Row label="UUID" value={<span className="font-mono text-xs break-all">{person.id}</span>} />
              <Row label="Registered" value={fmtDateTime(person.createdAt)} />
              {person.userId && (
                <Row label="Linked User" value={<Badge variant="outline" className="text-xs">Account Linked</Badge>} />
              )}
              {person.remarks && (
                <>
                  <Separator />
                  <Row label="Remarks" value={person.remarks} />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Roles tab ── */}
      {activeTab === "roles" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              A person may hold multiple roles simultaneously across projects.
            </p>
            <Button size="sm" onClick={() => setAddRoleOpen(true)} className="gap-1">
              <UserPlus className="w-4 h-4" /> Add Role
            </Button>
          </div>

          {activeRoles.length === 0 ? (
            <Card className="py-12 text-center">
              <Tag className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {activeRoles.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        ROLE_COLORS[r.role] ?? "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {ROLE_LABELS[r.role] ?? r.role}
                    </span>
                    {r.projectId ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> Project-scoped
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Global role</span>
                    )}
                    {r.notes && (
                      <span className="text-xs text-muted-foreground italic">{r.notes}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{fmtDate(r.createdAt)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveRole(r.id)}
                      disabled={removeRole.isPending}
                      title="Deactivate role"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Deactivated roles */}
          {(person.roles ?? []).filter((r) => !r.isActive).length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Show {(person.roles ?? []).filter((r) => !r.isActive).length} deactivated role(s)
              </summary>
              <div className="mt-2 space-y-1 opacity-50">
                {(person.roles ?? [])
                  .filter((r) => !r.isActive)
                  .map((r) => (
                    <div key={r.id} className="flex items-center gap-3 p-2 border rounded text-xs line-through">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[r.role] ?? "bg-gray-100 text-gray-800"}`}>
                        {ROLE_LABELS[r.role] ?? r.role}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Projects tab ── */}
      {activeTab === "projects" && (
        <div className="space-y-3">
          {projectLinks.length === 0 ? (
            <Card className="py-12 text-center">
              <FolderKanban className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                This person is not linked to any project yet.
              </p>
            </Card>
          ) : (
            projectLinks.map((link) => (
              <div
                key={link.participantId}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <p className="font-medium text-sm">{link.projectName}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    Role: {link.role?.replace(/_/g, " ")}
                  </p>
                </div>
                <Link href={`/projects/${link.projectId}`}>
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <FolderKanban className="w-3 h-3" /> View Project
                  </Button>
                </Link>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Audit tab ── */}
      {activeTab === "audit" && (
        <div className="space-y-2">
          {auditEvents.length === 0 ? (
            <Card className="py-12 text-center">
              <History className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No audit events recorded.</p>
            </Card>
          ) : (
            <div className="relative">
              <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />
              <div className="space-y-3">
                {auditEvents.map((e) => (
                  <div key={e.id} className="flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-muted border flex items-center justify-center flex-shrink-0 z-10">
                      <History className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 pb-2">
                      <p className="text-sm font-medium capitalize">
                        {e.eventType?.replace(/_/g, " ")}
                      </p>
                      {e.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{e.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {fmtDateTime(e.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add Role Dialog ── */}
      <Dialog open={addRoleOpen} onOpenChange={setAddRoleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Assign Role</DialogTitle>
            <DialogDescription className="text-xs">
              Assign a new role to {person.fullName}. A person may hold multiple roles simultaneously.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Role</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role…" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <Input
                placeholder="Any context for this role…"
                value={roleNotes}
                onChange={(e) => setRoleNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddRoleOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAssignRole}
                disabled={!selectedRole || assignRole.isPending}
              >
                {assignRole.isPending ? "Assigning…" : "Assign Role"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground min-w-[130px] shrink-0">{label}</span>
      <span className="font-medium text-right flex-1">{value}</span>
    </div>
  );
}

function KycBadge({ status }: { status: string }) {
  const cfg = KYC_CONFIG[status] ?? KYC_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border ${cfg.classes}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
