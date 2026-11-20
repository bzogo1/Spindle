import {
  WEBHOOK_API_VERSION,
  type WebhookEventType,
  type WebhookPayload,
  type WebhookPayloadFor,
} from "./schemas"

/**
 * Fixture builders producing contract-valid webhook payloads. Tests and the
 * mock receiver use these so a schema change breaks loudly in one place.
 */

let counter = 0

/** Deterministic-ish unique event id: `evt_test_<seq+random>`. */
export function nextEventId(prefix = "evt_test"): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function nextIdempotencyKey(): string {
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function envelope<T extends WebhookEventType>(
  type: T,
  object: WebhookPayloadFor<T>["data"]["object"],
  overrides: Partial<WebhookPayload> = {},
): WebhookPayload {
  return {
    id: nextEventId(),
    type,
    apiVersion: WEBHOOK_API_VERSION,
    created: new Date().toISOString(),
    livemode: false,
    idempotencyKey: nextIdempotencyKey(),
    data: { object },
    ...overrides,
  } as WebhookPayload
}

export function contactFormSubmittedPayload(
  overrides: Partial<WebhookPayload> = {},
): WebhookPayloadFor<"contact.form.submitted"> {
  return envelope(
    "contact.form.submitted",
    {
      name: "Ada Lovelace",
      email: "ada@example.com",
      topic: "billing",
      subject: "Invoice question",
      message: "Can you explain the latest invoice line items?",
    },
    overrides,
  ) as WebhookPayloadFor<"contact.form.submitted">
}

export function newsletterSubscribedPayload(
  overrides: Partial<WebhookPayload> = {},
): WebhookPayloadFor<"newsletter.subscribed"> {
  return envelope(
    "newsletter.subscribed",
    { email: "grace@example.com", source: "footer", consent: true },
    overrides,
  ) as WebhookPayloadFor<"newsletter.subscribed">
}

export function feedbackSubmittedPayload(
  overrides: Partial<WebhookPayload> = {},
): WebhookPayloadFor<"feedback.submitted"> {
  return envelope(
    "feedback.submitted",
    {
      category: "bug",
      message: "The dashboard chart fails to render on narrow screens.",
      email: "linus@example.com",
    },
    overrides,
  ) as WebhookPayloadFor<"feedback.submitted">
}

export function userSignupCompletedPayload(
  overrides: Partial<WebhookPayload> = {},
): WebhookPayloadFor<"auth.user.signup.completed"> {
  return envelope(
    "auth.user.signup.completed",
    { userId: "usr_123", email: "katherine@example.com", workspaceName: "Analytical Engines" },
    overrides,
  ) as WebhookPayloadFor<"auth.user.signup.completed">
}

export function notificationDeliveredPayload(
  overrides: Partial<WebhookPayload> = {},
): WebhookPayloadFor<"notification.delivered"> {
  return envelope(
    "notification.delivered",
    { notificationId: "ntf_456", userId: "usr_123", channel: "email" },
    overrides,
  ) as WebhookPayloadFor<"notification.delivered">
}

export const PAYLOAD_BUILDERS: Record<
  WebhookEventType,
  (overrides?: Partial<WebhookPayload>) => WebhookPayload
> = {
  "contact.form.submitted": contactFormSubmittedPayload,
  "newsletter.subscribed": newsletterSubscribedPayload,
  "feedback.submitted": feedbackSubmittedPayload,
  "auth.user.signup.completed": userSignupCompletedPayload,
  "notification.delivered": notificationDeliveredPayload,
}

/** Serializes exactly once — receivers sign/verify these raw bytes. */
export function serializeWebhookPayload(payload: WebhookPayload): string {
  return JSON.stringify(payload)
}
