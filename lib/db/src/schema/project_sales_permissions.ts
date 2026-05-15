import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * project_sales_permissions — per-project authorization to create sales orders.
 *
 * Only users with an active permission record may initiate a sale for a project.
 * Separate permission flags for selling vs. receiving payment allow fine-grained control.
 *
 * role_type: developer | landowner | employee | operational_staff
 * allowed_payment_modes: online_only | cash_only | both
 */
export const projectSalesPermissionsTable = pgTable(
  "project_sales_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull().default(""),

    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull().default(""),
    roleType: text("role_type").notNull().default("employee"),

    canSell: boolean("can_sell").notNull().default(true),
    canReceivePayment: boolean("can_receive_payment").notNull().default(false),
    allowedPaymentModes: text("allowed_payment_modes")
      .notNull()
      .default("both"),

    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),

    grantedById: uuid("granted_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    grantedByName: text("granted_by_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
