import { Router } from "express";
import { db, partnersTable, activityTable, partnerClaimantsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreatePartnerBody,
  UpdatePartnerBody,
  GetPartnerParams,
  UpdatePartnerParams,
  ListPartnerClaimantsParams,
  ListPartnerClaimantsQueryParams,
  AddPartnerClaimantBody,
  UpdatePartnerClaimantParams,
  UpdatePartnerClaimantBody,
  RemovePartnerClaimantParams,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

function formatPartner(p: typeof partnersTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt?.toISOString() ?? null,
  };
}

// GET /partners — all authenticated users can see partners
router.get("/", async (req, res) => {
  try {
    const partners = await db.select().from(partnersTable).orderBy(partnersTable.createdAt);
    res.json(partners.map(formatPartner));
  } catch (err) {
    req.log.error({ err }, "Failed to list partners");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /partners — admin or developer only
router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = CreatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [partner] = await db.insert(partnersTable).values(parsed.data).returning();
    await db.insert(activityTable).values({
      type: "partner_registered",
      description: `Partner "${partner.name}" (${partner.role}) registered`,
      entityId: partner.id,
      entityType: "partner",
    });
    res.status(201).json(formatPartner(partner));
  } catch (err) {
    req.log.error({ err }, "Failed to create partner");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /partners/:id — all authenticated users
router.get("/:id", async (req, res) => {
  const parsed = GetPartnerParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.id, parsed.data.id));
    if (!partner) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatPartner(partner));
  } catch (err) {
    req.log.error({ err }, "Failed to get partner");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /partners/:id — admin or developer only
router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = UpdatePartnerParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const bodyParsed = UpdatePartnerBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  try {
    const [partner] = await db
      .update(partnersTable)
      .set(bodyParsed.data)
      .where(eq(partnersTable.id, paramsParsed.data.id))
      .returning();
    if (!partner) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatPartner(partner));
  } catch (err) {
    req.log.error({ err }, "Failed to update partner");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────
//  Claimant Sub-Routes  (/partners/:id/claimants)
//  Foundation data only — no settlement logic.
// ─────────────────────────────────────────────

type ClaimantRow = typeof partnerClaimantsTable.$inferSelect;

function formatClaimant(c: ClaimantRow) {
  return {
    id: c.id,
    partnerId: c.partnerId,
    projectId: c.projectId,
    claimantName: c.claimantName,
    relationship: c.relationship,
    phone: c.phone,
    address: c.address,
    claimDocumentsUrl: c.claimDocumentsUrl ?? null,
    status: c.status,
    notes: c.notes ?? null,
    isActive: c.isActive,
    createdBy: c.createdBy ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt?.toISOString() ?? null,
  };
}

// GET /partners/:id/claimants?projectId=
router.get("/:id/claimants", async (req, res) => {
  const paramsParsed = ListPartnerClaimantsParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid partner id" });
    return;
  }
  const queryParsed = ListPartnerClaimantsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  try {
    const conditions = [
      eq(partnerClaimantsTable.partnerId, paramsParsed.data.id),
      eq(partnerClaimantsTable.isActive, true),
    ];
    if (queryParsed.data.projectId) {
      conditions.push(eq(partnerClaimantsTable.projectId, queryParsed.data.projectId));
    }
    const claimants = await db
      .select()
      .from(partnerClaimantsTable)
      .where(and(...conditions))
      .orderBy(partnerClaimantsTable.createdAt);
    res.json(claimants.map(formatClaimant));
  } catch (err) {
    req.log.error({ err }, "Failed to list claimants");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /partners/:id/claimants — admin or developer only
router.post("/:id/claimants", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = ListPartnerClaimantsParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid partner id" });
    return;
  }
  const bodyParsed = AddPartnerClaimantBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  try {
    let createdById: string | undefined;
    if (req.userId) {
      const [row] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, req.userId))
        .limit(1);
      createdById = row?.id;
    }

    const [claimant] = await db
      .insert(partnerClaimantsTable)
      .values({
        partnerId: paramsParsed.data.id,
        projectId: bodyParsed.data.projectId,
        claimantName: bodyParsed.data.claimantName,
        relationship: bodyParsed.data.relationship,
        phone: bodyParsed.data.phone,
        address: bodyParsed.data.address,
        claimDocumentsUrl: bodyParsed.data.claimDocumentsUrl ?? null,
        status: bodyParsed.data.status ?? "registered",
        notes: bodyParsed.data.notes ?? null,
        createdBy: createdById ?? null,
      })
      .returning();

    res.status(201).json(formatClaimant(claimant));
  } catch (err) {
    req.log.error({ err }, "Failed to add claimant");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /partners/:id/claimants/:claimantId — admin or developer only
router.patch("/:id/claimants/:claimantId", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = UpdatePartnerClaimantParams.safeParse({
    id: req.params.id,
    claimantId: req.params.claimantId,
  });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const bodyParsed = UpdatePartnerClaimantBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  try {
    const updates = Object.fromEntries(
      Object.entries(bodyParsed.data).filter(([, v]) => v !== undefined),
    );
    const [claimant] = await db
      .update(partnerClaimantsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(partnerClaimantsTable.id, paramsParsed.data.claimantId),
          eq(partnerClaimantsTable.partnerId, paramsParsed.data.id),
        ),
      )
      .returning();
    if (!claimant) {
      res.status(404).json({ error: "Claimant not found" });
      return;
    }
    res.json(formatClaimant(claimant));
  } catch (err) {
    req.log.error({ err }, "Failed to update claimant");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /partners/:id/claimants/:claimantId — admin only (soft-archive)
router.delete("/:id/claimants/:claimantId", requireRole("admin"), async (req, res) => {
  const paramsParsed = RemovePartnerClaimantParams.safeParse({
    id: req.params.id,
    claimantId: req.params.claimantId,
  });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  try {
    await db
      .update(partnerClaimantsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(partnerClaimantsTable.id, paramsParsed.data.claimantId),
          eq(partnerClaimantsTable.partnerId, paramsParsed.data.id),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove claimant");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
