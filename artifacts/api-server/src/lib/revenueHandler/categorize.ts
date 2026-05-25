/**
 * revenueHandler/categorize.ts
 *
 * V3 Wave 3 — Map a sale event type to a revenue_category value.
 *
 * revenue_category is a denormalized audit tag stored on every
 * revenue_attribution_lines row. It encodes how the underlying sale was
 * executed, which drives downstream reporting groupings (Wave 9+).
 *
 * Mapping (per approved Revision 4):
 *   SaleFinanciallyRecognized      → 'individual_partner_sale'
 *   InternalPartnerPurchaseCompleted → 'internal_partner_purchase'
 *   SaleCancelled                  → not processed by Wave 3 handler
 *
 * saleExecutorType follows the same logic:
 *   SaleFinanciallyRecognized      → 'partner'  (executed by a selling partner)
 *   InternalPartnerPurchaseCompleted → 'partner'  (buyer is also a partner)
 */

import type { SaleEventType } from "../saleEvents/schemas.js";

export type RevenueCategory =
  | "individual_partner_sale"
  | "store_sale"
  | "internal_partner_purchase"
  | "admin_override_sale"
  | "developer_override_sale"
  | "future_sale_type";

export type SaleExecutorType = "partner" | "admin" | "developer" | "store";

export interface EventCategorization {
  revenueCategory: RevenueCategory;
  saleExecutorType: SaleExecutorType;
}

/**
 * Resolve revenue category and executor type from the sale event type.
 * Returns null for event types that the Wave-3 handler deliberately skips
 * (e.g. SaleCancelled — reversal logic is out of Wave 3 scope).
 */
export function categorizeEvent(
  eventType: SaleEventType,
): EventCategorization | null {
  switch (eventType) {
    case "SaleFinanciallyRecognized":
      return {
        revenueCategory: "individual_partner_sale",
        saleExecutorType: "partner",
      };
    case "InternalPartnerPurchaseCompleted":
      return {
        revenueCategory: "internal_partner_purchase",
        saleExecutorType: "partner",
      };
    case "SaleCancelled":
      // Reversal / cancellation handling is deferred to Wave 5.
      return null;
    default: {
      // Exhaustiveness guard: TypeScript will catch unhandled additions to
      // SaleEventType at compile time. At runtime fall back to null (skip).
      const _: never = eventType;
      void _;
      return null;
    }
  }
}
