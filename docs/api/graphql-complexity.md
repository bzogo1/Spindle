# GraphQL Complexity Limiting — Evaluation

> **Status:** Not applicable today — Spindle does **not** use GraphQL. This is a forward-looking evaluation plus a ready-to-use complexity analyzer (`scripts/graphql/complexity.mjs`) for when/if GraphQL is adopted.

## Current state (verified)

- `package.json` has **no GraphQL dependencies** (`graphql`, `graphql-yoga`, `apollo-server`, `@pothos/*`, `type-graphql`, etc.) — see `package.json` lines 51–121.
- No `.graphql` schema/operation files anywhere outside `node_modules`.
- `grep -r graphql src/` returns zero matches; API surface is REST (`src/app/api/`, `src/lib/api/`).

So there is **nothing to limit** right now. The REST endpoints under `src/app/api/` rely on existing controls: route-level validation (zod), auth middleware, and rate limiting (`src/lib/ddos`, `src/lib/api`). If a GraphQL layer is introduced later, the concepts below apply.

## Why complexity limiting matters (if GraphQL is adopted)

GraphQL accepts client-supplied queries, so a single HTTP request can force a server to resolve an arbitrarily deep, wide, or expensive selection tree — nested lists inside lists, expensive computed fields, alias-based field duplication. Without limits this is the classic GraphQL DoS vector. The defense is to reject expensive queries **before execution**.

### Three orthogonal limits

| Limit                     | What it bounds                                                                                                                                 | Typical default |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Depth**                 | Nesting levels of selection sets (e.g. `user { posts { comments { author { ... } } } }`)                                                       | 8–12            |
| **Breadth / field count** | Total number of selected fields across the whole query (aliases counted)                                                                       | 100–500         |
| **Cost / query cost**     | Weighted cost: each field contributes a base cost (1) plus multipliers for lists/arguments (`first:`, `take:`, etc.); multiplied down the tree | 500–1000        |

All three should be enforced together: a query can pass depth while blowing the budget on `... on` fragments, or pass field count while recursing through an expensive connection type.

### Supporting measures

- **Persisted / allowlisted queries** (strongest): clients only send a query ID; the server resolves it against a fixed set of operations. Removes ad-hoc query attacks entirely but requires client coordination. Works well with CDNs and precompute-friendly workflows.
- **Timeouts & max execution depth at resolver level**: enforce a wall-clock budget so a query that slips past static analysis still gets cut off.
- **Introspection gating**: disable `__schema`/`__type` in production to reduce reconnaissance value.
- **Pagination caps**: `first`/`take`/`limit` arguments must have a hard maximum regardless of the client's request.

## How it would apply to Spindle

- Schema: would be a new `src/graphql/` (schema SDL + resolvers) — **no such directory exists today**.
- Enforcement point: a validation plugin in the GraphQL server's request pipeline (e.g. `graphql-yoga` plugin, Apollo Server plugin, or graphql-js `validate` extension) that computes depth/fields/cost during the validation phase and returns an error for queries over budget.
- Cost model needs schema awareness: a plain syntax walker (like `scripts/graphql/complexity.mjs`) can compute depth and field counts without a schema, but **cost analysis requires the schema** to know which fields are lists or expensive — that would be added at adoption time using `graphql`'s `TypeInfo`/`visitWithTypeInfo`.
- CI: `scripts/graphql/complexity.mjs --file <query.graphql>` can gate committed operation documents (regression tests, codegen sources) even before a server exists.

## Tool: `scripts/graphql/complexity.mjs`

Standalone Node script (no dependencies — hand-rolled lexer/parser sufficient for complexity metrics). Usage:

```bash
node scripts/graphql/complexity.mjs --demo            # sample nested query
node scripts/graphql/complexity.mjs --file query.graphql
node scripts/graphql/complexity.mjs --file q.graphql --json --max-depth 6 --max-fields 200 --max-cost 500
```

Exit codes: `0` = within limits, `1` = parse error, `2` = limit exceeded, `3` = usage/IO error.

Metrics reported:

- **depth** — max selection-set nesting (fragments resolved).
- **fields** — total leaf+object field count, aliases and fragments counted once per spread site.
- **cost** — schema-agnostic heuristic: `1` per field + `5` per list-suspect argument (`first`, `last`, `take`, `limit`, `count`, `pageSize`, `page_size` ≥ 1) — approximates the real cost model; replace with `graphql`-package `TypeInfo` analysis once a schema exists.

## Recommendations if GraphQL is ever adopted

1. Set `--max-depth 8`, `--max-fields 300`, `--max-cost 500` as the server defaults; document per-operation overrides.
2. Prefer persisted queries for the public API; keep ad-hoc queries internal-only.
3. Reuse the CI gate (`--file` mode) on all checked-in `.graphql` documents.
4. Add a resolver-level timeout (e.g. 5s) as the runtime backstop.
