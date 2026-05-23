import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * project_parcels — Schedule A: one row per land parcel making up a project.
 *
 * Replaces the legacy inlined survey fields on projectsTable (khatianNumber,
 * plotNumber, mouja, …). A project may consist of multiple parcels, each with
 * its own survey identifiers, area, and GPS reference.
 *
 * The legacy inlined fields on projectsTable are preserved for backward
 * compatibility but new wizard submissions write to this table instead.
 */
export const projectParcelsTable = pgTable(
  "project_parcels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    /** 1-based display position within the project's Schedule A. */
    position: integer("position").notNull(),

    /** recorded | non_recorded */
    landType: text("land_type").notNull(),

    // ── Recorded land fields ─────────────────────────────────────────────
    khatianNumber: text("khatian_number"),
    plotNumber: text("plot_number"),
    mouja: text("mouja"),
    tahsil: text("tahsil"),
    revenueCircle: text("revenue_circle"),
    subDivision: text("sub_division"),

    // ── Non-recorded land fields ─────────────────────────────────────────
    landAreaName: text("land_area_name"),
    postOffice: text("post_office"),
    policeStation: text("police_station"),

    // ── Common ───────────────────────────────────────────────────────────
    village: text("village"),
    district: text("district"),
    state: text("state"),
    landBoundaryDescription: text("land_boundary_description"),
    gpsCoordinates: text("gps_coordinates"),

    /** Parcel area (mandatory) — sum across parcels = projects.landArea. */
    landArea: real("land_area").notNull(),
    landAreaUnit: text("land_area_unit").notNull().default("kani"),

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
  },
  (t) => [unique("project_parcels_project_position_uq").on(t.projectId, t.position)],
);

export const insertProjectParcelSchema = createInsertSchema(
  projectParcelsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProjectParcel = z.infer<typeof insertProjectParcelSchema>;
export type ProjectParcel = typeof projectParcelsTable.$inferSelect;
