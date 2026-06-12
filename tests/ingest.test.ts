import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SESSION_ID = "test-ingest-t2";
const TOKEN = "test-ingest-token";
const FIXTURE = readFileSync("fixtures/sample-05.ndjson", "utf8");
const FIXTURE_EVENT_COUNT = FIXTURE.trim().split("\n").length;
const FIXTURE_META_COUNT = FIXTURE.trim()
  .split("\n")
  .filter((l) => JSON.parse(l).type === 4).length;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "openlog-ingest-"));
  process.env.BLOB_FS_DIR = dir;
  process.env.BLOB_BACKEND = "fs";
  process.env.INGEST_TOKEN = TOKEN;
  const { getPrisma } = await import("../lib/storage/prismaRepo");
  await getPrisma().session.deleteMany({ where: { id: SESSION_ID } });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  const { getPrisma } = await import("../lib/storage/prismaRepo");
  await getPrisma().session.deleteMany({ where: { id: SESSION_ID } });
  await getPrisma().$disconnect();
});

function ingestRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    body,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/x-ndjson",
      "x-openlog-session-id": SESSION_ID,
      "x-openlog-app": "com.example.app",
      "x-openlog-sdk": "0.1.0",
      ...headers,
    },
  });
}

describe("POST /api/ingest", () => {
  it("accepts the SDK FileSessionSink NDJSON with 202 and stores blob + metadata", async () => {
    const { POST } = await import("../app/api/ingest/route");
    const res = await POST(
      ingestRequest(FIXTURE, {
        "x-openlog-batch-seq": "1",
        "x-openlog-device": JSON.stringify({
          os: "Android",
          osVersion: "15",
          model: "Pixel 9",
          density: 2.625,
          w: 411,
          h: 923,
          appVersion: "1.0.0",
        }),
      })
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ sessionId: SESSION_ID, received: FIXTURE_EVENT_COUNT });

    const { getStorage } = await import("../lib/storage");
    const storage = getStorage();

    const session = await storage.sessions.get(SESSION_ID);
    expect(session).not.toBeNull();
    expect(session!.eventCount).toBe(FIXTURE_EVENT_COUNT);
    expect(session!.screenCount).toBe(FIXTURE_META_COUNT);
    expect(session!.durationMs).toBeGreaterThan(0);
    expect((session!.device as { model?: string }).model).toBe("Pixel 9");

    const blob = Buffer.from(await storage.readSessionBlob(SESSION_ID)).toString();
    expect(blob.trim().split("\n")).toHaveLength(FIXTURE_EVENT_COUNT);
    expect(JSON.parse(blob.trim().split("\n")[0]).type).toBe(5);
  });

  it("dedupes a re-sent batch seq without double counting", async () => {
    const { POST } = await import("../app/api/ingest/route");
    const res = await POST(ingestRequest(FIXTURE, { "x-openlog-batch-seq": "1" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ received: 0, duplicate: true });

    const { getStorage } = await import("../lib/storage");
    const session = await getStorage().sessions.get(SESSION_ID);
    expect(session!.eventCount).toBe(FIXTURE_EVENT_COUNT);
  });

  it("rejects a malformed event with 400 naming the failing index", async () => {
    const { POST } = await import("../app/api/ingest/route");
    const lines = FIXTURE.trim().split("\n");
    const body = [lines[0], '{"type":2,"data":{}}', lines[1]].join("\n");
    const res = await POST(ingestRequest(body, { "x-openlog-batch-seq": "2" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.index).toBe(1);
    expect(json.error).toMatch(/Invalid event/);
  });

  it("rejects a missing token with 401", async () => {
    const { POST } = await import("../app/api/ingest/route");
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      body: FIXTURE,
      headers: { "x-openlog-session-id": SESSION_ID },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects a missing session id with 400", async () => {
    const { POST } = await import("../app/api/ingest/route");
    const req = new Request("http://localhost/api/ingest", {
      method: "POST",
      body: FIXTURE,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a batch over the size cap with 413 and maxBatchBytes", async () => {
    const { POST } = await import("../app/api/ingest/route");
    const line = FIXTURE.trim().split("\n")[0] + "\n";
    const body = line.repeat(Math.ceil((3.6 * 1024 * 1024) / line.length));
    const res = await POST(ingestRequest(body, { "x-openlog-batch-seq": "3" }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.maxBatchBytes).toBeGreaterThan(0);
  });
});

describe("large-batch path (presign + commit)", () => {
  it("presign returns 501 on the fs backend", async () => {
    const { POST } = await import("../app/api/ingest/presign/route");
    const res = await POST(
      new Request("http://localhost/api/ingest/presign", {
        method: "POST",
        body: JSON.stringify({ sessionId: SESSION_ID }),
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    );
    expect(res.status).toBe(501);
  });

  it("commit validates an uploaded object and registers its metadata", async () => {
    // Simulate the SDK's presigned PUT by writing the object directly.
    const { getStorage, sessionBatchKey } = await import("../lib/storage");
    const storage = getStorage();
    const objectKey = sessionBatchKey(SESSION_ID, 4);
    const lines = FIXTURE.trim().split("\n").slice(0, 5);
    await storage.blobs.put(objectKey, lines.join("\n") + "\n");

    const { POST } = await import("../app/api/ingest/commit/route");
    const res = await POST(
      new Request("http://localhost/api/ingest/commit", {
        method: "POST",
        body: JSON.stringify({ sessionId: SESSION_ID, objectKey }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-openlog-session-id": SESSION_ID,
        },
      })
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ received: 5 });

    const session = await storage.sessions.get(SESSION_ID);
    expect(session!.eventCount).toBe(FIXTURE_EVENT_COUNT + 5);
  });

  it("commit rejects an objectKey outside the session prefix", async () => {
    const { POST } = await import("../app/api/ingest/commit/route");
    const res = await POST(
      new Request("http://localhost/api/ingest/commit", {
        method: "POST",
        body: JSON.stringify({ sessionId: SESSION_ID, objectKey: "sessions/other/batch-000001.ndjson" }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-openlog-session-id": SESSION_ID,
        },
      })
    );
    expect(res.status).toBe(400);
  });
});
