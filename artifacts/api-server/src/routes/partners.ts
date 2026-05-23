import { Router } from "express";
import {
  db,
  partnersTable,
  activityTable,
  partnerClaimantsTable,
  usersTable,
  landownerLedgerTable,
  projectParticipantsTable,
} from "@workspace/db";
import { eq, and, or, inArray, isNull, isNotNull } from "drizzle-orm";
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
import { assertPersonMasterActive } from "../lib/partnerIdentityGuard";
import { getAuth } from "@clerk/express";

const router = Router();

async function resolveActorForPartners(req: Parameters<Parameters<typeof router.post>[1]>[0]) {
  try {
    const { userId: clerkUserId } = getAuth(req as any);
    if (!clerkUserId) return { id: null, name: null, role: null };
    const [u] = await db
      .select({ id: usersTable.id, name: usersTable.displayName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    return u ? { id: u.id, name: u.name, role: u.role } : { id: null, name: null, role: null };
  } catch {
    return { id: null, name: null, role: null };
  }
}

function formatPartner(p: typeof partnersTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt?.toISOString() ?? null,
  };
}

// GET /partners
// ?projectId=<uuid>  — restricts to partners linked to this project only.
//                      Prevents governance data leakage across projects.
//                      Scoping sources: landowner ledger entries for the project
//                      OR project_participants.person_master_id → partners.person_master_id
// ?role=<string>     — further filter by partner role (landowner | developer | investor)
router.get("/", async (req, res) => {
  try {
    const { projectId, role } = req.query as Record<string, string | undefined>;

    if (projectId) {
      // ── Project-scoped fetch ───────────────────────────────────────────────
      // Two linking mechanisms (OR):
      //   (a) partner appears in landowner_ledger_entries for this project
      //   (b) partner.person_master_id matches a project_participant for this project
      const [ledgerRows, participantRows] = await Promise.all([
        db
          .selectDistinct({ id: landownerLedgerTable.partnerId })
          .from(landownerLedgerTable)
          .where(eq(landownerLedgerTable.projectId, projectId)),

        db
          .selectDistinct({ personMasterId: projectParticipantsTable.personMasterId })
          .from(projectParticipantsTable)
          .where(
            and(
              eq(projectParticipantsTable.projectId, projectId),
              isNotNull(projectParticipantsTable.personMasterId),
            ),
          ),
      ]);

      const ledgerIds = ledgerRows.map((r) => r.id).filter(Boolean) as string[];
      const personIds = participantRows.map((r) => r.personMasterId).filter(Boolean) as string[];

      if (ledgerIds.length === 0 && personIds.length === 0) {
        // No links at all for this project — return empty (correct governance behavior)
        return void res.json([]);
      }

      const scopeConditions = [];
      if (ledgerIds.length > 0) scopeConditions.push(inArray(partnersTable.id, ledgerIds));
      if (personIds.length > 0) scopeConditions.push(inArray(partnersTable.personMasterId, personIds));

      const baseConditions = [isNull(partnersTable.deletedAt)];
      if (role) baseConditions.push(eq(partnersTable.role, role));

      const partners = await db
        .select()
        .from(partnersTable)
        .where(and(...baseConditions, or(...scopeConditions)))
        .orderBy(partnersTable.name);

      return void res.json(partners.map(formatPartner));
    }

    // ── Global fetch (no project filter) ──────────────────────────────────
    const conditions = [isNull(partnersTable.deletedAt)];
    if (role) conditions.push(eq(partnersTable.role, role));

    const partners = await db
      .select()
      .from(partnersTable)
      .where(and(...conditions))
      .orderBy(partnersTable.name);

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
    // ── Partner identity foundation ────────────────────────────────────────
    // Every new partner MUST be linked to an active person_master row. The
    // generated Zod schema does not (yet) include personMasterId, so we read
    // it directly from the raw request body and enforce required-and-active
    // here at the route layer.
    const rawBody = req.body as Record<string, unknown>;
    const personMasterId =
      typeof rawBody.personMasterId === "string" ? rawBody.personMasterId : null;
    if (!personMasterId) {
      res.status(422).json({
        error: "personMasterId is required: every new partner must be linked to a Person Registry entry.",
        code: "IDENTITY_INVALID",
        failureCode: "PERSON_MASTER_ID_MISSING",
      });
      return;
    }
    const actorCtx = await resolveActorForPartners(req);
    const personCheck = await assertPersonMasterActive({
      personMasterId,
      action: "partner.create",
      actor: actorCtx,
      req,
      targetTable: "partners",
      metadata: { role: parsed.data.role, name: parsed.data.name },
    });
    if (!personCheck.ok) {
      res.status(personCheck.status).json(personCheck.body);
      return;
    }
    const [partner] = await db
      .insert(partnersTable)
      .values({ ...parsed.data, personMasterId })
      .returning();
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
    // ── Partner identity foundation ────────────────────────────────────────
    // If the caller is changing the person_master link, validate the new
    // person exists and is active before accepting the patch. personMasterId
    // is not in the generated Zod schema, so we read it from the raw body.
    const rawBody = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = { ...bodyParsed.data };
    if (rawBody.personMasterId !== undefined) {
      const newPersonMasterId =
        typeof rawBody.personMasterId === "string" ? rawBody.personMasterId : null;
      if (!newPersonMasterId) {
        res.status(422).json({
          error: "personMasterId must be a valid Person Registry UUID — clearing it is not allowed.",
          code: "IDENTITY_INVALID",
          failureCode: "PERSON_MASTER_ID_MISSING",
        });
        return;
      }
      const actorCtx = await resolveActorForPartners(req);
      const personCheck = await assertPersonMasterActive({
        personMasterId: newPersonMasterId,
        action: "partner.patch",
        actor: actorCtx,
        req,
        targetTable: "partners",
        targetRecordId: paramsParsed.data.id,
      });
      if (!personCheck.ok) {
        res.status(personCheck.status).json(personCheck.body);
        return;
      }
      updates.personMasterId = newPersonMasterId;
    }
    const [partner] = await db
      .update(partnersTable)
      .set(updates)
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
