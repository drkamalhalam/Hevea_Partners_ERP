/**
 * report_exports.ts
 *
 * POST   /report-exports                — create + generate a new export job
 * GET    /report-exports                — list jobs for current user (history)
 * GET    /report-exports/projects       — list role-accessible projects
 * GET    /report-exports/stats          — queue statistics (admin/developer)
 * GET    /report-exports/:id            — get single job by id
 * GET    /report-exports/:id/download   — stream generated file
 * DELETE /report-exports/:id            — soft-delete job (admin/developer)
 *
 * Role-based permissions:
 *   admin, developer       — all 6 report types
 *   landowner, investor    — financial, ownership, distribution
 *   employee               — financial, inventory
 *   operational_staff      — inventory
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { PassThrough } from "node:stream";
import { db } from "@workspace/db";
import {
  reportExportJobsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchReportData } from "../lib/reportDataService";
import { generatePDF, generateExcel, type ReportMeta } from "../lib/reportGenerator";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();
const objectStorage = new ObjectStorageService();

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOWED_REPORTS: Record<string, readonly string[]> = {
  admin:             ["financial", "project", "ownership", "distribution", "inventory", "governance"],
  developer:         ["financial", "project", "ownership", "distribution", "inventory", "governance"],
  landowner:         ["financial", "ownership", "distribution"],
  investor:          ["financial", "ownership", "distribution"],
  employee:          ["financial", "inventory"],
  operational_staff: ["inventory"],
};

async function resolveUser(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT project_id FROM user_project_assignments WHERE user_id = ${userId} AND is_active = true`
  );
  return (rows.rows as Array<{ project_id: string }>).map((r) => r.project_id);
}

// ── GET /report-exports/projects ─────────────────────────────────────────────
router.get("/projects", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });

  const isGlobal = user.role === "admin" || user.role === "developer";

  let projects;
  if (isGlobal) {
    projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, projectCode: projectsTable.projectCode, commercialModel: projectsTable.commercialModel, activationStatus: projectsTable.activationStatus })
      .from(projectsTable)
      .where(eq(projectsTable.isActive, true))
      .orderBy(projectsTable.name);
  } else {
    const assignedIds = await getAssignedProjectIds(user.id);
    if (assignedIds.length === 0) return void res.json({ projects: [] });
    projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, projectCode: projectsTable.projectCode, commercialModel: projectsTable.commercialModel, activationStatus: projectsTable.activationStatus })
      .from(projectsTable)
      .where(and(eq(projectsTable.isActive, true), inArray(projectsTable.id, assignedIds)))
      .orderBy(projectsTable.name);
  }

  res.json({ projects });
});

// ── GET /report-exports/stats ─────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });
  if (user.role !== "admin" && user.role !== "developer") {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const statsResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued')      AS queued,
      COUNT(*) FILTER (WHERE status = 'generating')  AS generating,
      COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
      COUNT(*) FILTER (WHERE status = 'expired')     AS expired,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last_7d,
      COALESCE(SUM(download_count), 0) AS total_downloads,
      COALESCE(SUM(file_size_bytes) FILTER (WHERE status = 'completed'), 0) AS total_bytes
    FROM report_export_jobs
    WHERE is_active = true
  `);

  const byType = await db.execute(sql`
    SELECT report_type, COUNT(*) AS count, SUM(download_count) AS downloads
    FROM report_export_jobs WHERE is_active = true
    GROUP BY report_type ORDER BY count DESC
  `);

  const byFormat = await db.execute(sql`
    SELECT export_format, COUNT(*) AS count
    FROM report_export_jobs WHERE is_active = true
    GROUP BY export_format
  `);

  res.json({
    stats: statsResult.rows[0] ?? {},
    byType: byType.rows,
    byFormat: byFormat.rows,
  });
});

// ── GET /report-exports ───────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });

  const isGlobal = user.role === "admin" || user.role === "developer";

  const jobs = await db
    .select()
    .from(reportExportJobsTable)
    .where(
      and(
        eq(reportExportJobsTable.isActive, true),
        isGlobal
          ? undefined
          : eq(reportExportJobsTable.userId, user.id)
      )
    )
    .orderBy(desc(reportExportJobsTable.createdAt))
    .limit(200);

  res.json({ jobs });
});

// ── GET /report-exports/:id ───────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });

  const [job] = await db
    .select()
    .from(reportExportJobsTable)
    .where(and(eq(reportExportJobsTable.id, req.params.id), eq(reportExportJobsTable.isActive, true)))
    .limit(1);

  if (!job) return void res.status(404).json({ error: "Job not found" });

  const isOwner = job.userId === user.id;
  const isGlobal = user.role === "admin" || user.role === "developer";
  if (!isOwner && !isGlobal) return void res.status(403).json({ error: "Forbidden" });

  res.json({ job });
});

// ── POST /report-exports ──────────────────────────────────────────────────────
const CreateExportSchema = z.object({
  reportType:   z.enum(["financial", "project", "ownership", "distribution", "inventory", "governance"]),
  exportFormat: z.enum(["pdf", "excel"]),
  projectId:    z.string().uuid(),
  dateStart:    z.string().optional().nullable(),
  dateEnd:      z.string().optional().nullable(),
  filters:      z.record(z.unknown()).optional().nullable(),
});

router.post("/", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });

  const parsed = CreateExportSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { reportType, exportFormat, projectId, dateStart, dateEnd, filters } = parsed.data;

  // Role check
  const allowed = ALLOWED_REPORTS[user.role as string] ?? [];
  if (!allowed.includes(reportType)) {
    return void res.status(403).json({ error: `Your role (${user.role}) cannot export '${reportType}' reports.` });
  }

  // Project access check
  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, projectCode: projectsTable.projectCode })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.isActive, true)))
    .limit(1);

  if (!project) return void res.status(404).json({ error: "Project not found" });

  const isGlobal = user.role === "admin" || user.role === "developer";
  if (!isGlobal) {
    const assignedIds = await getAssignedProjectIds(user.id);
    if (!assignedIds.includes(projectId)) {
      return void res.status(403).json({ error: "You do not have access to this project" });
    }
  }

  // Create job record
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [job] = await db
    .insert(reportExportJobsTable)
    .values({
      userId:       user.id,
      userName:     user.displayName ?? user.email ?? "Unknown",
      userRole:     user.role,
      reportType,
      exportFormat,
      projectId,
      projectName:  project.name,
      dateStart:    dateStart ?? null,
      dateEnd:      dateEnd ?? null,
      filters:      filters ?? null,
      status:       "generating",
      expiresAt,
    })
    .returning();

  // ── Generate report synchronously ─────────────────────────────────────────
  try {
    const generatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const userName = user.displayName ?? user.email ?? "Unknown";

    const { data: reportData, meta: reportMeta } = await fetchReportData(
      reportType, projectId, dateStart, dateEnd
    );

    const meta: ReportMeta = {
      reportType,
      reportTitle:      reportMeta.reportTitle ?? reportType,
      projectName:      project.name,
      projectCode:      project.projectCode,
      dateStart:        dateStart ?? null,
      dateEnd:          dateEnd ?? null,
      generatedAt,
      generatedBy:      userName,
      generatedByRole:  user.role,
    };

    const safeProjectCode = (project.projectCode ?? project.name).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const dateTag = dateStart ? `-${dateStart}` : "";

    let buffer: Buffer;
    let mimeType: string;
    let fileName: string;

    if (exportFormat === "pdf") {
      buffer   = await generatePDF(meta, reportData);
      mimeType = "application/pdf";
      fileName = `${reportType}-report-${safeProjectCode}${dateTag}.pdf`;
    } else {
      buffer   = await generateExcel(meta, reportData);
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      fileName = `${reportType}-report-${safeProjectCode}${dateTag}.xlsx`;
    }

    const fileObjectPath = await objectStorage.saveBuffer(buffer, mimeType, fileName);

    await db
      .update(reportExportJobsTable)
      .set({
        status:         "completed",
        fileName,
        fileObjectPath,
        mimeType,
        fileSizeBytes:  buffer.length,
        generatedAt:    now,
        updatedAt:      new Date(),
      })
      .where(eq(reportExportJobsTable.id, job.id));

    const [updatedJob] = await db
      .select()
      .from(reportExportJobsTable)
      .where(eq(reportExportJobsTable.id, job.id))
      .limit(1);

    req.log.info({ jobId: job.id, reportType, exportFormat, bytes: buffer.length }, "Report export completed");
    res.status(201).json({ job: updatedJob });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    req.log.error({ jobId: job.id, err }, "Report export failed");

    await db
      .update(reportExportJobsTable)
      .set({ status: "failed", errorMessage: errMsg, updatedAt: new Date() })
      .where(eq(reportExportJobsTable.id, job.id));

    const [failedJob] = await db
      .select()
      .from(reportExportJobsTable)
      .where(eq(reportExportJobsTable.id, job.id))
      .limit(1);

    res.status(500).json({ job: failedJob, error: `Report generation failed: ${errMsg}` });
  }
});

// ── GET /report-exports/:id/download ─────────────────────────────────────────
router.get("/:id/download", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });

  const [job] = await db
    .select()
    .from(reportExportJobsTable)
    .where(and(eq(reportExportJobsTable.id, req.params.id), eq(reportExportJobsTable.isActive, true)))
    .limit(1);

  if (!job) return void res.status(404).json({ error: "Job not found" });

  const isOwner = job.userId === user.id;
  const isGlobal = user.role === "admin" || user.role === "developer";
  if (!isOwner && !isGlobal) return void res.status(403).json({ error: "Forbidden" });

  if (job.status !== "completed" || !job.fileObjectPath) {
    return void res.status(409).json({ error: "Report is not ready for download" });
  }

  // Check expiry
  if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
    await db.update(reportExportJobsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(reportExportJobsTable.id, job.id));
    return void res.status(410).json({ error: "This report has expired. Please generate a new one." });
  }

  try {
    const file = await objectStorage.getObjectEntityFile(job.fileObjectPath);
    const response = await objectStorage.downloadObject(file, 0);

    // Increment download count
    await db
      .update(reportExportJobsTable)
      .set({
        downloadCount: (job.downloadCount ?? 0) + 1,
        lastDownloadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reportExportJobsTable.id, job.id));

    const fileName = job.fileName ?? "report";
    res.set({
      "Content-Type":        job.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control":       "private, no-cache",
    });

    if (response.body) {
      const reader = response.body.getReader();
      const passThrough = new PassThrough();
      passThrough.pipe(res);

      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) { passThrough.end(); return; }
        passThrough.write(value);
        await pump();
      };
      await pump();
    } else {
      res.status(500).json({ error: "Failed to stream file" });
    }
  } catch (err: unknown) {
    if (err instanceof ObjectNotFoundError) {
      return void res.status(410).json({ error: "File no longer exists in storage. Please regenerate." });
    }
    req.log.error({ err, jobId: job.id }, "Download failed");
    res.status(500).json({ error: "Download failed" });
  }
});

// ── DELETE /report-exports/:id ────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkId);
  if (!user) return void res.status(401).json({ error: "User not found" });

  const [job] = await db
    .select()
    .from(reportExportJobsTable)
    .where(and(eq(reportExportJobsTable.id, req.params.id), eq(reportExportJobsTable.isActive, true)))
    .limit(1);

  if (!job) return void res.status(404).json({ error: "Job not found" });

  const isOwner = job.userId === user.id;
  const isGlobal = user.role === "admin" || user.role === "developer";
  if (!isOwner && !isGlobal) return void res.status(403).json({ error: "Forbidden" });

  await db
    .update(reportExportJobsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(reportExportJobsTable.id, job.id));

  res.json({ success: true });
});

export { router as reportExportsRouter };
