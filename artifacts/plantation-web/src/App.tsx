import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useRef } from "react";

// Contexts
import { RoleProvider, useRole } from "@/contexts/RoleContext";

// Pages — Core
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetails from "./pages/ProjectDetails";
import Partners from "./pages/Partners";
import PartnerDetails from "./pages/PartnerDetails";
import MyPortfolio from "./pages/MyPortfolio";
import MyProfile from "./pages/MyProfile";
import UserProfile from "./pages/UserProfile";
import Admin from "./pages/Admin";

// Pages — Finance
import Agreements from "./pages/Agreements";
import AgreementDetails from "./pages/AgreementDetails";
import GenerateAgreement from "./pages/GenerateAgreement";
import GenerationViewer from "./pages/GenerationViewer";
import Contributions from "./pages/Contributions";
import Expenditure from "./pages/Expenditure";
import TemplateLibrary from "./pages/TemplateLibrary";

// Pages — Operations
import Production from "./pages/Production";
import Stock from "./pages/Stock";
import Inventory from "./pages/Inventory";
import Sales from "./pages/Sales";
import Distribution from "./pages/Distribution";

// Pages — Analytics
import Reports from "./pages/Reports";
import Documents from "./pages/Documents";

// Pages — Governance
import Governance from "./pages/Governance";
import Notifications from "./pages/Notifications";

import ProjectMaturityDeclaration from "./pages/ProjectMaturityDeclaration";
import NomineeActivationPage from "./pages/NomineeActivationPage";
import ProjectClosurePage from "./pages/ProjectClosurePage";
// Layout
import NotFound from "@/pages/not-found";
import Layout from "./components/layout/Layout";

const queryClient = new QueryClient();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";
const isProd = import.meta.env.PROD;
const clerkProxyUrl = isProd
  ? (import.meta.env.VITE_CLERK_PROXY_URL || `${window.location.origin}/api/__clerk`)
  : undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      // Only clear cache when switching FROM an authenticated user TO a different
      // state (sign-out or different account). Ignore the initial null→user
      // transition that fires during Clerk's own initialisation — that would
      // wipe the /me cache on every page load and cause the role to flash
      // "employee" while the query re-fetches.
      const prevWasAuthenticatedUser =
        prevUserIdRef.current !== undefined && prevUserIdRef.current !== null;
      if (prevWasAuthenticatedUser && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><Home /></Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoading } = useRole();

  if (isLoading) {
    return (
      <Show when="signed-in">
        <Layout>
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground text-sm">Checking permissions…</div>
          </div>
        </Layout>
      </Show>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <Show when="signed-in">
          <Redirect to="/dashboard" />
        </Show>
        <Show when="signed-out">
          <Redirect to="/sign-in" />
        </Show>
      </>
    );
  }

  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function AppRoutes() {
  const [, setLocation] = useLocation();

  if (!clerkPubKey) {
    return <div className="p-8 text-destructive">Missing Clerk Publishable Key</div>;
  }

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <RoleProvider>
          <TooltipProvider>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />

              {/* Core */}
              <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
              <Route path="/projects"><ProtectedRoute component={Projects} /></Route>
              <Route path="/projects/:id"><ProtectedRoute component={ProjectDetails} /></Route>
              <Route path="/projects/:id/maturity"><ProtectedRoute component={ProjectMaturityDeclaration} /></Route>
              <Route path="/projects/:id/nominee/activation"><ProtectedRoute component={NomineeActivationPage} /></Route>
              <Route path="/projects/:id/closure"><ProtectedRoute component={ProjectClosurePage} /></Route>
              <Route path="/partners"><ProtectedRoute component={Partners} /></Route>
              <Route path="/partners/:id"><ProtectedRoute component={PartnerDetails} /></Route>
              <Route path="/my-portfolio"><ProtectedRoute component={MyPortfolio} /></Route>
              <Route path="/profile"><ProtectedRoute component={MyProfile} /></Route>
              <Route path="/users/:clerkUserId"><ProtectedRoute component={UserProfile} /></Route>

              {/* Finance */}
              <Route path="/agreements"><ProtectedRoute component={Agreements} /></Route>
              <Route path="/agreements/:id"><ProtectedRoute component={AgreementDetails} /></Route>
              <Route path="/agreements/:id/generations/:genId"><ProtectedRoute component={GenerationViewer} /></Route>
              <Route path="/generate-agreement"><ProtectedRoute component={GenerateAgreement} /></Route>
              <Route path="/contributions"><ProtectedRoute component={Contributions} /></Route>
              <Route path="/expenditure"><ProtectedRoute component={Expenditure} /></Route>
              <Route path="/templates"><ProtectedRoute component={TemplateLibrary} /></Route>

              {/* Operations */}
              <Route path="/production"><ProtectedRoute component={Production} /></Route>
              <Route path="/stock"><ProtectedRoute component={Stock} /></Route>
              <Route path="/inventory"><ProtectedRoute component={Inventory} /></Route>
              <Route path="/sales"><ProtectedRoute component={Sales} /></Route>
              <Route path="/distribution"><ProtectedRoute component={Distribution} /></Route>

              {/* Analytics */}
              <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
              <Route path="/documents"><ProtectedRoute component={Documents} /></Route>

              {/* Governance */}
              <Route path="/governance"><ProtectedRoute component={Governance} /></Route>
              <Route path="/notifications"><ProtectedRoute component={Notifications} /></Route>

              {/* System */}
              <Route path="/admin"><AdminRoute component={Admin} /></Route>

              <Route component={NotFound} />
            </Switch>
            <Toaster />
          </TooltipProvider>
        </RoleProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

export default App;
