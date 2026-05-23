import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetPersonMaster,
  useGetPersonMasterAudit,
  useAssignPersonMasterRole,
  useRemovePersonMasterRole,
  useUpdatePersonMaster,
  useChangePersonMasterStatus,
  useGetPersonMasterStatusHistory,
  useGetPersonMasterRelationships,
  useGetPersonWorkAssignments,
  getGetPersonMasterQueryKey,
  getGetPersonMasterAuditQueryKey,
  getGetPersonMasterStatusHistoryQueryKey,
  getGetPersonMasterRelationshipsQueryKey,
  type PersonStatusChangeInput,
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
import { Textarea } from "@/components/ui/textarea";
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
  Banknote,
  UserCheck,
  Network,
  AlertTriangle,
  SkullIcon,
  Archive,
  RotateCcw,
  RefreshCw,
  CreditCard,
  Briefcase,
  Eye,
  Loader2,
  Plus,
  Receipt,
  ShoppingCart,
  ExternalLink,
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

const STATUS_CONFIG: Record<string, { label: string; classes: string; icon: React.ElementType }> = {
  active: { label: "Active", classes: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  inactive: { label: "Inactive", classes: "bg-gray-100 text-gray-700 border-gray-200", icon: Clock },
  deceased: { label: "Deceased", classes: "bg-slate-200 text-slate-700 border-slate-300", icon: SkullIcon },
  archived: { label: "Archived", classes: "bg-orange-100 text-orange-800 border-orange-200", icon: Archive },
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

// ── Assignment card (used in Assignments tab) ──────────────────────────────

const WORK_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  store_entry: { label: "Store Entry", icon: Building2, color: "text-amber-600" },
  observer: { label: "Observer", icon: Eye, color: "text-purple-600" },
  store_sale_operator: { label: "Store Sale Operator", icon: ShoppingCart, color: "text-emerald-600" },
  general_responsibility: { label: "General Responsibility", icon: Briefcase, color: "text-blue-600" },
  collection_entry: { label: "Collection Entry", icon: UserCheck, color: "text-cyan-600" },
};

const WORK_STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  active: { label: "Active", classes: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  completed: { label: "Completed", classes: "bg-slate-100 text-slate-700 border-slate-200" },
  expired: { label: "Expired", classes: "bg-red-100 text-red-700 border-red-200" },
  archived: { label: "Archived", classes: "bg-orange-100 text-orange-700 border-orange-200" },
};

function AssignmentCard({ a, faded }: { a: any; faded?: boolean }) {
  const typeCfg = WORK_TYPE_CONFIG[a.assignmentType] ?? WORK_TYPE_CONFIG.general_responsibility;
  const statusCfg = WORK_STATUS_CONFIG[a.status] ?? WORK_STATUS_CONFIG.active;
  const Icon = typeCfg.icon;

  function fmtD(s?: string | null) {
    if (!s) return null;
    return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <div className={`flex items-start justify-between p-3 border rounded-lg gap-3 ${faded ? "opacity-55" : ""}`}>
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        <Icon className={`w-4 h-4 ${typeCfg.color} mt-0.5 shrink-0`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{typeCfg.label}</p>
            {a.title && <span className="text-xs text-muted-foreground">— {a.title}</span>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
            {a.projectNameSnapshot && <span>{a.projectNameSnapshot}</span>}
            {a.storeNameSnapshot && (
              <span className="flex items-center gap-0.5">
                <Building2 className="w-2.5 h-2.5" /> {a.storeNameSnapshot}
              </span>
            )}
            {a.place && (
              <span className="flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" /> {a.place}
              </span>
            )}
            {a.expenditurePermission && (
              <span className="flex items-center gap-0.5 text-orange-600">
                <Receipt className="w-2.5 h-2.5" /> Expenditure
              </span>
            )}
            {(a.startDate || a.endDate) && (
              <span>{fmtD(a.startDate)} → {a.endDate ? fmtD(a.endDate) : "open"}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Badge variant="outline" className={`text-[10px] ${statusCfg.classes}`}>
          {statusCfg.label}
        </Badge>
        <Link href="/assign-work">
          <span className="text-[10px] text-blue-600 hover:underline cursor-pointer flex items-center gap-0.5">
            <ExternalLink className="w-2.5 h-2.5" /> View
          </span>
        </Link>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

type TabKey = "details" | "bank" | "roles" | "projects" | "assignments" | "relationships" | "audit";

export default function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [roleNotes, setRoleNotes] = useState("");
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [editBankOpen, setEditBankOpen] = useState(false);
  const [editNomineeOpen, setEditNomineeOpen] = useState(false);

  // Status change form state
  const [statusTarget, setStatusTarget] = useState<string>("");
  const [statusReason, setStatusReason] = useState("");
  const [statusNotes, setStatusNotes] = useState("");
  const [dodValue, setDodValue] = useState("");
  const [deathRemarks, setDeathRemarks] = useState("");

  // Bank edit form state
  const [bankForm, setBankForm] = useState({
    bankAccountNumber: "", bankIfsc: "", bankName: "",
    bankBranch: "", bankAccountHolderName: "", bankAccountType: "savings",
  });

  // Nominee edit form state
  const [nomineeForm, setNomineeForm] = useState({
    personNomineeName: "", personNomineeRelationship: "",
    personNomineeMobile: "", personNomineeAddress: "",
  });

  const { data: person, isLoading } = useGetPersonMaster(id!);
  const { data: auditEvents = [] } = useGetPersonMasterAudit(id!, {
    query: { enabled: activeTab === "audit", queryKey: getGetPersonMasterAuditQueryKey(id!) },
  });
  const { data: statusHistory = [] } = useGetPersonMasterStatusHistory(id!, {
    query: { enabled: activeTab === "audit", queryKey: getGetPersonMasterStatusHistoryQueryKey(id!) },
  });
  const { data: relationships } = useGetPersonMasterRelationships(id!, {
    query: { enabled: activeTab === "relationships", queryKey: getGetPersonMasterRelationshipsQueryKey(id!) },
  });
  const { data: workAssignmentsRaw, isLoading: assignmentsLoading } = useGetPersonWorkAssignments(id!, {}, {
    query: { enabled: activeTab === "assignments", queryKey: ["work-assignments-person", id!] },
  });
  const workAssignments: any[] = (workAssignmentsRaw as any) ?? [];

  const assignRole = useAssignPersonMasterRole();
  const removeRole = useRemovePersonMasterRole();
  const updatePerson = useUpdatePersonMaster();
  const changeStatus = useChangePersonMasterStatus();

  function invalidatePerson() {
    queryClient.invalidateQueries({ queryKey: getGetPersonMasterQueryKey(id!) });
  }

  function handleAssignRole() {
    if (!selectedRole) return;
    assignRole.mutate(
      { id: id!, data: { role: selectedRole as any, notes: roleNotes || undefined } },
      {
        onSuccess: () => {
          invalidatePerson();
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
        onSuccess: () => { invalidatePerson(); toast({ title: "Role deactivated" }); },
        onError: () => toast({ title: "Failed to remove role", variant: "destructive" }),
      },
    );
  }

  function handleKycChange(newStatus: string) {
    updatePerson.mutate(
      { id: id!, data: { kycStatus: newStatus as any } },
      {
        onSuccess: () => { invalidatePerson(); toast({ title: `KYC status updated` }); },
        onError: () => toast({ title: "Failed to update KYC status", variant: "destructive" }),
      },
    );
  }

  function handleStatusChange() {
    if (!statusTarget || !statusReason) return;
    const payload: PersonStatusChangeInput = {
      toStatus: statusTarget as any,
      reason: statusReason,
      notes: statusNotes || undefined,
    };
    if (statusTarget === "deceased") {
      (payload as any).dateOfDeath = dodValue || undefined;
      (payload as any).deathRemarks = deathRemarks || undefined;
    }
    changeStatus.mutate(
      { id: id!, data: payload },
      {
        onSuccess: () => {
          invalidatePerson();
          queryClient.invalidateQueries({ queryKey: getGetPersonMasterStatusHistoryQueryKey(id!) });
          toast({ title: `Status updated to ${statusTarget}` });
          setStatusDialogOpen(false);
          setStatusTarget("");
          setStatusReason("");
          setStatusNotes("");
          setDodValue("");
          setDeathRemarks("");
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.message ?? "Failed to change status";
          toast({ title: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleSaveBank() {
    const payload = Object.fromEntries(
      Object.entries(bankForm).filter(([, v]) => v !== ""),
    );
    updatePerson.mutate(
      { id: id!, data: payload as any },
      {
        onSuccess: () => {
          invalidatePerson();
          toast({ title: "Bank information saved" });
          setEditBankOpen(false);
        },
        onError: () => toast({ title: "Failed to save bank information", variant: "destructive" }),
      },
    );
  }

  function handleSaveNominee() {
    const payload = Object.fromEntries(
      Object.entries(nomineeForm).filter(([, v]) => v !== ""),
    );
    updatePerson.mutate(
      { id: id!, data: payload as any },
      {
        onSuccess: () => {
          invalidatePerson();
          toast({ title: "Nominee information saved" });
          setEditNomineeOpen(false);
        },
        onError: () => toast({ title: "Failed to save nominee information", variant: "destructive" }),
      },
    );
  }

  function openBankEdit() {
    setBankForm({
      bankAccountNumber: person?.bankAccountNumber ?? "",
      bankIfsc: person?.bankIfsc ?? "",
      bankName: person?.bankName ?? "",
      bankBranch: person?.bankBranch ?? "",
      bankAccountHolderName: person?.bankAccountHolderName ?? "",
      bankAccountType: person?.bankAccountType ?? "savings",
    });
    setEditBankOpen(true);
  }

  function openNomineeEdit() {
    setNomineeForm({
      personNomineeName: person?.personNomineeName ?? "",
      personNomineeRelationship: person?.personNomineeRelationship ?? "",
      personNomineeMobile: person?.personNomineeMobile ?? "",
      personNomineeAddress: person?.personNomineeAddress ?? "",
    });
    setEditNomineeOpen(true);
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
  const statusCfg = STATUS_CONFIG[person.status] ?? STATUS_CONFIG.active;
  const StatusIcon = statusCfg.icon;
  const activeRoles = (person.roles ?? []).filter((r) => r.isActive);
  const projectLinks = person.projectLinks ?? [];

  const isDeceased = person.status === "deceased";
  const isArchived = person.status === "archived";

  const activeWorkAssignments = workAssignments.filter(
    (a: any) => a.status === "active" || a.status === "pending",
  );

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "details", label: "Details", icon: User2 },
    { key: "bank", label: "Bank & Nominee", icon: Banknote },
    { key: "roles", label: `Roles (${activeRoles.length})`, icon: Tag },
    { key: "projects", label: `Projects (${projectLinks.length})`, icon: FolderKanban },
    { key: "assignments", label: "Assignments", icon: Briefcase },
    { key: "relationships", label: "Relationships", icon: Network },
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

      {/* Deceased / Archived banner */}
      {(isDeceased || isArchived) && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium ${isDeceased ? "bg-slate-100 border-slate-300 text-slate-700" : "bg-orange-50 border-orange-200 text-orange-800"}`}>
          <StatusIcon className="w-4 h-4 flex-shrink-0" />
          {isDeceased && (
            <span>
              This person is recorded as deceased
              {person.dateOfDeath ? ` — Date of Death: ${fmtDate(person.dateOfDeath)}` : ""}.
              Ownership records are not altered automatically.
            </span>
          )}
          {isArchived && (
            <span>This record is archived. No active operations can be performed.</span>
          )}
        </div>
      )}

      {/* Profile header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${isDeceased ? "bg-slate-200" : isArchived ? "bg-orange-100" : "bg-emerald-100"}`}>
            <span className={`text-2xl font-bold ${isDeceased ? "text-slate-500" : isArchived ? "text-orange-700" : "text-emerald-700"}`}>
              {person.fullName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className={`text-2xl font-serif font-bold ${isDeceased ? "line-through text-muted-foreground" : ""}`}>
              {person.fullName}
            </h1>
            {person.sOnCOn && (
              <p className="text-sm text-muted-foreground">{person.sOnCOn}</p>
            )}
            <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">{pid}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Lifecycle status badge */}
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium border ${statusCfg.classes}`}>
            <StatusIcon className="w-3.5 h-3.5" />
            {statusCfg.label}
          </span>
          {/* KYC badge */}
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium border ${kycCfg.classes}`}>
            <KycIcon className="w-3.5 h-3.5" />
            {kycCfg.label}
          </span>
          {person.aadhaarVerified === "yes" && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Fingerprint className="w-3 h-3" /> Aadhaar Verified
            </span>
          )}
          {/* Admin status actions */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs h-7"
            onClick={() => setStatusDialogOpen(true)}
          >
            <RefreshCw className="w-3 h-3" /> Change Status
          </Button>
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
      <div className="flex border-b gap-1 flex-wrap">
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
              <Row label="PAN Number" value={fmt(person.panNumber)} />
              <Row label="Communication" value={fmt(person.communicationPreference)} />
              <Separator />
              <Row label="Aadhaar" value={person.aadhaarLast4 ? `XXXX-XXXX-${person.aadhaarLast4}` : "—"} />
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

          {/* Deceased info (only shown if deceased) */}
          {isDeceased && (
            <Card className="sm:col-span-2 border-slate-200 bg-slate-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
                  <SkullIcon className="w-4 h-4" /> Deceased Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Date of Death" value={fmtDate(person.dateOfDeath)} />
                <Row label="Remarks" value={fmt(person.deathRemarks)} />
                {person.deathDocumentPath && (
                  <Row label="Death Document" value={<span className="text-xs text-blue-600">Uploaded</span>} />
                )}
              </CardContent>
            </Card>
          )}

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
              <Row
                label="Lifecycle Status"
                value={
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border ${statusCfg.classes}`}>
                    <StatusIcon className="w-3 h-3" />{statusCfg.label}
                  </span>
                }
              />
              {isArchived && (
                <Row label="Archived At" value={fmtDateTime(person.archivedAt)} />
              )}
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

      {/* ── Bank & Nominee tab ── */}
      {activeTab === "bank" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-muted-foreground" /> Bank Information
                </CardTitle>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openBankEdit}>
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {person.bankAccountNumber ? (
                <>
                  <Row label="Account Number" value={`XXXXXXXX${person.bankAccountNumber.slice(-4)}`} />
                  <Row label="IFSC Code" value={fmt(person.bankIfsc)} />
                  <Row label="Bank Name" value={fmt(person.bankName)} />
                  <Row label="Branch" value={fmt(person.bankBranch)} />
                  <Row label="Account Holder" value={fmt(person.bankAccountHolderName)} />
                  <Row label="Account Type" value={fmt(person.bankAccountType)} />
                </>
              ) : (
                <p className="text-muted-foreground text-xs py-4 text-center">No bank information recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-muted-foreground" /> Person Nominee
                </CardTitle>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openNomineeEdit}>
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {person.personNomineeName ? (
                <>
                  <Row label="Nominee Name" value={fmt(person.personNomineeName)} />
                  <Row label="Relationship" value={fmt(person.personNomineeRelationship)} />
                  <Row label="Mobile" value={fmt(person.personNomineeMobile)} />
                  <Row label="Address" value={fmt(person.personNomineeAddress)} />
                </>
              ) : (
                <p className="text-muted-foreground text-xs py-4 text-center">No nominee information recorded.</p>
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
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS[r.role] ?? "bg-gray-100 text-gray-800"}`}>
                      {ROLE_LABELS[r.role] ?? r.role}
                    </span>
                    {r.projectId ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> Project-scoped
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Global role</span>
                    )}
                    {r.notes && <span className="text-xs text-muted-foreground italic">{r.notes}</span>}
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

          {(person.roles ?? []).filter((r) => !r.isActive).length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Show {(person.roles ?? []).filter((r) => !r.isActive).length} deactivated role(s)
              </summary>
              <div className="mt-2 space-y-1 opacity-50">
                {(person.roles ?? []).filter((r) => !r.isActive).map((r) => (
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
              <p className="text-sm text-muted-foreground">This person is not linked to any project yet.</p>
            </Card>
          ) : (
            projectLinks.map((link) => (
              <div key={link.participantId} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">{link.projectName}</p>
                  <p className="text-xs text-muted-foreground capitalize">Role: {link.role?.replace(/_/g, " ")}</p>
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

      {/* ── Assignments tab ── */}
      {activeTab === "assignments" && (
        <div className="space-y-4">
          {assignmentsLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading assignments…
            </div>
          ) : workAssignments.length === 0 ? (
            <Card className="py-12 text-center">
              <Briefcase className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No work assignments for this person.</p>
              <Link href="/assign-work">
                <Button variant="outline" size="sm" className="mt-3 gap-1.5 text-xs">
                  <Plus className="w-3 h-3" /> Go to Assign Work
                </Button>
              </Link>
            </Card>
          ) : (
            <>
              {/* Current / active */}
              {activeWorkAssignments.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Current ({activeWorkAssignments.length})
                  </p>
                  <div className="space-y-2">
                    {activeWorkAssignments.map((a: any) => (
                      <AssignmentCard key={a.id} a={a} />
                    ))}
                  </div>
                </div>
              )}

              {/* Historical */}
              {workAssignments.filter((a: any) => !["active", "pending"].includes(a.status)).length > 0 && (
                <details className="group">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none transition-colors">
                    {workAssignments.filter((a: any) => !["active", "pending"].includes(a.status)).length} historical assignment(s)
                  </summary>
                  <div className="space-y-2 mt-2">
                    {workAssignments
                      .filter((a: any) => !["active", "pending"].includes(a.status))
                      .map((a: any) => (
                        <AssignmentCard key={a.id} a={a} faded />
                      ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Relationships tab ── */}
      {activeTab === "relationships" && (
        <div className="space-y-4">
          {!relationships ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <RelationshipSection
                title="Project Participation"
                icon={FolderKanban}
                count={(relationships.projectParticipations ?? []).length}
                empty="No project participations"
              >
                {(relationships.projectParticipations ?? []).map((p) => (
                  <RelationRow key={p.id} label={p.projectName ?? ""} sub={`Role: ${p.role}`}>
                    <Link href={`/projects/${p.projectId}`}>
                      <Button variant="ghost" size="icon" className="h-6 w-6"><Eye className="w-3 h-3" /></Button>
                    </Link>
                  </RelationRow>
                ))}
              </RelationshipSection>

              <RelationshipSection
                title="Workforce Assignments"
                icon={Briefcase}
                count={(relationships.workforceAssignments ?? []).length}
                empty="No workforce assignments"
              >
                {(relationships.workforceAssignments ?? []).map((a) => (
                  <RelationRow key={a.id} label={a.projectName ?? ""} sub={`${a.role} · ${a.isActive ? "Active" : "Inactive"}`} />
                ))}
              </RelationshipSection>

              <RelationshipSection
                title="Partner Records"
                icon={User2}
                count={(relationships.partnerLinks ?? []).length}
                empty="No partner records"
              >
                {(relationships.partnerLinks ?? []).map((p) => (
                  <RelationRow key={p.id} label={p.name ?? ""} sub={`Role: ${p.role}`} />
                ))}
              </RelationshipSection>

              <RelationshipSection
                title="Nominees"
                icon={UserCheck}
                count={(relationships.nominees ?? []).length}
                empty="No nominee records"
              >
                {(relationships.nominees ?? []).map((n) => (
                  <RelationRow key={n.id} label={n.projectName ?? ""} sub={`Nominee: ${n.nomineeName} · ${n.activationStatus}`} />
                ))}
              </RelationshipSection>

              <RelationshipSection
                title="Inheritance Claimants"
                icon={AlertTriangle}
                count={(relationships.claimants ?? []).length}
                empty="No inheritance claims"
              >
                {(relationships.claimants ?? []).map((c) => (
                  <RelationRow key={c.id} label={c.projectName ?? ""} sub={`Claimant: ${c.claimantName} · ${c.status}`} />
                ))}
              </RelationshipSection>

              <RelationshipSection
                title="Buyer Records"
                icon={Tag}
                count={(relationships.buyerLinks ?? []).length}
                empty="No buyer records"
              >
                {(relationships.buyerLinks ?? []).map((b) => (
                  <RelationRow key={b.id} label={b.name ?? ""} sub={`Type: ${b.buyerType}`} />
                ))}
              </RelationshipSection>

              <RelationshipSection
                title="Witnesses"
                icon={Eye}
                count={(relationships.witnesses ?? []).length}
                empty="No witness records"
              >
                {(relationships.witnesses ?? []).map((w) => (
                  <RelationRow key={w.id} label={w.projectName ?? ""} sub={`Witness: ${w.fullName}`} />
                ))}
              </RelationshipSection>
            </>
          )}
        </div>
      )}

      {/* ── Audit tab ── */}
      {activeTab === "audit" && (
        <div className="space-y-6">
          {/* Status history */}
          {statusHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" /> Status History
              </h3>
              <div className="space-y-2">
                {statusHistory.map((h) => (
                  <div key={h.id} className="p-3 border rounded-lg text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {h.fromStatus && (
                          <>
                            <StatusPill status={h.fromStatus} />
                            <span className="text-muted-foreground">→</span>
                          </>
                        )}
                        <StatusPill status={h.toStatus} />
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{h.reason}</p>
                    {h.changedByName && <p className="text-xs text-muted-foreground/60">By: {h.changedByName}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit timeline */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" /> Activity Log
            </h3>
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
                        <p className="text-sm font-medium capitalize">{e.eventType?.replace(/_/g, " ")}</p>
                        {e.description && <p className="text-xs text-muted-foreground mt-0.5">{e.description}</p>}
                        <p className="text-xs text-muted-foreground/60 mt-1">{fmtDateTime(e.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Status Change Dialog ── */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Change Person Status</DialogTitle>
            <DialogDescription className="text-xs">
              Current status: <strong>{person.status}</strong>. Archive is blocked if active relationships exist.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">New Status</label>
              <Select value={statusTarget} onValueChange={setStatusTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="deceased">Deceased</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {statusTarget === "deceased" && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Date of Death</label>
                  <Input type="date" value={dodValue} onChange={(e) => setDodValue(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Death Remarks (optional)</label>
                  <Input placeholder="e.g. Hospital, cause…" value={deathRemarks} onChange={(e) => setDeathRemarks(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <label className="text-sm font-medium mb-1 block">Reason <span className="text-red-500">*</span></label>
              <Textarea
                placeholder="Reason for this status change…"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <Input placeholder="Any supporting notes…" value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleStatusChange}
                disabled={!statusTarget || statusReason.length < 5 || changeStatus.isPending}
                variant={statusTarget === "archived" ? "destructive" : "default"}
              >
                {changeStatus.isPending ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Bank Dialog ── */}
      <Dialog open={editBankOpen} onOpenChange={setEditBankOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Bank Information</DialogTitle>
            <DialogDescription className="text-xs">
              This information is stored securely and audited on every change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(["bankAccountNumber", "bankIfsc", "bankName", "bankBranch", "bankAccountHolderName"] as const).map((field) => (
              <div key={field}>
                <label className="text-sm font-medium mb-1 block capitalize">{field.replace(/([A-Z])/g, " $1").replace("bank ", "").trim()}</label>
                <Input
                  value={bankForm[field]}
                  onChange={(e) => setBankForm((prev) => ({ ...prev, [field]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <label className="text-sm font-medium mb-1 block">Account Type</label>
              <Select value={bankForm.bankAccountType} onValueChange={(v) => setBankForm((prev) => ({ ...prev, bankAccountType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="current">Current</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditBankOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveBank} disabled={updatePerson.isPending}>
                {updatePerson.isPending ? "Saving…" : "Save Bank Info"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Nominee Dialog ── */}
      <Dialog open={editNomineeOpen} onOpenChange={setEditNomineeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Person Nominee</DialogTitle>
            <DialogDescription className="text-xs">
              The person nominated by {person.fullName} for their personal accounts and assets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Nominee Name</label>
              <Input value={nomineeForm.personNomineeName} onChange={(e) => setNomineeForm((p) => ({ ...p, personNomineeName: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Relationship</label>
              <Input value={nomineeForm.personNomineeRelationship} onChange={(e) => setNomineeForm((p) => ({ ...p, personNomineeRelationship: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Mobile</label>
              <Input value={nomineeForm.personNomineeMobile} onChange={(e) => setNomineeForm((p) => ({ ...p, personNomineeMobile: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Address</label>
              <Input value={nomineeForm.personNomineeAddress} onChange={(e) => setNomineeForm((p) => ({ ...p, personNomineeAddress: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditNomineeOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveNominee} disabled={updatePerson.isPending}>
                {updatePerson.isPending ? "Saving…" : "Save Nominee"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                <SelectTrigger><SelectValue placeholder="Select role…" /></SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
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
              <Button variant="outline" onClick={() => setAddRoleOpen(false)}>Cancel</Button>
              <Button onClick={handleAssignRole} disabled={!selectedRole || assignRole.isPending}>
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
      <span className="text-muted-foreground min-w-[140px] shrink-0">{label}</span>
      <span className="font-medium flex-1">{value}</span>
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

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium border ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

function RelationshipSection({
  title,
  icon: Icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" /> {title}
          </span>
          <Badge variant="secondary" className="text-xs">{count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">{empty}</p>
        ) : (
          <div className="space-y-2">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function RelationRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1 border-b last:border-0 text-sm gap-2">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      {children}
    </div>
  );
}
