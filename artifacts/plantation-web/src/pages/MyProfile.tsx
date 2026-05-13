import { useState } from "react";
import { useUser } from "@clerk/react";
import {
  useGetMe,
  useUpdateMyProfile,
  useGetUserActivity,
  useListProjects,
  getGetMeQueryKey,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import type { UserRole } from "@/contexts/RoleContext";
import { format } from "date-fns";
import { Link } from "wouter";
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
  AlertTriangle,
} from "lucide-react";

const profileFormSchema = z.object({
  displayName: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

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
  empty = "—",
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
  empty?: string;
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
          {value ?? empty}
        </p>
      </div>
    </div>
  );
}

export default function MyProfile() {
  const { user: clerkUser } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const { data: profile, isLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });

  const { data: projects = [] } = useListProjects();

  const { data: activities = [], isLoading: isLoadingActivity } =
    useGetUserActivity(clerkUser?.id ?? "", undefined, {
      query: {
        queryKey: getGetUserActivityQueryKey(clerkUser?.id ?? ""),
        enabled: !!clerkUser?.id,
      },
    });

  const updateProfile = useUpdateMyProfile();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    values: {
      displayName: profile?.displayName ?? clerkUser?.fullName ?? "",
      phone: profile?.phone ?? "",
      address: profile?.address ?? "",
    },
  });

  const onSubmit = async (values: ProfileFormValues) => {
    try {
      await updateProfile.mutateAsync({
        data: {
          displayName: values.displayName,
          phone: values.phone || undefined,
          address: values.address || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Profile updated successfully" });
      setIsEditing(false);
    } catch {
      toast({ title: "Failed to update profile", variant: "destructive" });
    }
  };

  const initials =
    profile?.displayName
      ?.split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  const role = (profile?.role ?? "employee") as UserRole;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <User className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            My Profile
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your personal information and view your project assignments
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
          {/* Profile completeness banner — shown to developers missing nominees */}
          {(profile?.missingNomineeProjectIds?.length ?? 0) > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  Profile Incomplete
                </p>
                <p className="text-sm text-amber-800 mt-0.5">
                  You need to register a governance continuity nominee for{" "}
                  {profile!.missingNomineeProjectIds!.length === 1
                    ? "1 project"
                    : `${profile!.missingNomineeProjectIds!.length} projects`}
                  . Open the project to add a nominee.
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {profile!.missingNomineeProjectIds!.map((pid) => {
                    const proj = projects.find((p) => p.id === pid);
                    return (
                      <Link key={pid} href={`/projects/${pid}`}>
                        <span className="inline-flex items-center text-xs bg-amber-100 border border-amber-300 text-amber-800 px-2 py-0.5 rounded-full hover:bg-amber-200 transition-colors cursor-pointer">
                          {proj?.name ?? pid}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Profile hero card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <Avatar className="w-20 h-20 text-2xl">
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
                      {profile?.displayName ?? "(No name set)"}
                    </h2>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role]}`}
                    >
                      {ROLE_LABELS[role]}
                    </span>
                    {profile?.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-medium">
                        <XCircle className="w-3 h-3" /> Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {profile?.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    Member since{" "}
                    {profile?.createdAt
                      ? format(new Date(profile.createdAt), "MMMM yyyy")
                      : "—"}
                  </p>
                </div>

                {/* Edit button */}
                <div className="flex-shrink-0">
                  {!isEditing ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(true)}
                      className="gap-1.5"
                    >
                      <Edit className="w-3.5 h-3.5" /> Edit Profile
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsEditing(false);
                        form.reset();
                      }}
                      className="gap-1.5 text-muted-foreground"
                    >
                      <X className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info" className="gap-1.5">
                <User className="w-3.5 h-3.5" /> Profile Info
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-1.5">
                <FolderKanban className="w-3.5 h-3.5" /> Project Assignments
                {profile?.projectAssignments?.length ? (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {profile.projectAssignments.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Activity
              </TabsTrigger>
            </TabsList>

            {/* ── Info Tab ── */}
            <TabsContent value="info" className="mt-4">
              {isEditing ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-serif text-base">
                      Edit Profile Information
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
                                <Input placeholder="Your full name" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                value={profile?.email ?? ""}
                                disabled
                                className="bg-muted"
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                              Email is managed by your account provider
                            </p>
                          </FormItem>
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
                        </div>
                        <FormField
                          control={form.control}
                          name="address"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Address</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Your full address"
                                  rows={3}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* ID Document placeholder */}
                        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 bg-muted/20">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-muted-foreground/40" />
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                Identity Document
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Document upload coming soon. Contact admin to
                                update.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIsEditing(false);
                              form.reset();
                            }}
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
                            {updateProfile.isPending ? "Saving…" : "Save Changes"}
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
                        value={
                          profile?.email ??
                          clerkUser?.primaryEmailAddress?.emailAddress
                        }
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
                        Account & Role
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
                      {/* ID Document placeholder */}
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
            <TabsContent value="projects" className="mt-4">
              {!profile?.projectAssignments?.length ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <FolderKanban className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No project assignments yet.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Contact an administrator to be assigned to projects.
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
                      <Card
                        key={assignment.assignmentId}
                        className="relative overflow-hidden"
                      >
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/30 rounded-l" />
                        <CardContent className="pt-4 pl-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-foreground text-sm truncate">
                                {project?.name ?? assignment.projectId}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {project?.location ?? ""}
                                {project?.district
                                  ? `, ${project.district}`
                                  : ""}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1 items-end flex-shrink-0">
                              {project?.status && (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[project.status] ?? "bg-gray-100 text-gray-700"}`}
                                >
                                  {project.status}
                                </span>
                              )}
                              {projectRole && (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[projectRole]}`}
                                >
                                  {ROLE_LABELS[projectRole]}
                                </span>
                              )}
                            </div>
                          </div>
                          {project?.landArea && (
                            <p className="text-xs text-muted-foreground mt-2">
                              {project.landArea} {project.landAreaUnit} ·{" "}
                              {project.termYears} yr term
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── Activity Tab ── */}
            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="font-serif text-base">
                    Recent Activity
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
                        No activity recorded yet.
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
