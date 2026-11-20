"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { request } from "@/lib/api/client"
import {
  isOnboardingComplete,
  ONBOARDING_PATH,
  onboardingProgressPercent,
  type OnboardingRecord,
} from "@/lib/onboarding"

interface OnboardingResponse {
  onboarding?: OnboardingRecord | null
  progress?: { percent: number } | null
}

/**
 * "Continue setup" banner for the dashboard. `/app` already redirects
 * first-time users into the wizard, but `/dashboard` is reachable directly —
 * this surfaces incomplete onboardings there with the server's progress
 * percentage and a link back to `/app/onboarding`, which resumes at the
 * first incomplete step.
 *
 * Renders nothing while loading, on API failure, and once the flow is
 * complete or skipped. The dismiss button hides the banner for the current
 * page view only (component state) — the next visit re-evaluates progress.
 */
export function OnboardingResumeBanner() {
  const [percent, setPercent] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const body = await request<OnboardingResponse>("", "/api/onboarding")
        if (cancelled) return
        const record = body.onboarding ?? null
        if (!record || isOnboardingComplete(record)) {
          setPercent(null)
          return
        }
        setPercent(body.progress?.percent ?? onboardingProgressPercent(record))
      } catch {
        // API unreachable or signed-out edge — no banner.
        if (!cancelled) setPercent(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (percent === null || dismissed) return null

  return (
    <div className="app-alert app-alert--info" role="status">
      <div className="min-w-0 flex-1">
        <strong>Continue setup</strong>{" "}
        <span className="text-muted-foreground">
          {percent}% complete — pick up where you left off.
        </span>
      </div>
      <Button type="button" size="sm" asChild>
        <Link href={ONBOARDING_PATH}>
          Resume
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss setup reminder"
        onClick={() => setDismissed(true)}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
