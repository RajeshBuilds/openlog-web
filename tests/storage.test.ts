import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBlobStore,
  readSessionBatches,
  sessionBatchKey,
  sessionPrefix,
  type BlobStore,
} from "../lib/storage/blobStore";
import { PrismaSessionRepo, getPrisma } from "../lib/storage/prismaRepo";

const SESSION_ID = "test-session-t1";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "openlog-blobs-"));
  process.env.BLOB_FS_DIR = dir;
  // Selected via env exactly the way routes will: no backend named in code.
  process.env.BLOB_BACKEND = "fs";
  await getPrisma().session.deleteMany({ where: { id: SESSION_ID } });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await getPrisma().session.deleteMany({ where: { id: SESSION_ID } });
  await getPrisma().$disconnect();
});

describe("blob store (fs backend)", () => {
  let store: BlobStore;

  beforeAll(() => {
    store = createBlobStore();
  });

  it("appends batches and reads them back concatenated in order", async () => {
    // Written out of order on purpose: read order must follow seq, not write time.
    await store.append(SESSION_ID, 2, '{"type":3}\n');
    await store.append(SESSION_ID, 1, '{"type":2}\n');

    const keys = await store.list(sessionPrefix(SESSION_ID));
    expect(keys).toEqual([
      sessionBatchKey(SESSION_ID, 1),
      sessionBatchKey(SESSION_ID, 2),
    ]);

    const blob = await readSessionBatches(store, SESSION_ID);
    expect(Buffer.from(blob).toString()).toBe('{"type":2}\n{"type":3}\n');
  });

  it("serves inclusive byte ranges", async () => {
    await store.put("range-test.txt", "0123456789");
    const slice = await store.getRange("range-test.txt", { start: 2, end: 5 });
    expect(Buffer.from(slice).toString()).toBe("2345");
  });

  it("lists nothing for an unknown prefix", async () => {
    expect(await store.list(sessionPrefix("nope"))).toEqual([]);
  });

  it("rejects presignPut on the fs backend", async () => {
    await expect(store.presignPut("x")).rejects.toThrow(/not supported/);
  });
});

describe("blob store backend swap", () => {
  it("returns an r2 store from the same factory with only env changes", () => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_BUCKET = "test-bucket";
    const store = createBlobStore("r2");
    // Same interface — callers (routes) never change when the backend swaps.
    expect(typeof store.put).toBe("function");
    expect(typeof store.append).toBe("function");
    expect(typeof store.getRange).toBe("function");
    expect(typeof store.list).toBe("function");
    expect(typeof store.presignPut).toBe("function");
  });

  it("rejects an unknown backend", () => {
    expect(() => createBlobStore("gcs")).toThrow(/Unknown BLOB_BACKEND/);
  });
});

describe("session metadata (Prisma repo)", () => {
  const repo = new PrismaSessionRepo();

  it("creates on first upsert and patches on later upserts", async () => {
    const startedAt = new Date("2026-06-12T00:00:00Z");
    const created = await repo.upsert({
      id: SESSION_ID,
      appId: "com.example.app",
      sdkVersion: "0.1.0",
      device: { os: "Android", osVersion: "15", model: "Pixel 9", w: 1080, h: 2400 },
      startedAt,
      blobKey: sessionPrefix(SESSION_ID),
    });
    expect(created.eventCount).toBe(0);

    const patched = await repo.upsert(
      {
        id: SESSION_ID,
        appId: "ignored-on-update",
        sdkVersion: "0.1.0",
        device: {},
        startedAt,
        blobKey: sessionPrefix(SESSION_ID),
      },
      { eventCount: 42, durationMs: 9000, endedAt: new Date("2026-06-12T00:00:09Z") }
    );
    expect(patched.appId).toBe("com.example.app");
    expect(patched.eventCount).toBe(42);
    expect(patched.durationMs).toBe(9000);
  });

  it("gets by id and lists with the session included", async () => {
    const found = await repo.get(SESSION_ID);
    expect(found?.appId).toBe("com.example.app");
    expect((found?.device as { model?: string }).model).toBe("Pixel 9");

    const { items } = await repo.list({ limit: 10 });
    expect(items.some((s) => s.id === SESSION_ID)).toBe(true);
  });

  it("returns null for an unknown id", async () => {
    expect(await repo.get("does-not-exist")).toBeNull();
  });
});

describe("storage adapter (combined)", () => {
  it("writes and reads a session blob + metadata through one interface", async () => {
    // Import here so getStorage() picks up the env set in beforeAll.
    const { getStorage } = await import("../lib/storage/index");
    const storage = getStorage();

    await storage.blobs.append(SESSION_ID, 3, '{"type":6}\n');
    const blob = await storage.readSessionBlob(SESSION_ID);
    expect(Buffer.from(blob).toString()).toContain('{"type":6}');

    const session = await storage.sessions.get(SESSION_ID);
    expect(session?.id).toBe(SESSION_ID);
  });
});
