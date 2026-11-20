"use client"

import { useState, type FocusEvent, type ReactNode, type Ref } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type PasswordFieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
  autoComplete: string
  placeholder?: string
  minLength?: number
  hint?: string
  error?: string | null
  /** Extra element id appended to aria-describedby (e.g. a rules list). */
  extraDescribedBy?: string
  /** Rendered inside the field block, after the error text. */
  footer?: ReactNode
  inputRef?: Ref<HTMLInputElement>
}

/** Password input with a show/hide toggle; paste and password managers still work. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  autoComplete,
  placeholder,
  minLength,
  hint,
  error,
  extraDescribedBy,
  footer,
  inputRef,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId, extraDescribedBy].filter(Boolean).join(" ") || undefined

  return (
    <div className="ui-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="auth-password">
        <Input
          ref={inputRef}
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className="auth-password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {hint ? (
        <p className="auth-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="auth-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {/* Portal target for <PasswordStrengthMeter inputId={id} />; `contents`
          keeps the empty slot out of the .ui-field grid layout. */}
      <div id={`${id}-strength-slot`} className="contents" />
      {footer}
    </div>
  )
}
