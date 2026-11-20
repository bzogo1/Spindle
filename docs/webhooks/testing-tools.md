# Webhook Testing Tools

Local toolkit for exercising webhook senders and receivers without any
external services. Everything runs offline with plain `node` — no `tsx`, no
dependencies, no network beyond localhost.

Related: [contract-testing.md](./contract-testing.md) defines the wire
contract (`scripts/webhooks/contract/`) these tools simulate.

## Layout

`scripts/webhooks/test-tools/`:

| File              | Purpose                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `serve.mjs`       | Local webhook receiver + web inspector + built-in event simulator               |
| `send.mjs`        | CLI sender — fires contract-shaped events at any endpoint                       |
| `lib.mjs`         | Shared signing/fixture/arg helpers (byte-compatible with `contract/signing.ts`) |
| `gen-fixtures.ts` | Regenerates `fixtures/*.json` from the contract payload builders (`npx tsx`)    |
| `fixtures/*.json` | One contract-valid payload per event type, plus intentionally invalid ones      |

## Quick start

```bash
# Terminal 1 — receiver + inspector
node scripts/webhooks/test-tools/serve.mjs --port 4100 --secret whsec_test

# Terminal 2 — fire events at it
node scripts/webhooks/test-tools/send.mjs \
  --url http://localhost:4100/api/webhooks/test \
  --secret whsec_test \
  --event newsletter.subscribed
```

Then open http://localhost:4100/ for the inspector: every delivery with its
signature verdict, event type, idempotency key and raw body; buttons to send
sample events or reset.

Secrets are passed as `--secret` args (repeatable, for rotation) — repo ESLint
forbids `process.env` in scripts, matching the contract receiver.

## One-command demo

```bash
node scripts/webhooks/test-tools/serve.mjs --port 4100 --secret whsec_test --demo
```

`--demo` starts the server, then fires a burst covering the main paths —
valid `contact.form.submitted`, `newsletter.subscribed`, a wrong-secret,
stale-timestamp, tampered-body and missing-signature delivery — and prints
each result. Open `/` to inspect the recorded deliveries.

## send.mjs reference

```bash
node scripts/webhooks/test-tools/send.mjs \
  --url <endpoint> --secret <whsec> \
  [--event <fixture>] [--mode <mode>] [--repeat N] [--delay ms] \
  [--exact] [--raw <file|->] [--header K=V ...] [--list]
```

- `--event` / `--fixture` — fixture name; see `--list`. Valid fixtures are the
  five event types; `*.bad-*` fixtures are schema-invalid payloads for testing
  receiver validation (note: `serve.mjs` checks signature + JSON only — use the
  contract receiver `scripts/webhooks/contract/receiver.ts` or the vitest suite
  for full zod schema enforcement).
- `--mode` — which signature scenario to produce:

  | Mode           | Sends                                               | Expected at a contract receiver  |
  | -------------- | --------------------------------------------------- | -------------------------------- |
  | `valid`        | Correct `t=…,v1=…` HMAC                             | 200                              |
  | `wrong-secret` | Signed with `whsec_definitely_wrong`                | 400 `no_matching_signature`      |
  | `stale`        | Timestamp 1h old (> 300s tolerance)                 | 400 `timestamp_out_of_tolerance` |
  | `tampered`     | Signed body, then body mutated before send          | 400 `no_matching_signature`      |
  | `malformed`    | `Webhook-Signature: not-a-signature-header`         | 400 `malformed_header`           |
  | `missing`      | No signature header                                 | 400 `missing_signature`          |
  | `rotation`     | Two `v1` sigs — one bogus, one valid                | 200 (multi-sig tolerated)        |
  | `raw`          | Literal body via `--raw` (signed if `--secret` set) | depends on receiver              |

- Freshness: by default each send regenerates `id`, `idempotencyKey` and
  `created` so repeats are not flagged as duplicates. Pass `--exact` to replay
  the fixture verbatim — a second `--exact` send returns `duplicate: true`.
- `--repeat N --delay ms` — burst/replay testing.
- `--header K=V` — extra headers (repeatable).
- Exit code is 2 when a `valid`/`rotation` delivery is rejected — handy in
  shell scripts asserting a receiver accepts good traffic. Rejection modes
  (`wrong-secret`, etc.) exit 0 since rejection is the expected outcome;
  inspect the HTTP status in the printed output.

## serve.mjs endpoints

| Endpoint           | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `POST /<any>`      | Webhook receiver — verifies signature, records delivery, 200/400                  |
| `GET /`            | HTML inspector (deliveries table + send/reset UI)                                 |
| `GET /_deliveries` | JSON dump: headers, raw body, parsed payload, signature verdict, `duplicate` flag |
| `GET /_fixtures`   | List available fixture names                                                      |
| `POST /_send`      | Simulator: `{event, mode, secret?, repeat?}` fires an event at the server itself  |
| `POST /_reset`     | Clear deliveries + seen idempotency keys                                          |
| `GET /healthz`     | Liveness                                                                          |

The receiver mirrors the contract receive path — signature verification
against raw bytes, timestamp tolerance (300s), multi-secret keyring,
idempotency dedup on `Idempotency-Key`/payload `idempotencyKey` — but does
**not** run zod schema validation (it is dependency-free `.mjs`). For schema
strictness use `scripts/webhooks/contract/receiver.ts` (run via
`npx tsx … --port 4100 --secret …`) or the vitest suite.

## Fixtures

`fixtures/` contains one JSON payload per contract event type, generated from
`scripts/webhooks/contract/payloads.ts` so they cannot drift from the schema:

```bash
npx tsx scripts/webhooks/test-tools/gen-fixtures.ts   # regenerate after contract changes
```

| Fixture                             | Notes                             |
| ----------------------------------- | --------------------------------- |
| `contact.form.submitted`            | valid                             |
| `newsletter.subscribed`             | valid                             |
| `feedback.submitted`                | valid                             |
| `auth.user.signup.completed`        | valid                             |
| `notification.delivered`            | valid                             |
| `newsletter.subscribed.bad-consent` | `consent: false` — schema-invalid |
| `contact.form.submitted.bad-email`  | malformed email — schema-invalid  |

## Typical workflows

**Test a local endpoint under development** (e.g. a route you just wrote):

```bash
node scripts/webhooks/test-tools/send.mjs --url http://localhost:3000/api/webhooks/acme \
  --secret $WHSEC --event contact.form.submitted --mode valid
# then each failure mode, expecting 4xx:
for m in wrong-secret stale tampered malformed missing; do
  node scripts/webhooks/test-tools/send.mjs --url … --secret $WHSEC \
    --event newsletter.subscribed --mode $m
done
```

**Test idempotency / dedup:**

```bash
node scripts/webhooks/test-tools/send.mjs --url … --secret $WHSEC \
  --event notification.delivered --exact --repeat 3
# second and third deliveries → "duplicate": true
```

**Test a provider webhook locally** (ngrok/stripe listen forwarding): point the
forwarder at `serve.mjs`'s port and inspect real deliveries in `/` or
`/_deliveries`.

**Point contract tests at real HTTP:** the vitest suite already covers this —
`scripts/webhooks/contract/delivery.test.ts` uses `createWebhookReceiver()`
in-process. These tools are for manual/exploratory testing and for endpoints
that don't exist yet.
