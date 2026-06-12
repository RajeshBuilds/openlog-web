import Link from "next/link";
import { notFound } from "next/navigation";
import { Smartphone } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Inspector } from "@/components/inspector/Inspector";
import { Player } from "@/components/player/Player";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMs } from "@/lib/format";
import { getStorage } from "@/lib/storage";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getStorage().sessions.get(sessionId);
  if (!session) notFound();

  const device = session.device as {
    model?: string;
    os?: string;
    osVersion?: string;
  } | null;

  return (
    <div className="flex h-dvh flex-col bg-muted/40">
      <AppHeader
        containerClassName="max-w-none"
        right={
          <>
            {device?.model && (
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
                <Smartphone className="size-3.5" />
                {`${device.model} · ${device.os ?? ""} ${device.osVersion ?? ""}`.trim()}
              </span>
            )}
            <Badge
              variant="outline"
              className="bg-background font-mono text-[11px] font-normal text-muted-foreground"
            >
              {session.eventCount.toLocaleString("en-US")} events
            </Badge>
            <Badge
              variant="outline"
              className="bg-background font-mono text-[11px] font-normal text-muted-foreground"
            >
              {formatMs(session.durationMs)}
            </Badge>
          </>
        }
      >
        <nav className="flex min-w-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground/40">/</span>
          <Link
            href="/"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            Sessions
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="truncate font-mono text-[13px] font-medium">
            {session.id}
          </span>
          <Badge
            variant="secondary"
            className="hidden font-mono text-[11px] font-normal text-muted-foreground sm:inline-flex"
          >
            {session.appId}
          </Badge>
        </nav>
      </AppHeader>

      <main className="grid min-h-0 w-full flex-1 gap-4 px-6 py-4 lg:grid-cols-2">
        <Tabs
          defaultValue="events"
          className="flex min-h-0 flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs"
        >
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>
          <TabsContent value="events" className="min-h-0 flex-1">
            <Inspector />
          </TabsContent>
        </Tabs>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card p-3 shadow-xs">
          <Player sessionId={session.id} />
        </div>
      </main>
    </div>
  );
}
