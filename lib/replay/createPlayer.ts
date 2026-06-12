import { Replayer } from "rrweb";

import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  type eventWithTime,
  type metaEvent,
} from "@rrweb/types";

import { chunkMutationSnapshot } from "./snapshotProcessing/chunk-large-mutations";
import {
  createSegments,
  mapSnapshotsToWindowId,
  mergeInactiveSegments,
} from "./snapshotProcessing/segmenter";
import { transformToWeb } from "./transformer";
import type { RecordingSegment, RecordingSnapshot } from "./types";

/**
 * Player core (SPEC T4), modeled on PostHog's
 * common/replay-headless/src/replayer-factory.ts (createReplayer): rr-mobile
 * events → transformToWeb → segments → rrweb Replayer.
 *
 * Our events arrive uncompressed and ordered from the serve API, so the
 * PostHog source-wrapper pipeline (processAllSnapshots) is not needed —
 * transformToWeb is called directly, as the upstream code allows.
 */

// Mirrors PostHog's COMMON_REPLAYER_CONFIG: keep the replay iframe
// scriptless — allow-scripts + allow-same-origin would let recorded content
// escape the sandbox into the app origin.
const BASE_REPLAYER_CONFIG = {
  triggerFocus: false,
  UNSAFE_replayCanvas: false,
  mouseTail: false,
  useVirtualDom: false,
} as const;

/** Single mobile recording = single window. */
const WINDOW_ID = 1;

export interface CreatePlayerOptions {
  speed?: number;
  /** Extra rrweb Replayer config (T5 passes UI-driven options through). */
  replayerConfig?: Record<string, unknown>;
}

export interface PlayerMeta {
  startTime: number;
  endTime: number;
  durationMs: number;
  /** Recorded device viewport, from the first Meta event. */
  width: number;
  height: number;
}

export interface PlayerHandle {
  replayer: Replayer;
  events: eventWithTime[];
  /** Activity segments (for skip-inactivity and timeline shading in T5). */
  segments: RecordingSegment[];
  play(timeOffsetMs?: number): void;
  pause(timeOffsetMs?: number): void;
  /** Seeks without changing the play/pause state. */
  seek(timeOffsetMs: number): void;
  isPlaying(): boolean;
  getMeta(): PlayerMeta;
  destroy(): void;
}

/**
 * Transforms raw rr-mobile events into replayable rrweb web events:
 * chronological sort → mobile→web transform → oversized mutations chunked.
 */
export function transformSessionEvents(rawEvents: unknown[]): eventWithTime[] {
  const sorted = [...rawEvents].sort(
    (a, b) => (a as eventWithTime).timestamp - (b as eventWithTime).timestamp
  );
  return transformToWeb(sorted as eventWithTime[])
    .map((event) => ({ ...event, windowId: WINDOW_ID }))
    .flatMap((event) => chunkMutationSnapshot(event as RecordingSnapshot));
}

export function buildSegments(events: eventWithTime[]): RecordingSegment[] {
  if (events.length === 0) return [];
  const snapshots = events as RecordingSnapshot[];
  const raw = createSegments(
    snapshots,
    snapshots[0].timestamp,
    snapshots[snapshots.length - 1].timestamp,
    null,
    mapSnapshotsToWindowId(snapshots)
  );
  return mergeInactiveSegments(raw);
}

function findViewport(events: eventWithTime[]): { width: number; height: number } {
  const meta = events.find((e) => e.type === EventType.Meta) as metaEvent | undefined;
  return { width: meta?.data.width ?? 0, height: meta?.data.height ?? 0 };
}

export function createPlayer(
  rawEvents: unknown[],
  rootEl: HTMLElement,
  opts: CreatePlayerOptions = {}
): PlayerHandle {
  // rrweb 2.x builds a sandboxed iframe and requires a connected root —
  // a detached element fails deep inside rrweb-snapshot, so fail loudly here.
  if (!rootEl.isConnected) {
    throw new Error("createPlayer: rootEl must be connected to the document");
  }
  const events = transformSessionEvents(rawEvents);
  if (events.length < 2) {
    throw new Error(`Cannot create player: need at least 2 events, got ${events.length}`);
  }
  const segments = buildSegments(events);
  const viewport = findViewport(events);
  // rrweb only rebuilds the replay DOM when a FullSnapshot is cast. Seeking
  // to a point before the first full snapshot would cast none and leave a
  // stale later screen in the iframe — so such seeks route through the
  // first snapshot to land on the correct first screen.
  const firstSnapshot = events.find((e) => e.type === EventType.FullSnapshot);
  const firstSnapshotOffset = firstSnapshot
    ? firstSnapshot.timestamp - events[0].timestamp
    : 0;

  const replayer = new Replayer(events, {
    root: rootEl,
    ...BASE_REPLAYER_CONFIG,
    speed: opts.speed ?? 1,
    ...opts.replayerConfig,
  });

  let playing = false;

  // When rrweb jumps to an offset it discards everything before the latest
  // prior full snapshot, so the touch indicator's state (the .touch-active
  // ring) is only updated when a touch event happens to fall inside that
  // replayed window — otherwise the pre-jump state leaks through and a
  // stale ring lingers. Recompute it from the full event list instead.
  const sessionStart = events[0].timestamp;
  function syncTouchIndicator(timeOffsetMs: number): void {
    let active = false;
    for (const event of events) {
      if (event.timestamp - sessionStart > timeOffsetMs) break;
      if (event.type !== EventType.IncrementalSnapshot) continue;
      const data = event.data as { source?: number; type?: number };
      if (data.source !== IncrementalSource.MouseInteraction) continue;
      if (data.type === MouseInteractions.TouchStart) {
        active = true;
      } else if (
        data.type === MouseInteractions.TouchEnd ||
        data.type === MouseInteractions.TouchCancel ||
        data.type === MouseInteractions.MouseUp
      ) {
        active = false;
      }
    }
    rootEl.querySelector(".replayer-mouse")?.classList.toggle("touch-active", active);
  }

  return {
    replayer,
    events,
    segments,
    play(timeOffsetMs) {
      playing = true;
      replayer.play(timeOffsetMs);
      if (timeOffsetMs !== undefined) syncTouchIndicator(timeOffsetMs);
    },
    pause(timeOffsetMs) {
      playing = false;
      replayer.pause(timeOffsetMs);
      if (timeOffsetMs !== undefined) syncTouchIndicator(timeOffsetMs);
    },
    seek(timeOffsetMs) {
      if (timeOffsetMs < firstSnapshotOffset) {
        replayer.pause(firstSnapshotOffset + 1);
      }
      // Seeking is INCLUSIVE of events at exactly the target time: rrweb
      // sync-casts only events strictly before the offset, so without the
      // +1, clicking an inspector row whose timestamp it shares with a
      // following snapshot/meta event would show the state *before* that
      // event instead of after it.
      const target = timeOffsetMs + 1;
      if (playing) {
        replayer.play(target);
      } else {
        replayer.pause(target);
      }
      syncTouchIndicator(timeOffsetMs);
    },
    isPlaying: () => playing,
    getMeta() {
      const meta = replayer.getMetaData();
      return {
        startTime: meta.startTime,
        endTime: meta.endTime,
        durationMs: meta.totalTime,
        width: viewport.width,
        height: viewport.height,
      };
    },
    destroy() {
      playing = false;
      replayer.destroy();
    },
  };
}
