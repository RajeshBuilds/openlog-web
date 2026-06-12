import type { InspectorFilters } from "@/stores/playerStore";

/**
 * Event classification + mini-filters for the inspector (SPEC T6), modeled
 * on PostHog's playerInspectorLogic / miniFiltersLogic /
 * inspectorListFiltering: every event gets a kind (badge), a one-line
 * summary, and a precomputed search string; filtering is pure and cheap.
 */

export type EventKind =
  | "full-snapshot"
  | "incremental"
  | "touch"
  | "keyboard"
  | "screen"
  | "log"
  | "network"
  | "other";

export const KIND_LABELS: Record<EventKind, string> = {
  "full-snapshot": "snapshot",
  incremental: "incremental",
  touch: "touch",
  keyboard: "keyboard",
  screen: "screen",
  log: "log",
  network: "network",
  other: "other",
};

/** Chip order in the filter bar. */
export const KIND_ORDER: EventKind[] = [
  "screen",
  "full-snapshot",
  "incremental",
  "touch",
  "keyboard",
  "log",
  "network",
  "other",
];

export interface InspectorEvent {
  /** Index into the session's raw event list — the stable row id. */
  index: number;
  timestamp: number;
  offsetMs: number;
  kind: EventKind;
  summary: string;
  /** Lowercased text the search box matches against. */
  search: string;
  raw: unknown;
}

// rrweb event types / incremental sources (numeric, from @rrweb/types).
const TYPE_FULL_SNAPSHOT = 2;
const TYPE_INCREMENTAL = 3;
const TYPE_META = 4;
const TYPE_CUSTOM = 5;
const TYPE_PLUGIN = 6;

const SOURCE_MUTATION = 0;
const SOURCE_MOUSE_MOVE = 1;
const SOURCE_MOUSE_INTERACTION = 2;
const SOURCE_SCROLL = 3;
const SOURCE_INPUT = 5;
const SOURCE_TOUCH_MOVE = 6;
const SOURCE_DRAG = 12;

const TOUCH_INTERACTIONS: Record<number, string> = {
  0: "touch up",
  1: "touch down",
  2: "tap",
  4: "double tap",
  7: "touch start",
  9: "touch end",
};

interface AnyEvent {
  type?: number;
  timestamp?: number;
  data?: Record<string, unknown>;
}

function countWireframes(wireframes: unknown): number {
  if (!Array.isArray(wireframes)) return 0;
  return wireframes.reduce<number>(
    (n, w) => n + 1 + countWireframes((w as { childWireframes?: unknown })?.childWireframes),
    0
  );
}

function compact(value: unknown, max = 80): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function classify(event: AnyEvent): { kind: EventKind; summary: string } {
  const data = event.data ?? {};
  switch (event.type) {
    case TYPE_FULL_SNAPSHOT:
      return {
        kind: "full-snapshot",
        summary: `full snapshot · ${countWireframes(data.wireframes)} wireframes`,
      };
    case TYPE_META:
      return {
        kind: "screen",
        summary: `screen ${data.href ?? "?"} · ${data.width}×${data.height}`,
      };
    case TYPE_INCREMENTAL: {
      const source = data.source as number;
      switch (source) {
        case SOURCE_MOUSE_INTERACTION: {
          const label = TOUCH_INTERACTIONS[data.type as number] ?? "interaction";
          return { kind: "touch", summary: `${label} at (${data.x}, ${data.y})` };
        }
        case SOURCE_MOUSE_MOVE:
        case SOURCE_TOUCH_MOVE:
        case SOURCE_DRAG:
          return { kind: "touch", summary: "touch move" };
        case SOURCE_SCROLL:
          return { kind: "touch", summary: `scroll to (${data.x}, ${data.y})` };
        case SOURCE_INPUT:
          return { kind: "keyboard", summary: `input "${compact(data.text, 40)}"` };
        case SOURCE_MUTATION: {
          const len = (key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]).length : 0);
          return {
            kind: "incremental",
            summary: `mutation · +${len("adds")} −${len("removes")} ~${len("attributes") + len("texts")}`,
          };
        }
        default:
          return { kind: "incremental", summary: `incremental · source ${source}` };
      }
    }
    case TYPE_CUSTOM: {
      const tag = String(data.tag ?? "custom");
      const payload = data.payload;
      if (tag === "keyboard") {
        return { kind: "keyboard", summary: `keyboard ${compact(payload, 60)}` };
      }
      if (tag === "network" || tag.startsWith("rrweb/network")) {
        const p = (payload ?? {}) as Record<string, unknown>;
        return {
          kind: "network",
          summary: `${p.method ?? "?"} ${compact(p.url ?? p.name ?? "", 60)} ${p.status ?? ""}`.trim(),
        };
      }
      return { kind: "log", summary: `${tag} ${compact(payload, 70)}` };
    }
    case TYPE_PLUGIN: {
      const plugin = String(data.plugin ?? "");
      if (plugin.includes("network")) {
        return { kind: "network", summary: `network ${compact(data.payload, 60)}` };
      }
      return { kind: "log", summary: `${plugin || "plugin"} ${compact(data.payload, 60)}` };
    }
    default:
      return { kind: "other", summary: `type ${event.type}` };
  }
}

export function classifyEvents(rawEvents: unknown[], sessionStartTs: number): InspectorEvent[] {
  return rawEvents.map((raw, index) => {
    const event = raw as AnyEvent;
    const { kind, summary } = classify(event);
    const timestamp = event.timestamp ?? sessionStartTs;
    return {
      index,
      timestamp,
      offsetMs: timestamp - sessionStartTs,
      kind,
      summary,
      // Summary + raw body, so text search reaches into payloads.
      search: `${kind} ${summary} ${JSON.stringify(event.data ?? "")}`.toLowerCase(),
      raw,
    };
  });
}

export function filterEvents(
  events: InspectorEvent[],
  filters: InspectorFilters
): InspectorEvent[] {
  const query = filters.query.trim().toLowerCase();
  const types = filters.types;
  if (!query && types.length === 0) return events;
  return events.filter(
    (e) =>
      (types.length === 0 || types.includes(e.kind)) &&
      (!query || e.search.includes(query))
  );
}

/** Index (within `events`) of the row at the playhead, or -1. */
export function findActiveIndex(events: InspectorEvent[], currentOffsetMs: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].offsetMs <= currentOffsetMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/** "1:23.4" — offset with tenths, for dense row alignment. */
export function formatOffset(ms: number): string {
  const tenths = Math.floor((Math.max(0, ms) % 1000) / 100);
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}.${tenths}`;
}
