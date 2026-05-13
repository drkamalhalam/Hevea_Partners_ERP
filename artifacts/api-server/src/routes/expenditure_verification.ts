import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, or, isNull, SQL } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  expendituresTable,
  expenditureVerificationRequestsTable,
  expenditureVerificationEventsTable,
  userProjectAssignmentsTable,
  agreementsTable,
} from "@workspace/db";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function resolveActingUser(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role, displayName: usersTable.displayName })
    .from(usersTable)
    .where(and(eq(usersTable.clerkUserId, clerkUserId), eq(usersTable.isActive, true)))
    .limit(1);
  return user ?? null;
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(
      and(
        eq(userProjectAssignmentsTable.userId, userId),
        isNull(userProjectAssignmentsTable.revokedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}

function formatVerificationRequest(
  r: typeof expenditureVerificationRequestsTable.$inferSelect,
) {
  return {
    id: r.id,
    expenditureId: r.expenditureId,
    projectId: r.projectId,
    requiredVerifierRole: r.requiredVerifierRole,
    requiredVerifierId: r.requiredVerifierId ?? null,
    requiredVerifierName: r.requiredVerifierName ?? null,
    routingReason: r.routingReason,
    status: r.status,
    otpCode: r.otpCode ?? null,
    otpSentAt: r.otpSentAt?.toISOString() ?? null,
    otpExpiresAt: r.otpExpiresAt?.toISOString() ?? null,
    otpVerifiedAt: r.otpVerifiedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedById: r.resolvedById ?? null,
    resolvedByName: r.resolvedByName ?? null,
    resolverNotes: r.resolverNotes ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function formatVerificationEvent(
  e: typeof expenditureVerificationEventsTable.$inferSelect,
) {
  return {
    id: e.id,
    expenditureId: e.expenditureId,
    verificationRequestId: e.verificationRequestId ?? null,
    eventType: e.eventType,
    actorId: e.actorId ?? null,
    actorName: e.actorName,
    actorRole: e.actorRole ?? null,
    notes: e.notes ?? null,
    metadata: (e.metadata as Record<string, unknown>) ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

function formatEntry(
  exp: typeof expendituresTable.$inferSelect,
  projectName: string | null,
) {
  return {
    id: exp.id,
    projectId: exp.projectId,
    projectName,
    paidById: exp.paidById ?? null,
    paidByName: exp.paidByName ?? null,
    category: exp.category,
    amount: exp.amount,
    expenditureDate: exp.expenditureDate,
    description: exp.description,
    invoiceObjectPath: exp.invoiceObjectPath ?? null,
    verificationStatus: exp.verificationStatus,
    verifiedAt: exp.verifiedAt ? exp.verifiedAt.toISOString() : null,
    verifiedByName: exp.verifiedByName ?? null,
    verifierNotes: exp.verifierNotes ?? null,
    lifecyclePhaseSnapshot: exp.lifecyclePhaseSnapshot,
    recordedByName: exp.recordedByName ?? null,
    notes: exp.notes ?? null,
    createdAt: exp.createdAt.toISOString(),
  };
}

// ── Core routing helper — exported for use in expenditures.ts submit ──────────

/**
 * Determine which role should verify this expenditure and create (or reset)
 * the verification request row. Also writes routing_assigned event.
 *
 * Routing rules:
 *   developer records  → landowner verifies
 *   landowner records  → developer verifies
 *   employee / staff   → developer verifies
 *   admin              → admin self-verifies
 *   50% revenue model + operational cost → always landowner verifies
 */
export async function routeAndCreateVerificationRequest({
  expenditureId,
  projectId,
  category,
  actorId,
  actorRole,
  actorName,
  eventType = "routing_assigned",
}: {
  expenditureId: string;
  projectId: string;
  category: string;
  actorId: string;
  actorRole: string;
  actorName: string;
  eventType?: "routing_assigned" | "resubmitted";
}) {
  // 1. Check for 50% revenue sharing agreements on this project
  const agreements = await db
    .select({ revenueModel: agreementsTable.revenueModel })
    .from(agreementsTable)
    .where(
      and(
        eq(agreementsTable.projectId, projectId),
        eq(agreementsTable.status, "active"),
      ),
    );

  const hasFiftyPercent = agreements.some(
    (a) => a.revenueModel === "fifty_percent_revenue",
  );

  // 2. Determine required verifier role
  let requiredVerifierRole: string;
  let routingReason: string;

  if (hasFiftyPercent) {
    requiredVerifierRole = "landowner";
    routingReason =
      "50% revenue sharing agreement active — Landowner verification required for all expenditures";
  } else if (actorRole === "developer") {
    requiredVerifierRole = "landowner";
    routingReason =
      "Expenditure recorded by Project Developer — cross-verification by Landowner required";
  } else if (actorRole === "landowner") {
    requiredVerifierRole = "developer";
    routingReason =
      "Expenditure recorded by Landowner — cross-verification by Project Developer required";
  } else if (actorRole === "admin") {
    requiredVerifierRole = "admin";
    routingReason =
      "Expenditure recorded by Administrator — admin self-verification permitted";
  } else {
    // employee, operational_staff
    requiredVerifierRole = "developer";
    routingReason = `Expenditure recorded by ${actorRole} — Project Developer verification required`;
  }

  // 3. Find a specific assigned verifier user for this project
  let requiredVerifierId: string | null = null;
  let requiredVerifierName: string | null = null;

  if (requiredVerifierRole !== "admin") {
    const rows = await db
      .select({
        userId: userProjectAssignmentsTable.userId,
        displayName: usersTable.displayName,
      })
      .from(userProjectAssignmentsTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, userProjectAssignmentsTable.userId),
      )
      .where(
        and(
          eq(userProjectAssignmentsTable.projectId, projectId),
          isNull(userProjectAssignmentsTable.revokedAt),
          eq(
            usersTable.role,
            requiredVerifierRole as typeof usersTable.role._.data,
          ),
          eq(usersTable.isActive, true),
        ),
      )
      .limit(1);

    if (rows.length > 0 && rows[0].userId) {
      requiredVerifierId = rows[0].userId;
      requiredVerifierName = rows[0].displayName ?? null;
    }
  }

  // 4. Upsert the verification request
  const [existing] = await db
    .select()
    .from(expenditureVerificationRequestsTable)
    .where(
      eq(expenditureVerificationRequestsTable.expenditureId, expenditureId),
    )
    .limit(1);

  let request: typeof expenditureVerificationRequestsTable.$inferSelect;

  if (existing) {
    // Re-submission: reset request to pending, clear resolution fields
    const [updated] = await db
      .update(expenditureVerificationRequestsTable)
      .set({
        requiredVerifierRole,
        requiredVerifierId,
        requiredVerifierName,
        routingReason,
        status: "pending",
        otpCode: null,
        otpSentAt: null,
        otpExpiresAt: null,
        otpVerifiedAt: null,
        resolvedAt: null,
        resolvedById: null,
        resolvedByName: null,
        resolverNotes: null,
        updatedAt: new Date(),
      })
      .where(eq(expenditureVerificationRequestsTable.id, existing.id))
      .returning();
    request = updated;
  } else {
    const [inserted] = await db
      .insert(expenditureVerificationRequestsTable)
      .values({
        expenditureId,
        projectId,
        requiredVerifierRole,
        requiredVerifierId,
        requiredVerifierName,
        routingReason,
      })
      .returning();
    request = inserted;
  }

  // 5. Write routing event
  await db.insert(expenditureVerificationEventsTable).values({
    expenditureId,
    verificationRequestId: request.id,
    eventType,
    actorId,
    actorName,
    actorRole,
    notes: routingReason,
    metadata: {
      requiredVerifierRole,
      requiredVerifierId,
      requiredVerifierName,
    },
  });

  return request;
}

// ── GET /expenditures/pending-verification ─────────────────────────────────────

router.get("/expenditures/pending-verification", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  // Determine visible project IDs
  let visibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    visibleProjectIds = await getAssignedProjectIds(actor.id);
    if (visibleProjectIds.length === 0) return res.json({ items: [] });
  }

  // Build conditions: pending requests assigned to this user's role OR directly to them
  const conditions: SQL[] = [
    eq(expenditureVerificationRequestsTable.status, "pending"),
  ];

  if (visibleProjectIds !== null) {
    conditions.push(
      inArray(expenditureVerificationRequestsTable.projectId, visibleProjectIds),
    );
  }

  // Role-based visibility: the request must be for this user's role or directly assigned to them
  const roleCondition = or(
    eq(
      expenditureVerificationRequestsTable.requiredVerifierId,
      actor.id,
    ),
    eq(
      expenditureVerificationRequestsTable.requiredVerifierRole,
      actor.role as typeof usersTable.role._.data,
    ),
  );
  if (roleCondition) conditions.push(roleCondition);

  const rows = await db
    .select({
      request: expenditureVerificationRequestsTable,
      exp: expendituresTable,
      projectName: projectsTable.name,
    })
    .from(expenditureVerificationRequestsTable)
    .leftJoin(
      expendituresTable,
      eq(
        expendituresTable.id,
        expenditureVerificationRequestsTable.expenditureId,
      ),
    )
    .leftJoin(
      projectsTable,
      eq(projectsTable.id, expenditureVerificationRequestsTable.projectId),
    )
    .where(and(...conditions))
    .orderBy(desc(expenditureVerificationRequestsTable.createdAt));

  const items = rows
    .filter((r) => r.exp !== null)
    .map((r) => ({
      expenditure: formatEntry(r.exp!, r.projectName ?? null),
      request: formatVerificationRequest(r.request),
    }));

  return res.json({ items });
});

// ── GET /expenditures/:id/verification ────────────────────────────────────────

router.get("/expenditures/:id/verification", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const expenditureId = String(req.params.id);

  // Verify expenditure exists and actor has access
  const [expRow] = await db
    .select({ exp: expendituresTable, projectName: projectsTable.name })
    .from(expendituresTable)
    .leftJoin(projectsTable, eq(projectsTable.id, expendituresTable.projectId))
    .where(
      and(
        eq(expendituresTable.id, expenditureId),
        eq(expendituresTable.isActive, true),
      ),
    )
    .limit(1);

  if (!expRow) return res.status(404).json({ error: "Expenditure not found" });

  if (!canAccessAllProjects(actor.role)) {
    const assigned = await getAssignedProjectIds(actor.id);
    if (!assigned.includes(expRow.exp.projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Fetch verification request
  const [request] = await db
    .select()
    .from(expenditureVerificationRequestsTable)
    .where(
      eq(expenditureVerificationRequestsTable.expenditureId, expenditureId),
    )
    .limit(1);

  // Fetch events (newest first)
  const events = await db
    .select()
    .from(expenditureVerificationEventsTable)
    .where(
      eq(expenditureVerificationEventsTable.expenditureId, expenditureId),
    )
    .orderBy(desc(expenditureVerificationEventsTable.createdAt));

  return res.json({
    expenditureId,
    request: request ? formatVerificationRequest(request) : null,
    events: events.map(formatVerificationEvent),
  });
});

// ── POST /expenditures/:id/verification/approve ───────────────────────────────

router.post("/expenditures/:id/verification/approve", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const expenditureId = String(req.params.id);

  const [expRow] = await db
    .select({ exp: expendituresTable, projectName: projectsTable.name })
    .from(expendituresTable)
    .leftJoin(projectsTable, eq(projectsTable.id, expendituresTable.projectId))
    .where(
      and(
        eq(expendituresTable.id, expenditureId),
        eq(expendituresTable.isActive, true),
      ),
    )
    .limit(1);

  if (!expRow) return res.status(404).json({ error: "Expenditure not found" });

  const exp = expRow.exp;

  // Must be in verifiable state
  if (!["pending_review", "rejected"].includes(exp.verificationStatus)) {
    return res.status(400).json({
      error: `Cannot approve: current status is '${exp.verificationStatus}'.`,
    });
  }

  // Fetch the verification request
  const [request] = await db
    .select()
    .from(expenditureVerificationRequestsTable)
    .where(
      eq(expenditureVerificationRequestsTable.expenditureId, expenditureId),
    )
    .limit(1);

  if (!request) {
    return res.status(400).json({
      error:
        "No verification request found. Submit the expenditure first.",
    });
  }

  if (request.status === "approved") {
    return res.status(400).json({ error: "This expenditure is already approved." });
  }

  // ── Authorization: must be the designated verifier, have matching role, or be admin ──
  const isDesignatedVerifier =
    request.requiredVerifierId === actor.id;
  const hasMatchingRole =
    request.requiredVerifierRole === actor.role ||
    request.requiredVerifierRole === "admin";
  const isAdmin = actor.role === "admin";

  if (!isDesignatedVerifier && !hasMatchingRole && !isAdmin) {
    return res.status(403).json({
      error: `This expenditure requires verification by a ${request.requiredVerifierRole}. Your role (${actor.role}) is not authorised.`,
    });
  }

  // Prevent the submitter from verifying their own expenditure (unless admin)
  if (!isAdmin && exp.recordedById === actor.id) {
    return res.status(403).json({
      error:
        "You cannot verify your own expenditure. A different user must approve it.",
    });
  }

  const notes =
    typeof req.body?.notes === "string" ? req.body.notes : null;

  // Update expenditure
  const [updatedExp] = await db
    .update(expendituresTable)
    .set({
      verificationStatus: "approved",
      verifiedAt: new Date(),
      verifiedById: actor.id,
      verifiedByName: actor.displayName ?? null,
      verifierNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(expendituresTable.id, expenditureId))
    .returning();

  // Update verification request
  const [updatedRequest] = await db
    .update(expenditureVerificationRequestsTable)
    .set({
      status: "approved",
      resolvedAt: new Date(),
      resolvedById: actor.id,
      resolvedByName: actor.displayName ?? null,
      resolverNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(expenditureVerificationRequestsTable.id, request.id))
    .returning();

  // Write audit event
  await db.insert(expenditureVerificationEventsTable).values({
    expenditureId,
    verificationRequestId: request.id,
    eventType: "approved",
    actorId: actor.id,
    actorName: actor.displayName ?? "Unknown",
    actorRole: actor.role,
    notes: notes ?? null,
  });

  req.log.info({ expenditureId, actorId: actor.id }, "Expenditure approved");

  return res.json({
    expenditure: formatEntry(updatedExp, expRow.projectName ?? null),
    request: formatVerificationRequest(updatedRequest),
  });
});

// ── POST /expenditures/:id/verification/reject ────────────────────────────────

router.post("/expenditures/:id/verification/reject", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActingUser(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const expenditureId = String(req.params.id);

  const [expRow] = await db
    .select({ exp: expendituresTable, projectName: projectsTable.name })
    .from(expendituresTable)
    .leftJoin(projectsTable, eq(projectsTable.id, expendituresTable.projectId))
    .where(
      and(
        eq(expendituresTable.id, expenditureId),
        eq(expendituresTable.isActive, true),
      ),
    )
    .limit(1);

  if (!expRow) return res.status(404).json({ error: "Expenditure not found" });

  const exp = expRow.exp;

  if (exp.verificationStatus !== "pending_review") {
    return res.status(400).json({
      error: `Cannot reject: current status is '${exp.verificationStatus}'.`,
    });
  }

  const notes =
    typeof req.body?.notes === "string" ? req.body.notes : null;
  if (!notes) {
    return res
      .status(400)
      .json({ error: "Rejection notes are required." });
  }

  const [request] = await db
    .select()
    .from(expenditureVerificationRequestsTable)
    .where(
      eq(expenditureVerificationRequestsTable.expenditureId, expenditureId),
    )
    .limit(1);

  if (!request) {
    return res.status(400).json({
      error: "No verification request found for this expenditure.",
    });
  }

  // Authorization: same as approve
  const isDesignatedVerifier = request.requiredVerifierId === actor.id;
  const hasMatchingRole = request.requiredVerifierRole === actor.role || request.requiredVerifierRole === "admin";
  const isAdmin = actor.role === "admin";

  if (!isDesignatedVerifier && !hasMatchingRole && !isAdmin) {
    return res.status(403).json({
      error: `This expenditure requires verification by a ${request.requiredVerifierRole}. Your role (${actor.role}) is not authorised.`,
    });
  }

  if (!isAdmin && exp.recordedById === actor.id) {
    return res.status(403).json({
      error: "You cannot verify your own expenditure.",
    });
  }

  const [updatedExp] = await db
    .update(expendituresTable)
    .set({
      verificationStatus: "rejected",
      verifiedAt: new Date(),
      verifiedById: actor.id,
      verifiedByName: actor.displayName ?? null,
      verifierNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(expendituresTable.id, expenditureId))
    .returning();

  const [updatedRequest] = await db
    .update(expenditureVerificationRequestsTable)
    .set({
      status: "rejected",
      resolvedAt: new Date(),
      resolvedById: actor.id,
      resolvedByName: actor.displayName ?? null,
      resolverNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(expenditureVerificationRequestsTable.id, request.id))
    .returning();

  await db.insert(expenditureVerificationEventsTable).values({
    expenditureId,
    verificationRequestId: request.id,
    eventType: "rejected",
    actorId: actor.id,
    actorName: actor.displayName ?? "Unknown",
    actorRole: actor.role,
    notes,
  });

  req.log.info({ expenditureId, actorId: actor.id }, "Expenditure rejected");

  return res.json({
    expenditure: formatEntry(updatedExp, expRow.projectName ?? null),
    request: formatVerificationRequest(updatedRequest),
  });
});

// ── POST /expenditures/:id/verification/otp/request ───────────────────────────
// OTP placeholder — generates and stores a 6-digit code visible in the response

router.post(
  "/expenditures/:id/verification/otp/request",
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const expenditureId = String(req.params.id);

    const [request] = await db
      .select()
      .from(expenditureVerificationRequestsTable)
      .where(
        eq(expenditureVerificationRequestsTable.expenditureId, expenditureId),
      )
      .limit(1);

    if (!request) {
      return res.status(404).json({ error: "No verification request found." });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: `OTP can only be sent for pending requests. Current status: ${request.status}`,
      });
    }

    // Authorization: only the designated verifier or admin can request OTP
    const isDesignatedVerifier = request.requiredVerifierId === actor.id;
    const hasMatchingRole = request.requiredVerifierRole === actor.role;
    const isAdmin = actor.role === "admin";

    if (!isDesignatedVerifier && !hasMatchingRole && !isAdmin) {
      return res.status(403).json({ error: "You are not the designated verifier for this expenditure." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db
      .update(expenditureVerificationRequestsTable)
      .set({
        otpCode,
        otpSentAt: new Date(),
        otpExpiresAt: expiresAt,
        otpVerifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(expenditureVerificationRequestsTable.id, request.id));

    await db.insert(expenditureVerificationEventsTable).values({
      expenditureId,
      verificationRequestId: request.id,
      eventType: "otp_requested",
      actorId: actor.id,
      actorName: actor.displayName ?? "Unknown",
      actorRole: actor.role,
      notes: "OTP sent to verifier (placeholder — would be SMS in production)",
    });

    req.log.info({ expenditureId }, "Expenditure verification OTP requested (placeholder)");

    // Return code in dev mode (placeholder system)
    return res.json({
      otpCode,
      expiresAt: expiresAt.toISOString(),
    });
  },
);

// ── POST /expenditures/:id/verification/otp/confirm ───────────────────────────

router.post(
  "/expenditures/:id/verification/otp/confirm",
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActingUser(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const expenditureId = String(req.params.id);
    const { otpCode } = req.body as { otpCode?: string };

    if (!otpCode) {
      return res.status(400).json({ error: "otpCode is required." });
    }

    const [request] = await db
      .select()
      .from(expenditureVerificationRequestsTable)
      .where(
        eq(expenditureVerificationRequestsTable.expenditureId, expenditureId),
      )
      .limit(1);

    if (!request) {
      return res.status(404).json({ error: "No verification request found." });
    }

    if (!request.otpCode) {
      return res.status(400).json({
        error: "No OTP has been sent. Request an OTP first.",
      });
    }

    // Check expiry
    if (request.otpExpiresAt && request.otpExpiresAt < new Date()) {
      return res.status(400).json({
        error: "OTP has expired. Please request a new one.",
      });
    }

    if (request.otpCode !== otpCode) {
      return res.status(400).json({ error: "Incorrect OTP." });
    }

    // OTP confirmed — mark as verified and auto-approve
    const [expRow] = await db
      .select({ exp: expendituresTable, projectName: projectsTable.name })
      .from(expendituresTable)
      .leftJoin(projectsTable, eq(projectsTable.id, expendituresTable.projectId))
      .where(eq(expendituresTable.id, expenditureId))
      .limit(1);

    if (!expRow) return res.status(404).json({ error: "Expenditure not found" });

    const [updatedExp] = await db
      .update(expendituresTable)
      .set({
        verificationStatus: "approved",
        verifiedAt: new Date(),
        verifiedById: actor.id,
        verifiedByName: actor.displayName ?? null,
        verifierNotes: "Approved via OTP verification",
        updatedAt: new Date(),
      })
      .where(eq(expendituresTable.id, expenditureId))
      .returning();

    const [updatedRequest] = await db
      .update(expenditureVerificationRequestsTable)
      .set({
        status: "approved",
        otpVerifiedAt: new Date(),
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolvedByName: actor.displayName ?? null,
        resolverNotes: "Approved via OTP verification",
        updatedAt: new Date(),
      })
      .where(eq(expenditureVerificationRequestsTable.id, request.id))
      .returning();

    await db.insert(expenditureVerificationEventsTable).values({
      expenditureId,
      verificationRequestId: request.id,
      eventType: "otp_verified",
      actorId: actor.id,
      actorName: actor.displayName ?? "Unknown",
      actorRole: actor.role,
      notes: "OTP confirmed — expenditure auto-approved",
    });

    req.log.info({ expenditureId }, "Expenditure verification OTP confirmed");

    return res.json({
      expenditure: formatEntry(updatedExp, expRow.projectName ?? null),
      request: formatVerificationRequest(updatedRequest),
    });
  },
);

export default router;
