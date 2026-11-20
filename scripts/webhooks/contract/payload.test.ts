import { describe, expect, it } from "vitest"

import {
  idempotencyKeySchema,
  webhookEventIdSchema,
  webhookHeadersSchema,
  webhookPayloadSchema,
  WEBHOOK_API_VERSION,
  WEBHOOK_EVENT_TYPES,
} from "./schemas"
import {
  contactFormSubmittedPayload,
  feedbackSubmittedPayload,
  newsletterSubscribedPayload,
  nextEventId,
  nextIdempotencyKey,
  notificationDeliveredPayload,
  PAYLOAD_BUILDERS,
  serializeWebhookPayload,
  userSignupCompletedPayload,
} from "./payloads"

/**
 * Payload contract tests — every event type must round-trip through the
 * schema, and every contract violation must be rejected.
 */

describe("webhookPayloadSchema — happy path", () => {
  it.each(WEBHOOK_EVENT_TYPES)("accepts a valid %s payload", (type) => {
    const payload = PAYLOAD_BUILDERS[type]()
    const parsed = webhookPayloadSchema.safeParse(JSON.parse(serializeWebhookPayload(payload)))
    expect(parsed.success).toBe(true)
  })

  it("preserves the event type through parsing", () => {
    const parsed = webhookPayloadSchema.parse(
      JSON.parse(serializeWebhookPayload(newsletterSubscribedPayload())),
    )
    expect(parsed.type).toBe("newsletter.subscribed")
    if (parsed.type === "newsletter.subscribed") {
      expect(parsed.data.object.email).toBe("grace@example.com")
    }
  })

  it("round-trips a contact form payload end-to-end", () => {
    const payload = contactFormSubmittedPayload()
    const parsed = webhookPayloadSchema.parse(JSON.parse(serializeWebhookPayload(payload)))
    expect(parsed.id).toBe(payload.id)
    expect(parsed.idempotencyKey).toBe(payload.idempotencyKey)
    expect(parsed.apiVersion).toBe(WEBHOOK_API_VERSION)
  })
})

describe("webhookPayloadSchema — rejections", () => {
  const valid = () => JSON.parse(serializeWebhookPayload(feedbackSubmittedPayload()))

  it("rejects an unknown event type", () => {
    const payload = { ...valid(), type: "unknown.event" }
    expect(webhookPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it("rejects a payload missing `id`", () => {
    const payload = valid()
    delete payload.id
    expect(webhookPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it("rejects a payload with a non-`evt_` id", () => {
    expect(webhookPayloadSchema.safeParse({ ...valid(), id: "abc123" }).success).toBe(false)
  })

  it("rejects a stale apiVersion", () => {
    expect(webhookPayloadSchema.safeParse({ ...valid(), apiVersion: "1999-01" }).success).toBe(
      false,
    )
  })

  it("rejects a non-ISO `created` timestamp", () => {
    expect(webhookPayloadSchema.safeParse({ ...valid(), created: "yesterday" }).success).toBe(false)
    expect(webhookPayloadSchema.safeParse({ ...valid(), created: 1_700_000_000 }).success).toBe(
      false,
    )
  })

  it("rejects a missing idempotencyKey", () => {
    const payload = valid()
    delete payload.idempotencyKey
    expect(webhookPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it("rejects an idempotencyKey that is too short or contains spaces", () => {
    expect(webhookPayloadSchema.safeParse({ ...valid(), idempotencyKey: "short" }).success).toBe(
      false,
    )
    expect(
      webhookPayloadSchema.safeParse({ ...valid(), idempotencyKey: "has spaces here ok" }).success,
    ).toBe(false)
  })

  it("rejects wrong data.object shape for the declared type", () => {
    // newsletter.subscribed requires consent: true and an email — a contact
    // form object must not validate under it.
    const payload = JSON.parse(serializeWebhookPayload(contactFormSubmittedPayload()))
    payload.type = "newsletter.subscribed"
    expect(webhookPayloadSchema.safeParse(payload).success).toBe(false)
  })

  it("rejects newsletter payloads without explicit consent", () => {
    const payload = newsletterSubscribedPayload()
    const raw = JSON.parse(serializeWebhookPayload(payload))
    raw.data.object.consent = false
    expect(webhookPayloadSchema.safeParse(raw).success).toBe(false)
  })

  it("rejects non-object data.object", () => {
    expect(webhookPayloadSchema.safeParse({ ...valid(), data: { object: "nope" } }).success).toBe(
      false,
    )
  })

  it("rejects non-JSON-serializable edge cases (null payload)", () => {
    expect(webhookPayloadSchema.safeParse(null).success).toBe(false)
  })
})

describe("idempotencyKeySchema / webhookEventIdSchema", () => {
  it("generators produce contract-valid values", () => {
    expect(idempotencyKeySchema.safeParse(nextIdempotencyKey()).success).toBe(true)
    expect(webhookEventIdSchema.safeParse(nextEventId()).success).toBe(true)
  })

  it("rejects empty and whitespace keys", () => {
    expect(idempotencyKeySchema.safeParse("").success).toBe(false)
    expect(idempotencyKeySchema.safeParse("        ").success).toBe(false)
  })
})

describe("webhookHeadersSchema", () => {
  const headers = {
    "webhook-id": nextEventId(),
    "webhook-signature": "t=1700000000,v1=" + "a".repeat(64),
    "content-type": "application/json",
  }

  it("accepts a minimal valid header set", () => {
    expect(webhookHeadersSchema.safeParse(headers).success).toBe(true)
  })

  it("accepts an optional Idempotency-Key", () => {
    expect(
      webhookHeadersSchema.safeParse({ ...headers, "idempotency-key": nextIdempotencyKey() })
        .success,
    ).toBe(true)
  })

  it("rejects a missing signature header", () => {
    const { "webhook-signature": _omit, ...rest } = headers
    expect(webhookHeadersSchema.safeParse(rest).success).toBe(false)
  })

  it("rejects a mismatched webhook-id format", () => {
    expect(webhookHeadersSchema.safeParse({ ...headers, "webhook-id": "nope" }).success).toBe(false)
  })

  it("rejects non-JSON content types", () => {
    expect(
      webhookHeadersSchema.safeParse({ ...headers, "content-type": "text/plain" }).success,
    ).toBe(false)
  })
})

describe("remaining builders produce valid payloads", () => {
  it("userSignupCompletedPayload validates", () => {
    const parsed = webhookPayloadSchema.safeParse(
      JSON.parse(serializeWebhookPayload(userSignupCompletedPayload())),
    )
    expect(parsed.success).toBe(true)
  })

  it("notificationDeliveredPayload validates and enforces channel enum", () => {
    expect(
      webhookPayloadSchema.safeParse(
        JSON.parse(serializeWebhookPayload(notificationDeliveredPayload())),
      ).success,
    ).toBe(true)

    const raw = JSON.parse(serializeWebhookPayload(notificationDeliveredPayload()))
    raw.data.object.channel = "pigeon"
    expect(webhookPayloadSchema.safeParse(raw).success).toBe(false)
  })
})
