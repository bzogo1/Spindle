import { redirect } from "next/navigation"

import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"
import { getOnboardingRecord, isOnboardingComplete, ONBOARDING_PATH } from "@/lib/onboarding"
import { resolveSessionPrincipal } from "@/lib/onboarding-server"

/**
 * `/app` is the entry point; the dashboard is the landing screen. Users with
 * no completed onboarding record for their principal are sent through the
 * wizard once (`/app/onboarding`); returning users skip straight to the
 * dashboard. Unauthenticated visitors never reach this page — the `(app)`
 * layout redirects them to sign-in first.
 */
export default async function AppIndexPage() {
  const principal = await resolveSessionPrincipal()
  const record = principal ? getOnboardingRecord(principal) : null
  if (principal && !(record && isOnboardingComplete(record))) {
    redirect(ONBOARDING_PATH)
  }
  redirect(APP_DASHBOARD_PATH)
}
