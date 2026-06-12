import {
  batchContextFromHeaders,
  checkAuth,
  errorResponse,
  processBatch,
  readEvents,
} from "@/lib/ingest";

// AWS SDK (R2) requires the Node runtime — never Edge (see SPEC Part 5).
export const runtime = "nodejs";
// Streaming + validating a full 3.5 MB batch can outlast Vercel's default.
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  try {
    checkAuth(req);
    const ctx = batchContextFromHeaders(req);
    const events = await readEvents(req);
    const result = await processBatch(ctx, events);
    return Response.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
