"use client"

import { useRef, useState, type FormEvent } from "react"

import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { TextField } from "./field"
import { MockAuthError, mockSignIn, type MockSession } from "./mock-auth"
import { OAuthButtons } from "./oauth-buttons"
import { useAuthForm } from "./use-auth-form"
import { validateEmail, validateSignInPassword } from "./validation"

type SignInValues = {
  email: string
  password: string
  remember: boolean
}

const FIELD_ORDER = ["email", "password"] as const

function validate(values: SignInValues) {
  return {
    email: validateEmail(values.email),
    password: validateSignInPassword(values.password),
  }
}

type SignInFormProps = {
  onSuccess: (session: MockSession) => void
  onForgotPassword: () => void
}

/** Email + password sign-in with mocked credentials check. */
export function SignInForm({ onSuccess, onForgotPassword }: SignInFormProps) {
  const { values, errors, formError, setFormError, setField, handleBlur, validateAll, fieldRef } =
    useAuthForm<SignInValues>({ email: "", password: "", remember: true }, validate, [
      ...FIELD_ORDER,
    ])
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || !validateAll()) return

    submittingRef.current = true
    setLoading(true)
    try {
      const session = await mockSignIn({
        email: values.email.trim(),
        password: values.password,
      })
      onSuccess(session)
    } catch (error) {
      if (error instanceof MockAuthError && error.code === "invalid_credentials") {
        setFormError("Invalid email or password. Check your details and try again.")
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
      aria-label="Sign in"
      noValidate
    >
      {formError ? (
        <p className="auth-form-alert" role="alert">
          {formError}
        </p>
      ) : null}

      <fieldset className="auth-fields" disabled={loading}>
        <TextField
          id="auth-email"
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
          autoFocus
          inputRef={fieldRef("email")}
        />
        <PasswordField
          id="auth-password"
          label="Password"
          value={values.password}
          onChange={(value) => setField("password", value)}
          onBlur={handleBlur("password")}
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password}
          inputRef={fieldRef("password")}
        />
        <div className="ui-auth-row">
          <div className="ui-check-row">
            <Checkbox
              id="auth-remember"
              aria-label="Keep me signed in"
              checked={values.remember}
              onCheckedChange={(checked) => setField("remember", checked === true)}
            />
            <Label htmlFor="auth-remember">Keep me signed in</Label>
          </div>
          <button type="button" className="auth-link-button" onClick={onForgotPassword}>
            Forgot password?
          </button>
        </div>

        <Button type="submit" className="ui-btn-primary auth-submit" disabled={loading}>
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden="true" /> Signing in…
            </>
          ) : (
            "Sign in"
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
