import { createContext, useContext, ReactNode, useEffect, useRef, useState } from "react";
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

const VALID_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "developer",
  "landowner",
  "investor",
  "employee",
  "operational_staff",
]);

function roleStorageKey(userId: string) {
  return `hevea_role_${userId}`;
}

function readCachedRole(userId: string | undefined): UserRole | null {
  if (!userId) return null;
  try {
    const stored = localStorage.getItem(roleStorageKey(userId));
    return stored && VALID_ROLES.has(stored) ? (stored as UserRole) : null;
  } catch {
    return null;
  }
}

function writeCachedRole(userId: string, role: UserRole) {
  try {
    localStorage.setItem(roleStorageKey(userId), role);
  } catch {
    // localStorage unavailable — no-op
  }
}

function clearCachedRole(userId: string) {
  try {
    localStorage.removeItem(roleStorageKey(userId));
  } catch {
    // no-op
  }
}

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
  // per distinct user, not once per component lifetime.
  const upsertedForUserRef = useRef<string | null>(null);

  // Seed the initial role from localStorage so the correct role is shown
  // immediately on page load — before GET /me completes — and to survive
  // brief 401 windows (session token refresh, server restart, etc.).
  const [localRole, setLocalRole] = useState<UserRole | null>(() =>
    readCachedRole(user?.id),
  );

  // When the Clerk userId changes (sign-in / sign-out / account switch),
  // reload the cached role for the new user.
  const prevUserIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    const uid = user?.id;
    if (uid === prevUserIdRef.current) return;
    prevUserIdRef.current = uid;

    if (uid) {
      setLocalRole(readCachedRole(uid));
    } else {
      // User signed out — clear the local role so the next sign-in is clean.
      setLocalRole(null);
    }
  }, [user?.id, isLoaded]);

  // When the server profile loads successfully, persist the authoritative role
  // to localStorage and update local state.
  useEffect(() => {
    if (!profile?.role || !user?.id) return;
    const serverRole = profile.role as UserRole;
    writeCachedRole(user.id, serverRole);
    setLocalRole(serverRole);
  }, [profile?.role, user?.id]);

  // Sync the user record on first load of each authenticated session.
  // Handles three cases:
  //   1. Brand new user  — creates their DB record (role defaults to "employee"
  //      via DB default; we never send role from the client so it can never be
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

  // Resolution order:
  //   1. Live server data (profile.role) — always authoritative when present
  //   2. localStorage cache — survives page reloads and brief auth hiccups
  //   3. "employee" — safe default for brand-new or unauthenticated users
  const role = ((profile?.role ?? localRole) ?? "employee") as UserRole;
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
