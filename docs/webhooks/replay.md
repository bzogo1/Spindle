# Webhook Replay

Replay re-delivers webhook payloads that were previously recorded — DLQ
exports, receiver-log dumps, or `/_deliveries` captures — to a webhook
endpoint. It exists for **DLQ recovery** and **debugging deliveries**.

- Engine: `src/lib/webhooks/replay.ts`
- CLI: `scripts/webhooks/replay/replay.mjs`
- Tests: `src/lib/webhooks/replay.test.ts`

## When to use it

| Scenario                        | How                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DLQ recovery                    | Export failed deliveries to JSONL, fix the downstream issue, replay with `--idempotency original` so receivers dedupe anything that actually landed. |
| Receiver was down / 5xx storm   | Replay the stored window after recovery; receivers return `duplicate` for anything already processed.                                                |
| Debugging a bad payload         | `dry-run` to inspect exactly what would be sent (endpoint, headers, rewritten body) without touching the network.                                    |
| Re-processing with side effects | `--idempotency new` mints fresh keys so receivers treat each delivery as a new event (use only when re-processing is intended).                      |

## Record format (JSONL)

One JSON object per line:

```json
{
  "rawBody": "{\"id\":\"evt_…\",\"type\":\"contact.form.submitted\",…}",
  "headers": {
    "webhook-id": "evt_…",
    "idempotency-key": "idem_…",
    "webhook-signature": "t=…,v1=…",
    "content-type": "application/json"
  },
  "endpoint": "https://api.example.com/webhooks/inbound",
  "recordedAt": "2025-01-01T12:00:00.000Z",
  "payload": { "…": "optional parsed copy for reporting" },
  "eventId": "evt_…",
  "idempotencyKey": "idem_…",
  "type": "contact.form.submitted",
  "source": "dlq"
}
```

Required: `rawBody` (or `body`, or `payload` which is serialized) **and** an
endpoint — per-record `endpoint` or the global `--endpoint` flag. Everything
else is optional metadata used for reporting and header consistency.

Malformed lines are skipped and reported (with 1-based line numbers); they do
not abort the batch.

## CLI

```bash
# Inspect what a file contains (no network)
node scripts/webhooks/replay/replay.mjs list --file deliveries.jsonl

# See exactly what would be sent — resolves endpoints, rewrites
# idempotency keys, applies signing — without sending anything
node scripts/webhooks/replay/replay.mjs dry-run \
  --file deliveries.jsonl --endpoint https://api.example.com/hooks

# Deliver for real
node scripts/webhooks/replay/replay.mjs replay \
  --file deliveries.jsonl --endpoint https://api.example.com/hooks

# Self-contained demo: spins up a local signed receiver and replays samples
node scripts/webhooks/replay/replay.mjs replay --demo
```

### Options

| Flag                           | Default      | Meaning                                                                                                                                                                                                                                  |
| ------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--file <path>`                | —            | JSONL export (required unless `--demo`).                                                                                                                                                                                                 |
| `--endpoint <url>`             | per-record   | Endpoint override for all records.                                                                                                                                                                                                       |
| `--demo`                       | off          | Built-in sample records; with `replay` also starts a local demo receiver when `--endpoint` is absent.                                                                                                                                    |
| `--idempotency original\|new`  | `original`   | Reuse recorded keys vs. mint `idem_replay_…` keys (rewrites `payload.idempotencyKey` **and** the `Idempotency-Key` header).                                                                                                              |
| `--order sequential\|parallel` | `sequential` | Await each delivery vs. bounded worker pool. Result order always matches input order.                                                                                                                                                    |
| `--concurrency <n>`            | `4`          | Workers for `--order parallel`.                                                                                                                                                                                                          |
| `--sort none\|recordedAt`      | `none`       | Optionally order by `recordedAt` before replaying.                                                                                                                                                                                       |
| `--delay-ms <n>`               | `0`          | Pacing delay between deliveries (per worker).                                                                                                                                                                                            |
| `--timeout-ms <n>`             | `30000`      | Per-request timeout.                                                                                                                                                                                                                     |
| `--retries <n>`                | `0`          | Extra attempts on network errors and 5xx only — 4xx fails immediately.                                                                                                                                                                   |
| `--limit <n>` / `--offset <n>` | — / `0`      | Replay a window of the file.                                                                                                                                                                                                             |
| `--secret <value>`             | —            | Re-sign every delivery: computes a fresh `t=…,v1=…` `Webhook-Signature` header over the **final** bytes (after idempotency rewriting). Required when replaying to receivers that enforce signatures and the recorded signature is stale. |
| `--json`                       | off          | Machine-readable output.                                                                                                                                                                                                                 |

Exit code is `1` when any delivery `failed`/`skipped` or lines failed to
parse, `2` on usage errors.

## Safety

### Idempotency

- **Default is `original`.** The recorded `Idempotency-Key` (header and
  embedded `payload.idempotencyKey`) is preserved, so a receiver that already
  processed the event answers `duplicate` and does not re-run side effects.
  This is the safe choice for DLQ recovery: replaying is almost free if the
  original actually landed.
- **`--idempotency new` is for deliberate re-processing.** It mints a fresh
  key per delivery and rewrites both the header and the payload field before
  signing. Only use it when the downstream _should_ treat events as new —
  e.g. re-feeding a fixed pipeline. It bypasses receiver dedup entirely.
- If the stored body is not a JSON object, the key cannot be rewritten; the
  delivery goes out unchanged and the result carries a warning rather than
  silently diverging.

### Signatures and timestamps

Recorded `webhook-signature` headers embed the **original** timestamp `t=`.
Receivers reject signatures older than the tolerance window (300s by
contract), so replays of old records will fail verification unless you pass
`--secret` to re-sign. The signer runs **after** idempotency rewriting, so
the signature always covers the exact bytes sent. During secret rotation,
re-sign with the secret the receiver currently accepts.

### Rate limits and pacing

- `sequential` (default) sends one delivery at a time — safest for
  recovering a downstream that just came back.
- `parallel` uses `--concurrency` workers; results stay in input order.
- `--delay-ms` adds pacing per worker; `--retries` only retries network
  errors and 5xx (with linear backoff), never 4xx.
- `--limit`/`--offset` let you replay a small window first (e.g. 10 records)
  to validate before the full batch.

### Dry-run first

Always run `dry-run` (or `list`) before a real replay of an unfamiliar file:
it surfaces missing endpoints, unparseable bodies, and shows the effective
idempotency key each delivery will carry.

## Procedure — DLQ recovery

1. **Export** the failed deliveries to JSONL (one record per line, see
   format above). Include `rawBody`, `headers`, and `endpoint` per record.
2. **Inspect:** `replay.mjs list --file dlq.jsonl` — check count, event ids,
   endpoints.
3. **Dry-run:** `replay.mjs dry-run --file dlq.jsonl --endpoint <url>
--secret <current-secret>` — verify endpoints resolve and keys look right.
4. **Pilot:** `replay.mjs replay --file dlq.jsonl --endpoint <url> --secret
<secret> --limit 10` — confirm `delivered`/`duplicate` statuses.
5. **Full replay:** drop `--limit`. Watch the summary; `failed` entries are
   listed with HTTP status and error snippet — fix and re-export those.
6. **Verify** downstream: check receiver `/_deliveries` or logs for the
   replayed event ids.

## Procedure — debugging a single delivery

1. Extract the record into a one-line JSONL file.
2. `dry-run --file one.jsonl --endpoint <url> --secret <secret>` to see the
   exact body/headers that would be sent.
3. Replay against a **sandbox/test endpoint** (or the contract mock
   receiver: `npx tsx scripts/webhooks/contract/receiver.ts --port 4100
--secret <secret>`) rather than production when the payload is suspect.
