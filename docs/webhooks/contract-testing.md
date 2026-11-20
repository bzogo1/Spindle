# Webhook Contract Testing

Status: **framework in place; inbound endpoints not yet implemented.**

This document describes the webhook wire contract, the contract test suite
that enforces it, and how to wire real `src/app/api/webhooks/*` endpoints
into it when they land.

## Layout

All contract code lives in `scripts/webhooks/contract/` (owned by the
contract-testing workstream — do not scatter webhook schemas into `src/`):

| File                | Purpose                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `schemas.ts`        | Zod schemas: payload envelope, per-event `data.object` shapes, delivery headers           |
| `signing.ts`        | Stripe-style `Webhook-Signature` (`t=…,v1=…`) sign/verify helpers, tolerance window       |
| `payloads.ts`       | Fixture builders producing contract-valid payloads per event type                         |
| `receiver.ts`       | Mock webhook receiver — HTTP server + inspection endpoints, usable in-process or as a CLI |
| `signing.test.ts`   | Signature test vectors: valid, wrong-secret, tampered, expired, rotation                  |
| `payload.test.ts`   | Schema validation tests for every event type and rejection cases                          |
| `delivery.test.ts`  | End-to-end HTTP tests against the in-process receiver                                     |
| `vitest.config.mts` | Standalone vitest config (node env, `@/` alias to `src/`)                                 |

## Running the suite

The repo-root `vitest.config.mts` only picks up `src/**/*.test.ts`, so this
suite runs with its own config:

```bash
npx vitest run --config scripts/webhooks/contract/vitest.config.mts
```

Expected: 3 test files, ~68 tests, all passing. ESLint covers the directory
via the repo config (`npx eslint scripts/webhooks/contract`).

## The contract

### Payload envelope

Every webhook delivery is a JSON body matching `webhookPayloadSchema`
(`schemas.ts`) — a discriminated union on `type`:

```jsonc
{
  "id": "evt_01JZX…", // evt_ + 8–128 url-safe chars; dedup key
  "type": "newsletter.subscribed", // one of WEBHOOK_EVENT_TYPES
  "apiVersion": "2025-01", // WEBHOOK_API_VERSION — bump on breaking change
  "created": "2026-11-20T04:49:50.000Z", // ISO-8601
  "livemode": false, // true only for production traffic
  "idempotencyKey": "idem_…", // 8–255 printable ASCII, no spaces
  "data": { "object": {/* per-type payload */} },
}
```

Current event types (`WEBHOOK_EVENT_TYPES`):

- `contact.form.submitted` — `{ name, email, topic, reference?, subject, message }`
- `newsletter.subscribed` — `{ email, source?, consent: true }` (consent must be literal `true`)
- `feedback.submitted` — `{ category, message, email? }`
- `auth.user.signup.completed` — `{ userId, email, workspaceName? }`
- `notification.delivered` — `{ notificationId, userId, channel: "email"|"in-app"|"sms" }`

Adding an event type = append to `WEBHOOK_EVENT_TYPES` **and** add a
matching member to the `webhookPayloadSchema` discriminated union, plus a
builder in `payloads.ts` (`PAYLOAD_BUILDERS` is keyed by the type list, so
TypeScript will fail until all three are updated).

### Delivery headers

`webhookHeadersSchema` requires:

- `webhook-id` — must equal `payload.id` (receivers reject mismatches)
- `webhook-signature` — `t=<unix-seconds>,v1=<hex-hmac-sha256>[,v1=…]`
- `content-type: application/json`
- `idempotency-key` — optional transport-level key; payload carries its own

### Signature scheme

Stripe-style. Signed content is `` `${t}.${rawBody}` `` — the **raw request
body bytes**, never re-serialized JSON. `v1` is hex HMAC-SHA256. Multiple
`v1` values are allowed so senders can sign with current + previous secrets
during rotation. Timestamps must be within
`SIGNATURE_TOLERANCE_SECONDS` (300s) of receiver time — this bounds replay.

`signing.ts` exports `buildSignatureHeader`, `signPayload`,
`parseSignatureHeader`, and `verifySignatureHeader` (returns
`ok | reason` where reason ∈ `missing_signature | malformed_header |
timestamp_out_of_tolerance | no_matching_signature`).

**Keyring interop:** the platform keyring (`src/lib/secrets/keyring.ts`)
signs arbitrary payload strings with base64url HMAC-SHA256. The contract
uses hex — same primitive, different encoding. `signing.test.ts` proves a
real endpoint can reuse `verifyWithKeyring(keyring, `${t}.${rawBody}`, sig)`
by passing the base64url digest, or keep the hex scheme and convert. Pick
one when implementing; the contract tests pin both.

### Idempotency & dedup

Receivers must treat a repeated `idempotencyKey` (payload field, falling
back to the `Idempotency-Key` header) as a duplicate: acknowledge with 200
but do not reprocess. `webhook-id`/`payload.id` is the secondary dedup key.

## Mock receiver

`receiver.ts` implements the full receive path (signature → headers →
payload schema → idempotency → record) and exposes:

- `POST /<anything>` — the webhook endpoint (any path; the real routes will
  pick their own, e.g. `/api/webhooks/<provider>`)
- `GET /_deliveries` — JSON dump of recorded deliveries (headers, raw body,
  parsed payload, `duplicate` flag)
- `POST /_reset` — clear recorded deliveries and seen idempotency keys
- `GET /healthz` — liveness

### As a script (manual / provider testing)

```bash
npx tsx scripts/webhooks/contract/receiver.ts --port 4100 --secret whsec_test
# rotation: repeat --secret for each accepted key
curl localhost:4100/_deliveries
```

Point any webhook sender (Stripe CLI `stripe listen --forward-to`, a local
outbound-webhook job, `curl`) at it. Secrets are CLI args only — the repo
ESLint config forbids `process.env` outside `src/lib/env.ts` entrypoints.

### In-process (tests / outbound delivery checks)

```ts
import { createWebhookReceiver } from "./receiver"

const receiver = createWebhookReceiver({ secrets: [current, previous] })
const url = await receiver.start() // http://127.0.0.1:<ephemeral>
// … POST signed payloads …
await receiver.stop()
```

## Integration points (when real endpoints land)

1. **Route handlers** under `src/app/api/webhooks/*` should import
   `webhookPayloadSchema`, `webhookHeadersSchema`, and either
   `verifySignatureHeader` or the keyring helpers from
   `scripts/webhooks/contract/` (or the schemas should be promoted into
   `src/lib/webhooks/` — whichever the endpoint owners prefer; the contract
   tests must keep passing either way).
2. **Secret storage:** endpoint secrets come from the secret store via
   `createKeyring(current, previous, key)` in `src/lib/secrets/keyring.ts`.
   Pass `[keyring.current, keyring.previous].filter(Boolean)` as
   `secrets` to `verifySignatureHeader`, or use `verifyWithKeyring` directly.
3. **Outbound webhooks:** no outbound webhook code exists in `src/lib`
   today (checked — only HMAC keyring helpers in
   `src/lib/secrets/keyring.ts`). When the app starts _sending_ webhooks,
   use `buildSignatureHeader`/`signPayload` from `signing.ts` as the
   reference implementation and add a sender-side contract test that POSTs
   to `createWebhookReceiver` and asserts `duplicate`/`received` semantics.
4. **CI:** add `npx vitest run --config
scripts/webhooks/contract/vitest.config.mts` as a step (package.json is
   owned elsewhere — coordinate before adding an npm script).

## Contract-change checklist

- New event type → update `WEBHOOK_EVENT_TYPES`, the discriminated union,
  and `PAYLOAD_BUILDERS`; add fixture coverage in `payload.test.ts`.
- Breaking shape change → bump `WEBHOOK_API_VERSION`; keep the old version
  parseable for one rotation window.
- Signature scheme change → update `signing.ts`, re-pin the known-answer
  vector in `signing.test.ts` (see the regeneration comment there), and
  re-verify keyring interop.
