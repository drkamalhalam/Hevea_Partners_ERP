import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, userRolesTable, userProjectAssignmentsTable } from "@workspace/db";
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
      userProjectIds?: number[];
      canAccessAllProjects?: boolean;
    }
  }
}

/**
 * requireAuth — verifies Clerk JWT, then loads role + project assignments from DB.
 * Attaches req.userId, req.userRole, req.userProjectIds, req.canAccessAllProjects.
 * Returns 401 if unauthenticated.
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
    const [roleRow] = await db
      .select()
      .from(userRolesTable)
      .where(eq(userRolesTable.clerkUserId, userId))
      .limit(1);

    const assignments = await db
      .select()
      .from(userProjectAssignmentsTable)
      .where(eq(userProjectAssignmentsTable.clerkUserId, userId));

    req.userRole = (roleRow?.role ?? "employee") as UserRoleEnum;
    req.userProjectIds = assignments.map((a) => a.projectId);
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
 * canAccessProject — helper used inline in route handlers.
 * Returns true if the user can access the given project.
 */
export function canAccessProject(req: Request, projectId: number): boolean {
  return (
    req.canAccessAllProjects === true ||
    (req.userProjectIds ?? []).includes(projectId)
  );
}
