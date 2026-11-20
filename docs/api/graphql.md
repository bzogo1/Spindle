# GraphQL schema validation

## Current state: no GraphQL

Spindle's API surface is **REST-only**. There is no GraphQL dependency
(`graphql`, `@apollo/*`, `urql`, `graphql-yoga`, etc.) in `package.json`, no
production `.graphql` schema files, and no GraphQL server or client code anywhere in
`src/` or `prisma/`. (The only `.graphql` file in the repo is the test
fixture `scripts/graphql/fixtures/demo.schema.graphql`; there is no
production schema.)

- **56 route handlers** under `src/app/api/` (Next.js App Router `route.ts`
  files), covering auth (passwordless, 2FA, sessions, recovery), newsletter,
  contact, feedback, NPS, email unsubscribe, and notifications.
- Request validation is done with **zod** schemas colocated in (or beside)
  route handlers — e.g. `src/app/api/auth/password/reset/request/route.ts`.
- The API's wire contract is guarded by **Playwright contract specs** in
  `e2e/api/*.spec.ts` (8 spec files) with zod schemas that deliberately
  mirror — but do not import — the server validators. See
  [`contract-testing.md`](./contract-testing.md).

Because there is no GraphQL schema today, there is nothing to lint, diff, or
validate against a breaking-change baseline. This document records that
finding, evaluates whether GraphQL would add value, and ships tooling that
becomes live the moment a `.graphql` schema file is added.

## Would GraphQL add value here?

**Probably not, in the current form of this product.** The API is small,
well-bounded, and already covered by contract tests:

- **56 endpoints is below the scale where GraphQL's query-shaping and
  schema-first advantages typically pay off.** Most clients likely consume a
  handful of these routes (forms, auth flows, digest settings).
- The app already has two strong consistency mechanisms: zod validation at
  the boundary and wire-contract specs that catch drift. GraphQL would add a
  third contract layer rather than replacing pain that exists.
- The REST surface includes flows that map poorly onto GraphQL — the
  email-unsubscribe RFC 8058 one-click POST, SSE streams, and cookie-based
  session auth are all cleaner as plain HTTP endpoints.
- GraphQL introduces a real operational cost (schema governance, N+1/query
  depth limits, persisted-query policy, authz at the resolver layer) that this
  codebase would have to earn back.

If a future internal admin surface or a public developer API emerges with
many cross-entity queries, revisiting GraphQL is reasonable. Until then,
evolving the REST contract + zod + `e2e/api` contract specs is the lower-risk
path.

## Schema-validation tooling (if GraphQL is adopted later)

When a production `.graphql` schema file lands in this repo, adopt this pipeline — it
is additive and requires no changes to existing files:

### 1. Ready-made validator: `scripts/graphql/validate-schema.mjs`

A zero-dependency Node script (no `graphql` package required) that parses
SDL and reports **errors** (syntax, duplicate definitions, references to
undefined types, invalid enum/interface/union members) and **warnings**
(naming-convention lint). It also supports `--baseline` for breaking-change
detection against a previous schema revision.

```bash
# Validate the checked-in schema
node scripts/graphql/validate-schema.mjs schema.graphql

# Demo run against the bundled fixture
node scripts/graphql/validate-schema.mjs --demo

# Fail CI on breaking changes vs. a baseline snapshot
node scripts/graphql/validate-schema.mjs schema.graphql \
    --baseline scripts/graphql/baseline.graphql
```

If/when the real `graphql` package is added as a dependency, prefer it for
authoritative validation and keep this script as the dependency-free gate.

### 2. Tooling recommendations

| Concern                      | Recommendation                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative parse/validate | `graphql` (reference parser) or `@graphql-inspector/core` once the package is a dependency                                                                                                                                                                |
| Lint rules                   | `graphql-schema-linter` — rules like `fields-have-descriptions`, `enum-values-all-caps`, `types-are-capitalized`, `one-field-subscriptions`                                                                                                               |
| Breaking-change detection    | `@graphql-inspector/cli` (`graphql-inspector diff old.graphql new.graphql --rule ...`) — catches removed fields/types/enum values, type narrowing, arg changes                                                                                            |
| CI wiring                    | Add `node scripts/graphql/validate-schema.mjs <schema> --baseline scripts/graphql/baseline.graphql` to the pipeline that runs `npm run lint`; update `baseline.graphql` only in dedicated "schema change" PRs so breaking diffs are reviewed deliberately |
| Schema conventions           | Mirror the zod contract-test approach: commit the schema, require a contract spec or inspector diff for every change                                                                                                                                      |

### 3. Breaking-change rules worth enforcing

- No removed types, fields, args, enum values, or union members.
- No field/arg type changes that narrow (e.g. `String` → `String!` on output,
  non-null added to inputs is breaking for clients).
- No renamed directives or changed `schema` operation definitions.
- Deprecations (`@deprecated`) are safe; removals are not.

## Files

- `scripts/graphql/validate-schema.mjs` — validator + differ (this repo, dependency-free)
- `scripts/graphql/fixtures/demo.schema.graphql` — passing fixture used by `--demo`
