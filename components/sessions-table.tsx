"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsUpDown,
  Filter,
  Play,
  SearchX,
  Smartphone,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMs, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DeviceInfo {
  model?: string;
  os?: string;
  osVersion?: string;
}

export interface SessionRow {
  id: string;
  appId: string;
  device: unknown;
  startedAt: Date;
  durationMs: number;
  eventCount: number;
  screenCount: number;
}

type SortKey =
  | "id"
  | "appId"
  | "startedAt"
  | "durationMs"
  | "eventCount"
  | "screenCount";

type SortDir = "asc" | "desc";

interface Filters {
  id: string;
  appId: string;
  device: string;
}

const startedAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Direction a column takes on its first click: text A→Z, time/numbers
// biggest/newest-first.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  id: "asc",
  appId: "asc",
  startedAt: "desc",
  durationMs: "desc",
  eventCount: "desc",
  screenCount: "desc",
};

const FILTER_DEBOUNCE_MS = 350;

function toDevice(value: unknown): DeviceInfo | null {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return {
      model: typeof o.model === "string" ? o.model : undefined,
      os: typeof o.os === "string" ? o.os : undefined,
      osVersion: typeof o.osVersion === "string" ? o.osVersion : undefined,
    };
  }
  return null;
}

export function SessionsTable({
  items,
  sort,
  dir,
  filters,
}: {
  items: SessionRow[];
  sort: SortKey;
  dir: SortDir;
  filters: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Sorting and filtering live in the URL so they survive pagination and
  // reloads. Any change resets to the first page (drops the page param).
  const navigate = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams]
  );

  function onSort(key: SortKey) {
    const nextDir: SortDir =
      sort === key ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[key];
    navigate({ sort: key, dir: nextDir });
  }

  // Local draft for the filter inputs; committed to the URL after a debounce so
  // typing doesn't trigger a navigation per keystroke.
  const [draft, setDraft] = useState<Filters>(filters);

  // Keep the draft in sync when the committed (URL) filters change out of band —
  // pagination, back/forward, etc. Adjusting state during render is React's
  // recommended alternative to a syncing effect.
  const [committedFilters, setCommittedFilters] = useState(filters);
  if (
    committedFilters.id !== filters.id ||
    committedFilters.appId !== filters.appId ||
    committedFilters.device !== filters.device
  ) {
    setCommittedFilters(filters);
    setDraft(filters);
  }

  useEffect(() => {
    const changed =
      draft.id !== filters.id ||
      draft.appId !== filters.appId ||
      draft.device !== filters.device;
    if (!changed) return;
    const t = setTimeout(() => {
      navigate({
        fId: draft.id.trim(),
        fApp: draft.appId.trim(),
        fDevice: draft.device.trim(),
      });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, filters, navigate]);

  const sortState = { key: sort, dir };

  return (
    <div className="max-h-[65svh] overflow-auto rounded-xl border bg-card shadow-xs lg:max-h-none lg:min-h-0 lg:flex-1">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <SortHeader
              label="Session"
              sortKey="id"
              sort={sortState}
              onSort={onSort}
              filter={
                <ColumnFilter
                  label="session"
                  value={draft.id}
                  onChange={(v) => setDraft((f) => ({ ...f, id: v }))}
                />
              }
            />
            <SortHeader
              label="App"
              sortKey="appId"
              sort={sortState}
              onSort={onSort}
              filter={
                <ColumnFilter
                  label="app"
                  value={draft.appId}
                  onChange={(v) => setDraft((f) => ({ ...f, appId: v }))}
                />
              }
            />
            <TableHead className="h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              <div className="flex items-center gap-1">
                Device
                <ColumnFilter
                  label="device"
                  value={draft.device}
                  onChange={(v) => setDraft((f) => ({ ...f, device: v }))}
                />
              </div>
            </TableHead>
            <SortHeader
              label="Started"
              sortKey="startedAt"
              sort={sortState}
              onSort={onSort}
            />
            <SortHeader
              label="Duration"
              sortKey="durationMs"
              sort={sortState}
              onSort={onSort}
              align="right"
            />
            <SortHeader
              label="Events"
              sortKey="eventCount"
              sort={sortState}
              onSort={onSort}
              align="right"
            />
            <SortHeader
              label="Screens"
              sortKey="screenCount"
              sort={sortState}
              onSort={onSort}
              align="right"
            />
            <TableHead className="h-11 w-10 px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={8} className="px-4 py-16">
                <div className="flex flex-col items-center justify-center gap-2 text-center">
                  <SearchX className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">No matching sessions</p>
                  <p className="text-xs text-muted-foreground">
                    Try adjusting or clearing the column filters.
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            items.map((session) => {
              const device = toDevice(session.device);
              return (
                <TableRow key={session.id} className="group relative">
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:text-primary">
                        <Play className="size-3.5 fill-current" />
                      </div>
                      <Link
                        href={`/s/${encodeURIComponent(session.id)}`}
                        className="font-mono text-[13px] font-medium after:absolute after:inset-0"
                      >
                        {session.id}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Badge
                      variant="secondary"
                      className="font-mono text-[11px] font-normal text-muted-foreground"
                    >
                      {session.appId}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {device?.model ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Smartphone className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>{device.model}</span>
                        <span className="text-muted-foreground">
                          {`${device.os ?? ""} ${device.osVersion ?? ""}`.trim()}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">
                        {formatRelative(new Date(session.startedAt))}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {startedAtFormat.format(new Date(session.startedAt))}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right font-mono text-[13px] tabular-nums">
                    {formatMs(session.durationMs)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                    {session.eventCount.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                    {session.screenCount.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  filter,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  filter?: ReactNode;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      className={cn(
        "h-11 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase",
        align === "right" && "text-right"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1",
          align === "right" && "justify-end"
        )}
      >
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn(
            "inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-foreground",
            align === "right" && "flex-row-reverse",
            active && "text-foreground"
          )}
        >
          {label}
          {active ? (
            sort.dir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )
          ) : (
            <ChevronsUpDown className="size-3 opacity-40" />
          )}
        </button>
        {filter}
      </div>
    </TableHead>
  );
}

function ColumnFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const active = Boolean(value.trim());
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Filter by ${label}`}
        className={cn(
          "relative inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
          active && "text-foreground"
        )}
      >
        <Filter className={cn("size-3", active && "fill-current")} />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Filter ${label}…`}
            className="h-7 text-xs normal-case"
          />
          {active && (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Clear"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
