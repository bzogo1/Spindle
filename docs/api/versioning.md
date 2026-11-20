# API versioning strategy

Status: **proposal — nothing is versioned yet.** Companion to
`docs/api/contract-testing.md` (wire-contract specs) and any OpenAPI spec
under `docs/api/`. This document defines _when and how_ `/api/*` endpoints
get versioned before the first breaking change ships.

## Current state

- 56 route handlers under `src/app/api/**`, all **unversioned**
  (`/api/auth/signin`, `/api/notifications/stream`, …). No `/api/vN/`
  segment exists anywhere in the tree.
- Consumers are **first-party only**: the Next.js frontend itself (only
  ~9 files call `fetch("/api/…")` literally — most traffic goes through
  the `request()` wrapper in `src/lib/api/client.ts` and `useApiQuery`
  in `src/lib/api/use-api-query.ts`, used by ~16–20 frontend files), the
  Playwright contract specs in `e2e/api/`, and a handful of server-side
  helpers. There is no published public API, no third-party SDK, and no
  external integrator contract.
- Breaking changes are already _tested_ against: `e2e/api/*.spec.ts`
  assert status codes and JSON envelope shape, so a breaking change fails
  CI loudly. That is a safety net, not a versioning strategy.

## Is versioning needed now?

**Honest answer: not yet — but the decision point is closer than it looks.**

Arguments _against_ versioning today:

- Every consumer is in this repo. A "breaking change" is a coordinated
  code change, not an ecosystem event. You can just change the route and
  update callers in the same PR.
- Premature `/v1` prefixes add churn (every route file moves or gets a
  parallel directory) and imply a stability promise nobody has asked for.

Arguments _for_ deciding now:

- The auth surface (`/api/auth/**`, 2FA, OAuth, passwordless) is
  security-sensitive and will accumulate protocol changes (e.g. new token
  shapes, session payload fields). Session cookie semantics are the kind
  of thing that _cannot_ be changed atomically across already-deployed
  clients — a mobile app, a saved bookmark, a cached SPA bundle.
- The moment **any** external consumer appears (mobile app, partner
  integration, public embed like the unsubscribe/newsletter endpoints
  which already travel through email links), unversioned breaking changes
  become impossible.

**Rule of thumb adopted here:** introduce `/api/v1` at the _first_ of:

1. a first external/public consumer of any route,
2. a planned breaking change to a route consumed by a long-lived client
   (session, tokens, streaming), or
3. route count / surface area where a coordinated rename stops being
   practical (currently ~56 routes — still fine).

Until then, prefer additive-only changes: new optional fields, new
endpoints, new enum values appended (never reordered/removed), and never
removing or renaming fields in responses.

## Recommended approach (when the trigger fires)

**URL path prefix: `/api/v1/<resource>`** — chosen over headers:

| Criterion       | URL prefix `/api/v1`                                        | Header (`Accept-Version`)              |
| --------------- | ----------------------------------------------------------- | -------------------------------------- |
| Discoverability | Visible in logs, docs, OpenAPI paths                        | Hidden; easy to forget                 |
| Caching/CDN     | Version is part of cache key naturally                      | Needs explicit `Vary`                  |
| Tooling         | Works with curl, proxies, contract specs unchanged in shape | Requires client cooperation everywhere |
| Next.js fit     | Trivial: `src/app/api/v1/.../route.ts`                      | Requires middleware rewrites           |

Header versioning is rejected: it adds a negotiation layer with zero
benefit at this scale, and Next.js route handlers make path versioning
the path of least resistance.

### Mechanics

- New versions are **new directories**: `src/app/api/v1/auth/signin/route.ts`
  sits next to `src/app/api/auth/signin/route.ts`. No rewrites, no
  middleware, no shared-file branching.
- **Share, don't fork:** extract handlers into `src/lib/api/v1/...` (or
  keep logic in existing `src/lib/**` modules) so v1 and unversioned
  routes call the same implementation during transition. Only duplicate
  when wire shapes genuinely diverge.
- **Unversioned routes remain the "current" (latest) version** during
  transition — they are not frozen. When a v1 exists, unversioned
  `/api/foo` behaves identically to `/api/v1/foo` until it is retired.
- **Deprecation headers** on routes scheduled for removal:
  `Deprecation: @<unix-ts>` (RFC 9745) and `Sunset: <http-date>`
  (RFC 8594), plus `Link: </api/v1/foo>; rel="successor-version"`.

### Sunset / deprecation policy

- Announce deprecation in the response headers **and** in
  `docs/api/versioning.md` changelog for ≥ **90 days** before removal.
- Minimum overlap: old version stays live for at least **two release
  cycles or 6 months**, whichever is longer.
- Removal is a normal PR: delete the route dir, update contract specs,
  grep for `fetch("/api/…")` callers (see `scripts/api/versioning/check.mjs
--json` for a caller audit is future work).
- No silent breaks: if a route must break _before_ its announced sunset,
  ship the new shape under a new version segment instead.

### Backward-compatibility rules (apply to every `/api/*` route, versioned or not)

Within a version, changes MUST be additive:

- ✅ add optional request fields, add response fields, add enum values at
  the end, add new endpoints/methods.
- ❌ remove/rename fields or routes, change field types, change status
  codes for existing inputs, reorder enum values, tighten validation
  that rejects previously-accepted payloads, change auth/cookie
  semantics.

Any ❌ requires a new version segment.

## Migration path

1. **Now:** adopt the additive-only rules above. No file moves. Add the
   `check.mjs` lint to CI optionally (advisory, `--json` for diffing).
2. **Trigger fires:** create `src/app/api/v1/` mirroring only the routes
   that need stability guarantees first (recommend: `auth/session`,
   `auth/refresh`, `auth/oauth/*`, `notifications/stream`). Point new
   external clients at `/api/v1/...` only.
3. **Transition:** unversioned routes alias v1 behavior; internal callers
   migrate opportunistically.
4. **Steady state:** once all external consumers are on `/api/v1`, decide
   whether unversioned `/api/*` becomes an alias (keep forever — cheap)
   or gets its own deprecation timeline.

## Tooling

`scripts/api/versioning/check.mjs` (offline, no deps):

```bash
node scripts/api/versioning/check.mjs            # lint: report routes, version-prefix consistency
node scripts/api/versioning/check.mjs --demo     # demo report incl. heuristic breaking-change scan
node scripts/api/versioning/check.mjs --json     # machine-readable route inventory + findings
node scripts/api/versioning/check.mjs --snapshot /tmp/api-snapshot.json   # record surface
node scripts/api/versioning/check.mjs --compare /tmp/api-snapshot.json     # diff: removed routes/methods, runtime changes
```

`--compare` is the breaking-change heuristic: it flags removed route
paths, removed HTTP method exports, and changed `runtime`/`dynamic`
exports between a snapshot and the current tree. It cannot detect
_semantic_ breaking changes (field renames inside a handler) — that is
what the Playwright contract specs are for.
