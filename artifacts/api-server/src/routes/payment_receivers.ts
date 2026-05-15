import { Router } from "express";
import {
  db,
  paymentReceiverAccountsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { projectId, activeOnly } = req.query as Record<string, string>;
    const conditions = [];
    if (projectId) conditions.push(eq(paymentReceiverAccountsTable.projectId, projectId));
    if (activeOnly !== "false") conditions.push(eq(paymentReceiverAccountsTable.isActive, true));

    const accounts = await db
      .select()
      .from(paymentReceiverAccountsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(paymentReceiverAccountsTable.createdAt));

    res.json(accounts);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch payment receivers" });
  }
});

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const [acc] = await db
      .select()
      .from(paymentReceiverAccountsTable)
      .where(eq(paymentReceiverAccountsTable.id, req.params.id));
    if (!acc) { res.status(404).json({ error: "Account not found" }); return; }
    res.json(acc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch account" });
  }
});

const CreateSchema = z.object({
  projectId: z.string().uuid(),
  ownerUserId: z.string().uuid().optional(),
  ownerName: z.string().min(1),
  ownerRole: z.string().default("developer"),
  accountName: z.string().min(1),
  paymentType: z.enum(["upi", "bank", "cash", "other"]).default("upi"),
  accountIdentifier: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankName: z.string().optional(),
  allowedPaymentModes: z.enum(["online_only", "cash_only", "both"]).default("both"),
  isDefault: z.boolean().default(false),
  notes: z.string().optional(),
});

router.post("/", async (req, res): Promise<void> => {
  const parse = CreateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }
  const data = parse.data;

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, data.projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    // Clear existing default if this will be the new default
    if (data.isDefault) {
      await db
        .update(paymentReceiverAccountsTable)
        .set({ isDefault: false })
        .where(and(
          eq(paymentReceiverAccountsTable.projectId, data.projectId),
          eq(paymentReceiverAccountsTable.isDefault, true),
        ));
    }

    const [acc] = await db
      .insert(paymentReceiverAccountsTable)
      .values({
        projectId: data.projectId,
        projectName: project.name,
        ownerUserId: data.ownerUserId,
        ownerName: data.ownerName,
        ownerRole: data.ownerRole,
        accountName: data.accountName,
        paymentType: data.paymentType,
        accountIdentifier: data.accountIdentifier,
        bankIfsc: data.bankIfsc,
        bankName: data.bankName,
        allowedPaymentModes: data.allowedPaymentModes,
        isDefault: data.isDefault,
        notes: data.notes,
        createdById: req.dbUser?.id,
        createdByName: req.dbUser?.displayName ?? "",
      })
      .returning();

    res.status(201).json(acc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create payment receiver account" });
  }
});

router.patch("/:id", async (req, res): Promise<void> => {
  try {
    const [existing] = await db
      .select()
      .from(paymentReceiverAccountsTable)
      .where(eq(paymentReceiverAccountsTable.id, req.params.id));
    if (!existing) { res.status(404).json({ error: "Account not found" }); return; }

    const allowed = ["accountName", "accountIdentifier", "bankIfsc", "bankName", "isDefault", "isActive", "notes", "allowedPaymentModes"];
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }

    if (req.body.isDefault === true) {
      await db
        .update(paymentReceiverAccountsTable)
        .set({ isDefault: false })
        .where(and(
          eq(paymentReceiverAccountsTable.projectId, existing.projectId),
          eq(paymentReceiverAccountsTable.isDefault, true),
        ));
    }

    const [updated] = await db
      .update(paymentReceiverAccountsTable)
      .set(updates as any)
      .where(eq(paymentReceiverAccountsTable.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update account" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await db
      .update(paymentReceiverAccountsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(paymentReceiverAccountsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to deactivate account" });
  }
});

export default router;
