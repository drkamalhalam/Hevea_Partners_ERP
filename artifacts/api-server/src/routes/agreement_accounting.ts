import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  agreementsTable,
  agreementAccountingProfilesTable,
  projectsTable,
  lcaConfigsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function formatProfile(row: typeof agreementAccountingProfilesTable.$inferSelect) {
  return {
    id: row.id,
    agreementId: row.agreementId,
    accountingModel: row.accountingModel,
    costsChargedBeforeDistribution: row.costsChargedBeforeDistribution,
    lcaChargedBeforeDistribution: row.lcaChargedBeforeDistribution,
    grossSplitPctLandowner: Number(row.grossSplitPctLandowner),
    grossSplitPctDeveloper: Number(row.grossSplitPctDeveloper),
    landownerBearsCostSeparately: row.landownerBearsCostSeparately,
    developerBearsCostSeparately: row.developerBearsCostSeparately,
    lcaApplicable: row.lcaApplicable,
    validationStatus: row.validationStatus,
    validationNotes: row.validationNotes ?? undefined,
    validatedAt: row.validatedAt?.toISOString() ?? undefined,
    validatedByName: row.validatedByName ?? undefined,
    configuredByName: row.configuredByName,
    updatedByName: row.updatedByName ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Derive sensible default flags from the agreement's revenueModel.
 * Used when auto-initializing a profile that doesn't exist yet.
 */
function defaultFlagsForModel(revenueModel: string) {
  if (revenueModel === "fifty_percent_revenue") {
    return {
      accountingModel: "fifty_percent_revenue",
      costsChargedBeforeDistribution: false,
      lcaChargedBeforeDistribution: false,
      grossSplitPctLandowner: 50,
      grossSplitPctDeveloper: 50,
      landownerBearsCostSeparately: true,
      developerBearsCostSeparately: true,
      lcaApplicable: false,
    };
  }
  // contribution (default)
  return {
    accountingModel: "contribution",
    costsChargedBeforeDistribution: true,
    lcaChargedBeforeDistribution: true,
    grossSplitPctLandowner: 50,
    grossSplitPctDeveloper: 50,
    landownerBearsCostSeparately: false,
    developerBearsCostSeparately: false,
    lcaApplicable: false, // will be updated by validate if LCA config exists
  };
}

// ── GET /agreements/:id/accounting-profile ────────────────────────────────────
// Returns the accounting profile, auto-creating it from agreement defaults if
// it does not yet exist.

router.get("/:id/accounting-profile", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const agreementId = req.params.id as string;

  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(and(eq(agreementsTable.id, agreementId), isNull(agreementsTable.deletedAt)))
    .limit(1);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });

  // Return existing profile
  const [existing] = await db
    .select()
    .from(agreementAccountingProfilesTable)
    .where(eq(agreementAccountingProfilesTable.agreementId, agreementId))
    .limit(1);
  if (existing) return res.json(formatProfile(existing));

  // Auto-initialize with defaults derived from revenueModel
  const defaults = defaultFlagsForModel(agreement.revenueModel ?? "contribution");
  const [created] = await db
    .insert(agreementAccountingProfilesTable)
    .values({
      agreementId,
      ...defaults,
      configuredByName: "System (auto-initialized)",
    })
    .returning();

  return res.json(formatProfile(created));
});

// ── PUT /agreements/:id/accounting-profile ────────────────────────────────────
// Upsert the accounting profile flags (admin/developer only).
// The accountingModel is always mirrored from agreement.revenueModel and
// cannot be overridden directly.

router.put(
  "/:id/accounting-profile",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const agreementId = req.params.id as string;

    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(and(eq(agreementsTable.id, agreementId), isNull(agreementsTable.deletedAt)))
      .limit(1);
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });

    type Body = {
      costsChargedBeforeDistribution?: boolean;
      lcaChargedBeforeDistribution?: boolean;
      grossSplitPctLandowner?: number;
      grossSplitPctDeveloper?: number;
      landownerBearsCostSeparately?: boolean;
      developerBearsCostSeparately?: boolean;
    };
    const body = req.body as Body;

    // Validate 50% revenue model: split must sum to 100
    if (agreement.revenueModel === "fifty_percent_revenue") {
      const lo = body.grossSplitPctLandowner;
      const dev = body.grossSplitPctDeveloper;
      if (lo !== undefined && dev !== undefined) {
        if (Math.abs(lo + dev - 100) > 0.01) {
          return res.status(400).json({
            error: `grossSplitPctLandowner (${lo}) + grossSplitPctDeveloper (${dev}) must equal 100`,
          });
        }
      }
    }

    const actorName = actor.displayName ?? actor.email ?? "Unknown";
    const modelDefaults = defaultFlagsForModel(agreement.revenueModel ?? "contribution");

    // Check if profile exists
    const [existing] = await db
      .select()
      .from(agreementAccountingProfilesTable)
      .where(eq(agreementAccountingProfilesTable.agreementId, agreementId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(agreementAccountingProfilesTable)
        .set({
          accountingModel: modelDefaults.accountingModel,
          ...(body.costsChargedBeforeDistribution !== undefined && {
            costsChargedBeforeDistribution: body.costsChargedBeforeDistribution,
          }),
          ...(body.lcaChargedBeforeDistribution !== undefined && {
            lcaChargedBeforeDistribution: body.lcaChargedBeforeDistribution,
          }),
          ...(body.grossSplitPctLandowner !== undefined && {
            grossSplitPctLandowner: body.grossSplitPctLandowner,
          }),
          ...(body.grossSplitPctDeveloper !== undefined && {
            grossSplitPctDeveloper: body.grossSplitPctDeveloper,
          }),
          ...(body.landownerBearsCostSeparately !== undefined && {
            landownerBearsCostSeparately: body.landownerBearsCostSeparately,
          }),
          ...(body.developerBearsCostSeparately !== undefined && {
            developerBearsCostSeparately: body.developerBearsCostSeparately,
          }),
          updatedById: actor.id,
          updatedByName: actorName,
          updatedAt: new Date(),
          // Reset validation to pending when flags change
          validationStatus: "pending",
          validationNotes: null,
          validatedAt: null,
          validatedById: null,
          validatedByName: null,
        })
        .where(eq(agreementAccountingProfilesTable.agreementId, agreementId))
        .returning();
      return res.json(formatProfile(updated));
    }

    // Create new
    const [created] = await db
      .insert(agreementAccountingProfilesTable)
      .values({
        agreementId,
        accountingModel: modelDefaults.accountingModel,
        costsChargedBeforeDistribution:
          body.costsChargedBeforeDistribution ?? modelDefaults.costsChargedBeforeDistribution,
        lcaChargedBeforeDistribution:
          body.lcaChargedBeforeDistribution ?? modelDefaults.lcaChargedBeforeDistribution,
        grossSplitPctLandowner:
          body.grossSplitPctLandowner ?? modelDefaults.grossSplitPctLandowner,
        grossSplitPctDeveloper:
          body.grossSplitPctDeveloper ?? modelDefaults.grossSplitPctDeveloper,
        landownerBearsCostSeparately:
          body.landownerBearsCostSeparately ?? modelDefaults.landownerBearsCostSeparately,
        developerBearsCostSeparately:
          body.developerBearsCostSeparately ?? modelDefaults.developerBearsCostSeparately,
        lcaApplicable: modelDefaults.lcaApplicable,
        configuredById: actor.id,
        configuredByName: actorName,
      })
      .returning();
    return res.json(formatProfile(created));
  },
);

// ── POST /agreements/:id/accounting-profile/validate ──────────────────────────
// Runs model-consistency validation checks and persists the result.

router.post(
  "/:id/accounting-profile/validate",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const agreementId = req.params.id as string;

    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(and(eq(agreementsTable.id, agreementId), isNull(agreementsTable.deletedAt)))
      .limit(1);
    if (!agreement) return res.status(404).json({ error: "Agreement not found" });

    // Ensure profile exists
    let [profile] = await db
      .select()
      .from(agreementAccountingProfilesTable)
      .where(eq(agreementAccountingProfilesTable.agreementId, agreementId))
      .limit(1);

    if (!profile) {
      const defaults = defaultFlagsForModel(agreement.revenueModel ?? "contribution");
      [profile] = await db
        .insert(agreementAccountingProfilesTable)
        .values({ agreementId, ...defaults, configuredByName: "System (auto-initialized)" })
        .returning();
    }

    // Fetch related data for validation
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, agreement.projectId))
      .limit(1);

    const lcaConfigs = await db
      .select()
      .from(lcaConfigsTable)
      .where(
        and(
          eq(lcaConfigsTable.projectId, agreement.projectId),
          eq(lcaConfigsTable.isActive, true),
        ),
      );

    const hasActiveLcaConfig = lcaConfigs.length > 0;

    type CheckStatus = "pass" | "warn" | "fail";
    type Check = { checkId: string; label: string; status: CheckStatus; message: string };
    const checks: Check[] = [];

    const model = agreement.revenueModel ?? "contribution";

    // ── Check 1: Model consistency ───────────────────────────────────────────
    {
      const profileModel = profile.accountingModel;
      if (profileModel !== model) {
        checks.push({
          checkId: "model_consistency",
          label: "Model Consistency",
          status: "fail",
          message: `Profile model "${profileModel}" does not match agreement revenue model "${model}". Re-save the profile to sync.`,
        });
      } else {
        checks.push({
          checkId: "model_consistency",
          label: "Model Consistency",
          status: "pass",
          message: `Accounting model matches agreement revenue model: "${model}".`,
        });
      }
    }

    // ── Check 2: Agreement status ────────────────────────────────────────────
    {
      if (agreement.status === "active") {
        checks.push({
          checkId: "agreement_status",
          label: "Agreement Status",
          status: "pass",
          message: "Agreement is active — accounting profile is operationally relevant.",
        });
      } else {
        checks.push({
          checkId: "agreement_status",
          label: "Agreement Status",
          status: "warn",
          message: `Agreement status is "${agreement.status}". Accounting profile is configured but not yet active.`,
        });
      }
    }

    // ── Check 3: Project lifecycle ───────────────────────────────────────────
    {
      if (project?.lifecycleStatus === "mature_production") {
        checks.push({
          checkId: "project_lifecycle",
          label: "Project Lifecycle",
          status: "pass",
          message: "Project is in mature production — accounting flows are applicable.",
        });
      } else {
        checks.push({
          checkId: "project_lifecycle",
          label: "Project Lifecycle",
          status: "warn",
          message: `Project lifecycle is "${project?.lifecycleStatus ?? "unknown"}". Full accounting flows activate on mature production.`,
        });
      }
    }

    if (model === "contribution") {
      // ── Check 4 (contribution): Ownership shares ─────────────────────────
      {
        const lo = agreement.ownershipShareLandowner;
        const dev = agreement.ownershipShareDeveloper;
        if (lo != null && dev != null) {
          const sum = Number(lo) + Number(dev);
          if (Math.abs(sum - 100) < 0.01) {
            checks.push({
              checkId: "ownership_shares",
              label: "Ownership Shares",
              status: "pass",
              message: `Ownership shares sum to 100%: Landowner ${Number(lo).toFixed(1)}% + Developer ${Number(dev).toFixed(1)}%.`,
            });
          } else {
            checks.push({
              checkId: "ownership_shares",
              label: "Ownership Shares",
              status: "fail",
              message: `Ownership shares sum to ${sum.toFixed(1)}% (must equal 100%). Adjust shares on the agreement.`,
            });
          }
        } else {
          checks.push({
            checkId: "ownership_shares",
            label: "Ownership Shares",
            status: "warn",
            message: "Ownership shares not set on the agreement. Required for profit pool distribution calculations.",
          });
        }
      }

      // ── Check 5 (contribution): LCA config ───────────────────────────────
      {
        if (profile.lcaChargedBeforeDistribution) {
          if (hasActiveLcaConfig) {
            checks.push({
              checkId: "lca_config",
              label: "LCA Configuration",
              status: "pass",
              message: "Active LCA config found — LCA can be charged before distribution as configured.",
            });
          } else {
            checks.push({
              checkId: "lca_config",
              label: "LCA Configuration",
              status: "warn",
              message: "Profile flags LCA as charged before distribution, but no active LCA config exists for this project. Create an LCA config or disable the flag.",
            });
          }
        } else {
          checks.push({
            checkId: "lca_config",
            label: "LCA Configuration",
            status: hasActiveLcaConfig ? "warn" : "pass",
            message: hasActiveLcaConfig
              ? "An active LCA config exists but lcaChargedBeforeDistribution is disabled. Enable the flag if LCA should reduce the profit pool."
              : "LCA not charged before distribution — no LCA config expected.",
          });
        }
      }
    } else {
      // ── Check 4 (50% revenue): Split percentages ─────────────────────────
      {
        const lo = Number(profile.grossSplitPctLandowner);
        const dev = Number(profile.grossSplitPctDeveloper);
        const sum = lo + dev;
        if (Math.abs(sum - 100) < 0.01) {
          checks.push({
            checkId: "split_percentages",
            label: "Gross Revenue Split",
            status: "pass",
            message: `Split percentages sum to 100%: Landowner ${lo.toFixed(1)}% + Developer ${dev.toFixed(1)}%.`,
          });
        } else {
          checks.push({
            checkId: "split_percentages",
            label: "Gross Revenue Split",
            status: "fail",
            message: `Split percentages sum to ${sum.toFixed(1)}% (must equal 100%). Update grossSplitPctLandowner and grossSplitPctDeveloper.`,
          });
        }
      }

      // ── Check 5 (50% revenue): LCA mismatch ──────────────────────────────
      {
        if (hasActiveLcaConfig) {
          checks.push({
            checkId: "lca_mismatch",
            label: "LCA Mismatch",
            status: "warn",
            message: "An active LCA config exists for this project, but LCA does not apply to the 50% revenue-sharing model. Consider deactivating the LCA config.",
          });
        } else {
          checks.push({
            checkId: "lca_mismatch",
            label: "LCA Applicability",
            status: "pass",
            message: "No LCA config found — correct for the 50% revenue-sharing model.",
          });
        }
      }
    }

    // ── Determine overall status ─────────────────────────────────────────────
    const hasFail = checks.some((c) => c.status === "fail");
    const hasWarn = checks.some((c) => c.status === "warn");
    const overallStatus: "valid" | "warning" | "invalid" = hasFail
      ? "invalid"
      : hasWarn
        ? "warning"
        : "valid";

    const validationNotes = checks
      .filter((c) => c.status !== "pass")
      .map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.message}`)
      .join(" | ");

    // Compute lcaApplicable: true if contribution model AND active LCA config exists
    const lcaApplicable = model === "contribution" && hasActiveLcaConfig;

    // Persist validation result
    const actorName = actor.displayName ?? actor.email ?? "Unknown";
    const [updatedProfile] = await db
      .update(agreementAccountingProfilesTable)
      .set({
        validationStatus: overallStatus,
        validationNotes: validationNotes || null,
        validatedAt: new Date(),
        validatedById: actor.id,
        validatedByName: actorName,
        lcaApplicable,
        accountingModel: model,
        updatedAt: new Date(),
      })
      .where(eq(agreementAccountingProfilesTable.agreementId, agreementId))
      .returning();

    return res.json({
      agreementId,
      accountingModel: model,
      overallStatus,
      checks,
      profile: formatProfile(updatedProfile),
    });
  },
);

export default router;
