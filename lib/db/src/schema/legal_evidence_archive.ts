/**
 * legal_evidence_archive.ts
 *
 * Secure legal document evidence archive with immutable references,
 * version preservation, and full access tracking.
 *
 * Architecture:
 *   legalEvidenceArchiveTable — immutable archive reference records.
 *     No DELETE routes. `archiveStatus` may be updated to 'superseded'
 *     when a newer version is registered, but the record and its GCS object
 *     reference are preserved forever.
 *
 *   evidenceAccessLogTable — immutable access event log.
 *     Every view, download, or presign event is recorded here. No DELETE.
 *
 * Storage:
 *   Actual files live in GCS under `fileObjectPath`.
 *   The path is set at upload time and never changed.
 *
 * Version chain:
 *   Each new version links back via `parentArchiveId`.
 *   When a new version is registered the previous record's
 *   `isLatestVersion` is set to FALSE (this is the only mutable field
 *   beyond archiveStatus).
 *
 * Document types:
 *   agreement | declaration_deed | death_certificate | gd_entry |
 *   invoice | payment_proof | governance_document | supporting_evidence | other
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// ── Main archive record ───────────────────────────────────────────────────────

export const legalEvidenceArchiveTable = pgTable("legal_evidence_archive", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Scope — projectId may be null for cross-project/global documents
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  // Classification
  documentType: text("document_type").notNull(),
  // agreement | declaration_deed | death_certificate | gd_entry | invoice |
  // payment_proof | governance_document | supporting_evidence | other

  title: text("title").notNull(),
  description: text("description"),
  tags: jsonb("tags"), // string[]

  // ── Version chain ──────────────────────────────────────────────────────────
  versionNumber: integer("version_number").notNull().default(1),
  parentArchiveId: uuid("parent_archive_id"),
  // Self-referential FK enforced at application layer (no DB FK to avoid
  // circular reference issues during insertion).
  isLatestVersion: boolean("is_latest_version").notNull().default(true),

  // ── Storage reference (set once, never changed) ────────────────────────────
  fileObjectPath: text("file_object_path"), // GCS object path via objectStorageService
  externalUrl: text("external_url"),        // for externally hosted references
  originalFileName: text("original_file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  checksum: text("checksum"),               // SHA-256 hex, validated on upload by client

  // ── Linked entity (the record this evidence supports) ─────────────────────
  relatedTable: text("related_table"),
  relatedRecordId: text("related_record_id"),

  // ── Issuing / evidentiary metadata ────────────────────────────────────────
  documentDate: timestamp("document_date", { withTimezone: true }),
  issuingAuthority: text("issuing_authority"),
  referenceNumber: text("reference_number"), // e.g. GD number, invoice number, deed number

  // ── Uploaded by ───────────────────────────────────────────────────────────
  uploadedById: uuid("uploaded_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  uploadedByName: text("uploaded_by_name"),
  uploadedByRole: text("uploaded_by_role"),

  // ── Archive status ────────────────────────────────────────────────────────
  // active      — current, accessible
  // superseded  — a newer version has been registered (still accessible)
  // archived    — explicitly archived by admin (still accessible, flagged)
  archiveStatus: text("archive_status").notNull().default("active"),

  // ── Extra context ─────────────────────────────────────────────────────────
  metadata: jsonb("metadata"),

  // ── Immutable timestamps ───────────────────────────────────────────────────
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Access log (fully immutable) ──────────────────────────────────────────────

export const evidenceAccessLogTable = pgTable("evidence_access_log", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Parent
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => legalEvidenceArchiveTable.id, { onDelete: "cascade" }),

  // Denormalized for reporting without joins
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  documentType: text("document_type"),
  documentTitle: text("document_title"),

  // What happened
  accessType: text("access_type").notNull(),
  // view | download | presign_url | search_result | api_read

  // Who
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  actorRole: text("actor_role"),

  // Network context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // Immutable
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ──────────────────────────────────────────────────────────────────────

export type LegalEvidenceArchive = typeof legalEvidenceArchiveTable.$inferSelect;
export type EvidenceAccessLog = typeof evidenceAccessLogTable.$inferSelect;
