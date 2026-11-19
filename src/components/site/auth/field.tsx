"use client"

import type { FocusEvent, Ref } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type TextFieldProps = {
  id: string
  label: string
  name?: string
  type?: "text" | "email"
  value: string
  onChange: (value: string) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
  autoComplete?: string
  inputMode?: "email" | "text"
  placeholder?: string
  hint?: string
  error?: string | null
  autoFocus?: boolean
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
}

/** Labeled text input with hint/error text wired via aria-describedby. */
export function TextField({
  id,
  label,
  name,
  type = "text",
  value,
  onChange,
  onBlur,
  autoComplete,
  inputMode,
  placeholder,
  hint,
  error,
  autoFocus,
  disabled,
  inputRef,
}: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div className="ui-field">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
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
    </div>
  )
}
