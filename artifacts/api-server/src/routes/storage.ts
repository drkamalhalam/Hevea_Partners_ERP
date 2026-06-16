import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  db,
  usersTable,
  expendituresTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities from PRIVATE_OBJECT_DIR.
 *
 * Security model:
 *   1. Clerk authentication required — anonymous access denied.
 *   2. Invoice files are project-scoped: the requesting user must be
 *      assigned to the project that owns the invoice, or be admin/developer.
 *   3. All other private objects (templates, generated documents) are
 *      accessible to any authenticated user — the GCS UUID paths are
 *      non-discoverable, so authentication is the primary gate.
 */
router.get("/objects/*path", async (req: Request, res: Response) => {
  // ── Step 1: Require Clerk authentication ────────────────────────────────
  let clerkUserId: string | null = null;
  if (process.env.MOCK_AUTH === "true") {
    clerkUserId = (req.headers["x-mock-user-id"] as string) || "user_sample_admin";
  } else {
    clerkUserId = getAuth(req).userId;
  }

  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.clerkUserId, clerkUserId),
        eq(usersTable.isActive, true),
      ),
    )
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // ── Step 2: Project-level access check for invoice files ────────────────
    // If this path is stored as an invoice on any expenditure, the requesting
    // user must have project access to that expenditure's project.
    if (user.role !== "admin" && user.role !== "developer") {
      const [invoiceRow] = await db
        .select({ projectId: expendituresTable.projectId })
        .from(expendituresTable)
        .where(eq(expendituresTable.invoiceObjectPath, objectPath))
        .limit(1);

      if (invoiceRow) {
        // Invoice found — verify project assignment
        const [assignment] = await db
          .select({ projectId: userProjectAssignmentsTable.projectId })
          .from(userProjectAssignmentsTable)
          .where(
            and(
              eq(userProjectAssignmentsTable.userId, user.id),
              eq(userProjectAssignmentsTable.projectId, invoiceRow.projectId),
            ),
          )
          .limit(1);

        if (!assignment) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
      // Non-invoice objects: any authenticated user may access.
      // Templates and generated agreement docs are served to authenticated
      // users — paths are non-guessable GCS UUIDs.
    }

    // ── Step 3: Serve the file ───────────────────────────────────────────────
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * PUT /storage/local-upload/:objectId
 *
 * Dev-only local upload endpoint for mock storage.
 * Reads the request binary stream and saves it to ./uploads/private/uploads/:objectId.
 */
router.put("/local-upload/:objectId", async (req: Request, res: Response) => {
  if (process.env.MOCK_STORAGE !== "true") {
    res.status(403).json({ error: "Local upload only allowed when MOCK_STORAGE is true" });
    return;
  }
  try {
    const objectId = Array.isArray(req.params.objectId)
      ? req.params.objectId[0]
      : req.params.objectId;
    const fs = await import("fs");
    const path = await import("path");
    const privateObjectDir = objectStorageService.getPrivateObjectDir();

    // We write to ./uploads/private/uploads/:objectId
    const uploadDir = path.resolve(process.cwd(), "uploads", privateObjectDir, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, objectId);
    const writeStream = fs.createWriteStream(filePath);

    req.pipe(writeStream);

    req.on("end", () => {
      res.status(200).json({ success: true, objectPath: `/objects/uploads/${objectId}` });
    });

    req.on("error", (err) => {
      req.log.error({ err }, "Upload write failed");
      res.status(500).json({ error: "Write failed" });
    });
  } catch (error) {
    req.log.error({ err: error }, "Local upload failed");
    res.status(500).json({ error: "Local upload failed" });
  }
});

export default router;
