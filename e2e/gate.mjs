/**
 * T8 — end-to-end gate (SPEC Part 4).
 *
 * Full round-trip: Android FileSessionSink NDJSON → POST /api/ingest →
 * open /s/[id] in a real browser → assert it replays and the inspector
 * lists / filters / seeks — and masked fields stay masked end-to-end.
 *
 * Run: pnpm e2e   (one-time setup: pnpm exec playwright install chromium)
 * Spawns its own dev server on :3199 and cleans up the session it creates.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { rmSync } from "node:fs";

import "dotenv/config";
import { chromium } from "playwright";

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const FIXTURE_PATH = "fixtures/sample-session.ndjson";
const SESSION_ID = `e2e-gate-${Date.now()}`;
const TOKEN = process.env.INGEST_TOKEN;

const fixture = readFileSync(FIXTURE_PATH, "utf8");
const fixtureLines = fixture.trim().split("\n");
const maskedInFixture = (fixture.match(/\*\*\*/g) ?? []).length;

const steps = [];
function step(name, ok, detail = "") {
  steps.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`Gate failed at: ${name}`);
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/sessions?limit=1`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Dev server did not come up");
}

if (!TOKEN) {
  console.error("INGEST_TOKEN missing — set it in .env");
  process.exit(1);
}

const server = spawn("pnpm", ["dev", "--port", String(PORT)], {
  stdio: "ignore",
  detached: true,
});
let browser;

try {
  await waitForServer();
  console.log(`dev server up on :${PORT}, session id: ${SESSION_ID}\n`);

  // ---- 1. Ingest the SDK NDJSON ----
  const ingestRes = await fetch(`${BASE}/api/ingest`, {
    method: "POST",
    body: fixture,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/x-ndjson",
      "x-openlog-session-id": SESSION_ID,
      "x-openlog-app": "com.example.e2e",
      "x-openlog-sdk": "0.1.0",
      "x-openlog-batch-seq": "1",
      "x-openlog-device": JSON.stringify({
        os: "Android",
        osVersion: "15",
        model: "Pixel 9",
        density: 2.625,
        w: 411,
        h: 923,
        appVersion: "1.0.0",
      }),
    },
  });
  const ingestBody = await ingestRes.json();
  step(
    "ingest accepts FileSessionSink NDJSON",
    ingestRes.status === 202 && ingestBody.received === fixtureLines.length,
    `202, received ${ingestBody.received}/${fixtureLines.length}`
  );

  // ---- 2. Session appears in the list API ----
  const listBody = await (await fetch(`${BASE}/api/sessions?limit=100`)).json();
  step(
    "session appears in the list",
    listBody.items.some((s) => s.id === SESSION_ID)
  );

  // ---- 3. Open /s/[id] in a real browser ----
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/s/${SESSION_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".replayer-wrapper iframe", { timeout: 20_000 });
  step("player mounts the replay iframe", true);

  const inspector = '[data-testid="inspector-list"]';
  await page.waitForSelector(`${inspector} [data-index]`);
  const counter = () => page.locator("text=/^\\d+\\/\\d+$/").textContent();
  step(
    "inspector lists every event",
    (await counter()) === `${fixtureLines.length}/${fixtureLines.length}`,
    await counter()
  );

  // ---- 4. Masked fields stay masked end-to-end ----
  const frame = page.frames().find((f) => f.parentFrame() !== null);
  const maskedInReplay = await frame.evaluate(
    () => (document.body?.innerHTML.match(/\*\*\*/g) ?? []).length
  );
  step("masked text renders as asterisks in the replay", maskedInReplay > 0, `${maskedInReplay} on first frame`);

  await page.getByLabel("Search events").fill("***");
  const maskedRows = Number((await counter()).split("/")[0]);
  step(
    "masked values are masked in stored events (inspector search '***')",
    maskedRows > 0,
    `${maskedRows} rows; fixture had ${maskedInFixture} occurrences`
  );
  await page.getByLabel("Search events").fill("");

  // ---- 5. It replays: play → clock advances ----
  const timeText = () => page.locator("span.tabular-nums").first().textContent();
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(1500);
  const advanced = (await timeText()) !== "0:00 / 0:18";
  await page.getByRole("button", { name: /Play|Pause/ }).first().click();
  step("playback advances the clock", advanced, await timeText());

  // ---- 6. Inspector seeks the player ----
  const row = page.locator(`${inspector} [data-index="20"]`);
  const rowOffset = await row.locator("span.font-mono").textContent();
  await row.locator("button[title]").click();
  await page.waitForTimeout(400);
  const afterSeek = await timeText();
  step(
    "clicking a row seeks the player",
    afterSeek.startsWith(rowOffset.split(".")[0]),
    `row ${rowOffset} → clock ${afterSeek}`
  );

  // ---- 7. Filters ----
  await page.getByRole("button", { name: "touch", exact: true }).click();
  await page.waitForTimeout(300);
  const [touchShown, total] = (await counter()).split("/").map(Number);
  const badges = await page.locator(`${inspector} [data-slot="badge"]`).allTextContents();
  step(
    "type filter narrows the list to touch events",
    touchShown > 0 && touchShown < total && badges.every((b) => b === "touch"),
    `${touchShown}/${total}`
  );
  await page.getByRole("button", { name: "touch", exact: true }).click();

  // ---- 8. Expanding a row shows the raw JSON ----
  await page.locator(`${inspector} [data-index="0"]`).getByLabel(/Expand event JSON/).click();
  const expanded = await page.locator(`${inspector} [data-index="0"]`).textContent();
  step(
    "expanded row shows the raw event JSON",
    expanded.includes("timestamp") && expanded.includes("app_lifecycle")
  );

  step("no uncaught page errors", pageErrors.length === 0, pageErrors.join("; ") || "none");

  console.log(`\nT8 gate: ${steps.length}/${steps.length} steps passed ✅`);
} catch (err) {
  console.error(`\nT8 gate FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
  // Clean up the session this run created (row + blobs).
  try {
    execSync(`pnpm exec prisma db execute --stdin`, {
      input: `DELETE FROM "Session" WHERE id = '${SESSION_ID}';`,
      stdio: ["pipe", "ignore", "ignore"],
    });
    rmSync(`${process.env.BLOB_FS_DIR ?? ".data/blobs"}/sessions/${SESSION_ID}`, {
      recursive: true,
      force: true,
    });
    console.log(`cleaned up ${SESSION_ID}`);
  } catch {
    console.warn(`cleanup failed — remove session ${SESSION_ID} manually`);
  }
}
