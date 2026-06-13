"use client";

import { useEffect, useState } from "react";

import { ListTree, Play } from "lucide-react";
import { MotionConfig } from "motion/react";

import { Inspector } from "@/components/inspector/Inspector";
import { NavigationFlow } from "@/components/inspector/NavigationFlow";
import { Player } from "@/components/player/Player";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/playerStore";

type MobileView = "replay" | "inspector";

/**
 * Responsive session layout. On large screens the inspector and the player sit
 * side by side; on smaller screens only one fits at a time, so a segmented
 * toggle switches between them. The Player is always mounted (just hidden via
 * CSS) so rrweb's iframe and playback state survive the toggle.
 */
export function SessionWorkspace({
  sessionId,
  events,
}: {
  sessionId?: string;
  events?: unknown[];
}) {
  const [mobileView, setMobileView] = useState<MobileView>("replay");

  // Selecting an event in the inspector seeks the (single, always-mounted)
  // player. On small screens that panel is hidden behind the toggle, so the
  // seek would be invisible — surface the replay when one is requested.
  // Subscribing (rather than reacting to a selector in an effect body) keeps
  // the state update out of render and avoids cascading re-renders.
  useEffect(
    () =>
      usePlayerStore.subscribe((state, prev) => {
        if (state.playerRevealNonce !== prev.playerRevealNonce) {
          setMobileView("replay");
        }
      }),
    []
  );

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: "easeOut" }}>
    <main className="flex min-h-0 w-full flex-1 flex-col gap-3 px-4 py-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:px-6">
      <div className="flex shrink-0 gap-1 rounded-lg border bg-card p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileView("replay")}
          aria-pressed={mobileView === "replay"}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            mobileView === "replay"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Play className="size-3.5" />
          Replay
        </button>
        <button
          type="button"
          onClick={() => setMobileView("inspector")}
          aria-pressed={mobileView === "inspector"}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            mobileView === "inspector"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <ListTree className="size-3.5" />
          Inspector
        </button>
      </div>

      <Tabs
        defaultValue="events"
        className={cn(
          "min-h-0 flex-1 flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs lg:flex",
          mobileView === "inspector" ? "flex" : "hidden"
        )}
      >
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="navigation">Navigation</TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="min-h-0 flex-1">
          <Inspector />
        </TabsContent>
        <TabsContent value="navigation" className="min-h-0 flex-1">
          <NavigationFlow />
        </TabsContent>
      </Tabs>

      <div
        className={cn(
          "min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card p-3 shadow-xs lg:flex",
          mobileView === "replay" ? "flex" : "hidden"
        )}
      >
        <Player sessionId={sessionId} events={events} />
      </div>
    </main>
    </MotionConfig>
  );
}
