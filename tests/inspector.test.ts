import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyEvents,
  filterEvents,
  findActiveIndex,
  formatOffset,
} from "../components/inspector/filters";

const RAW = readFileSync("fixtures/sample-05.ndjson", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const START = Math.min(...RAW.map((e) => e.timestamp));
const EVENTS = classifyEvents(RAW, START);

describe("classifyEvents", () => {
  it("lists every event with offset and kind", () => {
    expect(EVENTS).toHaveLength(RAW.length);
    expect(EVENTS[0].offsetMs).toBe(0);
    for (const e of EVENTS) {
      expect(e.offsetMs).toBeGreaterThanOrEqual(0);
      expect(e.summary.length).toBeGreaterThan(0);
    }
  });

  it("maps rr-mobile types to badge kinds", () => {
    const kinds = new Set(EVENTS.map((e) => e.kind));
    expect(kinds.has("full-snapshot")).toBe(true); // type 2
    expect(kinds.has("screen")).toBe(true); // type 4 meta
    expect(kinds.has("touch")).toBe(true); // incremental source 2
    expect(kinds.has("log")).toBe(true); // type 5 custom
    // The fixture's "keyboard" custom tag classifies as keyboard.
    expect(EVENTS.some((e) => e.kind === "keyboard")).toBe(true);
  });

  it("keeps the raw event verbatim for the JSON tree", () => {
    expect(EVENTS[3].raw).toBe(RAW[3]);
  });
});

describe("filterEvents", () => {
  it("filters by kind", () => {
    const touches = filterEvents(EVENTS, { types: ["touch"], query: "" });
    expect(touches.length).toBeGreaterThan(0);
    expect(touches.every((e) => e.kind === "touch")).toBe(true);
  });

  it("filters by text query into payloads", () => {
    const hits = filterEvents(EVENTS, { types: [], query: "mainactivity" });
    expect(hits.length).toBeGreaterThan(0);
    const misses = filterEvents(EVENTS, { types: [], query: "zzz-not-present" });
    expect(misses).toHaveLength(0);
  });

  it("combines kind + query and is a no-op when both empty", () => {
    expect(filterEvents(EVENTS, { types: [], query: "" })).toBe(EVENTS);
    const combined = filterEvents(EVENTS, { types: ["log"], query: "screen" });
    expect(combined.every((e) => e.kind === "log" && e.search.includes("screen"))).toBe(true);
  });
});

describe("findActiveIndex", () => {
  it("returns the last event at or before the playhead", () => {
    expect(findActiveIndex(EVENTS, -1)).toBe(-1);
    expect(findActiveIndex(EVENTS, 0)).toBeGreaterThanOrEqual(0);
    const mid = EVENTS[40].offsetMs;
    const idx = findActiveIndex(EVENTS, mid);
    expect(EVENTS[idx].offsetMs).toBeLessThanOrEqual(mid);
    expect(idx + 1 === EVENTS.length || EVENTS[idx + 1].offsetMs > mid).toBe(true);
    expect(findActiveIndex(EVENTS, 10 ** 12)).toBe(EVENTS.length - 1);
  });
});

describe("formatOffset", () => {
  it("formats with tenths", () => {
    expect(formatOffset(0)).toBe("0:00.0");
    expect(formatOffset(83_456)).toBe("1:23.4");
  });
});
