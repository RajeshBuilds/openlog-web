/**
 * Client-side NDJSON parsing for the manual-upload preview path. Mirrors the
 * server's `parseNdjson` in lib/ingest.ts (one JSON object per line), but runs
 * entirely in the browser so an uploaded recording can be played without ever
 * touching the backend. Tolerates trailing whitespace, blank lines, and a
 * leading byte-order mark.
 */

export interface NdjsonStats {
  /** Number of parsed events. */
  eventCount: number;
  /** Span between the first and last event timestamp, in ms. */
  durationMs: number;
  /** Distinct screen names entered (rr-mobile `screen` custom events). */
  screenCount: number;
}

export class NdjsonParseError extends Error {
  /** 1-based line number that failed to parse, when applicable. */
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = "NdjsonParseError";
    this.line = line;
  }
}

/** Parses NDJSON text into an array of raw rr-mobile events. */
export function parseNdjson(text: string): unknown[] {
  const events: unknown[] = [];
  const lines = text.replace(/^\uFEFF/, "").split("\n");

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      throw new NdjsonParseError(
        `Invalid JSON on line ${index + 1}.`,
        index + 1
      );
    }
  }

  if (events.length < 2) {
    throw new NdjsonParseError(
      `A playable recording needs at least 2 events; found ${events.length}.`
    );
  }

  return events;
}

/** Derives lightweight summary stats for display, defensively. */
export function summarizeEvents(events: unknown[]): NdjsonStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  // Distinct screen names entered — mirrors the Navigation tab's notion of a
  // screen (type 5 `screen` custom event with action "enter"), so a recording
  // that revisits screens or re-snapshots doesn't inflate the count.
  const screens = new Set<string>();

  for (const event of events) {
    const e = event as {
      type?: number;
      timestamp?: number;
      data?: {
        tag?: string;
        payload?: { action?: string; name?: string };
      };
    };
    if (typeof e.timestamp === "number") {
      if (e.timestamp < min) min = e.timestamp;
      if (e.timestamp > max) max = e.timestamp;
    }
    if (
      e.type === 5 &&
      e.data?.tag === "screen" &&
      e.data.payload?.action === "enter" &&
      e.data.payload.name
    ) {
      screens.add(e.data.payload.name);
    }
  }

  return {
    eventCount: events.length,
    durationMs: Number.isFinite(min) && Number.isFinite(max) ? max - min : 0,
    screenCount: screens.size,
  };
}
