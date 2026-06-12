import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateEvent } from "../lib/schema/validateEvent";

describe("rr-mobile schema validation against the SDK fixture", () => {
  const lines = readFileSync("fixtures/sample-05.ndjson", "utf8").trim().split("\n");

  it("accepts every event the Android SDK emitted (incl. className/idName extensions)", () => {
    const failures = lines
      .map((line, i) => ({ i, result: validateEvent(JSON.parse(line)) }))
      .filter(({ result }) => !result.valid);
    expect(failures, JSON.stringify(failures.slice(0, 3))).toEqual([]);
  });

  it("rejects a malformed event", () => {
    const { valid, error } = validateEvent({ type: 999, timestamp: "not-a-number" });
    expect(valid).toBe(false);
    expect(error).toBeTruthy();
  });
});
