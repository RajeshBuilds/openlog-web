import type { Prisma } from "./generated/prisma/client";
import { validateEvent } from "./schema/validateEvent";
import { getStorage, sessionBatchKey, sessionPrefix } from "./storage";

/**
 * Shared ingest pipeline used by POST /api/ingest (direct upload) and
 * POST /api/ingest/commit (large-batch path via R2 presigned PUT).
 *
 * Vercel hard-caps function bodies at 4.5 MB; we enforce ~3.5 MB so the SDK
 * has clear guidance and headroom. Larger batches must use the presign path,
 * which bypasses the function body entirely.
 */
export const MAX_BATCH_BYTES = 3.5 * 1024 * 1024;

/** rr-mobile event: schema validation happens via validateEvent, not types. */
export interface RRMobileEvent {
  type: number;
  timestamp: number;
  data?: unknown;
}

const META_EVENT_TYPE = 4; // rrweb EventType.Meta — one per screen/navigation

export class IngestError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>
  ) {
    super(JSON.stringify(body));
  }
}

export function checkAuth(req: Request): void {
  const token = process.env.INGEST_TOKEN;
  if (!token) {
    throw new IngestError(500, { error: "INGEST_TOKEN is not configured" });
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    throw new IngestError(401, { error: "Invalid or missing bearer token" });
  }
}

/**
 * Reads the request body without buffering past the batch cap, then parses
 * NDJSON (or a JSON array when Content-Type is application/json).
 */
export async function readEvents(req: Request): Promise<RRMobileEvent[]> {
  if (!req.body) throw new IngestError(400, { error: "Empty body" });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BATCH_BYTES) {
    throw new IngestError(413, { error: "Batch too large", maxBatchBytes: MAX_BATCH_BYTES });
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BATCH_BYTES) {
      await reader.cancel();
      throw new IngestError(413, { error: "Batch too large", maxBatchBytes: MAX_BATCH_BYTES });
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new IngestError(400, { error: "Body is not valid JSON" });
    }
    if (!Array.isArray(parsed)) {
      throw new IngestError(400, { error: "JSON body must be an array of events" });
    }
    return validateAll(parsed);
  }
  return validateAll(parseNdjson(text));
}

function parseNdjson(text: string): unknown[] {
  const events: unknown[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new IngestError(400, { error: "Invalid JSON on NDJSON line", index });
    }
  }
  return events;
}

export function validateAll(events: unknown[]): RRMobileEvent[] {
  if (events.length === 0) throw new IngestError(400, { error: "No events in batch" });
  for (const [index, event] of events.entries()) {
    const { valid, error } = validateEvent(event);
    if (!valid) {
      throw new IngestError(400, { error: `Invalid event: ${error}`, index });
    }
  }
  return events as RRMobileEvent[];
}

export interface BatchContext {
  sessionId: string;
  appId: string;
  sdkVersion: string;
  device: Prisma.InputJsonObject;
  /** SDK-provided sequence number for idempotency; derived when absent. */
  batchSeq?: number;
}

export interface BatchResult {
  sessionId: string;
  received: number;
  duplicate?: boolean;
}

export function batchContextFromHeaders(req: Request): BatchContext {
  const sessionId = req.headers.get("x-openlog-session-id");
  if (!sessionId || !/^[\w.-]+$/.test(sessionId)) {
    throw new IngestError(400, { error: "Missing or invalid X-OpenLog-Session-Id header" });
  }
  let device: Prisma.InputJsonObject = {};
  const deviceHeader = req.headers.get("x-openlog-device");
  if (deviceHeader) {
    try {
      device = JSON.parse(deviceHeader);
    } catch {
      throw new IngestError(400, { error: "X-OpenLog-Device header is not valid JSON" });
    }
  }
  const seqHeader = req.headers.get("x-openlog-batch-seq");
  return {
    sessionId,
    appId: req.headers.get("x-openlog-app") ?? "unknown",
    sdkVersion: req.headers.get("x-openlog-sdk") ?? "unknown",
    device,
    batchSeq: seqHeader ? Number(seqHeader) : undefined,
  };
}

/**
 * Appends one validated batch to the session blob and folds its stats into
 * the session row (created on first batch). Dedupes on (sessionId, batchSeq).
 */
export async function processBatch(
  ctx: BatchContext,
  events: RRMobileEvent[]
): Promise<BatchResult> {
  const storage = getStorage();
  const existingKeys = await storage.blobs.list(sessionPrefix(ctx.sessionId));
  const seq = ctx.batchSeq ?? existingKeys.length + 1;

  if (existingKeys.includes(sessionBatchKey(ctx.sessionId, seq))) {
    return { sessionId: ctx.sessionId, received: 0, duplicate: true };
  }

  const ndjson = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await storage.blobs.append(ctx.sessionId, seq, ndjson);
  return registerBatchMetadata(ctx, events);
}

/** Metadata-only half of ingest, shared with the commit route. */
export async function registerBatchMetadata(
  ctx: BatchContext,
  events: RRMobileEvent[]
): Promise<BatchResult> {
  const storage = getStorage();
  const timestamps = events.map((e) => e.timestamp);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);

  const session = await storage.sessions.upsert({
    id: ctx.sessionId,
    appId: ctx.appId,
    sdkVersion: ctx.sdkVersion,
    device: ctx.device,
    startedAt: new Date(minTs),
    blobKey: sessionPrefix(ctx.sessionId),
  });

  await storage.sessions.recordBatch(ctx.sessionId, {
    addEvents: events.length,
    addScreens: events.filter((e) => e.type === META_EVENT_TYPE).length,
    endedAt: new Date(maxTs),
    durationMs: Math.max(0, maxTs - session.startedAt.getTime()),
  });

  return { sessionId: ctx.sessionId, received: events.length };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof IngestError) {
    return Response.json(err.body, { status: err.status });
  }
  // Never echo raw event bodies into logs — message only.
  console.error("ingest error:", err instanceof Error ? err.message : String(err));
  return Response.json({ error: "Internal error" }, { status: 500 });
}
