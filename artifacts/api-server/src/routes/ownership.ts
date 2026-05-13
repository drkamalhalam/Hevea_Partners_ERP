import { Router } from "express";
import {
  db,
  projectsTable,
  contributionsTable,
  ownershipSnapshotsTable,
  usersTable,
  userProjectAssignmentsTable,
  projectOwnershipFreezesTable,
} from "@workspace/db";
import {
  eq,
  and,
  inArray,
  isNull,
  desc,
} from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import type { OwnershipSnapshotEntry } from "@workspace/db";

const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OwnershipPartnerEntry {
  partnerKey: string;
  partnerId: string | null;
  partnerName: string;
  landAmount: number;
  economicAmount: number;
  totalAmount: number;
  percentage: number;
}

export interface ProjectOwnershipDetail {
  projectId: string;
  projectName: string;
  lifecycleStatus: string;
  totalRecognizedAmount: number;
  landTotal: number;
  economicTotal: number;
  entries: OwnershipPartnerEntry[];
  partnerCount: number;
  asOf: string;
  isLive: true;
  isFrozen: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function resolveActingUser(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(
      and(
        eq(userProjectAssignmentsTable.userId, userId),
        isNull(userProjectAssignmentsTable.revokedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}

/**
 * Core calculation engine.
 * Groups verified land_notional + economic_investment contributions by partner
 * and computes ownership percentages.
 *
 * Partner identity: uses partnerId (UUID) as the grouping key when available,
 * otherwise falls back to partnerName.  This ensures linked partners are always
 * grouped correctly even across different contribution records.
 */
async function computeOwnership(projectId: string): Promise<{
  entries: OwnershipPartnerEntry[];
  landTotal: number;
  economicTotal: number;
  totalRecognizedAmount: number;
}> {
  const rows = await db
    .select({
      partnerId: contributionsTable.partnerId,
      partnerName: contributionsTable.partnerName,
      contributionType: contributionsTable.contributionType,
      amount: contributionsTable.amount,
    })
    .from(contributionsTable)
    .where(
      and(
        eq(contributionsTable.projectId, projectId),
        inArray(contributionsTable.contributionType, [
          "land_notional",
          "economic_investment",
        ]),
        eq(contributionsTable.verificationStatus, "verified"),
        eq(contributionsTable.affectsOwnership, true),
        isNull(contributionsTable.deletedAt),
      ),
    );

  // Aggregate by partnerKey (partnerId if available, else partnerName)
  const map = new Map<
    string,
    { partnerId: string | null; partnerName: string; land: number; economic: number }
  >();

  for (const row of rows) {
    const key = row.partnerId ?? row.partnerName;
    const existing = map.get(key);
    const add = row.amount ?? 0;
    if (existing) {
      if (row.contributionType === "land_notional") existing.land += add;
      else existing.economic += add;
    } else {
      map.set(key, {
        partnerId: row.partnerId ?? null,
        partnerName: row.partnerName,
        land: row.contributionType === "land_notional" ? add : 0,
        economic: row.contributionType === "economic_investment" ? add : 0,
      });
    }
  }

  let landTotal = 0;
  let economicTotal = 0;
  for (const v of map.values()) {
    landTotal += v.land;
    economicTotal += v.economic;
  }
  const totalRecognizedAmount = landTotal + economicTotal;

  const entries: OwnershipPartnerEntry[] = [];
  for (const [key, v] of map.entries()) {
    const total = v.land + v.economic;
    entries.push({
      partnerKey: key,
      partnerId: v.partnerId,
      partnerName: v.partnerName,
      landAmount: Math.round(v.land * 100) / 100,
      economicAmount: Math.round(v.economic * 100) / 100,
      totalAmount: Math.round(total * 100) / 100,
      percentage:
        totalRecognizedAmount > 0
          ? Math.round((total / totalRecognizedAmount) * 10000) / 100
          : 0,
    });
  }

  // Sort by percentage descending
  entries.sort((a, b) => b.percentage - a.percentage);

  return { entries, landTotal, economicTotal, totalRecognizedAmount };
}

/** Returns true if this project has had its ownership frozen via the maturity workflow. */
async function isOwnershipFrozen(projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: projectOwnershipFreezesTable.id })
    .from(projectOwnershipFreezesTable)
    .where(eq(projectOwnershipFreezesTable.projectId, projectId))
    .limit(1);
  return rows.length > 0;
}

function formatDetail(
  project: { id: string; name: string; lifecycleStatus: string },
  computed: { entries: OwnershipPartnerEntry[]; landTotal: number; economicTotal: number; totalRecognizedAmount: number },
  frozen: boolean,
): ProjectOwnershipDetail {
  return {
    projectId: project.id,
    projectName: project.name,
    lifecycleStatus: project.lifecycleStatus,
    totalRecognizedAmount: computed.totalRecognizedAmount,
    landTotal: computed.landTotal,
    economicTotal: computed.economicTotal,
    entries: computed.entries,
    partnerCount: computed.entries.length,
    asOf: new Date().toISOString(),
    isLive: true,
    isFrozen: frozen,
  };
}

// ── GET /ownership/summary ─────────────────────────────────────────────────────
// Returns live ownership guidance for all visible projects (or a single project
// if ?projectId= is supplied).

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const filterProjectId =
    typeof req.query.projectId === "string" ? req.query.projectId : null;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({ projects: [] });
    }
  }

  if (filterProjectId) {
    if (visibleProjectIds !== null && !visibleProjectIds.includes(filterProjectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    visibleProjectIds = [filterProjectId];
  }

  const projectRows = visibleProjectIds
    ? await db
        .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
        .from(projectsTable)
        .where(and(inArray(projectsTable.id, visibleProjectIds), eq(projectsTable.isActive, true)))
    : await db
        .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
        .from(projectsTable)
        .where(eq(projectsTable.isActive, true));

  const results: ProjectOwnershipDetail[] = await Promise.all(
    projectRows.map(async (proj) => {
      const [computed, frozen] = await Promise.all([
        computeOwnership(proj.id),
        isOwnershipFrozen(proj.id),
      ]);
      return formatDetail(proj, computed, frozen);
    }),
  );

  // Sort by name
  results.sort((a, b) => a.projectName.localeCompare(b.projectName));

  return res.json({ projects: results });
});

// ── GET /ownership/:projectId ──────────────────────────────────────────────────

router.get("/:projectId", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const projectId = String(req.params.projectId);

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.isActive, true)))
    .limit(1);

  if (!project) return res.status(404).json({ error: "Project not found" });

  const [computed, frozen] = await Promise.all([
    computeOwnership(projectId),
    isOwnershipFrozen(projectId),
  ]);

  return res.json(formatDetail(project, computed, frozen));
});

// ── GET /ownership/:projectId/snapshots ───────────────────────────────────────

router.get("/:projectId/snapshots", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const projectId = String(req.params.projectId);

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const [projectRow] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!projectRow) return res.status(404).json({ error: "Project not found" });

  const snapshots = await db
    .select()
    .from(ownershipSnapshotsTable)
    .where(eq(ownershipSnapshotsTable.projectId, projectId))
    .orderBy(desc(ownershipSnapshotsTable.snapshotAt))
    .limit(limit);

  const totalCount = snapshots.length; // simplified; full count not needed for MVP

  return res.json({
    snapshots: snapshots.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      snapshotType: s.snapshotType,
      lifecycleStatus: s.lifecycleStatus,
      totalRecognizedAmount: s.totalRecognizedAmount,
      landTotal: s.landTotal,
      economicTotal: s.economicTotal,
      entries: s.entries,
      notes: s.notes,
      triggeredByName: s.triggeredByName,
      snapshotAt: s.snapshotAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
    totalCount,
  });
});

// ── POST /ownership/:projectId/snapshots ──────────────────────────────────────
// Admin/developer only. Saves a manual snapshot of the current live calculation.

router.post(
  "/:projectId/snapshots",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const projectId = String(req.params.projectId);

    const [project] = await db
      .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.isActive, true)))
      .limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const computed = await computeOwnership(projectId);

    const b = req.body as Record<string, unknown>;
    const [snap] = await db
      .insert(ownershipSnapshotsTable)
      .values({
        projectId,
        snapshotType: "manual",
        lifecycleStatus: project.lifecycleStatus,
        totalRecognizedAmount: computed.totalRecognizedAmount,
        landTotal: computed.landTotal,
        economicTotal: computed.economicTotal,
        entries: computed.entries as OwnershipSnapshotEntry[],
        notes: typeof b.notes === "string" ? b.notes : null,
        triggeredBy: actor.id,
        triggeredByName: actor.displayName,
      })
      .returning();

    return res.status(201).json({
      id: snap.id,
      projectId: snap.projectId,
      snapshotType: snap.snapshotType,
      lifecycleStatus: snap.lifecycleStatus,
      totalRecognizedAmount: snap.totalRecognizedAmount,
      landTotal: snap.landTotal,
      economicTotal: snap.economicTotal,
      entries: snap.entries,
      notes: snap.notes,
      triggeredByName: snap.triggeredByName,
      snapshotAt: snap.snapshotAt.toISOString(),
      createdAt: snap.createdAt.toISOString(),
    });
  },
);

export default router;
