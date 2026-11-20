/**
 * Relying-party configuration for the WebAuthn ceremonies.
 *
 * `rpId` and `origin` are derived from the incoming request by default —
 * the deployment is single-origin, so the host the browser used IS the
 * relying party. Two optional environment overrides exist for exotic
 * deployments (e.g. the app served behind a different public hostname than
 * the request URL reports):
 *
 *   WEBAUTHN_RP_ID     overrides the rpId (must be a registrable-domain
 *                      suffix of, or equal to, the request host)
 *   WEBAUTHN_ORIGIN    overrides the expected clientDataJSON origin
 *                      (e.g. "https://auth.example.com")
 *
 * These variables are intentionally outside the validated `ServerEnv`
 * schema (same pattern as MAGIC_LINK_TTL_MINUTES): a missing or malformed
 * value must not fail startup, and values are re-read per request so
 * deploy-time overrides take effect without a module-cache reset.
 */

import type { EnvSource } from "@/lib/env"

export type RelyingParty = {
  /** rpId sent in options and checked against authData.rpIdHash. */
  rpId: string
  /** Full origin (scheme://host[:port]) checked against clientDataJSON.origin. */
  origin: string
  /** Human-friendly RP name shown by authenticators. */
  rpName: string
}

const RP_NAME = "Spindle"

/**
 * Raw `process.env` access — the single touchpoint in this module
 * (mirrors magic-link-config.ts). Guarded so importing from a client
 * bundle never dereferences `process`.
 */
function rawProcessEnv(): EnvSource {
  // eslint-disable-next-line no-restricted-properties -- WEBAUTHN_* are deliberately not part of ServerEnv; see module docstring
  return typeof process === "undefined" ? {} : process.env
}

export function rpFromRequest(request: Request, env: EnvSource = rawProcessEnv()): RelyingParty {
  const url = new URL(request.url)
  const rpIdOverride = env.WEBAUTHN_RP_ID?.trim()
  const originOverride = env.WEBAUTHN_ORIGIN?.trim()

  const rpId = rpIdOverride || url.hostname
  if (!rpId) {
    throw new Error("Could not determine the WebAuthn rpId from the request.")
  }

  const origin = originOverride || url.origin
  try {
    // Sanity: the rpId must be the origin host or a registrable suffix of
    // it, or the browser refuses every ceremony before it reaches us.
    const originHost = new URL(origin).hostname
    if (rpId !== originHost && !originHost.endsWith(`.${rpId}`)) {
      throw new Error(`WebAuthn rpId "${rpId}" is not a suffix of origin host "${originHost}".`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("WebAuthn rpId")) throw error
    throw new Error(`WEBAUTHN_ORIGIN "${origin}" is not a valid URL.`)
  }

  return { rpId, origin, rpName: RP_NAME }
}
