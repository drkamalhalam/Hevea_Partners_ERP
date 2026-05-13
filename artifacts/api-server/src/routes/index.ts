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
import expendituresRouter from "./expenditures";
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
router.use("/expenditures", expendituresRouter);

export default router;
