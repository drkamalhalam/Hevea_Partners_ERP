/**
 * governance_meetings.ts — Governance meetings + resolutions
 *
 * GET  /governance-meetings                    — list meetings
 * POST /governance-meetings                    — create meeting (admin/dev)
 * GET  /governance-meetings/:id                — meeting detail + resolutions
 * PATCH /governance-meetings/:id               — update meeting
 * DELETE /governance-meetings/:id              — soft-delete (admin)
 * PATCH /governance-meetings/:id/status        — transition status
 *
 * GET  /governance-meetings/:id/resolutions    — list resolutions
 * POST /governance-meetings/:id/resolutions    — add resolution
 * PATCH /governance-meetings/:id/resolutions/:rid — update resolution
 * DELETE /governance-meetings/:id/resolutions/:rid — delete (admin)
 */

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  governanceMeetingsTable,
  governanceResolutionsTable,
  usersTable,
  projectsTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";

const router = Router();

async function actor(req: any) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  return u ?? null;
}

function fmtMeeting(m: typeof governanceMeetingsTable.$inferSelect) {
  return {
    id: m.id,
    title: m.title,
    meetingType: m.meetingType,
    status: m.status,
    meetingDate: m.meetingDate,
    meetingTime: m.meetingTime,
    venue: m.venue,
    agenda: m.agenda,
    minutes: m.minutes,
    attendees: m.attendeesJson,
    quorumMet: m.quorumMet,
    totalAttendees: m.totalAttendees,
    projectId: m.projectId,
    createdBy: m.createdBy,
    createdByName: m.createdByName,
    completedByName: m.completedByName,
    completedAt: m.completedAt?.toISOString() ?? null,
    isActive: m.isActive,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function fmtResolution(r: typeof governanceResolutionsTable.$inferSelect) {
  return {
    id: r.id,
    meetingId: r.meetingId,
    resolutionNumber: r.resolutionNumber,
    title: r.title,
    description: r.description,
    status: r.status,
    votesFor: r.votesFor,
    votesAgainst: r.votesAgainst,
    votesAbstain: r.votesAbstain,
    votingMethod: r.votingMethod,
    implementationDeadline: r.implementationDeadline,
    implementationNotes: r.implementationNotes,
    implementedAt: r.implementedAt?.toISOString() ?? null,
    projectId: r.projectId,
    recordedByName: r.recordedByName,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── Meetings ───────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { projectId, status, meetingType } = req.query as Record<string, string>;
    const conds: any[] = [eq(governanceMeetingsTable.isActive, true)];
    if (projectId) conds.push(eq(governanceMeetingsTable.projectId, projectId));
    if (status) conds.push(eq(governanceMeetingsTable.status, status));
    if (meetingType) conds.push(eq(governanceMeetingsTable.meetingType, meetingType));

    const rows = await db
      .select({
        meeting: governanceMeetingsTable,
        projectName: projectsTable.name,
      })
      .from(governanceMeetingsTable)
      .leftJoin(projectsTable, eq(governanceMeetingsTable.projectId, projectsTable.id))
      .where(and(...conds))
      .orderBy(desc(governanceMeetingsTable.meetingDate));

    res.json({
      meetings: rows.map((r) => ({
        ...fmtMeeting(r.meeting),
        projectName: r.projectName,
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list meetings");
    res.status(500).json({ error: "Failed to list meetings" });
  }
});

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  try {
    const me = await actor(req);
    const {
      title,
      meetingType,
      meetingDate,
      meetingTime,
      venue,
      agenda,
      projectId,
    } = req.body as {
      title: string;
      meetingType?: string;
      meetingDate: string;
      meetingTime?: string;
      venue?: string;
      agenda?: string;
      projectId?: string;
    };

    if (!title || !meetingDate) {
      res.status(400).json({ error: "title and meetingDate are required." });
      return;
    }

    const [meeting] = await db
      .insert(governanceMeetingsTable)
      .values({
        title: title.trim(),
        meetingType: meetingType ?? "general",
        meetingDate,
        meetingTime: meetingTime ?? null,
        venue: venue?.trim() ?? null,
        agenda: agenda?.trim() ?? null,
        projectId: projectId ?? null,
        status: "scheduled",
        createdBy: me?.id ?? null,
        createdByName: me?.displayName ?? null,
      })
      .returning();

    res.status(201).json({ meeting: fmtMeeting(meeting) });
  } catch (err) {
    req.log.error({ err }, "Failed to create meeting");
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id as string;
    const [row] = await db
      .select({
        meeting: governanceMeetingsTable,
        projectName: projectsTable.name,
      })
      .from(governanceMeetingsTable)
      .leftJoin(projectsTable, eq(governanceMeetingsTable.projectId, projectsTable.id))
      .where(eq(governanceMeetingsTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Meeting not found." }); return; }

    const resolutions = await db
      .select()
      .from(governanceResolutionsTable)
      .where(and(
        eq(governanceResolutionsTable.meetingId, id),
        eq(governanceResolutionsTable.isActive, true),
      ))
      .orderBy(governanceResolutionsTable.resolutionNumber);

    res.json({
      meeting: { ...fmtMeeting(row.meeting), projectName: row.projectName },
      resolutions: resolutions.map(fmtResolution),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get meeting");
    res.status(500).json({ error: "Failed to get meeting" });
  }
});

router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  try {
    const me = await actor(req);
    const id = req.params.id as string;
    const {
      title,
      meetingType,
      meetingDate,
      meetingTime,
      venue,
      agenda,
      minutes,
      attendees,
      quorumMet,
      totalAttendees,
    } = req.body as {
      title?: string;
      meetingType?: string;
      meetingDate?: string;
      meetingTime?: string;
      venue?: string;
      agenda?: string;
      minutes?: string;
      attendees?: any[];
      quorumMet?: boolean;
      totalAttendees?: number;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (meetingType !== undefined) updates.meetingType = meetingType;
    if (meetingDate !== undefined) updates.meetingDate = meetingDate;
    if (meetingTime !== undefined) updates.meetingTime = meetingTime;
    if (venue !== undefined) updates.venue = venue?.trim() ?? null;
    if (agenda !== undefined) updates.agenda = agenda?.trim() ?? null;
    if (minutes !== undefined) updates.minutes = minutes?.trim() ?? null;
    if (attendees !== undefined) updates.attendeesJson = attendees;
    if (quorumMet !== undefined) updates.quorumMet = quorumMet;
    if (totalAttendees !== undefined) updates.totalAttendees = totalAttendees;

    const [updated] = await db
      .update(governanceMeetingsTable)
      .set(updates)
      .where(eq(governanceMeetingsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Meeting not found." }); return; }
    res.json({ meeting: fmtMeeting(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update meeting");
    res.status(500).json({ error: "Failed to update meeting" });
  }
});

router.patch("/:id/status", requireRole("admin", "developer"), async (req, res) => {
  try {
    const me = await actor(req);
    const id = req.params.id as string;
    const { status } = req.body as { status: string };

    const validStatuses = ["scheduled", "in_progress", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "completed") {
      updates.completedBy = me?.id ?? null;
      updates.completedByName = me?.displayName ?? null;
      updates.completedAt = new Date();
    }

    const [updated] = await db
      .update(governanceMeetingsTable)
      .set(updates)
      .where(eq(governanceMeetingsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Meeting not found." }); return; }
    res.json({ meeting: fmtMeeting(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update meeting status");
    res.status(500).json({ error: "Failed to update meeting status" });
  }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const [updated] = await db
      .update(governanceMeetingsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(governanceMeetingsTable.id, id))
      .returning({ id: governanceMeetingsTable.id });
    if (!updated) { res.status(404).json({ error: "Meeting not found." }); return; }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete meeting");
    res.status(500).json({ error: "Failed to delete meeting" });
  }
});

// ── Resolutions ────────────────────────────────────────────────────────────

router.get("/:id/resolutions", async (req, res) => {
  try {
    const meetingId = req.params.id as string;
    const rows = await db
      .select()
      .from(governanceResolutionsTable)
      .where(and(
        eq(governanceResolutionsTable.meetingId, meetingId),
        eq(governanceResolutionsTable.isActive, true),
      ))
      .orderBy(governanceResolutionsTable.resolutionNumber);

    res.json({ resolutions: rows.map(fmtResolution), total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list resolutions");
    res.status(500).json({ error: "Failed to list resolutions" });
  }
});

router.post("/:id/resolutions", requireRole("admin", "developer"), async (req, res) => {
  try {
    const me = await actor(req);
    const meetingId = req.params.id as string;
    const {
      resolutionNumber,
      title,
      description,
      status,
      votesFor,
      votesAgainst,
      votesAbstain,
      votingMethod,
      implementationDeadline,
      projectId,
    } = req.body as {
      resolutionNumber?: string;
      title: string;
      description?: string;
      status?: string;
      votesFor?: number;
      votesAgainst?: number;
      votesAbstain?: number;
      votingMethod?: string;
      implementationDeadline?: string;
      projectId?: string;
    };

    if (!title) { res.status(400).json({ error: "title is required." }); return; }

    const [resolution] = await db
      .insert(governanceResolutionsTable)
      .values({
        meetingId,
        resolutionNumber: resolutionNumber?.trim() ?? null,
        title: title.trim(),
        description: description?.trim() ?? null,
        status: status ?? "proposed",
        votesFor: votesFor ?? 0,
        votesAgainst: votesAgainst ?? 0,
        votesAbstain: votesAbstain ?? 0,
        votingMethod: votingMethod ?? "show_of_hands",
        implementationDeadline: implementationDeadline ?? null,
        projectId: projectId ?? null,
        recordedBy: me?.id ?? null,
        recordedByName: me?.displayName ?? null,
      })
      .returning();

    res.status(201).json({ resolution: fmtResolution(resolution) });
  } catch (err) {
    req.log.error({ err }, "Failed to create resolution");
    res.status(500).json({ error: "Failed to create resolution" });
  }
});

router.patch("/:id/resolutions/:rid", requireRole("admin", "developer"), async (req, res) => {
  try {
    const rid = req.params.rid as string;
    const {
      title,
      description,
      status,
      votesFor,
      votesAgainst,
      votesAbstain,
      votingMethod,
      implementationDeadline,
      implementationNotes,
    } = req.body as {
      title?: string;
      description?: string;
      status?: string;
      votesFor?: number;
      votesAgainst?: number;
      votesAbstain?: number;
      votingMethod?: string;
      implementationDeadline?: string;
      implementationNotes?: string;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() ?? null;
    if (status !== undefined) {
      updates.status = status;
      if (status === "implemented") updates.implementedAt = new Date();
    }
    if (votesFor !== undefined) updates.votesFor = votesFor;
    if (votesAgainst !== undefined) updates.votesAgainst = votesAgainst;
    if (votesAbstain !== undefined) updates.votesAbstain = votesAbstain;
    if (votingMethod !== undefined) updates.votingMethod = votingMethod;
    if (implementationDeadline !== undefined) updates.implementationDeadline = implementationDeadline;
    if (implementationNotes !== undefined) updates.implementationNotes = implementationNotes?.trim() ?? null;

    const [updated] = await db
      .update(governanceResolutionsTable)
      .set(updates)
      .where(eq(governanceResolutionsTable.id, rid))
      .returning();

    if (!updated) { res.status(404).json({ error: "Resolution not found." }); return; }
    res.json({ resolution: fmtResolution(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update resolution");
    res.status(500).json({ error: "Failed to update resolution" });
  }
});

router.delete("/:id/resolutions/:rid", requireRole("admin"), async (req, res) => {
  try {
    const rid = req.params.rid as string;
    const [updated] = await db
      .update(governanceResolutionsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(governanceResolutionsTable.id, rid))
      .returning({ id: governanceResolutionsTable.id });
    if (!updated) { res.status(404).json({ error: "Resolution not found." }); return; }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete resolution");
    res.status(500).json({ error: "Failed to delete resolution" });
  }
});

export default router;
