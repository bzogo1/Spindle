---
title: "Configure Sentry releases and verify production source maps"
priority: Medium
estimate: 3
labels:
  - frontend
  - observability
  - ci
project: Spindle Website
status: Todo
---

## Summary

Sentry is wired up, but errors are not tied to a release, the environment is implicit, and nobody has
verified that production stack traces resolve to TypeScript. `widenClientFileUpload` is enabled, which
makes map verification and cleanup especially important.

## Context

- `next.config.ts` wraps the config with `withSentryConfig`, using `SENTRY_AUTH_TOKEN` and
  `widenClientFileUpload: true`, but sets no `release`, `environment`, or map cleanup options.
- `src/sentry.server.config.ts`, `src/sentry.edge.config.ts`, and `src/instrumentation-client.ts`
  initialize the three runtimes independently.
- `.github/workflows/ci.yml` already passes `SENTRY_AUTH_TOKEN` from repository secrets; nothing
  passes a commit SHA or environment.
- `README.md` documents aggressive replay masking; 002/028 rely on that staying true.
- 052 will centralize environment variables; read release/environment through it.

## Scope

- Set a consistent `release` (commit SHA, with a documented fallback for local builds) and
  `environment` (production/preview/development) in all three runtime configs and in
  `withSentryConfig`.
- Upload source maps on CI builds; ensure maps are not publicly served after upload (follow the
  installed SDK's recommended cleanup/`hideSourceMaps` behavior rather than leaving `.map` files
  reachable).
- Enable a tunnel route or document why not, so ad blockers do not suppress client errors. If a tunnel
  is added, include it in the CSP from 051.
- Verify error grouping: throw a test error in a preview deployment and confirm the stack trace points
  at `src/...tsx` line numbers, with the correct release and environment tags.
- Review sample rates and replay settings so preview noise does not exhaust quota; keep replay masking
  as-is.
- Confirm no PII or credentials are attached by default (`sendDefaultPii` off, no request bodies for
  auth routes).
- Document how to create a release and how to roll one back.

## Acceptance criteria

- A production error shows the commit SHA release and `production` environment in Sentry.
- The stack trace resolves to the original TypeScript source and the correct file/line, not a minified
  chunk.
- Source map files are not publicly accessible in the deployed site.
- A local build without `SENTRY_AUTH_TOKEN` still succeeds and does not upload maps.
- Client errors arrive through the tunnel (if enabled) with no CSP violation.
- Replay masking still hides text, media, the auth dialog, search box, chat composers, and invite
  field.
- No auth token, cookie, or email appears in an event payload.

## Notes

Check the installed `@sentry/nextjs` v11 docs for the exact option names; several have changed across
major versions. Depends on 052. 051 must include the Sentry ingest/tunnel origins.
