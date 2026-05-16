/**
 * operational_analytics.ts
 *
 * Operational & Inventory Reporting Engine.
 * Role-aware: admin/developer see all; others see assigned projects only.
 *
 * Tables used:
 *   productionBatchesTable, productionEntriesTable
 *   inventoryStockMovementsTable
 *   salesTransactionsTable, salesLineItemsTable, salesDeductionsTable
 *   salesOrdersTable, salesInvoicesTable
 *   buyersTable
 *
 * Endpoints:
 *   GET /operational-analytics/projects
 *   GET /operational-analytics/overview?projectId=
 *   GET /operational-analytics/production?projectId=&year=
 *   GET /operational-analytics/batches?projectId=
 *   GET /operational-analytics/inventory?projectId=
 *   GET /operational-analytics/sales?projectId=&year=
 *   GET /operational-analytics/wastage?projectId=
 *   GET /operational-analytics/buyers?projectId=
 */

import { Router } from "express";
import {
  db, usersTable, projectsTable, userProjectAssignmentsTable,
} from "@workspace/db";
import { eq, and, inArray, isNull, sql, asc } from "drizzle-orm";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────
const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toF2 = (v: number) => parseFloat(v.toFixed(2));
const toF3 = (v: number) => parseFloat(v.toFixed(3));

const isPrivileged = (role: string) => role === "admin" || role === "developer";



// ── GET /operational-analytics/projects ──────────────────────────────────

router.get("/projects", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const allowed = req.canAccessAllProjects ? null : (req.userProjectIds ?? []);
  const projects = allowed !== null && allowed.length === 0 ? [] :
    await db.select({
      id: projectsTable.id, name: projectsTable.name, projectCode: projectsTable.projectCode,
      commercialModel: projectsTable.commercialModel, lifecycleStatus: projectsTable.lifecycleStatus,
      activationStatus: projectsTable.activationStatus,
    })
    .from(projectsTable)
    .where(allowed !== null ? and(eq(projectsTable.isActive, true), inArray(projectsTable.id, allowed)) : eq(projectsTable.isActive, true))
    .orderBy(asc(projectsTable.name));

  return res.json({ projects });
});

// ── GET /operational-analytics/overview?projectId= ───────────────────────

router.get("/overview", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [prodBatches, prodEntries, invBalances, invWastage, salesSummary, ordersSummary, recentSales] = await Promise.all([
    // Production batch summary
    db.execute(sql`
      SELECT
        COUNT(*) AS total_batches,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed_batches,
        COUNT(*) FILTER (WHERE status = 'open') AS open_batches,
        COUNT(*) FILTER (WHERE status = 'voided') AS voided_batches,
        COALESCE(SUM(total_latex_litres::numeric), 0) AS total_latex,
        COALESCE(SUM(total_sheet_kg::numeric), 0) AS total_sheet,
        COALESCE(SUM(total_scrap_kg::numeric), 0) AS total_scrap,
        SUM(entry_count) AS total_entries,
        MIN(batch_date) AS first_batch, MAX(batch_date) AS last_batch
      FROM production_batches
      WHERE project_id = ${pid}::uuid
    `),

    // Production entries by type — monthly breakdown
    db.execute(sql`
      SELECT
        production_type,
        unit,
        COALESCE(SUM(quantity::numeric), 0) AS total_qty,
        COUNT(*) AS entry_count,
        AVG(quantity::numeric) AS avg_qty,
        MAX(production_date) AS last_date
      FROM production_entries
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY production_type, unit
    `),

    // Inventory current balance by stock type
    db.execute(sql`
      SELECT
        stock_type,
        unit,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'in' AND status = 'confirmed'), 0) AS total_in,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0) AS total_out,
        COALESCE(
          SUM(quantity::numeric) FILTER (WHERE direction = 'in' AND status = 'confirmed') -
          SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0
        ) AS balance,
        COUNT(*) FILTER (WHERE movement_type = 'wastage') AS wastage_movements,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'wastage' AND status = 'confirmed'), 0) AS total_wastage,
        MAX(movement_date) AS last_movement
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY stock_type, unit
    `),

    // Wastage summary
    db.execute(sql`
      SELECT
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'wastage' AND status = 'confirmed'), 0) AS total_wastage,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'sale_out' AND status = 'confirmed'), 0) AS total_sold,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0) AS total_out,
        COUNT(*) FILTER (WHERE movement_type = 'wastage') AS wastage_events
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    // Sales summary
    db.execute(sql`
      SELECT
        COUNT(*) AS total_transactions,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed_transactions,
        COUNT(DISTINCT buyer_id) AS unique_buyers,
        COALESCE(SUM(total_gross_revenue::numeric), 0) AS total_gross,
        COALESCE(SUM(total_deductions::numeric), 0) AS total_deductions,
        COALESCE(SUM(total_net_revenue::numeric), 0) AS total_net,
        MAX(sale_date) AS last_sale, MIN(sale_date) AS first_sale
      FROM sales_transactions
      WHERE project_id = ${pid}::uuid AND is_active = true AND status = 'confirmed'
    `),

    // Sales orders summary
    db.execute(sql`
      SELECT
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE order_status = 'completed') AS completed_orders,
        COUNT(*) FILTER (WHERE payment_status = 'confirmed') AS paid_orders,
        COALESCE(SUM(total_amount::numeric) FILTER (WHERE order_status = 'completed'), 0) AS completed_revenue,
        COALESCE(SUM(quantity_kg::numeric) FILTER (WHERE order_status = 'completed'), 0) AS completed_qty,
        AVG(rate_per_kg::numeric) FILTER (WHERE order_status = 'completed') AS avg_rate
      FROM sales_orders
      WHERE project_id = ${pid}::uuid
    `),

    // Recent 5 sales transactions
    db.execute(sql`
      SELECT
        st.id, st.sale_number, st.sale_date, st.buyer_name, st.status,
        st.total_gross_revenue::numeric AS gross,
        st.total_net_revenue::numeric AS net
      FROM sales_transactions st
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true
      ORDER BY st.sale_date DESC
      LIMIT 5
    `),
  ]);

  const pb = prodBatches.rows[0] as Record<string, unknown>;
  const iw = invWastage.rows[0] as Record<string, unknown>;
  const ss = salesSummary.rows[0] as Record<string, unknown>;
  const os = ordersSummary.rows[0] as Record<string, unknown>;

  const prodByType: Record<string, { totalQty: number; entryCount: number; avgQty: number; unit: string; lastDate: string | null }> = {};
  for (const r of prodEntries.rows as Record<string, unknown>[]) {
    prodByType[String(r.production_type)] = {
      totalQty: toF3(toNum(r.total_qty)),
      entryCount: Number(r.entry_count),
      avgQty: toF3(toNum(r.avg_qty)),
      unit: String(r.unit),
      lastDate: r.last_date ? String(r.last_date) : null,
    };
  }

  const invByType: { stockType: string; unit: string; totalIn: number; totalOut: number; balance: number; totalWastage: number; lastMovement: string | null }[] = [];
  for (const r of invBalances.rows as Record<string, unknown>[]) {
    invByType.push({
      stockType: String(r.stock_type),
      unit: String(r.unit),
      totalIn: toF3(toNum(r.total_in)),
      totalOut: toF3(toNum(r.total_out)),
      balance: toF3(toNum(r.balance)),
      totalWastage: toF3(toNum(r.total_wastage)),
      lastMovement: r.last_movement ? String(r.last_movement) : null,
    });
  }

  const totalWastage = toF3(toNum(iw?.total_wastage));
  const totalSold = toF3(toNum(iw?.total_sold));
  const wastageRate = (totalSold + totalWastage) > 0 ? toF2((totalWastage / (totalSold + totalWastage)) * 100) : 0;

  return res.json({
    production: {
      totalBatches: Number(pb?.total_batches ?? 0),
      closedBatches: Number(pb?.closed_batches ?? 0),
      openBatches: Number(pb?.open_batches ?? 0),
      voidedBatches: Number(pb?.voided_batches ?? 0),
      totalEntries: Number(pb?.total_entries ?? 0),
      totalLatexLitres: toF3(toNum(pb?.total_latex)),
      totalSheetKg: toF3(toNum(pb?.total_sheet)),
      totalScrapKg: toF3(toNum(pb?.total_scrap)),
      firstBatch: pb?.first_batch ? String(pb.first_batch) : null,
      lastBatch: pb?.last_batch ? String(pb.last_batch) : null,
      byType: prodByType,
    },
    inventory: {
      byStockType: invByType,
      totalWastage,
      totalSold,
      wastageEvents: Number(iw?.wastage_events ?? 0),
      wastageRate,
    },
    sales: {
      totalTransactions: Number(ss?.total_transactions ?? 0),
      confirmedTransactions: Number(ss?.confirmed_transactions ?? 0),
      uniqueBuyers: Number(ss?.unique_buyers ?? 0),
      totalGross: toF2(toNum(ss?.total_gross)),
      totalDeductions: toF2(toNum(ss?.total_deductions)),
      totalNet: toF2(toNum(ss?.total_net)),
      firstSale: ss?.first_sale ? String(ss.first_sale) : null,
      lastSale: ss?.last_sale ? String(ss.last_sale) : null,
    },
    orders: {
      totalOrders: Number(os?.total_orders ?? 0),
      completedOrders: Number(os?.completed_orders ?? 0),
      paidOrders: Number(os?.paid_orders ?? 0),
      completedRevenue: toF2(toNum(os?.completed_revenue)),
      completedQtyKg: toF3(toNum(os?.completed_qty)),
      avgRatePerKg: toF2(toNum(os?.avg_rate)),
    },
    recentSales: (recentSales.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), saleNumber: String(r.sale_number), saleDate: String(r.sale_date),
      buyerName: String(r.buyer_name), status: String(r.status),
      gross: toF2(toNum(r.gross)), net: toF2(toNum(r.net)),
    })),
  });
});

// ── GET /operational-analytics/production?projectId=&year= ───────────────

router.get("/production", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;
  const pid = projectId;

  const [monthlyTrend, batches, entriesByType, yearlyComparison] = await Promise.all([
    // Monthly production trend — all three product types
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', production_date::timestamp), 'YYYY-MM') AS month,
        production_type, unit,
        COALESCE(SUM(quantity::numeric), 0) AS total_qty,
        COUNT(*) AS entry_count
      FROM production_entries
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM production_date::timestamp) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', production_date::timestamp), production_type, unit
      ORDER BY DATE_TRUNC('month', production_date::timestamp), production_type
    `),

    // Batch list with totals
    db.execute(sql`
      SELECT
        pb.id, pb.batch_number, pb.batch_date, pb.status, pb.notes,
        pb.entry_count, pb.total_latex_litres::numeric AS latex,
        pb.total_sheet_kg::numeric AS sheet, pb.total_scrap_kg::numeric AS scrap,
        pb.created_by_name, pb.closed_by_name, pb.closed_at, pb.created_at
      FROM production_batches pb
      WHERE pb.project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM pb.batch_date::timestamp) = ${yearInt}` : sql``}
      ORDER BY pb.batch_date DESC
      LIMIT 200
    `),

    // Entries breakdown by type + date
    db.execute(sql`
      SELECT
        pe.id, pe.production_type, pe.quantity::numeric AS qty, pe.unit,
        pe.production_date, pe.remarks, pe.entered_by_name,
        pb.batch_number, pb.batch_date, pb.status AS batch_status
      FROM production_entries pe
      JOIN production_batches pb ON pb.id = pe.batch_id
      WHERE pe.project_id = ${pid}::uuid AND pe.is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM pe.production_date::timestamp) = ${yearInt}` : sql``}
      ORDER BY pe.production_date DESC
      LIMIT 300
    `),

    // Year-over-year comparison
    db.execute(sql`
      SELECT
        EXTRACT(YEAR FROM production_date::timestamp)::integer AS year,
        production_type,
        COALESCE(SUM(quantity::numeric), 0) AS total_qty,
        COUNT(*) AS entry_count,
        COUNT(DISTINCT batch_id) AS batch_count
      FROM production_entries
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY EXTRACT(YEAR FROM production_date::timestamp), production_type
      ORDER BY year, production_type
    `),
  ]);

  // Pivot monthly trend → { month, latex, sheet, scrap }
  const monthMap: Record<string, { month: string; latex: number; sheet: number; scrap: number; latexEntries: number; sheetEntries: number; scrapEntries: number }> = {};
  for (const r of monthlyTrend.rows as Record<string, unknown>[]) {
    const m = String(r.month);
    if (!monthMap[m]) monthMap[m] = { month: m, latex: 0, sheet: 0, scrap: 0, latexEntries: 0, sheetEntries: 0, scrapEntries: 0 };
    const qty = toF3(toNum(r.total_qty));
    const cnt = Number(r.entry_count);
    const t = String(r.production_type);
    if (t === "latex") { monthMap[m].latex = qty; monthMap[m].latexEntries = cnt; }
    else if (t === "rubber_sheet") { monthMap[m].sheet = qty; monthMap[m].sheetEntries = cnt; }
    else if (t === "rubber_scrap") { monthMap[m].scrap = qty; monthMap[m].scrapEntries = cnt; }
  }

  // Year pivot
  const yearMap: Record<number, { year: number; latex: number; sheet: number; scrap: number; batchCount: number }> = {};
  for (const r of yearlyComparison.rows as Record<string, unknown>[]) {
    const y = Number(r.year);
    if (!yearMap[y]) yearMap[y] = { year: y, latex: 0, sheet: 0, scrap: 0, batchCount: 0 };
    const qty = toF3(toNum(r.total_qty));
    const t = String(r.production_type);
    if (t === "latex") yearMap[y].latex = qty;
    else if (t === "rubber_sheet") yearMap[y].sheet = qty;
    else if (t === "rubber_scrap") yearMap[y].scrap = qty;
    yearMap[y].batchCount = Math.max(yearMap[y].batchCount, Number(r.batch_count));
  }

  return res.json({
    monthlyTrend: Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)),
    batches: (batches.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), batchNumber: String(r.batch_number), batchDate: String(r.batch_date),
      status: String(r.status), notes: r.notes ? String(r.notes) : null,
      entryCount: Number(r.entry_count),
      latexLitres: toF3(toNum(r.latex)), sheetKg: toF3(toNum(r.sheet)), scrapKg: toF3(toNum(r.scrap)),
      createdByName: String(r.created_by_name),
      closedByName: r.closed_by_name ? String(r.closed_by_name) : null,
      closedAt: r.closed_at ?? null, createdAt: r.created_at ?? null,
    })),
    entries: (entriesByType.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), productionType: String(r.production_type),
      quantity: toF3(toNum(r.qty)), unit: String(r.unit),
      productionDate: String(r.production_date), remarks: r.remarks ? String(r.remarks) : null,
      enteredByName: String(r.entered_by_name),
      batchNumber: String(r.batch_number), batchDate: String(r.batch_date), batchStatus: String(r.batch_status),
    })),
    yearlyComparison: Object.values(yearMap).sort((a, b) => a.year - b.year),
  });
});

// ── GET /operational-analytics/batches?projectId= ────────────────────────

router.get("/batches", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [batchesWithSales, statusSummary, avgDailyOutput] = await Promise.all([
    // Batches with linked sales (traceability)
    db.execute(sql`
      SELECT
        pb.id, pb.batch_number, pb.batch_date, pb.status,
        pb.entry_count, pb.total_latex_litres::numeric AS latex,
        pb.total_sheet_kg::numeric AS sheet, pb.total_scrap_kg::numeric AS scrap,
        pb.created_by_name, pb.closed_at,
        COUNT(DISTINCT sli.transaction_id) AS linked_sale_count,
        COALESCE(SUM(sli.gross_amount::numeric), 0) AS linked_gross,
        COALESCE(SUM(sli.quantity::numeric), 0) AS linked_qty,
        MAX(st.sale_date) AS last_sale_date
      FROM production_batches pb
      LEFT JOIN sales_line_items sli ON sli.batch_id = pb.id
      LEFT JOIN sales_transactions st ON st.id = sli.transaction_id AND st.status = 'confirmed'
      WHERE pb.project_id = ${pid}::uuid
      GROUP BY pb.id, pb.batch_number, pb.batch_date, pb.status, pb.entry_count,
               pb.total_latex_litres, pb.total_sheet_kg, pb.total_scrap_kg,
               pb.created_by_name, pb.closed_at
      ORDER BY pb.batch_date DESC
      LIMIT 200
    `),

    // Batch status breakdown
    db.execute(sql`
      SELECT
        status, COUNT(*) AS cnt,
        COALESCE(SUM(total_latex_litres::numeric), 0) AS latex,
        COALESCE(SUM(total_sheet_kg::numeric), 0) AS sheet,
        COALESCE(SUM(total_scrap_kg::numeric), 0) AS scrap
      FROM production_batches
      WHERE project_id = ${pid}::uuid
      GROUP BY status
    `),

    // Average daily output by month
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', batch_date::timestamp), 'YYYY-MM') AS month,
        COUNT(*) AS batch_count,
        COALESCE(SUM(total_sheet_kg::numeric), 0) AS sheet_total,
        COALESCE(SUM(total_latex_litres::numeric), 0) AS latex_total,
        COALESCE(SUM(total_scrap_kg::numeric), 0) AS scrap_total,
        COALESCE(AVG(total_sheet_kg::numeric), 0) AS avg_sheet_per_batch,
        COALESCE(AVG(total_latex_litres::numeric), 0) AS avg_latex_per_batch
      FROM production_batches
      WHERE project_id = ${pid}::uuid AND status != 'voided'
      GROUP BY DATE_TRUNC('month', batch_date::timestamp)
      ORDER BY DATE_TRUNC('month', batch_date::timestamp)
    `),
  ]);

  return res.json({
    batches: (batchesWithSales.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), batchNumber: String(r.batch_number), batchDate: String(r.batch_date),
      status: String(r.status), entryCount: Number(r.entry_count),
      latexLitres: toF3(toNum(r.latex)), sheetKg: toF3(toNum(r.sheet)), scrapKg: toF3(toNum(r.scrap)),
      createdByName: String(r.created_by_name),
      closedAt: r.closed_at ?? null,
      linkedSaleCount: Number(r.linked_sale_count),
      linkedGross: toF2(toNum(r.linked_gross)),
      linkedQty: toF3(toNum(r.linked_qty)),
      lastSaleDate: r.last_sale_date ? String(r.last_sale_date) : null,
      isSold: Number(r.linked_sale_count) > 0,
    })),
    statusSummary: (statusSummary.rows as Record<string, unknown>[]).map(r => ({
      status: String(r.status), count: Number(r.cnt),
      latexLitres: toF3(toNum(r.latex)), sheetKg: toF3(toNum(r.sheet)), scrapKg: toF3(toNum(r.scrap)),
    })),
    monthlyOutput: (avgDailyOutput.rows as Record<string, unknown>[]).map(r => ({
      month: String(r.month), batchCount: Number(r.batch_count),
      sheetTotal: toF3(toNum(r.sheet_total)), latexTotal: toF3(toNum(r.latex_total)), scrapTotal: toF3(toNum(r.scrap_total)),
      avgSheetPerBatch: toF3(toNum(r.avg_sheet_per_batch)), avgLatexPerBatch: toF3(toNum(r.avg_latex_per_batch)),
    })),
  });
});

// ── GET /operational-analytics/inventory?projectId= ──────────────────────

router.get("/inventory", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [movements, balances, monthlyMovements, movementsByType, aging] = await Promise.all([
    // Recent stock movements
    db.execute(sql`
      SELECT
        ism.id, ism.stock_type, ism.movement_type, ism.direction,
        ism.quantity::numeric AS qty, ism.unit, ism.movement_date,
        ism.reference_id, ism.reference_type, ism.notes, ism.status,
        ism.created_by_name, ism.created_at,
        pb.batch_number
      FROM inventory_stock_movements ism
      LEFT JOIN production_batches pb ON pb.id = ism.batch_id
      WHERE ism.project_id = ${pid}::uuid AND ism.is_active = true
      ORDER BY ism.movement_date DESC, ism.created_at DESC
      LIMIT 300
    `),

    // Current balance per stock type (running ledger)
    db.execute(sql`
      SELECT
        stock_type, unit,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'in' AND status = 'confirmed'), 0) AS total_in,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0) AS total_out,
        COALESCE(SUM(CASE WHEN direction = 'in' AND status = 'confirmed' THEN quantity::numeric
                         WHEN direction = 'out' AND status = 'confirmed' THEN -quantity::numeric ELSE 0 END), 0) AS balance,
        COUNT(*) FILTER (WHERE movement_type = 'production_in') AS production_in_count,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'production_in'), 0) AS production_in_qty,
        COUNT(*) FILTER (WHERE movement_type = 'sale_out') AS sale_out_count,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'sale_out'), 0) AS sale_out_qty,
        COUNT(*) FILTER (WHERE movement_type = 'wastage') AS wastage_count,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'wastage'), 0) AS wastage_qty,
        COUNT(*) FILTER (WHERE movement_type LIKE 'adjustment%') AS adjustment_count,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'adjustment_in'), 0) AS adj_in_qty,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'adjustment_out'), 0) AS adj_out_qty,
        MAX(movement_date) AS last_movement
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY stock_type, unit
    `),

    // Monthly inventory flow (in vs out)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', movement_date::timestamp), 'YYYY-MM') AS month,
        stock_type,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'in' AND status = 'confirmed'), 0) AS total_in,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0) AS total_out,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'wastage' AND status = 'confirmed'), 0) AS wastage,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE movement_type = 'sale_out' AND status = 'confirmed'), 0) AS sold,
        COUNT(*) AS movement_count
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY DATE_TRUNC('month', movement_date::timestamp), stock_type
      ORDER BY DATE_TRUNC('month', movement_date::timestamp), stock_type
    `),

    // Movements by type summary
    db.execute(sql`
      SELECT
        movement_type, direction, stock_type,
        COUNT(*) AS cnt,
        COALESCE(SUM(quantity::numeric), 0) AS total_qty
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND is_active = true AND status = 'confirmed'
      GROUP BY movement_type, direction, stock_type
      ORDER BY movement_type, stock_type
    `),

    // Stock aging — how old is current stock? (oldest production_in without matching sale)
    db.execute(sql`
      SELECT
        stock_type,
        MIN(movement_date) AS oldest_in,
        MAX(movement_date) AS newest_in,
        EXTRACT(DAY FROM NOW() - MIN(movement_date::timestamp))::integer AS oldest_age_days,
        COUNT(*) FILTER (WHERE movement_type = 'production_in') AS production_batches,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'in' AND status = 'confirmed'), 0) AS total_ever_in,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0) AS total_ever_out
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY stock_type
    `),
  ]);

  // Pivot monthly movements → unified structure
  const monthlyByStock: Record<string, Record<string, { totalIn: number; totalOut: number; wastage: number; sold: number; count: number }>> = {};
  for (const r of monthlyMovements.rows as Record<string, unknown>[]) {
    const m = String(r.month);
    const st = String(r.stock_type);
    if (!monthlyByStock[m]) monthlyByStock[m] = {};
    monthlyByStock[m][st] = {
      totalIn: toF3(toNum(r.total_in)), totalOut: toF3(toNum(r.total_out)),
      wastage: toF3(toNum(r.wastage)), sold: toF3(toNum(r.sold)), count: Number(r.movement_count),
    };
  }

  const allMonths = Object.keys(monthlyByStock).sort();
  const monthlyTrend = allMonths.map(m => ({
    month: m,
    latex: monthlyByStock[m]["latex"] ?? { totalIn: 0, totalOut: 0, wastage: 0, sold: 0, count: 0 },
    rubber_sheet: monthlyByStock[m]["rubber_sheet"] ?? { totalIn: 0, totalOut: 0, wastage: 0, sold: 0, count: 0 },
    rubber_scrap: monthlyByStock[m]["rubber_scrap"] ?? { totalIn: 0, totalOut: 0, wastage: 0, sold: 0, count: 0 },
  }));

  return res.json({
    movements: (movements.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), stockType: String(r.stock_type), movementType: String(r.movement_type),
      direction: String(r.direction), quantity: toF3(toNum(r.qty)), unit: String(r.unit),
      movementDate: String(r.movement_date), referenceId: r.reference_id ? String(r.reference_id) : null,
      referenceType: r.reference_type ? String(r.reference_type) : null,
      notes: r.notes ? String(r.notes) : null, status: String(r.status),
      createdByName: String(r.created_by_name), batchNumber: r.batch_number ? String(r.batch_number) : null,
      createdAt: r.created_at ?? null,
    })),
    balances: (balances.rows as Record<string, unknown>[]).map(r => ({
      stockType: String(r.stock_type), unit: String(r.unit),
      totalIn: toF3(toNum(r.total_in)), totalOut: toF3(toNum(r.total_out)),
      balance: toF3(toNum(r.balance)),
      productionInCount: Number(r.production_in_count), productionInQty: toF3(toNum(r.production_in_qty)),
      saleOutCount: Number(r.sale_out_count), saleOutQty: toF3(toNum(r.sale_out_qty)),
      wastageCount: Number(r.wastage_count), wastageQty: toF3(toNum(r.wastage_qty)),
      adjustmentCount: Number(r.adjustment_count),
      adjInQty: toF3(toNum(r.adj_in_qty)), adjOutQty: toF3(toNum(r.adj_out_qty)),
      lastMovement: r.last_movement ? String(r.last_movement) : null,
      utilizationRate: toNum(r.total_in) > 0 ? toF2((toNum(r.total_out) / toNum(r.total_in)) * 100) : 0,
    })),
    monthlyTrend,
    movementsByType: (movementsByType.rows as Record<string, unknown>[]).map(r => ({
      movementType: String(r.movement_type), direction: String(r.direction),
      stockType: String(r.stock_type), count: Number(r.cnt), totalQty: toF3(toNum(r.total_qty)),
    })),
    aging: (aging.rows as Record<string, unknown>[]).map(r => ({
      stockType: String(r.stock_type),
      oldestIn: r.oldest_in ? String(r.oldest_in) : null, newestIn: r.newest_in ? String(r.newest_in) : null,
      oldestAgeDays: Number(r.oldest_age_days), productionBatches: Number(r.production_batches),
      totalEverIn: toF3(toNum(r.total_ever_in)), totalEverOut: toF3(toNum(r.total_ever_out)),
      estimatedBalance: toF3(toNum(r.total_ever_in) - toNum(r.total_ever_out)),
    })),
  });
});

// ── GET /operational-analytics/sales?projectId=&year= ────────────────────

router.get("/sales", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;
  const pid = projectId;

  const [transactions, monthlyRevenue, byProductType, deductionBreakdown, topRates, salesOrders] = await Promise.all([
    // Transaction list
    db.execute(sql`
      SELECT
        st.id, st.sale_number, st.sale_date, st.buyer_name, st.status,
        st.total_gross_revenue::numeric AS gross, st.total_deductions::numeric AS deductions,
        st.total_net_revenue::numeric AS net, st.notes, st.document_ref,
        st.confirmed_at, st.confirmed_by_name, st.created_at
      FROM sales_transactions st
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM st.sale_date::timestamp) = ${yearInt}` : sql``}
      ORDER BY st.sale_date DESC
      LIMIT 200
    `),

    // Monthly revenue trend
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', st.sale_date::timestamp), 'YYYY-MM') AS month,
        COUNT(*) AS transaction_count,
        COALESCE(SUM(st.total_gross_revenue::numeric), 0) AS gross,
        COALESCE(SUM(st.total_deductions::numeric), 0) AS deductions,
        COALESCE(SUM(st.total_net_revenue::numeric), 0) AS net,
        COUNT(DISTINCT st.buyer_id) AS buyer_count
      FROM sales_transactions st
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
        ${yearInt ? sql`AND EXTRACT(YEAR FROM st.sale_date::timestamp) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', st.sale_date::timestamp)
      ORDER BY DATE_TRUNC('month', st.sale_date::timestamp)
    `),

    // By product type (from line items)
    db.execute(sql`
      SELECT
        sli.product_type,
        sli.unit,
        COUNT(*) AS line_count,
        COUNT(DISTINCT sli.transaction_id) AS transaction_count,
        COALESCE(SUM(sli.quantity::numeric), 0) AS total_qty,
        COALESCE(SUM(sli.gross_amount::numeric), 0) AS total_gross,
        AVG(sli.sale_rate::numeric) AS avg_rate,
        MAX(sli.sale_rate::numeric) AS max_rate,
        MIN(sli.sale_rate::numeric) AS min_rate
      FROM sales_line_items sli
      JOIN sales_transactions st ON st.id = sli.transaction_id
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
        ${yearInt ? sql`AND EXTRACT(YEAR FROM st.sale_date::timestamp) = ${yearInt}` : sql``}
      GROUP BY sli.product_type, sli.unit
      ORDER BY SUM(sli.gross_amount::numeric) DESC NULLS LAST
    `),

    // Deduction breakdown by type
    db.execute(sql`
      SELECT
        sd.deduction_type,
        COUNT(*) AS cnt,
        COALESCE(SUM(sd.amount::numeric), 0) AS total_amount,
        AVG(sd.amount::numeric) AS avg_amount
      FROM sales_deductions sd
      JOIN sales_transactions st ON st.id = sd.transaction_id
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
        ${yearInt ? sql`AND EXTRACT(YEAR FROM st.sale_date::timestamp) = ${yearInt}` : sql``}
      GROUP BY sd.deduction_type
      ORDER BY SUM(sd.amount::numeric) DESC
    `),

    // Rate trends (monthly avg rate per product)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', st.sale_date::timestamp), 'YYYY-MM') AS month,
        sli.product_type,
        AVG(sli.sale_rate::numeric) AS avg_rate,
        COALESCE(SUM(sli.quantity::numeric), 0) AS total_qty
      FROM sales_line_items sli
      JOIN sales_transactions st ON st.id = sli.transaction_id
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
        AND sli.sale_rate IS NOT NULL
        ${yearInt ? sql`AND EXTRACT(YEAR FROM st.sale_date::timestamp) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', st.sale_date::timestamp), sli.product_type
      ORDER BY DATE_TRUNC('month', st.sale_date::timestamp), sli.product_type
    `),

    // Sales orders status summary
    db.execute(sql`
      SELECT
        order_status, payment_status,
        COUNT(*) AS cnt,
        COALESCE(SUM(total_amount::numeric), 0) AS total_amount,
        COALESCE(SUM(quantity_kg::numeric), 0) AS total_qty
      FROM sales_orders
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY order_status, payment_status
      ORDER BY COUNT(*) DESC
    `),
  ]);

  // Pivot rate trends
  const rateMap: Record<string, Record<string, number>> = {};
  for (const r of topRates.rows as Record<string, unknown>[]) {
    const m = String(r.month); const pt = String(r.product_type);
    if (!rateMap[m]) rateMap[m] = {};
    rateMap[m][pt] = toF2(toNum(r.avg_rate));
  }
  const rateTrend = Object.entries(rateMap).sort(([a], [b]) => a.localeCompare(b)).map(([month, rates]) => ({ month, ...rates }));

  return res.json({
    transactions: (transactions.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), saleNumber: String(r.sale_number), saleDate: String(r.sale_date),
      buyerName: String(r.buyer_name), status: String(r.status),
      gross: toF2(toNum(r.gross)), deductions: toF2(toNum(r.deductions)), net: toF2(toNum(r.net)),
      notes: r.notes ? String(r.notes) : null, documentRef: r.document_ref ? String(r.document_ref) : null,
      confirmedAt: r.confirmed_at ?? null, confirmedByName: r.confirmed_by_name ? String(r.confirmed_by_name) : null,
      createdAt: r.created_at ?? null,
    })),
    monthlyRevenue: (monthlyRevenue.rows as Record<string, unknown>[]).map(r => ({
      month: String(r.month), transactionCount: Number(r.transaction_count),
      gross: toF2(toNum(r.gross)), deductions: toF2(toNum(r.deductions)), net: toF2(toNum(r.net)),
      buyerCount: Number(r.buyer_count),
    })),
    byProductType: (byProductType.rows as Record<string, unknown>[]).map(r => ({
      productType: String(r.product_type), unit: String(r.unit),
      lineCount: Number(r.line_count), transactionCount: Number(r.transaction_count),
      totalQty: toF3(toNum(r.total_qty)), totalGross: toF2(toNum(r.total_gross)),
      avgRate: toF2(toNum(r.avg_rate)), maxRate: toF2(toNum(r.max_rate)), minRate: toF2(toNum(r.min_rate)),
    })),
    deductionBreakdown: (deductionBreakdown.rows as Record<string, unknown>[]).map(r => ({
      deductionType: String(r.deduction_type), count: Number(r.cnt),
      totalAmount: toF2(toNum(r.total_amount)), avgAmount: toF2(toNum(r.avg_amount)),
    })),
    rateTrend,
    ordersStatus: (salesOrders.rows as Record<string, unknown>[]).map(r => ({
      orderStatus: String(r.order_status), paymentStatus: String(r.payment_status),
      count: Number(r.cnt), totalAmount: toF2(toNum(r.total_amount)), totalQty: toF3(toNum(r.total_qty)),
    })),
  });
});

// ── GET /operational-analytics/wastage?projectId= ────────────────────────

router.get("/wastage", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [wastageEvents, byStockType, monthlyWastage, wastageVsProduction] = await Promise.all([
    // All wastage events
    db.execute(sql`
      SELECT
        ism.id, ism.stock_type, ism.quantity::numeric AS qty, ism.unit,
        ism.movement_date, ism.notes, ism.status,
        ism.created_by_name, ism.created_at,
        pb.batch_number
      FROM inventory_stock_movements ism
      LEFT JOIN production_batches pb ON pb.id = ism.batch_id
      WHERE ism.project_id = ${pid}::uuid AND ism.movement_type = 'wastage'
        AND ism.is_active = true
      ORDER BY ism.movement_date DESC
    `),

    // Wastage by stock type
    db.execute(sql`
      SELECT
        stock_type, unit,
        COUNT(*) AS event_count,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE status = 'confirmed'), 0) AS total_wastage,
        AVG(quantity::numeric) FILTER (WHERE status = 'confirmed') AS avg_per_event,
        MAX(movement_date) AS last_event
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND movement_type = 'wastage' AND is_active = true
      GROUP BY stock_type, unit
    `),

    // Monthly wastage trend
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', movement_date::timestamp), 'YYYY-MM') AS month,
        stock_type,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE status = 'confirmed'), 0) AS wastage_qty,
        COUNT(*) AS event_count
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid AND movement_type = 'wastage' AND is_active = true
      GROUP BY DATE_TRUNC('month', movement_date::timestamp), stock_type
      ORDER BY DATE_TRUNC('month', movement_date::timestamp), stock_type
    `),

    // Wastage rate vs production (monthly)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', m.movement_date::timestamp), 'YYYY-MM') AS month,
        m.stock_type,
        COALESCE(SUM(m.quantity::numeric) FILTER (WHERE m.movement_type = 'wastage' AND m.status = 'confirmed'), 0) AS wastage,
        COALESCE(SUM(m.quantity::numeric) FILTER (WHERE m.movement_type = 'production_in' AND m.status = 'confirmed'), 0) AS production_in,
        COALESCE(SUM(m.quantity::numeric) FILTER (WHERE m.movement_type = 'sale_out' AND m.status = 'confirmed'), 0) AS sold
      FROM inventory_stock_movements m
      WHERE m.project_id = ${pid}::uuid AND m.is_active = true
      GROUP BY DATE_TRUNC('month', m.movement_date::timestamp), m.stock_type
      ORDER BY DATE_TRUNC('month', m.movement_date::timestamp), m.stock_type
    `),
  ]);

  // Compute wastage rates per month/type
  const wastageRates = (wastageVsProduction.rows as Record<string, unknown>[]).map(r => {
    const w = toF3(toNum(r.wastage)); const p = toF3(toNum(r.production_in)); const s = toF3(toNum(r.sold));
    const rate = (p + w) > 0 ? toF2((w / (p + w)) * 100) : 0;
    return { month: String(r.month), stockType: String(r.stock_type), wastage: w, productionIn: p, sold: s, wastageRate: rate };
  });

  return res.json({
    events: (wastageEvents.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id), stockType: String(r.stock_type), quantity: toF3(toNum(r.qty)), unit: String(r.unit),
      movementDate: String(r.movement_date), notes: r.notes ? String(r.notes) : null, status: String(r.status),
      createdByName: String(r.created_by_name), batchNumber: r.batch_number ? String(r.batch_number) : null,
      createdAt: r.created_at ?? null,
    })),
    byStockType: (byStockType.rows as Record<string, unknown>[]).map(r => ({
      stockType: String(r.stock_type), unit: String(r.unit), eventCount: Number(r.event_count),
      totalWastage: toF3(toNum(r.total_wastage)), avgPerEvent: toF3(toNum(r.avg_per_event)),
      lastEvent: r.last_event ? String(r.last_event) : null,
    })),
    monthlyWastage: (monthlyWastage.rows as Record<string, unknown>[]).map(r => ({
      month: String(r.month), stockType: String(r.stock_type),
      wastageQty: toF3(toNum(r.wastage_qty)), eventCount: Number(r.event_count),
    })),
    wastageRates,
    totalWastageEvents: wastageEvents.rows.length,
    totalWastageQty: toF3((wastageEvents.rows as Record<string, unknown>[]).reduce((s, r) => s + toNum(r.qty), 0)),
  });
});

// ── GET /operational-analytics/buyers?projectId= ─────────────────────────

router.get("/buyers", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!((req.canAccessAllProjects === true || (req.userProjectIds ?? []).includes(projectId)))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [buyerTotals, buyerByProduct, buyerMonthly, rateAnalysis, ordersBySeller] = await Promise.all([
    // Per-buyer sales totals
    db.execute(sql`
      SELECT
        st.buyer_id, st.buyer_name,
        COUNT(*) AS transaction_count,
        COALESCE(SUM(st.total_gross_revenue::numeric), 0) AS total_gross,
        COALESCE(SUM(st.total_deductions::numeric), 0) AS total_deductions,
        COALESCE(SUM(st.total_net_revenue::numeric), 0) AS total_net,
        MIN(st.sale_date) AS first_purchase, MAX(st.sale_date) AS last_purchase,
        COALESCE(SUM(sli.quantity::numeric), 0) AS total_qty_purchased
      FROM sales_transactions st
      LEFT JOIN sales_line_items sli ON sli.transaction_id = st.id
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
      GROUP BY st.buyer_id, st.buyer_name
      ORDER BY SUM(st.total_net_revenue::numeric) DESC NULLS LAST
    `),

    // Buyer product preferences
    db.execute(sql`
      SELECT
        st.buyer_name, sli.product_type, sli.unit,
        COALESCE(SUM(sli.quantity::numeric), 0) AS total_qty,
        COALESCE(SUM(sli.gross_amount::numeric), 0) AS total_gross,
        AVG(sli.sale_rate::numeric) AS avg_rate,
        COUNT(*) AS line_count
      FROM sales_line_items sli
      JOIN sales_transactions st ON st.id = sli.transaction_id
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
      GROUP BY st.buyer_name, sli.product_type, sli.unit
      ORDER BY st.buyer_name, SUM(sli.gross_amount::numeric) DESC NULLS LAST
    `),

    // Monthly purchase frequency per buyer
    db.execute(sql`
      SELECT
        st.buyer_name,
        TO_CHAR(DATE_TRUNC('month', st.sale_date::timestamp), 'YYYY-MM') AS month,
        COUNT(*) AS purchases,
        COALESCE(SUM(st.total_net_revenue::numeric), 0) AS net
      FROM sales_transactions st
      WHERE st.project_id = ${pid}::uuid AND st.is_active = true AND st.status = 'confirmed'
      GROUP BY st.buyer_name, DATE_TRUNC('month', st.sale_date::timestamp)
      ORDER BY st.buyer_name, DATE_TRUNC('month', st.sale_date::timestamp)
    `),

    // Rate analysis from sales orders
    db.execute(sql`
      SELECT
        so.buyer_name,
        COUNT(*) AS order_count,
        AVG(so.rate_per_kg::numeric) AS avg_rate,
        MAX(so.rate_per_kg::numeric) AS max_rate,
        MIN(so.rate_per_kg::numeric) AS min_rate,
        COALESCE(SUM(so.quantity_kg::numeric), 0) AS total_qty,
        COALESCE(SUM(so.total_amount::numeric), 0) AS total_amount
      FROM sales_orders so
      WHERE so.project_id = ${pid}::uuid AND so.order_status = 'completed'
      GROUP BY so.buyer_name
      ORDER BY SUM(so.total_amount::numeric) DESC NULLS LAST
    `),

    // Seller/staff performance from orders
    db.execute(sql`
      SELECT
        so.seller_name, so.seller_role,
        COUNT(*) AS order_count,
        COUNT(*) FILTER (WHERE so.order_status = 'completed') AS completed,
        COALESCE(SUM(so.total_amount::numeric) FILTER (WHERE so.order_status = 'completed'), 0) AS total_revenue
      FROM sales_orders so
      WHERE so.project_id = ${pid}::uuid AND so.seller_name != ''
      GROUP BY so.seller_name, so.seller_role
      ORDER BY SUM(so.total_amount::numeric) FILTER (WHERE so.order_status = 'completed') DESC NULLS LAST
      LIMIT 20
    `),
  ]);

  return res.json({
    buyerTotals: (buyerTotals.rows as Record<string, unknown>[]).map((r, i) => ({
      rank: i + 1,
      buyerId: r.buyer_id ? String(r.buyer_id) : null,
      buyerName: String(r.buyer_name),
      transactionCount: Number(r.transaction_count),
      totalGross: toF2(toNum(r.total_gross)),
      totalDeductions: toF2(toNum(r.total_deductions)),
      totalNet: toF2(toNum(r.total_net)),
      totalQtyPurchased: toF3(toNum(r.total_qty_purchased)),
      firstPurchase: r.first_purchase ? String(r.first_purchase) : null,
      lastPurchase: r.last_purchase ? String(r.last_purchase) : null,
    })),
    byProduct: (buyerByProduct.rows as Record<string, unknown>[]).map(r => ({
      buyerName: String(r.buyer_name), productType: String(r.product_type), unit: String(r.unit),
      totalQty: toF3(toNum(r.total_qty)), totalGross: toF2(toNum(r.total_gross)),
      avgRate: toF2(toNum(r.avg_rate)), lineCount: Number(r.line_count),
    })),
    monthlyFrequency: (buyerMonthly.rows as Record<string, unknown>[]).map(r => ({
      buyerName: String(r.buyer_name), month: String(r.month),
      purchases: Number(r.purchases), net: toF2(toNum(r.net)),
    })),
    rateAnalysis: (rateAnalysis.rows as Record<string, unknown>[]).map(r => ({
      buyerName: String(r.buyer_name), orderCount: Number(r.order_count),
      avgRate: toF2(toNum(r.avg_rate)), maxRate: toF2(toNum(r.max_rate)), minRate: toF2(toNum(r.min_rate)),
      totalQty: toF3(toNum(r.total_qty)), totalAmount: toF2(toNum(r.total_amount)),
    })),
    sellerPerformance: (ordersBySeller.rows as Record<string, unknown>[]).map(r => ({
      sellerName: String(r.seller_name), sellerRole: r.seller_role ? String(r.seller_role) : null,
      orderCount: Number(r.order_count), completed: Number(r.completed),
      totalRevenue: toF2(toNum(r.total_revenue)),
      completionRate: Number(r.order_count) > 0 ? toF2((Number(r.completed) / Number(r.order_count)) * 100) : 0,
    })),
  });
});

export default router;
