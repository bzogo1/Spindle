/** How a reset or verification link behaves on the frontend. */
export type TokenState = "valid" | "expired" | "used" | "invalid"

/** Resend buttons stay disabled for this long after a link is sent. */
export const RESEND_COOLDOWN_SECONDS = 30

/**
 * Demo-safe token classification.
 *
 * Email delivery and token storage are not wired up yet, so the screens use
 * recognisable token prefixes to render every state: `expired-…`, `used-…`,
 * `invalid`/`bad-token`, or anything else as a currently valid link.
 */
export function getTokenState(token: string | null | undefined): TokenState {
  const normalized = token?.trim().toLowerCase()
  if (!normalized || normalized === "invalid" || normalized === "bad-token") {
    return "invalid"
  }
  if (normalized.startsWith("expired")) return "expired"
  if (normalized.startsWith("used")) return "used"
  return "valid"
}
