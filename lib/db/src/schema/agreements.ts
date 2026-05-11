import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agreementsTable = pgTable("agreements", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  landOwnerId: integer("land_owner_id").notNull(),
  projectDeveloperId: integer("project_developer_id").notNull(),
  executionDate: text("execution_date").notNull(),
  executionPlace: text("execution_place").notNull(),
  termYears: integer("term_years").notNull().default(35),
  landArea: real("land_area").notNull(),
  landAreaUnit: text("land_area_unit").notNull().default("kani"),
  landNotionalValue: real("land_notional_value").notNull(),
  landValuePerUnit: real("land_value_per_unit").notNull(),
  landContributionAdjustment: real("land_contribution_adjustment").notNull().default(0),
  yearlyEscalation: real("yearly_escalation").notNull().default(5),
  ownershipShareLandowner: real("ownership_share_landowner"),
  ownershipShareDeveloper: real("ownership_share_developer"),
  revenueModel: text("revenue_model").notNull().default("contribution"),
  status: text("status").notNull().default("draft"),
  northBoundary: text("north_boundary"),
  southBoundary: text("south_boundary"),
  eastBoundary: text("east_boundary"),
  westBoundary: text("west_boundary"),
  gpsLat: real("gps_lat"),
  gpsLng: real("gps_lng"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export const insertAgreementSchema = createInsertSchema(agreementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgreement = z.infer<typeof insertAgreementSchema>;
export type Agreement = typeof agreementsTable.$inferSelect;
