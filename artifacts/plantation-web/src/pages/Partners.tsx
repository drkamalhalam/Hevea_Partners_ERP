import { useState } from "react";
import { Link } from "wouter";
import {
  useListUsers,
  useLinkUserToPerson,
  useAutoLinkUserToPerson,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Users,
  ShieldCheck,
  ShieldAlert,
  Link2,
  Link2Off,
  ExternalLink,
  Wand2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  Phone,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole, ROLE_LABELS } from "@/contexts/RoleContext";
import { PersonMasterSelector, type PersonSummary } from "@/components/PersonMasterSelector";

// ── Role badge colours (mirrors sidebar conventions) ─────────────────────────
const ROLE_CHIP: Record<string, string> = {
  admin: "bg-red-100 text-red-800 border-red-200",
  developer: "bg-purple-100 text-purple-800 border-purple-200",
  landowner: "bg-emerald-100 text-emerald-800 border-emerald-200",
  investor: "bg-blue-100 text-blue-800 border-blue-200",
  employee: "bg-amber-100 text-amber-800 border-amber-200",
  operational_staff: "bg-gray-100 text-gray-700 border-gray-200",
};

// ── KYC badge ────────────────────────────────────────────────────────────────
function KycBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    verified: {
      label: "KYC Verified",
      cls: "bg-green-100 text-green-700 border-green-200",
      icon: <ShieldCheck className="h-3 w-3" />,
    },
    documents_submitted: {
      label: "Docs Submitted",
      cls: "bg-blue-100 text-blue-700 border-blue-200",
      icon: <Clock className="h-3 w-3" />,
    },
    pending: {
      label: "KYC Pending",
      cls: "bg-amber-100 text-amber-700 border-amber-200",
      icon: <Clock className="h-3 w-3" />,
    },
    flagged: {
      label: "KYC Flagged",
      cls: "bg-red-100 text-red-700 border-red-200",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
  };
  const cfg = map[status];
  if (!cfg) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Avatar initials ───────────────────────────────────────────────────────────
function Avatar({ name, role }: { name: string | null; role: string }) {
  const initials = name
    ? name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("")
    : "?";
  const bg = ROLE_CHIP[role]?.split(" ")[0] ?? "bg-gray-100";
  return (
    <div
      className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${bg}`}
    >
      {initials}
    </div>
  );
}

// ── Action: auto-link button ─────────────────────────────────────────────────
function AutoLinkButton({
  clerkUserId,
  onDone,
}: {
  clerkUserId: string;
  onDone: () => void;
}) {
  const autoLink = useAutoLinkUserToPerson();
  const { toast } = useToast();

  const run = () => {
    autoLink.mutate(
      { clerkUserId },
      {
        onSuccess: (data) => {
          const msgs: Record<string, string> = {
            already_linked: "Already linked to registry.",
            linked_by_email: "Linked to existing registry entry by email.",
            linked_by_phone: "Linked to existing registry entry by phone.",
            created: "New registry entry created and linked.",
          };
          toast({ title: msgs[data.action] ?? "Linked to registry" });
          onDone();
        },
        onError: () =>
          toast({ title: "Auto-link failed", variant: "destructive" }),
      },
    );
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5 text-xs"
      onClick={run}
      disabled={autoLink.isPending}
    >
      {autoLink.isPending ? (
        <RefreshCw className="h-3 w-3 animate-spin" />
      ) : (
        <Wand2 className="h-3 w-3" />
      )}
      Auto-Link
    </Button>
  );
}

// ── Action: link-to-existing dialog ─────────────────────────────────────────
function LinkToExistingDialog({
  clerkUserId,
  onDone,
}: {
  clerkUserId: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PersonSummary | null>(null);
  const linkPerson = useLinkUserToPerson();
  const { toast } = useToast();

  const confirm = () => {
    if (!selected) return;
    linkPerson.mutate(
      { clerkUserId, data: { personMasterId: selected.id } },
      {
        onSuccess: () => {
          toast({ title: `Linked to ${selected.fullName}` });
          setOpen(false);
          setSelected(null);
          onDone();
        },
        onError: () =>
          toast({ title: "Link failed", variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-3 w-3" />
        Link to Existing
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link to Person Registry</DialogTitle>
            <DialogDescription className="sr-only">
              Search the person registry and select the matching identity for this user account.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Search the Person Registry and select the identity that matches this login account.
            The link is stored on the registry record — no duplicate identity will be created.
          </p>

          <PersonMasterSelector
            label="Search Registry"
            selectedPerson={selected}
            onSelect={setSelected}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={!selected || linkPerson.isPending}>
              {linkPerson.isPending ? "Linking…" : "Confirm Link"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── User card ─────────────────────────────────────────────────────────────────
type UserProfile = {
  clerkUserId: string;
  role: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  isActive: boolean;
  personMasterId?: string | null;
  personMasterName?: string | null;
  personMasterKycStatus?: string | null;
  assignedProjectIds: string[];
  createdAt: string;
};

function UserCard({
  user,
  isAdmin,
  onRefresh,
}: {
  user: UserProfile;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const linked = !!user.personMasterId;
  const displayName = user.personMasterName ?? user.displayName ?? user.email ?? "—";

  return (
    <Card className={`transition-shadow hover:shadow-md ${!user.isActive ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start gap-3">
          <Avatar name={displayName} role={user.role} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight truncate">
              {displayName}
            </p>
            {user.personMasterName && user.displayName && user.displayName !== user.personMasterName && (
              <p className="text-xs text-muted-foreground truncate">Login: {user.displayName}</p>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ROLE_CHIP[user.role] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
              >
                {ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role}
              </span>
              {!user.isActive && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-gray-100 text-gray-500 border-gray-200">
                  Inactive
                </span>
              )}
            </div>
          </div>

          {/* Registry link indicator */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`shrink-0 ${linked ? "text-green-600" : "text-amber-500"}`}>
                  {linked ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Link2Off className="h-4 w-4" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {linked
                  ? `Registry linked: ${user.personMasterName}`
                  : "Not linked to Person Registry"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Contact */}
        <div className="space-y-0.5">
          {user.email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
          )}
          {user.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              <span>{user.phone}</span>
            </div>
          )}
        </div>

        {/* Registry status */}
        {linked ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-green-100 text-green-700 border-green-200 inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Registry Linked
              </span>
              <KycBadge status={user.personMasterKycStatus} />
            </div>
            <p className="text-xs text-muted-foreground">
              {user.assignedProjectIds.length} project
              {user.assignedProjectIds.length !== 1 ? "s" : ""} assigned
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-amber-100 text-amber-700 border-amber-200 inline-flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> Not in Registry
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {linked && (
            <Link href={`/person-registry/${user.personMasterId}`}>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                <ExternalLink className="h-3 w-3" />
                View Registry Profile
              </Button>
            </Link>
          )}
          {!linked && isAdmin && (
            <>
              <AutoLinkButton clerkUserId={user.clerkUserId} onDone={onRefresh} />
              <LinkToExistingDialog clerkUserId={user.clerkUserId} onDone={onRefresh} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Partners() {
  const { data: users, isLoading, refetch } = useListUsers();
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const autoLinkAll = useAutoLinkUserToPerson();
  const { toast } = useToast();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
  };

  const linked = (users ?? []).filter((u) => u.personMasterId);
  const unlinked = (users ?? []).filter((u) => !u.personMasterId);

  const handleBulkAutoLink = async () => {
    if (!unlinked.length) {
      toast({ title: "All accounts are already linked to the registry." });
      return;
    }
    let done = 0;
    let created = 0;
    for (const u of unlinked) {
      try {
        const result = await new Promise<{ action: string }>((resolve, reject) => {
          autoLinkAll.mutate(
            { clerkUserId: u.clerkUserId },
            { onSuccess: resolve, onError: reject },
          );
        });
        if (result.action === "created") created++;
        done++;
      } catch {
        // continue with next user
      }
    }
    toast({
      title: `Auto-link complete — ${done} processed, ${created} new registry entries created`,
    });
    handleRefresh();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Partners</h1>
          <p className="text-muted-foreground mt-1">
            Login accounts and their Person Registry identity linkage
          </p>
        </div>

        {isAdmin && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleBulkAutoLink}
            disabled={autoLinkAll.isPending || isLoading}
          >
            <Wand2 className="h-4 w-4" />
            Auto-Link All Unlinked
          </Button>
        )}
      </div>

      {/* ── Stats bar ── */}
      {!isLoading && (users ?? []).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-3 text-center">
            <p className="text-2xl font-bold">{(users ?? []).length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total Accounts</p>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{linked.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Registry Linked</p>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{unlinked.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Not in Registry</p>
          </div>
        </div>
      )}

      {/* ── Architecture note ── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Identity Architecture
        </p>
        <p>
          Every login account must be linked to a <strong>Person Registry</strong> entry — the
          canonical governance identity for agreements, KYC, and project linkage. Login accounts
          without a registry entry cannot participate in project workflows.
        </p>
        {unlinked.length > 0 && isAdmin && (
          <p className="font-medium text-blue-900">
            {unlinked.length} account{unlinked.length !== 1 ? "s are" : " is"} not yet linked.
            Use <strong>Auto-Link All Unlinked</strong> to resolve this automatically.
          </p>
        )}
      </div>

      {/* ── Grid ── */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : !(users ?? []).length ? (
        <Card className="py-16 text-center">
          <Users className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No login accounts found.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(users ?? []).map((u) => (
            <UserCard
              key={u.clerkUserId}
              user={u as UserProfile}
              isAdmin={isAdmin}
              onRefresh={handleRefresh}
            />
          ))}
        </div>
      )}

      {/* ── Footer note ── */}
      <p className="text-xs text-muted-foreground text-center pb-4">
        To register a new person in the identity registry, use the{" "}
        <Link href="/person-registry" className="underline underline-offset-2 hover:text-foreground">
          Person Registry
        </Link>{" "}
        module. Login accounts are provisioned through the authentication system.
      </p>
    </div>
  );
}
