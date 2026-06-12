import { getBlockIndex, readBlock } from "@/lib/blocks";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/sessions/[id]/snapshots?block=N
 *
 * Returns event block N (0-based) as a JSON array, with
 * X-OpenLog-Total-Blocks so the player knows how many blocks to stream.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const session = await getStorage().sessions.get(id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const blockParam = new URL(req.url).searchParams.get("block");
  const blockN = blockParam ? Number(blockParam) : 0;
  if (!Number.isInteger(blockN) || blockN < 0) {
    return Response.json({ error: "block must be a non-negative integer" }, { status: 400 });
  }

  const index = await getBlockIndex(id);
  if (blockN >= index.totalBlocks) {
    return Response.json(
      { error: `Block ${blockN} out of range`, totalBlocks: index.totalBlocks },
      { status: 404 }
    );
  }

  const events = await readBlock(id, index, blockN);
  return Response.json(events, {
    headers: {
      "X-OpenLog-Block": String(blockN),
      "X-OpenLog-Total-Blocks": String(index.totalBlocks),
      "Cache-Control": "private, max-age=60",
    },
  });
}
