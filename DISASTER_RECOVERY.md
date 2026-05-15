# Hevea Partners ERP — Disaster Recovery & Migration Guide

> **Audience:** System administrators, DevOps engineers, and project owners.  
> **Scope:** This document covers data export, restoration, provider migration, and post-failure recovery for the Hevea Partners ERP.

---

## 1. System Architecture Summary

The ERP has three data layers that must all be preserved and migrated together:

| Layer | Technology | What it holds |
|---|---|---|
| Relational database | PostgreSQL (Replit managed) | All ERP records — projects, partners, agreements, financials, governance, etc. |
| File storage | Google Cloud Storage via Replit Object Storage sidecar | Uploaded documents (agreements, KYC, evidence files, photos) |
| Authentication | Clerk (Replit-managed whitelabel) | User accounts and session tokens |

---

## 2. Accessing the Backup & Export UI

Navigate to **System → Backup & Export** in the sidebar (admin role required).

All exports produce timestamped, self-describing JSON files. Each export run is logged in the `backup_runs` table.

---

## 3. Exporting Data

### 3.1 Full ERP Data Export (Database)

**Via the UI:** System → Backup & Export → Data Export tab → click "Export All ERP Data".

**What is exported:**  
Every table in the `public` PostgreSQL schema is exported. As of the last schema version, this includes 65+ tables:

- Core: `users`, `projects`, `partners`, `user_project_assignments`
- Finance: `agreements`, `contributions`, `expenditures`, `lca_configs`, `lca_ledger`, `lca_payment_events`, `landowner_accounting_entries`, `burden_recovery_entries`, etc.
- Operations: `production_log`, `inventory`, `sales`, `buyers`, `distribution_records`, `fifty_pct_sessions`, `epp_entries`, etc.
- Governance: `nominees`, `inheritance_claims`, `prematurity_succession`, `governance_meetings`, etc.
- System: `documents`, `document_access_logs`, `backup_runs`, `audit_logs`, etc.

**Export file format:**
```json
{
  "meta": {
    "schemaVersion": "1.0",
    "application": "Hevea Partners ERP",
    "exportedAt": "2026-05-15T10:00:00Z",
    "exportedBy": "Admin Name",
    "tableCount": 65,
    "totalRecords": 12450,
    "durationMs": 3200
  },
  "counts": {
    "projects": 12,
    "partners": 87,
    "..."
  },
  "tables": {
    "projects": [...],
    "partners": [...],
    "..."
  }
}
```

**Via cURL (for automation):**
```bash
curl -X POST https://<your-domain>/api/backup/export/data \
  -H "Authorization: Bearer <clerk-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Scheduled weekly export"}' \
  -o "hevea-erp-export-$(date +%Y-%m-%d).json"
```

### 3.2 Document Manifest Export

Exports metadata and GCS storage paths for every uploaded file.

**Via the UI:** Backup & Export → Documents tab → click "Export Document Manifest".

**What is exported:**  
Every row in the `documents` table enriched with project name. Includes `file_object_path` (the GCS object path needed to copy files during a migration).

**Via cURL:**
```bash
curl -X POST https://<your-domain>/api/backup/export/documents \
  -H "Authorization: Bearer <clerk-jwt>" \
  -o "hevea-document-manifest-$(date +%Y-%m-%d).json"
```

### 3.3 Integrity Verification

Before any export or migration, run the integrity check to detect data problems:

**Via the UI:** Backup & Export → Overview tab → click "Run Integrity Check".

Checks performed:
1. Documents with no storage path (`file_object_path` is null/empty)
2. Documents referencing non-existent projects
3. Non-admin users without project assignments
4. EPP entries without valid settlement sessions
5. Duplicate Clerk user IDs
6. Projects with no lifecycle history
7. Partners without associated user assignments

Resolve all `error`-severity issues before migrating.

---

## 4. Restoring from a Data Export

### 4.1 Prerequisites

- A fresh PostgreSQL database (14+)
- Node.js 18+ and pnpm 8+ installed
- The ERP source code (this repository)
- The `.env` file configured (see `.env.example`)

### 4.2 Step-by-step Restore

**Step 1: Set up the environment**
```bash
cp .env.example .env
# Fill in DATABASE_URL, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, etc.
```

**Step 2: Create the database schema**
```bash
pnpm --filter @workspace/db run push
```
This runs Drizzle's schema push, which creates all tables from the TypeScript schema definitions. No manual SQL needed.

**Step 3: Import data from the JSON export**

Use the restore script (or write a custom one):

```typescript
// scripts/restore.ts
import fs from "fs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const exportFile = process.argv[2];

const data = JSON.parse(fs.readFileSync(exportFile, "utf8"));

for (const [tableName, rows] of Object.entries(data.tables)) {
  if (!Array.isArray(rows) || rows.length === 0) continue;
  
  const columns = Object.keys(rows[0] as object);
  const placeholders = rows.map(
    (_, rowIdx) =>
      `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(", ")})`
  );
  
  const values = rows.flatMap((row: object) => Object.values(row));
  const sql = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`;
  
  await pool.query(sql, values);
  console.log(`Restored ${rows.length} rows into ${tableName}`);
}

await pool.end();
```

Run it:
```bash
npx ts-node scripts/restore.ts hevea-erp-export-2026-05-15.json
```

> **Important:** The `ON CONFLICT DO NOTHING` clause prevents duplicate errors if you run the restore twice. UUIDs are preserved from the export, so foreign keys remain consistent.

**Step 4: Restore documents (files)**

See Section 5 (Storage Migration) for copying files to the new storage backend.

**Step 5: Verify the restore**
```bash
curl https://<new-domain>/api/backup/verify \
  -H "Authorization: Bearer <clerk-jwt>"
```

Check the integrity report for any issues.

---

## 5. Storage (Document Files) Migration

Document files are stored in Google Cloud Storage via the Replit Object Storage sidecar. The `file_object_path` column in the `documents` table identifies each file's path within the configured bucket.

### 5.1 Export File List from the Document Manifest

```bash
# Extract all GCS paths from the document manifest
cat hevea-document-manifest-2026-05-15.json | \
  jq -r '.documents[].file_object_path | select(. != null)'
```

### 5.2 Bulk Copy Using gsutil

**Same GCS bucket, different project:**
```bash
gsutil -m cp -r gs://SOURCE_BUCKET/PRIVATE_OBJECT_DIR gs://TARGET_BUCKET/PRIVATE_OBJECT_DIR
gsutil -m cp -r gs://SOURCE_BUCKET/PUBLIC_SEARCH_PATH gs://TARGET_BUCKET/PUBLIC_SEARCH_PATH
```

**To a different storage provider (AWS S3):**
```bash
# Using rclone (https://rclone.org)
rclone copy gcs:SOURCE_BUCKET/path s3:TARGET_BUCKET/path --progress
```

### 5.3 Update the Storage Sidecar Configuration

The ERP does not hardcode the storage sidecar URL. Override it with:
```env
REPLIT_SIDECAR_ENDPOINT=https://your-new-storage-sidecar-url
DEFAULT_OBJECT_STORAGE_BUCKET_ID=your-new-bucket-id
PRIVATE_OBJECT_DIR=private
PUBLIC_OBJECT_SEARCH_PATHS=public
```

See `ARCHITECTURE.md` and `artifacts/api-server/src/lib/objectStorage.ts` for the full storage configuration reference.

---

## 6. Full Migration to a New Hosting Provider

### 6.1 What is Portable

Everything in this ERP is designed to be provider-independent:

- **Database**: Standard PostgreSQL. Drizzle ORM generates SQL that runs on any PostgreSQL 14+ instance (AWS RDS, Supabase, Railway, Neon, self-hosted).
- **File storage**: The GCS sidecar URL is configurable via `REPLIT_SIDECAR_ENDPOINT`. Replace it with any compatible sidecar or adapt `objectStorage.ts`.
- **Authentication**: Clerk supports external tenant configuration (migrate away from Replit-managed Clerk by creating a standalone Clerk application and replacing `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY`).
- **App code**: Standard Node.js Express + React Vite. Runs anywhere Node.js 18+ is available.

### 6.2 Migration Checklist

- [ ] Export full ERP data (Section 3.1)
- [ ] Export document manifest (Section 3.2)
- [ ] Run integrity check; resolve all errors (Section 3.3)
- [ ] Provision target database (PostgreSQL 14+)
- [ ] Copy all environment variables (see `.env.example`)
- [ ] Push schema to target database (`pnpm --filter @workspace/db run push`)
- [ ] Import data from export JSON (Section 4.2 Step 3)
- [ ] Copy document files to target storage (Section 5)
- [ ] Update `REPLIT_SIDECAR_ENDPOINT` and storage env vars
- [ ] Configure Clerk with new domain (add production domain in Clerk dashboard)
- [ ] Deploy frontend and API server
- [ ] Run integrity check on the new environment
- [ ] Smoke-test: login, open a project, view a document, check a financial summary
- [ ] DNS cutover

### 6.3 Environment Variables Required on New Provider

See `.env.example` for the complete list. Critical variables:

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...
VITE_CLERK_PUBLISHABLE_KEY=pk_...
SESSION_SECRET=<random 64-char string>
DEFAULT_OBJECT_STORAGE_BUCKET_ID=<bucket id>
PRIVATE_OBJECT_DIR=private
PUBLIC_OBJECT_SEARCH_PATHS=public
REPLIT_SIDECAR_ENDPOINT=https://your-gcs-sidecar-url  # optional override
```

---

## 7. Recovery After Server Failure

### 7.1 Database Failure (Managed PostgreSQL)

If using Replit-managed PostgreSQL:
- Replit performs daily automated snapshots. Contact Replit support to restore a snapshot.
- If the managed DB is unrecoverable, provision a new PostgreSQL instance and follow Section 4.2.

If using self-hosted PostgreSQL:
- Restore from `pg_dump` backup: `pg_restore -d $DATABASE_URL backup.dump`
- Or restore from ERP JSON export: follow Section 4.2.

### 7.2 Application Server Failure

The ERP is stateless at the application layer (all state is in PostgreSQL and GCS). To recover:

1. Redeploy the application (push the repository to the new server, set env vars, start workflows).
2. No data is lost — all state lives in the database and storage.
3. Run the integrity check to confirm the deployment is healthy.

### 7.3 Partial Data Loss (Specific Tables)

If only specific tables are corrupted or lost:

1. Open the last JSON export file.
2. Extract the affected table: `jq '.tables.projects' export.json > projects_restore.json`
3. Import using the restore script targeting only that table.

### 7.4 Document File Loss (Storage Corruption)

If GCS files are lost but the `documents` table is intact:

1. The document manifest export lists every expected file path.
2. Cross-reference with a GCS bucket listing to identify missing files.
3. Restore missing files from a GCS-level backup (Replit Object Storage retains versioning by default).

---

## 8. Recommended Backup Schedule

| Frequency | Action |
|---|---|
| Daily | Trigger ERP data export via the Backup & Export UI or scheduled cURL |
| Weekly | Export document manifest |
| Weekly | Run integrity check; alert on any errors |
| Before every major change | Export data + run integrity check |
| Before migration | Full export (data + documents) + integrity check |

Store exports in a separate location from the application (e.g., a different GCS bucket, S3, or local encrypted storage).

---

## 9. Contact & Escalation

For issues requiring platform-level access (managed PostgreSQL snapshots, GCS bucket-level recovery):

- **Replit**: [support.replit.com](https://support.replit.com)
- **Clerk**: [clerk.com/support](https://clerk.com/support)

For application-level issues, refer to `ARCHITECTURE.md` for full system documentation.
