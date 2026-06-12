# OpenLog — Web App (Replay Engine + JSON Logs Viewer) & Ingest API · Build Spec for Claude Code

> **Scope:** a **Next.js (App Router, TypeScript) application** that (a) ingests recorded sessions published by the OpenLog Android SDK, (b) replays them with an rrweb-based player, and (c) shows a **JSON logs viewer** (timeline-synced event/log inspector). The backend is implemented as **Next.js route handlers** + a storage layer.
> **Out of scope:** the AI/agentic layer, Crashlytics/Splunk correlation, analytics dashboards. (Separate specs.)
> **Reference (read-only, MIT):** `PostHog/posthog` monorepo. **Adopt** the transformer + rrweb (vendor them); **reimplement** the player UI and inspector in plain React (PostHog uses Kea + its own design system — model behavior, don't port). Never use anything under `ee/`.
> **Inputs already fixed:** the Android SDK emits the **rr-mobile wire schema** (see the Android spec, Part 2). The web app consumes that exact schema — it is the contract between the two halves.

---

## PART 1 — HOW TO DRIVE THIS WITH CLAUDE CODE

Put this file in the repo as `SPEC.md` and these golden rules in `CLAUDE.md`:

```text
# OpenLog Web App — golden rules (do not violate)
1. The player CONSUMES the rr-mobile schema the SDK emits. Do not invent a new format.
2. ADOPT, don't rebuild: vendor PostHog's MIT mobile transformer + snapshot-processing and rrweb.
   Reimplement only the React UI (player shell + inspector) in plain React — no Kea, no PostHog UI lib.
3. The transformer is PII-neutral; masking already happened at capture. Never add code that would
   un-mask. Do not log raw event bodies server-side beyond storing them.
4. Storage is behind an ADAPTER: local FS + Postgres in dev; Cloudflare R2 (S3-compatible API) +
   Neon Postgres in prod. Never hardcode a storage backend in routes or components.
5. UI stack: shadcn/ui (Base UI + Tailwind, "base-nova" style) for ALL app chrome; state via Zustand (or React Context for
   trivial cases). NEVER use Kea, Lemon UI, or any PostHog UI code — PostHog is reference for behavior only.
   The replay itself renders inside rrweb's iframe and is NOT styled with Tailwind/shadcn.
6. The ingest endpoint contract (Part 3) is the SECOND fixed contract. The SDK's HttpSessionSink posts
   to it; do not change its shape without updating the SDK spec.
7. Large sessions load as BLOCKS/chunks, not one giant payload (reference PostHog's snapshot-source model).
8. DEPLOYMENT TARGET IS VERCEL: request/response bodies on Vercel functions are hard-capped at 4.5 MB.
   Ingest batches must stay under ~3.5 MB (reject larger with 413 + advice); serve snapshots in blocks
   under the cap; support R2 presigned PUT upload as the large-batch path.
9. Implement tasks T0..T9 in order; each must pass its acceptance criteria before the next.
10. Reference the PostHog files named in Part 7. Read them; reimplement; cite MIT in THIRD_PARTY_NOTICES.
11. FINAL DELIVERABLE includes DEPLOYMENT.md (task T9): a step-by-step guide to deploy on Vercel with
    Neon Postgres + Cloudflare R2. Generate it from the actual code you built (real env var names,
    real commands), not generic boilerplate.
```

**Workflow:** scaffold (T0) → storage (T1) → ingest API (T2) → serve API (T3) → player core (T4) → player UI (T5) → JSON logs viewer (T6) → session list (T7) → end-to-end gate (T8) → deployment guide (T9). Keep `PostHog/posthog` checked out locally as reference.

**Done when:** an NDJSON file produced by the Android SDK's `FileSessionSink` can be POSTed to the ingest API, appears in the session list, replays faithfully in the player with masked fields masked, and every event is browsable/filterable/seekable in the JSON logs viewer — and `DEPLOYMENT.md` exists such that the app deploys to Vercel + Neon + R2 by following it alone.

---

## PART 2 — ARCHITECTURE

```
Android SDK ──POST /api/ingest──▶  Next.js route handlers ──▶ Storage adapter
   (or R2 presigned PUT for big batches)        │              (Neon Postgres meta + Cloudflare R2 blobs)
   Browser ◀──pages/api── Next.js  ◀──────┘
   /s/[id]:  Player (rrweb + transformer)  +  JSON Logs Viewer (inspector)
```

**Stack:** Next.js App Router · TypeScript · **shadcn/ui (Base UI + Tailwind)** for app chrome · **Zustand** for player/inspector shared state · Prisma + Postgres (metadata; **Neon** in prod) · object store via S3-compatible API (**Cloudflare R2** in prod, local-FS adapter in dev; use `@aws-sdk/client-s3` pointed at the R2 endpoint) · `zod` (validation) · vendored `@posthog/replay-shared` (transformer + snapshot-processing) · `rrweb` / `posthog-js/rrweb` (renderer). **Hosting: Vercel.**

**Repo layout**
```
app/
 ├─ page.tsx                         # session list (T7)
 ├─ s/[sessionId]/page.tsx           # player + logs viewer (T5,T6)
 └─ api/
     ├─ ingest/route.ts             # POST recorded data (T2)
     └─ sessions/
         ├─ route.ts                # GET list (T3)
         └─ [id]/
             ├─ route.ts            # GET metadata (T3)
             └─ snapshots/route.ts  # GET event blocks (T3)
lib/
 ├─ replay/   transformer/ (vendored), snapshotProcessing/ (vendored),
 │            createPlayer.ts, viewportScaler.ts, usePlaybackController.ts
 ├─ storage/  index.ts (adapter iface), prismaRepo.ts, blobStore.ts (r2|fs)
 ├─ schema/   rr-mobile-schema.json (vendored), validateEvent.ts
 └─ types.ts
components/
 ├─ ui/        # shadcn/ui components (copied in via `npx shadcn add`)
 ├─ player/   Player.tsx, Controls.tsx, Timeline.tsx
 └─ inspector/ Inspector.tsx, EventRow.tsx, JsonTree.tsx, filters.ts
stores/playerStore.ts                 # Zustand: currentTime, isPlaying, speed, selectedEventId, filters
DEPLOYMENT.md                          # generated in T9
prisma/schema.prisma
```

---

## PART 3 — THE INGEST CONTRACT (second fixed contract)

The SDK's `HttpSessionSink` publishes batches. Define exactly:

```http
POST /api/ingest
Authorization: Bearer <app-write-token>
Content-Type: application/x-ndjson           # or application/json (array)
X-OpenLog-Session-Id: <sessionId>
X-OpenLog-App: <appId>   X-OpenLog-Sdk: <version>
X-OpenLog-Device: <json: os, osVersion, model, density, w, h, appVersion>   # first batch

<event>\n<event>\n<event>\n ...                # rr-mobile events, in order
```
- **Response:** `202 Accepted` `{ "sessionId", "received": <n> }`. Invalid event → `400` with the failing index. Bad token → `401`. Body over the batch cap → `413` `{ "error", "maxBatchBytes" }`.
- **Vercel constraint (hard):** function bodies are capped at 4.5 MB. Enforce a **~3.5 MB max batch size** server-side and document it for the SDK (`HttpSessionSink` must flush by size as well as count). For oversized payloads provide the **large-batch path**: `POST /api/ingest/presign` → returns a Cloudflare R2 presigned PUT URL; client uploads the NDJSON batch directly to R2; then `POST /api/ingest/commit { sessionId, objectKey }` validates + registers it. Same auth on all three routes.
- **Server behavior:** validate each event against `rr-mobile-schema.json`; **append** to the session's blob (ordered); upsert session metadata (create on first batch using the device header; update `eventCount`, `endedAt`, derived `durationMs`, `screenCount` from Meta events). Idempotency: dedupe on `(sessionId, batchSeq)` if the SDK sends a sequence header.
- Reference for the source/block storage model (so reads scale): `@posthog/replay-shared` → `SessionRecordingSnapshotSource` / `parseJsonSnapshots`, and `common/replay-headless/src/data-loader.ts` (block fetching with retry/concurrency).

---

## PART 4 — TASKS

### T0 — Scaffold
Next.js App Router + TS + ESLint; **Tailwind + shadcn/ui init** (`npx shadcn init`, then add: button, table, badge, tabs, input, select, slider, dialog, tooltip, scroll-area, collapsible); deps (prisma, @prisma/client, zustand, zod, rrweb, p-limit, @aws-sdk/client-s3). `.env`: `DATABASE_URL` (Neon in prod, local Postgres/Docker in dev), `BLOB_BACKEND=fs|r2`, `INGEST_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. **Acceptance:** dev server runs; `/` and `/s/[id]` render placeholders using shadcn components.

### T1 — Storage adapter
`prisma/schema.prisma`: `Session { id, appId, sdkVersion, device Json, startedAt, endedAt, durationMs, eventCount, screenCount, blobKey, createdAt }`. `blobStore.ts` with `put/append/getRange/list/presignPut` and two impls: `fs` (under `.data/`, dev) and `r2` (Cloudflare R2 via `@aws-sdk/client-s3` with `endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `region: "auto"`; note R2 has no server-side append — model "append" as numbered batch objects per session, e.g. `sessions/<id>/batch-<seq>.ndjson`, listed and concatenated in order on read). `index.ts` exposes a `Storage` interface combining the Prisma repo + blob store. **Acceptance:** unit test writes + reads a session blob + metadata via the adapter; swapping `BLOB_BACKEND` needs no route changes.

### T2 — Ingest API (`POST /api/ingest`)
Implement Part 3. Stream-parse NDJSON; validate with `validateEvent.ts` (ajv or zod compiled from `rr-mobile-schema.json`); append ordered events to the blob; upsert metadata (derive duration/screens from Meta + timestamps). Auth via `INGEST_TOKEN`. **Acceptance:** POST an SDK `FileSessionSink` NDJSON → `202`, session row created, blob stored; a malformed event → `400` naming the index; missing token → `401`.

### T3 — Serve API
- `GET /api/sessions?cursor=&limit=` → list (id, app, device, startedAt, durationMs, eventCount).
- `GET /api/sessions/[id]` → metadata.
- `GET /api/sessions/[id]/snapshots?block=N` → returns event **block** N (chunked, e.g. by event count or byte size), with a header giving total block count. Model the block contract on PostHog's snapshot-source/block loading so the player can stream large sessions. **Acceptance:** list paginates; snapshots return ordered events in blocks; an unknown id → `404`.

### T4 — Player core (adopt transformer + rrweb)
Vendor `@posthog/replay-shared` mobile transformer + snapshot-processing into `lib/replay/`; vendor/install rrweb. Implement `createPlayer(events, rootEl, opts)` modeled on `common/replay-headless/src/replayer-factory.ts` (`createReplayer`): run snapshot-processing / `transformToWeb` (mobile→rrweb) → `createSegments` → `new Replayer(webEvents, { root, mouseTail:false, ... })`. Expose `play/pause/seek/getMeta/destroy`. **Note:** our events are uncompressed rr-mobile; you can call `transformToWeb` directly if `processAllSnapshots` assumes PostHog's source wrapper. **Acceptance:** given a stored session's events, the function mounts a Replayer into a detached div and `getMeta()` returns correct duration/dimensions; masked text shows as asterisks, masked images as placeholders.

### T5 — Player UI
`components/player/Player.tsx` mounts `createPlayer` into a ref'd container the way `frontend/src/scenes/session-recordings/player/PlayerFrame.tsx` does; `viewportScaler.ts` (ref `common/replay-headless/src/viewport-scaler.ts`) scales the replay to fit; `usePlaybackController.ts` (ref `playback-controller.ts` + `sessionRecordingPlayerLogic.ts`) drives play/pause/seek/speed/skip-inactivity. `Controls.tsx` + `Timeline.tsx` for the transport bar (shadcn button/slider/tooltip; playback state in `stores/playerStore.ts` via Zustand — components subscribe, never prop-drill). Load events via `GET /snapshots` in blocks (ref `data-loader.ts`). **Acceptance:** a session plays, scrubs, changes speed, and resizes correctly in the browser.

### T6 — JSON Logs Viewer (the inspector)
`components/inspector/Inspector.tsx`: a **timeline-synced, filterable list** of the session's events, modeled on `frontend/src/scenes/session-recordings/player/inspector/` (`PlayerInspectorList.tsx`, `playerInspectorLogic.ts`, `miniFiltersLogic.ts`, and item components `ItemEvent.tsx` / `ItemLog.tsx` / `ItemConsoleLog.tsx`). Requirements:
- One row per event: timestamp (offset from session start), type badge (full-snapshot / incremental / touch / keyboard / log / network), and a one-line summary.
- **Type + text filters** (mini-filters) and search.
- Click a row → **seek the player** to that timestamp; the row at the current playhead is highlighted as playback advances (two-way sync with `usePlaybackController`).
- Expand a row → **pretty-printed, collapsible JSON tree** of the raw event (`JsonTree.tsx`; build on shadcn collapsible or a lightweight viewer). This is the "JSON logs viewer." Build the list/controls with shadcn (table/badge/tabs/input/scroll-area); virtualize long lists; sync selection + playhead through the Zustand store.
**Acceptance:** all events are listed and filterable; clicking seeks; the active row tracks playback; expanding shows correct raw JSON.

### T7 — Session list
`app/page.tsx`: table from `GET /api/sessions` (app, device, start, duration, event count) linking to `/s/[id]`. **Acceptance:** ingested sessions appear and open.

### T8 — End-to-end gate
Script/integration: take an Android `FileSessionSink` NDJSON → `POST /api/ingest` → open `/s/[id]` → assert it replays and the inspector lists/filters/seeks. **Acceptance:** full round-trip passes; masked fields remain masked end-to-end.

### T9 — Generate DEPLOYMENT.md (a deliverable, not an afterthought)
Write `DEPLOYMENT.md` from the **actual built code** — real env var names, real commands, real file paths. It must cover, step by step:
1. **Neon Postgres:** create project; get the pooled connection string; set `DATABASE_URL` (use the pooled/`-pooler` URL for serverless; direct URL as `DIRECT_URL` for `prisma migrate`); run `npx prisma migrate deploy`.
2. **Cloudflare R2:** create bucket; create an API token (Object Read & Write scoped to the bucket); collect `R2_ACCOUNT_ID/ACCESS_KEY/SECRET/BUCKET`; CORS config for presigned PUT from the SDK (and note R2 egress is free, which is why we chose it).
3. **Vercel:** import the repo; set all env vars (incl. `BLOB_BACKEND=r2`, `INGEST_TOKEN`); build settings (`prisma generate` in build, Node runtime for ingest routes — not Edge — since they use the AWS SDK); deploy; map a custom domain if desired.
4. **Limits & ops:** the 4.5 MB body cap and the ~3.5 MB batch rule for the SDK; route `maxDuration` notes; where logs live; how to rotate `INGEST_TOKEN` and R2 keys.
5. **Smoke test:** exact `curl` for `POST /api/ingest` with a sample NDJSON, then the URL to view it.
**Acceptance:** a teammate with no context can deploy from scratch following only `DEPLOYMENT.md`, and the smoke test passes on the deployed URL.

---

## PART 5 — NON-FUNCTIONAL
- **Access control:** ingest write-token; read side behind app auth (stub now, real RBAC later). Audit who opens which session (table) — sessions are real user recordings.
- **Scale seams:** block-based snapshot reads (T3) + concurrent fetch with retry (ref `data-loader.ts`); keep an events table/ClickHouse seam for future search.
- **Performance:** stream ingest (don't buffer whole bodies); lazy-load blocks in the player; virtualize the inspector list for long sessions.
- **Vercel runtime:** ingest/serve routes run on the Node runtime (AWS SDK for R2 needs it); respect the 4.5 MB body cap everywhere; long operations stay under function `maxDuration`.
- **Privacy:** never emit raw event bodies to logs/telemetry; transformer stays PII-neutral.

---

## PART 6 — LICENSING
Vendor (MIT, keep notices): PostHog mobile transformer + snapshot-processing (`common/replay-shared/src/mobile/`, `.../snapshot-processing/`), rrweb. Reimplement the React player + inspector in plain React (do not copy Kea logic verbatim). Do not touch `ee/`. Produce `THIRD_PARTY_NOTICES` (rrweb MIT, PostHog replay-shared MIT, plus npm deps).

---

## PART 7 — PostHog reference map (read-only)
**Transformer / processing (adopt):**
- `common/replay-shared/src/mobile/transformer/transformers.ts` — `transformToWeb` (mobile→rrweb).
- `common/replay-shared/src/snapshot-processing/` — `parseJsonSnapshots`, `processAllSnapshots`, `createSegments`.
- `frontend/src/scenes/session-recordings/mobile-replay/schema/mobile/rr-mobile-schema.json` — validation schema.

**Player assembly (model the logic, plain React):**
- `common/replay-headless/src/replayer-factory.ts` (`createReplayer`), `viewport-scaler.ts`, `playback-controller.ts`, `data-loader.ts` (block loading).
- `frontend/src/scenes/session-recordings/player/PlayerFrame.tsx`, `PurePlayer.tsx`, `sessionRecordingPlayerLogic.ts`, `snapshotDataLogic.tsx`.

**JSON logs viewer / inspector (model the UX):**
- `frontend/src/scenes/session-recordings/player/inspector/PlayerInspectorList.tsx`, `PlayerInspectorControls.tsx`, `playerInspectorLogic.ts`, `miniFiltersLogic.ts`, `inspectorListFiltering.ts`.
- item renderers: `components/ItemEvent.tsx`, `ItemLog.tsx`, `ItemConsoleLog.tsx`, `PlayerInspectorListItem.tsx`.

**Recording data/ingest shape (reference for storage/serve):**
- `@posthog/replay-shared` types: `SessionRecordingSnapshotSource`, `SessionRecordingSnapshotSourceResponse`.
- `common/replay-headless/src/data-loader.ts` (`loadAllSources`, block fetch + retry + concurrency).
