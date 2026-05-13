import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, ilike, desc, or } from "drizzle-orm";
import { db, buyersTable, usersTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function formatBuyer(row: typeof buyersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    buyerType: row.buyerType,
    contactPerson: row.contactPerson ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    gstin: row.gstin ?? undefined,
    notes: row.notes ?? undefined,
    isActive: row.isActive,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /buyers ────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const { search, includeInactive } = req.query as Record<string, string>;

  const rows = await db
    .select()
    .from(buyersTable)
    .where(
      and(
        includeInactive !== "true" ? eq(buyersTable.isActive, true) : undefined,
        search
          ? or(
              ilike(buyersTable.name, `%${search}%`),
              ilike(buyersTable.contactPerson, `%${search}%`),
              ilike(buyersTable.phone, `%${search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(buyersTable.createdAt));

  return res.json(rows.map(formatBuyer));
});

// ── POST /buyers ───────────────────────────────────────────────────────────────

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  type Body = {
    name: string;
    buyerType?: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    gstin?: string;
    notes?: string;
  };
  const { name, buyerType, contactPerson, phone, email, address, gstin, notes } = req.body as Body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

  const [created] = await db
    .insert(buyersTable)
    .values({
      name: name.trim(),
      buyerType: buyerType ?? "trader",
      contactPerson: contactPerson ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      gstin: gstin ?? null,
      notes: notes ?? null,
      createdById: actor.id,
      createdByName: actor.displayName ?? actor.email ?? "Unknown",
    })
    .returning();

  return res.status(201).json(formatBuyer(created));
});

// ── GET /buyers/:id ────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const [buyer] = await db
    .select()
    .from(buyersTable)
    .where(eq(buyersTable.id, req.params.id as string))
    .limit(1);

  if (!buyer) return res.status(404).json({ error: "Buyer not found" });
  return res.json(formatBuyer(buyer));
});

// ── PATCH /buyers/:id ──────────────────────────────────────────────────────────

router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const buyerId = req.params.id as string;
  const [existing] = await db.select().from(buyersTable).where(eq(buyersTable.id, buyerId)).limit(1);
  if (!existing) return res.status(404).json({ error: "Buyer not found" });

  type Body = {
    name?: string;
    buyerType?: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    gstin?: string;
    notes?: string;
  };
  const { name, buyerType, contactPerson, phone, email, address, gstin, notes } = req.body as Body;

  const [updated] = await db
    .update(buyersTable)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(buyerType !== undefined && { buyerType }),
      ...(contactPerson !== undefined && { contactPerson: contactPerson || null }),
      ...(phone !== undefined && { phone: phone || null }),
      ...(email !== undefined && { email: email || null }),
      ...(address !== undefined && { address: address || null }),
      ...(gstin !== undefined && { gstin: gstin || null }),
      ...(notes !== undefined && { notes: notes || null }),
      updatedAt: new Date(),
    })
    .where(eq(buyersTable.id, buyerId))
    .returning();

  return res.json(formatBuyer(updated));
});

// ── DELETE /buyers/:id ─────────────────────────────────────────────────────────

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const buyerId = req.params.id as string;
  const [existing] = await db.select().from(buyersTable).where(eq(buyersTable.id, buyerId)).limit(1);
  if (!existing) return res.status(404).json({ error: "Buyer not found" });

  await db.update(buyersTable).set({ isActive: false, updatedAt: new Date() }).where(eq(buyersTable.id, buyerId));
  return res.json({ success: true });
});

export default router;
