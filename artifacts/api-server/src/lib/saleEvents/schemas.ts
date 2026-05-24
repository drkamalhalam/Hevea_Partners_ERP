/**
 * saleEvents/schemas.ts
 *
 * V3 Wave 2 — Sale-domain event payload schemas (Zod).
 *
 * Final event catalog (V3 Final Freeze):
 *   - SaleFinanciallyRecognized      (sales_transaction)
 *   - SaleCancelled                  (sales_order)
 *   - InternalPartnerPurchaseCompleted (sales_transaction)
 *
 * These schemas validate payload shape only. They do NOT trigger any
 * business logic. Wave 2 ships publisher/claim infrastructure with zero
 * consumers; downstream waves will import these schemas from handlers.
 */

import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "money must be a decimal string");

export const saleFinanciallyRecognizedPayloadSchema = z.object({
  saleId: uuidSchema,
  projectId: uuidSchema,
  saleNumber: z.string().min(1),
  recognizedAt: isoDateTimeSchema,
  totalGrossRevenue: moneyStringSchema,
  totalNetRevenue: moneyStringSchema,
  currency: z.string().min(1).default("INR"),
  lineItemCount: z.number().int().nonnegative(),
  deductionCount: z.number().int().nonnegative(),
  sourceOrderId: uuidSchema.optional(),
});

export const saleCancelledPayloadSchema = z.object({
  orderId: uuidSchema,
  projectId: uuidSchema,
  cancelledAt: isoDateTimeSchema,
  reason: z.string().min(1),
});

export const internalPartnerPurchaseCompletedPayloadSchema = z.object({
  saleId: uuidSchema,
  projectId: uuidSchema,
  buyerPartnerId: uuidSchema,
  recognizedAt: isoDateTimeSchema,
  totalGrossRevenue: moneyStringSchema,
  totalNetRevenue: moneyStringSchema,
  currency: z.string().min(1).default("INR"),
  relatedSaleEventId: uuidSchema.optional(),
});

export const SALE_EVENT_TYPES = [
  "SaleFinanciallyRecognized",
  "SaleCancelled",
  "InternalPartnerPurchaseCompleted",
] as const;

export const SALE_REFERENCE_TYPES = [
  "sales_transaction",
  "sales_order",
] as const;

export const saleEventEnvelopeSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("SaleFinanciallyRecognized"),
    saleReferenceType: z.literal("sales_transaction"),
    saleReferenceId: uuidSchema,
    projectId: uuidSchema,
    occurredAt: isoDateTimeSchema,
    payload: saleFinanciallyRecognizedPayloadSchema,
  }),
  z.object({
    eventType: z.literal("SaleCancelled"),
    saleReferenceType: z.literal("sales_order"),
    saleReferenceId: uuidSchema,
    projectId: uuidSchema,
    occurredAt: isoDateTimeSchema,
    payload: saleCancelledPayloadSchema,
  }),
  z.object({
    eventType: z.literal("InternalPartnerPurchaseCompleted"),
    saleReferenceType: z.literal("sales_transaction"),
    saleReferenceId: uuidSchema,
    projectId: uuidSchema,
    occurredAt: isoDateTimeSchema,
    payload: internalPartnerPurchaseCompletedPayloadSchema,
  }),
]);

export type SaleEventType = (typeof SALE_EVENT_TYPES)[number];
export type SaleReferenceType = (typeof SALE_REFERENCE_TYPES)[number];
export type SaleEventEnvelope = z.infer<typeof saleEventEnvelopeSchema>;
export type SaleFinanciallyRecognizedPayload = z.infer<
  typeof saleFinanciallyRecognizedPayloadSchema
>;
export type SaleCancelledPayload = z.infer<typeof saleCancelledPayloadSchema>;
export type InternalPartnerPurchaseCompletedPayload = z.infer<
  typeof internalPartnerPurchaseCompletedPayloadSchema
>;
