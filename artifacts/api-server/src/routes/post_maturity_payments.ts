import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, isNull, inArray, desc, sql } from "drizzle-orm";
import {
  db,
  postMaturityCostPaymentsTable,
  projectsTable,
  partnersTable,
  usersTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { toNum } from "../lib/numericSafe.js";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  "operational_funding",
  "maintenance_support",
  "emergency_expense",
  "project_settlement",
  "other",
] as const;
type PaymentCategory = (typeof VALID_CATEGORIES)[number];

const VALID_STATUSES = ["pending", "approved", "settled", "rejected"] as const;
type ReimbursementStatus = (typeof VALID_STATUSES)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ActingUser {
  id: string;
  name: string | null;
  role: string;
}

async function resolveActingUser(
  clerkUserId: string,
): Promise<ActingUser | null> {
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (!rows[0]) return null;
  return { id: rows[0].id, name: rows[0].displayName, role: rows[0].role };
}

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

function parseAmount(v: unknown): number | null {
  if (typeof v === "number" && v > 0 && isFinite(v)) return v;
  return null;
}

function isValidDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatPayment(
  row: typeof postMaturityCostPaymentsTable.$inferSelect & {
    projectName?: string | null;
  },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    partnerId: row.partnerId ?? null,
    partnerName: row.partnerName,
    amount: row.amount,
    currency: row.currency,
    paymentDate: row.paymentDate,
    description: row.description,
    category: row.category,
    referenceNumber: row.referenceNumber ?? null,
    remarks: row.remarks ?? null,
    linkedExpenditureId: row.linkedExpenditureId ?? null,
    reimbursementStatus: row.reimbursementStatus,
    approvedBy: row.approvedBy ?? null,
    approvedByName: row.approvedByName ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvalNotes: row.approvalNotes ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    settledByName: row.settledByName ?? null,
    settlementNote: row.settlementNote ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedByName: row.rejectedByName ?? null,
    rejectionReason: row.rejectionReason ?? null,
    recordedBy: row.recordedBy ?? null,
    recordedByName: row.recordedByName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

// ── GET /post-maturity-payments/balance ───────────────────────────────────────
// Must be before /:id to avoid route collision

router.get("/balance", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) {
      return res.json({ balances: [], totals: { pending: 0, approved: 0, settled: 0, rejected: 0, total: 0 } });
    }
  }

  const filterProjectId =
    typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (filterProjectId) {
    if (
      visibleProjectIds !== null &&
      !visibleProjectIds.includes(filterProjectId)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    visibleProjectIds = [filterProjectId];
  }

  const conditions = [];
  if (visibleProjectIds !== null) {
    conditions.push(
      inArray(postMaturityCostPaymentsTable.projectId, visibleProjectIds),
    );
  }

  const rows = await db
    .select({
      projectId: postMaturityCostPaymentsTable.projectId,
      projectName: projectsTable.name,
      reimbursementStatus: postMaturityCostPaymentsTable.reimbursementStatus,
      amount: postMaturityCostPaymentsTable.amount,
    })
    .from(postMaturityCostPaymentsTable)
    .leftJoin(
      projectsTable,
      eq(postMaturityCostPaymentsTable.projectId, projectsTable.id),
    )
    .where(conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined);

  // Aggregate per project
  const projectMap = new Map<
    string,
    {
      projectId: string;
      projectName: string | null;
      pending: number;
      approved: number;
      settled: number;
      rejected: number;
      total: number;
    }
  >();

  for (const row of rows) {
    if (!projectMap.has(row.projectId)) {
      projectMap.set(row.projectId, {
        projectId: row.projectId,
        projectName: row.projectName ?? null,
        pending: 0,
        approved: 0,
        settled: 0,
        rejected: 0,
        total: 0,
      });
    }
    const p = projectMap.get(row.projectId)!;
    // NPF-safe: row.amount may be number (real) today or string (numeric) post-migration.
    const amt = toNum(row.amount);
    p.total += amt;
    if (row.reimbursementStatus === "pending") p.pending += amt;
    else if (row.reimbursementStatus === "approved") p.approved += amt;
    else if (row.reimbursementStatus === "settled") p.settled += amt;
    else if (row.reimbursementStatus === "rejected") p.rejected += amt;
  }

  const balances = Array.from(projectMap.values());
  const totals = balances.reduce(
    (acc, b) => ({
      pending: acc.pending + b.pending,
      approved: acc.approved + b.approved,
      settled: acc.settled + b.settled,
      rejected: acc.rejected + b.rejected,
      total: acc.total + b.total,
    }),
    { pending: 0, approved: 0, settled: 0, rejected: 0, total: 0 },
  );

  return res.json({ balances, totals });
});

// ── GET /post-maturity-payments ───────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0)
      return res.json({ payments: [] });
  }

  const conditions: Parameters<typeof and> = [];

  if (typeof req.query.projectId === "string") {
    const pid = req.query.projectId;
    if (visibleProjectIds !== null && !visibleProjectIds.includes(pid)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    conditions.push(
      eq(postMaturityCostPaymentsTable.projectId, pid),
    );
  } else if (visibleProjectIds !== null) {
    conditions.push(
      inArray(postMaturityCostPaymentsTable.projectId, visibleProjectIds),
    );
  }

  if (
    typeof req.query.reimbursementStatus === "string" &&
    VALID_STATUSES.includes(
      req.query.reimbursementStatus as ReimbursementStatus,
    )
  ) {
    conditions.push(
      eq(
        postMaturityCostPaymentsTable.reimbursementStatus,
        req.query.reimbursementStatus as ReimbursementStatus,
      ),
    );
  }

  if (typeof req.query.category === "string" && VALID_CATEGORIES.includes(req.query.category as PaymentCategory)) {
    conditions.push(eq(postMaturityCostPaymentsTable.category, req.query.category as PaymentCategory));
  }

  const rows = await db
    .select({
      payment: postMaturityCostPaymentsTable,
      projectName: projectsTable.name,
    })
    .from(postMaturityCostPaymentsTable)
    .leftJoin(
      projectsTable,
      eq(postMaturityCostPaymentsTable.projectId, projectsTable.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(postMaturityCostPaymentsTable.createdAt));

  return res.json({
    payments: rows.map((r) =>
      formatPayment({ ...r.payment, projectName: r.projectName }),
    ),
  });
});

// ── POST /post-maturity-payments ──────────────────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const b = req.body as Record<string, unknown>;

    if (!b.projectId || typeof b.projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }
    if (!b.partnerName || typeof b.partnerName !== "string") {
      return res.status(400).json({ error: "partnerName is required" });
    }
    const amount = parseAmount(b.amount);
    if (!amount) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (!isValidDate(b.paymentDate)) {
      return res.status(400).json({ error: "paymentDate must be YYYY-MM-DD" });
    }
    if (!b.description || typeof b.description !== "string") {
      return res.status(400).json({ error: "description is required" });
    }
    if (
      !b.category ||
      !VALID_CATEGORIES.includes(b.category as PaymentCategory)
    ) {
      return res
        .status(400)
        .json({ error: "category must be one of: " + VALID_CATEGORIES.join(", ") });
    }

    // Fetch project — verify it exists and is in mature_production phase
    const projectRows = await db
      .select({
        lifecycleStatus: projectsTable.lifecycleStatus,
        commercialModel: projectsTable.commercialModel,
        name: projectsTable.name,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, b.projectId))
      .limit(1);

    if (!projectRows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (projectRows[0].lifecycleStatus !== "mature_production") {
      return res.status(422).json({
        error:
          "Post-maturity cost payments can only be recorded for projects in the mature_production phase. This project has not yet been declared mature.",
        code: "PROJECT_NOT_MATURE",
        lifecycleStatus: projectRows[0].lifecycleStatus,
      });
    }

    // Resolve optional partnerId
    let resolvedPartnerId: string | null = null;
    if (typeof b.partnerId === "string") {
      const partnerRows = await db
        .select({ id: partnersTable.id })
        .from(partnersTable)
        .where(eq(partnersTable.id, b.partnerId))
        .limit(1);
      if (!partnerRows[0]) {
        return res.status(400).json({ error: "Partner not found" });
      }
      resolvedPartnerId = partnerRows[0].id;
    }

    const [inserted] = await db
      .insert(postMaturityCostPaymentsTable)
      .values({
        projectId: b.projectId,
        partnerId: resolvedPartnerId,
        partnerName: b.partnerName,
        amount,
        currency:
          typeof b.currency === "string" ? b.currency : "INR",
        paymentDate: b.paymentDate,
        description: b.description,
        category: b.category as PaymentCategory,
        referenceNumber:
          typeof b.referenceNumber === "string" ? b.referenceNumber : null,
        remarks: typeof b.remarks === "string" ? b.remarks : null,
        linkedExpenditureId:
          typeof b.linkedExpenditureId === "string"
            ? b.linkedExpenditureId
            : null,
        reimbursementStatus: "pending",
        recordedBy: actor.id,
        recordedByName: actor.name ?? null,
      })
      .returning();

    req.log.info(
      { paymentId: inserted.id, projectId: b.projectId, amount },
      "post_maturity_payment.created",
    );

    return res.status(201).json({ payment: formatPayment(inserted) });
  },
);

// ── GET /post-maturity-payments/:id ──────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const rows = await db
    .select({
      payment: postMaturityCostPaymentsTable,
      projectName: projectsTable.name,
    })
    .from(postMaturityCostPaymentsTable)
    .leftJoin(
      projectsTable,
      eq(postMaturityCostPaymentsTable.projectId, projectsTable.id),
    )
    .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
    .limit(1);

  if (!rows[0]) return res.status(404).json({ error: "Payment not found" });

  const payment = rows[0].payment;

  // Access control
  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(payment.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  return res.json({
    payment: formatPayment({ ...payment, projectName: rows[0].projectName }),
  });
});

// ── PATCH /post-maturity-payments/:id/approve ─────────────────────────────────

router.patch(
  "/:id/approve",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const rows = await db
      .select()
      .from(postMaturityCostPaymentsTable)
      .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: "Payment not found" });

    if (rows[0].reimbursementStatus !== "pending") {
      return res.status(409).json({
        error: `Cannot approve a payment with status '${rows[0].reimbursementStatus}'. Only 'pending' payments can be approved.`,
      });
    }

    const b = req.body as Record<string, unknown>;
    const approvalNotes =
      typeof b.approvalNotes === "string" ? b.approvalNotes : null;

    const [updated] = await db
      .update(postMaturityCostPaymentsTable)
      .set({
        reimbursementStatus: "approved",
        approvedBy: actor.id,
        approvedByName: actor.name ?? null,
        approvedAt: new Date(),
        approvalNotes,
        updatedAt: new Date(),
      })
      .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
      .returning();

    req.log.info(
      { paymentId: req.params.id, approvedBy: actor.id },
      "post_maturity_payment.approved",
    );

    return res.json({ payment: formatPayment(updated) });
  },
);

// ── PATCH /post-maturity-payments/:id/settle ──────────────────────────────────

router.patch(
  "/:id/settle",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const rows = await db
      .select()
      .from(postMaturityCostPaymentsTable)
      .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: "Payment not found" });

    if (rows[0].reimbursementStatus !== "approved") {
      return res.status(409).json({
        error: `Cannot settle a payment with status '${rows[0].reimbursementStatus}'. Only 'approved' payments can be settled.`,
      });
    }

    const b = req.body as Record<string, unknown>;
    const settlementNote =
      typeof b.settlementNote === "string" ? b.settlementNote : null;

    const [updated] = await db
      .update(postMaturityCostPaymentsTable)
      .set({
        reimbursementStatus: "settled",
        settledAt: new Date(),
        settledByName: actor.name ?? null,
        settlementNote,
        updatedAt: new Date(),
      })
      .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
      .returning();

    req.log.info(
      { paymentId: req.params.id, settledBy: actor.id },
      "post_maturity_payment.settled",
    );

    return res.json({ payment: formatPayment(updated) });
  },
);

// ── PATCH /post-maturity-payments/:id/reject ──────────────────────────────────

router.patch(
  "/:id/reject",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const rows = await db
      .select()
      .from(postMaturityCostPaymentsTable)
      .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
      .limit(1);

    if (!rows[0]) return res.status(404).json({ error: "Payment not found" });

    if (rows[0].reimbursementStatus === "settled") {
      return res.status(409).json({
        error: "Cannot reject a payment that has already been settled.",
      });
    }

    const b = req.body as Record<string, unknown>;
    const rejectionReason =
      typeof b.rejectionReason === "string" ? b.rejectionReason : null;

    const [updated] = await db
      .update(postMaturityCostPaymentsTable)
      .set({
        reimbursementStatus: "rejected",
        rejectedAt: new Date(),
        rejectedByName: actor.name ?? null,
        rejectionReason,
        updatedAt: new Date(),
      })
      .where(eq(postMaturityCostPaymentsTable.id, String(req.params.id)))
      .returning();

    req.log.info(
      { paymentId: req.params.id, rejectedBy: actor.id },
      "post_maturity_payment.rejected",
    );

    return res.json({ payment: formatPayment(updated) });
  },
);

export default router;
