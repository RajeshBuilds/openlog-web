"use client";

import { useState } from "react";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

/**
 * Pretty-printed, collapsible JSON tree — the "JSON logs viewer" body of an
 * expanded inspector row. Dependency-free; nodes below DEFAULT_OPEN_DEPTH
 * start collapsed so huge snapshots stay scannable.
 */

const DEFAULT_OPEN_DEPTH = 1;

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="text-emerald-700 dark:text-emerald-400">&quot;{value}&quot;</span>;
    case "number":
      return <span className="text-sky-700 dark:text-sky-400">{String(value)}</span>;
    case "boolean":
      return <span className="text-amber-700 dark:text-amber-400">{String(value)}</span>;
    default:
      return <span className="text-muted-foreground">{String(value)}</span>;
  }
}

function Node({
  name,
  value,
  depth,
}: {
  name: string | null;
  value: unknown;
  depth: number;
}) {
  const isObject = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < DEFAULT_OPEN_DEPTH);

  const label = name !== null && (
    <span className="text-violet-700 dark:text-violet-400">{name}: </span>
  );

  if (!isObject) {
    return (
      <div className="pl-4">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const preview = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="pl-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded hover:bg-muted"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        {label}
        <span className="text-muted-foreground">{preview}</span>
      </button>
      {open && (
        <div className="border-l border-border/60">
          {entries.map(([key, child]) => (
            <Node key={key} name={key} value={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="overflow-x-auto py-1 font-mono text-xs leading-5">
      <Node name={null} value={data} depth={0} />
    </div>
  );
}
