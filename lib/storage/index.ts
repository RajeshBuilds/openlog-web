import { createBlobStore, readSessionBatches, type BlobStore } from "./blobStore";
import { PrismaSessionRepo, type SessionRepo } from "./prismaRepo";

export {
  sessionBatchKey,
  sessionPrefix,
  readSessionBatches,
  type BlobObject,
  type BlobStore,
} from "./blobStore";
export type {
  BatchStats,
  Session,
  SessionCreate,
  SessionPatch,
  SessionList,
  SessionRepo,
} from "./prismaRepo";

/**
 * The single storage entry point for routes and server code. Backends are
 * chosen by env (BLOB_BACKEND, DATABASE_URL) — never import a concrete
 * backend outside this module.
 */
export interface Storage {
  sessions: SessionRepo;
  blobs: BlobStore;
  /** All of a session's events as raw NDJSON bytes, batches concatenated in order. */
  readSessionBlob(sessionId: string): Promise<Uint8Array>;
}

function createStorage(): Storage {
  const blobs = createBlobStore();
  return {
    sessions: new PrismaSessionRepo(),
    blobs,
    readSessionBlob: (sessionId) => readSessionBatches(blobs, sessionId),
  };
}

const globalForStorage = globalThis as unknown as { storage?: Storage };

export function getStorage(): Storage {
  if (!globalForStorage.storage) {
    globalForStorage.storage = createStorage();
  }
  return globalForStorage.storage;
}
