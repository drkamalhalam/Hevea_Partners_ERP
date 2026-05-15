import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import healthRouter from "./health";
import meRouter from "./me";
import usersRouter from "./users";
import maturityRouter from "./maturity";
import missingDeveloperRouter from "./missing_developer";
import nomineeActivationRouter from "./nominee_activation";
import projectClosureRouter from "./project_closure";
import projectsRouter from "./projects";
import partnersRouter from "./partners";
import agreementsRouter from "./agreements";
import agreementActivationRouter from "./agreement_activation";
import agreementAccountingRouter from "./agreement_accounting";
import financialAuditLogRouter from "./financial_audit_log";
import dashboardRouter from "./dashboard";
import productionRouter from "./production";
import stockRouter from "./stock";
import governanceRouter from "./governance";
import storageRouter from "./storage";
import templatesRouter from "./templates";
import generationsRouter from "./generations";
import documentsRouter from "./documents";
import contributionsRouter from "./contributions";
import ownershipRouter from "./ownership";
import ownershipTransfersRouter from "./ownership_transfers";
import expendituresRouter from "./expenditures";
import expenditureVerificationRouter from "./expenditure_verification";
import burdenRouter from "./burden";
import burdenImbalancesRouter from "./burden_imbalances";
import advancesRouter from "./advances";
import lcaRouter from "./lca";
import landownerAccountRouter from "./landowner_account";
import burdenRecoveryRouter from "./burden_recovery";
import analyticsRouter from "./analytics";
import productionLogRouter from "./production_log";
import inventoryStockRouter from "./inventory_stock";
import buyersRouter from "./buyers";
import salesRouter from "./sales";
import salesAuditRouter from "./sales_audit";
import tasksRouter from "./tasks";
import operationalAlertsRouter from "./operational_alerts";
import operationalAccessLogsRouter from "./operational_access_logs";
import distributionPreviewsRouter from "./distribution_previews";
import fiftyPctRouter from "./fifty_pct";
import payableRouter from "./payable";
import lossAbsorptionRouter from "./loss_absorption";
import settlementOverridesRouter from "./settlement_overrides";
import distributionRecordsRouter from "./distribution_records";
import settlementGovernanceRouter from "./settlement_governance";
import financialAnalyticsRouter from "./financial_analytics";
import valuationsRouter from "./valuations";
import inheritanceRouter from "./inheritance";
import nomineeSuccessionRouter from "./nominee_succession";
import prematuritySuccessionRouter from "./prematurity_succession";
import notificationsRouter from "./notifications_route";
import reportsRouter from "./reports";
import governanceMeetingsRouter from "./governance_meetings";
import backupRouter from "./backup";
import multiStoreRouter from "./multi_store";
import devRouter from "./dev";

const router: IRouter = Router();

// Public — no auth required
router.use(healthRouter);

// Apply auth middleware to all routes below this point
router.use(requireAuth);

// Dev tools (auth required but no role restriction, disabled in prod)
router.use("/dev", devRouter);

// User profile (self)
router.use("/me", meRouter);

// Admin-managed user list & role assignments
router.use("/users", usersRouter);

// Core business resources
router.use("/projects", maturityRouter);
router.use("/projects", missingDeveloperRouter);
router.use("/projects", nomineeActivationRouter);
router.use("/projects", projectClosureRouter);
router.use("/projects", projectsRouter);
router.use("/partners", partnersRouter);
router.use("/agreements", agreementActivationRouter);
router.use("/agreements", agreementAccountingRouter);
router.use("/agreements", agreementsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/production", productionRouter);
router.use("/stock", stockRouter);
router.use("/governance", governanceRouter);
router.use("/storage", storageRouter);
router.use("/templates", templatesRouter);
router.use("/agreements", generationsRouter);
router.use("/documents", documentsRouter);
router.use("/contributions", contributionsRouter);
router.use("/ownership", ownershipRouter);
router.use("/ownership-transfers", ownershipTransfersRouter);
router.use("/expenditures", expendituresRouter);
router.use("/expenditures", expenditureVerificationRouter);
router.use("/burden", burdenRouter);
router.use("/burden", burdenImbalancesRouter);
router.use("/advances", advancesRouter);
router.use("/lca", lcaRouter);
router.use("/landowner-account", landownerAccountRouter);
router.use("/burden-recovery", burdenRecoveryRouter);
router.use("/analytics", analyticsRouter);
router.use("/financial-access-logs", financialAuditLogRouter);
router.use("/production-log", productionLogRouter);
router.use("/inventory-stock", inventoryStockRouter);
router.use("/buyers", buyersRouter);
router.use("/sales", salesAuditRouter);
router.use("/sales", salesRouter);
router.use("/tasks", tasksRouter);
router.use("/operational-alerts", operationalAlertsRouter);
router.use("/operational-access-logs", operationalAccessLogsRouter);
router.use("/distribution-previews", distributionPreviewsRouter);
router.use("/fifty-pct", fiftyPctRouter);
router.use("/payable", payableRouter);
router.use("/loss-absorption", lossAbsorptionRouter);
router.use("/settlement", settlementOverridesRouter);
router.use("/distribution-records", distributionRecordsRouter);
router.use("/settlement-governance", settlementGovernanceRouter);
router.use("/financial-analytics", financialAnalyticsRouter);
router.use("/valuations", valuationsRouter);
router.use("/inheritance-claims", inheritanceRouter);
router.use("/nominee-succession", nomineeSuccessionRouter);
router.use("/prematurity-succession", prematuritySuccessionRouter);
router.use("/notifications", notificationsRouter);
router.use("/reports", reportsRouter);
router.use("/governance-meetings", governanceMeetingsRouter);
router.use("/backup", backupRouter);
router.use("/multi-store", multiStoreRouter);

export default router;
