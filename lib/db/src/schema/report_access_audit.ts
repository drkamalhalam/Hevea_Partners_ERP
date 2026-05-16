/**
 * report_access_audit.ts
 *
 * Security audit log for all analytics and reporting module access.
 * Records every attempt — both granted and denied — so admins can see
 * who tried to access what, when, and whether it was permitted.
 *
 * Covers: financial_reports, settlement_analytics, ownership_analytics,
 *         governance_reports, global_analytics, analytics_hub, report_exports
 *
 * Write-once — no UPDATE/DELETE routes.
 */
import {
  pgTable, uuid, text, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

export const reportAccessAuditTable = pgTable(
  "report_access_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Actor ────────────────────────────────────────────────────────────
    userId:      uuid("user_id"),
    userRole:    text("user_role"),
    displayName: text("display_name"),
    clerkUserId: text("clerk_user_id"),

    // ── Resource ─────────────────────────────────────────────────────────
    module:      text("module").notNull(),
    endpoint:    text("endpoint").notNull(),
    projectId:   uuid("project_id"),
    projectName: text("project_name"),

    // ── Decision ─────────────────────────────────────────────────────────
    accessGranted: boolean("access_granted").notNull().default(true),
    denyReason:    text("deny_reason"),

    // ── Request context ───────────────────────────────────────────────────
    ipAddress:    text("ip_address"),
    userAgent:    text("user_agent"),
    requestQuery: jsonb("request_query"),

    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("report_access_audit_user_idx").on(t.userId),
    index("report_access_audit_module_idx").on(t.module),
    index("report_access_audit_accessed_at_idx").on(t.accessedAt),
    index("report_access_audit_granted_idx").on(t.accessGranted),
  ],
);

export type ReportAccessAudit = typeof reportAccessAuditTable.$inferSelect;
export type ReportAccessAuditInsert = typeof reportAccessAuditTable.$inferInsert;
