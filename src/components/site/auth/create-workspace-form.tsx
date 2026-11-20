"use client"

import { useRef, useState, type FormEvent } from "react"
import { ShieldCheck } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { CaptchaWidget } from "@/components/auth/captcha-widget"
import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { TextField } from "./field"
import { MockAuthError, mockCreateWorkspace, type MockSession } from "./mock-auth"
import { PasswordRules } from "./password-rules"
import { useAuthForm } from "./use-auth-form"
import { AuthApiError, type ClientSession } from "@/lib/auth/auth-client"
import {
  validateConfirmPassword,
  validateEmail,
  validateNewPassword,
  validateTermsAccepted,
  validateWorkspaceName,
  VALIDATION_PARAMS,
} from "./validation"

type CreateValues = {
  workspaceName: string
  email: string
  password: string
  confirmPassword: string
  terms: boolean
}

const FIELD_ORDER = ["workspaceName", "email", "password", "confirmPassword", "terms"] as const

function validate(values: CreateValues) {
  return {
    workspaceName: validateWorkspaceName(values.workspaceName),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
    confirmPassword: validateConfirmPassword(values.confirmPassword, values.password),
    terms: validateTermsAccepted(values.terms),
  }
}

type CreateWorkspaceFormProps = {
  onSuccess: (session: MockSession, clientSession?: ClientSession | null) => void
}

/** Workspace sign-up: slug, email, password rules, terms acceptance. */
export function CreateWorkspaceForm({ onSuccess }: CreateWorkspaceFormProps) {
  const { t } = useLanguage()
  const { values, errors, formError, setFormError, setField, handleBlur, validateAll, fieldRef } =
    useAuthForm<CreateValues>(
      { workspaceName: "", email: "", password: "", confirmPassword: "", terms: false },
      validate,
      [...FIELD_ORDER],
    )
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaStatus, setCaptchaStatus] = useState<"solving" | "verified" | "error">("solving")
  // Bumped to remount the widget (fresh challenge) when the server rejects a
  // captcha token — tokens are single-use, so a burned/expired one needs a
  // brand-new solve rather than a resubmit.
  const [captchaEpoch, setCaptchaEpoch] = useState(0)
  const submittingRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !validateAll()) return

    submittingRef.current = true
    setLoading(true)
    try {
      const result = await mockCreateWorkspace({
        workspaceName: values.workspaceName.trim(),
        email: values.email.trim(),
        password: values.password,
        captchaToken: captchaToken ?? undefined,
      })
      onSuccess(result.session, result.clientSession)
    } catch (error) {
      if (error instanceof MockAuthError && error.code === "email_taken") {
        setFormError(t("auth.error.emailTaken"))
      } else if (
        error instanceof AuthApiError &&
        ((error.code as string) === "captcha_failed" ||
          (error.code as string) === "password_breach")
      ) {
        // Server-supplied message (captcha retry hint / breach explanation).
        setFormError(error.message)
        if ((error.code as string) === "captcha_failed") {
          setCaptchaEpoch((epoch) => epoch + 1)
        }
      } else {
        setFormError(t("auth.error.connection"))
      }
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
      aria-label={t("auth.createWorkspace")}
      noValidate
    >
      {formError ? (
        <p className="auth-form-alert" role="alert">
          {formError}
        </p>
      ) : null}

      <fieldset className="auth-fields" disabled={loading}>
        <TextField
          id="auth-workspace-name"
          label={t("auth.workspaceName")}
          name="workspace"
          placeholder="coastal-resilience"
          hint={t("auth.workspaceNameHint")}
          value={values.workspaceName}
          onChange={(value) => setField("workspaceName", value)}
          onBlur={handleBlur("workspaceName")}
          error={errors.workspaceName ? t(errors.workspaceName, VALIDATION_PARAMS) : undefined}
          autoFocus
          inputRef={fieldRef("workspaceName")}
        />
        <TextField
          id="auth-new-email"
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
          inputRef={fieldRef("email")}
        />
        <PasswordField
          id="auth-new-password"
          label={t("auth.password")}
          value={values.password}
          onChange={(value) => setField("password", value)}
          onBlur={handleBlur("password")}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          error={errors.password ? t(errors.password, VALIDATION_PARAMS) : undefined}
          extraDescribedBy="auth-new-password-rules"
          footer={<PasswordRules password={values.password} id="auth-new-password-rules" />}
          inputRef={fieldRef("password")}
        />
        <PasswordField
          id="auth-confirm-password"
          label={t("auth.confirmPassword")}
          value={values.confirmPassword}
          onChange={(value) => setField("confirmPassword", value)}
          onBlur={handleBlur("confirmPassword")}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          error={errors.confirmPassword ? t(errors.confirmPassword, VALIDATION_PARAMS) : undefined}
          inputRef={fieldRef("confirmPassword")}
        />
        <div className="ui-check-row">
          <Checkbox
            id="auth-terms"
            ref={fieldRef("terms")}
            aria-label={
              t("auth.agreeTo") +
              " " +
              t("auth.termsOfService") +
              " " +
              t("auth.and") +
              " " +
              t("auth.privacyPolicy")
            }
            checked={values.terms}
            onCheckedChange={(checked) => {
              setField("terms", checked === true)
            }}
            onBlur={handleBlur("terms")}
            aria-invalid={errors.terms ? true : undefined}
          />
          {/* `inline` overrides the Label's flex layout so the inline links
              flow with the text instead of becoming flex items with gap-2;
              `leading-normal` keeps wrapped lines readable. */}
          <Label htmlFor="auth-terms" className="inline leading-normal">
            {t("auth.agreeTo")}{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              {t("auth.termsOfService")}
            </a>{" "}
            {t("auth.and")}{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              {t("auth.privacyPolicy")}
            </a>
          </Label>
        </div>
        {errors.terms ? (
          <p className="auth-error" id="auth-terms-error" role="alert">
            {t(errors.terms, VALIDATION_PARAMS)}
          </p>
        ) : null}
        <p className="ui-inline-note">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> {t("auth.freeTierNote")}
        </p>

        <CaptchaWidget
          key={captchaEpoch}
          onToken={setCaptchaToken}
          onStatusChange={setCaptchaStatus}
        />

        <Button
          type="submit"
          className="ui-btn-primary auth-submit"
          disabled={loading || captchaStatus !== "verified"}
        >
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden="true" /> {t("auth.creatingWorkspace")}
            </>
          ) : (
            t("auth.createFreeWorkspace")
          )}
        </Button>
      </fieldset>
    </form>
  )
}
