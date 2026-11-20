import { z } from "zod"

/**
 * Account-level communication preferences — the email/product opt-ins stored
 * server-side per principal (`user:<id>` for real sessions,
 * `mock:<email>` for mock auth), the same keying scheme as
 * `src/lib/profile.ts`.
 *
 * This is deliberately separate from the localStorage-backed in-app
 * notification preferences in `src/components/app/notifications-provider.tsx`:
 * those gate the in-app feed on this device, while these opt-ins describe
 * which categories may reach the user by email or other outbound channels.
 *
 * Like the profile override map, persistence is a process-local `Map` —
 * state is lost on restart and is the single seam to replace once a real
 * preferences table/API lands.
 *
 * This module is intentionally free of server-only imports so both the API
 * route and client components can share the types and validation.
 */

export const COMMUNICATION_DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const
export type CommunicationDigestFrequency = (typeof COMMUNICATION_DIGEST_FREQUENCIES)[number]

/**
 * The full preference shape returned by `GET /api/communication-preferences`
 * and rendered by the settings panel.
 */
export interface CommunicationPreferences {
  /** Occasional product news: launches, changelog highlights, tips. */
  productUpdates: boolean
  /**
   * Security alerts (sign-ins, password changes, recovery events). Locked
   * on — account-protection mail cannot be disabled, so the type and every
   * merged result guarantee `true`.
   */
  securityAlerts: true
  /** Cadence for batched email digests. */
  digestFrequency: CommunicationDigestFrequency
  /** Occasional requests for product feedback. */
  feedbackRequests: boolean
  /** Referral-program announcements and rewards. */
  referralProgram: boolean
}

/**
 * The partial shape `PUT /api/communication-preferences` accepts. Every
 * field is optional (partial update); `securityAlerts` may only ever be
 * `true` — sending `false` is a validation error, not a silent no-op.
 */
export const communicationPreferencesUpdateSchema = z.strictObject({
  productUpdates: z.boolean().optional(),
  securityAlerts: z.literal(true, "Security alerts cannot be disabled.").optional(),
  digestFrequency: z.enum(COMMUNICATION_DIGEST_FREQUENCIES).optional(),
  feedbackRequests: z.boolean().optional(),
  referralProgram: z.boolean().optional(),
})
export type CommunicationPreferencesUpdate = z.infer<typeof communicationPreferencesUpdateSchema>

export function defaultCommunicationPreferences(): CommunicationPreferences {
  return {
    productUpdates: true,
    securityAlerts: true,
    digestFrequency: "weekly",
    feedbackRequests: true,
    referralProgram: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDigestFrequency(value: unknown): value is CommunicationDigestFrequency {
  return (
    typeof value === "string" &&
    (COMMUNICATION_DIGEST_FREQUENCIES as readonly string[]).includes(value)
  )
}

/**
 * Merges an untrusted stored value over the defaults so a corrupt or partial
 * record can never produce an invalid preferences object. `securityAlerts`
 * is always forced on regardless of what was stored.
 */
export function mergeCommunicationPreferences(stored: unknown): CommunicationPreferences {
  const defaults = defaultCommunicationPreferences()
  if (!isRecord(stored)) return defaults

  return {
    productUpdates:
      typeof stored.productUpdates === "boolean" ? stored.productUpdates : defaults.productUpdates,
    securityAlerts: true,
    digestFrequency: isDigestFrequency(stored.digestFrequency)
      ? stored.digestFrequency
      : defaults.digestFrequency,
    feedbackRequests:
      typeof stored.feedbackRequests === "boolean"
        ? stored.feedbackRequests
        : defaults.feedbackRequests,
    referralProgram:
      typeof stored.referralProgram === "boolean"
        ? stored.referralProgram
        : defaults.referralProgram,
  }
}

const overrides = new Map<string, CommunicationPreferencesUpdate>()

/** Returns the effective preferences for a principal (defaults merged with stored overrides). */
export function getCommunicationPreferences(principal: string): CommunicationPreferences {
  return mergeCommunicationPreferences(overrides.get(principal))
}

/** Applies a validated partial update and returns the merged result. */
export function updateCommunicationPreferences(
  principal: string,
  update: CommunicationPreferencesUpdate,
): CommunicationPreferences {
  overrides.set(principal, { ...overrides.get(principal), ...update })
  return getCommunicationPreferences(principal)
}

/** Test hook: clears every stored override. */
export function resetCommunicationPreferencesForTests(): void {
  overrides.clear()
}
