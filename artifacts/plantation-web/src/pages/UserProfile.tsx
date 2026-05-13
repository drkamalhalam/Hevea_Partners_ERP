import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetUserProfile,
  useUpdateUserProfile,
  useUpdateUserRole,
  useAssignUserToProject,
  useUpdateProjectAssignment,
  useRemoveUserFromProject,
  useGetUserActivity,
  useListProjects,
  getGetUserProfileQueryKey,
  getGetUserActivityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import type { UserRole } from "@/contexts/RoleContext";
import { useRole } from "@/contexts/RoleContext";
import { format } from "date-fns";
import {
  User,
  MapPin,
  Phone,
  Mail,
  FolderKanban,
  Activity,
  FileText,
  Edit,
  Save,
  X,
  ShieldCheck,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Plus,
  ArrowLeft,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

const profileFormSchema = z.object({
  displayName: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const ROLE_OPTIONS: UserRole[] = [
  "admin",
  "developer",
  "landowner",
  "investor",
  "employee",
  "operational_staff",
];

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  maturing: "bg-emerald-100 text-emerald-800",
  tapping: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
  suspended: "bg-red-100 text-red-800",
};

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
          {label}
        </p>
        <p className="text-sm text-foreground mt-0.5 break-words">
          {value ?? "—"}
        </p>
      </div>
    </div>
  );
}

export default function UserProfile() {
  const { clerkUserId } = useParams<{ clerkUserId: string }>();
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  const queryKey = getGetUserProfileQueryKey(clerkUserId ?? "");

  const { data: profile, isLoading } = useGetUserProfile(clerkUserId ?? "", {
    query: {
      queryKey: getGetUserProfileQueryKey(clerkUserId ?? ""),
      enabled: !!clerkUserId,
    },
  });

  const { data: projects = [] } = useListProjects();

  const { data: activities = [], isLoading: isLoadingActivity } =
    useGetUserActivity(clerkUserId ?? "", undefined, {
      query: {
        queryKey: getGetUserActivityQueryKey(clerkUserId ?? ""),
        enabled: !!clerkUserId,
      },
    });

  const updateProfile = useUpdateUserProfile();
  const updateRole = useUpdateUserRole();
  const assignProject = useAssignUserToProject();
  const updateAssignment = useUpdateProjectAssignment();
  const removeProject = useRemoveUserFromProject();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    values: {
      displayName: profile?.displayName ?? "",
      phone: profile?.phone ?? "",
      address: profile?.address ?? "",
    },
  });

  const onSubmit = async (values: ProfileFormValues) => {
    if (!clerkUserId) return;
    try {
      await updateProfile.mutateAsync({
        clerkUserId,
        data: {
          displayName: values.displayName,
          phone: values.phone || undefined,
          address: values.address || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Profile updated" });
      setIsEditing(false);
    } catch {
      toast({ title: "Failed to update profile", variant: "destructive" });
    }
  };

  const handleRoleChange = async (newRole: string) => {
    if (!clerkUserId) return;
    setSavingRole(true);
    try {
      await updateRole.mutateAsync({
        clerkUserId,
        data: { role: newRole as UserRole },
      });
      await queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Role updated",
        description: `${profile?.displayName ?? clerkUserId} → ${ROLE_LABELS[newRole as UserRole]}`,
      });
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
    } finally {
      setSavingRole(false);
    }
  };

  const handleAssignProject = async (
    projectId: string,
    projectRole?: UserRole,
  ) => {
    if (!clerkUserId) return;
    try {
      await assignProject.mutateAsync({
        clerkUserId,
        data: { projectId, projectRole },
      });
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Project assigned" });
    } catch {
      toast({ title: "Failed to assign project", variant: "destructive" });
    }
  };

  const handleUpdateProjectRole = async (
    projectId: string,
    projectRole: UserRole,
  ) => {
    if (!clerkUserId) return;
    try {
      await updateAssignment.mutateAsync({
        clerkUserId,
        projectId,
        data: { projectRole },
      });
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Project role updated" });
    } catch {
      toast({ title: "Failed to update project role", variant: "destructive" });
    }
  };

  const handleRemoveProject = async (projectId: string) => {
    if (!clerkUserId) return;
    try {
      await removeProject.mutateAsync({ clerkUserId, projectId });
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Project removed" });
    } catch {
      toast({ title: "Failed to remove project", variant: "destructive" });
    }
  };

  if (!clerkUserId) return null;

  const role = (profile?.role ?? "employee") as UserRole;
  const initials =
    profile?.displayName
      ?.split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  const assignedProjectIds = (profile?.projectAssignments ?? []).map(
    (a) => a.projectId,
  );
  const unassignedProjects = projects.filter(
    (p) => !assignedProjectIds.includes(p.id),
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
      {/* Back nav */}
      <Link href="/admin">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Admin
        </button>
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3">
        <User className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            User Profile
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage this user's account, roles, and project assignments
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <>
          {/* Profile hero card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <Avatar className="w-20 h-20">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xl">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">
                    Photo placeholder
                  </p>
                </div>

                {/* Identity block */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h2 className="text-xl font-semibold text-foreground">
                      {profile?.displayName ?? "(No name)"}
                    </h2>
                    {profile?.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-medium">
                        <XCircle className="w-3 h-3" /> Inactive
                      </span>
                    )}
                    {clerkUserId.startsWith("user_sample_") && (
                      <Badge variant="secondary" className="text-xs">
                        Sample
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {profile?.email ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    Member since{" "}
                    {profile?.createdAt
                      ? format(new Date(profile.createdAt), "MMMM yyyy")
                      : "—"}
                  </p>
                </div>

                {/* Role selector (admin only) + edit */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={role}
                        onValueChange={handleRoleChange}
                        disabled={savingRole}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r} className="text-xs">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[r]}`}
                              >
                                {ROLE_LABELS[r]}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {savingRole && (
                        <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  )}
                  {!isAdmin && (
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role]}`}
                    >
                      {ROLE_LABELS[role]}
                    </span>
                  )}
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(!isEditing)}
                      className="gap-1.5 text-xs"
                    >
                      {isEditing ? (
                        <>
                          <X className="w-3.5 h-3.5" /> Cancel
                        </>
                      ) : (
                        <>
                          <Edit className="w-3.5 h-3.5" /> Edit Profile
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile" className="gap-1.5">
                <User className="w-3.5 h-3.5" /> Profile
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-1.5">
                <FolderKanban className="w-3.5 h-3.5" /> Projects
                {assignedProjectIds.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 text-[10px]"
                  >
                    {assignedProjectIds.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Activity
              </TabsTrigger>
            </TabsList>

            {/* ── Profile Tab ── */}
            <TabsContent value="profile" className="mt-4">
              {isEditing && isAdmin ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-serif text-base">
                      Edit Profile
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                      >
                        <FormField
                          control={form.control}
                          name="displayName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full Name</FormLabel>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Mobile Number</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="+91 98765 43210"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Email</label>
                            <Input
                              value={profile?.email ?? ""}
                              disabled
                              className="bg-muted"
                            />
                          </div>
                        </div>
                        <FormField
                          control={form.control}
                          name="address"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Address</FormLabel>
                              <FormControl>
                                <Textarea rows={3} {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex justify-end gap-2 pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={updateProfile.isPending}
                            className="gap-1.5"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {updateProfile.isPending ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                        Contact Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <InfoRow
                        icon={User}
                        label="Full Name"
                        value={profile?.displayName}
                      />
                      <InfoRow
                        icon={Mail}
                        label="Email Address"
                        value={profile?.email}
                      />
                      <InfoRow
                        icon={Phone}
                        label="Mobile Number"
                        value={profile?.phone}
                      />
                      <InfoRow
                        icon={MapPin}
                        label="Address"
                        value={profile?.address}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                        Account Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <InfoRow
                        icon={ShieldCheck}
                        label="System Role"
                        value={ROLE_LABELS[role]}
                      />
                      <InfoRow
                        icon={CalendarDays}
                        label="Member Since"
                        value={
                          profile?.createdAt
                            ? format(
                                new Date(profile.createdAt),
                                "dd MMMM yyyy",
                              )
                            : undefined
                        }
                      />
                      <div className="pt-3 pb-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">
                          Identity Document
                        </p>
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20">
                          <FileText className="w-5 h-5 text-muted-foreground/40" />
                          <span className="text-xs text-muted-foreground">
                            Not uploaded — coming soon
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            {/* ── Projects Tab ── */}
            <TabsContent value="projects" className="mt-4 space-y-4">
              {/* Assign new project (admin only) */}
              {isAdmin && unassignedProjects.length > 0 && (
                <Card className="border-dashed">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <p className="text-sm text-muted-foreground">
                        Assign this user to a project with an optional
                        project-specific role
                      </p>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" /> Assign Project
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="end">
                          <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
                            Choose project
                          </p>
                          {unassignedProjects.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent group"
                            >
                              <span className="text-xs flex-1 truncate">
                                {p.name}
                              </span>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-xs text-primary gap-0.5 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    Assign <ChevronDown className="w-3 h-3" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-44 p-1"
                                  align="end"
                                >
                                  <p className="text-xs text-muted-foreground px-2 py-1">
                                    Role in this project
                                  </p>
                                  <button
                                    className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent rounded text-muted-foreground italic"
                                    onClick={() =>
                                      handleAssignProject(p.id, undefined)
                                    }
                                  >
                                    No specific role
                                  </button>
                                  {ROLE_OPTIONS.filter((r) =>
                                    [
                                      "landowner",
                                      "investor",
                                      "employee",
                                      "operational_staff",
                                      "developer",
                                    ].includes(r),
                                  ).map((r) => (
                                    <button
                                      key={r}
                                      className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent rounded"
                                      onClick={() =>
                                        handleAssignProject(p.id, r)
                                      }
                                    >
                                      {ROLE_LABELS[r]}
                                    </button>
                                  ))}
                                </PopoverContent>
                              </Popover>
                            </div>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Assigned projects list */}
              {!profile?.projectAssignments?.length ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <FolderKanban className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No project assignments yet.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {profile.projectAssignments.map((assignment) => {
                    const project = projects.find(
                      (p) => p.id === assignment.projectId,
                    );
                    const projectRole = assignment.projectRole as UserRole | null;
                    return (
                      <Card key={assignment.assignmentId} className="relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/30 rounded-l" />
                        <CardContent className="pt-4 pl-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">
                                {project?.name ?? assignment.projectId}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {project?.location ?? ""}
                                {project?.district ? `, ${project.district}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1 items-end flex-shrink-0">
                              {project?.status && (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[project.status] ?? ""}`}
                                >
                                  {project.status}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Project role section */}
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                Role:
                              </span>
                              {projectRole ? (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[projectRole]}`}
                                >
                                  {ROLE_LABELS[projectRole]}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">
                                  Unspecified
                                </span>
                              )}
                            </div>
                            {isAdmin && (
                              <div className="flex items-center gap-1">
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-xs text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5 hover:bg-accent transition-colors">
                                      Change
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="w-40 p-1"
                                    align="end"
                                  >
                                    {ROLE_OPTIONS.filter((r) =>
                                      [
                                        "landowner",
                                        "investor",
                                        "employee",
                                        "operational_staff",
                                        "developer",
                                      ].includes(r),
                                    ).map((r) => (
                                      <button
                                        key={r}
                                        className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent rounded"
                                        onClick={() =>
                                          handleUpdateProjectRole(
                                            assignment.projectId,
                                            r,
                                          )
                                        }
                                      >
                                        {ROLE_LABELS[r]}
                                      </button>
                                    ))}
                                  </PopoverContent>
                                </Popover>
                                <button
                                  onClick={() =>
                                    handleRemoveProject(assignment.projectId)
                                  }
                                  className="text-muted-foreground hover:text-red-500 transition-colors p-0.5 rounded hover:bg-red-50"
                                  title="Remove from project"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Access note for non-restricted roles */}
              {!["admin", "developer"].includes(role) ? null : (
                <p className="text-xs text-muted-foreground text-center py-2">
                  <ShieldCheck className="w-3 h-3 inline mr-1" />
                  This user has full access to all projects based on their role
                  — individual project assignments do not restrict them.
                </p>
              )}
            </TabsContent>

            {/* ── Activity Tab ── */}
            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="font-serif text-base">
                    Activity Log
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoadingActivity ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 rounded-lg" />
                      ))}
                    </div>
                  ) : !activities.length ? (
                    <div className="text-center py-8">
                      <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No activity recorded for this user.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {activities.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-3 py-2.5 border-b last:border-0"
                        >
                          <div className="w-2 h-2 rounded-full bg-primary/60 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground">
                              {a.description}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {format(new Date(a.createdAt), "MMM d, yyyy")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
