import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const backupRunsTable = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  status: text("status").notNull().default("completed"),
  triggeredBy: uuid("triggered_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  triggeredByName: text("triggered_by_name"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  recordCounts: jsonb("record_counts"),
  totalRecords: integer("total_records"),
  fileSizeBytes: integer("file_size_bytes"),
  notes: text("notes"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BackupRun = typeof backupRunsTable.$inferSelect;
export type BackupRunInsert = typeof backupRunsTable.$inferInsert;
