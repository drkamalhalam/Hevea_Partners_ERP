import { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  operationalAlertsTable,
  usersTable,
  projectsTable,
  inventoryStockMovementsTable,
  productionBatchesTable,
  saleAuditEventsTable,
  salesLineItemsTable,
  salesTransactionsTable,
} from "@workspace/db";
import { eq, and, sql, isNull, lt, ne, inArray, or, desc, not } from "drizzle-orm";

const router = Router();

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function getUser(clerkId: string) {
  const [u] = await db
    .select({ id: usersTable.id, role: usersTable.role, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkId))
    .limit(1);
  return u ?? null;
}

function isManager(role: string) {
  return role === "admin" || role === "developer";
}

// ── Alert detection engine ────────────────────────────────────────────────────

interface DetectedAlert {
  alertCode: string;
  alertType: "negative_stock" | "missing_batch_linkage" | "inventory_inconsistency" | "suspicious_adjustment" | "unusual_sales_change" | "missing_operational_record";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  entityType: string | null;
  entityId: string | null;
  entityRef: string | null;
  metadata: Record<string, unknown>;
}

async function detectNegativeStock(): Promise<DetectedAlert[]> {
  // Compute net stock per (project, stockType) from confirmed active movements
  const balances = await db.execute(sql`
    SELECT
      m.project_id,
      p.name AS project_name,
      m.stock_type,
      SUM(CASE WHEN m.direction = 'in' THEN m.quantity::numeric ELSE -m.quantity::numeric END) AS net_balance,
      m.unit
    FROM inventory_stock_movements m
    JOIN projects p ON p.id = m.project_id
    WHERE m.status = 'confirmed' AND m.is_active = true
    GROUP BY m.project_id, p.name, m.stock_type, m.unit
    HAVING SUM(CASE WHEN m.direction = 'in' THEN m.quantity::numeric ELSE -m.quantity::numeric END) < 0
  `);

  return (balances.rows as { project_id: string; project_name: string; stock_type: string; net_balance: string; unit: string }[]).map(r => ({
    alertCode: `negative_stock:${r.project_id}:${r.stock_type}`,
    alertType: "negative_stock" as const,
    severity: "critical" as const,
    title: `Negative Stock: ${r.stock_type} in ${r.project_name}`,
    description: `Computed stock balance for ${r.stock_type} in project "${r.project_name}" is ${parseFloat(r.net_balance).toFixed(3)} ${r.unit} — below zero. This indicates a data entry error or unlinked movement.`,
    projectId: r.project_id,
    projectName: r.project_name,
    entityType: "stock",
    entityId: null,
    entityRef: r.stock_type,
    metadata: { stockType: r.stock_type, netBalance: r.net_balance, unit: r.unit },
  }));
}

async function detectMissingBatchLinkage(): Promise<DetectedAlert[]> {
  const alerts: DetectedAlert[] = [];

  // production_in movements with no batch reference
  const unlinkedMovements = await db.execute(sql`
    SELECT m.id, m.project_id, p.name AS project_name, m.stock_type, m.quantity, m.unit, m.movement_date, m.movement_type
    FROM inventory_stock_movements m
    JOIN projects p ON p.id = m.project_id
    WHERE m.movement_type = 'production_in'
      AND m.batch_id IS NULL
      AND m.is_active = true
      AND m.status = 'confirmed'
    ORDER BY m.movement_date DESC
    LIMIT 50
  `);

  for (const r of unlinkedMovements.rows as { id: string; project_id: string; project_name: string; stock_type: string; quantity: string; unit: string; movement_date: string }[]) {
    alerts.push({
      alertCode: `missing_batch_linkage:${r.project_id}:movement:${r.id}`,
      alertType: "missing_batch_linkage",
      severity: "warning",
      title: `Unlinked Production Movement in ${r.project_name}`,
      description: `A production_in movement of ${r.quantity} ${r.unit} of ${r.stock_type} on ${r.movement_date} has no associated production batch. Traceability is broken.`,
      projectId: r.project_id,
      projectName: r.project_name,
      entityType: "inventory_movement",
      entityId: r.id,
      entityRef: `${r.stock_type} / ${r.movement_date}`,
      metadata: { movementId: r.id, stockType: r.stock_type, quantity: r.quantity, unit: r.unit, date: r.movement_date },
    });
  }

  // Confirmed sales line items with no batch linkage
  const unlinkedSales = await db.execute(sql`
    SELECT li.id, t.project_id, p.name AS project_name, t.sale_number, li.product_type, li.quantity, li.unit
    FROM sales_line_items li
    JOIN sales_transactions t ON t.id = li.transaction_id
    JOIN projects p ON p.id = t.project_id
    WHERE li.batch_id IS NULL
      AND t.status = 'confirmed'
      AND t.is_active = true
    ORDER BY t.sale_date DESC
    LIMIT 50
  `);

  for (const r of unlinkedSales.rows as { id: string; project_id: string; project_name: string; sale_number: string; product_type: string; quantity: string; unit: string }[]) {
    alerts.push({
      alertCode: `missing_batch_linkage:${r.project_id}:sale_line:${r.id}`,
      alertType: "missing_batch_linkage",
      severity: "warning",
      title: `Sale Without Batch Link: ${r.sale_number}`,
      description: `Confirmed sale "${r.sale_number}" in ${r.project_name} has a line item for ${r.quantity} ${r.unit} of ${r.product_type} with no production batch reference. Source traceability is incomplete.`,
      projectId: r.project_id,
      projectName: r.project_name,
      entityType: "sale_line_item",
      entityId: r.id,
      entityRef: r.sale_number,
      metadata: { lineItemId: r.id, saleNumber: r.sale_number, productType: r.product_type, quantity: r.quantity, unit: r.unit },
    });
  }

  return alerts;
}

async function detectInventoryInconsistencies(): Promise<DetectedAlert[]> {
  // For each closed batch, compare batch totals vs production_in movements
  const inconsistencies = await db.execute(sql`
    WITH batch_movements AS (
      SELECT batch_id,
        SUM(CASE WHEN stock_type = 'latex' THEN quantity::numeric ELSE 0 END) AS latex_moved,
        SUM(CASE WHEN stock_type = 'rubber_sheet' THEN quantity::numeric ELSE 0 END) AS sheet_moved,
        SUM(CASE WHEN stock_type = 'rubber_scrap' THEN quantity::numeric ELSE 0 END) AS scrap_moved
      FROM inventory_stock_movements
      WHERE movement_type = 'production_in' AND status = 'confirmed' AND is_active = true
        AND batch_id IS NOT NULL
      GROUP BY batch_id
    )
    SELECT
      b.id, b.project_id, p.name AS project_name, b.batch_number, b.batch_date,
      b.total_latex_litres::numeric AS batch_latex,
      b.total_sheet_kg::numeric AS batch_sheet,
      b.total_scrap_kg::numeric AS batch_scrap,
      COALESCE(bm.latex_moved, 0) AS moved_latex,
      COALESCE(bm.sheet_moved, 0) AS moved_sheet,
      COALESCE(bm.scrap_moved, 0) AS moved_scrap,
      ABS(b.total_latex_litres::numeric - COALESCE(bm.latex_moved, 0)) AS latex_diff,
      ABS(b.total_sheet_kg::numeric - COALESCE(bm.sheet_moved, 0)) AS sheet_diff,
      ABS(b.total_scrap_kg::numeric - COALESCE(bm.scrap_moved, 0)) AS scrap_diff
    FROM production_batches b
    JOIN projects p ON p.id = b.project_id
    LEFT JOIN batch_movements bm ON bm.batch_id = b.id
    WHERE b.status = 'closed'
      AND (
        ABS(b.total_latex_litres::numeric - COALESCE(bm.latex_moved, 0)) > 1
        OR ABS(b.total_sheet_kg::numeric - COALESCE(bm.sheet_moved, 0)) > 0.5
        OR ABS(b.total_scrap_kg::numeric - COALESCE(bm.scrap_moved, 0)) > 0.5
      )
    ORDER BY b.batch_date DESC
    LIMIT 50
  `);

  return (inconsistencies.rows as {
    id: string; project_id: string; project_name: string; batch_number: string; batch_date: string;
    batch_latex: string; batch_sheet: string; batch_scrap: string;
    moved_latex: string; moved_sheet: string; moved_scrap: string;
    latex_diff: string; sheet_diff: string; scrap_diff: string;
  }[]).map(r => {
    const diffs: string[] = [];
    if (parseFloat(r.latex_diff) > 1) diffs.push(`latex: ${r.latex_diff} L`);
    if (parseFloat(r.sheet_diff) > 0.5) diffs.push(`sheet: ${r.sheet_diff} kg`);
    if (parseFloat(r.scrap_diff) > 0.5) diffs.push(`scrap: ${r.scrap_diff} kg`);
    return {
      alertCode: `inventory_inconsistency:${r.project_id}:batch:${r.id}`,
      alertType: "inventory_inconsistency" as const,
      severity: "warning" as const,
      title: `Batch–Inventory Discrepancy: ${r.batch_number}`,
      description: `Closed batch "${r.batch_number}" (${r.batch_date}) in ${r.project_name} does not reconcile with inventory movements. Discrepancies: ${diffs.join(", ")}.`,
      projectId: r.project_id,
      projectName: r.project_name,
      entityType: "production_batch",
      entityId: r.id,
      entityRef: r.batch_number,
      metadata: {
        batchNumber: r.batch_number,
        batchDate: r.batch_date,
        batchTotals: { latex: r.batch_latex, sheet: r.batch_sheet, scrap: r.batch_scrap },
        inventoryTotals: { latex: r.moved_latex, sheet: r.moved_sheet, scrap: r.moved_scrap },
        differences: { latex: r.latex_diff, sheet: r.sheet_diff, scrap: r.scrap_diff },
      },
    };
  });
}

async function detectSuspiciousAdjustments(): Promise<DetectedAlert[]> {
  // Large adjustment movements (>100 kg / >1000 L) or pending adjustments > 7 days old
  const adjustments = await db.execute(sql`
    SELECT m.id, m.project_id, p.name AS project_name, m.stock_type,
           m.movement_type, m.direction, m.quantity, m.unit, m.movement_date,
           m.status, m.notes, m.created_at
    FROM inventory_stock_movements m
    JOIN projects p ON p.id = m.project_id
    WHERE m.movement_type IN ('adjustment_in', 'adjustment_out')
      AND m.is_active = true
      AND (
        (m.unit = 'kg' AND m.quantity::numeric > 100)
        OR (m.unit = 'litres' AND m.quantity::numeric > 1000)
        OR (m.status = 'pending' AND m.created_at < NOW() - INTERVAL '7 days')
      )
    ORDER BY m.movement_date DESC
    LIMIT 50
  `);

  return (adjustments.rows as {
    id: string; project_id: string; project_name: string; stock_type: string;
    movement_type: string; direction: string; quantity: string; unit: string;
    movement_date: string; status: string; notes: string | null; created_at: string;
  }[]).map(r => {
    const isPending = r.status === "pending";
    const isLarge = (r.unit === "kg" && parseFloat(r.quantity) > 100) || (r.unit === "litres" && parseFloat(r.quantity) > 1000);
    const reason = isPending && !isLarge
      ? "pending adjustment older than 7 days"
      : `large ${r.movement_type.replace("_", " ")} of ${r.quantity} ${r.unit}`;
    return {
      alertCode: `suspicious_adjustment:${r.project_id}:movement:${r.id}`,
      alertType: "suspicious_adjustment" as const,
      severity: (isPending && !isLarge) ? "warning" as const : "warning" as const,
      title: `Suspicious Adjustment: ${r.stock_type} in ${r.project_name}`,
      description: `Flagged ${reason} for ${r.stock_type} on ${r.movement_date}. ${r.notes ? `Notes: "${r.notes}".` : "No justification notes provided."}`,
      projectId: r.project_id,
      projectName: r.project_name,
      entityType: "inventory_movement",
      entityId: r.id,
      entityRef: `${r.stock_type} / ${r.movement_date}`,
      metadata: { movementType: r.movement_type, direction: r.direction, quantity: r.quantity, unit: r.unit, status: r.status, notes: r.notes },
    };
  });
}

async function detectUnusualSalesChanges(): Promise<DetectedAlert[]> {
  // Look for flagged sale audit events
  const flagged = await db.execute(sql`
    SELECT e.id, e.transaction_id, e.sale_number, e.project_id,
           p.name AS project_name, e.event_type, e.entity_type,
           e.risk_level, e.performed_by_name, e.performed_at, e.before_data, e.after_data
    FROM sale_audit_events e
    LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.risk_level = 'flag'
    ORDER BY e.performed_at DESC
    LIMIT 50
  `);

  return (flagged.rows as {
    id: string; transaction_id: string | null; sale_number: string;
    project_id: string | null; project_name: string | null;
    event_type: string; entity_type: string; risk_level: string;
    performed_by_name: string | null; performed_at: string;
    before_data: unknown; after_data: unknown;
  }[]).map(r => ({
    alertCode: `unusual_sales_change:${r.project_id ?? "global"}:audit:${r.id}`,
    alertType: "unusual_sales_change" as const,
    severity: "warning" as const,
    title: `Flagged Sale Edit: ${r.sale_number}`,
    description: `A "${r.event_type}" event on sale "${r.sale_number}" was risk-flagged by the audit engine. Action by: ${r.performed_by_name ?? "unknown"} on ${new Date(r.performed_at).toLocaleDateString()}.`,
    projectId: r.project_id,
    projectName: r.project_name,
    entityType: "sale_audit_event",
    entityId: r.id,
    entityRef: r.sale_number,
    metadata: { eventType: r.event_type, entityType: r.entity_type, performedBy: r.performed_by_name, performedAt: r.performed_at, beforeData: r.before_data, afterData: r.after_data },
  }));
}

async function detectMissingOperationalRecords(): Promise<DetectedAlert[]> {
  // Open production batches older than 7 days (should have been closed)
  const staleBatches = await db.execute(sql`
    SELECT b.id, b.project_id, p.name AS project_name, b.batch_number, b.batch_date, b.entry_count
    FROM production_batches b
    JOIN projects p ON p.id = b.project_id
    WHERE b.status = 'open'
      AND b.batch_date < CURRENT_DATE - INTERVAL '7 days'
    ORDER BY b.batch_date ASC
    LIMIT 50
  `);

  return (staleBatches.rows as {
    id: string; project_id: string; project_name: string; batch_number: string; batch_date: string; entry_count: number;
  }[]).map(r => ({
    alertCode: `missing_operational_record:${r.project_id}:batch:${r.id}`,
    alertType: "missing_operational_record" as const,
    severity: "info" as const,
    title: `Stale Open Batch: ${r.batch_number}`,
    description: `Production batch "${r.batch_number}" (${r.batch_date}) in "${r.project_name}" has been open for more than 7 days with ${r.entry_count} entr${r.entry_count === 1 ? "y" : "ies"}. It should be closed or voided.`,
    projectId: r.project_id,
    projectName: r.project_name,
    entityType: "production_batch",
    entityId: r.id,
    entityRef: r.batch_number,
    metadata: { batchNumber: r.batch_number, batchDate: r.batch_date, entryCount: r.entry_count },
  }));
}

/**
 * Runs all detectors, deduplicates against existing open alerts, and inserts new ones.
 * Returns counts of new vs skipped.
 */
async function runAlertGeneration(triggeredByName: string) {
  const detected: DetectedAlert[] = [
    ...await detectNegativeStock(),
    ...await detectMissingBatchLinkage(),
    ...await detectInventoryInconsistencies(),
    ...await detectSuspiciousAdjustments(),
    ...await detectUnusualSalesChanges(),
    ...await detectMissingOperationalRecords(),
  ];

  if (detected.length === 0) {
    return { generated: 0, skipped: 0, totalDetected: 0 };
  }

  // Fetch existing open alert codes to avoid duplicates
  const existingOpen = await db
    .select({ alertCode: operationalAlertsTable.alertCode })
    .from(operationalAlertsTable)
    .where(and(
      eq(operationalAlertsTable.status, "open"),
      eq(operationalAlertsTable.isActive, true),
    ));
  const openCodes = new Set(existingOpen.map(r => r.alertCode));

  const toInsert = detected.filter(d => !openCodes.has(d.alertCode));

  if (toInsert.length > 0) {
    await db.insert(operationalAlertsTable).values(
      toInsert.map(d => ({
        alertCode: d.alertCode,
        alertType: d.alertType,
        severity: d.severity,
        status: "open" as const,
        title: d.title,
        description: d.description,
        projectId: d.projectId ?? undefined,
        projectName: d.projectName ?? undefined,
        entityType: d.entityType ?? undefined,
        entityId: d.entityId ?? undefined,
        entityRef: d.entityRef ?? undefined,
        metadata: d.metadata,
      }))
    );
  }

  return {
    generated: toInsert.length,
    skipped: detected.length - toInsert.length,
    totalDetected: detected.length,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /operational-alerts/summary
router.get("/summary", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const user = await getUser(userId);
  if (!user || !isManager(user.role)) return void res.status(403).json({ error: "Forbidden" });

  const counts = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'open') AS open_count,
      COUNT(*) FILTER (WHERE status = 'acknowledged') AS acknowledged_count,
      COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed_count,
      COUNT(*) FILTER (WHERE severity = 'critical' AND status IN ('open','acknowledged')) AS critical_active,
      COUNT(*) FILTER (WHERE severity = 'warning' AND status IN ('open','acknowledged')) AS warning_active,
      COUNT(*) FILTER (WHERE severity = 'info' AND status IN ('open','acknowledged')) AS info_active,
      COUNT(*) FILTER (WHERE alert_type = 'negative_stock' AND status = 'open') AS negative_stock,
      COUNT(*) FILTER (WHERE alert_type = 'missing_batch_linkage' AND status = 'open') AS missing_batch_linkage,
      COUNT(*) FILTER (WHERE alert_type = 'inventory_inconsistency' AND status = 'open') AS inventory_inconsistency,
      COUNT(*) FILTER (WHERE alert_type = 'suspicious_adjustment' AND status = 'open') AS suspicious_adjustment,
      COUNT(*) FILTER (WHERE alert_type = 'unusual_sales_change' AND status = 'open') AS unusual_sales_change,
      COUNT(*) FILTER (WHERE alert_type = 'missing_operational_record' AND status = 'open') AS missing_operational_record,
      COUNT(*) AS total
    FROM operational_alerts
    WHERE is_active = true
  `);

  const r = counts.rows[0] as Record<string, string>;
  res.json({
    openCount: parseInt(r.open_count),
    acknowledgedCount: parseInt(r.acknowledged_count),
    resolvedCount: parseInt(r.resolved_count),
    dismissedCount: parseInt(r.dismissed_count),
    criticalActive: parseInt(r.critical_active),
    warningActive: parseInt(r.warning_active),
    infoActive: parseInt(r.info_active),
    byType: {
      negativeStock: parseInt(r.negative_stock),
      missingBatchLinkage: parseInt(r.missing_batch_linkage),
      inventoryInconsistency: parseInt(r.inventory_inconsistency),
      suspiciousAdjustment: parseInt(r.suspicious_adjustment),
      unusualSalesChange: parseInt(r.unusual_sales_change),
      missingOperationalRecord: parseInt(r.missing_operational_record),
    },
    total: parseInt(r.total),
  });
});

// GET /operational-alerts
router.get("/", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const user = await getUser(userId);
  if (!user || !isManager(user.role)) return void res.status(403).json({ error: "Forbidden" });

  const { status, severity, alertType, projectId, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const where: ReturnType<typeof and>[] = [
    eq(operationalAlertsTable.isActive, true),
  ];
  if (status) where.push(eq(operationalAlertsTable.status, status as "open" | "acknowledged" | "resolved" | "dismissed"));
  if (severity) where.push(eq(operationalAlertsTable.severity, severity as "critical" | "warning" | "info"));
  if (alertType) where.push(eq(operationalAlertsTable.alertType, alertType as "negative_stock" | "missing_batch_linkage" | "inventory_inconsistency" | "suspicious_adjustment" | "unusual_sales_change" | "missing_operational_record"));
  if (projectId) where.push(eq(operationalAlertsTable.projectId, projectId));

  const rows = await db
    .select()
    .from(operationalAlertsTable)
    .where(and(...where))
    .orderBy(
      sql`CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`,
      sql`CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END`,
      desc(operationalAlertsTable.detectedAt),
    )
    .limit(parseInt(limit))
    .offset(parseInt(offset));

  res.json(rows);
});

// POST /operational-alerts/generate
router.post("/generate", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const user = await getUser(userId);
  if (!user || !isManager(user.role)) return void res.status(403).json({ error: "Forbidden" });

  const result = await runAlertGeneration(user.displayName ?? "System");
  res.status(201).json(result);
});

// GET /operational-alerts/:id
router.get("/:id", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const user = await getUser(userId);
  if (!user || !isManager(user.role)) return void res.status(403).json({ error: "Forbidden" });

  const id = req.params.id as string;
  const [alert] = await db
    .select()
    .from(operationalAlertsTable)
    .where(and(eq(operationalAlertsTable.id, id), eq(operationalAlertsTable.isActive, true)))
    .limit(1);

  if (!alert) return void res.status(404).json({ error: "Alert not found" });
  res.json(alert);
});

// PATCH /operational-alerts/:id — acknowledge / resolve / dismiss
router.patch("/:id", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const user = await getUser(userId);
  if (!user || !isManager(user.role)) return void res.status(403).json({ error: "Forbidden" });

  const id = req.params.id as string;
  const { action, resolutionNotes } = req.body as { action: string; resolutionNotes?: string };

  const [existing] = await db
    .select()
    .from(operationalAlertsTable)
    .where(and(eq(operationalAlertsTable.id, id), eq(operationalAlertsTable.isActive, true)))
    .limit(1);
  if (!existing) return void res.status(404).json({ error: "Alert not found" });

  const now = new Date();
  let patch: Partial<typeof operationalAlertsTable.$inferInsert> = { updatedAt: now };

  if (action === "acknowledge") {
    patch = { ...patch, status: "acknowledged", acknowledgedAt: now, acknowledgedById: user.id, acknowledgedByName: user.displayName ?? "" };
  } else if (action === "resolve") {
    patch = { ...patch, status: "resolved", resolvedAt: now, resolvedById: user.id, resolvedByName: user.displayName ?? "", resolutionNotes: resolutionNotes ?? null };
  } else if (action === "dismiss") {
    patch = { ...patch, status: "dismissed", resolvedAt: now, resolvedById: user.id, resolvedByName: user.displayName ?? "", resolutionNotes: resolutionNotes ?? null };
  } else if (action === "reopen") {
    if (user.role !== "admin") return void res.status(403).json({ error: "Only admins can reopen alerts" });
    patch = {
      ...patch, status: "open",
      acknowledgedAt: null as unknown as Date, acknowledgedById: null as unknown as string, acknowledgedByName: null,
      resolvedAt: null as unknown as Date, resolvedById: null as unknown as string, resolvedByName: null, resolutionNotes: null,
    };
  } else {
    return void res.status(400).json({ error: "Invalid action. Use: acknowledge, resolve, dismiss, reopen" });
  }

  const [updated] = await db
    .update(operationalAlertsTable)
    .set(patch)
    .where(eq(operationalAlertsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
