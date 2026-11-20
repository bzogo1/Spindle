import { z } from "zod"

/**
 * Webhook contract schemas.
 *
 * These schemas define the wire contract for inbound webhook deliveries
 * (payload envelope, per-event `data.object` shapes) and the delivery
 * headers receivers MUST validate before trusting a payload. They are the
 * single source of truth that both the contract test-suite and — once real
 * `src/app/api/webhooks/*` endpoints land — the route handlers should share.
 *
 * Contract version: see {@link WEBHOOK_API_VERSION}. Bump it (and keep the
 * previous version accepted for one rotation window) when shapes change.
 */

export const WEBHOOK_API_VERSION = "2025-01" as const

/**
 * Event types the platform emits/accepts. Extend this list (and add a
 * matching discriminated-union member below) when a new webhook source is
 * introduced; never reuse or rename an existing type.
 */
export const WEBHOOK_EVENT_TYPES = [
  "contact.form.submitted",
  "newsletter.subscribed",
  "feedback.submitted",
  "auth.user.signup.completed",
  "notification.delivered",
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

/** `evt_` prefix + URL-safe identifier, e.g. `evt_01JZX…`. Used for dedup. */
export const webhookEventIdSchema = z
  .string()
  .regex(/^evt_[A-Za-z0-9_-]{8,128}$/, "Event id must look like `evt_<id>`.")

/**
 * Idempotency keys are client-supplied opaque tokens. Printable ASCII only
 * (no whitespace) so they are safe to echo into logs and store verbatim.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8, "Idempotency-Key must be at least 8 characters.")
  .max(255, "Idempotency-Key must be at most 255 characters.")
  .regex(/^[\x21-\x7e]+$/, "Idempotency-Key must be printable ASCII without spaces.")

const emailField = z.email().max(320)

/* ------------------------------------------------------------------ */
/* Per-event `data.object` payloads                                    */
/* ------------------------------------------------------------------ */

const contactFormSubmittedObject = z.looseObject({
  name: z.string().min(1).max(200),
  email: emailField,
  topic: z.string().min(1).max(100),
  reference: z.string().max(200).optional(),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(10_000),
})

const newsletterSubscribedObject = z.looseObject({
  email: emailField,
  source: z.string().max(100).optional(),
  /** Consent must be explicit — mirrors the newsletter form contract. */
  consent: z.literal(true),
})

const feedbackSubmittedObject = z.looseObject({
  category: z.string().min(1).max(100),
  message: z.string().min(1).max(10_000),
  email: emailField.optional(),
})

const userSignupCompletedObject = z.looseObject({
  userId: z.string().min(1).max(128),
  email: emailField,
  workspaceName: z.string().min(1).max(120).optional(),
})

const notificationDeliveredObject = z.looseObject({
  notificationId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  channel: z.enum(["email", "in-app", "sms"]),
})

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

const envelopeBase = {
  /** Unique delivery/event id — primary dedup key alongside Idempotency-Key. */
  id: webhookEventIdSchema,
  /** Contract version of the payload shape. */
  apiVersion: z.literal(WEBHOOK_API_VERSION),
  /** ISO-8601 creation time, emitted by the sender. */
  created: z.iso.datetime({ offset: true }),
  /** `true` for production traffic; sandbox/test traffic is `false`. */
  livemode: z.boolean(),
  /**
   * Sender-supplied idempotency token, also sent as the
   * `Idempotency-Key` header. Receivers must treat replays of the same key
   * as duplicates.
   */
  idempotencyKey: idempotencyKeySchema,
  data: z.looseObject({
    /** Event-specific payload. Validated per `type` by the union below. */
    object: z.record(z.string(), z.unknown()),
  }),
} as const

/**
 * Full inbound webhook payload. A discriminated union on `type` so each
 * event's `data.object` is checked against its own schema — a
 * `newsletter.subscribed` event cannot smuggle contact-form fields.
 */
export const webhookPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    ...envelopeBase,
    type: z.literal("contact.form.submitted"),
    data: z.object({ object: contactFormSubmittedObject }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal("newsletter.subscribed"),
    data: z.object({ object: newsletterSubscribedObject }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal("feedback.submitted"),
    data: z.object({ object: feedbackSubmittedObject }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal("auth.user.signup.completed"),
    data: z.object({ object: userSignupCompletedObject }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal("notification.delivered"),
    data: z.object({ object: notificationDeliveredObject }),
  }),
])

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>
export type WebhookPayloadFor<T extends WebhookEventType> = Extract<WebhookPayload, { type: T }>

/**
 * Delivery headers a receiver MUST check. Names are the canonical lowercase
 * forms; HTTP stacks case-fold headers before this schema sees them.
 */
export const webhookHeadersSchema = z.object({
  /** Unique delivery id; must equal `payload.id` when both are present. */
  "webhook-id": webhookEventIdSchema,
  /**
   * Signature header, Stripe-style: `t=<unix-seconds>,v1=<hex-hmac>[,v1=…]`.
   * Multiple `v1` values support key rotation — see signing.ts.
   */
  "webhook-signature": z.string().min(1),
  /** Optional transport-level idempotency key (payload carries its own). */
  "idempotency-key": idempotencyKeySchema.optional(),
  "content-type": z.string().startsWith("application/json"),
})

export type WebhookHeaders = z.infer<typeof webhookHeadersSchema>
