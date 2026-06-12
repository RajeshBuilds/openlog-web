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