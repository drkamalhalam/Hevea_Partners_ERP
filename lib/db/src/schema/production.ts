import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const productionRecordsTable = pgTable("production_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  productionKg: numericFlex("production_kg", { precision: 12, scale: 3 }).notNull(),
  soldKg: numericFlex("sold_kg", { precision: 12, scale: 3 }).notNull(),
  sellingPricePerKg: numericFlex("selling_price_per_kg", { precision: 15, scale: 2 }).notNull(),
  revenue: numericFlex("revenue", { precision: 15, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
});

export const insertProductionRecordSchema = createInsertSchema(
  productionRecordsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProductionRecord = z.infer<
  typeof insertProductionRecordSchema
>;
export type ProductionRecord = typeof productionRecordsTable.$inferSelect;
