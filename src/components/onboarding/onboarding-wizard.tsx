"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"

import { useMockSession } from "@/components/app/mock-session-provider"
import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"
import { Skeleton } from "@/components/app/states/skeleton"
import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { trackFeatureUse } from "@/lib/analytics"
import { request } from "@/lib/api/client"
import {
  applyOnboardingProgress,
  getCompletedStepIds,
  isFirstStep,
  isLastStep,
  isOnboardingComplete,
  mergeOnboardingRecords,
  nextStepIndex,
  ONBOARDING_STEP_IDS,
  onboardingStorageKey,
  parseOnboardingAnswers,
  previousStepIndex,
  readStoredOnboarding,
  resumeStepIndex,
  stepIdAt,
  wizardProgressPercent,
  writeStoredOnboarding,
  type OnboardingAnswers,
  type OnboardingRecord,
  type OnboardingStepId,
} from "@/lib/onboarding"
import { parseDisplayName } from "@/lib/profile"

import { PreferencesStep, ProfileStep, TourStep, WelcomeStep } from "./onboarding-steps"

/** Where the wizard sends the user once the flow is finished or skipped. */
const ONBOARDING_DONE_PATH = "/app"

interface OnboardingResponse {
  onboarding?: OnboardingRecord | null
}

/**
 * First-run onboarding wizard for `/app/onboarding`.
 *
 * Loads the user's saved progress from `GET /api/onboarding` (falling back to
 * the `localStorage` copy when the API is unreachable), walks the four steps
 * in `ONBOARDING_STEP_IDS`, persists each move via `PUT`, and finishes or
 * skips via `POST` before routing back to `/app`. The whole flow is skippable
 * and every answer optional.
 */
export function OnboardingWizard() {
  const { t } = useLanguage()
  const { user } = useMockSession()
  const router = useRouter()

  const storageKey = onboardingStorageKey(user?.email)

  const [phase, setPhase] = useState<"loading" | "ready">("loading")
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>({})
  /** Steps the user advanced past — drives the progress % and resume point. */
  const [completedSteps, setCompletedSteps] = useState<OnboardingStepId[]>([])
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  /** Latest known record (server or localStorage) used to build fallbacks. */
  const recordRef = useRef<OnboardingRecord | null>(null)

  /**
   * Re-submits a locally-completed record to the server (progress PUT, then
   * completion POST). Returns true only when the server confirms completion —
   * the `/app` guard reads the server store exclusively, so the wizard must
   * never navigate there on the strength of a localStorage record alone.
   */
  async function syncStoredCompletion(stored: OnboardingRecord): Promise<boolean> {
    try {
      await request<OnboardingResponse>("", "/api/onboarding", {
        method: "PUT",
        body: { stepIndex: stored.stepIndex, answers: stored.answers },
      })
      const body = await request<OnboardingResponse>("", "/api/onboarding", {
        method: "POST",
        body: { skipped: stored.skipped },
      })
      recordRef.current = body.onboarding ?? null
      return true
    } catch {
      return false
    }
  }

  /**
   * Re-submits a newer localStorage progress record after the initial GET
   * returned a stale (or missing) record — offline work must not be lost
   * just because the server answered. Each completed step the server is
   * missing is replayed as a PUT `completedStep` (idempotent per step id);
   * every PUT also carries stepIndex + the full answers object, so the last
   * one syncs position and answers too. Fire-and-forget: on failure the
   * localStorage copy remains the fallback, and `recordRef` is only updated
   * when it still holds the merged seed so a concurrent `persistProgress`
   * is never clobbered by a late response.
   */
  async function syncStoredProgress(
    merged: OnboardingRecord,
    serverRecord: OnboardingRecord | null,
  ): Promise<void> {
    try {
      const serverDone = new Set(serverRecord ? getCompletedStepIds(serverRecord) : [])
      const missing = getCompletedStepIds(merged).filter((id) => !serverDone.has(id))
      const syncSteps: (OnboardingStepId | undefined)[] = missing.length > 0 ? missing : [undefined]
      let latest: OnboardingRecord | null = null
      for (const completedStep of syncSteps) {
        const body = await request<OnboardingResponse>("", "/api/onboarding", {
          method: "PUT",
          body: {
            stepIndex: merged.stepIndex,
            answers: merged.answers,
            ...(completedStep ? { completedStep } : {}),
          },
        })
        latest = body.onboarding ?? latest
      }
      if (latest && recordRef.current === merged) recordRef.current = latest
      writeStoredOnboarding(storageKey, latest ?? merged)
    } catch {
      // Still unreachable — the localStorage copy covers the next load.
    }
  }

  // Initial load. The server record is the source of truth; a stored
  // localStorage copy covers API outages and resumes progress made offline.
  // Completion is the exception: the `/app` page guard only consults the
  // server store, so redirecting on a local-only "completed" flag would loop
  // (/app/onboarding → /app → /app/onboarding). When the server has no
  // completed record but localStorage claims one, the completion is re-POSTed
  // first; if that fails the wizard simply renders again — no auto-redirect,
  // so no loop is possible.
  useEffect(() => {
    let cancelled = false

    async function load() {
      let serverRecord: OnboardingRecord | null
      try {
        const body = await request<OnboardingResponse>("", "/api/onboarding")
        serverRecord = body.onboarding ?? null
      } catch {
        serverRecord = null
      }
      if (cancelled) return

      const stored = readStoredOnboarding(storageKey)

      if (serverRecord && isOnboardingComplete(serverRecord)) {
        router.replace(ONBOARDING_DONE_PATH)
        return
      }

      if (stored && isOnboardingComplete(stored)) {
        const synced = await syncStoredCompletion(stored)
        if (cancelled) return
        if (synced) {
          router.replace(ONBOARDING_DONE_PATH)
          return
        }
        // Sync failed — fall through and render the wizard seeded from the
        // best available record. The user can finish/skip again once the API
        // recovers; nothing redirects until the server agrees.
      }

      // Merge rather than prefer the server: a stale server record must not
      // discard newer in-progress localStorage work. The merge unions
      // completedSteps/stepHistory and keeps completion sticky.
      const record = mergeOnboardingRecords(serverRecord, stored)
      recordRef.current = record
      if (record) {
        // Resume at the first incomplete step — not necessarily stepIndex,
        // which may point earlier after the user navigated Back to review.
        setStepIndex(resumeStepIndex(record))
        setAnswers(parseOnboardingAnswers(record.answers))
        setCompletedSteps(getCompletedStepIds(record))
      }
      setPhase("ready")

      // localStorage is newer than what the server returned (or the GET
      // failed): re-sync the merged record so the server catches up on
      // progress made offline. In-progress only — a completed stored record
      // was already handled by syncStoredCompletion above.
      if (
        record &&
        stored &&
        !isOnboardingComplete(stored) &&
        (!serverRecord || Date.parse(stored.updatedAt) > Date.parse(serverRecord.updatedAt))
      ) {
        void syncStoredProgress(record, serverRecord)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // storageKey is derived from the session email; re-running when it
    // resolves keeps the localStorage namespace correct.
  }, [router, storageKey])

  // Move focus to the step heading whenever the step changes so keyboard and
  // screen-reader users land on the new context instead of a stale control.
  useEffect(() => {
    if (phase === "ready") headingRef.current?.focus()
  }, [phase, stepIndex])

  // Analytics: one step_view per landing (consent-gated inside trackFeatureUse;
  // step ids are non-identifying).
  useEffect(() => {
    if (phase !== "ready") return
    trackFeatureUse("onboarding_step_view", {
      step: stepIdAt(stepIndex),
      index: stepIndex,
    })
  }, [phase, stepIndex])

  function applyAnswers(next: OnboardingAnswers) {
    setAnswers(next)
    if (fieldError) setFieldError(null)
  }

  /**
   * Persists progress; on API failure writes the localStorage fallback.
   * `completedStep` marks the step the user is advancing PAST — recorded in
   * `completedSteps`/`stepHistory` server-side (and locally offline) so the
   * percentage and resume point survive Back navigation and reloads.
   */
  async function persistProgress(
    nextStepIndex: number,
    nextAnswers: OnboardingAnswers,
    completedStep?: OnboardingStepId,
  ) {
    const local = applyOnboardingProgress(recordRef.current, {
      stepIndex: nextStepIndex,
      answers: nextAnswers,
      // The wizard always holds the complete answers object, so absent keys
      // mean "cleared" — replace rather than merge (matches the PUT contract).
      replaceAnswers: true,
      completedStep,
    })
    try {
      const body = await request<OnboardingResponse>("", "/api/onboarding", {
        method: "PUT",
        body: {
          stepIndex: local.stepIndex,
          answers: local.answers,
          ...(completedStep ? { completedStep } : {}),
        },
      })
      recordRef.current = body.onboarding ?? local
    } catch {
      recordRef.current = local
      writeStoredOnboarding(storageKey, local)
    }
  }

  /** Validates the profile step's optional display name before advancing. */
  function validateCurrentStep(): boolean {
    if (stepIdAt(stepIndex) !== "profile") return true
    const raw = answers.displayName
    if (raw === undefined || !raw.trim()) return true
    const parsed = parseDisplayName(raw)
    if (!parsed.ok) {
      setFieldError(parsed.error)
      return false
    }
    if (parsed.name !== raw) {
      setAnswers({ ...answers, displayName: parsed.name })
    }
    return true
  }

  function goNext() {
    if (!validateCurrentStep()) return
    if (isLastStep(stepIndex)) {
      void finish(false)
      return
    }
    const next = nextStepIndex(stepIndex)
    const completedStep = stepIdAt(stepIndex)
    setFieldError(null)
    setStepIndex(next)
    setCompletedSteps((current) =>
      current.includes(completedStep) ? current : [...current, completedStep],
    )
    trackFeatureUse("onboarding_step_complete", { step: completedStep })
    void persistProgress(next, answers, completedStep)
  }

  function goBack() {
    const previous = previousStepIndex(stepIndex)
    setFieldError(null)
    setStepIndex(previous)
    void persistProgress(previous, answers)
  }

  /**
   * "I'll do this later" — exits WITHOUT completing the flow. Unlike Skip
   * (which POSTs `skipped: true` and is terminal), this leaves the record
   * in-progress: every step move was already persisted via PUT, so the
   * dashboard's OnboardingResumeBanner picks the flow back up at the first
   * incomplete step. The target is `/dashboard`, not `/app` — `/app`'s
   * server guard redirects any incomplete onboarding straight back here.
   */
  function resumeLater() {
    trackFeatureUse("onboarding_resume_later", { step: stepIdAt(stepIndex) })
    router.push(APP_DASHBOARD_PATH)
  }

  async function finish(skipped: boolean) {
    if (finishing) return
    setFinishing(true)
    const completedAt = new Date().toISOString()
    // Reuse the shared transition so the offline fallback carries the same
    // progress fields (startedAt/completedSteps/stepHistory) as the server.
    const progressed = applyOnboardingProgress(recordRef.current, {
      stepIndex: recordRef.current?.stepIndex ?? stepIndex,
      answers: parseOnboardingAnswers(answers),
      replaceAnswers: true,
      completedStep: skipped ? undefined : stepIdAt(stepIndex),
      at: completedAt,
    })
    const local: OnboardingRecord = {
      ...progressed,
      completedAt,
      skipped,
      updatedAt: completedAt,
    }
    trackFeatureUse(skipped ? "onboarding_skip" : "onboarding_complete", {
      step: stepIdAt(stepIndex),
    })
    try {
      const body = await request<OnboardingResponse>("", "/api/onboarding", {
        method: "POST",
        body: { skipped },
      })
      recordRef.current = body.onboarding ?? local
    } catch {
      // API unreachable — keep the completed record in localStorage so the
      // next wizard load can re-submit it via syncStoredCompletion. This
      // cannot loop: load() only redirects after the SERVER confirms
      // completion, and falls back to rendering the wizard when the sync
      // POST fails.
      recordRef.current = local
      writeStoredOnboarding(storageKey, local)
    } finally {
      router.push(ONBOARDING_DONE_PATH)
    }
  }

  if (phase === "loading") {
    return (
      <div
        className="mx-auto flex w-full max-w-xl flex-col gap-4"
        role="status"
        aria-label={t("onboarding.loading")}
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const stepId: OnboardingStepId = stepIdAt(stepIndex)
  const progressPercent = wizardProgressPercent(completedSteps, stepIndex)
  const primaryLabel = finishing
    ? t("onboarding.finishing")
    : isLastStep(stepIndex)
      ? t("onboarding.finish")
      : isFirstStep(stepIndex)
        ? t("onboarding.getStarted")
        : t("onboarding.next")

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="grid gap-3">
        <div>
          <p className="text-muted-foreground text-sm">{t("onboarding.eyebrow")}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
        </div>
        <Progress value={progressPercent} aria-label={t("onboarding.progressLabel")} />
        <p className="text-muted-foreground text-sm">
          {t("onboarding.stepStatus", {
            current: stepIndex + 1,
            total: ONBOARDING_STEP_IDS.length,
          })}
          {" · "}
          {progressPercent}%
        </p>
      </header>

      <nav aria-label={t("onboarding.progressLabel")}>
        <ol className="flex flex-wrap gap-x-4 gap-y-1">
          {ONBOARDING_STEP_IDS.map((id, index) => {
            const isCurrent = index === stepIndex
            const isDone = completedSteps.includes(id)
            return (
              <li
                key={id}
                aria-current={isCurrent ? "step" : undefined}
                className={
                  isCurrent
                    ? "text-foreground flex items-center gap-1 text-sm font-medium"
                    : isDone
                      ? "text-muted-foreground/70 flex items-center gap-1 text-sm"
                      : "text-muted-foreground flex items-center gap-1 text-sm"
                }
              >
                {isDone ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                {t(`onboarding.steps.${id}`)}
              </li>
            )
          })}
        </ol>
      </nav>

      <section aria-labelledby="onboarding-step-heading" className="app-page-card">
        {stepId === "welcome" ? <WelcomeStep headingRef={headingRef} /> : null}
        {stepId === "profile" ? (
          <ProfileStep
            headingRef={headingRef}
            answers={answers}
            error={fieldError}
            onAnswersChange={applyAnswers}
          />
        ) : null}
        {stepId === "preferences" ? (
          <PreferencesStep
            headingRef={headingRef}
            answers={answers}
            onAnswersChange={applyAnswers}
          />
        ) : null}
        {stepId === "tour" ? <TourStep headingRef={headingRef} /> : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void finish(true)}
            disabled={finishing}
          >
            {t("onboarding.skip")}
          </Button>
          <Button type="button" variant="ghost" onClick={resumeLater} disabled={finishing}>
            {t("onboarding.later")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {!isFirstStep(stepIndex) ? (
            <Button type="button" variant="outline" onClick={goBack} disabled={finishing}>
              {t("onboarding.back")}
            </Button>
          ) : null}
          <Button type="button" onClick={goNext} disabled={finishing}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
