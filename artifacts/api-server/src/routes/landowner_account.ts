import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, isNull, asc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  partnersTable,
  landownerLedgerTable,
  lcaLedgerTable,
  lcaConfigsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
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

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

type LedgerRow = typeof landownerLedgerTable.$inferSelect & {
  projectName?: string | null;
  partnerName?: string | null;
};

function formatEntry(row: LedgerRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    partnerId: row.partnerId,
    partnerName: row.partnerName ?? undefined,
    entryType: row.entryType,
    direction: row.direction,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    description: row.description,
    amount: Number(row.amount),
    grossRevenue: row.grossRevenue != null ? Number(row.grossRevenue) : undefined,
    ownershipPct: row.ownershipPct != null ? Number(row.ownershipPct) : undefined,
    revenueModelType: row.revenueModelType ?? undefined,
    isRecoverable: row.isRecoverable,
    recoveredAmount: Number(row.recoveredAmount),
    recoveryStatus: row.recoveryStatus,
    status: row.status,
    notes: row.notes ?? undefined,
    recordedById: row.recordedById ?? undefined,
    recordedByName: row.recordedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /landowner-account/summary ────────────────────────────────────────────
// Aggregate net position for a (partner, project) or all visible entries.

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, partnerId } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const confirmedEntries = await db
    .select({
      row: landownerLedgerTable,
      projectName: projectsTable.name,
      partnerName: partnersTable.name,
    })
    .from(landownerLedgerTable)
    .leftJoin(projectsTable, eq(landownerLedgerTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(landownerLedgerTable.partnerId, partnersTable.id))
    .where(
      and(
        eq(landownerLedgerTable.status, "confirmed"),
        projectId ? eq(landownerLedgerTable.projectId, projectId) : undefined,
        partnerId ? eq(landownerLedgerTable.partnerId, partnerId) : undefined,
        visibleProjectIds
          ? inArray(
              landownerLedgerTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    );

  let revenueEntitlement = 0;
  let operationalBurden = 0;
  let recoverableAdjCredit = 0;
  let recoverableAdjDebit = 0;
  let otherCredit = 0;
  let otherDebit = 0;

  for (const { row } of confirmedEntries) {
    const amt = Number(row.amount);
    const isCredit = row.direction === "credit";

    switch (row.entryType) {
      case "revenue_entitlement":
        revenueEntitlement += amt;
        break;
      case "operational_burden":
        operationalBurden += amt;
        break;
      case "recoverable_adjustment":
        if (isCredit) recoverableAdjCredit += amt;
        else recoverableAdjDebit += amt;
        break;
      default:
        if (isCredit) otherCredit += amt;
        else otherDebit += amt;
    }
  }

  // LCA receivable: sum of outstanding balances in lca_ledger for visible projects
  const lcaWhere = and(
    eq(lcaLedgerTable.isActive, true),
    projectId ? eq(lcaLedgerTable.projectId, projectId) : undefined,
    visibleProjectIds
      ? inArray(
          lcaLedgerTable.projectId,
          visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
        )
      : undefined,
  );

  const lcaRows = await db
    .select({ balance: lcaLedgerTable.balance, status: lcaLedgerTable.status })
    .from(lcaLedgerTable)
    .where(lcaWhere);

  const lcaReceivable = lcaRows.reduce((s, r) => {
    if (r.status !== "paid" && r.status !== "waived") {
      return s + Math.max(0, Number(r.balance));
    }
    return s;
  }, 0);

  const recoverableNet = recoverableAdjCredit - recoverableAdjDebit;
  const netPosition =
    revenueEntitlement -
    operationalBurden +
    recoverableNet +
    otherCredit -
    otherDebit +
    lcaReceivable;

  const round = (n: number) => Math.round(n * 100) / 100;

  return res.json({
    revenueEntitlement: round(revenueEntitlement),
    operationalBurden: round(operationalBurden),
    recoverableAdjCredit: round(recoverableAdjCredit),
    recoverableAdjDebit: round(recoverableAdjDebit),
    recoverableNet: round(recoverableNet),
    otherCredit: round(otherCredit),
    otherDebit: round(otherDebit),
    lcaReceivable: round(lcaReceivable),
    netPosition: round(netPosition),
    entryCount: confirmedEntries.length,
    lcaEntryCount: lcaRows.filter(
      (r) => r.status !== "paid" && r.status !== "waived",
    ).length,
  });
});

// ── GET /landowner-account/entries ────────────────────────────────────────────

router.get("/entries", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, partnerId, entryType, status } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const rows = await db
    .select({
      row: landownerLedgerTable,
      projectName: projectsTable.name,
      partnerName: partnersTable.name,
    })
    .from(landownerLedgerTable)
    .leftJoin(projectsTable, eq(landownerLedgerTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(landownerLedgerTable.partnerId, partnersTable.id))
    .where(
      and(
        projectId ? eq(landownerLedgerTable.projectId, projectId) : undefined,
        partnerId ? eq(landownerLedgerTable.partnerId, partnerId) : undefined,
        entryType ? eq(landownerLedgerTable.entryType, entryType) : undefined,
        status ? eq(landownerLedgerTable.status, status) : undefined,
        visibleProjectIds
          ? inArray(
              landownerLedgerTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .orderBy(desc(landownerLedgerTable.createdAt));

  return res.json(
    rows.map(({ row, projectName, partnerName }) =>
      formatEntry({ ...row, projectName, partnerName }),
    ),
  );
});

// ── POST /landowner-account/entries ───────────────────────────────────────────

router.post(
  "/entries",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const body = req.body as {
      projectId: string;
      partnerId: string;
      entryType: string;
      direction: string;
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      description: string;
      amount: number;
      grossRevenue?: number;
      ownershipPct?: number;
      revenueModelType?: string;
      isRecoverable?: boolean;
      notes?: string;
    };

    const VALID_TYPES = [
      "revenue_entitlement",
      "operational_burden",
      "recoverable_adjustment",
      "lca_credit",
      "other_credit",
      "other_debit",
    ];
    const VALID_DIRECTIONS = ["credit", "debit"];

    if (!VALID_TYPES.includes(body.entryType)) {
      return res.status(400).json({ error: `Invalid entryType: ${body.entryType}` });
    }
    if (!VALID_DIRECTIONS.includes(body.direction)) {
      return res.status(400).json({ error: `Invalid direction: ${body.direction}` });
    }
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (!body.projectId || !body.partnerId) {
      return res.status(400).json({ error: "projectId and partnerId are required" });
    }
    if (!body.periodLabel || !body.periodStart || !body.periodEnd || !body.description) {
      return res.status(400).json({ error: "periodLabel, periodStart, periodEnd, and description are required" });
    }

    const [project] = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, body.projectId))
      .limit(1);
    if (!project) return res.status(400).json({ error: "Project not found" });

    const [partner] = await db
      .select({ id: partnersTable.id, name: partnersTable.name })
      .from(partnersTable)
      .where(eq(partnersTable.id, body.partnerId))
      .limit(1);
    if (!partner) return res.status(400).json({ error: "Partner not found" });

    const [created] = await db
      .insert(landownerLedgerTable)
      .values({
        projectId: body.projectId,
        partnerId: body.partnerId,
        entryType: body.entryType,
        direction: body.direction,
        periodLabel: body.periodLabel,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        description: body.description,
        amount: body.amount,
        grossRevenue: body.grossRevenue ?? null,
        ownershipPct: body.ownershipPct ?? null,
        revenueModelType: body.revenueModelType ?? null,
        isRecoverable: body.isRecoverable ?? false,
        recoveredAmount: 0,
        recoveryStatus: "none",
        status: "draft",
        notes: body.notes ?? null,
        recordedById: actor.id,
        recordedByName: actor.displayName ?? actor.email ?? "Unknown",
      })
      .returning();

    return res.status(201).json(
      formatEntry({ ...created, projectName: project.name, partnerName: partner.name }),
    );
  },
);

// ── PATCH /landowner-account/entries/:id ──────────────────────────────────────

router.patch(
  "/entries/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const [entry] = await db
      .select()
      .from(landownerLedgerTable)
      .where(eq(landownerLedgerTable.id, String(req.params.id)))
      .limit(1);
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (entry.status === "reversed") {
      return res.status(400).json({ error: "Cannot modify a reversed entry" });
    }

    const body = req.body as {
      description?: string;
      amount?: number;
      grossRevenue?: number | null;
      ownershipPct?: number | null;
      revenueModelType?: string | null;
      periodLabel?: string;
      periodStart?: string;
      periodEnd?: string;
      isRecoverable?: boolean;
      recoveredAmount?: number;
      recoveryStatus?: string;
      status?: string;
      notes?: string | null;
    };

    const VALID_STATUSES = ["draft", "confirmed", "disputed", "reversed"];
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `Invalid status: ${body.status}` });
    }
    if (body.amount !== undefined && (typeof body.amount !== "number" || body.amount <= 0)) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const [updated] = await db
      .update(landownerLedgerTable)
      .set({
        ...(body.description !== undefined && { description: body.description }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.grossRevenue !== undefined && { grossRevenue: body.grossRevenue }),
        ...(body.ownershipPct !== undefined && { ownershipPct: body.ownershipPct }),
        ...(body.revenueModelType !== undefined && { revenueModelType: body.revenueModelType }),
        ...(body.periodLabel !== undefined && { periodLabel: body.periodLabel }),
        ...(body.periodStart !== undefined && { periodStart: body.periodStart }),
        ...(body.periodEnd !== undefined && { periodEnd: body.periodEnd }),
        ...(body.isRecoverable !== undefined && { isRecoverable: body.isRecoverable }),
        ...(body.recoveredAmount !== undefined && { recoveredAmount: body.recoveredAmount }),
        ...(body.recoveryStatus !== undefined && { recoveryStatus: body.recoveryStatus }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
        updatedAt: new Date(),
      })
      .where(eq(landownerLedgerTable.id, entry.id))
      .returning();

    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);
    const [partner] = await db
      .select({ name: partnersTable.name })
      .from(partnersTable)
      .where(eq(partnersTable.id, updated.partnerId))
      .limit(1);

    return res.json(
      formatEntry({
        ...updated,
        projectName: project?.name,
        partnerName: partner?.name,
      }),
    );
  },
);

// ── DELETE /landowner-account/entries/:id (soft-reverse, admin only) ──────────

router.delete(
  "/entries/:id",
  requireRole("admin"),
  async (req, res) => {
    const [entry] = await db
      .select()
      .from(landownerLedgerTable)
      .where(eq(landownerLedgerTable.id, String(req.params.id)))
      .limit(1);
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    if (entry.status === "reversed") {
      return res.status(400).json({ error: "Entry is already reversed" });
    }

    await db
      .update(landownerLedgerTable)
      .set({ status: "reversed", updatedAt: new Date() })
      .where(eq(landownerLedgerTable.id, entry.id));

    return res.json({ success: true });
  },
);

// ── GET /landowner-account/lca-receivable ─────────────────────────────────────
// Returns outstanding LCA receivable from lca_ledger for visible projects.

router.get("/lca-receivable", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId } = req.query as Record<string, string>;

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
  }

  const rows = await db
    .select({
      entry: lcaLedgerTable,
      projectName: projectsTable.name,
      configBaseAmount: lcaConfigsTable.baseAmount,
      configEscalationPct: lcaConfigsTable.escalationPct,
    })
    .from(lcaLedgerTable)
    .leftJoin(projectsTable, eq(lcaLedgerTable.projectId, projectsTable.id))
    .leftJoin(lcaConfigsTable, eq(lcaLedgerTable.configId, lcaConfigsTable.id))
    .where(
      and(
        eq(lcaLedgerTable.isActive, true),
        projectId ? eq(lcaLedgerTable.projectId, projectId) : undefined,
        visibleProjectIds
          ? inArray(
              lcaLedgerTable.projectId,
              visibleProjectIds.length > 0 ? visibleProjectIds : ["__none__"],
            )
          : undefined,
      ),
    )
    .orderBy(asc(lcaLedgerTable.year));

  const items = rows.map(({ entry, projectName, configBaseAmount, configEscalationPct }) => ({
    id: entry.id,
    projectId: entry.projectId,
    projectName: projectName ?? undefined,
    year: entry.year,
    grossDue: Number(entry.grossDue),
    carryForward: Number(entry.carryForward),
    totalDue: Number(entry.totalDue),
    amountPaid: Number(entry.amountPaid),
    balance: Number(entry.balance),
    status: entry.status,
    baseAmount: configBaseAmount != null ? Number(configBaseAmount) : undefined,
    escalationPct: configEscalationPct != null ? Number(configEscalationPct) : undefined,
  }));

  const outstanding = items.filter(
    (r) => r.status !== "paid" && r.status !== "waived",
  );
  const totalReceivable = outstanding.reduce((s, r) => s + r.balance, 0);
  const totalPaid = items.reduce((s, r) => s + r.amountPaid, 0);
  const totalDue = items.reduce((s, r) => s + r.totalDue, 0);

  return res.json({
    totalReceivable: Math.round(totalReceivable * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalDue: Math.round(totalDue * 100) / 100,
    outstandingCount: outstanding.length,
    entries: items,
  });
});

export default router;
