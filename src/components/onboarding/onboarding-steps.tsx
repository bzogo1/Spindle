"use client"

import type { Ref } from "react"

import { useLanguage } from "@/components/i18n/language-provider"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ONBOARDING_ROLES, type OnboardingAnswers, type OnboardingRole } from "@/lib/onboarding"
import { cn } from "@/lib/utils"

/**
 * Presentational panels for the onboarding wizard. Each renders its own
 * heading (focused by the wizard on step change for screen-reader and
 * keyboard context) plus the step's controls. All copy goes through `t()`.
 */

type StepPanelProps = {
  /** Attached to the panel's <h2> so the wizard can move focus on step change. */
  headingRef: Ref<HTMLHeadingElement>
}

export function WelcomeStep({ headingRef }: StepPanelProps) {
  const { t } = useLanguage()
  return (
    <div className="grid gap-3">
      <h2
        id="onboarding-step-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold outline-none"
      >
        {t("onboarding.welcome.title")}
      </h2>
      <p className="text-muted-foreground">{t("onboarding.welcome.description")}</p>
    </div>
  )
}

export function ProfileStep({
  headingRef,
  answers,
  error,
  onAnswersChange,
}: StepPanelProps & {
  answers: OnboardingAnswers
  error: string | null
  onAnswersChange: (answers: OnboardingAnswers) => void
}) {
  const { t } = useLanguage()
  const displayName = answers.displayName ?? ""

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h2
          id="onboarding-step-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {t("onboarding.profile.title")}
        </h2>
        <p className="text-muted-foreground">{t("onboarding.profile.description")}</p>
      </div>
      <div className="app-field">
        <Label htmlFor="onboarding-display-name">{t("onboarding.profile.displayName")}</Label>
        <Input
          id="onboarding-display-name"
          value={displayName}
          onChange={(event) => {
            const value = event.target.value
            onAnswersChange({
              ...answers,
              displayName: value.trim() ? value : undefined,
            })
          }}
          maxLength={120}
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "onboarding-display-name-error" : "onboarding-display-name-hint"
          }
        />
        {error ? (
          <p id="onboarding-display-name-error" className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : (
          <p id="onboarding-display-name-hint" className="app-field-hint">
            {t("onboarding.profile.displayNameHint")}
          </p>
        )}
      </div>
    </div>
  )
}

const ROLE_OPTIONS: { value: OnboardingRole; labelKey: `onboarding.role.${OnboardingRole}` }[] = [
  { value: "individual", labelKey: "onboarding.role.individual" },
  { value: "lab", labelKey: "onboarding.role.lab" },
  { value: "team", labelKey: "onboarding.role.team" },
  { value: "institution", labelKey: "onboarding.role.institution" },
]

export function PreferencesStep({
  headingRef,
  answers,
  onAnswersChange,
}: StepPanelProps & {
  answers: OnboardingAnswers
  onAnswersChange: (answers: OnboardingAnswers) => void
}) {
  const { t } = useLanguage()

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h2
          id="onboarding-step-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {t("onboarding.preferences.title")}
        </h2>
        <p className="text-muted-foreground">{t("onboarding.preferences.description")}</p>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("onboarding.preferences.roleLabel")}</legend>
        <RadioGroup
          value={answers.role ?? ""}
          onValueChange={(value) => {
            onAnswersChange({
              ...answers,
              role: (ONBOARDING_ROLES as readonly string[]).includes(value)
                ? (value as OnboardingRole)
                : undefined,
            })
          }}
          aria-label={t("onboarding.preferences.roleLabel")}
          className="gap-2"
        >
          {ROLE_OPTIONS.map((option) => (
            <div
              key={option.value}
              className={cn(
                "border-input hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors",
                answers.role === option.value && "border-primary bg-accent/40",
              )}
            >
              <RadioGroupItem value={option.value} id={`onboarding-role-${option.value}`} />
              <Label htmlFor={`onboarding-role-${option.value}`} className="flex-1 font-normal">
                {t(option.labelKey)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
    </div>
  )
}

const TOUR_ITEMS = [
  {
    titleKey: "onboarding.tour.projects.title",
    descriptionKey: "onboarding.tour.projects.description",
  },
  { titleKey: "onboarding.tour.lab.title", descriptionKey: "onboarding.tour.lab.description" },
  {
    titleKey: "onboarding.tour.automations.title",
    descriptionKey: "onboarding.tour.automations.description",
  },
] as const

export function TourStep({ headingRef }: StepPanelProps) {
  const { t } = useLanguage()
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h2
          id="onboarding-step-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {t("onboarding.tour.title")}
        </h2>
        <p className="text-muted-foreground">{t("onboarding.tour.description")}</p>
      </div>
      <ul className="grid gap-3">
        {TOUR_ITEMS.map((item) => (
          <li key={item.titleKey} className="border-border rounded-md border px-3 py-2.5">
            <p className="text-sm font-medium">{t(item.titleKey)}</p>
            <p className="text-muted-foreground text-sm">{t(item.descriptionKey)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
