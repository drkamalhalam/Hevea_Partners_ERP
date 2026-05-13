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
  const upsertedRef = useRef(false);

  // Always sync the user record on first load of each session.
  // This handles three cases:
  //   1. Brand new user — creates their DB record
  //   2. Existing user whose Clerk ID changed (dev token refresh / re-sign-in)
  //      — the PUT /me email-linking logic re-links the pre-created record
  //   3. Normal returning user — no-op (onConflictDoUpdate leaves role untouched)
  // After the upsert succeeds we invalidate the /me cache so the correct role
  // is immediately reflected in the UI.
  useEffect(() => {
    if (!user || !isLoaded || upsertedRef.current) return;
    upsertedRef.current = true;
    upsertMe.mutate(
      {
        data: {
          role: "employee",
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
