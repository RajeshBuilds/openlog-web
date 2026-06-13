"use client";

import { useEffect, useRef, useState } from "react";

import { LoaderCircleIcon } from "lucide-react";

import "rrweb/dist/style.css";

import { createPlayer, type PlayerHandle } from "@/lib/replay/createPlayer";
import { loadSessionEvents } from "@/lib/replay/dataLoader";
import { usePlaybackController } from "@/lib/replay/usePlaybackController";
import { ViewportScaler } from "@/lib/replay/viewportScaler";
import { usePlayerStore } from "@/stores/playerStore";

import { Controls } from "./Controls";
import { Timeline } from "./Timeline";

/**
 * Mounts the player core into a ref'd container, the way PostHog's
 * PlayerFrame.tsx does: an outer container that the layout sizes, and an
 * inner content div that rrweb renders into and ViewportScaler transforms.
 *
 * The event source is either a `sessionId` (fetched in blocks from the serve
 * API) or an in-memory `events` array (e.g. a manually uploaded NDJSON file
 * parsed client-side — no backend round-trip). Exactly one should be given.
 */
export function Player({
  sessionId,
  events: localEvents,
}: {
  sessionId?: string;
  events?: unknown[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<PlayerHandle | null>(null);

  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const loadProgress = usePlayerStore((s) => s.loadProgress);

  useEffect(() => {
    const store = usePlayerStore.getState();
    store.reset();
    store.setStatus("loading");

    let player: PlayerHandle | null = null;
    let observer: ResizeObserver | null = null;
    let disposed = false;

    const source = localEvents
      ? Promise.resolve(localEvents)
      : loadSessionEvents(sessionId as string, (loaded, total) => {
          if (!disposed) usePlayerStore.getState().setLoadProgress(loaded, total);
        });

    source
      .then((events) => {
        if (disposed || !contentRef.current || !containerRef.current) return;
        player = createPlayer(events, contentRef.current);

        const scaler = new ViewportScaler(contentRef.current, containerRef.current);
        scaler.attachToReplayer(player.replayer);
        observer = new ResizeObserver(() => scaler.reapply());
        observer.observe(containerRef.current);

        // Render the first frame without starting playback.
        player.pause(0);
        setHandle(player);
        usePlayerStore.getState().setRawEvents(events);
        usePlayerStore.getState().setStatus("ready");
      })
      .catch((err) => {
        if (!disposed) {
          usePlayerStore
            .getState()
            .setStatus("error", err instanceof Error ? err.message : "Failed to load session");
        }
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      player?.destroy();
      setHandle(null);
      usePlayerStore.getState().reset();
    };
  }, [sessionId, localEvents]);

  usePlaybackController(handle);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-neutral-950"
      >
        {/* The replay renders inside rrweb's iframe — not styled by us.
            Absolutely positioned so the recording's native size never
            stretches the container the scaler measures against. */}
        <div ref={contentRef} className="absolute left-0 top-0" />
        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-neutral-400">
            {status !== "error" && (
              <LoaderCircleIcon className="size-5 animate-spin text-neutral-500" />
            )}
            <span>
              {status === "error"
                ? `Could not load session: ${error}`
                : loadProgress
                  ? `Loading blocks… ${loadProgress.loaded}/${loadProgress.total}`
                  : "Loading session…"}
            </span>
          </div>
        )}
      </div>
      <Timeline />
      <Controls />
    </div>
  );
}
