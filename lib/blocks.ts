import type { RRMobileEvent } from "./ingest";
import { getStorage, sessionPrefix } from "./storage";

/**
 * Block model for serving snapshots (SPEC T3), following PostHog's
 * snapshot-source idea: the player fetches bounded blocks, never one giant
 * payload, so responses stay under Vercel's 4.5 MB cap.
 *
 * A block usually maps 1:1 to a stored batch object (already capped at
 * ~3.5 MB on direct ingest). Batches that arrived oversized via the R2
 * presign path are split into multiple blocks by line, deterministically,
 * so block N always has the same content.
 */
const BLOCK_TARGET_BYTES = 3 * 1024 * 1024;

interface BlockRef {
  key: string;
  /** Which slice of the object this block is (0-based). */
  subIndex: number;
  /** How many blocks the object is split into (usually 1). */
  subCount: number;
}

export interface BlockIndex {
  totalBlocks: number;
  blocks: BlockRef[];
}

export async function getBlockIndex(sessionId: string): Promise<BlockIndex> {
  const objects = await getStorage().blobs.listObjects(sessionPrefix(sessionId));
  const blocks: BlockRef[] = [];
  for (const { key, size } of objects) {
    const subCount = Math.max(1, Math.ceil(size / BLOCK_TARGET_BYTES));
    for (let subIndex = 0; subIndex < subCount; subIndex++) {
      blocks.push({ key, subIndex, subCount });
    }
  }
  return { totalBlocks: blocks.length, blocks };
}

export async function readBlock(
  sessionId: string,
  index: BlockIndex,
  blockN: number
): Promise<RRMobileEvent[]> {
  const ref = index.blocks[blockN];
  if (!ref) throw new RangeError(`Block ${blockN} out of range (0..${index.totalBlocks - 1})`);

  const raw = Buffer.from(await getStorage().blobs.getRange(ref.key)).toString("utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const slice = ref.subCount === 1 ? lines : partition(lines, ref.subCount)[ref.subIndex];
  return slice.map((line) => JSON.parse(line) as RRMobileEvent);
}

/**
 * Splits lines into `parts` contiguous buckets of roughly equal byte size.
 * Purely a function of (lines, parts) so the split is stable across reads.
 */
function partition(lines: string[], parts: number): string[][] {
  const totalBytes = lines.reduce((sum, l) => sum + Buffer.byteLength(l) + 1, 0);
  const buckets: string[][] = Array.from({ length: parts }, () => []);
  let bucket = 0;
  let consumed = 0;
  for (const line of lines) {
    consumed += Buffer.byteLength(line) + 1;
    buckets[bucket].push(line);
    // Move on once this bucket's fair share of bytes is consumed, but never
    // leave later buckets without lines to take.
    if (consumed >= ((bucket + 1) * totalBytes) / parts && bucket < parts - 1) {
      bucket++;
    }
  }
  return buckets;
}
