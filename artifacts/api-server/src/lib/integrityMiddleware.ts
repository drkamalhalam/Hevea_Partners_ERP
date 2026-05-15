/**
 * integrityMiddleware.ts
 *
 * Reusable Express middleware helpers for audit and evidence integrity enforcement.
 *
 * Exports:
 *   requireProjectParam(paramKey?) — 403 if user cannot access req.params[paramKey]
 *   enforceWriteOnce(resourceLabel) — 405 factory for immutable / append-only resources
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * requireProjectParam — enforces project membership from a route parameter.
 * Must be applied AFTER requireAuth so req.canAccessAllProjects and
 * req.userProjectIds are populated.
 *
 * @param paramKey — name of the route param holding the project UUID (default: "projectId")
 */
export function requireProjectParam(paramKey = "projectId"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const projectId = Array.isArray(req.params[paramKey])
      ? (req.params[paramKey] as string[])[0]
      : (req.params[paramKey] as string | undefined);

    // If this route has no matching param, let the handler decide.
    if (!projectId) {
      next();
      return;
    }

    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // admin and developer always pass.
    if (req.canAccessAllProjects) {
      next();
      return;
    }

    if (!(req.userProjectIds ?? []).includes(projectId)) {
      req.log?.warn(
        { projectId, userId: req.dbUserId, userRole: req.userRole },
        "integrityMiddleware: project access denied",
      );
      res.status(403).json({ error: "Forbidden: not assigned to this project" });
      return;
    }

    next();
  };
}

/**
 * enforceWriteOnce — returns a 405 handler for any HTTP method that must
 * never mutate a write-once / append-only resource.
 *
 * Usage (on a router):
 *   router.delete("*", enforceWriteOnce("audit logs"));
 *   router.patch("*",  enforceWriteOnce("audit logs"));
 *
 * @param resourceLabel — human-readable name shown in the error response
 */
export function enforceWriteOnce(resourceLabel: string): RequestHandler {
  return (req: Request, res: Response): void => {
    req.log?.warn(
      { method: req.method, path: req.path, userId: req.dbUserId },
      `integrityMiddleware: write-once violation attempt on ${resourceLabel}`,
    );
    res.status(405).json({
      error: `${resourceLabel} are immutable — mutations are not permitted`,
      code: "WRITE_ONCE_VIOLATION",
    });
  };
}
