# Webhook Signature Verification

Status: **module implemented** — `src/lib/webhooks/signature.ts`, tested by
`src/lib/webhooks/signature.test.ts`.

This document covers inbound webhook signature verification: the schemes
supported, the checklist every inbound endpoint must follow, and how key
rotation works. For the _outbound_ contract (the shape Spindle sends), see
`docs/webhooks/contract-testing.md` and `scripts/webhooks/contract/signing.ts`.

## Module overview

`src/lib/webhooks/signature.ts` is transport-agnostic: callers pass the raw
request body and header values, and get back a discriminated result.

```ts
import { verifyWebhookSignature } from "@/lib/webhooks/signature"

const result = verifyWebhookSignature({
  scheme: "stripe", // "stripe" | "github" | "slack" | "generic"
  rawBody, // EXACT bytes received — never re-serialized JSON
  signatureHeader: req.headers.get("webhook-signature") ?? undefined,
  timestampHeader: req.headers.get("x-slack-request-timestamp") ?? undefined, // slack only
  secrets: [process.env.WEBHOOK_SECRET!, process.env.WEBHOOK_SECRET_PREVIOUS], // rotation
  nowSeconds: Math.floor(Date.now() / 1000), // injectable for tests
})

if (!result.ok) {
  // 401 — log result.reason only; never log the signature or body
}
```

`verifyWebhookSignature` dispatches to a per-scheme verifier. Per-scheme
functions (`verifyStripeSignature`, `verifyGitHubSignature`,
`verifySlackSignature`, `verifyGenericSignature`) are also exported when you
need the narrower options type.

## Schemes supported

| Scheme    | Wire format                                                         | Signed payload      | Timestamp |
| --------- | ------------------------------------------------------------------- | ------------------- | --------- |
| `stripe`  | `Webhook-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`                  | `${t}.${rawBody}`   | `t=`      |
| `github`  | `X-Hub-Signature-256: sha256=<hex>` (bare hex also accepted)        | `rawBody`           | none      |
| `slack`   | `X-Slack-Signature: v0=<hex>` + `X-Slack-Request-Timestamp: <unix>` | `v0:<ts>:<rawBody>` | header    |
| `generic` | any header value; HMAC-SHA256 over `rawBody`                        | `rawBody`           | none      |

Details:

- **stripe** — mirrors `scripts/webhooks/contract/signing.ts`. Multiple `v1`
  values let a sender sign with both current and previous secrets; the
  verifier accepts a match against ANY `v1` under ANY configured secret.
  Unknown header keys are ignored for forward compatibility.
- **github** — `sha256=` prefix is stripped; a bare 64-char hex digest is
  also accepted. No timestamp exists in the scheme — replay protection must
  come from TLS plus payload idempotency keys (`webhook-id` /
  `idempotency-key` headers per the contract).
- **slack** — requires BOTH `X-Slack-Signature` and
  `X-Slack-Request-Timestamp`; a missing/non-numeric timestamp returns
  `missing_timestamp`.
- **generic** — configure `generic: { encoding: "hex" | "base64" | "base64url",
prefix?: string }`. `prefix` (e.g. `"sha256="`) must appear on the wire
  value and is stripped before comparison. Accepts `string | Buffer` bodies.

All comparisons are constant-time (`crypto.timingSafeEqual` on decoded
bytes); hex digests compare case-insensitively, base64 encodings are
case-sensitive.

## Result type

```ts
type SignatureVerification =
  | { ok: true; timestamp?: number; matchedSecretIndex: number }
  | {
      ok: false
      reason:
        | "missing_signature"
        | "missing_timestamp"
        | "malformed_header"
        | "timestamp_out_of_tolerance"
        | "no_matching_signature"
    }
```

`matchedSecretIndex` tells you WHICH secret in `secrets[]` verified — useful
for logging which key is still in its rotation window. `timestamp` is
populated for timestamped schemes.

## Inbound verification checklist

Every inbound webhook endpoint MUST:

1. **Read the raw body.** Verify against the exact request bytes
   (`await req.text()` / `req.arrayBuffer()`), never a re-serialized JSON
   object — key order and whitespace changes break the HMAC.
2. **Reject before parsing.** Run signature verification BEFORE JSON.parse
   or schema validation; an unsigned body must never reach application code.
3. **Check the timestamp window** for timestamped schemes. Default tolerance
   is `SIGNATURE_TOLERANCE_SECONDS = 300` (5 min, same as the contract
   suite); override per-provider via `toleranceSeconds`.
4. **Pass all rotation secrets.** `secrets: [current, previous]` — any match
   verifies. An empty `secrets` array always fails with
   `no_matching_signature`; treat missing config as a hard error, not a skip.
5. **Return a uniform 401** on `ok: false`. Do not distinguish "bad
   signature" from "stale timestamp" in the response body — the `reason`
   goes to logs only.
6. **Dedupe after verify.** Replay within the tolerance window is still
   possible; dedupe on `webhook-id` / payload `idempotencyKey` per
   `docs/webhooks/contract-testing.md`.
7. **Never log secrets, signatures, or bodies.** Log `reason`,
   `matchedSecretIndex`, and the event id only.
8. **Fail closed.** If the secret env var is unset, return 500/401 — never
   bypass verification.

## Key rotation

Rotation uses the existing `Keyring` pattern (`src/lib/secrets/keyring.ts`):

1. Generate the new secret; configure it as `WEBHOOK_SECRET` (current) and
   move the old value to `WEBHOOK_SECRET_PREVIOUS`.
2. Pass both to the verifier: `secrets: [current, previous]`. Senders
   signing with either key verify; `matchedSecretIndex` shows which.
3. After the provider has rolled all senders to the new key (watch for
   `matchedSecretIndex === 1` disappearing from logs), clear
   `WEBHOOK_SECRET_PREVIOUS`.
4. For Stripe-style schemes, senders may also dual-sign: multiple `v1=`
   values in one header. The verifier already accepts that — no extra work.

Outbound signing helpers (`signWebhookSignature`,
`buildStripeSignatureHeader`, `buildGitHubSignatureHeader`,
`buildSlackSignatureHeader`, `signGeneric`) exist for tests and any future
sender code — always sign with the FIRST secret only.

## Testing

`signature.test.ts` pins known-answer vectors (regeneration commands are in
the file header) plus rejection cases: missing/malformed headers, stale
timestamps, wrong secrets, tampered bodies, rotation, and Buffer bodies.
Run with the standard suite:

```bash
npx vitest run src/lib/webhooks/signature.test.ts
```
