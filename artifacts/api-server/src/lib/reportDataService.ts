/**
 * reportDataService.ts
 *
 * Fetches structured data for each report type from the database.
 * Returns ReportData objects ready for PDF/Excel generation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { db, toMoney } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { ReportData, ReportMeta } from "./reportGenerator";

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (v instanceof Date) return v.toLocaleDateString("en-IN");
  const s = String(v);
  // Format ISO dates nicely
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    try { return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return s; }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${d} ${months[parseInt(m)-1]} ${y}`;
  }
  return s.replace(/_/g, " ");
};

const fmtNum = (v: unknown) => {
  const n = toMoney(v as string | number | null | undefined).toNumber();
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const toN = (v: unknown): number =>
  toMoney(v as string | number | null | undefined).toNumber();

// ── FINANCIAL REPORT ──────────────────────────────────────────────────────────

export async function fetchFinancialReportData(
  projectId: string, dateStart?: string | null, dateEnd?: string | null
): Promise<ReportData> {
  const dsFilter = dateStart ? `AND created_at >= '${dateStart}'::date` : "";
  const deFilter = dateEnd ? `AND created_at <= '${dateEnd}'::date + interval '1 day'` : "";

  const [contrib, expend, salesRows, distRows, lcaRows] = await Promise.all([
    db.execute(sql.raw(`
      SELECT p.name AS partner_name, c.contribution_type, c.amount::numeric,
             c.status, c.verified_at::text, c.created_at::text
      FROM contributions c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.project_id = '${projectId}'::uuid AND c.is_active = true
      ${dsFilter} ${deFilter}
      ORDER BY c.created_at DESC
      LIMIT 1000
    `)),
    db.execute(sql.raw(`
      SELECT e.description, e.category, e.amount::numeric,
             e.status, e.expense_date::text, e.verified_by_name, e.created_at::text
      FROM expenditures e
      WHERE e.project_id = '${projectId}'::uuid AND e.is_active = true
      ${dsFilter} ${deFilter}
      ORDER BY e.expense_date DESC NULLS LAST
      LIMIT 1000
    `)),
    db.execute(sql.raw(`
      SELECT s.invoice_number, s.product_type, s.gross_weight_kg::numeric,
             s.net_weight_kg::numeric, s.rate_per_kg::numeric, s.gross_amount::numeric,
             s.net_amount::numeric, s.sale_date::text, s.status
      FROM sales s
      WHERE s.project_id = '${projectId}'::uuid AND s.is_active = true
      ${dsFilter} ${deFilter}
      ORDER BY s.sale_date DESC NULLS LAST
      LIMIT 500
    `)),
    db.execute(sql.raw(`
      SELECT dr.period_label, p.name AS partner_name,
             dr.gross_entitlement::numeric, dr.deductions::numeric, dr.net_payable::numeric,
             dr.status, dr.settled_at::text
      FROM distribution_records dr
      JOIN partners p ON p.id = dr.partner_id
      WHERE dr.project_id = '${projectId}'::uuid AND dr.is_active = true
      ${dsFilter} ${deFilter}
      ORDER BY dr.settled_at DESC NULLS LAST
      LIMIT 500
    `)),
    db.execute(sql.raw(`
      SELECT p.name AS partner_name, l.year, l.opening_balance::numeric,
             l.annual_land_value::numeric, l.adjustment_amount::numeric,
             l.carry_forward_amount::numeric, l.is_settled
      FROM lca_ledger l
      JOIN partners p ON p.id = l.partner_id
      WHERE l.project_id = '${projectId}'::uuid
      ORDER BY l.year, p.name
      LIMIT 500
    `)),
  ]);

  const contributions = contrib.rows as Record<string,unknown>[];
  const expenditures = expend.rows as Record<string,unknown>[];
  const sales = salesRows.rows as Record<string,unknown>[];
  const distributions = distRows.rows as Record<string,unknown>[];
  const lca = lcaRows.rows as Record<string,unknown>[];

  const totalContrib = contributions.filter(r => r.status === "verified")
    .reduce((s, r) => s + toN(r.amount), 0);
  const totalExpend = expenditures.filter(r => r.status === "approved")
    .reduce((s, r) => s + toN(r.amount), 0);
  const totalSalesGross = sales.reduce((s, r) => s + toN(r.gross_amount), 0);
  const totalSalesNet = sales.reduce((s, r) => s + toN(r.net_amount), 0);
  const totalDistributed = distributions.reduce((s, r) => s + toN(r.net_payable), 0);

  return {
    summary: {
      "Verified Contributions": `₹${fmtNum(totalContrib)}`,
      "Approved Expenditures": `₹${fmtNum(totalExpend)}`,
      "Gross Sales Revenue": `₹${fmtNum(totalSalesGross)}`,
      "Net Sales Revenue": `₹${fmtNum(totalSalesNet)}`,
      "Total Distributed": `₹${fmtNum(totalDistributed)}`,
      "Contribution Records": String(contributions.length),
      "Expenditure Records": String(expenditures.length),
      "Sales Transactions": String(sales.length),
    },
    sections: [
      {
        title: "Partner Contributions",
        subtitle: `${contributions.length} records`,
        columns: ["Partner", "Type", "Amount (₹)", "Status", "Verified At", "Created"],
        rows: contributions.map(r => [
          fmt(r.partner_name), fmt(r.contribution_type), fmtNum(r.amount),
          fmt(r.status), fmt(r.verified_at), fmt(r.created_at),
        ]),
        totals: ["TOTAL VERIFIED", "", `₹${fmtNum(totalContrib)}`, "", "", ""],
      },
      {
        title: "Expenditures",
        subtitle: `${expenditures.length} records`,
        columns: ["Description", "Category", "Amount (₹)", "Status", "Date", "Verified By", "Created"],
        rows: expenditures.map(r => [
          fmt(r.description), fmt(r.category), fmtNum(r.amount),
          fmt(r.status), fmt(r.expense_date), fmt(r.verified_by_name), fmt(r.created_at),
        ]),
        totals: ["TOTAL APPROVED", "", `₹${fmtNum(totalExpend)}`, "", "", "", ""],
      },
      {
        title: "Sales Transactions",
        subtitle: `${sales.length} records`,
        columns: ["Invoice", "Product", "Gross Wt (kg)", "Net Wt (kg)", "Rate/kg", "Gross Amt (₹)", "Net Amt (₹)", "Date", "Status"],
        rows: sales.map(r => [
          fmt(r.invoice_number), fmt(r.product_type),
          fmtNum(r.gross_weight_kg), fmtNum(r.net_weight_kg), fmtNum(r.rate_per_kg),
          fmtNum(r.gross_amount), fmtNum(r.net_amount), fmt(r.sale_date), fmt(r.status),
        ]),
        totals: ["TOTALS", "", "", "", "", `₹${fmtNum(totalSalesGross)}`, `₹${fmtNum(totalSalesNet)}`, "", ""],
      },
      {
        title: "Distribution Records",
        subtitle: `${distributions.length} records`,
        columns: ["Period", "Partner", "Gross Entitlement (₹)", "Deductions (₹)", "Net Payable (₹)", "Status", "Settled At"],
        rows: distributions.map(r => [
          fmt(r.period_label), fmt(r.partner_name),
          fmtNum(r.gross_entitlement), fmtNum(r.deductions), fmtNum(r.net_payable),
          fmt(r.status), fmt(r.settled_at),
        ]),
        totals: ["TOTALS", "", `₹${fmtNum(distributions.reduce((s,r)=>s+toN(r.gross_entitlement),0))}`, `₹${fmtNum(distributions.reduce((s,r)=>s+toN(r.deductions),0))}`, `₹${fmtNum(totalDistributed)}`, "", ""],
      },
      {
        title: "LCA Ledger",
        subtitle: `Land Contribution Adjustment history`,
        columns: ["Partner", "Year", "Opening Balance (₹)", "Annual Land Value (₹)", "Adjustment (₹)", "Carry Forward (₹)", "Settled"],
        rows: lca.map(r => [
          fmt(r.partner_name), fmt(r.year),
          fmtNum(r.opening_balance), fmtNum(r.annual_land_value),
          fmtNum(r.adjustment_amount), fmtNum(r.carry_forward_amount),
          r.is_settled ? "Yes" : "No",
        ]),
      },
    ],
  };
}

// ── PROJECT REPORT ────────────────────────────────────────────────────────────

export async function fetchProjectReportData(
  projectId: string
): Promise<ReportData> {
  const [projInfo, partners, lifecycle, agreements, milestones] = await Promise.all([
    db.execute(sql.raw(`
      SELECT p.name, p.project_code, p.commercial_model, p.lifecycle_status,
             p.activation_status, p.start_date::text, p.description,
             p.district, p.state,
             COUNT(DISTINCT pp.partner_id) AS partner_count
      FROM projects p
      LEFT JOIN project_participants pp ON pp.project_id = p.id
      WHERE p.id = '${projectId}'::uuid
      GROUP BY p.id
    `)),
    db.execute(sql.raw(`
      SELECT p.name, p.pan_number, p.phone, p.address,
             pp.participation_type, pp.ownership_pct::numeric, pp.is_active, pp.joined_at::text
      FROM project_participants pp
      JOIN partners p ON p.id = pp.partner_id
      WHERE pp.project_id = '${projectId}'::uuid
      ORDER BY pp.ownership_pct DESC NULLS LAST
    `)),
    db.execute(sql.raw(`
      SELECT lifecycle_status AS status, transition_date::text, notes, transitioned_by_name
      FROM project_lifecycle_history
      WHERE project_id = '${projectId}'::uuid
      ORDER BY transition_date ASC
    `)),
    db.execute(sql.raw(`
      SELECT a.title, a.agreement_type, a.status, a.effective_date::text, a.expiry_date::text,
             p.name AS partner_name
      FROM agreements a
      JOIN partners p ON p.id = a.partner_id
      WHERE a.project_id = '${projectId}'::uuid AND a.is_active = true
      ORDER BY a.effective_date DESC NULLS LAST
      LIMIT 200
    `)),
    db.execute(sql.raw(`
      SELECT event_type, event_date::text, description, recorded_by_name
      FROM project_timeline
      WHERE project_id = '${projectId}'::uuid
      ORDER BY event_date DESC NULLS LAST
      LIMIT 100
    `)).catch(() => ({ rows: [] })),
  ]);

  const proj = (projInfo.rows[0] ?? {}) as Record<string,unknown>;
  const partnerRows = partners.rows as Record<string,unknown>[];
  const lifecycleRows = lifecycle.rows as Record<string,unknown>[];
  const agreementRows = agreements.rows as Record<string,unknown>[];
  const timelineRows = milestones.rows as Record<string,unknown>[];

  const totalOwnership = partnerRows.reduce((s, r) => s + toN(r.ownership_pct), 0);

  return {
    summary: {
      "Commercial Model": fmt(proj.commercial_model),
      "Lifecycle Status": fmt(proj.lifecycle_status),
      "Activation Status": fmt(proj.activation_status),
      "Total Partners": String(partnerRows.length),
      "Total Ownership Assigned": `${fmtNum(totalOwnership)}%`,
      "Start Date": fmt(proj.start_date),
      "Agreements": String(agreementRows.length),
      "Location": [proj.district, proj.state].filter(Boolean).join(", ") || "—",
    },
    sections: [
      {
        title: "Partner & Ownership Details",
        subtitle: `${partnerRows.length} participants`,
        columns: ["Partner Name", "PAN", "Phone", "Type", "Ownership %", "Active", "Joined"],
        rows: partnerRows.map(r => [
          fmt(r.name), fmt(r.pan_number), fmt(r.phone),
          fmt(r.participation_type), fmtNum(r.ownership_pct),
          r.is_active ? "Yes" : "No", fmt(r.joined_at),
        ]),
        totals: ["TOTAL", "", "", "", `${fmtNum(totalOwnership)}%`, "", ""],
      },
      {
        title: "Agreements",
        subtitle: `Active agreements on record`,
        columns: ["Title", "Type", "Partner", "Status", "Effective Date", "Expiry Date"],
        rows: agreementRows.map(r => [
          fmt(r.title), fmt(r.agreement_type), fmt(r.partner_name),
          fmt(r.status), fmt(r.effective_date), fmt(r.expiry_date),
        ]),
      },
      {
        title: "Lifecycle History",
        columns: ["Status", "Date", "Notes", "Transitioned By"],
        rows: lifecycleRows.map(r => [
          fmt(r.status), fmt(r.transition_date), fmt(r.notes), fmt(r.transitioned_by_name),
        ]),
      },
      ...(timelineRows.length > 0 ? [{
        title: "Project Timeline Events",
        columns: ["Event Type", "Date", "Description", "Recorded By"],
        rows: timelineRows.map(r => [
          fmt(r.event_type), fmt(r.event_date), fmt(r.description), fmt(r.recorded_by_name),
        ]),
      }] : []),
    ],
  };
}

// ── OWNERSHIP REPORT ──────────────────────────────────────────────────────────

export async function fetchOwnershipReportData(
  projectId: string
): Promise<ReportData> {
  const [ownerships, transfers, claimsRows, history] = await Promise.all([
    db.execute(sql.raw(`
      SELECT p.name AS partner_name, p.pan_number,
             pp.ownership_pct::numeric, pp.participation_type, pp.is_active,
             pp.joined_at::text, pp.departed_at::text
      FROM project_participants pp
      JOIN partners p ON p.id = pp.partner_id
      WHERE pp.project_id = '${projectId}'::uuid
      ORDER BY pp.ownership_pct DESC NULLS LAST
    `)),
    db.execute(sql.raw(`
      SELECT ot.transfer_type, ot.transfer_pct::numeric,
             fp.name AS from_partner, tp.name AS to_partner,
             ot.transfer_date::text, ot.status, ot.approved_by_name, ot.notes
      FROM ownership_transfers ot
      JOIN partners fp ON fp.id = ot.from_partner_id
      JOIN partners tp ON tp.id = ot.to_partner_id
      WHERE ot.project_id = '${projectId}'::uuid
      ORDER BY ot.transfer_date DESC NULLS LAST
      LIMIT 200
    `)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`
      SELECT ic.claim_type, ic.status, p.name AS partner_name,
             ic.initiated_by_name, ic.created_at::text, ic.approved_at::text
      FROM inheritance_claims ic
      JOIN partners p ON p.id = ic.partner_id
      WHERE ic.project_id = '${projectId}'::uuid AND ic.is_active = true
      ORDER BY ic.created_at DESC
      LIMIT 200
    `)),
    db.execute(sql.raw(`
      SELECT p.name AS partner_name, ioh.event_type,
             ioh.old_ownership_pct::numeric, ioh.new_ownership_pct::numeric,
             ioh.change_reason, ioh.recorded_by_name, ioh.created_at::text
      FROM inheritance_ownership_history ioh
      JOIN partners p ON p.id = ioh.partner_id
      WHERE ioh.project_id = '${projectId}'::uuid
      ORDER BY ioh.created_at DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] })),
  ]);

  const ownershipRows = ownerships.rows as Record<string,unknown>[];
  const transferRows = transfers.rows as Record<string,unknown>[];
  const claimRows = claimsRows.rows as Record<string,unknown>[];
  const histRows = history.rows as Record<string,unknown>[];
  const totalOwnership = ownershipRows.reduce((s, r) => s + toN(r.ownership_pct), 0);

  return {
    summary: {
      "Active Partners": String(ownershipRows.filter(r => r.is_active).length),
      "Total Ownership Assigned": `${fmtNum(totalOwnership)}%`,
      "Ownership Transfers": String(transferRows.length),
      "Inheritance Claims": String(claimRows.length),
      "Open Claims": String(claimRows.filter(r => r.status === "open").length),
      "History Events": String(histRows.length),
    },
    sections: [
      {
        title: "Current Ownership Structure",
        subtitle: `All participants — active and inactive`,
        columns: ["Partner", "PAN", "Type", "Ownership %", "Active", "Joined", "Departed"],
        rows: ownershipRows.map(r => [
          fmt(r.partner_name), fmt(r.pan_number), fmt(r.participation_type),
          `${fmtNum(r.ownership_pct)}%`, r.is_active ? "Yes" : "No",
          fmt(r.joined_at), fmt(r.departed_at),
        ]),
        totals: ["TOTAL", "", "", `${fmtNum(totalOwnership)}%`, "", "", ""],
      },
      {
        title: "Ownership Transfers",
        columns: ["Type", "Transfer %", "From Partner", "To Partner", "Date", "Status", "Approved By", "Notes"],
        rows: transferRows.map(r => [
          fmt(r.transfer_type), `${fmtNum(r.transfer_pct)}%`, fmt(r.from_partner), fmt(r.to_partner),
          fmt(r.transfer_date), fmt(r.status), fmt(r.approved_by_name), fmt(r.notes),
        ]),
      },
      {
        title: "Inheritance Claims",
        columns: ["Claim Type", "Status", "Partner", "Initiated By", "Filed", "Approved"],
        rows: claimRows.map(r => [
          fmt(r.claim_type), fmt(r.status), fmt(r.partner_name),
          fmt(r.initiated_by_name), fmt(r.created_at), fmt(r.approved_at),
        ]),
      },
      {
        title: "Ownership History (Write-Once Audit)",
        columns: ["Partner", "Event Type", "Old %", "New %", "Reason", "Recorded By", "Date"],
        rows: histRows.map(r => [
          fmt(r.partner_name), fmt(r.event_type),
          `${fmtNum(r.old_ownership_pct)}%`, `${fmtNum(r.new_ownership_pct)}%`,
          fmt(r.change_reason), fmt(r.recorded_by_name), fmt(r.created_at),
        ]),
      },
    ],
  };
}

// ── DISTRIBUTION REPORT ───────────────────────────────────────────────────────

export async function fetchDistributionReportData(
  projectId: string, dateStart?: string | null, dateEnd?: string | null
): Promise<ReportData> {
  const dsF = dateStart ? `AND dr.created_at >= '${dateStart}'::date` : "";
  const deF = dateEnd ? `AND dr.created_at <= '${dateEnd}'::date + interval '1 day'` : "";

  const [distRows, settleRows, fiftyRows, salesForDist] = await Promise.all([
    db.execute(sql.raw(`
      SELECT dr.period_label, p.name AS partner_name,
             dr.gross_entitlement::numeric, dr.burden_deduction::numeric,
             dr.lca_deduction::numeric, dr.other_deductions::numeric,
             dr.deductions::numeric, dr.net_payable::numeric,
             dr.status, dr.settled_at::text
      FROM distribution_records dr
      JOIN partners p ON p.id = dr.partner_id
      WHERE dr.project_id = '${projectId}'::uuid AND dr.is_active = true
      ${dsF} ${deF}
      ORDER BY dr.settled_at DESC NULLS LAST, dr.period_label DESC
      LIMIT 1000
    `)),
    db.execute(sql.raw(`
      SELECT sr.settlement_type, sr.period_label, p.name AS partner_name,
             sr.amount::numeric, sr.status, sr.finalized_at::text,
             sr.finalized_by_name
      FROM settlement_records sr
      JOIN partners p ON p.id = sr.partner_id
      WHERE sr.project_id = '${projectId}'::uuid
      ${dsF.replace("dr.", "sr.")} ${deF.replace("dr.", "sr.")}
      ORDER BY sr.finalized_at DESC NULLS LAST
      LIMIT 500
    `)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`
      SELECT fs.session_label, fs.gross_revenue::numeric,
             fs.total_epp_shares::numeric, fs.landowner_pool::numeric,
             fs.status, fs.created_at::text
      FROM fifty_pct_sessions fs
      WHERE fs.project_id = '${projectId}'::uuid
      ${dsF.replace("dr.", "fs.")} ${deF.replace("dr.", "fs.")}
      ORDER BY fs.created_at DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`
      SELECT invoice_number, product_type, gross_amount::numeric, net_amount::numeric,
             sale_date::text, status
      FROM sales
      WHERE project_id = '${projectId}'::uuid AND is_active = true
      ${dsF.replace("dr.", "")} ${deF.replace("dr.", "")}
      ORDER BY sale_date DESC NULLS LAST
      LIMIT 200
    `)),
  ]);

  const dists = distRows.rows as Record<string,unknown>[];
  const settles = settleRows.rows as Record<string,unknown>[];
  const fifties = fiftyRows.rows as Record<string,unknown>[];
  const saleDist = salesForDist.rows as Record<string,unknown>[];

  const totalNetPayable = dists.reduce((s, r) => s + toN(r.net_payable), 0);
  const totalGross = dists.reduce((s, r) => s + toN(r.gross_entitlement), 0);
  const totalDeductions = dists.reduce((s, r) => s + toN(r.deductions), 0);

  return {
    summary: {
      "Total Gross Entitlement": `₹${fmtNum(totalGross)}`,
      "Total Deductions": `₹${fmtNum(totalDeductions)}`,
      "Total Net Payable": `₹${fmtNum(totalNetPayable)}`,
      "Distribution Records": String(dists.length),
      "Settlement Records": String(settles.length),
      "50% Sessions": String(fifties.length),
      "Sales Linked": String(saleDist.length),
    },
    sections: [
      {
        title: "Distribution Records",
        subtitle: `Per-partner payment breakdowns`,
        columns: ["Period", "Partner", "Gross (₹)", "Burden Ded. (₹)", "LCA Ded. (₹)", "Other Ded. (₹)", "Total Ded. (₹)", "Net Payable (₹)", "Status", "Settled At"],
        rows: dists.map(r => [
          fmt(r.period_label), fmt(r.partner_name),
          fmtNum(r.gross_entitlement), fmtNum(r.burden_deduction),
          fmtNum(r.lca_deduction), fmtNum(r.other_deductions),
          fmtNum(r.deductions), fmtNum(r.net_payable),
          fmt(r.status), fmt(r.settled_at),
        ]),
        totals: ["TOTALS", "", `₹${fmtNum(totalGross)}`, "", "", "", `₹${fmtNum(totalDeductions)}`, `₹${fmtNum(totalNetPayable)}`, "", ""],
      },
      {
        title: "Settlement Records",
        columns: ["Type", "Period", "Partner", "Amount (₹)", "Status", "Finalized At", "Finalized By"],
        rows: settles.map(r => [
          fmt(r.settlement_type), fmt(r.period_label), fmt(r.partner_name),
          fmtNum(r.amount), fmt(r.status), fmt(r.finalized_at), fmt(r.finalized_by_name),
        ]),
        totals: ["TOTAL", "", "", `₹${fmtNum(settles.reduce((s, r) => s + toN(r.amount), 0))}`, "", "", ""],
      },
      {
        title: "50% Revenue Sessions",
        columns: ["Session", "Gross Revenue (₹)", "EPP Shares (₹)", "Landowner Pool (₹)", "Status", "Created"],
        rows: fifties.map(r => [
          fmt(r.session_label), fmtNum(r.gross_revenue),
          fmtNum(r.total_epp_shares), fmtNum(r.landowner_pool), fmt(r.status), fmt(r.created_at),
        ]),
      },
    ],
  };
}

// ── INVENTORY REPORT ──────────────────────────────────────────────────────────

export async function fetchInventoryReportData(
  projectId: string, dateStart?: string | null, dateEnd?: string | null
): Promise<ReportData> {
  const dsF = dateStart ? `AND created_at >= '${dateStart}'::date` : "";
  const deF = dateEnd ? `AND created_at <= '${dateEnd}'::date + interval '1 day'` : "";

  const [inventory, movements, reservations, production] = await Promise.all([
    db.execute(sql.raw(`
      SELECT stock_type, balance_quantity::numeric, balance_value::numeric,
             unit, last_movement_at::text, created_at::text
      FROM inventory
      WHERE project_id = '${projectId}'::uuid
      ORDER BY stock_type
    `)),
    db.execute(sql.raw(`
      SELECT movement_type, stock_type, quantity::numeric, unit,
             reference_type, reference_id, notes, created_at::text
      FROM inventory_movements
      WHERE project_id = '${projectId}'::uuid
      ${dsF} ${deF}
      ORDER BY created_at DESC
      LIMIT 1000
    `)).catch(() => ({ rows: [] })),
    db.execute(sql.raw(`
      SELECT stock_type, reserved_quantity::numeric, reservation_reason,
             reserved_for_type, status, expires_at::text, created_at::text
      FROM inventory_reservations
      WHERE project_id = '${projectId}'::uuid AND is_active = true
      ORDER BY created_at DESC
      LIMIT 200
    `)),
    db.execute(sql.raw(`
      SELECT batch_number, product_type, quantity_produced::numeric, unit,
             production_date::text, status, notes
      FROM production_log
      WHERE project_id = '${projectId}'::uuid
      ${dsF} ${deF}
      ORDER BY production_date DESC NULLS LAST
      LIMIT 500
    `)).catch(() => ({ rows: [] })),
  ]);

  const inv = inventory.rows as Record<string,unknown>[];
  const moves = movements.rows as Record<string,unknown>[];
  const reserves = reservations.rows as Record<string,unknown>[];
  const prod = production.rows as Record<string,unknown>[];

  const totalBalance = inv.reduce((s, r) => s + toN(r.balance_value), 0);
  const inflows = moves.filter(r => ["production_in", "purchase_in", "transfer_in", "adjustment_in"].includes(String(r.movement_type)));
  const outflows = moves.filter(r => ["sale_out", "transfer_out", "wastage_out", "adjustment_out"].includes(String(r.movement_type)));
  const totalIn = inflows.reduce((s, r) => s + toN(r.quantity), 0);
  const totalOut = outflows.reduce((s, r) => s + toN(r.quantity), 0);

  return {
    summary: {
      "Stock Types": String(inv.length),
      "Total Inventory Value": `₹${fmtNum(totalBalance)}`,
      "Total Inflows": `${fmtNum(totalIn)} kg`,
      "Total Outflows": `${fmtNum(totalOut)} kg`,
      "Movement Records": String(moves.length),
      "Active Reservations": String(reserves.filter(r => r.status === "active").length),
      "Production Batches": String(prod.length),
    },
    sections: [
      {
        title: "Current Inventory Balances",
        columns: ["Stock Type", "Balance Qty", "Unit", "Balance Value (₹)", "Last Movement"],
        rows: inv.map(r => [
          fmt(r.stock_type), fmtNum(r.balance_quantity), fmt(r.unit),
          fmtNum(r.balance_value), fmt(r.last_movement_at),
        ]),
        totals: ["TOTAL", "", "", `₹${fmtNum(totalBalance)}`, ""],
      },
      {
        title: "Inventory Movements",
        subtitle: `${moves.length} records — inflows and outflows`,
        columns: ["Movement Type", "Stock Type", "Quantity", "Unit", "Reference", "Notes", "Date"],
        rows: moves.map(r => [
          fmt(r.movement_type), fmt(r.stock_type), fmtNum(r.quantity), fmt(r.unit),
          fmt(r.reference_type), fmt(r.notes), fmt(r.created_at),
        ]),
        totals: ["INFLOWS", "", `${fmtNum(totalIn)}`, "", "", "", ""],
      },
      {
        title: "Production Log",
        columns: ["Batch No.", "Product Type", "Qty Produced", "Unit", "Date", "Status", "Notes"],
        rows: prod.map(r => [
          fmt(r.batch_number), fmt(r.product_type), fmtNum(r.quantity_produced),
          fmt(r.unit), fmt(r.production_date), fmt(r.status), fmt(r.notes),
        ]),
      },
      {
        title: "Active Inventory Reservations",
        columns: ["Stock Type", "Reserved Qty", "Reason", "Reserved For", "Status", "Expires At"],
        rows: reserves.map(r => [
          fmt(r.stock_type), fmtNum(r.reserved_quantity), fmt(r.reservation_reason),
          fmt(r.reserved_for_type), fmt(r.status), fmt(r.expires_at),
        ]),
      },
    ],
  };
}

// ── GOVERNANCE REPORT ─────────────────────────────────────────────────────────

export async function fetchGovernanceReportData(
  projectId: string, dateStart?: string | null, dateEnd?: string | null
): Promise<ReportData> {
  const dsF = dateStart ? `AND created_at >= '${dateStart}'::date` : "";
  const deF = dateEnd ? `AND created_at <= '${dateEnd}'::date + interval '1 day'` : "";

  const [disputes, overrides, nominees, claims, alerts, evidence] = await Promise.all([
    db.execute(sql.raw(`
      SELECT dispute_type, status, severity, title, raised_by_name,
             raised_at::text, resolved_at::text, resolved_by_name, resolution_summary
      FROM disputes
      WHERE project_id = '${projectId}'::uuid AND is_active = true
      ${dsF} ${deF}
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
               CASE status WHEN 'escalated' THEN 1 WHEN 'open' THEN 2 ELSE 3 END
      LIMIT 500
    `)),
    db.execute(sql.raw(`
      SELECT override_type, module, title, actor_name, actor_role,
             override_reason, occurred_at::text
      FROM governance_overrides
      WHERE project_id = '${projectId}'::uuid
      ${dsF.replace("created_at", "occurred_at")} ${deF.replace("created_at", "occurred_at")}
      ORDER BY occurred_at DESC
      LIMIT 500
    `)),
    db.execute(sql.raw(`
      SELECT nominee_name, relationship, phone, activation_status,
             is_active, activated_at::text, created_at::text
      FROM project_nominees
      WHERE project_id = '${projectId}'::uuid
      ORDER BY is_active DESC, created_at DESC
    `)),
    db.execute(sql.raw(`
      SELECT ic.claim_type, ic.status, p.name AS partner_name,
             ic.initiated_by_name, ic.approved_by_name, ic.approved_at::text,
             ic.created_at::text
      FROM inheritance_claims ic
      JOIN partners p ON p.id = ic.partner_id
      WHERE ic.project_id = '${projectId}'::uuid AND ic.is_active = true
      ORDER BY ic.status, ic.created_at DESC
      LIMIT 200
    `)),
    db.execute(sql.raw(`
      SELECT alert_type, severity, status, title, detected_at::text,
             acknowledged_by_name, resolved_at::text, resolved_by_name
      FROM operational_alerts
      WHERE project_id = '${projectId}'::uuid AND is_active = true
      ${dsF.replace("created_at", "detected_at")} ${deF.replace("created_at", "detected_at")}
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
               CASE status WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END
      LIMIT 300
    `)),
    db.execute(sql.raw(`
      SELECT document_type, title, archive_status, version_number,
             uploaded_by_name, reference_number, created_at::text
      FROM legal_evidence_archive
      WHERE project_id = '${projectId}'::uuid
      ${dsF} ${deF}
      ORDER BY is_latest_version DESC, created_at DESC
      LIMIT 300
    `)),
  ]);

  const disputeRows = disputes.rows as Record<string,unknown>[];
  const overrideRows = overrides.rows as Record<string,unknown>[];
  const nomineeRows = nominees.rows as Record<string,unknown>[];
  const claimRows = claims.rows as Record<string,unknown>[];
  const alertRows = alerts.rows as Record<string,unknown>[];
  const evidenceRows = evidence.rows as Record<string,unknown>[];

  const openDisputes = disputeRows.filter(r => r.status === "open" || r.status === "escalated").length;
  const criticalAlerts = alertRows.filter(r => r.severity === "critical" && r.status === "open").length;
  const pendingNominees = nomineeRows.filter(r => r.activation_status === "pending").length;

  return {
    summary: {
      "Open Disputes": String(openDisputes),
      "Critical Alerts": String(criticalAlerts),
      "Override Events": String(overrideRows.length),
      "Pending Nominees": String(pendingNominees),
      "Inheritance Claims": String(claimRows.length),
      "Evidence Documents": String(evidenceRows.length),
    },
    sections: [
      {
        title: "Disputes & Conflicts",
        subtitle: `${disputeRows.length} records — ${openDisputes} open`,
        columns: ["Type", "Severity", "Status", "Title", "Raised By", "Raised At", "Resolved By", "Resolved At"],
        rows: disputeRows.map(r => [
          fmt(r.dispute_type), fmt(r.severity).toUpperCase(), fmt(r.status), fmt(r.title),
          fmt(r.raised_by_name), fmt(r.raised_at), fmt(r.resolved_by_name), fmt(r.resolved_at),
        ]),
      },
      {
        title: "Governance Overrides (Immutable Audit)",
        subtitle: `${overrideRows.length} write-once override events`,
        columns: ["Type", "Module", "Title", "Actor", "Role", "Reason", "Occurred At"],
        rows: overrideRows.map(r => [
          fmt(r.override_type), fmt(r.module), fmt(r.title),
          fmt(r.actor_name), fmt(r.actor_role), fmt(r.override_reason), fmt(r.occurred_at),
        ]),
      },
      {
        title: "Operational Alerts",
        columns: ["Alert Type", "Severity", "Status", "Title", "Detected At", "Ack. By", "Resolved At"],
        rows: alertRows.map(r => [
          fmt(r.alert_type), fmt(r.severity).toUpperCase(), fmt(r.status), fmt(r.title),
          fmt(r.detected_at), fmt(r.acknowledged_by_name), fmt(r.resolved_at),
        ]),
      },
      {
        title: "Nominees",
        columns: ["Name", "Relationship", "Phone", "Status", "Active", "Activated At"],
        rows: nomineeRows.map(r => [
          fmt(r.nominee_name), fmt(r.relationship), fmt(r.phone),
          fmt(r.activation_status), r.is_active ? "Yes" : "No", fmt(r.activated_at),
        ]),
      },
      {
        title: "Inheritance Claims",
        columns: ["Type", "Status", "Partner", "Initiated By", "Approved By", "Approved At", "Filed"],
        rows: claimRows.map(r => [
          fmt(r.claim_type), fmt(r.status), fmt(r.partner_name),
          fmt(r.initiated_by_name), fmt(r.approved_by_name), fmt(r.approved_at), fmt(r.created_at),
        ]),
      },
      {
        title: "Legal Evidence Archive",
        columns: ["Doc Type", "Title", "Status", "Version", "Ref #", "Uploaded By", "Archived At"],
        rows: evidenceRows.map(r => [
          fmt(r.document_type), fmt(r.title), fmt(r.archive_status),
          `v${r.version_number}`, fmt(r.reference_number), fmt(r.uploaded_by_name), fmt(r.created_at),
        ]),
      },
    ],
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function fetchReportData(
  reportType: string, projectId: string,
  dateStart?: string | null, dateEnd?: string | null
): Promise<{ data: ReportData; meta: Partial<ReportMeta> }> {
  const titleMap: Record<string, string> = {
    financial:    "Financial Report",
    project:      "Project Summary Report",
    ownership:    "Ownership & Equity Report",
    distribution: "Distribution & Settlement Report",
    inventory:    "Inventory & Production Report",
    governance:   "Governance & Compliance Report",
  };

  let data: ReportData;
  switch (reportType) {
    case "financial":    data = await fetchFinancialReportData(projectId, dateStart, dateEnd); break;
    case "project":      data = await fetchProjectReportData(projectId); break;
    case "ownership":    data = await fetchOwnershipReportData(projectId); break;
    case "distribution": data = await fetchDistributionReportData(projectId, dateStart, dateEnd); break;
    case "inventory":    data = await fetchInventoryReportData(projectId, dateStart, dateEnd); break;
    case "governance":   data = await fetchGovernanceReportData(projectId, dateStart, dateEnd); break;
    default:             throw new Error(`Unknown report type: ${reportType}`);
  }

  return { data, meta: { reportTitle: titleMap[reportType] ?? reportType } };
}
