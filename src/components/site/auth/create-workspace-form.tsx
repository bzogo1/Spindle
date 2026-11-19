"use client"

import { useRef, useState, type FormEvent } from "react"
import { ShieldCheck } from "lucide-react"

import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { TextField } from "./field"
import { MockAuthError, mockCreateWorkspace, type MockSession } from "./mock-auth"
import { OAuthButtons } from "./oauth-buttons"
import { PasswordRules } from "./password-rules"
import { useAuthForm } from "./use-auth-form"
import {
  validateConfirmPassword,
  validateEmail,
  validateNewPassword,
  validateTermsAccepted,
  validateWorkspaceName,
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
  onSuccess: (session: MockSession) => void
}

/** Workspace sign-up: slug, email, password rules, terms acceptance. */
export function CreateWorkspaceForm({ onSuccess }: CreateWorkspaceFormProps) {
  const { values, errors, formError, setFormError, setField, handleBlur, validateAll, fieldRef } =
    useAuthForm<CreateValues>(
      { workspaceName: "", email: "", password: "", confirmPassword: "", terms: false },
      validate,
      [...FIELD_ORDER],
    )
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !validateAll()) return

    submittingRef.current = true
    setLoading(true)
    try {
      const session = await mockCreateWorkspace({
        workspaceName: values.workspaceName.trim(),
        email: values.email.trim(),
        password: values.password,
      })
      onSuccess(session)
    } catch (error) {
      if (error instanceof MockAuthError && error.code === "email_taken") {
        setFormError(
          "An account already exists for this email. Try signing in instead, or use a different email.",
        )
      } else {
        setFormError("Something went wrong. Check your connection and try again.")
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
      aria-label="Create workspace"
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
          label="Workspace name"
          name="workspace"
          placeholder="coastal-resilience"
          hint="Lowercase letters, numbers and single dashes."
          value={values.workspaceName}
          onChange={(value) => setField("workspaceName", value)}
          onBlur={handleBlur("workspaceName")}
          error={errors.workspaceName}
          autoFocus
          inputRef={fieldRef("workspaceName")}
        />
        <TextField
          id="auth-new-email"
          label="Work email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@lab.edu"
          value={values.email}
          onChange={(value) => setField("email", value)}
          onBlur={handleBlur("email")}
          error={errors.email}
          inputRef={fieldRef("email")}
        />
        <PasswordField
          id="auth-new-password"
          label="Password"
          value={values.password}
          onChange={(value) => setField("password", value)}
          onBlur={handleBlur("password")}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          error={errors.password}
          extraDescribedBy="auth-new-password-rules"
          footer={<PasswordRules password={values.password} id="auth-new-password-rules" />}
          inputRef={fieldRef("password")}
        />
        <PasswordField
          id="auth-confirm-password"
          label="Confirm password"
          value={values.confirmPassword}
          onChange={(value) => setField("confirmPassword", value)}
          onBlur={handleBlur("confirmPassword")}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          error={errors.confirmPassword}
          inputRef={fieldRef("confirmPassword")}
        />
        <div className="ui-check-row">
          <Checkbox
            id="auth-terms"
            ref={fieldRef("terms")}
            aria-label="I agree to the Terms of Service and Privacy Policy"
            checked={values.terms}
            onCheckedChange={(checked) => {
              setField("terms", checked === true)
            }}
            onBlur={handleBlur("terms")}
            aria-invalid={errors.terms ? true : undefined}
          />
          <Label htmlFor="auth-terms">
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
          </Label>
        </div>
        {errors.terms ? (
          <p className="auth-error" id="auth-terms-error" role="alert">
            {errors.terms}
          </p>
        ) : null}
        <p className="ui-inline-note">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> 5 GB free. No credit card.
        </p>

        <Button type="submit" className="ui-btn-primary auth-submit" disabled={loading}>
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden="true" /> Creating workspace…
            </>
          ) : (
            "Create free workspace"
          )}
        </Button>
      </fieldset>

      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>
      <OAuthButtons />
    </form>
  )
}
