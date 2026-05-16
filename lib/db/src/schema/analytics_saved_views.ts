/**
 * analytics_saved_views.ts
 *
 * Persists named filter + dashboard configurations for the Analytics Hub.
 * Users can save, pin, and optionally share views across the organisation.
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const analyticsSavedViewsTable = pgTable("analytics_saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),

  // ── Owner ───────────────────────────────────────────────────────────────
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  userName: text("user_name"),
  userRole: text("user_role"),

  // ── Identity ────────────────────────────────────────────────────────────
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").default("BarChart3"),
  color: text("color").default("violet"),

  // ── Filter state ─────────────────────────────────────────────────────────
  // Full filter payload — projectIds, dateStart, dateEnd, lifecyclePhases,
  // agreementModels, partnerIds, financialCategories, governanceStatuses, searchText
  filters: jsonb("filters").notNull().default("{}"),

  // ── Dashboard config ─────────────────────────────────────────────────────
  // Array of widget descriptors: { id, type, title, position, size }
  widgetConfig: jsonb("widget_config").notNull().default("[]"),

  // ── Active tab when view was saved ───────────────────────────────────────
  activeTab: text("active_tab").default("overview"),

  // ── Sharing & access ──────────────────────────────────────────────────────
  isPinned:   boolean("is_pinned").notNull().default(false),
  isPublic:   boolean("is_public").notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnalyticsSavedView     = typeof analyticsSavedViewsTable.$inferSelect;
export type AnalyticsSavedViewInsert = typeof analyticsSavedViewsTable.$inferInsert;
