import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, userRolesTable } from "@workspace/db";

const router = Router();

/**
 * POST /api/dev/promote-admin
 * Development-only endpoint. Promotes the currently logged-in Clerk user to admin.
 * Returns 404 in production so it cannot be discovered or exploited.
 */
router.post("/promote-admin", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await db
    .insert(userRolesTable)
    .values({ clerkUserId: userId, role: "admin" })
    .onConflictDoUpdate({
      target: userRolesTable.clerkUserId,
      set: { role: "admin", updatedAt: new Date() },
    });

  res.json({ ok: true, message: "You are now an admin. Reload the app." });
});

export default router;
