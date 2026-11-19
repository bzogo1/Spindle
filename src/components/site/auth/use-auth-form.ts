"use client"

import { useRef, useState, type FocusEvent } from "react"

export type FieldErrors<T extends object> = Partial<Record<keyof T & string, string | null>>

/**
 * Shared form state for the auth dialog: controlled values, blur/submit
 * validation, error clearing on edit, and focus-on-first-invalid.
 */
export function useAuthForm<T extends Record<string, unknown>>(
  initialValues: T,
  validate: (values: T) => FieldErrors<T>,
  fieldOrder: (keyof T & string)[],
) {
  const [values, setValues] = useState<T>(initialValues)
  const [errors, setErrors] = useState<FieldErrors<T>>({})
  const [formError, setFormError] = useState("")
  const valuesRef = useRef(values)
  const elementsRef = useRef(new Map<string, HTMLElement>())

  function setField(name: keyof T & string, value: unknown) {
    const next = { ...valuesRef.current, [name]: value } as T
    valuesRef.current = next
    setValues(next)
    setFormError("")
    setErrors((previous) => {
      if (!(name in previous)) return previous
      const error = validate(next)[name]
      const copy = { ...previous }
      if (error) copy[name] = error
      else delete copy[name]
      return copy
    })
  }

  function handleBlur(name: keyof T & string) {
    return (_event: FocusEvent<HTMLElement>) => {
      const error = validate(valuesRef.current)[name]
      setErrors((previous) => {
        const copy = { ...previous }
        if (error) copy[name] = error
        else delete copy[name]
        return copy
      })
    }
  }

  /** Runs full validation; focuses the first invalid field. True when valid. */
  function validateAll(): boolean {
    const result = validate(valuesRef.current)
    setErrors(result)
    const firstInvalid = fieldOrder.find((name) => result[name])
    if (firstInvalid) {
      elementsRef.current.get(firstInvalid)?.focus()
      return false
    }
    return true
  }

  function fieldRef(name: keyof T & string) {
    return (element: HTMLElement | null) => {
      if (element) elementsRef.current.set(name, element)
      else elementsRef.current.delete(name)
    }
  }

  return {
    values,
    errors,
    formError,
    setFormError,
    setField,
    handleBlur,
    validateAll,
    fieldRef,
  }
}
