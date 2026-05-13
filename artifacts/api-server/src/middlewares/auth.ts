import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type UserRoleEnum =
  | "admin"
  | "developer"
  | "landowner"
  | "investor"
  | "employee"
  | "operational_staff";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
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

      req.userRole = (userRow.role ?? "employee") as UserRoleEnum;
      req.userProjectIds = assignments
        .filter((a) => !a.revokedAt)
        .map((a) => a.projectId);
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
 * canAccessProject — inline helper used in route handlers.
 * Returns true if the user can access the given project (UUID string).
 */
export function canAccessProject(req: Request, projectId: string): boolean {
  return (
    req.canAccessAllProjects === true ||
    (req.userProjectIds ?? []).includes(projectId)
  );
}
