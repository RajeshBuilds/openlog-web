"use client";

import { useRef, useState } from "react";

import {
  AlertCircle,
  Braces,
  FileText,
  FileUp,
  ListTree,
  LoaderCircle,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";

import { SessionWorkspace } from "@/components/session/SessionWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMs } from "@/lib/format";
import {
  NdjsonParseError,
  parseNdjson,
  summarizeEvents,
  type NdjsonStats,
} from "@/lib/replay/parseNdjson";
import { cn } from "@/lib/utils";

interface LoadedSession {
  fileName: string;
  events: unknown[];
  stats: NdjsonStats;
}

/**
 * Client-side NDJSON preview. Reads a recording file in the browser, parses it
 * with the same one-object-per-line contract the ingest API uses, and plays it
 * in a full-screen player dialog — without ever uploading to the backend.
 */
export function ManualUpload() {
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setIsParsing(true);
    try {
      const events = parseNdjson(await file.text());
      setLoaded({ fileName: file.name, events, stats: summarizeEvents(events) });
      setOpen(true);
    } catch (err) {
      setLoaded(null);
      setError(
        err instanceof NdjsonParseError || err instanceof Error
          ? err.message
          : "Could not read this file."
      );
    } finally {
      setIsParsing(false);
    }
  }

  return (
    <section className="flex flex-col rounded-xl border bg-card shadow-xs lg:h-full">
      <div className="border-b px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
            <FileUp className="size-4" />
          </span>
          <h2 className="text-xl font-semibold tracking-tight">Quick Preview</h2>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          Inspect a recording without uploading it. The file is parsed right in
          your browser and opened in the full session player — handy for a quick
          look at an <code className="font-mono">.ndjson</code> export before it
          ever reaches the backend.
        </p>
      </div>

      <div className="flex flex-1 flex-col p-5 lg:min-h-0 lg:overflow-y-auto">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          disabled={isParsing}
          className={cn(
            "group/drop flex w-full shrink-0 flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 text-center transition-all duration-200",
            "hover:border-primary/50 hover:bg-primary/3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            loaded ? "min-h-40 py-8" : "min-h-48 flex-1 py-12",
            isDragging
              ? "border-primary bg-primary/5 ring-4 ring-primary/10"
              : "border-border",
            isParsing && "pointer-events-none opacity-70"
          )}
        >
          <div
            className={cn(
              "flex size-16 items-center justify-center rounded-2xl border bg-linear-to-b from-background to-muted text-muted-foreground shadow-sm transition-all duration-200",
              "group-hover/drop:-translate-y-0.5 group-hover/drop:text-foreground group-hover/drop:shadow-md",
              isDragging && "-translate-y-0.5 border-primary/40 text-primary shadow-md"
            )}
          >
            {isParsing ? (
              <LoaderCircle className="size-7 animate-spin" />
            ) : (
              <FileUp className="size-7" />
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold tracking-tight">
              {isParsing ? "Parsing…" : "Drop file or click to browse"}
            </p>
            <p className="mx-auto max-w-60 text-xs leading-relaxed text-muted-foreground">
              Only accepts{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                .ndjson
              </code>{" "}
              exports from the OpenLog Android SDK
            </p>
          </div>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".ndjson,.jsonl,application/x-ndjson,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {loaded && (
          <div className="mt-4 shrink-0 rounded-xl border bg-card p-3.5 shadow-xs">
            <div className="flex items-start gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] font-medium">
                  {loaded.fileName}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>
                    {loaded.stats.eventCount.toLocaleString("en-US")} events
                  </span>
                  <span aria-hidden className="text-border">•</span>
                  <span>{formatMs(loaded.stats.durationMs)}</span>
                  {loaded.stats.screenCount > 0 && (
                    <>
                      <span aria-hidden className="text-border">•</span>
                      <span>{loaded.stats.screenCount} screens</span>
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear"
                onClick={() => {
                  setLoaded(null);
                  setError(null);
                }}
              >
                <X />
              </Button>
            </div>
            <Button
              size="sm"
              className="mt-3 w-full"
              onClick={() => setOpen(true)}
            >
              <Play className="size-3.5 fill-current" />
              Play recording
            </Button>
          </div>
        )}

        <div className="mt-6 shrink-0 border-t pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            How it works
          </p>
          <ul className="mt-3.5 space-y-3.5">
            <li className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border/60">
                <ShieldCheck className="size-4" />
              </span>
              <div className="space-y-0.5 pt-0.5">
                <p className="text-[13px] font-medium">Stays on your device</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The file never leaves the browser — nothing is uploaded or
                  stored on the server.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border/60">
                <Braces className="size-4" />
              </span>
              <div className="space-y-0.5 pt-0.5">
                <p className="text-[13px] font-medium">SDK-native format</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Reads the same rr-mobile NDJSON the OpenLog SDK posts to{" "}
                  <code className="font-mono">/api/ingest</code>.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border/60">
                <ListTree className="size-4" />
              </span>
              <div className="space-y-0.5 pt-0.5">
                <p className="text-[13px] font-medium">Full player & inspector</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Replay with the timeline, navigation flow, and event inspector
                  — just like a stored session.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogDescription className="sr-only">
            Local preview of an uploaded NDJSON recording. This file is not
            uploaded to the server.
          </DialogDescription>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
              <Play className="size-3.5 fill-current" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate font-mono text-[13px]">
                {loaded?.fileName ?? "Recording"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Local preview · not uploaded
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {loaded && (
                <>
                  <Badge
                    variant="outline"
                    className="hidden bg-background font-mono text-[11px] font-normal text-muted-foreground sm:inline-flex"
                  >
                    {loaded.stats.eventCount.toLocaleString("en-US")} events
                  </Badge>
                  <Badge
                    variant="outline"
                    className="hidden bg-background font-mono text-[11px] font-normal text-muted-foreground sm:inline-flex"
                  >
                    {formatMs(loaded.stats.durationMs)}
                  </Badge>
                </>
              )}
              <DialogClose
                render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}
              >
                <X />
              </DialogClose>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {loaded && <SessionWorkspace events={loaded.events} />}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
