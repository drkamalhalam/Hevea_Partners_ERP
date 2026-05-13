import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import usersRouter from "./users";
import projectsRouter from "./projects";
import partnersRouter from "./partners";
import agreementsRouter from "./agreements";
import dashboardRouter from "./dashboard";
import productionRouter from "./production";
import stockRouter from "./stock";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/me", meRouter);
router.use("/users", usersRouter);
router.use("/projects", projectsRouter);
router.use("/partners", partnersRouter);
router.use("/agreements", agreementsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/production", productionRouter);
router.use("/stock", stockRouter);

export default router;
