import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { ownershipFreezeStatusEnum } from "./enums";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { maturityDeclarationsTable } from "./maturity";

/**
 * project_ownership_freezes — records the permanent ownership freeze
 * triggered when a maturity declaration completes.
 *
 * One record per project (a project can only be frozen once).
 * The freeze is irreversible except via explicit governance workflows:
 *   - share_transfer     → allowed (creates a separate transfer record)
 *   - inheritance_workflow → allowed (creates a separate settlement record)
 *
 * Restricted operations (enforced at API layer):
 *   - direct_ownership_change
 *   - ownership_dilution
 *   - new_partner_entry
 *
 * allowedOperations and restrictedOperations are computed at the API layer
 * from this record's status — they are NOT stored in the DB.
 */
export const projectOwnershipFreezesTable = pgTable(
  "project_ownership_freezes",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .unique()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    status: ownershipFreezeStatusEnum("status").notNull().default("frozen"),

    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull().defaultNow(),

    frozenBy: uuid("frozen_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    frozenByName: text("frozen_by_name"),

    declarationId: uuid("declaration_id").references(
      () => maturityDeclarationsTable.id,
      { onDelete: "set null" },
    ),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type ProjectOwnershipFreeze =
  typeof projectOwnershipFreezesTable.$inferSelect;
