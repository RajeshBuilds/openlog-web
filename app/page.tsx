import { Inbox } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { ManualUpload } from "@/components/manual-upload";
import { PageSizeSelect } from "@/components/page-size-select";
import { Pagination } from "@/components/pagination";
import { SessionsTable } from "@/components/sessions-table";
import { Badge } from "@/components/ui/badge";
import { getStorage, type SessionSortKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const SORT_KEYS: SessionSortKey[] = [
  "id",
  "appId",
  "startedAt",
  "durationMs",
  "eventCount",
  "screenCount",
];

type HomeSearchParams = {
  page?: string;
  size?: string;
  sort?: string;
  dir?: string;
  fId?: string;
  fApp?: string;
  fDevice?: string;
};

/** Builds a `/?…` href from query params, dropping empty values. */
function buildHref(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) q.set(key, value);
  }
  const qs = q.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  const sp = await searchParams;

  const sort: SessionSortKey = SORT_KEYS.includes(sp.sort as SessionSortKey)
    ? (sp.sort as SessionSortKey)
    : "startedAt";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const filters = {
    id: sp.fId ?? "",
    appId: sp.fApp ?? "",
    device: sp.fDevice ?? "",
  };
  const hasFilters = Boolean(filters.id || filters.appId || filters.device);
  const requestedPage = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const parsedSize = Number.parseInt(sp.size ?? "", 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(parsedSize)
    ? parsedSize
    : DEFAULT_PAGE_SIZE;

  const { items, total } = await getStorage().sessions.listPage({
    page: requestedPage,
    pageSize,
    sort,
    dir,
    filters,
  });

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(requestedPage, totalPages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Keep sort/filter/size state in pagination links; omit defaults for clean URLs.
  const hrefFor = (p: number) =>
    buildHref({
      sort: sort === "startedAt" ? undefined : sort,
      dir: dir === "desc" ? undefined : dir,
      fId: filters.id,
      fApp: filters.appId,
      fDevice: filters.device,
      size: pageSize === DEFAULT_PAGE_SIZE ? undefined : String(pageSize),
      page: p > 1 ? String(p) : undefined,
    });

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40 lg:h-dvh">
      <AppHeader
        containerClassName="max-w-none"
        right={
          <span className="hidden text-xs text-muted-foreground sm:block">
            Android SDK · session replay
          </span>
        }
      />

      <main className="flex w-full flex-1 flex-col px-6 py-8 lg:min-h-0">
        <div className="grid flex-1 gap-6 lg:min-h-0 lg:grid-cols-[3fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
                <p className="text-sm text-muted-foreground">
                  Replays and structured logs captured by the OpenLog Android SDK.
                </p>
              </div>
              <Badge variant="outline" className="bg-background text-muted-foreground">
                {total} session{total === 1 ? "" : "s"}
                {hasFilters ? " matched" : ""}
              </Badge>
            </div>

            {total === 0 && !hasFilters ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card px-6 py-20 text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Inbox className="size-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">No sessions yet</p>
                  <p className="text-sm text-muted-foreground">
                    POST a recording to{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      /api/ingest
                    </code>{" "}
                    and it will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <SessionsTable
                items={items}
                sort={sort}
                dir={dir}
                filters={filters}
              />
            )}

            {total > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {from}–{to}
                  </span>{" "}
                  of <span className="font-medium text-foreground">{total}</span>
                </p>
                <div className="flex items-center gap-4">
                  <PageSizeSelect
                    pageSize={pageSize}
                    options={PAGE_SIZE_OPTIONS}
                    defaultSize={DEFAULT_PAGE_SIZE}
                  />
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    hrefFor={hrefFor}
                  />
                </div>
              </div>
            )}
          </div>

          <aside className="lg:min-h-0 lg:overflow-auto">
            <ManualUpload />
          </aside>
        </div>
      </main>
    </div>
  );
}
