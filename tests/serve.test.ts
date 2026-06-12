import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "test-serve-token";
const IDS = ["test-serve-a", "test-serve-b", "test-serve-c"] as const;
const FIXTURE_LINES = readFileSync("fixtures/sample-05.ndjson", "utf8").trim().split("\n");

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "openlog-serve-"));
  process.env.BLOB_FS_DIR = dir;
  process.env.BLOB_BACKEND = "fs";
  process.env.INGEST_TOKEN = TOKEN;

  const { getPrisma } = await import("../lib/storage/prismaRepo");
  await getPrisma().session.deleteMany({ where: { id: { in: [...IDS] } } });

  // Seed three sessions through the real ingest pipeline; session "a" gets
  // two batches so the snapshot route has multiple blocks to serve.
  const { POST } = await import("../app/api/ingest/route");
  const batches: Array<[string, number, string[]]> = [
    [IDS[0], 1, FIXTURE_LINES.slice(0, 40)],
    [IDS[0], 2, FIXTURE_LINES.slice(40)],
    [IDS[1], 1, FIXTURE_LINES.slice(0, 10)],
    [IDS[2], 1, FIXTURE_LINES.slice(0, 10)],
  ];
  for (const [sessionId, seq, lines] of batches) {
    const res = await POST(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        body: lines.join("\n") + "\n",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/x-ndjson",
          "x-openlog-session-id": sessionId,
          "x-openlog-app": "com.example.app",
          "x-openlog-sdk": "0.1.0",
          "x-openlog-batch-seq": String(seq),
        },
      })
    );
    expect(res.status).toBe(202);
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  const { getPrisma } = await import("../lib/storage/prismaRepo");
  await getPrisma().session.deleteMany({ where: { id: { in: [...IDS] } } });
  await getPrisma().$disconnect();
});

describe("GET /api/sessions", () => {
  it("lists sessions with the spec'd fields", async () => {
    const { GET } = await import("../app/api/sessions/route");
    const res = await GET(new Request("http://localhost/api/sessions"));
    expect(res.status).toBe(200);
    const { items } = await res.json();
    const session = items.find((s: { id: string }) => s.id === IDS[0]);
    expect(session).toMatchObject({
      appId: "com.example.app",
      eventCount: FIXTURE_LINES.length,
    });
    expect(session.startedAt).toBeTruthy();
    expect(session.durationMs).toBeGreaterThan(0);
  });

  it("paginates with cursor + limit", async () => {
    const { GET } = await import("../app/api/sessions/route");
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `http://localhost/api/sessions?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await GET(new Request(url));
      const body = await res.json();
      expect(body.items.length).toBeLessThanOrEqual(2);
      for (const s of body.items) {
        expect(seen.has(s.id)).toBe(false); // no overlap between pages
        seen.add(s.id);
      }
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 20);
    for (const id of IDS) expect(seen.has(id)).toBe(true);
  });

  it("rejects a bad limit", async () => {
    const { GET } = await import("../app/api/sessions/route");
    const res = await GET(new Request("http://localhost/api/sessions?limit=zero"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/[id]", () => {
  it("returns metadata", async () => {
    const { GET } = await import("../app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: IDS[0] }),
    });
    expect(res.status).toBe(200);
    const session = await res.json();
    expect(session.id).toBe(IDS[0]);
    expect(session.blobKey).toBe(`sessions/${IDS[0]}/`);
  });

  it("404s an unknown id", async () => {
    const { GET } = await import("../app/api/sessions/[id]/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sessions/[id]/snapshots", () => {
  async function fetchBlock(id: string, block?: number) {
    const { GET } = await import("../app/api/sessions/[id]/snapshots/route");
    const url = `http://localhost/x${block !== undefined ? `?block=${block}` : ""}`;
    return GET(new Request(url), { params: Promise.resolve({ id }) });
  }

  it("serves ordered events across blocks with a total-blocks header", async () => {
    const first = await fetchBlock(IDS[0], 0);
    expect(first.status).toBe(200);
    expect(first.headers.get("X-OpenLog-Total-Blocks")).toBe("2");

    const second = await fetchBlock(IDS[0], 1);
    const events = [...(await first.json()), ...(await second.json())];
    expect(events).toHaveLength(FIXTURE_LINES.length);
    // Reassembled blocks must equal the original event stream, in order.
    expect(events.map((e) => JSON.stringify(e))).toEqual(
      FIXTURE_LINES.map((l) => JSON.stringify(JSON.parse(l)))
    );
  });

  it("defaults to block 0", async () => {
    const res = await fetchBlock(IDS[1]);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-OpenLog-Block")).toBe("0");
    expect(await res.json()).toHaveLength(10);
  });

  it("404s a block out of range", async () => {
    const res = await fetchBlock(IDS[1], 5);
    expect(res.status).toBe(404);
    expect((await res.json()).totalBlocks).toBe(1);
  });

  it("404s an unknown session", async () => {
    const res = await fetchBlock("nope", 0);
    expect(res.status).toBe(404);
  });

  it("rejects a negative block", async () => {
    const res = await fetchBlock(IDS[1], -1);
    expect(res.status).toBe(400);
  });
});

describe("block partitioning of oversized batches", () => {
  it("splits a big object into stable, complete, ordered blocks", async () => {
    const { getBlockIndex, readBlock } = await import("../lib/blocks");
    const { getStorage, sessionBatchKey } = await import("../lib/storage");

    // ~7 MB object → must map to 3 blocks (target 3 MB each).
    const id = "test-serve-bigblock";
    const line = JSON.stringify({
      type: 3,
      timestamp: 1781246543618,
      data: { source: 2, type: 7, id: 1, x: 1, y: 1, pointerType: 2, pad: "x".repeat(1000) },
    });
    const count = Math.ceil((7 * 1024 * 1024) / (line.length + 1));
    await getStorage().blobs.put(
      sessionBatchKey(id, 1),
      Array.from({ length: count }, () => line).join("\n") + "\n"
    );

    const index = await getBlockIndex(id);
    expect(index.totalBlocks).toBe(3);

    let total = 0;
    for (let n = 0; n < index.totalBlocks; n++) {
      const events = await readBlock(id, index, n);
      expect(events.length).toBeGreaterThan(0);
      total += events.length;
    }
    expect(total).toBe(count);
  });
});
