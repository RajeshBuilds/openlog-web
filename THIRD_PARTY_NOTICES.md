# Third-party notices

## PostHog `@posthog/replay-shared` (vendored)

Portions of `lib/replay/` are vendored from the PostHog monorepo
(https://github.com/PostHog/posthog), commit
`2012ab611123e089815ee6799c34c65467f3a60b`, from the MIT-licensed
`common/replay-shared/src/` package (nothing under `ee/` is used):

| vendored file(s) | upstream path |
|---|---|
| `lib/replay/transformer/index.ts`, `mobile.types.ts` | `common/replay-shared/src/mobile/` |
| `lib/replay/transformer/{colors,data-uri,screen-chrome,shared,transformers,types,wireframeStyle}.ts` | `common/replay-shared/src/mobile/transformer/` |
| `lib/replay/snapshotProcessing/segmenter.ts` | `common/replay-shared/src/segmenter.ts` |
| `lib/replay/snapshotProcessing/{chunk-large-mutations,patch-meta-event}.ts` | `common/replay-shared/src/snapshot-processing/` |
| `lib/replay/{telemetry,types,utils}.ts` | `common/replay-shared/src/` |

Local modifications: import paths rewritten (`posthog-js/rrweb-types` →
`@rrweb/types`, relative paths flattened). No behavioral changes.

`lib/schema/rr-mobile-schema.json` is vendored from the same repository at
`frontend/src/scenes/session-recordings/mobile-replay/schema/mobile/rr-mobile-schema.json`.

MIT License

Copyright (c) 2020-2026 PostHog Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## rrweb (npm dependencies)

`rrweb`, `@rrweb/types`, and `rrweb-snapshot` are MIT-licensed npm
dependencies (Copyright (c) 2018 Contributors to the rrweb project,
https://github.com/rrweb-io/rrweb). License text as above.

Other npm dependencies retain their own licenses; see each package's
`LICENSE` file under `node_modules/`.
