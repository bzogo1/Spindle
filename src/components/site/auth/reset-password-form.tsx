"use client"

import { useRef, useState, type FormEvent } from "react"
import { ArrowLeft } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"

import { TextField } from "./field"
import { mockSendEmailLink } from "./mock-auth"
import { useAuthForm } from "./use-auth-form"
import { VALIDATION_PARAMS, validateEmail } from "./validation"

type ResetValues = { email: string }

const FIELD_ORDER = ["email"] as const

function validate(values: ResetValues) {
  return { email: validateEmail(values.email) }
}

type ResetPasswordFormProps = {
  /** Called with the submitted email once the mocked send resolves. */
  onSent: (email: string) => void
  onBack: () => void
}

/** Password-reset request form; the shell swaps in the "link sent" step. */
export function ResetPasswordForm({ onSent, onBack }: ResetPasswordFormProps) {
  const { t } = useLanguage()
  const { values, errors, formError, setFormError, setField, handleBlur, validateAll, fieldRef } =
    useAuthForm<ResetValues>({ email: "" }, validate, [...FIELD_ORDER])
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !validateAll()) return

    submittingRef.current = true
    setLoading(true)
    try {
      const email = values.email.trim()
      await mockSendEmailLink(email)
      onSent(email)
    } catch {
      setFormError(t("auth.error.connection"))
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit}
      aria-busy={loading}
      aria-label={t("auth.resetPassword")}
      noValidate
    >
      {formError ? (
        <p className="auth-form-alert" role="alert">
          {formError}
        </p>
      ) : null}

      <fieldset className="auth-fields" disabled={loading}>
        <TextField
          id="auth-reset-email"
          label={t("auth.workEmail")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@lab.edu"
          value={values.email}
          onChange={(value) => setField("email", value)}
          onBlur={handleBlur("email")}
          error={errors.email ? t(errors.email, VALIDATION_PARAMS) : undefined}
          autoFocus
          inputRef={fieldRef("email")}
        />

        <Button type="submit" className="ui-btn-primary auth-submit" disabled={loading}>
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden="true" /> {t("auth.sendingLink")}
            </>
          ) : (
            t("auth.sendResetLink")
          )}
        </Button>
      </fieldset>

      <div className="auth-links">
        <button type="button" className="auth-link-button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="auth-link-icon" /> {t("auth.backToSignIn")}
        </button>
      </div>
    </form>
  )
}
