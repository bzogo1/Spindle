import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { webhookPayloadSchema } from "./schemas"
import { buildSignatureHeader, signPayload } from "./signing"
import {
  contactFormSubmittedPayload,
  newsletterSubscribedPayload,
  serializeWebhookPayload,
} from "./payloads"
import { createWebhookReceiver, type WebhookReceiver } from "./receiver"

/**
 * End-to-end delivery tests: a real HTTP POST against the in-process mock
 * receiver, exercising the full contract — signature, headers, payload
 * schema, and idempotent dedup — exactly as a sender/receiver pair would.
 */

const SECRET = "whsec_delivery_test_secret"
const OLD_SECRET = "whsec_delivery_old_secret"

let receiver: WebhookReceiver
let baseUrl: string

beforeAll(async () => {
  receiver = createWebhookReceiver({ secrets: [SECRET, OLD_SECRET] })
  baseUrl = await receiver.start()
})

afterAll(async () => {
  await receiver.stop()
})

function postWebhook(
  rawBody: string,
  options: {
    secret?: string
    signatureHeader?: string
    eventId?: string
    extraHeaders?: Record<string, string>
    timestamp?: number
  } = {},
): Promise<Response> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const signatureHeader =
    options.signatureHeader ?? buildSignatureHeader(options.secret ?? SECRET, rawBody, timestamp)
  // Default the webhook-id header to the payload's own id when the body is
  // parseable JSON, so tests don't trip the event_id_mismatch guard.
  let payloadId: string | undefined
  try {
    const parsed = JSON.parse(rawBody) as { id?: unknown }
    if (typeof parsed.id === "string") payloadId = parsed.id
  } catch {
    // non-JSON bodies keep the fallback id
  }
  return fetch(`${baseUrl}/webhooks/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": options.eventId ?? payloadId ?? "evt_delivery_test",
      "webhook-signature": signatureHeader,
      ...options.extraHeaders,
    },
    body: rawBody,
  })
}

function validDelivery() {
  const payload = newsletterSubscribedPayload()
  return {
    rawBody: serializeWebhookPayload(payload),
    payload,
  }
}

describe("mock receiver — happy path", () => {
  it("accepts a correctly signed, schema-valid delivery", async () => {
    const { rawBody, payload } = validDelivery()
    const res = await postWebhook(rawBody, {
      extraHeaders: { "webhook-id": payload.id },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
    expect(body.eventId).toBe(payload.id)

    const last = receiver.deliveries.at(-1)
    expect(last?.duplicate).toBe(false)
    expect(last?.payload && webhookPayloadSchema.safeParse(last.payload).success).toBe(true)
  })

  it("records the delivery with headers and raw body", async () => {
    const { rawBody } = validDelivery()
    await postWebhook(rawBody)
    const last = receiver.deliveries.at(-1)
    expect(last?.rawBody).toBe(rawBody)
    expect(last?.headers["webhook-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
  })

  it("accepts signatures made with the previous (rotation) secret", async () => {
    const { rawBody } = validDelivery()
    const res = await postWebhook(rawBody, { secret: OLD_SECRET })
    expect(res.status).toBe(200)
  })

  it("accepts a multi-v1 header signed by both secrets", async () => {
    const { rawBody } = validDelivery()
    const t = Math.floor(Date.now() / 1000)
    const header =
      `t=${t},v1=${signPayload(OLD_SECRET, t, rawBody)},` + `v1=${signPayload(SECRET, t, rawBody)}`
    const res = await postWebhook(rawBody, { signatureHeader: header })
    expect(res.status).toBe(200)
  })
})

describe("mock receiver — signature enforcement", () => {
  it("rejects an unsigned request", async () => {
    const { rawBody } = validDelivery()
    const res = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("missing_signature")
  })

  it("rejects a forged signature", async () => {
    const { rawBody } = validDelivery()
    const res = await postWebhook(rawBody, { secret: "whsec_attacker" })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("no_matching_signature")
  })

  it("rejects a tampered body", async () => {
    const { rawBody } = validDelivery()
    const tampered = rawBody.replace('"newsletter.subscribed"', '"feedback.submitted"')
    const res = await postWebhook(tampered)
    expect(res.status).toBe(400)
  })

  it("rejects an expired signature timestamp", async () => {
    const { rawBody } = validDelivery()
    const stale = Math.floor(Date.now() / 1000) - 400
    const res = await postWebhook(rawBody, { timestamp: stale })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("timestamp_out_of_tolerance")
  })
})

describe("mock receiver — payload contract", () => {
  it("rejects a signed but schema-invalid payload", async () => {
    const bad = JSON.stringify({ hello: "world" })
    const res = await postWebhook(bad)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_payload")
  })

  it("rejects malformed JSON even when correctly signed", async () => {
    const res = await postWebhook("{not json")
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_json")
  })

  it("rejects a webhook-id header that disagrees with payload.id", async () => {
    const { rawBody } = validDelivery()
    const res = await postWebhook(rawBody, { extraHeaders: { "webhook-id": "evt_other_999" } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("event_id_mismatch")
  })
})

describe("mock receiver — idempotency", () => {
  it("dedupes replays of the same Idempotency-Key", async () => {
    receiver.reset()
    const payload = contactFormSubmittedPayload({ idempotencyKey: "idem_replay_test_1" })
    const rawBody = serializeWebhookPayload(payload)

    const first = await postWebhook(rawBody, {
      extraHeaders: { "webhook-id": payload.id, "idempotency-key": payload.idempotencyKey },
    })
    expect(first.status).toBe(200)
    expect((await first.json()).duplicate).toBe(false)

    // Exact replay: same body, same signature inputs → accepted but flagged.
    const replay = await postWebhook(rawBody, {
      extraHeaders: { "webhook-id": payload.id, "idempotency-key": payload.idempotencyKey },
    })
    expect(replay.status).toBe(200)
    expect((await replay.json()).duplicate).toBe(true)
    expect(receiver.deliveries).toHaveLength(2)
    expect(receiver.deliveries[1]?.duplicate).toBe(true)
  })

  it("treats distinct idempotency keys as distinct deliveries", async () => {
    receiver.reset()
    const a = contactFormSubmittedPayload({ idempotencyKey: "idem_distinct_a" })
    const b = contactFormSubmittedPayload({ idempotencyKey: "idem_distinct_b" })
    await postWebhook(serializeWebhookPayload(a))
    await postWebhook(serializeWebhookPayload(b))
    expect(receiver.deliveries.every((d) => !d.duplicate)).toBe(true)
  })
})

describe("mock receiver — inspection endpoints", () => {
  it("GET /_deliveries returns recorded deliveries", async () => {
    const res = await fetch(`${baseUrl}/_deliveries`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.deliveries)).toBe(true)
    expect(body.deliveries.length).toBe(receiver.deliveries.length)
  })

  it("GET /healthz responds ok", async () => {
    const res = await fetch(`${baseUrl}/healthz`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it("rejects GET on the webhook path", async () => {
    const res = await fetch(`${baseUrl}/webhooks/inbound`)
    expect(res.status).toBe(405)
  })
})
