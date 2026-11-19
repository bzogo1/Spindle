---
title: "Validate environment configuration at build time"
priority: Medium
estimate: 2
labels:
  - frontend
  - infrastructure
  - dx
project: Spindle Website
status: Todo
---

## Summary

Environment variables are read ad hoc (`process.env.SENTRY_AUTH_TOKEN` in `next.config.ts`, DSNs in
the Sentry configs), and a missing production value silently produces a broken deployment. Add one
validated env module with a clear failure message.

## Context

- `.env.example` documents only `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, and `SENTRY_AUTH_TOKEN`.
- 026 needs a configurable production origin for `metadataBase`; 035 needs an auth API URL; 056 needs
  a release/environment value.
- No schema, type, or startup check exists. A malformed DSN currently surfaces as a runtime Sentry
  initialization error rather than a build error.
- `NEXT_PUBLIC_*` values are inlined into the client bundle; server-only secrets must never use that
  prefix.

## Scope

- Add `src/lib/env.ts` with a hand-written schema (or a small schema library only if one is already
  adopted): parse, validate URLs and enums, and export separate `serverEnv` and `clientEnv` objects.
- Required in production: the public site origin, auth API base URL, and Sentry DSN(s) if Sentry is
  enabled. Optional in development, with documented defaults where safe.
- Fail fast at build/start with a single error listing every missing or invalid variable and the
  expected format — not one error per request.
- Keep the Sentry auth token out of `src/lib/env.ts`'s client export; it is build-time only.
- Update `.env.example` to match the schema exactly, with comments that distinguish required,
  optional, and build-only values.
- Document the deployment checklist (which values go in CI, which in the hosting dashboard).
- Add unit tests for the schema (see 057): missing required, malformed URL, accidental client secret,
  and development defaults.

## Acceptance criteria

- `npm run build` with a required production value missing fails with an actionable message naming the
  variable and where it is used.
- A local build with only `.env.example` values still succeeds in development mode.
- No server-only value is present in the client bundle (verify by searching the build output).
- `metadataBase`, the auth client, and Sentry all read from this module; no new direct
  `process.env.NEXT_PUBLIC_*` reads are introduced.
- `.env.example` and the schema cannot drift: a test asserts every key is documented.
- `npm run typecheck` and `npm run lint` pass.

## Notes

Unblocks or simplifies 026, 035, and 056. Do not add a dependency just for env parsing if the
hand-written version stays under ~80 lines.
