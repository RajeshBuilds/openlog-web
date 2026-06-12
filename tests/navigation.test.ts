import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classifyEvents } from "../components/inspector/filters";
import {
  deriveNavigation,
  findActiveVisitId,
  formatDwell,
  visitEvents,
} from "../components/inspector/navigation";

const RAW = readFileSync("fixtures/sample-05.ndjson", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const START = Math.min(...RAW.map((e) => e.timestamp));
const END = Math.max(...RAW.map((e) => e.timestamp)) - START;
const EVENTS = classifyEvents(RAW, START);
const VISITS = deriveNavigation(EVENTS, END);

describe("deriveNavigation", () => {
  it("derives the activity journey in order", () => {
    expect(VISITS.map((v) => v.name)).toEqual([
      "MainActivity",
      "LoginActivity",
      "MainActivity",
      "FragmentHostActivity",
      "MainActivity",
    ]);
    expect(VISITS.every((v) => v.kind === "activity")).toBe(true);
  });

  it("numbers revisits per screen name", () => {
    expect(VISITS.map((v) => v.visitNumber)).toEqual([1, 1, 2, 1, 3]);
  });

  it("nests fragment visits under their host activity", () => {
    const host = VISITS[3];
    expect(host.children.map((c) => c.name)).toEqual([
      "AccountsFragment",
      "TransactionsFragment",
    ]);
    expect(host.children.every((c) => c.kind === "fragment")).toBe(true);
    // Fragments live inside the host's time window.
    for (const c of host.children) {
      expect(c.enterMs).toBeGreaterThanOrEqual(host.enterMs);
      expect(c.exitMs).toBeLessThanOrEqual(host.exitMs);
    }
  });

  it("produces ordered, non-negative dwell windows within the session", () => {
    let prevEnter = -1;
    for (const v of VISITS) {
      expect(v.enterMs).toBeGreaterThan(prevEnter);
      expect(v.exitMs).toBeGreaterThanOrEqual(v.enterMs);
      expect(v.exitMs).toBeLessThanOrEqual(END);
      prevEnter = v.enterMs;
    }
  });

  it("keeps a still-open final visit running to session end", () => {
    expect(VISITS[VISITS.length - 1].exitMs).toBe(END);
  });

  it("snaps seek targets forward over the trailing full snapshot", () => {
    const snapshotOffsets = EVENTS.filter((e) => e.kind === "full-snapshot").map(
      (e) => e.offsetMs
    );
    for (const v of VISITS) {
      expect(v.seekMs).toBeGreaterThanOrEqual(v.enterMs);
      expect(v.seekMs - v.enterMs).toBeLessThanOrEqual(150);
      if (v.seekMs !== v.enterMs) {
        expect(snapshotOffsets).toContain(v.seekMs);
      }
    }
  });
});

describe("findActiveVisitId", () => {
  it("is -1 before the first screen enter", () => {
    expect(findActiveVisitId(VISITS, VISITS[0].enterMs - 1)).toBe(-1);
  });

  it("hands off exactly at the transition boundary", () => {
    expect(findActiveVisitId(VISITS, VISITS[0].enterMs)).toBe(VISITS[0].id);
    // The fixture's exits share a timestamp with the next enter: the old
    // screen is active right up to the boundary, the new one from it.
    expect(findActiveVisitId(VISITS, VISITS[1].enterMs - 1)).toBe(VISITS[0].id);
    expect(findActiveVisitId(VISITS, VISITS[1].enterMs)).toBe(VISITS[1].id);
  });

  it("prefers an active fragment over its host activity", () => {
    const host = VISITS[3];
    const frag = host.children[0];
    expect(findActiveVisitId(VISITS, frag.enterMs + 1)).toBe(frag.id);
    // After the fragment exits but inside the host, the host is active.
    const between = (host.children[0].exitMs + host.children[1].enterMs) / 2;
    if (between > host.children[0].exitMs && between < host.children[1].enterMs) {
      expect(findActiveVisitId(VISITS, between)).toBe(host.id);
    }
  });
});

describe("visitEvents", () => {
  const USER_KINDS = new Set(["touch", "keyboard", "log", "network"]);
  const isScreenLog = (e: { raw: unknown }) => {
    const raw = e.raw as { type?: number; data?: { tag?: unknown } };
    return raw?.type === 5 && raw.data?.tag === "screen";
  };

  it("returns only user-event kinds, never the screen enter/exit logs", () => {
    for (const v of VISITS) {
      for (const e of visitEvents(EVENTS, v, END)) {
        expect(USER_KINDS.has(e.kind)).toBe(true);
        expect(isScreenLog(e)).toBe(false);
        expect(e.offsetMs).toBeGreaterThanOrEqual(v.enterMs);
        expect(e.offsetMs).toBeLessThanOrEqual(v.exitMs);
      }
    }
  });

  it("captures the login keystrokes inside the LoginActivity visit", () => {
    const login = visitEvents(EVENTS, VISITS[1], END);
    expect(login.some((e) => e.kind === "keyboard")).toBe(true);
    expect(login.some((e) => e.kind === "touch")).toBe(true);
  });

  it("hands events during a fragment window to the fragment, not the host", () => {
    const host = VISITS[3];
    const hostEvents = visitEvents(EVENTS, host, END);
    const fragEvents = host.children.map((c) => visitEvents(EVENTS, c, END));
    // No host event falls inside any fragment window.
    for (const e of hostEvents) {
      for (const c of host.children) {
        expect(e.offsetMs >= c.enterMs && e.offsetMs < c.exitMs).toBe(false);
      }
    }
    // The fragments actually claim events, and nothing is double-counted.
    expect(fragEvents.flat().length).toBeGreaterThan(0);
    const all = [...hostEvents, ...fragEvents.flat()].map((e) => e.index);
    expect(new Set(all).size).toBe(all.length);
  });

  it("a visit still open at session end keeps its closing events", () => {
    const last = VISITS[VISITS.length - 1];
    const lastEvents = visitEvents(EVENTS, last, END);
    const userEventsAfterEnter = EVENTS.filter(
      (e) =>
        USER_KINDS.has(e.kind) && !isScreenLog(e) && e.offsetMs >= last.enterMs
    );
    expect(lastEvents.map((e) => e.index)).toEqual(
      userEventsAfterEnter.map((e) => e.index)
    );
  });
});

describe("formatDwell", () => {
  it("formats sub-10s with tenths, then whole seconds, then m:ss", () => {
    expect(formatDwell(3400)).toBe("3.4s");
    expect(formatDwell(42_000)).toBe("42s");
    expect(formatDwell(65_000)).toBe("1:05");
    expect(formatDwell(-5)).toBe("0.0s");
  });
});
