import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

export const agreementsTable = pgTable("agreements", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  landOwnerId: uuid("land_owner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),
  projectDeveloperId: uuid("project_developer_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),
  executionDate: text("execution_date").notNull(),
  executionPlace: text("execution_place").notNull(),
  termYears: integer("term_years").notNull().default(35),
  landArea: numericFlex("land_area", { precision: 12, scale: 4 }).notNull(),
  landAreaUnit: text("land_area_unit").notNull().default("kani"),
  landNotionalValue: numericFlex("land_notional_value", { precision: 15, scale: 2 }).notNull(),
  landValuePerUnit: numericFlex("land_value_per_unit", { precision: 15, scale: 2 }).notNull(),
  landContributionAdjustment: numericFlex("land_contribution_adjustment", { precision: 15, scale: 2 })
    .notNull()
    .default(0),
  yearlyEscalation: numericFlex("yearly_escalation", { precision: 7, scale: 4 }).notNull().default(5),
  ownershipShareLandowner: numericFlex("ownership_share_landowner", { precision: 12, scale: 8 }),
  ownershipShareDeveloper: numericFlex("ownership_share_developer", { precision: 12, scale: 8 }),
  revenueModel: text("revenue_model").notNull().default("contribution"),
  status: text("status").notNull().default("draft"),
  northBoundary: text("north_boundary"),
  southBoundary: text("south_boundary"),
  eastBoundary: text("east_boundary"),
  westBoundary: text("west_boundary"),
  gpsLat: real("gps_lat"),
  gpsLng: real("gps_lng"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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

export const insertAgreementSchema = createInsertSchema(agreementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertAgreement = z.infer<typeof insertAgreementSchema>;
export type Agreement = typeof agreementsTable.$inferSelect;
