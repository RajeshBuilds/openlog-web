import { promises as fs } from "node:fs";
import path from "node:path";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage behind the app. R2 has no server-side append, so "append"
 * is modeled as numbered batch objects per session
 * (sessions/<id>/batch-<seq>.ndjson) that are listed and concatenated in
 * order on read. The fs impl mirrors the same layout so both backends are
 * interchangeable.
 */
export interface BlobObject {
  key: string;
  size: number;
}

export interface BlobStore {
  put(key: string, body: Uint8Array | string): Promise<void>;
  /** Writes one batch object for the session; returns the object key. */
  append(sessionId: string, seq: number, body: Uint8Array | string): Promise<string>;
  /** Byte range is inclusive on both ends, matching HTTP/S3 Range semantics. */
  getRange(key: string, range?: { start?: number; end?: number }): Promise<Uint8Array>;
  /** Keys under the prefix, in lexicographic (= batch) order. */
  list(prefix: string): Promise<string[]>;
  /** Like list, but with object sizes (for block planning without reads). */
  listObjects(prefix: string): Promise<BlobObject[]>;
  presignPut(key: string, opts?: { expiresInSeconds?: number; contentType?: string }): Promise<string>;
}

// Zero-padded so lexicographic listing order equals numeric batch order.
export function sessionBatchKey(sessionId: string, seq: number): string {
  return `${sessionPrefix(sessionId)}batch-${String(seq).padStart(6, "0")}.ndjson`;
}

export function sessionPrefix(sessionId: string): string {
  return `sessions/${sessionId}/`;
}

/** Reads every batch object of a session, concatenated in order. */
export async function readSessionBatches(store: BlobStore, sessionId: string): Promise<Uint8Array> {
  const keys = await store.list(sessionPrefix(sessionId));
  const parts = [];
  for (const key of keys) {
    parts.push(await store.getRange(key));
  }
  return Buffer.concat(parts);
}

class FsBlobStore implements BlobStore {
  constructor(private baseDir: string) {}

  private resolve(key: string): string {
    const abs = path.resolve(this.baseDir, key);
    if (!abs.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new Error(`Invalid blob key: ${key}`);
    }
    return abs;
  }

  async put(key: string, body: Uint8Array | string): Promise<void> {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  async append(sessionId: string, seq: number, body: Uint8Array | string): Promise<string> {
    const key = sessionBatchKey(sessionId, seq);
    await this.put(key, body);
    return key;
  }

  async getRange(key: string, range?: { start?: number; end?: number }): Promise<Uint8Array> {
    const data = await fs.readFile(this.resolve(key));
    if (!range) return data;
    const start = range.start ?? 0;
    const end = range.end ?? data.length - 1;
    return data.subarray(start, end + 1);
  }

  async list(prefix: string): Promise<string[]> {
    const root = path.resolve(this.baseDir);
    let entries;
    try {
      entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
      .filter((key) => key.startsWith(prefix))
      .sort();
  }

  async listObjects(prefix: string): Promise<BlobObject[]> {
    const keys = await this.list(prefix);
    return Promise.all(
      keys.map(async (key) => ({ key, size: (await fs.stat(this.resolve(key))).size }))
    );
  }

  async presignPut(): Promise<string> {
    throw new Error("presignPut is not supported by the fs blob backend; use BLOB_BACKEND=r2");
  }
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

class R2BlobStore implements BlobStore {
  private client: S3Client;
  private bucket: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Uint8Array | string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body })
    );
  }

  async append(sessionId: string, seq: number, body: Uint8Array | string): Promise<string> {
    const key = sessionBatchKey(sessionId, seq);
    await this.put(key, body);
    return key;
  }

  async getRange(key: string, range?: { start?: number; end?: number }): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range ? `bytes=${range.start ?? 0}-${range.end ?? ""}` : undefined,
      })
    );
    if (!res.Body) throw new Error(`Empty body for blob: ${key}`);
    return res.Body.transformToByteArray();
  }

  async list(prefix: string): Promise<string[]> {
    return (await this.listObjects(prefix)).map((o) => o.key);
  }

  async listObjects(prefix: string): Promise<BlobObject[]> {
    const objects: BlobObject[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) objects.push({ key: obj.Key, size: obj.Size ?? 0 });
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  async presignPut(
    key: string,
    opts?: { expiresInSeconds?: number; contentType?: string }
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: opts?.contentType ?? "application/x-ndjson",
      }),
      { expiresIn: opts?.expiresInSeconds ?? 600 }
    );
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createBlobStore(
  backend: string = process.env.BLOB_BACKEND ?? "fs"
): BlobStore {
  switch (backend) {
    case "fs":
      return new FsBlobStore(process.env.BLOB_FS_DIR ?? ".data/blobs");
    case "r2":
      return new R2BlobStore({
        accountId: requireEnv("R2_ACCOUNT_ID"),
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
        bucket: requireEnv("R2_BUCKET"),
      });
    default:
      throw new Error(`Unknown BLOB_BACKEND: ${backend} (expected "fs" or "r2")`);
  }
}
