import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT =
  process.env.REPLIT_SIDECAR_ENDPOINT ?? "http://127.0.0.1:1106";

export const objectStorageClient =
  process.env.MOCK_STORAGE === "true"
    ? (null as any)
    : new Storage({
        credentials: {
          audience: "replit",
          subject_token_type: "access_token",
          token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
          type: "external_account",
          credential_source: {
            url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
            format: {
              type: "json",
              subject_token_field_name: "access_token",
            },
          },
          universe_domain: "googleapis.com",
        },
        projectId: "",
      });

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ── Mock File Interface for Local Storage ─────────────────────────────────────
export class MockFile {
  name: string;
  localPath: string;

  constructor(name: string, localPath: string) {
    this.name = name;
    this.localPath = localPath;
  }

  createReadStream() {
    return fs.createReadStream(this.localPath);
  }

  async exists(): Promise<[boolean]> {
    return [fs.existsSync(this.localPath)];
  }

  async getMetadata(): Promise<[any]> {
    if (!fs.existsSync(this.localPath)) {
      throw new ObjectNotFoundError();
    }
    const stats = fs.statSync(this.localPath);
    const ext = path.extname(this.name).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".docx") {
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (ext === ".pdf") {
      contentType = "application/pdf";
    }
    return [{
      contentType,
      size: stats.size
    }];
  }
}

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

export class ObjectStorageService {
  constructor() {
    if (process.env.MOCK_STORAGE === "true") {
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
    }
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0 && process.env.MOCK_STORAGE !== "true") {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths.length > 0 ? paths : ["public"];
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir && process.env.MOCK_STORAGE !== "true") {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir || "private";
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (process.env.MOCK_STORAGE === "true") {
      const publicPaths = this.getPublicObjectSearchPaths();
      for (const sp of publicPaths) {
        const fullLocalPath = path.join(UPLOADS_DIR, sp, filePath);
        if (fs.existsSync(fullLocalPath)) {
          return new MockFile(`${sp}/${filePath}`, fullLocalPath) as any;
        }
      }
      return null;
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    if (process.env.MOCK_STORAGE === "true") {
      const mockFile = file as any as MockFile;
      const [metadata] = await mockFile.getMetadata();
      const nodeStream = mockFile.createReadStream();
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      const headers: Record<string, string> = {
        "Content-Type": metadata.contentType,
        "Cache-Control": `private, max-age=${cacheTtlSec}`,
      };
      if (metadata.size) {
        headers["Content-Length"] = String(metadata.size);
      }
      return new Response(webStream, { headers });
    }

    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();

    if (process.env.MOCK_STORAGE === "true") {
      // Return local server upload endpoint
      const port = process.env.PORT || "5000";
      return `http://localhost:${port}/api/storage/local-upload/${objectId}`;
    }

    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();

    if (process.env.MOCK_STORAGE === "true") {
      const fullLocalPath = path.join(UPLOADS_DIR, entityDir, entityId);
      if (!fs.existsSync(fullLocalPath)) {
        throw new ObjectNotFoundError();
      }
      return new MockFile(entityId, fullLocalPath) as any;
    }

    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (process.env.MOCK_STORAGE === "true") {
      // Local URLs look like http://localhost:5000/api/storage/local-upload/UUID
      // or similar relative paths.
      if (rawPath.includes("/api/storage/local-upload/")) {
        const parts = rawPath.split("/local-upload/");
        const uuid = parts[parts.length - 1];
        return `/objects/uploads/${uuid}`;
      }
      return rawPath;
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    if (process.env.MOCK_STORAGE === "true") {
      // Mock ACL operations on local files
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  /**
   * Upload a Buffer directly to a private object storage path.
   * Returns the normalised /objects/... path for DB storage.
   */
  async saveBuffer(
    buffer: Buffer,
    contentType: string,
    filename: string,
  ): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();

    if (process.env.MOCK_STORAGE === "true") {
      const generatedSubdir = path.join(UPLOADS_DIR, privateObjectDir, "generated", objectId);
      fs.mkdirSync(generatedSubdir, { recursive: true });
      const fullLocalPath = path.join(generatedSubdir, filename);
      fs.writeFileSync(fullLocalPath, buffer);
      return `/objects/generated/${objectId}/${filename}`;
    }

    const fullPath = `${privateObjectDir}/generated/${objectId}/${filename}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType, resumable: false });
    return `/objects/generated/${objectId}/${filename}`;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (process.env.MOCK_STORAGE === "true") {
      return true;
    }
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}

