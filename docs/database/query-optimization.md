# Database query optimization

Scope: how queries against the Prisma/Postgres layer should be written in
this repo, the helpers that make the safe pattern the default, and the static
auditor that enforces the rules in review.

Related docs: [`indexing-strategy.md`](./indexing-strategy.md) (which indexes
exist and why), [`connection-pooling.md`](./connection-pooling.md),
[`read-replicas.md`](./read-replicas.md) (route heavy reads off the primary).

## The query surface today

`prisma/schema.prisma` defines a single model, `User` (table `users`):

| Column       | Notes                                             |
| ------------ | ------------------------------------------------- |
| `id`         | PK (`cuid()`), also the unique cursor tie-breaker |
| `email`      | `@unique` — `users_email_key`                     |
| `name`       | nullable free text — never queried server-side    |
| `created_at` | `@@index([createdAt])` → `users_created_at_idx`   |
| `updated_at` | `@updatedAt`, never a listing key                 |

There are **no first-party `prisma.*` call sites in `src/` yet** — auth work
(DEV-18/DEV-20, see `prisma/AUTH-SCHEMA.md`) will add them. Everything below is
the contract new call sites must follow, and the auditor checks it
mechanically.

## Rules

### 1. Every list read is bounded

`findMany`, `count`, `aggregate`, and `groupBy` must always pass `take` (or
`cursor`). An unbounded `findMany` on `users` is a full-table scan that grows
without limit — the auditor reports it as `unbounded-query` (warning).

For user-facing lists, use the keyset pagination helper in
[`src/lib/db/queries/pagination.ts`](../../src/lib/db/queries/pagination.ts):

```ts
import { prisma } from "@/lib/db"
import { buildUserPageArgs, paginateUserRows } from "@/lib/db/queries/pagination"

const args = buildUserPageArgs({
  cursor: searchParams.get("cursor"),
  pageSize: searchParams.get("size"), // clamped to [1, MAX_PAGE_SIZE=200]
})
const rows = await prisma.user.findMany({
  ...args,
  select: { id: true, email: true, name: true, createdAt: true },
})
const { items, nextCursor } = paginateUserRows(rows, args.take - 1)
```

Why keyset instead of `skip`/`take` offset pagination:

- `ORDER BY created_at, id` matches `users_created_at_idx`; Postgres walks the
  index and stops after `take` rows — no sort, no offset scan.
- Offset pagination (`skip: n`) re-reads and discards `n` rows on every page
  and drifts when rows are inserted between requests. The cursor is a stable
  position in the `(created_at, id)` ordering, so pages never skip or repeat
  rows.
- `resolvePageSize` clamps input to `MAX_PAGE_SIZE` (200), so a crafted
  `?size=999999` cannot turn a list endpoint into a table dump.

`paginateUserRows` expects the `take = pageSize + 1` lookahead row that
`buildUserPageArgs` emits; pass `args.take - 1` as the page size.

### 2. Narrow every read with `select`

`users` is narrow today, but the habit matters: auth models will add
credentials, tokens, and backup codes that must **never** leave the database
layer. Fetch only the columns the caller renders or branches on:

```ts
// good
await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } })
// bad — pulls every column including future secret-bearing ones
await prisma.user.findUnique({ where: { id } })
```

The auditor flags full-row `findUnique`/`findFirst`/`findMany` as `no-select`
(info). For relations, prefer `select: { relation: { select: … } }` over
`include`, which has no column narrowing.

### 3. Avoid N+1 — batch or include

A Prisma call inside a `for`/`while` loop or an async `.map` is an N+1
candidate (`possible-n-plus-one`, warning). Replace per-row lookups with one
batched query:

```ts
// bad: one query per id
for (const id of ids) {
  await prisma.user.findUnique({ where: { id } })
}
// good: a single IN-list query, still bounded by the input size
await prisma.user.findMany({
  where: { id: { in: ids } },
  take: ids.length, // explicit bound — keeps the auditor quiet
  select: { id: true, email: true },
})
```

When the per-row data is a relation, use `include`/`select` nesting so Prisma
issues one join/query instead of one per parent row. Cap `ids.length`-style
inputs (e.g. 100–200) at the route layer before they reach the query.

### 4. Index-aware patterns

- **Ordering/filtering by signup time** (`ORDER BY created_at`,
  `created_at >= ?`) is served by `users_created_at_idx` — keep the `id`
  tie-breaker in `orderBy` so the index scan is deterministic.
- **Lookups by `email` or `id`** hit `users_email_key` / `users_pkey`; always
  query them via `findUnique`/`where` equality, never `ILIKE` or
  case-folded comparisons (those bypass the unique index).
- **Do not order or filter on `name`/`updated_at`** — neither is indexed
  (see indexing-strategy.md "deliberately not indexed"). Server-side name
  search needs a new index shipped with the feature that needs it.
- When auth models land, their FK columns (`user_id` on sessions, tokens,
  backup codes) must ship `@@index` in the same migration — see
  `prisma/AUTH-SCHEMA.md` and the indexing doc's planned-indexes section.

### 5. Bulk writes and raw SQL

- `deleteMany`/`updateMany` without `where` is an **error**-severity finding
  — it rewrites the whole table. (`createMany` takes `data`, not `where`,
  and is not subject to this rule.)
- Raw SQL (`$queryRaw`, `$executeRaw`) is a warning; `*Unsafe` variants are an
  error. Prefer the Prisma query API; when raw SQL is unavoidable use the
  tagged-template form (`$queryRaw` with `Prisma.sql`) so parameters stay
  bound, and add a comment justifying it.
- Multi-statement writes that must be atomic belong in
  `prisma.$transaction([...])` (array form) or an interactive
  `prisma.$transaction(async (tx) => …)` — never nest interactive
  transactions (`nested-transaction` warning). Use the `tx` client for every
  query inside the callback; the auditor recognizes `tx.` receivers.

## The auditor

[`scripts/db/queries/audit.mjs`](../../scripts/db/queries/audit.mjs) is a
static, dependency-free scanner — no database connection required. It walks
the repo (skipping `node_modules`, `.next`, `coverage`, generated Prisma
output, etc.), finds `prisma.*`/`tx.*` call sites, and reports:

| rule                  | severity | meaning                                                          |
| --------------------- | -------- | ---------------------------------------------------------------- |
| `unbounded-query`     | warning  | `findMany`/`count`/`aggregate`/`groupBy` without `take`/`cursor` |
| `no-select`           | info     | find* fetching every column                                      |
| `possible-n-plus-one` | warning  | DB call inside a loop / async `.map`                             |
| `bulk-write-no-where` | error    | `deleteMany`/`updateMany` without `where`                        |
| `raw-sql`             | warning  | `$queryRaw`/`$executeRaw`                                        |
| `raw-sql-unsafe`      | error    | `*Unsafe` variants                                               |
| `nested-transaction`  | warning  | `$transaction` inside a transaction window                       |

### Usage

```bash
# markdown report on stdout (default)
node scripts/db/queries/audit.mjs

# JSON for tooling
node scripts/db/queries/audit.mjs --format=json

# write a report file
node scripts/db/queries/audit.mjs --out docs/audits/query-audit.md

# exercise the rules against a built-in fixture
node scripts/db/queries/audit.mjs --demo

# tune CI gating: exit 1 on errors (default), warnings, info, or never
node scripts/db/queries/audit.mjs --fail-on warning
```

The script exits `1` when findings at or above `--fail-on` exist, so it can
gate CI directly. `prisma/seed.ts` and migration tooling are scanned but
downgraded one severity level — raw SQL and unbounded reads are expected in
seeds.

### Audit result on this repo (2026-01)

```
Root: /home/bogdan/projects/spindle · files scanned: 1009 · findings: 0
error: 0 · warning: 0 · info: 0
```

Zero findings is expected rather than suspicious: `src/` currently contains
no Prisma query call sites outside the connection layer
(`src/lib/db.ts`, `src/lib/db/pool.ts`, `src/lib/db/replica/`), and
`prisma/seed.ts` uses a single keyed `upsert`. The value of the auditor is
forward-looking — it will flag the first unbounded or N+1 query the auth
work introduces. Re-run it (or wire `--fail-on error` into CI) when query
call sites land.

## Checklist for new query code

- [ ] `findMany`/`count`/`aggregate`/`groupBy` has `take` or `cursor`
- [ ] User-facing lists use `buildUserPageArgs` + `paginateUserRows`
- [ ] Reads pass `select` (or nested `select`) — no full-row fetches
- [ ] No Prisma call inside loops/async `.map` — batch with `in:` or `include`
- [ ] `where` on indexed columns only (`id`, `email`, `created_at`)
- [ ] Bulk writes have `where`; raw SQL uses tagged templates, not `*Unsafe`
- [ ] `node scripts/db/queries/audit.mjs` reports no new findings
