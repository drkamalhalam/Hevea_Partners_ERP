import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import partnersRouter from "./partners";
import agreementsRouter from "./agreements";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/projects", projectsRouter);
router.use("/partners", partnersRouter);
router.use("/agreements", agreementsRouter);
router.use("/dashboard", dashboardRouter);

export default router;
