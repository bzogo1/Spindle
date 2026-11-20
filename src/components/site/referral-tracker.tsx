"use client"

import { useEffect } from "react"

import { readOwnReferralCode, referralCodeFromSearch, storeReferralCode } from "@/lib/referral"

/**
 * Captures an inbound `?ref=` code on the referral landing page. Renders
 * nothing; the code is persisted for the auth flow to pick up.
 *
 * Also records the click server-side via `POST /api/referral/attribution`
 * (source `"click"`, fire-and-forget) — the endpoint answers a uniform 200
 * for valid, self, and unknown codes, so this is safe for every `?ref=`
 * value. `/r/[code]` invite links do the same from `referral-landing.tsx`.
 */
export function ReferralTracker() {
  useEffect(() => {
    const code = referralCodeFromSearch(window.location.search)
    storeReferralCode(code, readOwnReferralCode())
    if (code) {
      try {
        void fetch("/api/referral/attribution", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, source: "click" }),
          keepalive: true,
        }).catch(() => {
          // Best-effort analytics — never surface errors to the page.
        })
      } catch {
        // fetch unavailable — attribution stays client-side only.
      }
    }
  }, [])

  return null
}
