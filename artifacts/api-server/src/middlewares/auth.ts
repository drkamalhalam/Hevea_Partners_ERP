import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, userProjectAssignmentsTable, userSessionsTable } from "@workspace/db";
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

  db.insert(userSessionsTable)
    .values({
      userId: dbUserId,
      clerkUserId,
      displayName,
      userRole: role,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    .catch(() => {}); // fire-and-forget — never blocks the request
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
 * Returns 401 if unauthenticated.
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
  // Calling getAuth(req) a second time inside an async context can return null in
  // Clerk v5 when the AsyncLocalStorage context has shifted (e.g. inside a new
  // Promise chain created by the route handler).
  if (req.userId) {
    next();
    return;
  }

  const { userId } = getAuth(req);
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

    if (userRow) {
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
      };
      req.userRole = (userRow.role ?? "employee") as UserRoleEnum;
      req.userProjectIds = assignments
        .filter((a) => !a.revokedAt)
        .map((a) => a.projectId);

      // Record login session (fire-and-forget, de-duped per hour)
      _recordSession(req, userRow.id, userId, userRow.displayName ?? null, userRow.role ?? "employee");
    } else {
      req.userRole = "employee";
      req.userProjectIds = [];
    }

    req.canAccessAllProjects =
      req.userRole === "admin" || req.userRole === "developer";
  } catch (err) {
    req.log?.error({ err }, "Failed to load user profile in auth middleware");
    req.userRole = "employee";
    req.userProjectIds = [];
    req.canAccessAllProjects = false;
  }

  next();
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
