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

/** Columns the sessions list can be ordered by. `device` is JSON and not
 *  sortable in the database, so it is intentionally excluded. */
export type SessionSortKey =
  | "id"
  | "appId"
  | "startedAt"
  | "durationMs"
  | "eventCount"
  | "screenCount";

export type SessionSortDir = "asc" | "desc";

/** Case-insensitive "contains" filters applied server-side. */
export interface SessionFilters {
  id?: string;
  appId?: string;
  /** Matches against the device JSON's `model` field. */
  device?: string;
}

export interface SessionListOpts {
  cursor?: string;
  limit?: number;
  sort?: SessionSortKey;
  dir?: SessionSortDir;
  filters?: SessionFilters;
}

/** Offset (page-number) pagination result. */
export interface SessionPage {
  items: Session[];
  /** Total rows matching the filters, across all pages. */
  total: number;
}

export interface SessionPageOpts {
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
  sort?: SessionSortKey;
  dir?: SessionSortDir;
  filters?: SessionFilters;
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
  list(opts?: SessionListOpts): Promise<SessionList>;
  /** Offset pagination with a total count, for page-number navigation. */
  listPage(opts?: SessionPageOpts): Promise<SessionPage>;
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

  async list(opts: SessionListOpts = {}): Promise<SessionList> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const dir: SessionSortDir = opts.dir === "asc" ? "asc" : "desc";
    const sort: SessionSortKey = opts.sort ?? "startedAt";

    const items = await this.prisma.session.findMany({
      where: buildWhere(opts.filters),
      take: limit + 1,
      // Cursor pagination needs a deterministic order, so `id` is always the
      // final tiebreaker. The cursor itself is the unique `id`; Prisma locates
      // that row and continues from it in this exact order.
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: buildOrderBy(sort, dir),
    });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async listPage(opts: SessionPageOpts = {}): Promise<SessionPage> {
    const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
    const page = Math.max(opts.page ?? 1, 1);
    const dir: SessionSortDir = opts.dir === "asc" ? "asc" : "desc";
    const sort: SessionSortKey = opts.sort ?? "startedAt";
    const where = buildWhere(opts.filters);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.session.count({ where }),
      this.prisma.session.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: buildOrderBy(sort, dir),
      }),
    ]);
    return { items, total };
  }

  async delete(id: string): Promise<void> {
    await this.prisma.session.delete({ where: { id } });
  }
}

function buildWhere(filters?: SessionFilters): Prisma.SessionWhereInput {
  const where: Prisma.SessionWhereInput = {};
  const id = filters?.id?.trim();
  const appId = filters?.appId?.trim();
  const device = filters?.device?.trim();

  if (id) where.id = { contains: id, mode: "insensitive" };
  if (appId) where.appId = { contains: appId, mode: "insensitive" };
  if (device) {
    where.device = {
      path: ["model"],
      string_contains: device,
      mode: "insensitive",
    };
  }
  return where;
}

function buildOrderBy(
  sort: SessionSortKey,
  dir: SessionSortDir
): Prisma.SessionOrderByWithRelationInput[] {
  if (sort === "id") return [{ id: dir }];
  return [{ [sort]: dir } as Prisma.SessionOrderByWithRelationInput, { id: dir }];
}
