import { createContext, useContext, ReactNode, useEffect } from "react";
import { useUser } from "@clerk/react";
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
  assignedProjectIds: number[];
  isAdmin: boolean;
  isDeveloper: boolean;
  canAccessProject: (projectId: number) => boolean;
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
  const { data: profile, isLoading: isLoadingProfile } = useGetMe({
    query: { enabled: !!user, queryKey: getGetMeQueryKey() },
  });
  const upsertMe = useUpsertMe();

  // Auto-register user on first load
  useEffect(() => {
    if (user && isLoaded && !isLoadingProfile && !profile?.role) {
      upsertMe.mutate({
        data: {
          role: "employee",
          displayName: user.fullName ?? undefined,
          email: user.primaryEmailAddress?.emailAddress ?? undefined,
        },
      });
    }
  }, [user, isLoaded, isLoadingProfile, profile]);

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
