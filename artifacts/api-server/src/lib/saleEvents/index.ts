/**
 * saleEvents — V3 Wave 2 sale-event publication infrastructure.
 *
 * Public surface (zero consumers in Wave 2):
 *   - publishSaleEvent(db, envelope)  → flag-gated outbox insert
 *   - claimSaleEvent(db, { eventId, handler }) → per-handler idempotency claim
 *   - Zod schemas + types for the three V3 sale events
 */

export {
  publishSaleEvent,
  type PublishSaleEventInput,
  type PublishSaleEventResult,
} from "./publish.js";

export {
  claimSaleEvent,
  type ClaimSaleEventInput,
  type ClaimSaleEventResult,
} from "./claim.js";

export {
  saleEventEnvelopeSchema,
  saleFinanciallyRecognizedPayloadSchema,
  saleCancelledPayloadSchema,
  internalPartnerPurchaseCompletedPayloadSchema,
  SALE_EVENT_TYPES,
  SALE_REFERENCE_TYPES,
  type SaleEventType,
  type SaleReferenceType,
  type SaleEventEnvelope,
  type SaleFinanciallyRecognizedPayload,
  type SaleCancelledPayload,
  type InternalPartnerPurchaseCompletedPayload,
} from "./schemas.js";
