import { Router } from "express";
import {
  db,
  projectsTable,
  partnersTable,
  agreementsTable,
  activityTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { canAccessProject } from "../middlewares/auth";

const router = Router();

// GET /dashboard/summary — KPI counts, filtered by project access
router.get("/summary", async (req, res) => {
  try {
    const allProjects = await db.select().from(projectsTable);
    const projects = req.canAccessAllProjects
      ? allProjects
      : allProjects.filter((p) => canAccessProject(req, p.id));

    const accessibleIds = new Set(projects.map((p) => p.id));

    const allAgreements = await db.select().from(agreementsTable);
    const agreements = req.canAccessAllProjects
      ? allAgreements
      : allAgreements.filter((a) => accessibleIds.has(a.projectId));

    const totalPartners = (await db.select().from(partnersTable)).length;
    const totalLandArea = projects.reduce((s, p) => s + (p.landArea || 0), 0);

    res.json({
      totalProjects: projects.length,
      totalPartners,
      totalAgreements: agreements.length,
      totalLandArea,
      activeProjectsCount: projects.filter((p) => p.status === "developing").length,
      maturingProjectsCount: projects.filter((p) => p.status === "maturing").length,
      tappingProjectsCount: projects.filter((p) => p.status === "tapping").length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /dashboard/my-portfolio — agreements linked to the logged-in user's partner record
router.get("/my-portfolio", async (req, res) => {
  try {
    const allPartners = await db.select().from(partnersTable);
    const partner = req.userId
      ? (allPartners.find((p) => p.clerkUserId === req.userId) ?? null)
      : null;

    const allAgreements = await db.select().from(agreementsTable);
    const allProjects = await db.select().from(projectsTable);

    let myAgreements = partner
      ? allAgreements.filter(
          (a) => a.landOwnerId === partner.id || a.projectDeveloperId === partner.id,
        )
      : req.canAccessAllProjects
        ? allAgreements
        : allAgreements.filter((a) => canAccessProject(req, a.projectId));

    const enriched = myAgreements.map((a) => {
      const project = allProjects.find((p) => p.id === a.projectId);
      const landOwner = allPartners.find((p) => p.id === a.landOwnerId);
      const developer = allPartners.find((p) => p.id === a.projectDeveloperId);
      return {
        ...a,
        projectName: project?.name ?? "Unknown",
        landOwnerName: landOwner?.name ?? "Unknown",
        projectDeveloperName: developer?.name ?? "Unknown",
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt?.toISOString() ?? null,
      };
    });

    const totalLandArea = myAgreements.reduce((s, a) => s + (a.landArea || 0), 0);
    const totalOwnershipShare = myAgreements.reduce((s, a) => {
      if (partner && a.landOwnerId === partner.id) return s + (a.ownershipShareLandowner || 0);
      if (partner && a.projectDeveloperId === partner.id) return s + (a.ownershipShareDeveloper || 0);
      return s;
    }, 0);

    res.json({
      partnerId: partner?.id ?? null,
      partnerName: partner?.name ?? "All Partners",
      role: partner?.role ?? "admin",
      agreements: enriched,
      totalLandArea,
      totalOwnershipShare,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get portfolio");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /dashboard/activity — all authenticated users can see the activity feed
router.get("/activity", async (req, res) => {
  try {
    const activities = await db
      .select()
      .from(activityTable)
      .orderBy(activityTable.createdAt)
      .limit(20);
    res.json(
      activities
        .map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))
        .reverse(),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to get activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /dashboard/revenue — filter by project access
router.get("/revenue", async (req, res) => {
  try {
    const allProjects = await db.select().from(projectsTable);
    const projects = req.canAccessAllProjects
      ? allProjects
      : allProjects.filter((p) => canAccessProject(req, p.id));

    const agreements = await db.select().from(agreementsTable);
    const currentYear = new Date().getFullYear();

    const stats = projects.map((p) => {
      const projectAgreements = agreements.filter((a) => a.projectId === p.id);
      const totalLand = projectAgreements.reduce((s, a) => s + (a.landArea || 0), 0);
      const lca = projectAgreements.reduce((s, a) => s + (a.landContributionAdjustment || 0), 0);
      const estimatedRevenue = totalLand * 12000;
      return {
        projectId: p.id,
        projectName: p.name,
        year: currentYear,
        revenue: Math.round(estimatedRevenue),
        landContributionAdjustment: Math.round(totalLand * lca),
        profit: Math.round(estimatedRevenue * 0.65),
      };
    });

    res.json(stats);
  } catch (err) {
    req.log.error({ err }, "Failed to get revenue stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
