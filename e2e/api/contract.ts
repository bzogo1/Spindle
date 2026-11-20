import { z } from "zod"

/**
 * API contract schemas for the Next.js route handlers under `src/app/api/`.
 *
 * These zod schemas are the *test-side* statement of the wire contract — they
 * intentionally mirror (but do not import) the server-side validators in
 * `src/lib/auth/schemas.ts`, `src/lib/site-forms.ts`, `src/lib/feedback.ts`,
 * `src/lib/nps.ts`, `src/lib/analytics.ts`, `src/lib/notifications/*`, and
 * `src/lib/activity/*`. Keeping them duplicated means a server-side contract
 * change fails here loudly instead of being silently re-validated by the same
 * code that produced it.
 *
 * Envelope conventions (see `src/lib/auth/http.ts` and the site-form routes):
 *
 *  - Auth-family routes (`/api/auth/*`, `/api/profile`, `/api/cohorts`,
 *    `/api/communication-preferences`, `/api/notifications*`, `/api/activity*`,
 *    `/api/analytics*`) answer through `ok()`/`fail()`:
 *      success → `{ ok: true, ...payload }`
 *      failure → `{ ok: false, code: <machine_code>, message: <human>, ...extra }`
 *  - Public site-form routes (`/api/contact`, `/api/newsletter`,
 *    `/api/feedback`, `/api/nps`) and `/api/email/unsubscribe` use a local
 *    envelope WITHOUT a `code` field:
 *      success → `{ ok: true, message, ... }`
 *      failure → `{ ok: false, message, errors?: Record<field, message> }`
 *  - Realtime publish routes (`/api/notifications`, `/api/activity`) return a
 *    bare `{ ok: true }`.
 */

/* ------------------------------------------------------------------------ */
/* Shared building blocks                                                    */
/* ------------------------------------------------------------------------ */

/** `AuthUser` — `src/lib/auth/backend.ts`. */
export const authUserSchema = z.looseObject({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
})

/** `WorkspaceInfo` — `src/lib/auth/backend.ts`. */
export const workspaceInfoSchema = z.looseObject({
  name: z.string(),
  slug: z.string(),
})

/** `AuthSessionInfo` — returned by sign-in/refresh/OAuth/magic-link. */
export const authSessionSchema = z.looseObject({
  user: authUserSchema,
  workspace: workspaceInfoSchema.nullable(),
  sessionId: z.string(),
  expiresAt: z.string(),
})

/** `fail()` envelope from `src/lib/auth/http.ts`. */
export const authFailSchema = z.looseObject({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
})

/** `ok()` envelope — `{ ok: true }` plus arbitrary payload keys. */
export const authOkEnvelope = z.looseObject({ ok: z.literal(true) })

/** Site-form `fail()` envelope — no `code`, optional per-field `errors`. */
export const siteFormFailSchema = z.looseObject({
  ok: z.literal(false),
  message: z.string(),
  errors: z.record(z.string(), z.string()).optional(),
})

/** Site-form `ok()` envelope. */
export const siteFormOkSchema = z.looseObject({
  ok: z.literal(true),
  message: z.string(),
})

/* ------------------------------------------------------------------------ */
/* Public site forms (no auth, per-IP rate limited, honeypot `website`)      */
/* ------------------------------------------------------------------------ */

/** POST /api/contact — success adds a `CT-XXXXXXXX` ticket reference. */
export const contactOkSchema = z.looseObject({
  ok: z.literal(true),
  message: z.string(),
  reference: z
    .string()
    .regex(/^CT-[0-9A-F]{8}$/)
    .optional(),
})

export const newsletterOkSchema = siteFormOkSchema
export const feedbackOkSchema = siteFormOkSchema
export const npsOkSchema = siteFormOkSchema

/**
 * Valid minimal bodies (honeypot `website` intentionally omitted/empty).
 * Limits: see `src/lib/site-form-constants.ts` and `src/lib/feedback-constants.ts`.
 */
export const VALID_CONTACT_BODY = {
  name: "Contract Test",
  email: "contract@example.com",
  topic: "general",
  subject: "Contract test message",
  message: "This is a contract test submission for the contact form.",
} as const

export const VALID_NEWSLETTER_BODY = {
  email: "contract-newsletter@example.com",
  consent: true,
} as const

export const VALID_FEEDBACK_BODY = {
  category: "bug",
  message: "Contract test feedback message, long enough.",
} as const

export const VALID_NPS_BODY = {
  score: 9,
  comment: "Contract test",
  source: "widget",
} as const

/* ------------------------------------------------------------------------ */
/* /api/email/unsubscribe                                                    */
/* ------------------------------------------------------------------------ */

export const unsubscribeStatusSchema = z.looseObject({
  ok: z.literal(true),
  email: z.string(),
  scope: z.string(),
  subscribed: z.boolean(),
  expiresAt: z.string(),
})

/** POST success adds a human `message`. */
export const unsubscribePostOkSchema = z.looseObject({
  ok: z.literal(true),
  email: z.string(),
  scope: z.string(),
  subscribed: z.literal(false),
  message: z.string(),
})

/* ------------------------------------------------------------------------ */
/* /api/auth/*                                                               */
/* ------------------------------------------------------------------------ */

/** POST /api/auth/signin|signup success body (`status` distinguishes 2FA). */
export const signInOkSchema = z.looseObject({
  ok: z.literal(true),
  status: z.enum(["ok", "totp_required"]),
  session: authSessionSchema.optional(),
  challenge: z.string().optional(),
})

export const signUpOkSchema = z.looseObject({
  ok: z.literal(true),
  status: z.literal("ok"),
  session: authSessionSchema,
})

/** GET /api/auth/session — `session` is null when signed out. */
export const sessionLookupSchema = z.looseObject({
  ok: z.literal(true),
  session: authSessionSchema.nullable(),
})

/** POST /api/auth/refresh success. */
export const refreshOkSchema = z.looseObject({
  ok: z.literal(true),
  session: authSessionSchema,
})

/** GET /api/auth/audit — `AuthAuditEvent` list (`src/lib/auth/audit.ts`). */
export const authAuditEventSchema = z.looseObject({
  timestamp: z.string(),
  type: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
})

export const authAuditSchema = z.looseObject({
  ok: z.literal(true),
  events: z.array(authAuditEventSchema),
  limit: z.number().int(),
})

/** POST /api/auth/2fa/enroll. */
export const totpEnrollSchema = z.looseObject({
  ok: z.literal(true),
  secret: z.string(),
  otpauthUrl: z.string(),
  digits: z.literal(6),
  periodSeconds: z.literal(30),
})

/** POST /api/auth/2fa/confirm. */
export const totpConfirmSchema = z.looseObject({
  ok: z.literal(true),
  enabled: z.literal(true),
  backupCodes: z.array(z.string()),
})

/** POST /api/auth/2fa/disable. */
export const totpDisableSchema = z.looseObject({
  ok: z.literal(true),
  disabled: z.literal(true),
})

/** GET /api/auth/2fa/backup-codes — `BackupCodeStatus` plus the 2FA flag. */
export const backupCodeStatusSchema = z.looseObject({
  ok: z.literal(true),
  enabled: z.boolean(),
  managed: z.boolean(),
  remaining: z.number().int().nullable(),
})

/** POST /api/auth/2fa/backup-codes. */
export const backupCodesIssueSchema = z.looseObject({
  ok: z.literal(true),
  backupCodes: z.array(z.string()),
  remaining: z.number().int(),
})

/** POST /api/auth/2fa/verify-login success — session cookies + session JSON. */
export const verifyLoginOkSchema = z.looseObject({
  ok: z.literal(true),
  session: authSessionSchema,
})

/**
 * POST /api/auth/2fa/recovery/request — starts or resends a recovery.
 * `awaiting_token` carries `emailSent` (+ `retryAfterSeconds` when the resend
 * throttle suppresses the email); `cooldown` reports the existing `executeAt`.
 */
export const recoveryRequestOkSchema = z.looseObject({
  ok: z.literal(true),
  state: z.enum(["awaiting_token", "cooldown"]),
  emailSent: z.boolean().optional(),
  retryAfterSeconds: z.number().int().optional(),
  executeAt: z.string().optional(),
})

/** POST /api/auth/2fa/recovery/confirm — token consumed, cooldown started. */
export const recoveryConfirmOkSchema = z.looseObject({
  ok: z.literal(true),
  state: z.literal("cooldown"),
  executeAt: z.string(),
})

/** GET /api/auth/2fa/recovery/status — recovery state machine position. */
export const recoveryStatusSchema = z.looseObject({
  ok: z.literal(true),
  state: z.enum(["none", "awaiting_token", "cooldown", "completed"]),
  executeAt: z.string().optional(),
  secondsRemaining: z.number().int().optional(),
  enabled: z.boolean().optional(),
})

/** POST /api/auth/2fa/recovery/cancel. */
export const recoveryCancelOkSchema = z.looseObject({
  ok: z.literal(true),
  state: z.literal("cancelled"),
})

/** GET /api/auth/oauth/[provider] public provider config. */
export const oauthProviderSchema = z.looseObject({
  ok: z.literal(true),
  provider: z.string(),
  clientId: z.string(),
  authorizeUrl: z.string(),
  scopes: z.array(z.string()),
  redirectUri: z.string(),
})

/** POST /api/auth/oauth/callback success. */
export const oauthCallbackOkSchema = z.looseObject({
  ok: z.literal(true),
  session: authSessionSchema,
})

/** Token-consuming endpoints share `{ ok:true, <flag>: true }`. */
export const verifyEmailOkSchema = z.looseObject({ ok: z.literal(true), verified: z.literal(true) })
export const resetConfirmOkSchema = z.looseObject({ ok: z.literal(true), reset: z.literal(true) })

/** Anti-enumeration endpoints always answer `{ ok:true, sent:true }`. */
export const sentOkSchema = z.looseObject({ ok: z.literal(true), sent: z.literal(true) })

/** POST /api/auth/verify-email/resend adds a cooldown hint. */
export const resendOkSchema = z.looseObject({
  ok: z.literal(true),
  sent: z.literal(true),
  retryAfter: z.number().int(),
})

/* ------------------------------------------------------------------------ */
/* Authenticated account routes (mock session `mock:<email>` or `user:<id>`) */
/* ------------------------------------------------------------------------ */

/** GET/PUT /api/profile — `ProfileData` (`src/lib/profile.ts`). */
export const profileSchema = z.looseObject({
  ok: z.literal(true),
  profile: z.looseObject({
    name: z.string(),
    email: z.string(),
    memberSince: z.string().nullable(),
  }),
})

/** GET/PUT /api/communication-preferences — `CommunicationPreferences`. */
export const communicationPreferencesSchema = z.looseObject({
  ok: z.literal(true),
  preferences: z.looseObject({
    productUpdates: z.boolean(),
    securityAlerts: z.literal(true),
    digestFrequency: z.enum(["off", "daily", "weekly"]),
    feedbackRequests: z.boolean(),
    referralProgram: z.boolean(),
  }),
})

/** GET /api/cohorts — `CohortReport` (`src/lib/cohorts.ts`); demo-sourced. */
export const cohortsSchema = z.looseObject({
  ok: z.literal(true),
  report: z.looseObject({
    generatedAt: z.string(),
    dataSource: z.literal("demo"),
    note: z.string(),
    weeks: z.number().int(),
    cohorts: z.array(z.looseObject({})),
    totals: z.looseObject({
      users: z.number().int(),
      excludedUsers: z.number().int(),
      activeThisWeek: z.number().int(),
    }),
  }),
})

/** POST /api/notifications and /api/activity — bare acknowledgement. */
export const publishOkSchema = z.looseObject({ ok: z.literal(true) })

/** POST /api/notifications/digest — `DigestSendResult` or `not-due`. */
export const digestResultSchema = z.looseObject({
  ok: z.literal(true),
  delivery: z.enum(["sent", "unconfigured", "empty", "disabled", "not-due"]),
  itemCount: z.number().int().optional(),
  overflowCount: z.number().int().optional(),
})

/** POST /api/analytics — `{ accepted: <event count> }`. */
export const analyticsIngestSchema = z.looseObject({
  ok: z.literal(true),
  accepted: z.number().int(),
})

/** GET /api/analytics/summary — `AnalyticsSummary` (`src/lib/analytics.ts`). */
export const analyticsSummarySchema = z.looseObject({
  ok: z.literal(true),
  summary: z.looseObject({
    days: z.number().int(),
    generatedAt: z.number(),
    totals: z.looseObject({
      events: z.number().int(),
      pageViews: z.number().int(),
      featureUses: z.number().int(),
      apiCalls: z.number().int(),
    }),
    daily: z.array(z.looseObject({})),
    topEvents: z.array(z.looseObject({})),
    topPaths: z.array(z.looseObject({})),
  }),
})
