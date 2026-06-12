// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EventType } from "@rrweb/types";

import {
  buildSegments,
  createPlayer,
  transformSessionEvents,
} from "../lib/replay/createPlayer";

const RAW_EVENTS = readFileSync("fixtures/sample-session.ndjson", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const timestamps = RAW_EVENTS.map((e) => e.timestamp);
const EXPECTED_DURATION = Math.max(...timestamps) - Math.min(...timestamps);

describe("transformSessionEvents (mobile → rrweb web)", () => {
  const webEvents = transformSessionEvents(RAW_EVENTS);

  it("transforms full snapshots into rrweb DOM trees", () => {
    const fullSnapshots = webEvents.filter((e) => e.type === EventType.FullSnapshot);
    expect(fullSnapshots.length).toBeGreaterThan(0);
    for (const snapshot of fullSnapshots) {
      const data = snapshot.data as { node?: { type: number } };
      // A transformed full snapshot carries a serialized document node,
      // not mobile wireframes.
      expect(data.node).toBeDefined();
      expect(JSON.stringify(data)).not.toContain("wireframes");
    }
  });

  it("keeps masked text masked (asterisks survive the transform)", () => {
    const serialized = JSON.stringify(webEvents);
    expect(serialized).toContain("***");
    // The transformer must never restore PII; the fixture's masked fields
    // arrive as *** and must leave as ***.
    const maskedInFixture = (readFileSync("fixtures/sample-session.ndjson", "utf8").match(/\*\*\*/g) ?? []).length;
    expect((serialized.match(/\*\*\*/g) ?? []).length).toBeGreaterThanOrEqual(maskedInFixture);
  });

  it("renders a masked image (no base64 payload) as a placeholder", () => {
    const masked = transformSessionEvents([
      {
        type: 2,
        timestamp: 1781246538367,
        data: {
          wireframes: [
            { id: 99, type: "image", x: 0, y: 0, width: 100, height: 100 },
          ],
        },
      },
    ]);
    const serialized = JSON.stringify(masked);
    // PostHog's placeholder background (diagonal-stripe SVG data URI).
    expect(serialized).toContain("data:image/svg+xml;base64");
    expect(serialized).not.toContain('"tagName":"img"');
  });

  it("preserves chronological order and timestamps", () => {
    for (let i = 1; i < webEvents.length; i++) {
      expect(webEvents[i].timestamp).toBeGreaterThanOrEqual(webEvents[i - 1].timestamp);
    }
  });
});

describe("buildSegments", () => {
  it("produces activity segments covering the session", () => {
    const webEvents = transformSessionEvents(RAW_EVENTS);
    const segments = buildSegments(webEvents);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].startTimestamp).toBe(webEvents[0].timestamp);
    expect(segments[segments.length - 1].endTimestamp).toBe(
      webEvents[webEvents.length - 1].timestamp
    );
  });
});

describe("createPlayer", () => {
  // rrweb 2.x requires a connected root, so "detached" here means attached
  // to the document but offscreen — the closest 2.x allows to the original
  // acceptance wording.
  function offscreenRoot(): HTMLDivElement {
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "-9999px";
    document.body.appendChild(root);
    return root;
  }

  // jsdom recreates the iframe document after rrweb registers it, so rrweb's
  // sandbox check fails on the async snapshot rebuild. UNSAFE_replayCanvas is
  // the only config rrweb maps to its rebuild opt-out. jsdom-only — real
  // browsers (T5) use the sandboxed iframe path; never set this in app code.
  const JSDOM_OPTS = { replayerConfig: { UNSAFE_replayCanvas: true } };

  it("mounts a Replayer into an offscreen div and getMeta() is correct", () => {
    const root = offscreenRoot();
    const player = createPlayer(RAW_EVENTS, root, JSDOM_OPTS);

    expect(root.querySelector("iframe")).not.toBeNull();

    const meta = player.getMeta();
    expect(meta.durationMs).toBe(EXPECTED_DURATION);
    expect(meta.width).toBe(411);
    expect(meta.height).toBe(923);
    expect(meta.endTime - meta.startTime).toBe(EXPECTED_DURATION);

    player.destroy();
  });

  it("exposes play/pause/seek state", () => {
    const root = offscreenRoot();
    const player = createPlayer(RAW_EVENTS, root, JSDOM_OPTS);

    expect(player.isPlaying()).toBe(false);
    player.pause(0);
    expect(player.isPlaying()).toBe(false);
    player.seek(1000);
    expect(player.isPlaying()).toBe(false);

    player.destroy();
  });

  it("rejects sessions with fewer than 2 events", () => {
    const root = offscreenRoot();
    expect(() => createPlayer([RAW_EVENTS[0]], root)).toThrow(/at least 2 events/);
  });

  it("rejects a disconnected root with a clear error", () => {
    const root = document.createElement("div");
    expect(() => createPlayer(RAW_EVENTS, root)).toThrow(/connected to the document/);
  });
});
