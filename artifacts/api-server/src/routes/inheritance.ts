/**
 * inheritance.ts — Inheritance & Claimant Succession API
 *
 * Routes (all under /inheritance-claims):
 *   GET    /                          list claims
 *   POST   /                          create claim
 *   GET    /:id                       claim detail (with claimants, shares, docs)
 *   PATCH  /:id                       update status / notes
 *   DELETE /:id                       soft-delete (admin only)
 *   PATCH  /:id/status                advance status in workflow
 *
 *   GET    /:id/shares                list share proposals
 *   POST   /:id/shares                propose share (admin/developer)
 *   PATCH  /:id/shares/:shareId       update share / approve / mark disputed
 *   DELETE /:id/shares/:shareId       remove share (admin)
 *
 *   GET    /:id/documents             list documents
 *   POST   /:id/documents             register document placeholder
 *   PATCH  /:id/documents/:docId      verify / update document
 *   DELETE /:id/documents/:docId      soft-remove document (admin)
 */

import { Router } from "express";
import { and, eq, inArray, desc, sql, count, ne } from "drizzle-orm";
import {
  db,
  inheritanceClaimsTable,
  inheritanceClaimantSharesTable,
  inheritanceDocumentsTable,
  inheritanceOwnershipHistoryTable,
  partnerClaimantsTable,
  partnersTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────

async function resolveUser(clerkUserId: string) {
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return u ?? null;
}

function formatClaim(c: typeof inheritanceClaimsTable.$inferSelect) {
  return {
    id: c.id,
    partnerId: c.partnerId,
    projectId: c.projectId,
    claimType: c.claimType,
    status: c.status,
    description: c.description,
    initiatedBy: c.initiatedBy,
    initiatedByName: c.initiatedByName,
    developerApprovedBy: c.developerApprovedBy,
    developerApprovedByName: c.developerApprovedByName,
    developerApprovedAt: c.developerApprovedAt?.toISOString() ?? null,
    approvedBy: c.approvedBy,
    approvedByName: c.approvedByName,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    rejectedBy: c.rejectedBy,
    rejectedByName: c.rejectedByName,
    rejectedAt: c.rejectedAt?.toISOString() ?? null,
    rejectionReason: c.rejectionReason,
    settlementNotes: c.settlementNotes,
    reviewNotes: c.reviewNotes,
    isActive: c.isActive,
    createdBy: c.createdBy,
    createdByName: c.createdByName,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt?.toISOString() ?? null,
  };
}

function formatShare(s: typeof inheritanceClaimantSharesTable.$inferSelect) {
  return {
    id: s.id,
    claimId: s.claimId,
    claimantId: s.claimantId,
    proposedSharePct: s.proposedSharePct,
    shareNotes: s.shareNotes,
    status: s.status,
    proposedBy: s.proposedBy,
    proposedByName: s.proposedByName,
    approvedBy: s.approvedBy,
    approvedByName: s.approvedByName,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    disputeNotes: s.disputeNotes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

function formatDoc(d: typeof inheritanceDocumentsTable.$inferSelect) {
  return {
    id: d.id,
    claimId: d.claimId,
    claimantId: d.claimantId,
    documentType: d.documentType,
    documentTitle: d.documentTitle,
    description: d.description,
    fileObjectPath: d.fileObjectPath,
    mimeType: d.mimeType,
    verificationStatus: d.verificationStatus,
    verificationNotes: d.verificationNotes,
    uploadedBy: d.uploadedBy,
    uploadedByName: d.uploadedByName,
    verifiedBy: d.verifiedBy,
    verifiedByName: d.verifiedByName,
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
    isActive: d.isActive,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt?.toISOString() ?? null,
  };
}

// Valid status transitions (forward-only, except rejection)
const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ["under_review", "rejected"],
  under_review: ["developer_approved", "rejected"],
  developer_approved: ["documents_verified", "rejected"],
  documents_verified: ["approved", "rejected"],
  approved: ["settled"],
  rejected: [],
  settled: [],
};

// ── GET /inheritance-claims ───────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { projectId, partnerId, status } = req.query as Record<string, string>;
    const conditions = [eq(inheritanceClaimsTable.isActive, true)];
    if (projectId) conditions.push(eq(inheritanceClaimsTable.projectId, projectId));
    if (partnerId) conditions.push(eq(inheritanceClaimsTable.partnerId, partnerId));
    if (status) conditions.push(eq(inheritanceClaimsTable.status, status as any));

    const claims = await db
      .select({
        claim: inheritanceClaimsTable,
        partnerName: partnersTable.name,
        projectName: projectsTable.name,
      })
      .from(inheritanceClaimsTable)
      .leftJoin(partnersTable, eq(inheritanceClaimsTable.partnerId, partnersTable.id))
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(and(...conditions))
      .orderBy(desc(inheritanceClaimsTable.createdAt));

    res.json({
      claims: claims.map((row) => ({
        ...formatClaim(row.claim),
        partnerName: row.partnerName,
        projectName: row.projectName,
      })),
      total: claims.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list inheritance claims");
    res.status(500).json({ error: "Failed to list inheritance claims" });
  }
});

// ── POST /inheritance-claims ──────────────────────────────────────────────

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const { partnerId, projectId, claimType, description } = req.body as {
      partnerId: string;
      projectId: string;
      claimType: string;
      description?: string;
    };

    if (!partnerId || !projectId || !claimType) {
      res.status(400).json({ error: "partnerId, projectId and claimType are required." });
    }

    const [claim] = await db
      .insert(inheritanceClaimsTable)
      .values({
        partnerId,
        projectId,
        claimType: claimType as any,
        description: description?.trim() || null,
        initiatedBy: actor?.id ?? null,
        initiatedByName: actor?.displayName ?? null,
        createdBy: actor?.id ?? null,
        createdByName: actor?.displayName ?? null,
      })
      .returning();

    res.status(201).json({ claim: formatClaim(claim) });
  } catch (err) {
    req.log.error({ err }, "Failed to create inheritance claim");
    res.status(500).json({ error: "Failed to create inheritance claim" });
  }
});

// ── GET /inheritance-claims/:id ───────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id as string;

    const [row] = await db
      .select({
        claim: inheritanceClaimsTable,
        partnerName: partnersTable.name,
        projectName: projectsTable.name,
      })
      .from(inheritanceClaimsTable)
      .leftJoin(partnersTable, eq(inheritanceClaimsTable.partnerId, partnersTable.id))
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(eq(inheritanceClaimsTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Claim not found." }); return; }

    // Load claimants linked to same (partner, project)
    const claimants = await db
      .select()
      .from(partnerClaimantsTable)
      .where(
        and(
          eq(partnerClaimantsTable.partnerId, row.claim.partnerId),
          eq(partnerClaimantsTable.projectId, row.claim.projectId),
          eq(partnerClaimantsTable.isActive, true),
        ),
      );

    // Load share proposals
    const shares = await db
      .select({
        share: inheritanceClaimantSharesTable,
        claimantName: partnerClaimantsTable.claimantName,
        relationship: partnerClaimantsTable.relationship,
      })
      .from(inheritanceClaimantSharesTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(inheritanceClaimantSharesTable.claimantId, partnerClaimantsTable.id),
      )
      .where(eq(inheritanceClaimantSharesTable.claimId, id));

    // Load documents (active only)
    const documents = await db
      .select()
      .from(inheritanceDocumentsTable)
      .where(
        and(
          eq(inheritanceDocumentsTable.claimId, id),
          eq(inheritanceDocumentsTable.isActive, true),
        ),
      )
      .orderBy(inheritanceDocumentsTable.createdAt);

    // Compute share totals
    const totalProposed = shares
      .filter((s) => s.share.status !== "disputed")
      .reduce((sum, s) => sum + parseFloat(s.share.proposedSharePct ?? "0"), 0);
    const totalApproved = shares
      .filter((s) => s.share.status === "approved")
      .reduce((sum, s) => sum + parseFloat(s.share.proposedSharePct ?? "0"), 0);

    res.json({
      claim: { ...formatClaim(row.claim), partnerName: row.partnerName, projectName: row.projectName },
      claimants: claimants.map((c) => ({
        id: c.id,
        claimantName: c.claimantName,
        relationship: c.relationship,
        phone: c.phone,
        address: c.address,
        status: c.status,
        notes: c.notes,
      })),
      shares: shares.map((s) => ({
        ...formatShare(s.share),
        claimantName: s.claimantName,
        relationship: s.relationship,
      })),
      documents: documents.map(formatDoc),
      summary: {
        claimantCount: claimants.length,
        shareCount: shares.length,
        totalProposedPct: totalProposed,
        totalApprovedPct: totalApproved,
        documentCount: documents.length,
        verifiedDocumentCount: documents.filter((d) => d.verificationStatus === "verified").length,
        pendingDocumentCount: documents.filter((d) => d.verificationStatus === "pending").length,
        allSharesApproved: shares.length > 0 && shares.every((s) => s.share.status === "approved"),
        allDocumentsVerified: documents.length > 0 && documents.every((d) => d.verificationStatus === "verified"),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get inheritance claim");
    res.status(500).json({ error: "Failed to get inheritance claim" });
  }
});

// ── PATCH /inheritance-claims/:id ─────────────────────────────────────────

router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const { description, reviewNotes, settlementNotes } = req.body as {
      description?: string;
      reviewNotes?: string;
      settlementNotes?: string;
    };

    const updates: Record<string, unknown> = {};
    if (description !== undefined) updates.description = description?.trim() || null;
    if (reviewNotes !== undefined) updates.reviewNotes = reviewNotes?.trim() || null;
    if (settlementNotes !== undefined) updates.settlementNotes = settlementNotes?.trim() || null;

    const [updated] = await db
      .update(inheritanceClaimsTable)
      .set(updates)
      .where(eq(inheritanceClaimsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Claim not found." }); return; }
    res.json({ claim: formatClaim(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update inheritance claim");
    res.status(500).json({ error: "Failed to update inheritance claim" });
  }
});

// ── PATCH /inheritance-claims/:id/status ─────────────────────────────────

router.patch("/:id/status", requireRole("admin", "developer"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const { toStatus, reason, notes } = req.body as {
      toStatus: string;
      reason?: string;
      notes?: string;
    };

    const [claim] = await db
      .select()
      .from(inheritanceClaimsTable)
      .where(eq(inheritanceClaimsTable.id, id))
      .limit(1);
    if (!claim) { res.status(404).json({ error: "Claim not found." }); return; }

    const allowed = VALID_TRANSITIONS[claim.status] ?? [];
    if (!allowed.includes(toStatus)) {
      res.status(400).json({
        error: `Cannot transition from "${claim.status}" to "${toStatus}".`,
        allowedTransitions: allowed,
      });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { status: toStatus };

    if (toStatus === "developer_approved") {
      updates.developerApprovedBy = actor?.id ?? null;
      updates.developerApprovedByName = actor?.displayName ?? null;
      updates.developerApprovedAt = now;
    } else if (toStatus === "approved") {
      updates.approvedBy = actor?.id ?? null;
      updates.approvedByName = actor?.displayName ?? null;
      updates.approvedAt = now;
    } else if (toStatus === "rejected") {
      updates.rejectedBy = actor?.id ?? null;
      updates.rejectedByName = actor?.displayName ?? null;
      updates.rejectedAt = now;
      updates.rejectionReason = reason?.trim() || null;
    } else if (toStatus === "settled") {
      updates.settlementNotes = notes?.trim() || claim.settlementNotes;
    }

    if (notes && toStatus !== "settled") updates.reviewNotes = notes.trim();

    const [updated] = await db
      .update(inheritanceClaimsTable)
      .set(updates)
      .where(eq(inheritanceClaimsTable.id, id))
      .returning();

    res.json({ claim: formatClaim(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to transition inheritance claim status");
    res.status(500).json({ error: "Failed to transition claim status" });
  }
});

// ── DELETE /inheritance-claims/:id ───────────────────────────────────────

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const [updated] = await db
      .update(inheritanceClaimsTable)
      .set({ isActive: false })
      .where(eq(inheritanceClaimsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Claim not found." }); return; }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete inheritance claim");
    res.status(500).json({ error: "Failed to delete inheritance claim" });
  }
});

// ── Share Routes ──────────────────────────────────────────────────────────

// GET /:id/shares
router.get("/:id/shares", async (req, res) => {
  try {
    const claimId = req.params.id as string;
    const shares = await db
      .select({
        share: inheritanceClaimantSharesTable,
        claimantName: partnerClaimantsTable.claimantName,
        relationship: partnerClaimantsTable.relationship,
        claimantStatus: partnerClaimantsTable.status,
      })
      .from(inheritanceClaimantSharesTable)
      .leftJoin(
        partnerClaimantsTable,
        eq(inheritanceClaimantSharesTable.claimantId, partnerClaimantsTable.id),
      )
      .where(eq(inheritanceClaimantSharesTable.claimId, claimId))
      .orderBy(inheritanceClaimantSharesTable.createdAt);

    const totalProposed = shares
      .filter((s) => s.share.status !== "disputed")
      .reduce((sum, s) => sum + parseFloat(s.share.proposedSharePct ?? "0"), 0);
    const totalApproved = shares
      .filter((s) => s.share.status === "approved")
      .reduce((sum, s) => sum + parseFloat(s.share.proposedSharePct ?? "0"), 0);

    res.json({
      shares: shares.map((s) => ({
        ...formatShare(s.share),
        claimantName: s.claimantName,
        relationship: s.relationship,
        claimantStatus: s.claimantStatus,
      })),
      totalProposedPct: totalProposed,
      totalApprovedPct: totalApproved,
      total: shares.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list shares");
    res.status(500).json({ error: "Failed to list shares" });
  }
});

// POST /:id/shares
router.post("/:id/shares", requireRole("admin", "developer"), async (req, res) => {
  try {
    const claimId = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const { claimantId, proposedSharePct, shareNotes } = req.body as {
      claimantId: string;
      proposedSharePct: number;
      shareNotes?: string;
    };

    if (!claimantId || proposedSharePct == null) {
      res.status(400).json({ error: "claimantId and proposedSharePct are required." });
    }
    if (proposedSharePct <= 0 || proposedSharePct > 100) {
      res.status(400).json({ error: "proposedSharePct must be between 0.0001 and 100." });
    }

    // Guard: total proposed shares (excluding disputed) must not exceed 100%
    const existing = await db
      .select({ pct: inheritanceClaimantSharesTable.proposedSharePct })
      .from(inheritanceClaimantSharesTable)
      .where(
        and(
          eq(inheritanceClaimantSharesTable.claimId, claimId),
          eq(inheritanceClaimantSharesTable.status, "proposed"),
        ),
      );
    const currentTotal = existing.reduce((s, r) => s + parseFloat(r.pct ?? "0"), 0);
    const approvedTotal = await db
      .select({ pct: inheritanceClaimantSharesTable.proposedSharePct })
      .from(inheritanceClaimantSharesTable)
      .where(
        and(
          eq(inheritanceClaimantSharesTable.claimId, claimId),
          eq(inheritanceClaimantSharesTable.status, "approved"),
        ),
      );
    const approvedSum = approvedTotal.reduce((s, r) => s + parseFloat(r.pct ?? "0"), 0);
    if (currentTotal + approvedSum + proposedSharePct > 100) {
      res.status(400).json({
        error: `Adding this share would exceed 100%. Current total: ${(currentTotal + approvedSum).toFixed(4)}%.`,
      });
    }

    const [share] = await db
      .insert(inheritanceClaimantSharesTable)
      .values({
        claimId,
        claimantId,
        proposedSharePct: String(proposedSharePct),
        shareNotes: shareNotes?.trim() || null,
        proposedBy: actor?.id ?? null,
        proposedByName: actor?.displayName ?? null,
      })
      .returning();

    res.status(201).json({ share: formatShare(share) });
  } catch (err: any) {
    if (err?.constraint === "uniq_claim_claimant") {
      res.status(409).json({ error: "This claimant already has a share proposal for this claim." });
    }
    req.log.error({ err }, "Failed to create share proposal");
    res.status(500).json({ error: "Failed to create share proposal" });
  }
});

// PATCH /:id/shares/:shareId
router.patch("/:id/shares/:shareId", requireRole("admin", "developer"), async (req, res) => {
  try {
    const shareId = req.params.shareId as string;
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const { proposedSharePct, shareNotes, status, disputeNotes } = req.body as {
      proposedSharePct?: number;
      shareNotes?: string;
      status?: string;
      disputeNotes?: string;
    };

    const updates: Record<string, unknown> = {};
    if (proposedSharePct !== undefined) updates.proposedSharePct = String(proposedSharePct);
    if (shareNotes !== undefined) updates.shareNotes = shareNotes?.trim() || null;
    if (disputeNotes !== undefined) updates.disputeNotes = disputeNotes?.trim() || null;

    if (status) {
      updates.status = status;
      if (status === "approved") {
        updates.approvedBy = actor?.id ?? null;
        updates.approvedByName = actor?.displayName ?? null;
        updates.approvedAt = new Date();
      }
    }

    const [updated] = await db
      .update(inheritanceClaimantSharesTable)
      .set(updates)
      .where(eq(inheritanceClaimantSharesTable.id, shareId))
      .returning();

    if (!updated) { res.status(404).json({ error: "Share not found." }); return; }
    res.json({ share: formatShare(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update share");
    res.status(500).json({ error: "Failed to update share" });
  }
});

// DELETE /:id/shares/:shareId
router.delete("/:id/shares/:shareId", requireRole("admin"), async (req, res) => {
  try {
    const shareId = req.params.shareId as string;
    const [deleted] = await db
      .delete(inheritanceClaimantSharesTable)
      .where(eq(inheritanceClaimantSharesTable.id, shareId))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Share not found." }); return; }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete share");
    res.status(500).json({ error: "Failed to delete share" });
  }
});

// ── Document Routes ───────────────────────────────────────────────────────

// GET /:id/documents
router.get("/:id/documents", async (req, res) => {
  try {
    const claimId = req.params.id as string;
    const docs = await db
      .select()
      .from(inheritanceDocumentsTable)
      .where(
        and(
          eq(inheritanceDocumentsTable.claimId, claimId),
          eq(inheritanceDocumentsTable.isActive, true),
        ),
      )
      .orderBy(inheritanceDocumentsTable.createdAt);
    res.json({ documents: docs.map(formatDoc), total: docs.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list documents");
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// POST /:id/documents
router.post("/:id/documents", requireRole("admin", "developer"), async (req, res) => {
  try {
    const claimId = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const { claimantId, documentType, documentTitle, description, fileObjectPath, mimeType } =
      req.body as {
        claimantId?: string;
        documentType: string;
        documentTitle: string;
        description?: string;
        fileObjectPath?: string;
        mimeType?: string;
      };

    if (!documentType || !documentTitle) {
      res.status(400).json({ error: "documentType and documentTitle are required." });
    }

    const [doc] = await db
      .insert(inheritanceDocumentsTable)
      .values({
        claimId,
        claimantId: claimantId || null,
        documentType: documentType as any,
        documentTitle: documentTitle.trim(),
        description: description?.trim() || null,
        fileObjectPath: fileObjectPath?.trim() || null,
        mimeType: mimeType?.trim() || null,
        uploadedBy: actor?.id ?? null,
        uploadedByName: actor?.displayName ?? null,
      })
      .returning();

    res.status(201).json({ document: formatDoc(doc) });
  } catch (err) {
    req.log.error({ err }, "Failed to register document");
    res.status(500).json({ error: "Failed to register document" });
  }
});

// PATCH /:id/documents/:docId
router.patch("/:id/documents/:docId", requireRole("admin", "developer"), async (req, res) => {
  try {
    const docId = req.params.docId as string;
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const { documentTitle, description, fileObjectPath, mimeType, verificationStatus, verificationNotes } =
      req.body as {
        documentTitle?: string;
        description?: string;
        fileObjectPath?: string;
        mimeType?: string;
        verificationStatus?: string;
        verificationNotes?: string;
      };

    const updates: Record<string, unknown> = {};
    if (documentTitle !== undefined) updates.documentTitle = documentTitle.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (fileObjectPath !== undefined) updates.fileObjectPath = fileObjectPath?.trim() || null;
    if (mimeType !== undefined) updates.mimeType = mimeType?.trim() || null;
    if (verificationNotes !== undefined) updates.verificationNotes = verificationNotes?.trim() || null;

    if (verificationStatus) {
      updates.verificationStatus = verificationStatus;
      if (verificationStatus === "verified") {
        updates.verifiedBy = actor?.id ?? null;
        updates.verifiedByName = actor?.displayName ?? null;
        updates.verifiedAt = new Date();
      }
    }

    const [updated] = await db
      .update(inheritanceDocumentsTable)
      .set(updates)
      .where(eq(inheritanceDocumentsTable.id, docId))
      .returning();

    if (!updated) { res.status(404).json({ error: "Document not found." }); return; }
    res.json({ document: formatDoc(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update document");
    res.status(500).json({ error: "Failed to update document" });
  }
});

// DELETE /:id/documents/:docId
router.delete("/:id/documents/:docId", requireRole("admin"), async (req, res) => {
  try {
    const docId = req.params.docId as string;
    const [updated] = await db
      .update(inheritanceDocumentsTable)
      .set({ isActive: false })
      .where(eq(inheritanceDocumentsTable.id, docId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Document not found." }); return; }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ── GET /dashboard ────────────────────────────────────────────────────────
// Must be before /:id routes
router.get("/dashboard", requireRole("admin", "developer"), async (req, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    const whereProject = projectId
      ? eq(inheritanceClaimsTable.projectId, projectId)
      : undefined;

    const allClaims = await db
      .select({
        id: inheritanceClaimsTable.id,
        status: inheritanceClaimsTable.status,
        claimType: inheritanceClaimsTable.claimType,
        projectId: inheritanceClaimsTable.projectId,
        partnerId: inheritanceClaimsTable.partnerId,
        createdAt: inheritanceClaimsTable.createdAt,
        approvedAt: inheritanceClaimsTable.approvedAt,
        developerApprovedAt: inheritanceClaimsTable.developerApprovedAt,
        initiatedByName: inheritanceClaimsTable.initiatedByName,
        description: inheritanceClaimsTable.description,
      })
      .from(inheritanceClaimsTable)
      .where(
        and(
          eq(inheritanceClaimsTable.isActive, true),
          whereProject,
        ),
      )
      .orderBy(desc(inheritanceClaimsTable.createdAt));

    const total = allClaims.length;
    const open = allClaims.filter((c) => c.status === "open").length;
    const underReview = allClaims.filter((c) => c.status === "under_review").length;
    const developerApproved = allClaims.filter((c) => c.status === "developer_approved").length;
    const documentsVerified = allClaims.filter((c) => c.status === "documents_verified").length;
    const approved = allClaims.filter((c) => c.status === "approved").length;
    const settled = allClaims.filter((c) => c.status === "settled").length;
    const rejected = allClaims.filter((c) => c.status === "rejected").length;
    const pendingGovernance = open + underReview + developerApproved + documentsVerified + approved;

    // Claims by type
    const byType = {
      death: allClaims.filter((c) => c.claimType === "death").length,
      incapacity: allClaims.filter((c) => c.claimType === "incapacity").length,
      voluntary_transfer: allClaims.filter((c) => c.claimType === "voluntary_transfer").length,
    };

    // Projects with active inheritance cases
    const projectsWithActiveClaims = new Set(
      allClaims.filter((c) => !["settled", "rejected"].includes(c.status)).map((c) => c.projectId),
    ).size;

    // Recent activity (last 10 active claims)
    const recentClaims = allClaims.slice(0, 10).map((c) => ({
      id: c.id,
      status: c.status,
      claimType: c.claimType,
      projectId: c.projectId,
      partnerId: c.partnerId,
      createdAt: c.createdAt,
      description: c.description,
      initiatedByName: c.initiatedByName,
    }));

    // Pending share approvals across all claims
    const pendingShares = await db
      .select({ claimId: inheritanceClaimantSharesTable.claimId })
      .from(inheritanceClaimantSharesTable)
      .where(eq(inheritanceClaimantSharesTable.status, "proposed"));
    const pendingShareCount = pendingShares.length;

    // Pending document verifications across all claims
    const pendingDocs = await db
      .select({ claimId: inheritanceDocumentsTable.claimId })
      .from(inheritanceDocumentsTable)
      .where(
        and(
          eq(inheritanceDocumentsTable.verificationStatus, "pending"),
          eq(inheritanceDocumentsTable.isActive, true),
        ),
      );
    const pendingDocCount = pendingDocs.length;

    res.json({
      dashboard: {
        total,
        open,
        underReview,
        developerApproved,
        documentsVerified,
        approved,
        settled,
        rejected,
        pendingGovernance,
        projectsWithActiveClaims,
        pendingShareCount,
        pendingDocCount,
        byType,
        recentClaims,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch inheritance dashboard");
    res.status(500).json({ error: "Failed to fetch dashboard" });
  }
});

// ── GET /analytics ────────────────────────────────────────────────────────
router.get("/analytics", requireRole("admin", "developer"), async (req, res) => {
  try {
    const { projectId } = req.query as { projectId?: string };

    const whereBase = and(
      eq(inheritanceClaimsTable.isActive, true),
      projectId ? eq(inheritanceClaimsTable.projectId, projectId) : undefined,
    );

    const allClaims = await db
      .select()
      .from(inheritanceClaimsTable)
      .where(whereBase)
      .orderBy(inheritanceClaimsTable.createdAt);

    // Workflow funnel: how many reached each stage
    const stages = [
      "open",
      "under_review",
      "developer_approved",
      "documents_verified",
      "approved",
      "settled",
    ] as const;

    const funnelCounts = stages.map((stage) => ({
      stage,
      count: allClaims.filter((c) => c.status === stage || /* reached or passed */ [
        "under_review", "developer_approved", "documents_verified", "approved", "settled",
      ].includes(c.status) && stages.indexOf(c.status as typeof stages[number]) >= stages.indexOf(stage)).length,
    }));

    // Average days to settlement (for settled claims)
    const settledClaims = allClaims.filter((c) => c.status === "settled" && c.approvedAt);
    const avgDaysToSettlement = settledClaims.length > 0
      ? Math.round(
          settledClaims.reduce((sum, c) => {
            const days = (new Date(c.approvedAt!).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / settledClaims.length,
        )
      : null;

    // Claims opened by month (last 12 months)
    const now = new Date();
    const monthlyOpened = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const label = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      const count = allClaims.filter((c) => {
        const cd = new Date(c.createdAt);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      }).length;
      return { month: label, count };
    });

    // Ownership history entries
    const historyRows = await db
      .select()
      .from(inheritanceOwnershipHistoryTable)
      .where(
        projectId ? eq(inheritanceOwnershipHistoryTable.projectId, projectId) : undefined,
      )
      .orderBy(desc(inheritanceOwnershipHistoryTable.effectiveDate));

    // Share allocation summary (approved allocations)
    const approvedShares = await db
      .select({
        claimId: inheritanceClaimantSharesTable.claimId,
        proposedSharePct: inheritanceClaimantSharesTable.proposedSharePct,
        claimantId: inheritanceClaimantSharesTable.claimantId,
        status: inheritanceClaimantSharesTable.status,
      })
      .from(inheritanceClaimantSharesTable)
      .where(eq(inheritanceClaimantSharesTable.status, "approved"));

    // Continuity coverage: projects that had claims and now have settled them
    const settledProjects = new Set(allClaims.filter((c) => c.status === "settled").map((c) => c.projectId));
    const activeProjects = new Set(allClaims.filter((c) => !["settled", "rejected"].includes(c.status)).map((c) => c.projectId));

    res.json({
      analytics: {
        funnelCounts,
        avgDaysToSettlement,
        monthlyOpened,
        ownershipHistoryCount: historyRows.length,
        ownershipHistoryRecent: historyRows.slice(0, 5).map((h) => ({
          id: h.id,
          claimId: h.claimId,
          projectId: h.projectId,
          fromPartnerName: h.fromPartnerName,
          claimantName: h.claimantName,
          relationship: h.relationship,
          sharePercentage: h.sharePercentage,
          effectiveDate: h.effectiveDate,
          recordedByName: h.recordedByName,
          notes: h.notes,
        })),
        approvedAllocationsCount: approvedShares.length,
        settledProjectsCount: settledProjects.size,
        activeProjectsCount: activeProjects.size,
        claimsByType: {
          death: allClaims.filter((c) => c.claimType === "death").length,
          incapacity: allClaims.filter((c) => c.claimType === "incapacity").length,
          voluntary_transfer: allClaims.filter((c) => c.claimType === "voluntary_transfer").length,
        },
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch inheritance analytics");
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ── GET /:id/history ──────────────────────────────────────────────────────
router.get("/:id/history", requireRole("admin", "developer"), async (req, res) => {
  try {
    const claimId = req.params.id as string;
    const [claim] = await db
      .select({ id: inheritanceClaimsTable.id })
      .from(inheritanceClaimsTable)
      .where(eq(inheritanceClaimsTable.id, claimId))
      .limit(1);
    if (!claim) { res.status(404).json({ error: "Claim not found." }); return; }

    const rows = await db
      .select()
      .from(inheritanceOwnershipHistoryTable)
      .where(eq(inheritanceOwnershipHistoryTable.claimId, claimId))
      .orderBy(desc(inheritanceOwnershipHistoryTable.effectiveDate));

    res.json({
      history: rows.map((h) => ({
        id: h.id,
        claimId: h.claimId,
        projectId: h.projectId,
        fromPartnerId: h.fromPartnerId,
        fromPartnerName: h.fromPartnerName,
        claimantId: h.claimantId,
        claimantName: h.claimantName,
        relationship: h.relationship,
        sharePercentage: h.sharePercentage,
        effectiveDate: h.effectiveDate,
        notes: h.notes,
        recordedBy: h.recordedBy,
        recordedByName: h.recordedByName,
        createdAt: h.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch ownership history");
    res.status(500).json({ error: "Failed to fetch ownership history" });
  }
});

// ── POST /:id/history ─────────────────────────────────────────────────────
router.post("/:id/history", requireRole("admin"), async (req, res) => {
  try {
    const claimId = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveUser(clerkUserId) : null;

    const [claim] = await db
      .select({
        id: inheritanceClaimsTable.id,
        status: inheritanceClaimsTable.status,
        projectId: inheritanceClaimsTable.projectId,
        partnerId: inheritanceClaimsTable.partnerId,
      })
      .from(inheritanceClaimsTable)
      .where(eq(inheritanceClaimsTable.id, claimId))
      .limit(1);

    if (!claim) { res.status(404).json({ error: "Claim not found." }); return; }
    if (!["approved", "settled"].includes(claim.status)) {
      res.status(409).json({ error: "Ownership history can only be recorded for approved or settled claims." });
      return;
    }

    const { claimantId, claimantName, relationship, sharePercentage, effectiveDate, notes, fromPartnerName } =
      req.body as {
        claimantId?: string;
        claimantName: string;
        relationship?: string;
        sharePercentage: string;
        effectiveDate: string;
        notes?: string;
        fromPartnerName?: string;
      };

    if (!claimantName?.trim()) { res.status(400).json({ error: "claimantName is required." }); return; }
    if (!sharePercentage || isNaN(parseFloat(sharePercentage))) { res.status(400).json({ error: "sharePercentage is required and must be a number." }); return; }
    if (!effectiveDate) { res.status(400).json({ error: "effectiveDate is required." }); return; }

    const pct = parseFloat(sharePercentage);
    if (pct <= 0 || pct > 100) { res.status(400).json({ error: "sharePercentage must be between 0.0001 and 100." }); return; }

    // Look up the partner name if not provided
    let resolvedFromPartnerName = fromPartnerName?.trim() || "";
    if (!resolvedFromPartnerName) {
      const [partner] = await db
        .select({ name: partnersTable.name })
        .from(partnersTable)
        .where(eq(partnersTable.id, claim.partnerId))
        .limit(1);
      resolvedFromPartnerName = partner?.name ?? "Unknown Partner";
    }

    const [row] = await db
      .insert(inheritanceOwnershipHistoryTable)
      .values({
        claimId,
        projectId: claim.projectId,
        fromPartnerId: claim.partnerId,
        fromPartnerName: resolvedFromPartnerName,
        claimantId: claimantId || null,
        claimantName: claimantName.trim(),
        relationship: relationship?.trim() || null,
        sharePercentage: pct.toFixed(4),
        effectiveDate: new Date(effectiveDate),
        notes: notes?.trim() || null,
        recordedBy: actor?.id ?? null,
        recordedByName: actor?.displayName ?? null,
      })
      .returning();

    res.status(201).json({ history: row });
  } catch (err) {
    req.log.error({ err }, "Failed to record ownership history");
    res.status(500).json({ error: "Failed to record ownership history" });
  }
});

export default router;
