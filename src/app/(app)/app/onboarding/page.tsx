import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"
import { getOnboardingRecord, isOnboardingComplete } from "@/lib/onboarding"
import { resolveSessionPrincipal } from "@/lib/onboarding-server"

export const metadata: Metadata = { title: "Welcome" }

/**
 * First-run onboarding wizard. Users who already finished or skipped the flow
 * (a completed record exists for their principal) are sent straight to the
 * dashboard; everyone else sees the wizard. Unauthenticated visitors never
 * reach this page — the `(app)` layout redirects them to sign-in first.
 *
 * Skip/resume semantics: `skipped` records count as complete, so skipping is
 * terminal — there is no re-entry path (a deliberate decision; "resume later"
 * is the non-terminal exit and leaves the record in-progress). In-progress
 * records always render the wizard, which resumes at the first incomplete
 * step via `resumeStepIndex`.
 */
export default async function OnboardingPage() {
  const principal = await resolveSessionPrincipal()
  const record = principal ? getOnboardingRecord(principal) : null
  if (record && isOnboardingComplete(record)) {
    redirect(APP_DASHBOARD_PATH)
  }

  return (
    <div className="app-page">
      <OnboardingWizard />
    </div>
  )
}
