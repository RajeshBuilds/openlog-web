import {
  batchContextFromHeaders,
  checkAuth,
  errorResponse,
  IngestError,
  registerBatchMetadata,
  validateAll,
} from "@/lib/ingest";
import { getStorage, sessionPrefix } from "@/lib/storage";

export const runtime = "nodejs";
// Commit reads + validates a presign-uploaded batch from R2, which can be
// well over the direct-ingest cap — give it the most headroom.
export const maxDuration = 60;

/**
 * Large-batch path, step 2 of 2: after the SDK PUTs the batch to the
 * presigned URL, this validates the uploaded object and registers it in the
 * session's metadata. The object was uploaded directly to its final batch
 * key, so no copy is needed.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    checkAuth(req);
    const ctx = batchContextFromHeaders(req);
    const body = await req.json().catch(() => null);
    const objectKey = body?.objectKey;
    if (typeof objectKey !== "string") {
      throw new IngestError(400, { error: "Missing objectKey" });
    }
    if (body?.sessionId !== ctx.sessionId || !objectKey.startsWith(sessionPrefix(ctx.sessionId))) {
      throw new IngestError(400, { error: "objectKey does not belong to sessionId" });
    }

    let raw: Uint8Array;
    try {
      raw = await getStorage().blobs.getRange(objectKey);
    } catch {
      throw new IngestError(404, { error: "Uploaded object not found", objectKey });
    }

    const lines = Buffer.from(raw).toString("utf8").split("\n").filter((l) => l.trim());
    const parsed: unknown[] = [];
    for (const [index, line] of lines.entries()) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        throw new IngestError(400, { error: "Invalid JSON on NDJSON line", index });
      }
    }
    const events = validateAll(parsed);

    const result = await registerBatchMetadata(ctx, events);
    return Response.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
