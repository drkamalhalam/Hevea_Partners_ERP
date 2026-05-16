/**
 * project_governance.ts
 *
 * Admin governance validation & scan endpoints.
 *
 *   POST /projects/:id/governance/validate  — re-validate a single project
 *   POST /admin/governance/scan             — scan every active project
 */

import { Router } from "express";
import { requireRole } from "../middlewares/auth";
import { applyGovernanceValidation, scanAllProjectGovernance } from "../lib/landownerGovernance";

const router = Router();

// POST /projects/:id/governance/validate
router.post(
  "/:id/governance/validate",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = String(req.params.id);
    const result = await applyGovernanceValidation(id, req.log);
    res.json({
      projectId: id,
      valid: result.valid,
      configurationStatus: result.configurationStatus,
      landownerValidationStatus: result.landownerValidationStatus,
      invalidReason: result.invalidReason,
    });
  },
);

export default router;
