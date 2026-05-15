import { Router } from "express";
import {
  db,
  projectSalesPermissionsTable,
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
    if (projectId) conditions.push(eq(projectSalesPermissionsTable.projectId, projectId));
    if (activeOnly !== "false") conditions.push(eq(projectSalesPermissionsTable.isActive, true));

    const perms = await db
      .select()
      .from(projectSalesPermissionsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(projectSalesPermissionsTable.createdAt));

    res.json(perms);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

const CreateSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().min(1),
  roleType: z.enum(["developer", "landowner", "employee", "operational_staff"]),
  canSell: z.boolean().default(true),
  canReceivePayment: z.boolean().default(false),
  allowedPaymentModes: z.enum(["online_only", "cash_only", "both"]).default("both"),
  notes: z.string().optional(),
});

router.post("/", async (req, res): Promise<void> => {
  const parse = CreateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }
  const data = parse.data;

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, data.projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const [perm] = await db
      .insert(projectSalesPermissionsTable)
      .values({
        projectId: data.projectId,
        projectName: project.name,
        userId: data.userId,
        userName: data.userName,
        roleType: data.roleType,
        canSell: data.canSell,
        canReceivePayment: data.canReceivePayment,
        allowedPaymentModes: data.allowedPaymentModes,
        notes: data.notes,
        grantedById: req.dbUser?.id,
        grantedByName: req.dbUser?.displayName ?? "",
      })
      .returning();

    res.status(201).json(perm);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create permission" });
  }
});

router.patch("/:id/revoke", async (req, res): Promise<void> => {
  try {
    const [updated] = await db
      .update(projectSalesPermissionsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(projectSalesPermissionsTable.id, req.params.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Permission not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to revoke permission" });
  }
});

export default router;
