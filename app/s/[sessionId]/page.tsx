import Link from "next/link";
import { notFound } from "next/navigation";

import { Inspector } from "@/components/inspector/Inspector";
import { Player } from "@/components/player/Player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    <main className="mx-auto flex h-dvh max-w-7xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/" />}>
          ← Sessions
        </Button>
        <h1 className="truncate text-lg font-semibold tracking-tight">
          <span className="font-mono">{session.id}</span>
        </h1>
        <Badge variant="secondary">{session.appId}</Badge>
        {device?.model && (
          <Badge variant="outline">
            {device.model} · {device.os} {device.osVersion}
          </Badge>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {session.eventCount} events · {formatMs(session.durationMs)}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <Player sessionId={session.id} />

        <Tabs defaultValue="events" className="flex min-h-0 flex-col">
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>
          <TabsContent value="events" className="min-h-0 flex-1">
            <Inspector />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
