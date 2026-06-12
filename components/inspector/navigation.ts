import type { EventKind, InspectorEvent } from "./filters";

/**
 * Navigation derivation (the "Navigation" tab): folds the session's
 * `screen` log events (enter/exit of activities and fragments, as the
 * OpenLog SDK emits them) into a chronological journey of screen visits.
 * Fragments nest under the activity visit that hosts them. Pure and
 * order-preserving, like the inspector's classifyEvents.
 */

export interface ScreenVisit {
  /** Stable key: position in derivation order across parents and children. */
  id: number;
  name: string;
  kind: "activity" | "fragment";
  enterMs: number;
  /** Exit event offset, or the next enter, or session end while still open. */
  exitMs: number;
  /** Seek target: enter offset snapped over a trailing full snapshot. */
  seekMs: number;
  /** 1-based: how many times this screen name has been entered so far. */
  visitNumber: number;
  /** Fragment visits hosted inside this activity visit. */
  children: ScreenVisit[];
}

interface ScreenPayload {
  action?: string;
  name?: string;
  kind?: string;
  parent?: string;
}

const TYPE_CUSTOM = 5;

function screenPayload(event: InspectorEvent): ScreenPayload | null {
  const raw = event.raw as {
    type?: number;
    data?: { tag?: unknown; payload?: ScreenPayload };
  };
  if (raw?.type !== TYPE_CUSTOM || raw.data?.tag !== "screen") return null;
  return raw.data.payload ?? null;
}

// A screen enter is trailed by its full snapshot within capture latency;
// seeking exactly to the enter would show the previous screen. Same snap
// the inspector's row-click uses.
const SNAPSHOT_SNAP_MS = 150;

function snapSeek(events: InspectorEvent[], enterIndex: number): number {
  const enterMs = events[enterIndex].offsetMs;
  let target = enterMs;
  for (
    let i = enterIndex + 1;
    i < events.length && events[i].offsetMs - enterMs <= SNAPSHOT_SNAP_MS;
    i++
  ) {
    if (events[i].kind === "full-snapshot") target = events[i].offsetMs;
  }
  return target;
}

export function deriveNavigation(
  events: InspectorEvent[],
  sessionEndMs: number
): ScreenVisit[] {
  const visits: ScreenVisit[] = [];
  const enterCounts = new Map<string, number>();
  const end = Math.max(
    sessionEndMs,
    events.length > 0 ? events[events.length - 1].offsetMs : 0
  );
  let nextId = 0;
  let activity: ScreenVisit | null = null;
  let fragment: ScreenVisit | null = null;

  const open = (
    name: string,
    kind: "activity" | "fragment",
    enterIndex: number
  ): ScreenVisit => {
    const count = (enterCounts.get(name) ?? 0) + 1;
    enterCounts.set(name, count);
    return {
      id: nextId++,
      name,
      kind,
      enterMs: events[enterIndex].offsetMs,
      exitMs: end,
      seekMs: snapSeek(events, enterIndex),
      visitNumber: count,
      children: [],
    };
  };

  events.forEach((event, i) => {
    const p = screenPayload(event);
    if (!p?.name) return;
    const t = event.offsetMs;

    if (p.action === "enter") {
      if (p.kind === "fragment") {
        if (fragment) fragment.exitMs = t;
        fragment = open(p.name, "fragment", i);
        // Orphan fragments (no host activity seen) surface top-level
        // rather than vanish.
        if (activity) activity.children.push(fragment);
        else visits.push(fragment);
      } else {
        if (fragment) {
          fragment.exitMs = t;
          fragment = null;
        }
        if (activity) activity.exitMs = Math.min(activity.exitMs, t);
        activity = open(p.name, "activity", i);
        visits.push(activity);
      }
    } else if (p.action === "exit") {
      if (fragment && fragment.name === p.name) {
        fragment.exitMs = t;
        fragment = null;
      } else if (activity && activity.name === p.name) {
        if (fragment) {
          fragment.exitMs = t;
          fragment = null;
        }
        activity.exitMs = t;
        activity = null;
      }
    }
  });

  return visits;
}

/**
 * Id of the visit at the playhead, preferring an active fragment over its
 * host. The last-entered screen stays active through transition gaps (after
 * its exit, before the next enter), matching what the replay shows. -1
 * before the first enter.
 */
export function findActiveVisitId(visits: ScreenVisit[], offsetMs: number): number {
  let parent: ScreenVisit | undefined;
  for (const v of visits) {
    if (v.enterMs <= offsetMs) parent = v;
    else break;
  }
  if (!parent) return -1;
  let child: ScreenVisit | undefined;
  for (const c of parent.children) {
    if (c.enterMs <= offsetMs) child = c;
    else break;
  }
  if (child && offsetMs < child.exitMs) return child.id;
  return parent.id;
}

// What "the user did on this screen": interactions and app logs. Rendering
// internals (snapshots, mutations, meta) are replay plumbing, not actions.
const USER_EVENT_KINDS = new Set<EventKind>(["touch", "keyboard", "log", "network"]);

/**
 * The user events that took place during a visit's window. Half-open
 * [enter, exit) so boundary events belong to the next screen — except a
 * visit still open at session end keeps its closing events. Events inside
 * a fragment window belong to the fragment, not the host activity, so a
 * host and its children partition the host's window without duplication.
 */
export function visitEvents(
  events: InspectorEvent[],
  visit: ScreenVisit,
  sessionEndMs: number
): InspectorEvent[] {
  const inWindow = (v: ScreenVisit, t: number) =>
    t >= v.enterMs && (t < v.exitMs || (t === v.exitMs && v.exitMs >= sessionEndMs));
  return events.filter((e) => {
    if (!USER_EVENT_KINDS.has(e.kind)) return false;
    // The enter/exit logs ARE the visits — redundant inside them.
    if (screenPayload(e)) return false;
    if (!inWindow(visit, e.offsetMs)) return false;
    return !visit.children.some((c) => inWindow(c, e.offsetMs));
  });
}

/** "3.4s", "42s", "1:05" — dwell durations. */
export function formatDwell(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
