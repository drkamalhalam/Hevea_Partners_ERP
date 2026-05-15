/**
 * governance_overrides.ts
 *
 * Routes:
 *   GET  /governance-overrides           — paginated list (admin/developer)
 *   POST /governance-overrides           — manual governance note entry
 *   GET  /governance-overrides/analytics — aggregated override analytics
 *   GET  /governance-overrides/:id       — single record detail
 *
 * All routes are admin/developer only. Write-once table — no PATCH/DELETE.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, governanceOverridesTable, projectsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { z } from "zod";

const router = Router();

// ── Helper: resolve actor ─────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── Query param schema ────────────────────────────────────────────────────────

const ListParams = z.object({
  projectId: z.string().optional(),
  overrideType: z.string().optional(),
  module: z.string().optional(),
  actorId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ManualNoteBody = z.object({
  projectId: z.string().uuid(),
  overrideType: z.string().min(1),
  module: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  originalValue: z.record(z.unknown()).optional(),
  finalValue: z.record(z.unknown()).optional(),
  overrideReason: z.string().min(5),
  relatedTable: z.string().optional(),
  relatedRecordId: z.string().optional(),
  supportingDocuments: z.array(z.record(z.unknown())).optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.string().optional(),
});

// ── GET /governance-overrides — list ─────────────────────────────────────────

router.get("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = ListParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, overrideType, module: mod, actorId, from, to, limit, offset } = parsed.data;

  const conditions = [];
  if (projectId) conditions.push(eq(governanceOverridesTable.projectId, projectId));
  if (overrideType) conditions.push(eq(governanceOverridesTable.overrideType, overrideType));
  if (mod) conditions.push(eq(governanceOverridesTable.module, mod));
  if (actorId) conditions.push(eq(governanceOverridesTable.actorId, actorId));
  if (from) conditions.push(gte(governanceOverridesTable.occurredAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(governanceOverridesTable.occurredAt, toDate));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [totRow]] = await Promise.all([
    db
      .select({
        id: governanceOverridesTable.id,
        projectId: governanceOverridesTable.projectId,
        projectName: projectsTable.name,
        overrideType: governanceOverridesTable.overrideType,
        module: governanceOverridesTable.module,
        title: governanceOverridesTable.title,
        description: governanceOverridesTable.description,
        originalValue: governanceOverridesTable.originalValue,
        finalValue: governanceOverridesTable.finalValue,
        overrideReason: governanceOverridesTable.overrideReason,
        actorId: governanceOverridesTable.actorId,
        actorName: governanceOverridesTable.actorName,
        actorRole: governanceOverridesTable.actorRole,
        relatedTable: governanceOverridesTable.relatedTable,
        relatedRecordId: governanceOverridesTable.relatedRecordId,
        supportingDocuments: governanceOverridesTable.supportingDocuments,
        metadata: governanceOverridesTable.metadata,
        occurredAt: governanceOverridesTable.occurredAt,
        createdAt: governanceOverridesTable.createdAt,
      })
      .from(governanceOverridesTable)
      .leftJoin(projectsTable, eq(governanceOverridesTable.projectId, projectsTable.id))
      .where(where)
      .orderBy(desc(governanceOverridesTable.occurredAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(governanceOverridesTable)
      .where(where),
  ]);

  res.json({ overrides: rows, total: totRow?.total ?? 0 });
});

// ── GET /governance-overrides/analytics — must be registered before /:id ──────

router.get("/analytics", requireRole("admin", "developer"), async (req, res) => {
  const { projectId, from, to } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (projectId) conditions.push(eq(governanceOverridesTable.projectId, projectId));
  if (from) conditions.push(gte(governanceOverridesTable.occurredAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(governanceOverridesTable.occurredAt, toDate));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [byType, byModule, byActor, byMonth, [totRow], recentActivity] = await Promise.all([
    db
      .select({
        overrideType: governanceOverridesTable.overrideType,
        count: count(),
      })
      .from(governanceOverridesTable)
      .where(where)
      .groupBy(governanceOverridesTable.overrideType)
      .orderBy(desc(count())),

    db
      .select({
        module: governanceOverridesTable.module,
        count: count(),
      })
      .from(governanceOverridesTable)
      .where(where)
      .groupBy(governanceOverridesTable.module)
      .orderBy(desc(count())),

    db
      .select({
        actorName: governanceOverridesTable.actorName,
        actorRole: governanceOverridesTable.actorRole,
        count: count(),
      })
      .from(governanceOverridesTable)
      .where(where)
      .groupBy(governanceOverridesTable.actorName, governanceOverridesTable.actorRole)
      .orderBy(desc(count()))
      .limit(20),

    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${governanceOverridesTable.occurredAt}), 'YYYY-MM')`,
        count: count(),
      })
      .from(governanceOverridesTable)
      .where(where)
      .groupBy(sql`date_trunc('month', ${governanceOverridesTable.occurredAt})`)
      .orderBy(sql`date_trunc('month', ${governanceOverridesTable.occurredAt}) ASC`),

    db.select({ total: count() }).from(governanceOverridesTable).where(where),

    db
      .select({
        id: governanceOverridesTable.id,
        projectId: governanceOverridesTable.projectId,
        projectName: projectsTable.name,
        overrideType: governanceOverridesTable.overrideType,
        module: governanceOverridesTable.module,
        title: governanceOverridesTable.title,
        description: governanceOverridesTable.description,
        originalValue: governanceOverridesTable.originalValue,
        finalValue: governanceOverridesTable.finalValue,
        overrideReason: governanceOverridesTable.overrideReason,
        actorId: governanceOverridesTable.actorId,
        actorName: governanceOverridesTable.actorName,
        actorRole: governanceOverridesTable.actorRole,
        relatedTable: governanceOverridesTable.relatedTable,
        relatedRecordId: governanceOverridesTable.relatedRecordId,
        supportingDocuments: governanceOverridesTable.supportingDocuments,
        metadata: governanceOverridesTable.metadata,
        occurredAt: governanceOverridesTable.occurredAt,
        createdAt: governanceOverridesTable.createdAt,
      })
      .from(governanceOverridesTable)
      .leftJoin(projectsTable, eq(governanceOverridesTable.projectId, projectsTable.id))
      .where(where)
      .orderBy(desc(governanceOverridesTable.occurredAt))
      .limit(10),
  ]);

  res.json({
    total: totRow?.total ?? 0,
    byType,
    byModule,
    byActor,
    byMonth,
    recentActivity,
  });
});

// ── POST /governance-overrides — manual note ──────────────────────────────────

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const actor = await resolveActor(clerkUserId);
  if (!actor) {
    res.status(403).json({ error: "User not registered" });
    return;
  }

  const parsed = ManualNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    projectId,
    overrideType,
    module: mod,
    title,
    description,
    originalValue,
    finalValue,
    overrideReason,
    relatedTable,
    relatedRecordId,
    supportingDocuments,
    metadata,
    occurredAt,
  } = parsed.data;

  const [override] = await db
    .insert(governanceOverridesTable)
    .values({
      projectId,
      overrideType,
      module: mod,
      title,
      description: description ?? null,
      originalValue: originalValue ?? null,
      finalValue: finalValue ?? null,
      overrideReason,
      actorId: actor.id ?? undefined,
      actorName: actor.displayName ?? null,
      actorRole: actor.role,
      relatedTable: relatedTable ?? null,
      relatedRecordId: relatedRecordId ?? null,
      supportingDocuments: supportingDocuments ?? null,
      metadata: metadata ?? null,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    })
    .returning();

  const [withProject] = await db
    .select({
      id: governanceOverridesTable.id,
      projectId: governanceOverridesTable.projectId,
      projectName: projectsTable.name,
      overrideType: governanceOverridesTable.overrideType,
      module: governanceOverridesTable.module,
      title: governanceOverridesTable.title,
      description: governanceOverridesTable.description,
      originalValue: governanceOverridesTable.originalValue,
      finalValue: governanceOverridesTable.finalValue,
      overrideReason: governanceOverridesTable.overrideReason,
      actorId: governanceOverridesTable.actorId,
      actorName: governanceOverridesTable.actorName,
      actorRole: governanceOverridesTable.actorRole,
      relatedTable: governanceOverridesTable.relatedTable,
      relatedRecordId: governanceOverridesTable.relatedRecordId,
      supportingDocuments: governanceOverridesTable.supportingDocuments,
      metadata: governanceOverridesTable.metadata,
      occurredAt: governanceOverridesTable.occurredAt,
      createdAt: governanceOverridesTable.createdAt,
    })
    .from(governanceOverridesTable)
    .leftJoin(projectsTable, eq(governanceOverridesTable.projectId, projectsTable.id))
    .where(eq(governanceOverridesTable.id, override.id))
    .limit(1);

  res.status(201).json({ override: withProject });
});

// ── GET /governance-overrides/:id — single record ─────────────────────────────

router.get("/:id", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);

  const [override] = await db
    .select({
      id: governanceOverridesTable.id,
      projectId: governanceOverridesTable.projectId,
      projectName: projectsTable.name,
      overrideType: governanceOverridesTable.overrideType,
      module: governanceOverridesTable.module,
      title: governanceOverridesTable.title,
      description: governanceOverridesTable.description,
      originalValue: governanceOverridesTable.originalValue,
      finalValue: governanceOverridesTable.finalValue,
      overrideReason: governanceOverridesTable.overrideReason,
      actorId: governanceOverridesTable.actorId,
      actorName: governanceOverridesTable.actorName,
      actorRole: governanceOverridesTable.actorRole,
      relatedTable: governanceOverridesTable.relatedTable,
      relatedRecordId: governanceOverridesTable.relatedRecordId,
      supportingDocuments: governanceOverridesTable.supportingDocuments,
      metadata: governanceOverridesTable.metadata,
      occurredAt: governanceOverridesTable.occurredAt,
      createdAt: governanceOverridesTable.createdAt,
    })
    .from(governanceOverridesTable)
    .leftJoin(projectsTable, eq(governanceOverridesTable.projectId, projectsTable.id))
    .where(eq(governanceOverridesTable.id, id))
    .limit(1);

  if (!override) {
    res.status(404).json({ error: "Override record not found" });
    return;
  }

  res.json({ override });
});

export default router;
