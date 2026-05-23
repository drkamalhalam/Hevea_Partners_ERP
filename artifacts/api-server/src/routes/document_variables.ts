import { Router, type Request, type Response } from "express";
import {
  db,
  usersTable,
  documentVariableRegistryTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  CreateDocumentVariableBody,
  UpdateDocumentVariableBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const { sourceType, isActive } = req.query;
  const conds = [];
  if (typeof sourceType === "string" && sourceType.length > 0) {
    conds.push(
      eq(
        documentVariableRegistryTable.sourceType,
        sourceType as typeof documentVariableRegistryTable.$inferSelect.sourceType,
      ),
    );
  }
  if (isActive === "true") {
    conds.push(eq(documentVariableRegistryTable.isActive, true));
  } else if (isActive === "false") {
    conds.push(eq(documentVariableRegistryTable.isActive, false));
  }
  const rows = await db
    .select()
    .from(documentVariableRegistryTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      documentVariableRegistryTable.groupName,
      documentVariableRegistryTable.variableKey,
    );
  res.json(rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const [row] = await db
    .select()
    .from(documentVariableRegistryTable)
    .where(eq(documentVariableRegistryTable.id, String(req.params.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Variable not found" });
    return;
  }
  res.json(row);
});

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = CreateDocumentVariableBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const [existing] = await db
      .select({ id: documentVariableRegistryTable.id })
      .from(documentVariableRegistryTable)
      .where(eq(documentVariableRegistryTable.variableKey, parsed.data.variableKey))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "variableKey already exists" });
      return;
    }
    const [user] = await db
      .select({ id: usersTable.id, displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, req.userId!))
      .limit(1);
    const [created] = await db
      .insert(documentVariableRegistryTable)
      .values({
        variableKey: parsed.data.variableKey,
        label: parsed.data.label,
        description: parsed.data.description,
        sourceType: parsed.data.sourceType,
        sourceField: parsed.data.sourceField,
        dataType: parsed.data.dataType ?? "string",
        isRequired: parsed.data.isRequired ?? false,
        exampleValue: parsed.data.exampleValue,
        groupName: parsed.data.groupName,
        createdBy: user?.id ?? null,
        createdByName: user?.displayName ?? null,
      })
      .returning();
    res.status(201).json(created);
  },
);

router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = UpdateDocumentVariableBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const [existing] = await db
      .select()
      .from(documentVariableRegistryTable)
      .where(eq(documentVariableRegistryTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Variable not found" });
      return;
    }
    const [updated] = await db
      .update(documentVariableRegistryTable)
      .set(parsed.data)
      .where(eq(documentVariableRegistryTable.id, String(req.params.id)))
      .returning();
    res.json(updated);
  },
);

router.delete(
  "/:id",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const [existing] = await db
      .select()
      .from(documentVariableRegistryTable)
      .where(eq(documentVariableRegistryTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Variable not found" });
      return;
    }
    await db
      .update(documentVariableRegistryTable)
      .set({ isActive: false })
      .where(eq(documentVariableRegistryTable.id, String(req.params.id)));
    res.status(204).send();
  },
);

export default router;
