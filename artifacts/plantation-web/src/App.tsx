import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
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
import ProjectCreationWizard from "./pages/ProjectCreationWizard";
import ProjectDetails from "./pages/ProjectDetails";
import Partners from "./pages/Partners";
import PartnerDetails from "./pages/PartnerDetails";
import PersonRegistry from "./pages/PersonRegistry";
import PersonProfile from "./pages/PersonProfile";
import MyPortfolio from "./pages/MyPortfolio";
import MyProfile from "./pages/MyProfile";
import UserProfile from "./pages/UserProfile";
import Admin from "./pages/Admin";

// Pages — Finance
import Agreements from "./pages/Agreements";
import AgreementDetails from "./pages/AgreementDetails";
import GenerateAgreement from "./pages/GenerateAgreement";
import GenerationViewer from "./pages/GenerationViewer";
import ActivationDashboard from "./pages/ActivationDashboard";
import Contributions from "./pages/Contributions";
import LandContribution from "./pages/LandContribution";
import EconomicContributions from "./pages/EconomicContributions";
import OwnershipGuidance from "./pages/OwnershipGuidance";
import OwnershipArchive from "./pages/OwnershipArchive";
import ParticipationDashboard from "./pages/ParticipationDashboard";
import ContributionDisputeCenter from "./pages/ContributionDisputeCenter";
import Expenditure from "./pages/Expenditure";
import Burden from "./pages/Burden";
import PostMaturityPayments from "./pages/PostMaturityPayments";
import RecoverableAdvances from "./pages/RecoverableAdvances";
import ExpenditureGovernance from "./pages/ExpenditureGovernance";
import ExpenditureAnalytics from "./pages/ExpenditureAnalytics";
import LCAConfig from "./pages/LCAConfig";
import LCALedger from "./pages/LCALedger";
import LandownerAccount from "./pages/LandownerAccount";
import BurdenRecovery from "./pages/BurdenRecovery";
import LandownerProfitability from "./pages/LandownerProfitability";
import LCAGovernance from "./pages/LCAGovernance";
import FinancialAuditLog from "./pages/FinancialAuditLog";
import AuditLog from "./pages/AuditLog";
import GovernanceTimeline from "./pages/GovernanceTimeline";
import GovernanceOverrides from "./pages/GovernanceOverrides";
import DisputeDashboard from "./pages/DisputeDashboard";
import EvidenceArchive from "./pages/EvidenceArchive";
import FinancialAnalytics from "./pages/FinancialAnalytics";
import GlobalAnalytics from "./pages/GlobalAnalytics";
import ProjectAnalytics from "./pages/ProjectAnalytics";
import FinancialReports from "./pages/FinancialReports";
import OwnershipAnalytics from "./pages/OwnershipAnalytics";
import SettlementAnalytics from "./pages/SettlementAnalytics";
import OperationalAnalytics from "./pages/OperationalAnalytics";
import TemplateLibrary from "./pages/TemplateLibrary";

// Pages — Operations
import Production from "./pages/Production";
import ProductionLog from "./pages/ProductionLog";
import BatchDetail from "./pages/BatchDetail";
import Stock from "./pages/Stock";
import Inventory from "./pages/Inventory";
import InventoryAnalytics from "./pages/InventoryAnalytics";
import Sales from "./pages/Sales";
import SalesAudit from "./pages/SalesAudit";
import SalesOrders from "./pages/SalesOrders";
import SalesOrderDetail from "./pages/SalesOrderDetail";
import SalesOrderDashboard from "./pages/SalesOrderDashboard";
import MoneyCustody from "./pages/MoneyCustody";
import PaymentReceivers from "./pages/PaymentReceivers";
import SalesPermissions from "./pages/SalesPermissions";
import PaymentSettings from "./pages/PaymentSettings";
import GovernanceAlertCenter from "./pages/GovernanceAlertCenter";
import GovernanceMonitoringDashboard from "./pages/GovernanceMonitoringDashboard";
import UserActivityDashboard from "./pages/UserActivityDashboard";
import SnapshotArchive from "./pages/SnapshotArchive";
import AuditInvestigation from "./pages/AuditInvestigation";
import OperationalTasks from "./pages/OperationalTasks";
import OperationalAlerts from "./pages/OperationalAlerts";
import OperationalAccessLog from "./pages/OperationalAccessLog";
import DistributionPreview from "./pages/DistributionPreview";
import DistributionWorkflow from "./pages/DistributionWorkflow";
import FiftyPctSettlement from "./pages/FiftyPctSettlement";
import PartnerPayable from "./pages/PartnerPayable";
import LossAbsorption from "./pages/LossAbsorption";
import FinalSettlement from "./pages/FinalSettlement";
import DistributionRecords from "./pages/DistributionRecords";
import SettlementGovernance from "./pages/SettlementGovernance";
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
import OwnershipTransfers from "./pages/OwnershipTransfers";
import ValuationEngine from "./pages/ValuationEngine";
import LNVGovernance from "./pages/LNVGovernance";
import OwnershipStateManager from "./pages/OwnershipStateManager";
import HeldDistributions from "./pages/HeldDistributions";
import CollectionEntry from "./pages/CollectionEntry";
import StoreEntry from "./pages/StoreEntry";
import WorkerHistory from "./pages/WorkerHistory";
import ProductionDashboard from "./pages/ProductionDashboard";
import EmployeeAssignments from "./pages/EmployeeAssignments";
import InheritanceClaims from "./pages/InheritanceClaims";
import NomineeSuccessionDashboard from "./pages/NomineeSuccessionDashboard";
import PrematuritySuccession from "./pages/PrematuritySuccession";
import OwnershipContinuityDashboard from "./pages/OwnershipContinuityDashboard";
import BackupExport from "./pages/BackupExport";

// Pages — Multi-Store
import Stores from "./pages/Stores";
import StockTransfer from "./pages/StockTransfer";
import MultiStoreInventory from "./pages/MultiStoreInventory";
import DispatchMemo from "./pages/DispatchMemo";

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

function ClerkAuthTokenSetter() {
  const { getToken, isSignedIn } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(isSignedIn ? () => getToken() : null);
    return () => { setAuthTokenGetter(null); };
  }, [isSignedIn, getToken]);
  return null;
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
        <ClerkAuthTokenSetter />
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
              <Route path="/projects/create"><ProtectedRoute component={ProjectCreationWizard} /></Route>
              <Route path="/projects/create/:id"><ProtectedRoute component={ProjectCreationWizard} /></Route>
              <Route path="/projects/:id"><ProtectedRoute component={ProjectDetails} /></Route>
              <Route path="/projects/:id/maturity"><ProtectedRoute component={ProjectMaturityDeclaration} /></Route>
              <Route path="/projects/:id/nominee/activation"><ProtectedRoute component={NomineeActivationPage} /></Route>
              <Route path="/projects/:id/closure"><ProtectedRoute component={ProjectClosurePage} /></Route>
              <Route path="/partners"><ProtectedRoute component={Partners} /></Route>
              <Route path="/partners/:id"><ProtectedRoute component={PartnerDetails} /></Route>
              <Route path="/person-registry"><ProtectedRoute component={PersonRegistry} /></Route>
              <Route path="/person-registry/:id"><ProtectedRoute component={PersonProfile} /></Route>
              <Route path="/my-portfolio"><ProtectedRoute component={MyPortfolio} /></Route>
              <Route path="/profile"><ProtectedRoute component={MyProfile} /></Route>
              <Route path="/users/:clerkUserId"><ProtectedRoute component={UserProfile} /></Route>

              {/* Finance */}
              <Route path="/agreements"><ProtectedRoute component={Agreements} /></Route>
              <Route path="/agreements/:id"><ProtectedRoute component={AgreementDetails} /></Route>
              <Route path="/agreements/:id/generations/:genId"><ProtectedRoute component={GenerationViewer} /></Route>
              <Route path="/activation"><ProtectedRoute component={ActivationDashboard} /></Route>
              <Route path="/generate-agreement"><ProtectedRoute component={GenerateAgreement} /></Route>
              <Route path="/contributions/land"><ProtectedRoute component={LandContribution} /></Route>
              <Route path="/contributions/economic"><ProtectedRoute component={EconomicContributions} /></Route>
              <Route path="/contributions/dashboard"><ProtectedRoute component={ParticipationDashboard} /></Route>
              <Route path="/contributions/disputes"><ProtectedRoute component={ContributionDisputeCenter} /></Route>
              <Route path="/contributions"><ProtectedRoute component={Contributions} /></Route>
              <Route path="/ownership/archive"><ProtectedRoute component={OwnershipArchive} /></Route>
              <Route path="/ownership"><ProtectedRoute component={OwnershipGuidance} /></Route>
              <Route path="/expenditure"><ProtectedRoute component={Expenditure} /></Route>
              <Route path="/burden"><ProtectedRoute component={Burden} /></Route>
              <Route path="/post-maturity-payments"><ProtectedRoute component={PostMaturityPayments} /></Route>
              <Route path="/advances"><ProtectedRoute component={RecoverableAdvances} /></Route>
              <Route path="/expenditure-governance"><ProtectedRoute component={ExpenditureGovernance} /></Route>
              <Route path="/expenditure-analytics"><ProtectedRoute component={ExpenditureAnalytics} /></Route>
              <Route path="/lca"><ProtectedRoute component={LCAConfig} /></Route>
              <Route path="/lca/ledger"><ProtectedRoute component={LCALedger} /></Route>
              <Route path="/lca/governance"><ProtectedRoute component={LCAGovernance} /></Route>
              <Route path="/landowner-account"><ProtectedRoute component={LandownerAccount} /></Route>
              <Route path="/burden-recovery"><ProtectedRoute component={BurdenRecovery} /></Route>
              <Route path="/templates"><ProtectedRoute component={TemplateLibrary} /></Route>

              {/* Operations — Production & Collection */}
              <Route path="/collection-entry"><ProtectedRoute component={CollectionEntry} /></Route>
              <Route path="/store-entry"><ProtectedRoute component={StoreEntry} /></Route>
              <Route path="/worker-history"><ProtectedRoute component={WorkerHistory} /></Route>
              <Route path="/production-dashboard"><ProtectedRoute component={ProductionDashboard} /></Route>
              <Route path="/employee-assignments"><ProtectedRoute component={EmployeeAssignments} /></Route>

              {/* Operations */}
              <Route path="/production"><ProtectedRoute component={Production} /></Route>
              <Route path="/production-log"><ProtectedRoute component={ProductionLog} /></Route>
              <Route path="/production-log/batches/:id"><ProtectedRoute component={BatchDetail} /></Route>
              <Route path="/stock"><ProtectedRoute component={Stock} /></Route>
              <Route path="/inventory"><ProtectedRoute component={Inventory} /></Route>
              <Route path="/inventory-analytics"><ProtectedRoute component={InventoryAnalytics} /></Route>
              <Route path="/sales/audit"><ProtectedRoute component={SalesAudit} /></Route>
              <Route path="/tasks"><ProtectedRoute component={OperationalTasks} /></Route>
              <Route path="/operational-alerts"><ProtectedRoute component={OperationalAlerts} /></Route>
              <Route path="/operational-access-log"><ProtectedRoute component={OperationalAccessLog} /></Route>
              <Route path="/distribution-preview"><ProtectedRoute component={DistributionPreview} /></Route>
              <Route path="/distribution-workflow"><ProtectedRoute component={DistributionWorkflow} /></Route>
              <Route path="/fifty-pct-settlement"><ProtectedRoute component={FiftyPctSettlement} /></Route>
              <Route path="/partner-payable"><ProtectedRoute component={PartnerPayable} /></Route>
              <Route path="/loss-absorption"><ProtectedRoute component={LossAbsorption} /></Route>
              <Route path="/final-settlement"><ProtectedRoute component={FinalSettlement} /></Route>
              <Route path="/distribution-records"><ProtectedRoute component={DistributionRecords} /></Route>
              <Route path="/settlement-governance"><ProtectedRoute component={SettlementGovernance} /></Route>
              <Route path="/ownership-transfers"><ProtectedRoute component={OwnershipTransfers} /></Route>
              <Route path="/ownership-state-manager"><ProtectedRoute component={OwnershipStateManager} /></Route>
              <Route path="/held-distributions"><ProtectedRoute component={HeldDistributions} /></Route>
              <Route path="/valuation-engine"><ProtectedRoute component={ValuationEngine} /></Route>
              <Route path="/lnv-governance"><ProtectedRoute component={LNVGovernance} /></Route>
              <Route path="/inheritance-claims"><ProtectedRoute component={InheritanceClaims} /></Route>
              <Route path="/nominee-succession"><ProtectedRoute component={NomineeSuccessionDashboard} /></Route>
              <Route path="/prematurity-succession"><ProtectedRoute component={PrematuritySuccession} /></Route>
              <Route path="/ownership-continuity"><ProtectedRoute component={OwnershipContinuityDashboard} /></Route>
              <Route path="/sales"><ProtectedRoute component={Sales} /></Route>
              <Route path="/distribution"><ProtectedRoute component={Distribution} /></Route>
              {/* Sales Orders v2 — Payment Workflow */}
              <Route path="/sales-orders"><ProtectedRoute component={SalesOrders} /></Route>
              <Route path="/sales-orders/:id"><ProtectedRoute component={SalesOrderDetail} /></Route>
              <Route path="/sales-dashboard"><ProtectedRoute component={SalesOrderDashboard} /></Route>
              <Route path="/money-custody"><ProtectedRoute component={MoneyCustody} /></Route>
              <Route path="/payment-receivers"><ProtectedRoute component={PaymentReceivers} /></Route>
              <Route path="/sales-permissions"><ProtectedRoute component={SalesPermissions} /></Route>
              <Route path="/payment-settings"><ProtectedRoute component={PaymentSettings} /></Route>
              <Route path="/governance-alert-center"><ProtectedRoute component={GovernanceAlertCenter} /></Route>
              <Route path="/governance-monitoring"><ProtectedRoute component={GovernanceMonitoringDashboard} /></Route>
              <Route path="/user-activity"><ProtectedRoute component={UserActivityDashboard} /></Route>
              <Route path="/snapshots"><ProtectedRoute component={SnapshotArchive} /></Route>
              <Route path="/audit-investigation"><ProtectedRoute component={AuditInvestigation} /></Route>

              {/* Analytics */}
              <Route path="/global-analytics"><ProtectedRoute component={GlobalAnalytics} /></Route>
              <Route path="/project-analytics"><ProtectedRoute component={ProjectAnalytics} /></Route>
              <Route path="/financial-reports"><ProtectedRoute component={FinancialReports} /></Route>
              <Route path="/ownership-analytics"><ProtectedRoute component={OwnershipAnalytics} /></Route>
              <Route path="/settlement-analytics"><ProtectedRoute component={SettlementAnalytics} /></Route>
              <Route path="/operational-analytics"><ProtectedRoute component={OperationalAnalytics} /></Route>
              <Route path="/financial-analytics"><ProtectedRoute component={FinancialAnalytics} /></Route>
              <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
              <Route path="/documents"><ProtectedRoute component={Documents} /></Route>
              <Route path="/landowner-profitability"><ProtectedRoute component={LandownerProfitability} /></Route>

              {/* Governance */}
              <Route path="/governance"><ProtectedRoute component={Governance} /></Route>
              <Route path="/notifications"><ProtectedRoute component={Notifications} /></Route>

              {/* System */}
              <Route path="/admin"><AdminRoute component={Admin} /></Route>
              <Route path="/audit-log"><ProtectedRoute component={AuditLog} /></Route>
              <Route path="/governance-timeline"><ProtectedRoute component={GovernanceTimeline} /></Route>
              <Route path="/governance-overrides"><ProtectedRoute component={GovernanceOverrides} /></Route>
              <Route path="/disputes"><ProtectedRoute component={DisputeDashboard} /></Route>
              <Route path="/evidence-archive"><ProtectedRoute component={EvidenceArchive} /></Route>
              <Route path="/financial-audit-log"><ProtectedRoute component={FinancialAuditLog} /></Route>
              <Route path="/backup-export"><AdminRoute component={BackupExport} /></Route>

              {/* Multi-Store Inventory */}
              <Route path="/stores"><ProtectedRoute component={Stores} /></Route>
              <Route path="/stock-transfer"><ProtectedRoute component={StockTransfer} /></Route>
              <Route path="/multi-store-inventory"><ProtectedRoute component={MultiStoreInventory} /></Route>
              <Route path="/dispatch-memos"><ProtectedRoute component={DispatchMemo} /></Route>

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
