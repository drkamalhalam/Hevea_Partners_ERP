import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const productionRecordsTable = pgTable("production_records", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  productionKg: real("production_kg").notNull(),
  soldKg: real("sold_kg").notNull(),
  sellingPricePerKg: real("selling_price_per_kg").notNull(),
  revenue: real("revenue").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionRecordSchema = createInsertSchema(productionRecordsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProductionRecord = z.infer<typeof insertProductionRecordSchema>;
export type ProductionRecord = typeof productionRecordsTable.$inferSelect;
