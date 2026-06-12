"use client";

import { memo } from "react";

import { ChevronRightIcon } from "lucide-react";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { JsonTree } from "./JsonTree";
import { KIND_LABELS, formatOffset, type EventKind, type InspectorEvent } from "./filters";

export const KIND_BADGE_CLASS: Record<EventKind, string> = {
  "full-snapshot": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  incremental: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  touch: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  keyboard: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  screen: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  log: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  network: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  other: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export interface EventRowProps {
  event: InspectorEvent;
  isActive: boolean;
  isExpanded: boolean;
  onSeek(event: InspectorEvent): void;
  onToggleExpand(index: number): void;
}

/** One inspector row: offset · kind badge · summary, expandable to raw JSON. */
export const EventRow = memo(function EventRow({
  event,
  isActive,
  isExpanded,
  onSeek,
  onToggleExpand,
}: EventRowProps) {
  return (
    <div
      data-active={isActive || undefined}
      className={cn(
        "group relative border-b border-border/60 text-[13px] transition-colors",
        isActive
          ? "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary"
          : "hover:bg-muted/50"
      )}
    >
      <div className="flex w-full items-center gap-2 px-2 py-2">
        <button
          type="button"
          aria-label={isExpanded ? "Collapse event JSON" : "Expand event JSON"}
          aria-expanded={isExpanded}
          onClick={() => onToggleExpand(event.index)}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform duration-200",
              isExpanded && "rotate-90"
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => onSeek(event)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Seek player to this event"
        >
          <span
            className={cn(
              "w-16 shrink-0 font-mono tabular-nums",
              isActive ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            {formatOffset(event.offsetMs)}
          </span>
          <Badge
            className={cn(
              "w-24 shrink-0 justify-center border-transparent font-mono text-[11px] font-medium",
              KIND_BADGE_CLASS[event.kind]
            )}
          >
            {KIND_LABELS[event.kind]}
          </Badge>
          <span className="truncate text-foreground/90">{event.summary}</span>
        </button>
      </div>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="border-t border-border/40 bg-muted/30 px-2">
            <JsonTree data={event.raw} />
          </div>
        </motion.div>
      )}
    </div>
  );
});
