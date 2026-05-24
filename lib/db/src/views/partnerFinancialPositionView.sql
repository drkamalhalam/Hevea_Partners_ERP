-- partner_financial_position_v
-- Derived per-(project_id, partner_id) financial position computed from
-- partner_financial_ledger and held_distribution_ledger.
--
-- Wave 1 contract: this view must exist and be deployable. It is created
-- via the chained `pnpm --filter @workspace/db run push` script
-- (drizzle-kit push then `tsx src/applyViews.ts`).
--
-- Maintenance: edit this file ONLY. Re-run `pnpm --filter @workspace/db
-- run push` (or `pnpm --filter @workspace/db run apply-views`) to apply.

CREATE OR REPLACE VIEW partner_financial_position_v AS
WITH ledger_rollup AS (
  SELECT
    project_id,
    partner_id,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'revenue_credit'), 0)                AS gross_revenue,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'revenue_credit'
                                  AND reference_type <> 'internal_partner_purchase'), 0) AS gross_revenue_external,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'revenue_credit'
                                  AND reference_type = 'internal_partner_purchase'), 0)  AS gross_revenue_internal,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'cost_allocation_debit'), 0)         AS allocated_costs,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'adjustment_credit'), 0)             AS adjustment_credits,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'adjustment_debit'), 0)              AS adjustment_debits,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'reimbursement_credit'), 0)          AS reimbursement_credits,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'reimbursement_debit'), 0)           AS reimbursement_debits,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'reversal_credit'), 0)               AS reversal_credits,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'reversal_debit'), 0)                AS reversal_debits,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'inheritance_in'), 0)                AS inheritance_in,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'inheritance_out'), 0)               AS inheritance_out,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'distribution_payment'), 0)          AS distribution_payments,
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'distribution_reversal'), 0)         AS distribution_reversals
  FROM partner_financial_ledger
  GROUP BY project_id, partner_id
),
held_rollup AS (
  SELECT
    project_id,
    partner_id,
    COALESCE(SUM(held_amount), 0) AS held_balance
  FROM held_distribution_ledger
  WHERE status = 'held'
  GROUP BY project_id, partner_id
)
SELECT
  COALESCE(l.project_id, h.project_id) AS project_id,
  COALESCE(l.partner_id, h.partner_id) AS partner_id,
  COALESCE(l.gross_revenue, 0)            AS gross_revenue,
  COALESCE(l.gross_revenue_external, 0)   AS gross_revenue_external,
  COALESCE(l.gross_revenue_internal, 0)   AS gross_revenue_internal,
  COALESCE(l.allocated_costs, 0)          AS allocated_costs,
  COALESCE(l.adjustment_credits, 0)       AS adjustment_credits,
  COALESCE(l.adjustment_debits, 0)        AS adjustment_debits,
  COALESCE(l.reimbursement_credits, 0)    AS reimbursement_credits,
  COALESCE(l.reimbursement_debits, 0)     AS reimbursement_debits,
  COALESCE(l.reversal_credits, 0)         AS reversal_credits,
  COALESCE(l.reversal_debits, 0)          AS reversal_debits,
  COALESCE(l.inheritance_in, 0)           AS inheritance_in,
  COALESCE(l.inheritance_out, 0)          AS inheritance_out,
  COALESCE(l.distribution_payments, 0)    AS distribution_payments,
  COALESCE(l.distribution_reversals, 0)   AS distribution_reversals,
  (
      COALESCE(l.gross_revenue, 0)
    - COALESCE(l.allocated_costs, 0)
    + COALESCE(l.adjustment_credits, 0)
    - COALESCE(l.adjustment_debits, 0)
    + COALESCE(l.reimbursement_credits, 0)
    - COALESCE(l.reimbursement_debits, 0)
    + COALESCE(l.reversal_credits, 0)
    - COALESCE(l.reversal_debits, 0)
    + COALESCE(l.inheritance_in, 0)
    - COALESCE(l.inheritance_out, 0)
  ) AS net_profit,
  (
      COALESCE(l.gross_revenue, 0)
    - COALESCE(l.allocated_costs, 0)
    + COALESCE(l.adjustment_credits, 0)
    - COALESCE(l.adjustment_debits, 0)
    + COALESCE(l.reimbursement_credits, 0)
    - COALESCE(l.reimbursement_debits, 0)
    + COALESCE(l.reversal_credits, 0)
    - COALESCE(l.reversal_debits, 0)
    + COALESCE(l.inheritance_in, 0)
    - COALESCE(l.inheritance_out, 0)
    - COALESCE(l.distribution_payments, 0)
    + COALESCE(l.distribution_reversals, 0)
  ) AS distributable_balance,
  COALESCE(h.held_balance, 0) AS held_balance,
  (
      COALESCE(l.gross_revenue, 0)
    - COALESCE(l.allocated_costs, 0)
    + COALESCE(l.adjustment_credits, 0)
    - COALESCE(l.adjustment_debits, 0)
    + COALESCE(l.reimbursement_credits, 0)
    - COALESCE(l.reimbursement_debits, 0)
    + COALESCE(l.reversal_credits, 0)
    - COALESCE(l.reversal_debits, 0)
    + COALESCE(l.inheritance_in, 0)
    - COALESCE(l.inheritance_out, 0)
    - COALESCE(l.distribution_payments, 0)
    + COALESCE(l.distribution_reversals, 0)
    - COALESCE(h.held_balance, 0)
  ) AS available_distributable_balance
FROM ledger_rollup l
FULL OUTER JOIN held_rollup h
  ON h.project_id = l.project_id
 AND h.partner_id = l.partner_id;
