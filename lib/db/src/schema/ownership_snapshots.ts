import { pgTable, uuid, text, timestamp, jsonb, real } from "drizzle-orm/pg-core";
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
 *
 * NPF Stage 2 FROZEN TABLE: totalRecognizedAmount, landTotal, economicTotal
 * intentionally kept as `real` — this is a write-once historical/snapshot table
 * that must remain in original on-disk format per the Stage 2 spec exclusion list.
 * See lib/db/drizzle/0001_npf_stage2_money_precision.sql section 7.
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

  /** Sum of all partner amounts — denominator for % calculations.
   *  FROZEN: kept as real per Stage 2 exclusion list (historical snapshot table). */
  totalRecognizedAmount: real("total_recognized_amount").notNull().default(0),

  /** Sum of land_notional contributions at snapshot time.
   *  FROZEN: kept as real per Stage 2 exclusion list. */
  landTotal: real("land_total").notNull().default(0),

  /** Sum of economic_investment contributions at snapshot time.
   *  FROZEN: kept as real per Stage 2 exclusion list. */
  economicTotal: real("economic_total").notNull().default(0),

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
