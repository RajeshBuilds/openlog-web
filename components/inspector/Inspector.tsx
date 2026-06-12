"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/playerStore";

import { EventRow } from "./EventRow";
import {
  KIND_LABELS,
  KIND_ORDER,
  classifyEvents,
  filterEvents,
  findActiveIndex,
  type InspectorEvent,
} from "./filters";

/**
 * The JSON logs viewer (SPEC T6): a timeline-synced, filterable, virtualized
 * list of the session's raw events, modeled on PostHog's
 * PlayerInspectorList / PlayerInspectorControls. Click a row → seek the
 * player; the row at the playhead highlights as playback advances; expand a
 * row → collapsible JSON tree of the raw event.
 */
export function Inspector() {
  const rawEvents = usePlayerStore((s) => s.rawEvents);
  const sessionStartTs = usePlayerStore((s) => s.sessionStartTs);
  const filters = usePlayerStore((s) => s.filters);
  const setFilters = usePlayerStore((s) => s.setFilters);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const events = useMemo(
    () => (rawEvents ? classifyEvents(rawEvents, sessionStartTs) : []),
    [rawEvents, sessionStartTs]
  );
  const filtered = useMemo(() => filterEvents(events, filters), [events, filters]);

  // Kinds that exist in this session — chips for anything else are noise.
  const presentKinds = useMemo(
    () => KIND_ORDER.filter((k) => events.some((e) => e.kind === k)),
    [events]
  );

  // Subscribing to a derived index (not currentTimeMs itself) keeps the
  // 60fps playhead updates from re-rendering the list on every frame.
  const activeIndex = usePlayerStore((s) =>
    s.status === "ready" ? findActiveIndex(filtered, s.currentTimeMs) : -1
  );

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Screen transitions arrive as a cluster (screen log → meta → full
  // snapshot) where the snapshot lags the log by a few ms of capture
  // latency. Clicking any row in the cluster should show the NEW screen,
  // so the seek snaps forward over a snapshot that lands within a blink.
  const SNAPSHOT_SNAP_MS = 150;
  const seekTo = useCallback(
    (event: InspectorEvent) => {
      const store = usePlayerStore.getState();
      store.setSelectedEventId(event.index);
      let target = event.offsetMs;
      for (
        let i = event.index + 1;
        i < events.length && events[i].offsetMs - event.offsetMs <= SNAPSHOT_SNAP_MS;
        i++
      ) {
        if (events[i].kind === "full-snapshot") target = events[i].offsetMs;
      }
      store.controls?.seek(target);
    },
    [events]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  // Follow the playhead while playing, unless the user is in the list.
  const hovering = useRef(false);
  useEffect(() => {
    if (isPlaying && activeIndex >= 0 && !hovering.current) {
      virtualizer.scrollToIndex(activeIndex, { align: "center" });
    }
  }, [activeIndex, isPlaying, virtualizer]);

  if (!rawEvents) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Events appear once the session loads.
      </div>
    );
  }

  const toggleKind = (kind: string) => {
    const types = filters.types.includes(kind)
      ? filters.types.filter((t) => t !== kind)
      : [...filters.types, kind];
    setFilters({ types });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          placeholder="Search events…"
          aria-label="Search events"
          className="h-7 w-44 text-xs"
        />
        {presentKinds.map((kind) => {
          const active = filters.types.includes(kind);
          return (
            <button key={kind} type="button" onClick={() => toggleKind(kind)} aria-pressed={active}>
              <Badge
                variant={active ? "default" : "outline"}
                className={cn("cursor-pointer select-none", !active && "text-muted-foreground")}
              >
                {KIND_LABELS[kind]}
              </Badge>
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length}/{events.length}
        </span>
      </div>

      <div
        ref={scrollRef}
        onMouseEnter={() => (hovering.current = true)}
        onMouseLeave={() => (hovering.current = false)}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border"
        data-testid="inspector-list"
      >
        {filtered.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
            No events match the current filters.
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const event = filtered[item.index];
              return (
                <div
                  key={event.index}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <EventRow
                    event={event}
                    isActive={item.index === activeIndex}
                    isExpanded={expanded.has(event.index)}
                    onSeek={seekTo}
                    onToggleExpand={toggleExpand}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
