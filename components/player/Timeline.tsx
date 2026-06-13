"use client";

import { Slider } from "@/components/ui/slider";
import { usePlayerStore } from "@/stores/playerStore";

export function Timeline() {
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const controls = usePlayerStore((s) => s.controls);
  const ready = usePlayerStore((s) => s.status) === "ready";

  return (
    <Slider
      aria-label="Timeline"
      className="cursor-pointer data-disabled:cursor-default"
      disabled={!ready}
      min={0}
      max={Math.max(durationMs, 1)}
      step={100}
      value={[Math.min(currentTimeMs, durationMs)]}
      onValueChange={(value) => {
        const next = Array.isArray(value) ? value[0] : value;
        controls?.seek(next);
      }}
    />
  );
}
