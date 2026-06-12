import { checkAuth, errorResponse, IngestError } from "@/lib/ingest";
import { getStorage, sessionBatchKey, sessionPrefix } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Large-batch path, step 1 of 2: returns a presigned PUT URL so the SDK can
 * upload an oversized NDJSON batch directly to R2, bypassing Vercel's
 * 4.5 MB function body cap. Step 2 is POST /api/ingest/commit.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    checkAuth(req);
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "string" || !/^[\w.-]+$/.test(sessionId)) {
      throw new IngestError(400, { error: "Missing or invalid sessionId" });
    }

    const storage = getStorage();
    const batchSeq =
      typeof body.batchSeq === "number"
        ? body.batchSeq
        : (await storage.blobs.list(sessionPrefix(sessionId))).length + 1;
    const objectKey = sessionBatchKey(sessionId, batchSeq);

    let url: string;
    try {
      url = await storage.blobs.presignPut(objectKey, {
        contentType: "application/x-ndjson",
      });
    } catch (err) {
      throw new IngestError(501, {
        error: err instanceof Error ? err.message : "presign unavailable",
      });
    }

    return Response.json({ url, objectKey, batchSeq }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
