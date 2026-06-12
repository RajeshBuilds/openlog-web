import Link from "next/link";
import { ChevronRight, Inbox, Play, Smartphone } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMs, formatRelative } from "@/lib/format";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const startedAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const { items, nextCursor } = await getStorage().sessions.list({
    cursor,
    limit: PAGE_SIZE,
  });

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-muted/40">
      <AppHeader
        right={
          <span className="hidden text-xs text-muted-foreground sm:block">
            Android SDK · session replay
          </span>
        }
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
            <p className="text-sm text-muted-foreground">
              Replays and structured logs captured by the OpenLog Android SDK.
            </p>
          </div>
          <Badge variant="outline" className="bg-background text-muted-foreground">
            {items.length}
            {nextCursor ? "+" : ""} session{items.length === 1 && !nextCursor ? "" : "s"}
          </Badge>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card px-6 py-20 text-center">
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
          <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Session
                  </TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    App
                  </TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Device
                  </TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Started
                  </TableHead>
                  <TableHead className="h-11 px-4 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Duration
                  </TableHead>
                  <TableHead className="h-11 px-4 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Events
                  </TableHead>
                  <TableHead className="h-11 px-4 text-right text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Screens
                  </TableHead>
                  <TableHead className="h-11 w-10 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((session) => {
                  const device = session.device as {
                    model?: string;
                    os?: string;
                    osVersion?: string;
                  } | null;
                  return (
                    <TableRow key={session.id} className="group relative">
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:text-primary">
                            <Play className="size-3.5 fill-current" />
                          </div>
                          <Link
                            href={`/s/${encodeURIComponent(session.id)}`}
                            className="font-mono text-[13px] font-medium after:absolute after:inset-0"
                          >
                            {session.id}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className="font-mono text-[11px] font-normal text-muted-foreground"
                        >
                          {session.appId}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {device?.model ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Smartphone className="size-3.5 shrink-0 text-muted-foreground" />
                            <span>{device.model}</span>
                            <span className="text-muted-foreground">
                              {`${device.os ?? ""} ${device.osVersion ?? ""}`.trim()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm">
                            {formatRelative(session.startedAt)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {startedAtFormat.format(session.startedAt)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right font-mono text-[13px] tabular-nums">
                        {formatMs(session.durationMs)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                        {session.eventCount.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                        {session.screenCount.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {nextCursor && (
          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              nativeButton={false}
              render={<Link href={`/?cursor=${encodeURIComponent(nextCursor)}`} />}
            >
              Next page
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
