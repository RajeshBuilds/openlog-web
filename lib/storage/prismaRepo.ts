import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma, type Session } from "../generated/prisma/client";

export type { Session };

export interface SessionCreate {
  id: string;
  appId: string;
  sdkVersion: string;
  device: Prisma.InputJsonValue;
  startedAt: Date;
  blobKey: string;
}

export interface SessionPatch {
  endedAt?: Date;
  durationMs?: number;
  eventCount?: number;
  screenCount?: number;
}

export interface SessionList {
  items: Session[];
  nextCursor: string | null;
}

export interface BatchStats {
  addEvents: number;
  addScreens: number;
  endedAt: Date;
  durationMs: number;
}

export interface SessionRepo {
  /** Creates the session on first batch; later batches only apply the patch. */
  upsert(meta: SessionCreate, patch?: SessionPatch): Promise<Session>;
  /** Accumulates one ingested batch into the session's counters. */
  recordBatch(id: string, stats: BatchStats): Promise<Session>;
  get(id: string): Promise<Session | null>;
  list(opts?: { cursor?: string; limit?: number }): Promise<SessionList>;
  delete(id: string): Promise<void>;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}

export class PrismaSessionRepo implements SessionRepo {
  constructor(private prisma: PrismaClient = getPrisma()) {}

  async upsert(meta: SessionCreate, patch: SessionPatch = {}): Promise<Session> {
    return this.prisma.session.upsert({
      where: { id: meta.id },
      create: { ...meta, ...patch },
      update: patch,
    });
  }

  async recordBatch(id: string, stats: BatchStats): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: {
        eventCount: { increment: stats.addEvents },
        screenCount: { increment: stats.addScreens },
        endedAt: stats.endedAt,
        durationMs: stats.durationMs,
      },
    });
  }

  async get(id: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id } });
  }

  async list(opts: { cursor?: string; limit?: number } = {}): Promise<SessionList> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const items = await this.prisma.session.findMany({
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async delete(id: string): Promise<void> {
    await this.prisma.session.delete({ where: { id } });
  }
}
