"use client";

import { useEffect } from "react";

import { usePlayerStore } from "@/stores/playerStore";

import type { PlayerHandle } from "./createPlayer";

/**
 * Wires a PlayerHandle to the Zustand store: user intents (store.controls)
 * flow down to the replayer; playback position flows back up via a rAF
 * loop. Skip-inactivity follows PostHog's playback-controller.ts — poll the
 * playhead each frame and jump over segments marked inactive.
 *
 * Modeled on common/replay-headless/src/playback-controller.ts and the
 * behavior of frontend's sessionRecordingPlayerLogic.
 */
export function usePlaybackController(handle: PlayerHandle | null): void {
  useEffect(() => {
    if (!handle) return;

    const store = usePlayerStore.getState();
    const meta = handle.getMeta();
    store.setDuration(meta.durationMs);

    const clamp = (ms: number) => Math.max(0, Math.min(ms, meta.durationMs));
    const currentOffset = () => clamp(handle.replayer.getCurrentTime());

    let raf = 0;
    const tick = () => {
      const state = usePlayerStore.getState();
      const offset = currentOffset();
      state.setCurrentTime(offset);

      if (state.isPlaying && state.skipInactive) {
        const ts = meta.startTime + offset;
        const inactive = handle.segments.find(
          (seg) => !seg.isActive && ts >= seg.startTimestamp && ts < seg.endTimestamp
        );
        if (inactive) {
          handle.play(clamp(inactive.endTimestamp - meta.startTime));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onFinish = () => {
      const state = usePlayerStore.getState();
      handle.pause(meta.durationMs);
      state.setIsPlaying(false);
      state.setCurrentTime(meta.durationMs);
    };
    handle.replayer.on("finish", onFinish);

    store.bindControls({
      play() {
        const state = usePlayerStore.getState();
        // Restart from the top when play is hit at the end.
        const at = state.currentTimeMs >= meta.durationMs ? 0 : state.currentTimeMs;
        handle.play(at);
        state.setIsPlaying(true);
      },
      pause() {
        handle.pause(currentOffset());
        usePlayerStore.getState().setIsPlaying(false);
      },
      togglePlay() {
        const controls = usePlayerStore.getState().controls;
        if (usePlayerStore.getState().isPlaying) controls?.pause();
        else controls?.play();
      },
      seek(timeOffsetMs) {
        const state = usePlayerStore.getState();
        const at = clamp(timeOffsetMs);
        handle.seek(at);
        state.setCurrentTime(at);
        state.notifySeek();
      },
      setSpeed(speed) {
        handle.replayer.setConfig({ speed });
        usePlayerStore.getState().setSpeed(speed);
      },
      setSkipInactive(skip) {
        usePlayerStore.getState().setSkipInactive(skip);
      },
    });

    return () => {
      cancelAnimationFrame(raf);
      handle.replayer.off("finish", onFinish);
      usePlayerStore.getState().bindControls(null);
    };
  }, [handle]);
}
