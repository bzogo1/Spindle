# Configuration validation

Environment variables are validated in two layers:

1. **Per-field schema** — `src/lib/env-schema.ts` (zod) checks each variable in
   isolation: type, format, length, allowed enum values. It runs through
   `parseClientEnv`, `parseServerEnv`, `parseBuildEnv`, and `validateEnv` in
   `src/lib/env.ts` / `src/lib/env.server.ts`.
2. **Semantic rules** — `src/lib/config/validate.ts` checks what a per-field
   schema cannot express: conditional requirements, per-environment
   expectations, feature-flag interactions, and secret-strength heuristics.

This document describes layer 2. Layer 1 is covered by `src/lib/env.test.ts`.

## Running the checks

```bash
# Schema validation (what `next build` / `next start` run via next.config.ts)
npm run env:check            # scripts/validate-env.ts → validateEnv()
npm run env:check -- --production

# Secret-store contract (container entrypoint)
npm run secrets:check

# Semantic rules (unit-tested; wire into tooling as needed)
npx vitest run src/lib/config/validate.test.ts
```

`validateRuntimeConfig(env)` is the wire-ready entry point. It takes an
`EnvSource` (`Record<string, string | undefined>`), never throws, never includes
variable **values** in messages, and returns:

```ts
type RuntimeConfigReport = {
  issues: ConfigIssue[] // every finding, each with { key, message, rule, severity }
  errors: ConfigIssue[] // severity === "error"
  warnings: ConfigIssue[] // severity === "warning"
  valid: boolean // errors.length === 0
}
```

To merge into the existing schema-issue pipeline, use
`collectRuntimeConfigIssues(env)`, which projects error-severity issues onto the
`EnvIssue` shape that `EnvValidationError` already consumes.

## Rules

Severity `error` fails validation; `warning` is advisory.

### Production requirements

| Rule                                         | Condition                                                                                               | Severity |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| `public-url.site-url-required-in-production` | `NODE_ENV=production` and `NEXT_PUBLIC_SITE_URL` unset                                                  | error    |
| `database.required-in-production`            | `NODE_ENV=production` and `DATABASE_URL`/`DIRECT_URL` unset (no local fallback in prod)                 | error    |
| `database.local-host-in-production`          | `DATABASE_URL`/`DIRECT_URL` hostname is `localhost`, `127.0.0.1`, `::1`, or `*.localhost` in production | error    |
| `public-url.site-url-not-https`              | `NEXT_PUBLIC_SITE_URL` is not `https://` in production                                                  | error    |
| `public-url.api-url-not-https`               | `NEXT_PUBLIC_API_URL` is set and not `https://` in production (mixed content)                           | error    |
| `service.b2-endpoint-not-https`              | `B2_ENDPOINT` set and not `https://` in production                                                      | error    |
| `service.llm-base-url-not-https`             | `LLM_BASE_URL` set and not `https://` in production (API keys must not traverse plaintext)              | error    |

Localhost/plaintext-http checks only apply in production: development and CI
legitimately use `postgres://…@localhost`, localstack-style `http://` B2
endpoints, and local LLM servers.

### Feature flags

| Rule                                          | Condition                                                                                                             | Severity |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| `feature-flag.mock-api-mode-in-production`    | `NODE_ENV=production` and `NEXT_PUBLIC_API_MODE` is `mock` — including when unset, since `mock` is the schema default | warning  |
| `feature-flag.mock-auth-in-production`        | `NODE_ENV=production` and `NEXT_PUBLIC_MOCK_AUTH=1` (bypasses real sign-in)                                           | error    |
| `feature-flag.csp-enforce-outside-production` | `CSP_ENFORCE=1` with `NODE_ENV` ≠ `production` (silently ignored there)                                               | warning  |

### Conditional groups (all-or-nothing)

| Rule                                  | Condition                                                                                 | Severity                |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `service.b2-incomplete`               | Any of `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT` set but not all four | error (per missing key) |
| `service.b2-rotation-pair-incomplete` | Exactly one of `B2_KEY_ID_PREVIOUS` / `B2_APPLICATION_KEY_PREVIOUS` set                   | warning                 |
| `service.llm-incomplete`              | `LLM_API_KEY` set without `LLM_BASE_URL` and/or `LLM_MODEL`                               | error (per missing key) |
| `service.llm-without-key`             | `LLM_BASE_URL` or `LLM_MODEL` set without `LLM_API_KEY`                                   | warning                 |
| `rotation.previous-without-current`   | A `*_PREVIOUS` rotation variable set while its current variable is unset                  | error                   |
| `rotation.previous-equals-current`    | `*_PREVIOUS` equals the current value (rotation would be a no-op)                         | warning                 |

Rotation pairs covered: `SESSION_SECRET`, `EDGE_HMAC_SECRET`, `WORKER_SECRET`,
`B2_KEY_ID`, `B2_APPLICATION_KEY` (each with its `*_PREVIOUS`).

### OAuth providers

`OAUTH_PROVIDERS_JSON` is validated structurally because malformed entries are
**silently dropped** by `src/lib/auth/oauth-providers.ts` at runtime:

| Rule                     | Condition                                                                                                                                                                                  | Severity                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `oauth.invalid-json`     | Value is not parseable JSON                                                                                                                                                                | error                                            |
| `oauth.not-an-object`    | Parsed value is not a JSON object                                                                                                                                                          | error                                            |
| `oauth.provider-invalid` | A provider entry lacks a non-empty `clientId`, has a missing/invalid `authorizeUrl` or `tokenUrl`, an invalid `userinfoUrl`, or a `scopes` value that is not an array of non-empty strings | error (message names the provider, never values) |

### Secret-strength heuristics (non-production only)

These are advisory checks for development/staging secrets. In production the
secret-store contract (`npm run secrets:check`, `src/lib/secrets/validate.ts`)
owns presence, placeholders, and rotation state.

| Rule                              | Condition                                                                                                                                                                                               | Severity |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `secret.placeholder-value`        | Secret matches the placeholder pattern (`change-me`, `example`, `test`, …)                                                                                                                              | warning  |
| `secret.below-recommended-length` | Symmetric key < 48 chars, or credential (`B2_APPLICATION_KEY`, `RESEND_API_KEY`, `LLM_API_KEY`, `SENTRY_AUTH_TOKEN`) < 20 chars. The schema already enforces the hard 32-char floor for symmetric keys. | warning  |
| `secret.low-entropy`              | Fewer than 8 distinct characters in the value                                                                                                                                                           | warning  |

Checked keys: `SESSION_SECRET`, `EDGE_HMAC_SECRET`, `WORKER_SECRET` (and their
`*_PREVIOUS`), `B2_APPLICATION_KEY`, `RESEND_API_KEY`, `LLM_API_KEY`,
`SENTRY_AUTH_TOKEN`.

### Cross-variable consistency

| Rule                             | Condition                                                                                                                       | Severity |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `sentry.sample-rate-without-dsn` | `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` set while `NEXT_PUBLIC_SENTRY_DSN` is unset (browser tracing disabled, rate is a no-op) | warning  |

## Design notes

- **Blank means unset.** Every check goes through the same `emptyToUndefined`
  semantics as the zod preprocessors, so `KEY=` and `KEY="   "` behave like an
  absent variable.
- **No value leakage.** Messages name keys, rules, and requirements — never
  the configured values — matching `formatEnvError`.
- **No double-reporting.** Malformed values (bad JSON, non-URL strings) are left
  to the zod layer; the semantic layer only adds findings the schema cannot
  express, and silently skips values it cannot parse.
- **Deliberately not checked here:** secret presence in production (owned by
  `scripts/secrets/check.ts` via `src/lib/secrets/catalog.ts`), placeholder
  detection in production (same owner), and `VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA`
  (platform-injected, never set by hand).
