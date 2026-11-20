"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/components/i18n/language-provider"
import { scorePassword } from "@/lib/auth/password-strength"

/** Delay before the score catches up with keystrokes. */
const DEBOUNCE_MS = 150

/** Segment fill color per strength level (0 Weak … 3 Strong). */
const SEGMENT_CLASSES = ["bg-red-500", "bg-amber-500", "bg-lime-500", "bg-emerald-600"] as const

const SEGMENT_COUNT = 4

type PasswordStrengthMeterProps = {
  /**
   * Controlled password value. When provided the meter renders inline and
   * does not observe the DOM.
   */
  password?: string
  /**
   * Id of the password input to observe (e.g. "auth-new-password"). The meter
   * subscribes to the input's `input` events and portals itself into the
   * sibling slot `#<inputId>-strength-slot` rendered by PasswordField.
   */
  inputId?: string
  id?: string
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** Reads the live value of the input with `inputId`, or "" when unavailable. */
function useObservedPassword(inputId: string | undefined): string {
  const [value, setValue] = useState("")
  useEffect(() => {
    const input = inputId ? document.getElementById(inputId) : null
    if (!(input instanceof HTMLInputElement)) {
      setValue("")
      return
    }
    const sync = () => setValue(input.value)
    sync()
    input.addEventListener("input", sync)
    return () => input.removeEventListener("input", sync)
  }, [inputId])
  return value
}

/** Finds the PasswordField portal slot for `inputId`, if rendered. */
function useMeterSlot(inputId: string | undefined, controlled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!inputId || controlled) {
      setSlot(null)
      return
    }
    setSlot(document.getElementById(`${inputId}-strength-slot`))
  }, [inputId, controlled])
  return slot
}

/**
 * Segmented, color-coded password strength indicator. Shows a Weak/Fair/Good/
 * Strong label plus a `role="meter"` bar for assistive tech. Updates are
 * debounced so typing stays smooth.
 */
const STRENGTH_LABEL_KEYS = [
  "auth.strength.weak",
  "auth.strength.fair",
  "auth.strength.good",
  "auth.strength.strong",
] as const

export function PasswordStrengthMeter({ password, inputId, id }: PasswordStrengthMeterProps) {
  const { t } = useLanguage()
  const controlled = password !== undefined
  const observed = useObservedPassword(controlled ? undefined : inputId)
  const slot = useMeterSlot(inputId, controlled)
  const debounced = useDebouncedValue(password ?? observed, DEBOUNCE_MS)

  if (!debounced) return null

  const strength = scorePassword(debounced)
  const strengthLabel = t(STRENGTH_LABEL_KEYS[strength.level])
  const meter = (
    <div
      id={id}
      role="meter"
      aria-label={t("auth.passwordStrength")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={strength.score}
      aria-valuetext={t("auth.passwordStrengthValue", { label: strengthLabel })}
      className="flex items-center gap-2"
    >
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full ${
              index <= strength.level ? SEGMENT_CLASSES[strength.level] : "bg-muted"
            }`}
          />
        ))}
      </div>
      <span className="text-muted-foreground shrink-0 text-[11px] leading-none font-medium">
        {strengthLabel}
      </span>
    </div>
  )

  // In observe mode the meter is portaled next to the password field; if the
  // slot is missing (e.g. field unmounted) fall back to inline rendering.
  return slot ? createPortal(meter, slot) : meter
}
