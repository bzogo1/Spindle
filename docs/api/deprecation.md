# API deprecation policy

How Spindle retires HTTP API endpoints without breaking consumers. Applies to
every route handler under `src/app/api/` (see
[contract-testing.md](./contract-testing.md) for the wire-contract coverage).

The machine-readable source of truth is the deprecations registry:
[`scripts/api/deprecation/deprecations.json`](../../scripts/api/deprecation/deprecations.json),
enforced by [`scripts/api/deprecation/check.mjs`](../../scripts/api/deprecation/check.mjs)
(alias: [`docs/api/deprecation-check.mjs`](./deprecation-check.mjs)).

## Notice periods

| Stage         | Minimum duration                            | Meaning                                                     |
| ------------- | ------------------------------------------- | ----------------------------------------------------------- |
| **Announced** | —                                           | Deprecation published; endpoint fully functional.           |
| **Active**    | **90 days** from `deprecatedAt` to `sunset` | Endpoint emits deprecation headers; consumers must migrate. |
| **Removed**   | —                                           | Route returns 404/410; registry entry retained for history. |

- The sunset date must be **at least 90 days** after the deprecation date.
  Security-driven removals may shorten this only with sign-off recorded in the
  registry entry's `notes` field.
- Once `sunset` passes, the route must be removed (or the registry entry moved
  to `status: "removed"` with the removal commit referenced in `notes`).

## Deprecation markers in responses

Every deprecated route **must** emit both headers on every response while in
`announced`/`active` status:

- `Deprecation: @<unix-timestamp>` (RFC 9745) or an HTTP-date — we standardize
  on the `@<unix>` form keyed to `deprecatedAt`.
- `Sunset: <HTTP-date>` (RFC 8594) keyed to the registry `sunset` date.

Recommended helper (to be added under `src/lib/` when the first deprecation
lands): a `deprecationHeaders(deprecatedAt, sunset)` function returning both
headers, applied via `Response.json(body, { headers })` or the shared
`ok()`/`fail()` envelope helpers. The checker follows one level of local
imports, so headers emitted inside a shared helper satisfy the check.

Response bodies should not change shape during deprecation — the headers and
docs are the signal.

## Documentation markers

- The route handler's JSDoc block gets a `@deprecated <replacement or reason>`
  tag. The checker treats `@deprecated` as a deprecation marker: any route
  carrying it (or a `Deprecation` header) **must** have a registry entry.
- If the endpoint is documented in `content/docs/` or the coverage matrix in
  [contract-testing.md](./contract-testing.md), add a visible deprecation
  notice linking to the replacement.

## Communication plan

1. **Announce**: add the registry entry with `status: "announced"`, file the
   changelog/docs entry, and point `announcement` at it.
2. **Headers on**: flip to `status: "active"` once `Deprecation`/`Sunset`
   headers ship in the same release as the announcement.
3. **Reminders**: at 30 and 7 days before `sunset`, re-announce in the changelog
   and to known API consumers (the registry `id` is the tracking key).
4. **Remove**: after `sunset`, delete the route (or return `410 Gone` for one
   release if traffic data warrants), move the entry to `status: "removed"`,
   and update contract specs.

## Running the check

```bash
node scripts/api/deprecation/check.mjs          # human-readable
node scripts/api/deprecation/check.mjs --json   # machine-readable
node scripts/api/deprecation/check.mjs --demo   # exercise pass/fail paths on fixtures
node docs/api/deprecation-check.mjs             # same check, docs/ alias
```

Exit codes: `0` clean, `1` violations, `2` usage/config error. Checks performed:

- registry entries reference existing route files and valid methods/dates;
- `sunset - deprecatedAt >= 90` days for `announced`/`active` entries;
- registered routes emit `Deprecation` **and** `Sunset` headers (route file or
  a directly imported local helper);
- no route carries an unregistered deprecation marker;
- `announcement` paths exist.

## Adding a deprecation — checklist

1. Pick the registry `id` (`kebab-case`, unique, stable).
2. Add the entry to `deprecations.json` (`status: "announced"`, real
   `deprecatedAt`/`sunset` ≥ 90 days apart, `replacement`, `announcement`).
3. Emit `Deprecation`/`Sunset` headers from the route; add `@deprecated` to
   its JSDoc.
4. Write the announcement doc and update `contract-testing.md`'s matrix if
   behavior notes change.
5. Run `node scripts/api/deprecation/check.mjs` — must exit 0.
