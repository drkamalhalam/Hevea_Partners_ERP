/**
 * routes/sale_events_admin.ts
 *
 * V3 Wave 3 — Admin endpoints for sale-event processing management.
 *
 * Mounted at /api/admin/sale-events (see routes/index.ts).
 * All endpoints require admin or developer role.
 *
 * Endpoints:
 *   POST /process-pending         — sweep unprocessed events through handler
 *   POST /:eventId/reprocess      — force-reprocess a single event (bypasses
 *                                   idempotency — use only for recovery)
 *   GET  /status                  — journal summary: total / processed / pending
 *
 * All endpoints return immediately even if flags are OFF; the flag state is
 * reported in the response body so operators can diagnose without API source.
 */

import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  saleEventJournalTable,
  processedSaleEventsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth.js";
import { getFinFlag } from "../lib/featureFlags.js";
import { processOne } from "../lib/revenueHandler/processOne.js";
import { processPending } from "../lib/revenueHandler/processPending.js";

const router = Router();

// ── GET /admin/sale-events/status ─────────────────────────────────────────────

router.get(
  "/status",
  requireRole("admin", "developer"),
  async (req, res): Promise<void> => {
    try {
      const [journalTotal] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(saleEventJournalTable);

      const [processedTotal] = await db
        .select({ count: sql<number>`COUNT(DISTINCT event_id)::int` })
        .from(processedSaleEventsTable)
        .where(
          eq(processedSaleEventsTable.processedByHandler, "sale_revenue_handler"),
        );

      const total = Number(journalTotal?.count ?? 0);
      const processed = Number(processedTotal?.count ?? 0);

      res.json({
        flags: {
          FIN_SALE_EVENT_EMISSION_ENABLED: getFinFlag("FIN_SALE_EVENT_EMISSION_ENABLED"),
          FIN_REVENUE_ATTRIBUTION_ENABLED: getFinFlag("FIN_REVENUE_ATTRIBUTION_ENABLED"),
          FIN_LEDGER_ENABLED: getFinFlag("FIN_LEDGER_ENABLED"),
        },
        journal: {
          total,
          processedByHandler: processed,
          pending: Math.max(0, total - processed),
        },
      });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to fetch sale event status" });
    }
  },
);

// ── POST /admin/sale-events/process-pending ───────────────────────────────────

const processPendingSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  projectId: z.string().uuid().optional(),
});

router.post(
  "/process-pending",
  requireRole("admin", "developer"),
  async (req, res): Promise<void> => {
    try {
      const parsed = processPendingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
        return;
      }

      const summary = await processPending(db, {
        limit: parsed.data.limit ?? 50,
        projectId: parsed.data.projectId,
      });

      req.log.info(
        {
          total: summary.total,
          processed: summary.processed,
          errors: summary.errors,
        },
        "sale-events-admin: process-pending complete",
      );

      res.json(summary);
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to process pending events" });
    }
  },
);

// ── POST /admin/sale-events/:eventId/reprocess ────────────────────────────────
// Force-reprocess: deletes the existing claim row first so the handler can
// re-run. Uses upsert idempotency on attribution_lines and ledger to avoid
// duplicates if rows were already written. For error-recovery only.

router.post(
  "/:eventId/reprocess",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;

      if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) {
        res.status(400).json({ error: "Invalid eventId format" });
        return;
      }

      // Delete existing claim so processOne can re-claim
      await db
        .delete(processedSaleEventsTable)
        .where(
          sql`${processedSaleEventsTable.eventId} = ${eventId}::uuid
              AND ${processedSaleEventsTable.processedByHandler} = 'sale_revenue_handler'`,
        );

      const result = await processOne(db, eventId);

      req.log.info(
        { eventId, outcome: result.outcome },
        "sale-events-admin: reprocess complete",
      );

      const statusCode =
        result.outcome === "processed" || result.outcome === "already_processed"
          ? 200
          : result.outcome === "flag_disabled" || result.outcome === "skipped_event_type"
            ? 200
            : result.outcome === "event_not_found" || result.outcome === "sale_not_found"
              ? 404
              : 500;

      res.status(statusCode).json(result);
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to reprocess event" });
    }
  },
);

export default router;
