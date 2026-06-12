"use client";

import { useEffect, useMemo, useRef } from "react";

import { RouteIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/playerStore";

import { classifyEvents, formatOffset } from "./filters";
import {
  deriveNavigation,
  findActiveVisitId,
  formatDwell,
  type ScreenVisit,
} from "./navigation";

/**
 * The Navigation tab: the session's screen journey as a vertical flow.
 * Same interaction grammar as the inspector — click a screen to seek the
 * player there; the visit at the playhead highlights and follows playback.
 */
export function NavigationFlow() {
  const rawEvents = usePlayerStore((s) => s.rawEvents);
  const sessionStartTs = usePlayerStore((s) => s.sessionStartTs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const visits = useMemo(
    () =>
      rawEvents
        ? deriveNavigation(classifyEvents(rawEvents, sessionStartTs), durationMs)
        : [],
    [rawEvents, sessionStartTs, durationMs]
  );

  // Derived-id subscription, so 60fps playhead updates only re-render when
  // the active visit actually changes (same trick as the inspector list).
  const activeId = usePlayerStore((s) =>
    s.status === "ready" ? findActiveVisitId(visits, s.currentTimeMs) : -1
  );

  const totalVisits = useMemo(
    () => visits.reduce((n, v) => n + 1 + v.children.length, 0),
    [visits]
  );
  const uniqueScreens = useMemo(() => {
    const names = new Set<string>();
    for (const v of visits) {
      names.add(v.name);
      for (const c of v.children) names.add(c.name);
    }
    return names.size;
  }, [visits]);

  // Follow the playhead while playing, unless the user is in the list.
  const hovering = useRef(false);
  const nodeRefs = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (isPlaying && activeId >= 0 && !hovering.current) {
      nodeRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId, isPlaying]);

  if (!rawEvents) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Navigation appears once the session loads.
      </div>
    );
  }

  if (visits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <RouteIcon className="size-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          No screen transitions captured in this session.
        </p>
      </div>
    );
  }

  const seekTo = (visit: ScreenVisit) => {
    usePlayerStore.getState().controls?.seek(visit.seekMs);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex h-8 items-center justify-between px-0.5">
        <span className="text-xs text-muted-foreground">
          Click a screen to jump the replay there.
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {totalVisits} visits · {uniqueScreens} screens
        </span>
      </div>

      <div
        onMouseEnter={() => (hovering.current = true)}
        onMouseLeave={() => (hovering.current = false)}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-3"
        data-testid="navigation-flow"
      >
        <ol className="relative space-y-1.5">
          {/* journey spine */}
          <span
            aria-hidden
            className="absolute bottom-3 left-[11px] top-3 w-px bg-border"
          />
          {visits.map((visit) => (
            <VisitNode
              key={visit.id}
              visit={visit}
              activeId={activeId}
              durationMs={Math.max(durationMs, 1)}
              nodeRefs={nodeRefs.current}
              onSeek={seekTo}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function VisitNode({
  visit,
  activeId,
  durationMs,
  nodeRefs,
  onSeek,
}: {
  visit: ScreenVisit;
  activeId: number;
  durationMs: number;
  nodeRefs: Map<number, HTMLElement>;
  onSeek(visit: ScreenVisit): void;
}) {
  // A parent stays lit while one of its fragments is active — you're still
  // "inside" that activity.
  const isActive =
    activeId === visit.id || visit.children.some((c) => c.id === activeId);
  const isSelf = activeId === visit.id;

  return (
    <li
      className="relative pl-7"
      ref={(el) => {
        if (el) nodeRefs.set(visit.id, el);
        else nodeRefs.delete(visit.id);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[7px] top-3.5 size-2.5 rounded-full border-2 border-card transition-colors",
          isActive ? "bg-primary ring-2 ring-primary/20" : "bg-muted-foreground/40"
        )}
      />
      <button
        type="button"
        onClick={() => onSeek(visit)}
        title="Seek player to this screen"
        className={cn(
          "w-full rounded-lg px-2.5 py-2 text-left transition-colors",
          isSelf ? "bg-primary/5" : "hover:bg-muted/50"
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{visit.name}</span>
          {visit.kind === "fragment" && (
            <Badge
              variant="outline"
              className="h-4 shrink-0 px-1.5 font-mono text-[10px] font-normal text-muted-foreground"
            >
              fragment
            </Badge>
          )}
          {visit.visitNumber > 1 && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              visit {visit.visitNumber}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatOffset(visit.enterMs)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-colors",
                isActive ? "bg-primary/60" : "bg-primary/25"
              )}
              style={{
                width: `${Math.max(
                  2,
                  ((visit.exitMs - visit.enterMs) / durationMs) * 100
                )}%`,
              }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatDwell(visit.exitMs - visit.enterMs)}
          </span>
        </div>
      </button>

      {visit.children.length > 0 && (
        <ol className="relative ml-7 mt-1 space-y-1">
          <span
            aria-hidden
            className="absolute bottom-3 left-[11px] top-3 w-px border-l border-dashed border-border"
          />
          {visit.children.map((child) => (
            <VisitNode
              key={child.id}
              visit={child}
              activeId={activeId}
              durationMs={durationMs}
              nodeRefs={nodeRefs}
              onSeek={onSeek}
            />
          ))}
        </ol>
      )}
    </li>
  );
}
