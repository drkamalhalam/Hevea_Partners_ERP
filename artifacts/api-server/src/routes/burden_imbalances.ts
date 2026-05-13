import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  agreementsTable,
  partnersTable,
  burdenRecordsTable,
  imbalanceLedgerTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Shared helpers ─────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

async function resolveActingUser(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── Exported helper: create mirrored pair of ledger entries ───────────────────

/**
 * Creates a mirrored pair of imbalance ledger entries (developer + landowner).
 * Developer and landowner amounts should sum to zero (double-entry accounting).
 *
 * amount > 0 = this party is owed money (credit)
 * amount < 0 = this party owes money (debit)
 */
export async function createImbalanceLedgerPair({
  projectId,
  burdenRecordId,
  entryType,
  developerAmount,
  landownerAmount,
  description,
  period,
  createdById,
  createdByName,
}: {
  projectId: string;
  burdenRecordId: string;
  entryType: string;
  developerAmount: number;
  landownerAmount: number;
  description: string;
  period?: string | null;
  createdById: string | null;
  createdByName: string | null;
}): Promise<void> {
  const now = new Date();
  await db.insert(imbalanceLedgerTable).values([
    {
      projectId,
      partyRole: "developer",
      amount: String(developerAmount),
      entryType,
      burdenRecordId,
      period: period ?? null,
      description,
      createdById: createdById ?? null,
      createdByName: createdByName ?? null,
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId,
      partyRole: "landowner",
      amount: String(landownerAmount),
      entryType,
      burdenRecordId,
      period: period ?? null,
      description,
      createdById: createdById ?? null,
      createdByName: createdByName ?? null,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

// ── GET /burden/imbalances/summary ────────────────────────────────────────────

router.get("/burden/imbalances/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  if (!canAccessAllProjects(actor.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const filterProjectId = req.query.projectId as string | undefined;

  const balRows = await db
    .select({
      projectId: imbalanceLedgerTable.projectId,
      partyRole: imbalanceLedgerTable.partyRole,
      balance: sql<string>`SUM(${imbalanceLedgerTable.amount})`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(imbalanceLedgerTable)
    .where(
      and(
        eq(imbalanceLedgerTable.isActive, true),
        filterProjectId
          ? eq(imbalanceLedgerTable.projectId, filterProjectId)
          : undefined,
      ),
    )
    .groupBy(imbalanceLedgerTable.projectId, imbalanceLedgerTable.partyRole);

  const projectIds = [...new Set(balRows.map((r) => r.projectId))];

  const [projects, agreements] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({ id: projectsTable.id, name: projectsTable.name })
          .from(projectsTable)
          .where(inArray(projectsTable.id, projectIds))
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .select({
            projectId: agreementsTable.projectId,
            landOwnerId: agreementsTable.landOwnerId,
            projectDeveloperId: agreementsTable.projectDeveloperId,
          })
          .from(agreementsTable)
          .where(
            and(
              inArray(agreementsTable.projectId, projectIds),
              eq(agreementsTable.status, "active"),
            ),
          )
      : Promise.resolve([]),
  ]);

  const partnerIds = [
    ...new Set([
      ...(agreements.map((a) => a.landOwnerId).filter(Boolean) as string[]),
      ...(agreements.map((a) => a.projectDeveloperId).filter(Boolean) as string[]),
    ]),
  ];

  const partnerRows =
    partnerIds.length > 0
      ? await db
          .select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, partnerIds))
      : [];

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const partnerMap = new Map(partnerRows.map((p) => [p.id, p.name]));
  const agreementMap = new Map(agreements.map((a) => [a.projectId, a]));

  const projectBalances: Record<
    string,
    {
      projectId: string;
      projectName: string;
      developerBalance: number;
      landownerBalance: number;
      developerPartnerId: string | null;
      developerPartnerName: string | null;
      landownerPartnerId: string | null;
      landownerPartnerName: string | null;
      entryCount: number;
    }
  > = {};

  for (const row of balRows) {
    if (!projectBalances[row.projectId]) {
      const agr = agreementMap.get(row.projectId);
      projectBalances[row.projectId] = {
        projectId: row.projectId,
        projectName: projectMap.get(row.projectId) ?? row.projectId,
        developerBalance: 0,
        landownerBalance: 0,
        developerPartnerId: agr?.projectDeveloperId ?? null,
        developerPartnerName: agr?.projectDeveloperId
          ? (partnerMap.get(agr.projectDeveloperId) ?? null)
          : null,
        landownerPartnerId: agr?.landOwnerId ?? null,
        landownerPartnerName: agr?.landOwnerId
          ? (partnerMap.get(agr.landOwnerId) ?? null)
          : null,
        entryCount: 0,
      };
    }
    const bal = Math.round(Number(row.balance ?? 0) * 100) / 100;
    if (row.partyRole === "developer") {
      projectBalances[row.projectId].developerBalance = bal;
    } else {
      projectBalances[row.projectId].landownerBalance = bal;
    }
    projectBalances[row.projectId].entryCount += row.entryCount;
  }

  const projectList = Object.values(projectBalances);
  const totals = projectList.reduce(
    (acc, p) => {
      acc.totalDeveloperBalance =
        Math.round((acc.totalDeveloperBalance + p.developerBalance) * 100) / 100;
      acc.totalLandownerBalance =
        Math.round((acc.totalLandownerBalance + p.landownerBalance) * 100) / 100;
      if (p.developerBalance < 0 || p.landownerBalance < 0) acc.negativeCount++;
      acc.projectCount++;
      return acc;
    },
    {
      totalDeveloperBalance: 0,
      totalLandownerBalance: 0,
      negativeCount: 0,
      projectCount: 0,
    },
  );

  return res.json({ totals, projects: projectList });
});

// ── GET /burden/imbalances/ledger ─────────────────────────────────────────────

router.get("/burden/imbalances/ledger", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const {
    projectId: filterProjectId,
    partyRole: filterPartyRole,
    entryType: filterEntryType,
  } = req.query as {
    projectId?: string;
    partyRole?: string;
    entryType?: string;
  };

  if (!canAccessAllProjects(actor.role)) {
    if (!filterProjectId) {
      const assigned = await getAssignedProjectIds(actor.id);
      if (assigned.length === 0) return res.json({ entries: [] });
    } else {
      const assigned = await getAssignedProjectIds(actor.id);
      if (!assigned.includes(filterProjectId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
  }

  const conditions = [eq(imbalanceLedgerTable.isActive, true)];
  if (filterProjectId)
    conditions.push(eq(imbalanceLedgerTable.projectId, filterProjectId));
  if (filterPartyRole)
    conditions.push(eq(imbalanceLedgerTable.partyRole, filterPartyRole));
  if (filterEntryType)
    conditions.push(eq(imbalanceLedgerTable.entryType, filterEntryType));

  // Fetch ordered oldest-first for correct running balance accumulation
  const entries = await db
    .select()
    .from(imbalanceLedgerTable)
    .where(and(...conditions))
    .orderBy(
      imbalanceLedgerTable.projectId,
      imbalanceLedgerTable.partyRole,
      imbalanceLedgerTable.createdAt,
    );

  // Compute running balance per (projectId, partyRole) stream
  const runningBalances: Record<string, number> = {};
  const enriched = entries.map((e) => {
    const key = `${e.projectId}::${e.partyRole}`;
    runningBalances[key] = (runningBalances[key] ?? 0);
    runningBalances[key] =
      Math.round((runningBalances[key] + Number(e.amount)) * 100) / 100;
    return {
      id: e.id,
      projectId: e.projectId,
      partyRole: e.partyRole,
      entryType: e.entryType,
      amount: Number(e.amount),
      runningBalance: runningBalances[key],
      isNegativeBalance: runningBalances[key] < 0,
      burdenRecordId: e.burdenRecordId,
      period: e.period,
      description: e.description,
      notes: e.notes,
      createdById: e.createdById,
      createdByName: e.createdByName,
      createdAt: e.createdAt,
    };
  });

  // Reverse for newest-first display
  return res.json({ entries: enriched.reverse() });
});

// ── GET /burden/imbalances/partner-summary ────────────────────────────────────

router.get(
  "/burden/imbalances/partner-summary",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const balanceRows = await db
      .select({
        projectId: imbalanceLedgerTable.projectId,
        partyRole: imbalanceLedgerTable.partyRole,
        balance: sql<string>`SUM(${imbalanceLedgerTable.amount})`,
      })
      .from(imbalanceLedgerTable)
      .where(eq(imbalanceLedgerTable.isActive, true))
      .groupBy(imbalanceLedgerTable.projectId, imbalanceLedgerTable.partyRole);

    const projectIds = [...new Set(balanceRows.map((r) => r.projectId))];
    if (projectIds.length === 0) return res.json({ partners: [] });

    const [agreements, projects] = await Promise.all([
      db
        .select({
          projectId: agreementsTable.projectId,
          landOwnerId: agreementsTable.landOwnerId,
          projectDeveloperId: agreementsTable.projectDeveloperId,
        })
        .from(agreementsTable)
        .where(
          and(
            inArray(agreementsTable.projectId, projectIds),
            eq(agreementsTable.status, "active"),
          ),
        ),
      db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(inArray(projectsTable.id, projectIds)),
    ]);

    const partnerIds = [
      ...new Set([
        ...(agreements.map((a) => a.landOwnerId).filter(Boolean) as string[]),
        ...(agreements.map((a) => a.projectDeveloperId).filter(Boolean) as string[]),
      ]),
    ];

    const partnerRows =
      partnerIds.length > 0
        ? await db
            .select({ id: partnersTable.id, name: partnersTable.name })
            .from(partnersTable)
            .where(inArray(partnersTable.id, partnerIds))
        : [];

    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const partnerNameMap = new Map(partnerRows.map((p) => [p.id, p.name]));
    const agreementByProject = new Map(agreements.map((a) => [a.projectId, a]));

    const partnerSummary: Record<
      string,
      {
        partnerId: string;
        partnerName: string;
        roles: Set<string>;
        totalBalance: number;
        projects: Array<{
          projectId: string;
          projectName: string;
          role: string;
          balance: number;
          isNegative: boolean;
        }>;
      }
    > = {};

    for (const row of balanceRows) {
      const agr = agreementByProject.get(row.projectId);
      if (!agr) continue;

      const partnerId =
        row.partyRole === "developer"
          ? agr.projectDeveloperId
          : agr.landOwnerId;
      if (!partnerId) continue;

      if (!partnerSummary[partnerId]) {
        partnerSummary[partnerId] = {
          partnerId,
          partnerName: partnerNameMap.get(partnerId) ?? partnerId,
          roles: new Set(),
          totalBalance: 0,
          projects: [],
        };
      }

      const bal = Math.round(Number(row.balance ?? 0) * 100) / 100;
      partnerSummary[partnerId].totalBalance =
        Math.round((partnerSummary[partnerId].totalBalance + bal) * 100) / 100;
      partnerSummary[partnerId].roles.add(row.partyRole);
      partnerSummary[partnerId].projects.push({
        projectId: row.projectId,
        projectName: projectMap.get(row.projectId) ?? row.projectId,
        role: row.partyRole,
        balance: bal,
        isNegative: bal < 0,
      });
    }

    const result = Object.values(partnerSummary).map((p) => ({
      partnerId: p.partnerId,
      partnerName: p.partnerName,
      roles: [...p.roles],
      totalBalance: p.totalBalance,
      isNegative: p.totalBalance < 0,
      projects: p.projects,
    }));

    return res.json({ partners: result });
  },
);

// ── POST /burden/imbalances/entries ───────────────────────────────────────────

router.post(
  "/burden/imbalances/entries",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const { projectId, developerAmount, landownerAmount, description, notes, period } =
      req.body as {
        projectId?: string;
        developerAmount?: number;
        landownerAmount?: number;
        description?: string;
        notes?: string;
        period?: string;
      };

    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });
    if (typeof developerAmount !== "number")
      return res
        .status(400)
        .json({ error: "developerAmount (signed number) is required" });
    if (typeof landownerAmount !== "number")
      return res
        .status(400)
        .json({ error: "landownerAmount (signed number) is required" });
    if (!description?.trim())
      return res.status(400).json({ error: "description is required" });

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const now = new Date();
    const inserted = await db
      .insert(imbalanceLedgerTable)
      .values([
        {
          projectId,
          partyRole: "developer",
          amount: String(developerAmount),
          entryType: "manual",
          period: period ?? null,
          description: description.trim(),
          notes: notes ?? null,
          createdById: actor.id,
          createdByName: actor.displayName ?? null,
          createdAt: now,
          updatedAt: now,
        },
        {
          projectId,
          partyRole: "landowner",
          amount: String(landownerAmount),
          entryType: "manual",
          period: period ?? null,
          description: description.trim(),
          notes: notes ?? null,
          createdById: actor.id,
          createdByName: actor.displayName ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning();

    req.log.info(
      { projectId, developerAmount, landownerAmount },
      "Manual imbalance ledger entry created",
    );
    return res.status(201).json({
      entries: inserted.map((e) => ({ ...e, amount: Number(e.amount) })),
    });
  },
);

// ── POST /burden/imbalances/seed ──────────────────────────────────────────────

router.post(
  "/burden/imbalances/seed",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    // Fetch all imbalanced burden records
    const burdenRecords = await db
      .select()
      .from(burdenRecordsTable)
      .where(
        and(
          eq(burdenRecordsTable.isActive, true),
          sql`${burdenRecordsTable.adjustmentStatus} IN ('developer_advance', 'landowner_advance')`,
        ),
      );

    if (burdenRecords.length === 0) {
      return res.json({
        seeded: 0,
        skipped: 0,
        message: "No imbalanced burden records found",
      });
    }

    // Find already-seeded records
    const recordIds = burdenRecords.map((r) => r.id);
    const existing = await db
      .select({ burdenRecordId: imbalanceLedgerTable.burdenRecordId })
      .from(imbalanceLedgerTable)
      .where(
        and(
          inArray(imbalanceLedgerTable.burdenRecordId, recordIds),
          eq(imbalanceLedgerTable.entryType, "burden_imbalance"),
          eq(imbalanceLedgerTable.isActive, true),
        ),
      );

    const alreadySeeded = new Set(existing.map((e) => e.burdenRecordId));
    const toSeed = burdenRecords.filter((r) => !alreadySeeded.has(r.id));

    let seeded = 0;
    for (const r of toSeed) {
      const isDevAdvance = r.adjustmentStatus === "developer_advance";
      const remaining =
        Math.round(
          (Number(r.recoverableAmount) - Number(r.recoveredAmount)) * 100,
        ) / 100;
      if (remaining <= 0 || !r.projectId) continue;

      await createImbalanceLedgerPair({
        projectId: r.projectId,
        burdenRecordId: r.id,
        entryType: "burden_imbalance",
        developerAmount: isDevAdvance ? remaining : -remaining,
        landownerAmount: isDevAdvance ? -remaining : remaining,
        description: "Seeded: burden imbalance from expenditure record",
        period: r.createdAt
          ? new Date(r.createdAt).toISOString().slice(0, 7)
          : null,
        createdById: actor.id,
        createdByName: actor.displayName ?? null,
      });
      seeded++;
    }

    req.log.info(
      { seeded, skipped: alreadySeeded.size },
      "Burden imbalance ledger seeded",
    );
    return res.json({
      seeded,
      skipped: alreadySeeded.size,
      message: `Seeded ${seeded} records, skipped ${alreadySeeded.size} already-seeded records`,
    });
  },
);

export default router;
