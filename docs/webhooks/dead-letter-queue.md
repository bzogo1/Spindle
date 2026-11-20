# Webhook Dead-Letter Queue

Status: **module + CLI in place; wiring into the delivery retry loop pending**
(the retry/monitoring workstream owns that integration).

When an outbound webhook delivery exhausts its retry budget, the delivery is
**dead-lettered**: recorded in a DLQ instead of dropped, so it can be inspected,
replayed, or acknowledged later. Nothing is lost silently.

## Layout

| File                                 | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/lib/webhooks/dlq.ts`            | DLQ module: entry type, store abstraction, replay, retention |
| `src/lib/webhooks/dlq.test.ts`       | Vitest suite (15 tests)                                      |
| `scripts/webhooks/dlq/manage.mjs`    | Dependency-free CLI for ops inspection/replay/removal        |
| `docs/webhooks/dead-letter-queue.md` | This document                                                |

## When items land in the DLQ

The delivery pipeline (owned by the retry workstream) calls
`createWebhookDlq(...).deadLetter(input)` **only after retries are exhausted** —
never on the first failure. Each entry captures everything needed to replay the
delivery faithfully:

- `url` — the endpoint that kept failing
- `rawBody` — the exact request body (payloads are immutable once signed)
- `headers` — including `webhook-id`, `webhook-signature`, `content-type`, and
  `idempotency-key`, reused **verbatim** on replay so receivers cannot
  distinguish a replayed delivery from the original
- `attempts`, `lastError`, `lastStatus`, `reason` (e.g. `"max-attempts"`,
  `"timeout"`) — forensic context
- `eventId` / `endpointId` — correlation with the event log and subscription

Typical dead-letter triggers: persistent `5xx`/`429` beyond the retry window,
connection timeouts, DNS/TLS failures, and receivers returning `410 Gone` for
subscriptions that should be retired (those are usually removed, not replayed —
see "Removal policy").

## Storage

`WebhookDlqStore` is the persistence interface (`append`, `list`, `get`,
`update`, `remove`). Two implementations ship in `dlq.ts`:

- **`createJsonlDlqStore(path)`** — one JSON object per line. Appends are
  single-line writes; updates/removals rewrite the file atomically
  (temp-file + rename). Corrupt lines are skipped on read and dropped on the
  next rewrite. This is the production path for single-node deploys and backs
  the CLI. Default location convention: `var/webhooks/dlq.jsonl`.
- **`createMemoryDlqStore()`** — in-process map; for tests and demos.

For multi-instance deployments, point each instance at its own file or back the
store with the shared datastore (Postgres/Valkey) — the interface is small
enough to adapt. Cross-process writers must not share one JSONL file.

## Inspection

```ts
import { createJsonlDlqStore, createWebhookDlq } from "@/lib/webhooks/dlq"

const dlq = createWebhookDlq({ store: createJsonlDlqStore("var/webhooks/dlq.jsonl") })

await dlq.list() // all entries, oldest first
await dlq.inspect("dlq_…") // one entry
await dlq.prune({ olderThanMs: 30 * 24 * 3600 * 1000 }) // retention sweep
```

CLI equivalent:

```bash
node scripts/webhooks/dlq/manage.mjs list --file var/webhooks/dlq.jsonl
node scripts/webhooks/dlq/manage.mjs inspect dlq_… --file var/webhooks/dlq.jsonl
node scripts/webhooks/dlq/manage.mjs stats  --file var/webhooks/dlq.jsonl
node scripts/webhooks/dlq/manage.mjs replay dlq_… --file var/webhooks/dlq.jsonl --dry-run
node scripts/webhooks/dlq/manage.mjs remove dlq_… --file var/webhooks/dlq.jsonl
```

`--demo` seeds a throwaway file under the OS temp dir with three sample entries
for safe experimentation: `node scripts/webhooks/dlq/manage.mjs list --demo`.

## Replay procedure

Replay means **re-POSTing the stored `rawBody` to the stored `url` with the
stored headers** — the same bytes and signature the receiver would have seen.

In-process:

```ts
const result = await dlq.replay(entryId, async (entry) => {
  const res = await fetch(entry.url, {
    method: "POST",
    headers: entry.headers,
    body: entry.rawBody,
  })
  return res.ok
    ? { ok: true, status: res.status }
    : { ok: false, status: res.status, error: `HTTP ${res.status}` }
})
// "replayed"  → entry removed from the DLQ
// "failed"    → entry kept; replayAttempts/lastReplayAt/lastReplayOk updated
// "missing"   → id not found
```

`dlq.replayAll(deliver, { limit })` replays oldest-first and returns a summary
(`attempted` / `replayed` / `failed`). Order matters: oldest entries are the
most stale and most likely to matter.

Recommended operator flow:

1. `stats` / `list` — see backlog size and last errors.
2. `inspect <id>` — confirm the entry is worth replaying (right URL, right
   payload, receiver still subscribed).
3. `replay <id> --dry-run` — verify the target without sending.
4. `replay <id>` — real redelivery. Receivers dedup on `webhook-id` /
   `idempotency-key`, so a replay that races a late original delivery is safe.
5. If replay fails again, the entry stays with updated bookkeeping; fix the
   receiver and retry, or `remove` it once acknowledged as unrecoverable.

**Do not** strip or regenerate `webhook-signature` on replay — receivers
verify it against the raw body, and the stored signature remains valid because
the body is unchanged.

## Retention

There is no automatic deletion inside `dlq.ts` beyond explicit `prune()` calls —
the module leaves policy to the operator/monitoring layer. Suggested defaults:

- **Age**: prune entries dead-lettered > 30 days (`prune({ olderThanMs })`).
- **Count**: cap at the newest ~10k entries on high-volume nodes
  (`prune({ keepLatest })`).
- **Success path**: replayed entries are removed immediately, so the queue only
  holds genuinely unresolved deliveries.

Wire `prune` into the same scheduled job that runs log rotation / metric
export; alert on `skippedLines()` from `createJsonlDlqStore` — non-zero means
the file was corrupted or hand-edited.

## Removal policy

- **Replay success** → automatic removal.
- **Receiver gone (`410`, DNS NXDOMAIN for a deleted endpoint)** → `remove`
  the entry; replaying is pointless.
- **Poison payload (receiver `400`s deterministically)** → `remove` after
  confirming with the event producer; the failure is a contract bug, not a
  transient outage.
- **Everything else** → keep until retention expiry; the DLQ is the audit trail
  for "we tried and failed".

## Alerting tie-in

The monitoring workstream should treat DLQ depth as a first-class signal:

- **Gauge**: `webhooks_dlq_depth` = `dlq.list().length` (export periodically).
- **Alert — warning**: depth > 0 for > 15 min, or any entry with
  `reason: "max-attempts"` older than 1 h.
- **Alert — critical**: depth growth rate > N/hour sustained, or depth > 100 —
  suggests a systemic receiver outage rather than isolated failures.
- **Alert — data integrity**: `skippedLines() > 0` on the JSONL store.
- DLQ growth correlates with `webhook_delivery_failures_total`; a DLQ spike
  with flat failure rate means replays are failing (receiver still down).

Runbook pointer: on critical alert, `manage.mjs stats` → `list` → group by
`url`/`endpointId` to find the failing receiver, then follow the replay
procedure above once the receiver recovers.
