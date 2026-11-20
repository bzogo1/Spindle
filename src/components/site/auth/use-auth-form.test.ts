import { act, renderHook } from "@testing-library/react"
import type { FocusEvent } from "react"
import { describe, expect, it, vi } from "vitest"

import { useAuthForm } from "./use-auth-form"

type Values = { email: string; password: string }

function setup() {
  const validate = vi.fn((values: Values) => ({
    email: values.email.trim() ? null : "Enter your work email.",
    password: values.password ? null : "Enter your password.",
  }))
  return renderHook(() =>
    useAuthForm<Values>({ email: "", password: "" }, validate, ["email", "password"]),
  )
}

function focusEvent() {
  return {} as FocusEvent<HTMLElement>
}

describe("useAuthForm", () => {
  it("setField updates values and clears the form error", () => {
    const { result } = setup()

    act(() => result.current.setFormError("boom"))
    expect(result.current.formError).toBe("boom")

    act(() => result.current.setField("email", "researcher@lab.edu"))
    expect(result.current.values.email).toBe("researcher@lab.edu")
    expect(result.current.formError).toBe("")
  })

  it("handleBlur validates only the blurred field", () => {
    const { result } = setup()

    act(() => result.current.handleBlur("email")(focusEvent()))
    expect(result.current.errors.email).toBe("Enter your work email.")
    expect(result.current.errors.password).toBeUndefined()

    act(() => result.current.setField("email", "researcher@lab.edu"))
    act(() => result.current.handleBlur("email")(focusEvent()))
    expect(result.current.errors.email).toBeUndefined()
  })

  it("validateAll reports errors and focuses the first invalid field in order", () => {
    const { result } = setup()

    const emailInput = document.createElement("input")
    const passwordInput = document.createElement("input")
    document.body.append(emailInput, passwordInput)
    result.current.fieldRef("email")(emailInput)
    result.current.fieldRef("password")(passwordInput)

    let valid = true
    act(() => {
      valid = result.current.validateAll()
    })

    expect(valid).toBe(false)
    expect(result.current.errors.email).toBe("Enter your work email.")
    expect(result.current.errors.password).toBe("Enter your password.")
    expect(emailInput).toHaveFocus()

    emailInput.remove()
    passwordInput.remove()
  })

  it("validateAll focuses the password field when only it is invalid", () => {
    const { result } = setup()

    act(() => result.current.setField("email", "researcher@lab.edu"))

    const passwordInput = document.createElement("input")
    document.body.append(passwordInput)
    result.current.fieldRef("password")(passwordInput)

    let valid = true
    act(() => {
      valid = result.current.validateAll()
    })

    expect(valid).toBe(false)
    expect(result.current.errors.email).toBeNull()
    expect(result.current.errors.password).toBe("Enter your password.")
    expect(passwordInput).toHaveFocus()

    passwordInput.remove()
  })

  it("validateAll returns true when all fields are valid", () => {
    const { result } = setup()

    act(() => {
      result.current.setField("email", "researcher@lab.edu")
      result.current.setField("password", "hunter2")
    })

    let valid = false
    act(() => {
      valid = result.current.validateAll()
    })
    expect(valid).toBe(true)
    expect(result.current.errors.email).toBeNull()
    expect(result.current.errors.password).toBeNull()
  })
})
