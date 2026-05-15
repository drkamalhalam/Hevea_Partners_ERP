import { Router } from "express";
import {
  db,
  centralPaymentAccountsTable,
  centralPaymentAccountAuditTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const router = Router();

// ── Encryption helpers (AES-256-GCM) ─────────────────────────────────────────
function getEncryptionKey(): Buffer {
  const secret = process.env["SESSION_SECRET"] ?? "default-dev-key-change-in-prod";
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(stored: string): string | null {
  try {
    const [ivHex, authTagHex, dataHex] = stored.split(":");
    if (!ivHex || !authTagHex || !dataHex) return null;
    const key = getEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

// Mask a value for audit log (show first 4 and last 2 chars)
function maskValue(v: string | null | undefined): string {
  if (!v) return "";
  if (v.length <= 6) return "***";
  return `${v.slice(0, 4)}${"*".repeat(v.length - 6)}${v.slice(-2)}`;
}

// Strip sensitive fields before returning to client
function sanitizeAccount(acc: typeof centralPaymentAccountsTable.$inferSelect) {
  const { razorpaySecretEncrypted, ...rest } = acc;
  return {
    ...rest,
    hasRazorpaySecret: !!razorpaySecretEncrypted,
  };
}

async function writeAudit(
  req: any,
  accountId: string,
  action: string,
  changes: Record<string, { old: string; new: string }> | null,
) {
  await db.insert(centralPaymentAccountAuditTable).values({
    accountId,
    action,
    changedById: req.dbUser?.id,
    changedByName: req.dbUser?.displayName ?? "",
    changedAt: new Date(),
    ipAddress: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress,
    changes,
  });
}

// ── GET /api/payment-settings — active account (no secret) ───────────────────
router.get("/", async (req, res) => {
  try {
    const [active] = await db
      .select()
      .from(centralPaymentAccountsTable)
      .where(eq(centralPaymentAccountsTable.isActive, true))
      .limit(1);
    if (!active) return res.json(null);
    res.json(sanitizeAccount(active));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch active payment settings" });
  }
});

// ── GET /api/payment-settings/all — all accounts (admin only) ────────────────
router.get("/all", async (req, res) => {
  try {
    const accounts = await db
      .select()
      .from(centralPaymentAccountsTable)
      .orderBy(desc(centralPaymentAccountsTable.createdAt));
    res.json(accounts.map(sanitizeAccount));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch payment settings" });
  }
});

// ── GET /api/payment-settings/:id/audit — audit log ─────────────────────────
router.get("/:id/audit", async (req, res) => {
  try {
    const entries = await db
      .select()
      .from(centralPaymentAccountAuditTable)
      .where(eq(centralPaymentAccountAuditTable.accountId, req.params.id))
      .orderBy(desc(centralPaymentAccountAuditTable.changedAt));
    res.json(entries);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// ── Validation schemas ────────────────────────────────────────────────────────
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

const AccountSchema = z.object({
  displayName: z.string().min(1).default("Main Payment Account"),
  businessName: z.string().optional(),
  accountHolderName: z.string().optional(),
  bankName: z.string().optional(),
  branchName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode: z
    .string()
    .optional()
    .refine(v => !v || IFSC_RE.test(v), { message: "Invalid IFSC code format (e.g. SBIN0001234)" }),
  upiId: z
    .string()
    .optional()
    .refine(v => !v || UPI_RE.test(v), { message: "Invalid UPI ID format (e.g. name@upi)" }),
  merchantName: z.string().optional(),
  razorpayKeyId: z.string().optional(),
  razorpaySecret: z.string().optional(), // plain, encrypted before storage
  paymentCallbackUrl: z.string().url().optional().or(z.literal("")),
  supportPhone: z.string().optional(),
  supportEmail: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
});

// ── POST /api/payment-settings — create account ───────────────────────────────
router.post("/", async (req, res) => {
  const parse = AccountSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const data = parse.data;

  try {
    const razorpaySecretEncrypted = data.razorpaySecret
      ? encryptSecret(data.razorpaySecret)
      : undefined;

    const [acc] = await db
      .insert(centralPaymentAccountsTable)
      .values({
        displayName: data.displayName,
        businessName: data.businessName,
        accountHolderName: data.accountHolderName,
        bankName: data.bankName,
        branchName: data.branchName,
        accountNumber: data.accountNumber,
        ifscCode: data.ifscCode,
        upiId: data.upiId,
        merchantName: data.merchantName,
        razorpayKeyId: data.razorpayKeyId,
        razorpaySecretEncrypted,
        paymentCallbackUrl: data.paymentCallbackUrl || undefined,
        supportPhone: data.supportPhone,
        supportEmail: data.supportEmail || undefined,
        notes: data.notes,
        isActive: false,
        createdById: req.dbUser?.id,
        createdByName: req.dbUser?.displayName ?? "",
        updatedById: req.dbUser?.id,
        updatedByName: req.dbUser?.displayName ?? "",
      })
      .returning();

    await writeAudit(req, acc.id, "created", null);
    res.status(201).json(sanitizeAccount(acc));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create payment settings" });
  }
});

// ── PATCH /api/payment-settings/:id — update account ─────────────────────────
router.patch("/:id", async (req, res) => {
  const parse = AccountSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const data = parse.data;

  try {
    const [existing] = await db
      .select()
      .from(centralPaymentAccountsTable)
      .where(eq(centralPaymentAccountsTable.id, req.params.id));
    if (!existing) return res.status(404).json({ error: "Account not found" });

    // Build audit change map (mask sensitive values)
    const auditChanges: Record<string, { old: string; new: string }> = {};
    const sensitiveFields = new Set(["accountNumber", "razorpaySecret", "razorpayKeyId"]);

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedById: req.dbUser?.id,
      updatedByName: req.dbUser?.displayName ?? "",
    };

    for (const [key, value] of Object.entries(data)) {
      if (key === "razorpaySecret") {
        if (value) {
          updates["razorpaySecretEncrypted"] = encryptSecret(value as string);
          auditChanges["razorpaySecret"] = { old: "***", new: "***" };
        }
      } else {
        const dbKey = key as keyof typeof existing;
        if (existing[dbKey] !== value) {
          const oldStr = String(existing[dbKey] ?? "");
          const newStr = String(value ?? "");
          auditChanges[key] = {
            old: sensitiveFields.has(key) ? maskValue(oldStr) : oldStr,
            new: sensitiveFields.has(key) ? maskValue(newStr) : newStr,
          };
        }
        updates[key] = value;
      }
    }

    const [updated] = await db
      .update(centralPaymentAccountsTable)
      .set(updates as any)
      .where(eq(centralPaymentAccountsTable.id, req.params.id))
      .returning();

    if (Object.keys(auditChanges).length > 0) {
      await writeAudit(req, updated.id, "updated", auditChanges);
    }

    res.json(sanitizeAccount(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update payment settings" });
  }
});

// ── POST /api/payment-settings/:id/activate ───────────────────────────────────
router.post("/:id/activate", async (req, res) => {
  try {
    const [existing] = await db
      .select()
      .from(centralPaymentAccountsTable)
      .where(eq(centralPaymentAccountsTable.id, req.params.id));
    if (!existing) return res.status(404).json({ error: "Account not found" });

    // Deactivate all others first
    await db
      .update(centralPaymentAccountsTable)
      .set({ isActive: false, updatedAt: new Date() });

    const [updated] = await db
      .update(centralPaymentAccountsTable)
      .set({ isActive: true, updatedAt: new Date(), updatedById: req.dbUser?.id, updatedByName: req.dbUser?.displayName ?? "" })
      .where(eq(centralPaymentAccountsTable.id, req.params.id))
      .returning();

    await writeAudit(req, updated.id, "activated", null);
    res.json(sanitizeAccount(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to activate account" });
  }
});

// ── POST /api/payment-settings/:id/deactivate ─────────────────────────────────
router.post("/:id/deactivate", async (req, res) => {
  try {
    const [existing] = await db
      .select()
      .from(centralPaymentAccountsTable)
      .where(eq(centralPaymentAccountsTable.id, req.params.id));
    if (!existing) return res.status(404).json({ error: "Account not found" });

    const [updated] = await db
      .update(centralPaymentAccountsTable)
      .set({ isActive: false, updatedAt: new Date(), updatedById: req.dbUser?.id, updatedByName: req.dbUser?.displayName ?? "" })
      .where(eq(centralPaymentAccountsTable.id, req.params.id))
      .returning();

    await writeAudit(req, updated.id, "deactivated", null);
    res.json(sanitizeAccount(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to deactivate account" });
  }
});

export default router;
