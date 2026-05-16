import { useState } from "react";
import { useAuthFetch } from "../lib/authFetch";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useListProjects,
  useListPartners,
  useListAgreements,
  useGetRecentActivity,
  useListUsers,
  useUpdateUserRole,
  useAssignUserToProject,
  useRemoveUserFromProject,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Trees,
  Users,
  FileText,
  Map,
  ExternalLink,
  ShieldCheck,
  UserCog,
  Plus,
  X,
  Terminal,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { ROLE_LABELS, ROLE_COLORS, UserRole } from "@/contexts/RoleContext";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  maturing: "bg-emerald-100 text-emerald-800",
  tapping: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
};

const ROLE_OPTIONS: UserRole[] = [
  "admin",
  "developer",
  "landowner",
  "investor",
  "employee",
  "operational_staff",
];

function UserRow({
  user,
  projects,
}: {
  user: {
    clerkUserId: string;
    role: string;
    displayName?: string | null;
    email?: string | null;
    assignedProjectIds: string[];
    createdAt?: string;
  };
  projects: Array<{ id: string; name: string }>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [savingRole, setSavingRole] = useState(false);
  const updateRole = useUpdateUserRole();
  const assignProject = useAssignUserToProject();
  const removeProject = useRemoveUserFromProject();
  const isSampleUser = user.clerkUserId.startsWith("user_sample_");

  const handleRoleChange = async (newRole: string) => {
    setSavingRole(true);
    try {
      await updateRole.mutateAsync({
        clerkUserId: user.clerkUserId,
        data: { role: newRole as UserRole },
      });
      await queryClient.invalidateQueries({ queryKey: ["listUsers"] });
      toast({ title: "Role updated", description: `${user.displayName ?? user.clerkUserId} → ${ROLE_LABELS[newRole as UserRole]}` });
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
    } finally {
      setSavingRole(false);
    }
  };

  const handleAssignProject = async (projectId: string) => {
    try {
      await assignProject.mutateAsync({
        clerkUserId: user.clerkUserId,
        data: { projectId },
      });
      await queryClient.invalidateQueries({ queryKey: ["listUsers"] });
    } catch {
      toast({ title: "Failed to assign project", variant: "destructive" });
    }
  };

  const handleRemoveProject = async (projectId: string) => {
    try {
      await removeProject.mutateAsync({ clerkUserId: user.clerkUserId, projectId });
      await queryClient.invalidateQueries({ queryKey: ["listUsers"] });
    } catch {
      toast({ title: "Failed to remove project", variant: "destructive" });
    }
  };

  const unassignedProjects = projects.filter(
    (p) => !user.assignedProjectIds.includes(p.id),
  );
  const assignedProjects = projects.filter((p) =>
    user.assignedProjectIds.includes(p.id),
  );
  const needsProjectAssignment =
    !["admin", "developer"].includes(user.role);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b last:border-0">
      {/* Avatar + Identity */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
          {user.displayName?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground truncate">
              {user.displayName ?? "(No name)"}
              {isSampleUser && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">[sample]</span>
              )}
            </p>
            <Link href={`/users/${user.clerkUserId}`}>
              <span className="text-xs text-primary hover:underline whitespace-nowrap">View Profile</span>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground truncate">{user.email ?? user.clerkUserId}</p>
        </div>
      </div>

      {/* Role selector */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Select
          value={user.role}
          onValueChange={handleRoleChange}
          disabled={savingRole}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[r]}`}>
                  {ROLE_LABELS[r]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {savingRole && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Project assignments */}
      {needsProjectAssignment && (
        <div className="flex items-center gap-1 flex-wrap min-w-0 max-w-xs">
          {assignedProjects.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full"
            >
              {p.name.split(" ").slice(0, 2).join(" ")}
              <button
                onClick={() => handleRemoveProject(p.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {unassignedProjects.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-0.5 text-xs text-primary hover:text-primary/80 border border-dashed border-primary/40 px-1.5 py-0.5 rounded-full transition-colors">
                  <Plus className="w-2.5 h-2.5" /> Assign
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                <p className="text-xs text-muted-foreground px-2 py-1">Assign project</p>
                {unassignedProjects.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent rounded transition-colors"
                    onClick={() => handleAssignProject(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {assignedProjects.length === 0 && unassignedProjects.length === 0 && (
            <span className="text-xs text-muted-foreground">No projects</span>
          )}
        </div>
      )}
      {!needsProjectAssignment && (
        <span className="text-xs text-muted-foreground italic">All projects</span>
      )}
    </div>
  );
}

export default function Admin() {
  const authFetch = useAuthFetch();
  const { toast } = useToast();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: projects = [] } = useListProjects();
  const { data: partners } = useListPartners();
  const { data: agreements } = useListAgreements();
  const { data: activities } = useGetRecentActivity();
  const { data: users, isLoading: isLoadingUsers } = useListUsers();
  const isDev = import.meta.env.DEV;

  const roleCounts = users
    ? ROLE_OPTIONS.reduce(
        (acc, r) => ({ ...acc, [r]: users.filter((u) => u.role === r).length }),
        {} as Record<UserRole, number>,
      )
    : null;

  const handlePromoteToAdmin = async () => {
    try {
      const res = await authFetch("/api/dev/promote-admin", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Promoted to Admin", description: data.message });
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast({ title: "Failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Request failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Admin Console</h1>
          <p className="text-muted-foreground mt-1">System management and user role administration</p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-2">
          <TabsTrigger value="overview" className="gap-1.5">
            <Trees className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5">
            <UserCog className="w-3.5 h-3.5" /> User Management
            {users && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{users.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="space-y-6 mt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {isLoadingSummary
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))
              : summary && (
                  <>
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                        <Trees className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{summary.totalProjects}</div>
                        <p className="text-xs text-muted-foreground mt-1">{summary.tappingProjectsCount} tapping</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Partners</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{summary.totalPartners}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Agreements</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{summary.totalAgreements}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Land</CardTitle>
                        <Map className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{summary.totalLandArea.toFixed(1)}</div>
                        <p className="text-xs text-muted-foreground">kani</p>
                      </CardContent>
                    </Card>
                  </>
                )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-serif">All Projects</CardTitle>
                <Link href="/projects">
                  <Button variant="outline" size="sm" className="gap-1">
                    <ExternalLink className="w-3 h-3" /> Manage
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {!projects?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No projects yet.</p>
                ) : (
                  <div className="space-y-2">
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[p.status] ?? ""}`}
                        >
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-serif">All Partners</CardTitle>
                <Link href="/partners">
                  <Button variant="outline" size="sm" className="gap-1">
                    <ExternalLink className="w-3 h-3" /> Manage
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {!partners?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No partners yet.</p>
                ) : (
                  <div className="space-y-2">
                    {partners.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {p.role.replace("_", " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-serif">All Agreements</CardTitle>
              <Link href="/agreements">
                <Button variant="outline" size="sm" className="gap-1">
                  <ExternalLink className="w-3 h-3" /> Manage
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {!agreements?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No agreements yet.</p>
              ) : (
                <div className="space-y-2">
                  {agreements.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between text-sm py-2 border-b last:border-0"
                    >
                      <div>
                        <p className="font-medium">{a.projectName}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.landOwnerName} · {a.landArea} {a.landAreaUnit}
                        </p>
                      </div>
                      <Link href={`/agreements/${a.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {activities && activities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-serif">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {activities.slice(0, 8).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0"
                    >
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                      <span className="flex-1">{a.description}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(a.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── User Management Tab ── */}
        <TabsContent value="users" className="space-y-6 mt-0">
          {/* Role breakdown */}
          {roleCounts && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {ROLE_OPTIONS.map((r) => (
                <div
                  key={r}
                  className="bg-white rounded-lg border p-3 text-center"
                >
                  <p className="text-xl font-bold text-foreground">{roleCounts[r]}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                    {ROLE_LABELS[r]}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Users table */}
          <Card>
            <CardHeader>
              <CardTitle className="font-serif flex items-center gap-2">
                <UserCog className="w-4 h-4" /> Platform Users
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Change roles or assign/remove project access below. Changes take effect immediately.
              </p>
            </CardHeader>
            <CardContent>
              {isLoadingUsers ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 rounded-lg" />
                  ))}
                </div>
              ) : !users?.length ? (
                <div className="text-center py-8">
                  <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No users yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Users appear here after they sign in for the first time.
                  </p>
                </div>
              ) : (
                <div>
                  {users.map((u) => (
                    <UserRow key={u.clerkUserId} user={u} projects={projects} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Access rules reference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Access Rules Reference
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                {[
                  { role: "admin", rules: "Full access to all modules and all projects. Only role that can manage other users." },
                  { role: "developer", rules: "Full access to all projects. Can create/edit projects, partners, and agreements." },
                  { role: "landowner", rules: "Read/write access to assigned projects only. Cannot create new projects." },
                  { role: "investor", rules: "Read access to assigned projects only. Cannot create or edit records." },
                  { role: "employee", rules: "Read access + can log production records for assigned projects." },
                  { role: "operational_staff", rules: "Read access to assigned projects only." },
                ].map(({ role, rules }) => (
                  <div key={role} className="flex gap-2 p-2 rounded-lg bg-muted/40">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium self-start flex-shrink-0 ${ROLE_COLORS[role as UserRole]}`}>
                      {ROLE_LABELS[role as UserRole]}
                    </span>
                    <p className="text-muted-foreground leading-relaxed">{rules}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Dev Tools */}
          {isDev && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-800">
                  <Terminal className="w-4 h-4" />
                  Developer Tools
                  <Badge variant="outline" className="text-amber-700 border-amber-300 text-xs">Dev only</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-amber-700">
                  These tools are only available in development mode and are disabled in production.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-800 hover:bg-amber-100 text-xs"
                    onClick={handlePromoteToAdmin}
                  >
                    <ShieldCheck className="w-3 h-3 mr-1.5" />
                    Promote me to Admin
                  </Button>
                  <p className="text-xs text-amber-600">
                    Sets your Clerk account to the admin role instantly.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
