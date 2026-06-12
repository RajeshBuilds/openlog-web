# Deploying OpenLog Web (Vercel + Neon Postgres + Cloudflare R2)

Step-by-step guide to a production deployment, generated from this codebase
(env var names, commands, and limits below are the ones the code actually
uses). Total time: ~30 minutes.

**Architecture recap:** Next.js (App Router) on Vercel · session metadata in
Neon Postgres (via Prisma + `@prisma/adapter-pg`) · recorded event batches as
NDJSON objects in Cloudflare R2 (`sessions/<id>/batch-<seq>.ndjson`) · the
Android SDK authenticates to `POST /api/ingest` with a bearer token.

## Prerequisites

- A fork/clone of this repo pushed to GitHub/GitLab/Bitbucket
- Accounts: [Vercel](https://vercel.com), [Neon](https://neon.tech),
  [Cloudflare](https://dash.cloudflare.com) (R2 enabled)
- Locally: Node 20.9+, `pnpm` (only needed for the migration step)

## Environment variables (complete list)

| variable | value | used by |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (`...-pooler...`) | runtime Prisma client (`lib/storage/prismaRepo.ts`) |
| `DIRECT_URL` | Neon **direct** connection string (no `-pooler`) | `prisma migrate` only (`prisma.config.ts`) |
| `BLOB_BACKEND` | `r2` in prod (`fs` is local-dev only — Vercel's filesystem is read-only) | `lib/storage/blobStore.ts` |
| `INGEST_TOKEN` | long random secret, e.g. `openssl rand -hex 32` | all three `/api/ingest*` routes |
| `R2_ACCOUNT_ID` | Cloudflare account id | R2 endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | from the R2 API token | R2 S3 credentials |
| `R2_SECRET_ACCESS_KEY` | from the R2 API token | R2 S3 credentials |
| `R2_BUCKET` | bucket name, e.g. `openlog-sessions` | R2 bucket |

(`BLOB_FS_DIR` exists too but is dev-only — it relocates the `fs` backend's
`.data/blobs` directory.)

## 1. Neon Postgres

1. [console.neon.tech](https://console.neon.tech) → **New project** — name it
   (e.g. `openlog`), pick the region closest to your Vercel deployment.
2. On the project dashboard, open **Connect** and copy **two** connection
   strings for the same database/role:
   - the **pooled** one (host contains `-pooler`) → this is `DATABASE_URL`.
     Serverless functions open many short-lived connections; the pooler
     absorbs them.
   - the **direct** one (same host without `-pooler`) → this is `DIRECT_URL`.
     Migrations hold session-level locks that don't work through PgBouncer.
3. Run the migrations from your machine (this creates the `Session` table):

   ```bash
   pnpm install
   DIRECT_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require" \
     pnpm exec prisma migrate deploy
   ```

   Expected output: `1 migration found ... applied` (migration
   `20260612051534_init`).

## 2. Cloudflare R2

R2 is S3-compatible and has **zero egress fees** — which matters here because
the player re-downloads session blobs on every replay.

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket** → name it
   (e.g. `openlog-sessions`), location *Automatic*. This name is `R2_BUCKET`.
2. Note your **Account ID** (right sidebar of the R2 overview, or the dash
   URL) — this is `R2_ACCOUNT_ID`.
3. **R2 → Manage API tokens → Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: select **only** your bucket
   - TTL: forever (you'll rotate manually, see §5)
   - Create, then copy the **Access Key ID** (`R2_ACCESS_KEY_ID`) and
     **Secret Access Key** (`R2_SECRET_ACCESS_KEY`). The secret is shown once.
4. **CORS** — only needed if uploads ever come from a *browser*. The Android
   SDK's presigned PUT (`POST /api/ingest/presign` → direct PUT to R2) is a
   native HTTP call, which no CORS policy gates. If you later add a web SDK,
   set this on the bucket (Settings → CORS policy):

   ```json
   [
     {
       "AllowedOrigins": ["https://your-web-app.example.com"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

No other bucket config: objects are written by the app (`put`), never public;
presigned PUT URLs expire after **10 minutes** and are bound to
`Content-Type: application/x-ndjson`.

## 3. Vercel

1. [vercel.com/new](https://vercel.com/new) → import the repo. Framework
   preset **Next.js**; root directory is the repo root; leave build/install
   commands at defaults (Vercel detects pnpm from `pnpm-lock.yaml`; the
   `build` script already runs `prisma generate && next build`, which matters
   because the generated client lives in gitignored `lib/generated/prisma`).
   The repo's `pnpm-workspace.yaml` pre-approves Prisma's build scripts, so
   pnpm 10's script-blocking doesn't bite on CI.
2. Before the first deploy, add the env vars (Project → Settings →
   Environment Variables, all in **Production**):

   ```
   DATABASE_URL          = <Neon pooled string>
   DIRECT_URL            = <Neon direct string>
   BLOB_BACKEND          = r2
   INGEST_TOKEN          = <openssl rand -hex 32>
   R2_ACCOUNT_ID         = <account id>
   R2_ACCESS_KEY_ID      = <access key id>
   R2_SECRET_ACCESS_KEY  = <secret access key>
   R2_BUCKET             = openlog-sessions
   ```

3. **Deploy.** Runtime notes, already encoded in the code — verify, don't
   change:
   - Every API route exports `runtime = "nodejs"` (the AWS SDK used for R2
     does not run on Edge).
   - `app/api/ingest/route.ts` sets `maxDuration = 30`,
     `app/api/ingest/commit/route.ts` sets `maxDuration = 60` (it reads and
     validates presign-uploaded batches that can exceed the direct cap).
4. Custom domain (optional): Project → Settings → Domains → add e.g.
   `openlog.example.com`. The SDK's base URL is whatever you choose here.

## 4. Limits the SDK must respect

- **Vercel hard-caps request bodies at 4.5 MB.** The app enforces its own
  batch cap of **3,670,016 bytes (3.5 MiB)** at `POST /api/ingest` and
  rejects larger bodies with `413 {"error":"Batch too large",
  "maxBatchBytes":3670016}`. `HttpSessionSink` must flush **by size as well
  as by event count** (target ≤3 MiB per batch for headroom).
- Bigger batches use the large-batch path: `POST /api/ingest/presign` →
  `PUT` the NDJSON to the returned URL → `POST /api/ingest/commit`. Full
  contract: `docs/INGEST_API_SPEC.md`.
- Snapshot reads are served in blocks under the cap automatically
  (`GET /api/sessions/[id]/snapshots?block=N`).

## 5. Ops

- **Logs:** Vercel → Project → Logs (per-function). The app never logs raw
  event bodies — ingest errors log message text only (`lib/ingest.ts`),
  because sessions are real user recordings.
- **Rotate `INGEST_TOKEN`:** generate a new value, update the Vercel env var,
  redeploy (env changes need a redeploy), then roll the new token out to the
  Android app's config. The token is read per-request, so there's no cache to
  flush. During rollout, old-token SDKs get `401` and (per the SDK contract)
  retry later — batches are buffered, not lost.
- **Rotate R2 keys:** create a second API token (same scoping), swap the
  `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` env vars, redeploy, verify the
  smoke test, then revoke the old token in Cloudflare.
- **Database migrations** on schema changes:
  `DIRECT_URL=... pnpm exec prisma migrate deploy` (CI step or manual).
- **Read-side auth is a stub** (SPEC Part 5): `/`, `/s/[id]`, and the
  `GET /api/sessions*` routes are public. Until app auth lands, treat the
  deployment URL as sensitive or put Vercel's deployment protection /
  an access proxy in front of it.

## 6. Smoke test

From the repo root (it ships a real recorded session at
`fixtures/sample-05.ndjson`):

```bash
export BASE_URL="https://<your-deployment>.vercel.app"
export INGEST_TOKEN="<the value you set on Vercel>"

curl -i -X POST "$BASE_URL/api/ingest" \
  --data-binary @fixtures/sample-05.ndjson \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/x-ndjson" \
  -H "X-OpenLog-Session-Id: smoke-test-001" \
  -H "X-OpenLog-App: com.example.app" \
  -H "X-OpenLog-Sdk: 0.1.0" \
  -H "X-OpenLog-Batch-Seq: 1" \
  -H 'X-OpenLog-Device: {"os":"Android","osVersion":"15","model":"Pixel 9","density":2.625,"w":411,"h":923,"appVersion":"1.0.0"}'
```

Expected: `HTTP/2 202` with body
`{"sessionId":"smoke-test-001","received":59}`.

Then open **`$BASE_URL/s/smoke-test-001`** in a browser: the session replays
in the player (sign-in screen with masked `***` fields), and the inspector on
the right lists 59 events, filterable and seekable. The session also appears
at `$BASE_URL/`.

Checks if something's off:
- `401` → `INGEST_TOKEN` mismatch between your shell and Vercel.
- `500` mentioning env → one of the `R2_*` vars is missing
  (`lib/storage/blobStore.ts` fails fast naming the variable).
- Ingest 202 but the page errors loading blocks → R2 credentials/bucket
  scoping (check the function logs for `/api/sessions/[id]/snapshots`).
- Prisma connection errors → you used the direct URL as `DATABASE_URL`;
  runtime must use the **pooled** one.
