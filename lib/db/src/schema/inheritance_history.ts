/**
 * inheritance_history.ts
 *
 * Ownership history records created after an inheritance claim is settled.
 * Each row documents one claimant receiving one share percentage from the
 * original partner's frozen stake.
 *
 * DESIGN RULE: Records are WRITE-ONCE — admin records a transfer manually
 * only after the claim reaches "approved" status through the full governance
 * workflow. No automatic computation or redistribution ever occurs.
 */

import { pgTable, uuid, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { partnersTable } from "./partners";
import { projectsTable } from "./projects";
import { partnerClaimantsTable } from "./claimants";
import { inheritanceClaimsTable } from "./inheritance";

export const inheritanceOwnershipHistoryTable = pgTable(
  "inheritance_ownership_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    claimId: uuid("claim_id")
      .notNull()
      .references(() => inheritanceClaimsTable.id, { onDelete: "restrict" }),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    fromPartnerId: uuid("from_partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    fromPartnerName: text("from_partner_name").notNull(),

    claimantId: uuid("claimant_id").references(() => partnerClaimantsTable.id, {
      onDelete: "set null",
    }),
    claimantName: text("claimant_name").notNull(),
    relationship: text("relationship"),

    sharePercentage: numeric("share_percentage", {
      precision: 7,
      scale: 4,
    }).notNull(),

    effectiveDate: timestamp("effective_date", {
      withTimezone: true,
    }).notNull(),

    notes: text("notes"),

    recordedBy: uuid("recorded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recordedByName: text("recorded_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type InheritanceOwnershipHistory =
  typeof inheritanceOwnershipHistoryTable.$inferSelect;
