import pLimit from "p-limit";

/**
 * Loads a session's events from GET /api/sessions/[id]/snapshots in blocks,
 * modeled on PostHog's common/replay-headless/src/data-loader.ts: bounded
 * concurrency, retry with exponential backoff, ordered reassembly.
 */

const MAX_CONCURRENT_FETCHES = 6;
const MAX_BLOCK_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

export class DataLoadError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "DataLoadError";
    this.statusCode = statusCode;
    this.retryable = statusCode >= 500 || statusCode === 429;
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_BLOCK_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = err instanceof DataLoadError && err.retryable;
      if (!isRetryable || attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, INITIAL_RETRY_DELAY_MS * 2 ** attempt));
    }
  }
  throw lastError;
}

interface BlockResponse {
  events: unknown[];
  totalBlocks: number;
}

async function fetchBlock(sessionId: string, block: number): Promise<BlockResponse> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/snapshots?block=${block}`
  );
  if (!res.ok) {
    throw new DataLoadError(`Failed to fetch block ${block}: ${res.status}`, res.status);
  }
  return {
    events: await res.json(),
    totalBlocks: Number(res.headers.get("X-OpenLog-Total-Blocks") ?? 1),
  };
}

export async function loadSessionEvents(
  sessionId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<unknown[]> {
  // Block 0 first: its header tells us how many more to fetch.
  const first = await withRetry(() => fetchBlock(sessionId, 0));
  const { totalBlocks } = first;
  onProgress?.(1, totalBlocks);

  const blocks: unknown[][] = new Array(totalBlocks);
  blocks[0] = first.events;

  let loaded = 1;
  const limit = pLimit(MAX_CONCURRENT_FETCHES);
  await Promise.all(
    Array.from({ length: totalBlocks - 1 }, (_, i) => i + 1).map((n) =>
      limit(async () => {
        blocks[n] = (await withRetry(() => fetchBlock(sessionId, n))).events;
        onProgress?.(++loaded, totalBlocks);
      })
    )
  );

  return blocks.flat();
}
