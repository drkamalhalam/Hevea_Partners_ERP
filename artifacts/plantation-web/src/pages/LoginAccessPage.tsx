import { useState } from "react";
import {
  useListUsers,
  useActivateUserLogin,
  useSuspendUserLogin,
  useRestoreUserLogin,
  useArchiveUserLogin,
  useGetUserLoginAudit,
  getGetUserLoginAuditQueryKey,
  usePreProvisionLogin,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserCog,
  UserCheck,
  UserX,
  UserPlus,
  History,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Archive,
  CheckCircle2,
  User,
  Link,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { PersonMasterSelector } from "@/components/PersonMasterSelector";
import type { PersonSummary } from "@/components/PersonMasterSelector";

// ── Types ──────────────────────────────────────────────────────────────────

type LoginStatus = "pending_activation" | "active" | "suspended" | "archived";
type AccountType = "admin" | "developer" | "normal_user";

interface UserRow {
  id?: string | null;
  clerkUserId: string;
  role: string;
  displayName?: string | null;
  email?: string | null;
  loginStatus?: string | null;
  loginStatusChangedAt?: string | null;
  lastLoginAt?: string | null;
  personMasterId?: string | null;
  personMasterName?: string | null;
  createdAt?: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<LoginStatus, { label: string; color: string; icon: React.ReactNode }> = {
  active: {
    label: "Active",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  pending_activation: {
    label: "Pending Activation",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <Clock className="w-3 h-3" />,
  },
  suspended: {
    label: "Suspended",
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <ShieldAlert className="w-3 h-3" />,
  },
  archived: {
    label: "Archived",
    color: "bg-gray-100 text-gray-600 border-gray-200",
    icon: <Archive className="w-3 h-3" />,
  },
};

const ACCOUNT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  admin: { label: "Admin", color: "bg-purple-100 text-purple-800" },
  developer: { label: "Developer", color: "bg-blue-100 text-blue-800" },
  landowner: { label: "Normal User", color: "bg-slate-100 text-slate-700" },
  investor: { label: "Normal User", color: "bg-slate-100 text-slate-700" },
  employee: { label: "Normal User", color: "bg-slate-100 text-slate-700" },
  operational_staff: { label: "Normal User", color: "bg-slate-100 text-slate-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as LoginStatus] ?? {
    label: status,
    color: "bg-gray-100 text-gray-600",
    icon: null,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function AccountTypeBadge({ role }: { role: string }) {
  const cfg = ACCOUNT_TYPE_CONFIG[role] ?? { label: role, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ── Action Confirmation Dialog ─────────────────────────────────────────────

function ActionDialog({
  open,
  onClose,
  title,
  description,
  actionLabel,
  actionVariant,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  actionLabel: string;
  actionVariant?: "default" | "destructive";
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Textarea
              placeholder="Enter reason for this action..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={actionVariant ?? "default"}
            onClick={() => onConfirm(reason)}
            disabled={isPending}
          >
            {isPending ? "Processing..." : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Audit History Dialog ───────────────────────────────────────────────────

const AUDIT_EVENT_LABELS: Record<string, string> = {
  created: "Account Created",
  activated: "Account Activated",
  suspended: "Account Suspended",
  restored: "Account Restored",
  archived: "Account Archived",
  account_type_changed: "Account Type Changed",
  person_linked: "Person Linked",
  person_unlinked: "Person Unlinked",
  login_recorded: "Login Recorded",
};

const AUDIT_EVENT_COLORS: Record<string, string> = {
  created: "bg-blue-100 text-blue-800",
  activated: "bg-emerald-100 text-emerald-800",
  suspended: "bg-red-100 text-red-800",
  restored: "bg-amber-100 text-amber-800",
  archived: "bg-gray-100 text-gray-600",
  account_type_changed: "bg-purple-100 text-purple-800",
  person_linked: "bg-teal-100 text-teal-800",
  person_unlinked: "bg-orange-100 text-orange-800",
  login_recorded: "bg-slate-100 text-slate-700",
};

function AuditHistoryDialog({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: UserRow | null;
}) {
  const { data: auditEvents, isLoading } = useGetUserLoginAudit(
    user?.clerkUserId ?? "",
    {},
    { query: { enabled: open && !!user, queryKey: getGetUserLoginAuditQueryKey(user?.clerkUserId ?? "", {}) } },
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">
            Login Audit — {user?.displayName ?? user?.email ?? "Unknown"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))
          ) : !auditEvents?.length ? (
            <div className="text-center py-6">
              <History className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No audit history yet.</p>
            </div>
          ) : (
            auditEvents.map((event) => (
              <div key={event.id} className="border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${AUDIT_EVENT_COLORS[event.eventType] ?? "bg-gray-100 text-gray-700"}`}>
                    {AUDIT_EVENT_LABELS[event.eventType] ?? event.eventType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(event.createdAt), "MMM d, yyyy · HH:mm")}
                  </span>
                </div>
                {event.performedByName && (
                  <p className="text-xs text-muted-foreground">
                    By: {event.performedByName}
                  </p>
                )}
                {event.reason && (
                  <p className="text-sm text-foreground/80">{event.reason}</p>
                )}
                {event.notes && (
                  <p className="text-xs text-muted-foreground italic">{event.notes}</p>
                )}
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pre-Provision Dialog ───────────────────────────────────────────────────

function PreProvisionDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedPerson, setSelectedPerson] = useState<PersonSummary | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("normal_user");
  const { toast } = useToast();
  const preProvision = usePreProvisionLogin();

  const handleSubmit = async () => {
    if (!selectedPerson) {
      toast({ title: "Select a person from the registry first.", variant: "destructive" });
      return;
    }
    if (!email) {
      toast({ title: "Email is required for Clerk sign-in matching.", variant: "destructive" });
      return;
    }
    try {
      await preProvision.mutateAsync({
        data: {
          personMasterId: selectedPerson.id,
          email,
          displayName: displayName || undefined,
          phone: phone || undefined,
          accountType,
        },
      });
      toast({ title: "Login account pre-provisioned.", description: `The account is pending activation. Activate it once the person signs up.` });
      onSuccess();
      onClose();
      setSelectedPerson(null);
      setEmail("");
      setDisplayName("");
      setPhone("");
      setAccountType("normal_user");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pre-provision failed";
      toast({ title: "Failed to create login", description: msg, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Pre-Provision Login Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            Select a person from the registry. The account will be created as
            <strong> Pending Activation</strong>. Activate it once the person
            completes sign-up on Clerk using the email address below.
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Person Registry Record <span className="text-red-500">*</span></label>
            <PersonMasterSelector
              selectedPerson={selectedPerson}
              onSelect={(p: PersonSummary | null) => {
                setSelectedPerson(p);
                if (p?.email && !email) setEmail(p.email);
                if (p?.fullName && !displayName) setDisplayName(p.fullName);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Email Address <span className="text-red-500">*</span>
              <span className="text-muted-foreground font-normal ml-1 text-xs">(used to match Clerk account on first sign-in)</span>
            </label>
            <Input
              type="email"
              placeholder="person@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Display Name</label>
              <Input
                placeholder="Full name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Phone</label>
              <Input
                placeholder="+91..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Account Type <span className="text-red-500">*</span></label>
            <Select value={accountType} onValueChange={(v) => setAccountType(v as AccountType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal_user">Normal User — operational access via assignments</SelectItem>
                <SelectItem value="developer">Developer — full access to all projects</SelectItem>
                <SelectItem value="admin">Admin — full system access including user management</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={preProvision.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={preProvision.isPending || !selectedPerson || !email}>
            {preProvision.isPending ? "Creating..." : "Create Login Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── User Row Component ─────────────────────────────────────────────────────

function LoginUserRow({
  user,
  onAction,
}: {
  user: UserRow;
  onAction: (action: "activate" | "suspend" | "restore" | "archive" | "audit", user: UserRow) => void;
}) {
  const loginStatus = (user.loginStatus ?? "pending_activation") as LoginStatus;
  const isArchived = loginStatus === "archived";
  const isSampleUser = user.clerkUserId.startsWith("user_sample_") || user.clerkUserId.startsWith("preprov_");

  return (
    <div className={`flex items-center gap-4 p-3 rounded-lg border mb-2 ${isArchived ? "opacity-60 bg-gray-50" : "bg-white"}`}>
      {/* Avatar / icon */}
      <div className="flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary/70" />
        </div>
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">
            {user.displayName ?? user.email ?? user.clerkUserId}
          </span>
          <AccountTypeBadge role={user.role} />
          <StatusBadge status={loginStatus} />
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
          {user.email && <span>{user.email}</span>}
          {user.personMasterName && (
            <span className="flex items-center gap-1">
              <Link className="w-3 h-3" />
              {user.personMasterName}
            </span>
          )}
          {user.lastLoginAt && (
            <span>Last login: {format(new Date(user.lastLoginAt), "MMM d, yyyy")}</span>
          )}
          {isSampleUser && (
            <span className="text-amber-600">Pre-provisioned (awaiting sign-up)</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 px-2"
          onClick={() => onAction("audit", user)}
        >
          <History className="w-3 h-3 mr-1" />
          History
        </Button>

        {!isArchived && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                Actions <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(loginStatus === "pending_activation" || loginStatus === "suspended") && (
                <DropdownMenuItem
                  className="text-emerald-700 focus:text-emerald-700 focus:bg-emerald-50"
                  onClick={() => onAction("activate", user)}
                >
                  <UserCheck className="w-3.5 h-3.5 mr-2" />
                  {loginStatus === "pending_activation" ? "Activate" : "Restore"}
                </DropdownMenuItem>
              )}
              {loginStatus === "active" && (
                <DropdownMenuItem
                  className="text-amber-700 focus:text-amber-700 focus:bg-amber-50"
                  onClick={() => onAction("suspend", user)}
                >
                  <UserX className="w-3.5 h-3.5 mr-2" />
                  Suspend
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-700 focus:text-red-700 focus:bg-red-50"
                onClick={() => onAction("archive", user)}
              >
                <Archive className="w-3.5 h-3.5 mr-2" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

type FilterStatus = "all" | LoginStatus;

export default function LoginAccessPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useListUsers();

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    action: "activate" | "suspend" | "restore" | "archive";
    user: UserRow;
  } | null>(null);
  const [auditUser, setAuditUser] = useState<UserRow | null>(null);
  const [showPreProvision, setShowPreProvision] = useState(false);

  const activate = useActivateUserLogin();
  const suspend = useSuspendUserLogin();
  const restore = useRestoreUserLogin();
  const archive = useArchiveUserLogin();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const handleAction = (
    action: "activate" | "suspend" | "restore" | "archive" | "audit",
    user: UserRow,
  ) => {
    if (action === "audit") {
      setAuditUser(user);
      return;
    }
    // For pending_activation → use "activate" action
    // For suspended → dropdown shows "Restore" but maps to same activate action
    const resolvedAction = action === "activate" && user.loginStatus === "suspended" ? "restore" : action;
    setPendingAction({ action: resolvedAction as typeof pendingAction extends null ? never : NonNullable<typeof pendingAction>["action"], user });
  };

  const handleConfirmAction = async (reason: string) => {
    if (!pendingAction) return;
    const { action, user } = pendingAction;
    const clerkUserId = user.clerkUserId;
    const payload = { clerkUserId, data: { reason: reason || undefined } };
    try {
      if (action === "activate") await activate.mutateAsync(payload);
      else if (action === "suspend") await suspend.mutateAsync(payload);
      else if (action === "restore") await restore.mutateAsync(payload);
      else if (action === "archive") await archive.mutateAsync(payload);

      const labels: Record<string, string> = {
        activate: "activated",
        suspend: "suspended",
        restore: "restored",
        archive: "archived",
      };
      toast({ title: `Account ${labels[action]}`, description: user.displayName ?? user.email ?? clerkUserId });
      invalidate();
      setPendingAction(null);
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    }
  };

  // ── Statistics ────────────────────────────────────────────────────────────
  const stats = {
    total: users?.length ?? 0,
    active: users?.filter((u) => u.loginStatus === "active").length ?? 0,
    pending: users?.filter((u) => u.loginStatus === "pending_activation").length ?? 0,
    suspended: users?.filter((u) => u.loginStatus === "suspended").length ?? 0,
    archived: users?.filter((u) => u.loginStatus === "archived").length ?? 0,
  };

  // ── Filtered & searched users ─────────────────────────────────────────────
  const filteredUsers = (users ?? []).filter((u) => {
    const status = u.loginStatus ?? "pending_activation";
    if (filterStatus !== "all" && status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        (u.displayName ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.personMasterName ?? "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // ── Dialog configs ────────────────────────────────────────────────────────
  const ACTION_CONFIG: Record<
    string,
    { title: string; description: string; label: string; variant?: "default" | "destructive" }
  > = {
    activate: {
      title: "Activate Login Account",
      description: `This will grant the account access to the system. The user will be able to sign in immediately.`,
      label: "Activate Account",
      variant: "default",
    },
    suspend: {
      title: "Suspend Login Account",
      description: `Access will be revoked immediately. Person records, ownership history, and all data are preserved. You can restore access at any time.`,
      label: "Suspend Account",
      variant: "destructive",
    },
    restore: {
      title: "Restore Login Account",
      description: `This will reinstate full system access for this account. All previous assignments and data are intact.`,
      label: "Restore Access",
      variant: "default",
    },
    archive: {
      title: "Archive Login Account",
      description: `Access will be permanently revoked. The account cannot be restored after archiving. All person records, history, and data are preserved.`,
      label: "Archive Account",
      variant: "destructive",
    },
  };

  const dialogCfg = pendingAction ? ACTION_CONFIG[pendingAction.action] : null;
  const isActionPending = activate.isPending || suspend.isPending || restore.isPending || archive.isPending;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Login Access Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage login accounts, lifecycle status, and person-registry links. Authentication is handled by Clerk.
          </p>
        </div>
        <Button onClick={() => setShowPreProvision(true)} className="gap-2">
          <UserPlus className="w-4 h-4" />
          Pre-Provision Login
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { key: "all", label: "Total", value: stats.total, color: "text-foreground" },
          { key: "active", label: "Active", value: stats.active, color: "text-emerald-600" },
          { key: "pending_activation", label: "Pending", value: stats.pending, color: "text-amber-600" },
          { key: "suspended", label: "Suspended", value: stats.suspended, color: "text-red-600" },
          { key: "archived", label: "Archived", value: stats.archived, color: "text-gray-500" },
        ].map(({ key, label, value, color }) => (
          <button
            key={key}
            onClick={() => setFilterStatus(key as FilterStatus)}
            className={`bg-white rounded-lg border p-3 text-center hover:border-primary/40 transition-colors ${filterStatus === key ? "border-primary ring-1 ring-primary/20" : ""}`}
          >
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Input
          placeholder="Search by name, email, or person..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
        <UserCog className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>

      {/* Users List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-serif flex items-center gap-2 text-base">
            <ShieldCheck className="w-4 h-4" />
            Login Accounts
            {filterStatus !== "all" && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                — filtered: {STATUS_CONFIG[filterStatus as LoginStatus]?.label ?? filterStatus}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : !filteredUsers.length ? (
            <div className="text-center py-10">
              <UserCog className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery || filterStatus !== "all"
                  ? "No accounts match the current filter."
                  : "No login accounts yet. Use Pre-Provision Login to create the first account."}
              </p>
              {(searchQuery || filterStatus !== "all") && (
                <Button
                  variant="link"
                  className="mt-2 text-xs"
                  onClick={() => { setSearchQuery(""); setFilterStatus("all"); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div>
              {filteredUsers.map((u) => (
                <LoginUserRow
                  key={u.clerkUserId}
                  user={u as UserRow}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Notes */}
      <Card className="border-slate-200 bg-slate-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            Security Architecture
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">Authentication</p>
              <p>Clerk manages all credentials and session tokens. No passwords are stored in this system.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">Login Status Gate</p>
              <p>Only <strong>Active</strong> accounts can access the system. Pending, Suspended, and Archived accounts receive 401 on all protected routes.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">Person Registry</p>
              <p>Every login should link to a Person Registry record. Orphan logins cannot access project data or financial records.</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground/80">Data Preservation</p>
              <p>Suspending or archiving a login never removes Person records, ownership history, assignments, or documents.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Confirmation Dialog */}
      {pendingAction && dialogCfg && (
        <ActionDialog
          open={!!pendingAction}
          onClose={() => setPendingAction(null)}
          title={dialogCfg.title}
          description={dialogCfg.description}
          actionLabel={dialogCfg.label}
          actionVariant={dialogCfg.variant}
          onConfirm={handleConfirmAction}
          isPending={isActionPending}
        />
      )}

      {/* Audit History Dialog */}
      <AuditHistoryDialog
        open={!!auditUser}
        onClose={() => setAuditUser(null)}
        user={auditUser}
      />

      {/* Pre-Provision Dialog */}
      <PreProvisionDialog
        open={showPreProvision}
        onClose={() => setShowPreProvision(false)}
        onSuccess={invalidate}
      />
    </div>
  );
}
