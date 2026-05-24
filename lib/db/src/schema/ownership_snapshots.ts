import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { ownershipSnapshotTypeEnum } from "./enums";

/**
 * ownershipSnapshotsTable — point-in-time snapshots of prematurity ownership guidance.
 *
 * Each row captures the full ownership breakdown for a project at the moment the
 * snapshot was taken.  Rows are WRITE-ONCE — never updated or hard-deleted through
 * the application.  They form the historical record for the ownership trend chart.
 *
 * The `entries` JSONB array holds one object per partner:
 *   {
 *     partnerKey:     string   — partnerId (UUID) when linked, otherwise partnerName
 *     partnerId:      string | null
 *     partnerName:    string
 *     landAmount:     number   — sum of verified land_notional contributions
 *     economicAmount: number   — sum of verified economic_investment contributions
 *     totalAmount:    number   — landAmount + economicAmount
 *     percentage:     number   — totalAmount / projectTotal * 100 (2 dp)
 *   }
 */
export const ownershipSnapshotsTable = pgTable("ownership_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .references(() => projectsTable.id, { onDelete: "cascade" })
    .notNull(),

  snapshotType: ownershipSnapshotTypeEnum("snapshot_type")
    .notNull()
    .default("manual"),

  lifecycleStatus: text("lifecycle_status").notNull().default("prematurity"),

  /** Sum of all partner amounts — denominator for % calculations. */
  totalRecognizedAmount: numericFlex("total_recognized_amount", { precision: 15, scale: 2 })
    .notNull()
    .default(0),

  /** Sum of land_notional contributions at snapshot time. */
  landTotal: numericFlex("land_total", { precision: 15, scale: 2 }).notNull().default(0),

  /** Sum of economic_investment contributions at snapshot time. */
  economicTotal: numericFlex("economic_total", { precision: 15, scale: 2 })
    .notNull()
    .default(0),

  /** Full breakdown array (see type comment above). */
  entries: jsonb("entries").$type<OwnershipSnapshotEntry[]>().notNull().default([]),

  notes: text("notes"),

  triggeredBy: uuid("triggered_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  triggeredByName: text("triggered_by_name"),

  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export interface OwnershipSnapshotEntry {
  partnerKey: string;
  partnerId: string | null;
  partnerName: string;
  landAmount: number;
  economicAmount: number;
  totalAmount: number;
  percentage: number;
}

export type OwnershipSnapshot = typeof ownershipSnapshotsTable.$inferSelect;
export type InsertOwnershipSnapshot = typeof ownershipSnapshotsTable.$inferInsert;
