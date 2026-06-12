import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

// Read side is stubbed open for now; real app auth/RBAC lands later (SPEC Part 5).
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return Response.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  const { items, nextCursor } = await getStorage().sessions.list({ cursor, limit });
  return Response.json({
    items: items.map((s) => ({
      id: s.id,
      appId: s.appId,
      sdkVersion: s.sdkVersion,
      device: s.device,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: s.durationMs,
      eventCount: s.eventCount,
      screenCount: s.screenCount,
    })),
    nextCursor,
  });
}
