import { Router } from "express";
import { db, partnersTable, activityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreatePartnerBody,
  UpdatePartnerBody,
  GetPartnerParams,
  UpdatePartnerParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const partners = await db.select().from(partnersTable).orderBy(partnersTable.createdAt);
    res.json(partners.map(p => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list partners");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
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
    res.status(201).json({
      ...partner,
      createdAt: partner.createdAt.toISOString(),
      updatedAt: partner.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create partner");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const parsed = GetPartnerParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, parsed.data.id));
    if (!partner) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...partner,
      createdAt: partner.createdAt.toISOString(),
      updatedAt: partner.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get partner");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const paramsParsed = UpdatePartnerParams.safeParse({ id: Number(req.params.id) });
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
    const [partner] = await db.update(partnersTable)
      .set(bodyParsed.data)
      .where(eq(partnersTable.id, paramsParsed.data.id))
      .returning();
    if (!partner) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...partner,
      createdAt: partner.createdAt.toISOString(),
      updatedAt: partner.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update partner");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
