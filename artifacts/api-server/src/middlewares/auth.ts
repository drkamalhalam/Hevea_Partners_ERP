import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, userProjectAssignmentsTable, userSessionsTable, userLoginAuditTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Session deduplication ──────────────────────────────────────────────────────
// In-memory map: dbUserId → timestamp of last recorded session.
// Prevents inserting a row on every request — records at most once per hour.
const _sessionRecordedAt = new Map<string, number>();

function _recordSession(
  req: Request,
  dbUserId: string,
  clerkUserId: string,
  displayName: string | null,
  role: string,
): void {
  const now = Date.now();
  const last = _sessionRecordedAt.get(dbUserId);
  if (last && now - last < 3_600_000) return; // already recorded within 1 h
  _sessionRecordedAt.set(dbUserId, now);

  // Record session (fire-and-forget)
  db.insert(userSessionsTable)
    .values({
      userId: dbUserId,
      clerkUserId,
      displayName,
      userRole: role,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    .catch(() => {});

  // Update lastLoginAt and write login_recorded audit event (fire-and-forget)
  db.update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, dbUserId))
    .catch(() => {});

  db.insert(userLoginAuditTable)
    .values({
      userId: dbUserId,
      eventType: "login_recorded",
      performedBy: dbUserId,
      notes: `Session from ${req.ip ?? "unknown IP"}`,
    })
    .catch(() => {});
}

export type UserRoleEnum =
  | "admin"
  | "developer"
  | "landowner"
  | "investor"
  | "employee"
  | "operational_staff";

export interface DbUser {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  loginStatus: string | null;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      dbUserId?: string; // UUID from users table, set by requireAuth
      dbUser?: DbUser;   // Full user row subset, set by requireAuth
      userRole?: UserRoleEnum;
      userProjectIds?: string[];
      canAccessAllProjects?: boolean;
    }
  }
}

/**
 * requireAuth — verifies Clerk JWT, then loads role + project assignments from DB.
 * Attaches req.userId, req.userRole, req.userProjectIds, req.canAccessAllProjects.
 * Returns 401 if unauthenticated OR if the account is not provisioned/active.
 *
 * Security: removed the unsafe default 'employee' fallback. Any Clerk user
 * without a properly provisioned and active DB record receives 401.
 *
 * Two-step project-assignment lookup:
 *   1. Resolve users.id (UUID) from clerkUserId
 *   2. Fetch user_project_assignments by userId FK
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // If the global middleware already ran and set req.userId, skip re-verification.
  if (req.userId) {
    next();
    return;
  }

  let userId: string | null = null;
  if (process.env.MOCK_AUTH === "true") {
    // Read the mock Clerk user ID from the Bearer token or Authorization header
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      userId = authHeader.substring(7);
    }
    // Fallback default mock user if missing
    if (!userId) {
      userId = "user_sample_admin";
    }
  } else {
    const auth = getAuth(req);
    userId = auth.userId;
  }

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;

  try {
    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, userId))
      .limit(1);

    if (!userRow) {
      // No DB record — account not provisioned. Fail secure.
      res.status(401).json({
        error: "Account not provisioned. Contact your administrator.",
        loginStatus: "not_provisioned",
      });
      return;
    }

    // ── Login status gate ────────────────────────────────────────────────
    if (userRow.loginStatus !== "active") {
      const messages: Record<string, string> = {
        pending_activation: "Account pending activation. Contact your administrator.",
        suspended: "Account suspended. Contact your administrator.",
        archived: "Account has been archived.",
      };
      res.status(401).json({
        error: messages[userRow.loginStatus] ?? "Account access restricted.",
        loginStatus: userRow.loginStatus,
      });
      return;
    }

    // ── Legacy suspension check (backwards compatibility) ────────────────
    if (!userRow.isActive) {
      res.status(401).json({
        error: "Account suspended. Contact your administrator.",
        loginStatus: "suspended",
      });
      return;
    }

    if (userRow.deletedAt) {
      res.status(401).json({
        error: "Account has been archived.",
        loginStatus: "archived",
      });
      return;
    }

    const assignments = await db
      .select()
      .from(userProjectAssignmentsTable)
      .where(eq(userProjectAssignmentsTable.userId, userRow.id));

    req.dbUserId = userRow.id;
    req.dbUser = {
      id: userRow.id,
      displayName: userRow.displayName,
      email: userRow.email,
      role: userRow.role,
      loginStatus: userRow.loginStatus,
    };
    req.userRole = (userRow.role ?? "employee") as UserRoleEnum;
    req.userProjectIds = assignments
      .filter((a) => !a.revokedAt)
      .map((a) => a.projectId);

    // Record login session (fire-and-forget, de-duped per hour)
    _recordSession(req, userRow.id, userId, userRow.displayName ?? null, userRow.role ?? "employee");

    req.canAccessAllProjects =
      req.userRole === "admin" || req.userRole === "developer";

    next();
  } catch (err) {
    req.log?.error({ err }, "Failed to load user profile in auth middleware");
    // Fail secure — do NOT silently assign a default role on DB errors
    res.status(401).json({ error: "Authentication error. Please try again." });
  }
}

/**
 * requireRole — returns middleware that enforces at least one of the given roles.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: UserRoleEnum[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.userRole || !roles.includes(req.userRole)) {
      res
        .status(403)
        .json({ error: `Forbidden: requires ${roles.join(" or ")} role` });
      return;
    }
    next();
  };
}

/**
 * requireFinancialRole — pre-built middleware for sensitive financial data endpoints.
 * Permits admin, developer, and landowner. Blocks investor, employee, operational_staff.
 * Must be used after requireAuth.
 */
export const requireFinancialRole = requireRole("admin", "developer", "landowner");

/**
 * canAccessProject — inline helper used in route handlers.
 * Returns true if the user can access the given project (UUID string).
 */
export function canAccessProject(req: Request, projectId: string): boolean {
  return (
    req.canAccessAllProjects === true ||
    (req.userProjectIds ?? []).includes(projectId)
  );
}
