/**
 * admin_governance.ts
 *
 * Admin-only governance scan endpoint.
 * Mounted at /admin/governance.
 *
 *   POST /admin/governance/scan  — scan all active projects for landowner validity
 */

import { Router } from "express";
import { requireRole } from "../middlewares/auth";
import { scanAllProjectGovernance } from "../lib/landownerGovernance";

const router = Router();

// POST /scan
router.post("/scan", requireRole("admin"), async (req, res) => {
  const summary = await scanAllProjectGovernance(req.log);
  res.json({ ok: true, summary });
});

export default router;
