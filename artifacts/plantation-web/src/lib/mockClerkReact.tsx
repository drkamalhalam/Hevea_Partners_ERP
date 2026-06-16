import React, { createContext, useContext, useState, useEffect } from "react";

// Define context state for our mock auth session
interface MockAuthContextType {
  isSignedIn: boolean;
  userId: string | null;
  userProfile: {
    id: string;
    fullName: string;
    email: string;
    role: string;
  } | null;
  loginAs: (roleId: string) => void;
  logout: () => void;
}

const MockAuthContext = createContext<MockAuthContextType | undefined>(undefined);

// Available seeded mock users matching seed.ts
export const MOCK_ROLES = [
  { id: "user_sample_admin", name: "Ranjit Majumdar", email: "admin@heveapartners.in", role: "admin" },
  { id: "user_sample_developer", name: "Ramesh Debbarma", email: "ramesh@heveapartners.in", role: "developer" },
  { id: "user_sample_landowner1", name: "Sukumar Tripura", email: "sukumar@example.in", role: "landowner" },
  { id: "user_sample_landowner2", name: "Birendra Reang", email: "birendra@example.in", role: "landowner" },
  { id: "user_sample_investor", name: "Dilip Jamatia", email: "dilip@example.in", role: "investor" },
  { id: "user_sample_employee", name: "Priya Sharma", email: "priya@heveapartners.in", role: "employee" },
  { id: "user_sample_staff", name: "Raju Das", email: "raju@heveapartners.in", role: "operational_staff" }
];

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  // Load session from localStorage if present, default to admin
  const [userId, setUserId] = useState<string | null>(() => {
    return localStorage.getItem("hevea_mock_user_id") || "user_sample_admin";
  });

  const activeUser = MOCK_ROLES.find(u => u.id === userId) || MOCK_ROLES[0];

  const loginAs = (id: string) => {
    localStorage.setItem("hevea_mock_user_id", id);
    setUserId(id);
    // Force reload to refresh context values and invalidate TanStack caches
    window.location.reload();
  };

  const logout = () => {
    localStorage.removeItem("hevea_mock_user_id");
    setUserId(null);
    window.location.reload();
  };

  return (
    <MockAuthContext.Provider
      value={{
        isSignedIn: !!userId,
        userId,
        userProfile: userId ? {
          id: activeUser.id,
          fullName: activeUser.name,
          email: activeUser.email,
          role: activeUser.role
        } : null,
        loginAs,
        logout
      }}
    >
      {children}
    </MockAuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(MockAuthContext);
  if (!context) {
    throw new Error("useAuth must be used within a Mock ClerkProvider");
  }
  return {
    isSignedIn: context.isSignedIn,
    userId: context.userId,
    // Add custom header containing our mock Clerk user ID on all API fetches
    getToken: async () => context.userId || "user_sample_admin",
    signOut: context.logout
  };
}
export function useUser() {
  const context = useContext(MockAuthContext);

  if (!context) {
    throw new Error("useUser must be used within a Mock ClerkProvider");
  }

  return {
    isLoaded: true,
    isSignedIn: context.isSignedIn,
    user: context.userProfile
      ? {
        id: context.userProfile.id,
        fullName: context.userProfile.fullName,
        primaryEmailAddress: {
          emailAddress: context.userProfile.email,
        },
      }
      : null,
  };
}
export function useClerk() {
  const context = useContext(MockAuthContext);
  if (!context) {
    throw new Error("useClerk must be used within a Mock ClerkProvider");
  }
  return {
    user: context.userProfile ? {
      id: context.userProfile.id,
      fullName: context.userProfile.fullName,
      primaryEmailAddress: { emailAddress: context.userProfile.email }
    } : null,
    addListener: (callback: any) => {
      // Simulate listener trigger immediately
      if (context.userProfile) {
        callback({
          user: {
            id: context.userProfile.id,
            fullName: context.userProfile.fullName
          }
        });
      }
      return () => { };
    },
    signOut: context.logout
  };
}

export function Show({ children, when }: { children: React.ReactNode; when: "signed-in" | "signed-out" }) {
  const { isSignedIn } = useAuth();
  if (when === "signed-in" && isSignedIn) return <>{children}</>;
  if (when === "signed-out" && !isSignedIn) return <>{children}</>;
  return null;
}

export function SignIn({ signUpUrl }: { signUpUrl?: string }) {
  const context = useContext(MockAuthContext);
  if (!context) return null;

  return (
    <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg border border-gray-100">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Hevea Partners ERP</h1>
        <p className="text-sm text-gray-500 mt-1">Local Developer Login Gate</p>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
          Select a Developer Persona:
        </label>
        {MOCK_ROLES.map((u) => (
          <button
            key={u.id}
            onClick={() => context.loginAs(u.id)}
            className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/50 transition-all flex justify-between items-center group"
          >
            <div>
              <p className="font-semibold text-gray-700 text-sm group-hover:text-emerald-700">{u.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{u.email}</p>
            </div>
            <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium uppercase tracking-wider group-hover:bg-emerald-100 group-hover:text-emerald-700">
              {u.role}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SignUp({ signInUrl }: { signInUrl?: string }) {
  return (
    <div className="text-center p-8 bg-white rounded-lg shadow border border-gray-100 max-w-sm">
      <h2 className="text-xl font-bold text-gray-800">Account Registration</h2>
      <p className="text-sm text-gray-500 mt-2">
        Local setup does not require registration. Persona selection is active.
      </p>
      <a
        href={signInUrl || "/sign-in"}
        className="mt-4 inline-block text-emerald-600 font-semibold hover:underline text-sm"
      >
        Go to Persona Selection
      </a>
    </div>
  );
}
