"use client"

import { setMockSession, type MockSession } from "@/components/site/auth/mock-auth"
import { getCurrentSession } from "@/lib/auth/auth-client"
import { APP_ROOT_PATH, mockAuthEnabled, persistMockSession } from "@/lib/auth/mock-session"
import { consumeStoredReferralCode } from "@/lib/referral"

/** Returns a safe in-app destination, falling back to the app dashboard. */
export function authReturnPath(returnTo?: string | null): string {
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo
  return APP_ROOT_PATH
}

/**
 * Completes a credential/OAuth sign-in on the standalone auth pages. Mirrors
 * the dialog flow: attach a pending referral code, keep the mock session when
 * mock auth is enabled, and only navigate when a real client session exists.
 */
export function completeAuthSession(session: MockSession, returnTo?: string | null): boolean {
  const referredBy = consumeStoredReferralCode()
  const sessionWithReferral = referredBy ? { ...session, referredBy } : session
  setMockSession(sessionWithReferral)

  const target = authReturnPath(returnTo)
  if (mockAuthEnabled) {
    persistMockSession(sessionWithReferral)
    window.location.assign(target)
    return true
  }

  if (getCurrentSession()) {
    window.location.assign(target)
    return true
  }

  return false
}
