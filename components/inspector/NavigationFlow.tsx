"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChevronDownIcon, ChevronRightIcon, RouteIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/playerStore";

import { KIND_BADGE_CLASS } from "./EventRow";
import { JsonTree } from "./JsonTree";
import {
  KIND_LABELS,
  classifyEvents,
  formatOffset,
  type InspectorEvent,
} from "./filters";
import {
  deriveNavigation,
  findActiveVisitId,
  formatDwell,
  visitEvents,
  type ScreenVisit,
} from "./navigation";

/**
 * The Navigation tab: the session's screen journey as a vertical flow.
 * Same interaction grammar as the inspector — click a screen to seek the
 * player there; the visit at the playhead highlights and follows playback.
 * Each visit expands to the user events that took place on that screen.
 */
export function NavigationFlow() {
  const rawEvents = usePlayerStore((s) => s.rawEvents);
  const sessionStartTs = usePlayerStore((s) => s.sessionStartTs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const events = useMemo(
    () => (rawEvents ? classifyEvents(rawEvents, sessionStartTs) : []),
    [rawEvents, sessionStartTs]
  );
  const visits = useMemo(
    () => deriveNavigation(events, durationMs),
    [events, durationMs]
  );
  // Per-visit user events, precomputed so every node can show its count.
  const eventsByVisit = useMemo(() => {
    const map = new Map<number, InspectorEvent[]>();
    const walk = (vs: ScreenVisit[]) => {
      for (const v of vs) {
        map.set(v.id, visitEvents(events, v, durationMs));
        walk(v.children);
      }
    };
    walk(visits);
    return map;
  }, [events, visits, durationMs]);

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

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The screen the user last clicked/expanded. Distinct from the playhead's
  // active visit — selection persists wherever the player happens to be.
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
              selectedId={selectedId}
              onSelect={setSelectedId}
              durationMs={Math.max(durationMs, 1)}
              events={eventsByVisit.get(visit.id) ?? []}
              eventsByVisit={eventsByVisit}
              isExpanded={expanded.has(visit.id)}
              expanded={expanded}
              onToggleExpand={toggleExpand}
              nodeRefs={nodeRefs.current}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function seekTo(offsetMs: number) {
  const store = usePlayerStore.getState();
  store.controls?.seek(offsetMs);
  store.revealPlayer();
}

function VisitNode({
  visit,
  activeId,
  selectedId,
  onSelect,
  durationMs,
  events,
  eventsByVisit,
  isExpanded,
  expanded,
  onToggleExpand,
  nodeRefs,
}: {
  visit: ScreenVisit;
  activeId: number;
  selectedId: number | null;
  onSelect(id: number): void;
  durationMs: number;
  events: InspectorEvent[];
  eventsByVisit: Map<number, InspectorEvent[]>;
  isExpanded: boolean;
  expanded: Set<number>;
  onToggleExpand(id: number): void;
  nodeRefs: Map<number, HTMLElement>;
}) {
  // A parent stays lit while one of its fragments is active — you're still
  // "inside" that activity.
  const isActive =
    activeId === visit.id || visit.children.some((c) => c.id === activeId);
  const isSelf = activeId === visit.id;
  const isSelected = selectedId === visit.id;
  // Highlight the screen the user picked, and the one at the playhead.
  const isHighlighted = isSelected || isSelf;
  const hasEvents = events.length > 0;

  // Per-event JSON expansion, mirroring the inspector's expandable rows.
  const [openEvents, setOpenEvents] = useState<Set<number>>(new Set());
  const toggleEvent = (index: number) =>
    setOpenEvents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

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
      <div
        className={cn(
          "relative overflow-hidden rounded-lg transition-colors",
          isHighlighted
            ? "bg-muted/40 ring-1 ring-border before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary"
            : "hover:bg-muted/50"
        )}
      >
        <div className="flex w-full items-start gap-1.5 px-2 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={isExpanded ? "Collapse screen events" : "Expand screen events"}
            aria-expanded={isExpanded}
            disabled={!hasEvents}
            onClick={() => {
              onToggleExpand(visit.id);
              onSelect(visit.id);
            }}
            className={cn(
              "size-5 text-muted-foreground",
              !hasEvents &&
                "text-muted-foreground/30 disabled:opacity-100 hover:bg-transparent"
            )}
          >
            {isExpanded ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
          </Button>
          <button
            type="button"
            onClick={() => {
              seekTo(visit.seekMs);
              onSelect(visit.id);
            }}
            title="Seek player to this screen"
            className="min-w-0 flex-1 text-left"
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
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatDwell(visit.exitMs - visit.enterMs)} ·{" "}
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            </div>
          </button>
        </div>

        {isExpanded && hasEvents && (
          <div className="border-t border-border/60 px-2 pb-2 pt-1.5">
            <ol className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-background/60">
              {events.map((event) => {
                const open = openEvents.has(event.index);
                return (
                  <li key={event.index}>
                    <div className="flex w-full items-stretch">
                      <button
                        type="button"
                        aria-label={open ? "Collapse event JSON" : "Expand event JSON"}
                        aria-expanded={open}
                        onClick={() => toggleEvent(event.index)}
                        className="flex shrink-0 items-center px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        {open ? (
                          <ChevronDownIcon className="size-3" />
                        ) : (
                          <ChevronRightIcon className="size-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => seekTo(event.offsetMs)}
                        title="Seek player to this event"
                        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-xs transition-colors hover:bg-muted/60"
                      >
                        <span className="w-12 shrink-0 font-mono tabular-nums text-muted-foreground">
                          {formatOffset(event.offsetMs)}
                        </span>
                        <Badge
                          className={cn(
                            "w-20 shrink-0 justify-center border-transparent font-mono text-[10px] font-medium",
                            KIND_BADGE_CLASS[event.kind]
                          )}
                        >
                          {KIND_LABELS[event.kind]}
                        </Badge>
                        <span className="truncate text-foreground/90">{event.summary}</span>
                      </button>
                    </div>
                    {open && (
                      <div className="border-t border-border/50 bg-muted/30 px-2">
                        <JsonTree data={event.raw} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

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
              selectedId={selectedId}
              onSelect={onSelect}
              durationMs={durationMs}
              events={eventsByVisit.get(child.id) ?? []}
              eventsByVisit={eventsByVisit}
              isExpanded={expanded.has(child.id)}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              nodeRefs={nodeRefs}
            />
          ))}
        </ol>
      )}
    </li>
  );
}
