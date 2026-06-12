"use client";

import { FastForwardIcon, PauseIcon, PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMs } from "@/lib/format";
import { usePlayerStore } from "@/stores/playerStore";

const SPEEDS = [0.5, 1, 2, 4, 8];

export function Controls() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const speed = usePlayerStore((s) => s.speed);
  const skipInactive = usePlayerStore((s) => s.skipInactive);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const controls = usePlayerStore((s) => s.controls);
  const ready = usePlayerStore((s) => s.status) === "ready";

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              variant="default"
              className="rounded-full shadow-sm"
              disabled={!ready}
              onClick={() => controls?.togglePlay()}
              aria-label={isPlaying ? "Pause" : "Play"}
            />
          }
        >
          {isPlaying ? (
            <PauseIcon className="fill-current" />
          ) : (
            <PlayIcon className="fill-current" />
          )}
        </TooltipTrigger>
        <TooltipContent>{isPlaying ? "Pause" : "Play"}</TooltipContent>
      </Tooltip>

      <span className="font-mono text-[13px] tabular-nums">
        <span className="font-medium text-foreground">{formatMs(currentTimeMs)}</span>
        <span className="text-muted-foreground"> / {formatMs(durationMs)}</span>
      </span>

      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant={skipInactive ? "secondary" : "ghost"}
                className={skipInactive ? "" : "text-muted-foreground"}
                disabled={!ready}
                onClick={() => controls?.setSkipInactive(!skipInactive)}
                aria-pressed={skipInactive}
              />
            }
          >
            <FastForwardIcon /> Skip inactivity
          </TooltipTrigger>
          <TooltipContent>
            {skipInactive ? "Playing through inactive gaps is off" : "Jump over inactive gaps"}
          </TooltipContent>
        </Tooltip>

        <Select
          value={String(speed)}
          onValueChange={(value) => controls?.setSpeed(Number(value))}
          disabled={!ready}
        >
          <SelectTrigger size="sm" aria-label="Playback speed">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
