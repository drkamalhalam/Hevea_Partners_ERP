import { Router } from "express";
import { db, projectsTable, partnersTable, agreementsTable, activityTable } from "@workspace/db";
import { count, sum } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router = Router();

router.get("/summary", async (req, res) => {
  try {
    const [projectCount] = await db.select({ count: count() }).from(projectsTable);
    const [partnerCount] = await db.select({ count: count() }).from(partnersTable);
    const [agreementCount] = await db.select({ count: count() }).from(agreementsTable);
    const projects = await db.select().from(projectsTable);
    const totalLandArea = projects.reduce((sum, p) => sum + (p.landArea || 0), 0);
    const activeCount = projects.filter(p => p.status === "developing").length;
    const maturingCount = projects.filter(p => p.status === "maturing").length;
    const tappingCount = projects.filter(p => p.status === "tapping").length;

    res.json({
      totalProjects: projectCount.count,
      totalPartners: partnerCount.count,
      totalAgreements: agreementCount.count,
      totalLandArea,
      activeProjectsCount: activeCount,
      maturingProjectsCount: maturingCount,
      tappingProjectsCount: tappingCount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/my-portfolio", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    let partner = null;
    if (userId) {
      const partners = await db.select().from(partnersTable);
      partner = partners.find(p => p.clerkUserId === userId) ?? null;
    }

    const agreements = await db.select().from(agreementsTable);
    const projects = await db.select().from(projectsTable);

    let myAgreements = agreements;
    if (partner) {
      myAgreements = agreements.filter(a => a.landOwnerId === partner!.id || a.projectDeveloperId === partner!.id);
    }

    const enriched = await Promise.all(myAgreements.map(async (a) => {
      const project = projects.find(p => p.id === a.projectId);
      const partners = await db.select().from(partnersTable);
      const landOwner = partners.find(p => p.id === a.landOwnerId);
      const developer = partners.find(p => p.id === a.projectDeveloperId);
      return {
        ...a,
        projectName: project?.name ?? "Unknown",
        landOwnerName: landOwner?.name ?? "Unknown",
        projectDeveloperName: developer?.name ?? "Unknown",
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt?.toISOString() ?? null,
      };
    }));

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

router.get("/activity", async (req, res) => {
  try {
    const activities = await db.select().from(activityTable)
      .orderBy(activityTable.createdAt)
      .limit(20);
    res.json(activities.map(a => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })).reverse());
  } catch (err) {
    req.log.error({ err }, "Failed to get activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/revenue", async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable);
    const agreements = await db.select().from(agreementsTable);
    const currentYear = new Date().getFullYear();

    const stats = projects.map(p => {
      const projectAgreements = agreements.filter(a => a.projectId === p.id);
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
