import { create } from "zustand";

/**
 * Shared player/inspector state (SPEC layout). Components subscribe to
 * slices — playback state flows replayer → store (via usePlaybackController)
 * and user intents flow component → controls → replayer. Never prop-drill.
 */

export type PlayerStatus = "idle" | "loading" | "ready" | "error";

export interface PlayerControls {
  play(): void;
  pause(): void;
  togglePlay(): void;
  /** Seek to an absolute offset (ms from session start). */
  seek(timeOffsetMs: number): void;
  setSpeed(speed: number): void;
  setSkipInactive(skip: boolean): void;
}

export interface InspectorFilters {
  /** Event-kind keys (see T6 inspector); empty = all. */
  types: string[];
  query: string;
}

interface PlayerStoreState {
  status: PlayerStatus;
  error: string | null;
  loadProgress: { loaded: number; total: number } | null;

  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  skipInactive: boolean;

  /** Index of the selected event in the session's event list (T6). */
  selectedEventId: number | null;
  filters: InspectorFilters;

  /** Raw rr-mobile events as loaded — shared with the inspector (T6). */
  rawEvents: unknown[] | null;
  /** Session start = first event timestamp (epoch ms). */
  sessionStartTs: number;

  /** Bound by usePlaybackController while a player is mounted. */
  controls: PlayerControls | null;

  /**
   * Bumped whenever a seek is initiated from the inspector/navigation, so the
   * responsive layout can surface the (otherwise hidden) player on small
   * screens. A nonce rather than a boolean so repeat selections re-trigger.
   */
  playerRevealNonce: number;

  /**
   * Bumped on every user-initiated seek (seekbar, inspector row, navigation),
   * so the inspector can scroll the event at the new playhead into view even
   * while paused. A nonce so re-seeking to the same event still re-triggers.
   */
  seekNonce: number;

  setStatus(status: PlayerStatus, error?: string): void;
  setLoadProgress(loaded: number, total: number): void;
  setCurrentTime(ms: number): void;
  setDuration(ms: number): void;
  setIsPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  setSkipInactive(skip: boolean): void;
  setSelectedEventId(id: number | null): void;
  setFilters(filters: Partial<InspectorFilters>): void;
  setRawEvents(events: unknown[]): void;
  bindControls(controls: PlayerControls | null): void;
  revealPlayer(): void;
  notifySeek(): void;
  reset(): void;
}

const initialState = {
  status: "idle" as PlayerStatus,
  error: null,
  loadProgress: null,
  currentTimeMs: 0,
  durationMs: 0,
  isPlaying: false,
  speed: 1,
  skipInactive: true,
  selectedEventId: null,
  filters: { types: [], query: "" },
  rawEvents: null,
  sessionStartTs: 0,
  controls: null,
  playerRevealNonce: 0,
  seekNonce: 0,
};

export const usePlayerStore = create<PlayerStoreState>((set) => ({
  ...initialState,

  setStatus: (status, error) => set({ status, error: error ?? null }),
  setLoadProgress: (loaded, total) => set({ loadProgress: { loaded, total } }),
  setCurrentTime: (currentTimeMs) => set({ currentTimeMs }),
  setDuration: (durationMs) => set({ durationMs }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setSpeed: (speed) => set({ speed }),
  setSkipInactive: (skipInactive) => set({ skipInactive }),
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),
  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  setRawEvents: (rawEvents) =>
    set({
      rawEvents,
      sessionStartTs: rawEvents.reduce<number>((min, e) => {
        const ts = (e as { timestamp?: number }).timestamp;
        return typeof ts === "number" && ts < min ? ts : min;
      }, Number.POSITIVE_INFINITY),
    }),
  bindControls: (controls) => set({ controls }),
  revealPlayer: () => set((s) => ({ playerRevealNonce: s.playerRevealNonce + 1 })),
  notifySeek: () => set((s) => ({ seekNonce: s.seekNonce + 1 })),
  reset: () => set(initialState),
}));
