import { createContext, useContext, ReactNode, useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, useUpsertMe, getGetMeQueryKey } from "@workspace/api-client-react";

export type UserRole =
  | "admin"
  | "developer"
  | "landowner"
  | "investor"
  | "employee"
  | "operational_staff";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  developer: "Project Developer",
  landowner: "Land Owner",
  investor: "Investor",
  employee: "Employee",
  operational_staff: "Operational Staff",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-red-100 text-red-800",
  developer: "bg-blue-100 text-blue-800",
  landowner: "bg-amber-100 text-amber-800",
  investor: "bg-purple-100 text-purple-800",
  employee: "bg-gray-100 text-gray-800",
  operational_staff: "bg-green-100 text-green-800",
};

interface RoleContextValue {
  role: UserRole;
  assignedProjectIds: string[];
  isAdmin: boolean;
  isDeveloper: boolean;
  canAccessProject: (projectId: string) => boolean;
  canAccessAllProjects: boolean;
  isLoading: boolean;
}

const RoleContext = createContext<RoleContextValue>({
  role: "employee",
  assignedProjectIds: [],
  isAdmin: false,
  isDeveloper: false,
  canAccessProject: () => false,
  canAccessAllProjects: false,
  isLoading: true,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: isLoadingProfile } = useGetMe({
    query: { enabled: !!user, queryKey: getGetMeQueryKey() },
  });
  const upsertMe = useUpsertMe();
  // Track which Clerk userId we have already synced so the upsert fires once
  // per distinct user, not once per component lifetime.  A plain boolean ref
  // would get stuck as `true` if the user signs out and back in (or switches
  // accounts) without unmounting this provider.
  const upsertedForUserRef = useRef<string | null>(null);

  // Sync the user record on first load of each authenticated session.
  // Handles three cases:
  //   1. Brand new user  — creates their DB record (role defaults to "employee"
  //      via DB default; we never send role from the client so it is never
  //      accidentally overwritten here)
  //   2. Existing user whose Clerk ID changed — email-linking in PUT /me
  //      re-links the pre-created record while preserving their stored role
  //   3. Normal returning user — no-op (onConflictDoUpdate leaves role untouched)
  // After the upsert succeeds we invalidate the /me cache so the correct role
  // is immediately reflected in the UI.
  useEffect(() => {
    if (!user || !isLoaded) return;
    if (upsertedForUserRef.current === user.id) return;
    upsertedForUserRef.current = user.id;
    upsertMe.mutate(
      {
        data: {
          displayName: user.fullName ?? undefined,
          email: user.primaryEmailAddress?.emailAddress ?? undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
      },
    );
  }, [user, isLoaded]);

  const role = (profile?.role ?? "employee") as UserRole;
  const assignedProjectIds = profile?.assignedProjectIds ?? [];
  const isAdmin = role === "admin";
  const isDeveloper = role === "developer";
  const canAccessAllProjects = isAdmin || isDeveloper;

  return (
    <RoleContext.Provider
      value={{
        role,
        assignedProjectIds,
        isAdmin,
        isDeveloper,
        canAccessProject: (id) =>
          canAccessAllProjects || assignedProjectIds.includes(id),
        canAccessAllProjects,
        isLoading: !isLoaded || isLoadingProfile,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
