import Link from "next/link";

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
import { formatMs } from "@/lib/format";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OpenLog</h1>
          <p className="text-sm text-muted-foreground">
            Session replays &amp; JSON logs from the OpenLog Android SDK
          </p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead>App</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right">Screens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                No sessions yet. POST a recording to{" "}
                <code className="font-mono text-xs">/api/ingest</code> and it will appear here.
              </TableCell>
            </TableRow>
          ) : (
            items.map((session) => {
              const device = session.device as {
                model?: string;
                os?: string;
                osVersion?: string;
              } | null;
              return (
                <TableRow key={session.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/s/${encodeURIComponent(session.id)}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {session.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{session.appId}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {device?.model
                      ? `${device.model} · ${device.os ?? ""} ${device.osVersion ?? ""}`.trim()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {session.startedAt.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatMs(session.durationMs)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{session.eventCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{session.screenCount}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/?cursor=${encodeURIComponent(nextCursor)}`} />}
          >
            Next page →
          </Button>
        </div>
      )}
    </main>
  );
}
