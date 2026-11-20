import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PasswordField } from "./password-field"
import { LanguageProvider } from "@/components/i18n/language-provider"

import { PasswordStrengthMeter } from "./password-strength-meter"

afterEach(() => {
  vi.useRealTimers()
})

describe("PasswordStrengthMeter", () => {
  it("renders an accessible meter with the strength label", () => {
    render(
      <LanguageProvider>
        <PasswordStrengthMeter password="Tr0ub4dor&3x" />
      </LanguageProvider>,
    )

    const meter = screen.getByRole("meter", { name: "Password strength" })
    expect(meter).toHaveAttribute("aria-valuemin", "0")
    expect(meter).toHaveAttribute("aria-valuemax", "100")
    expect(meter).toHaveAttribute("aria-valuenow", "92")
    expect(meter).toHaveAttribute("aria-valuetext", "Password strength: Strong")
    expect(meter).toHaveTextContent("Strong")
  })

  it("renders nothing while the password is empty", () => {
    const { container } = render(
      <LanguageProvider>
        <PasswordStrengthMeter password="" />
      </LanguageProvider>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("meter")).not.toBeInTheDocument()
  })

  it("debounces score updates while typing", () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <LanguageProvider>
        <PasswordStrengthMeter password="a" />
      </LanguageProvider>,
    )

    // Initial value renders immediately as Weak.
    expect(screen.getByRole("meter")).toHaveTextContent("Weak")

    rerender(
      <LanguageProvider>
        <PasswordStrengthMeter password="Tr0ub4dor&3x" />
      </LanguageProvider>,
    )
    // Before the debounce window elapses the old score is still shown.
    expect(screen.getByRole("meter")).toHaveTextContent("Weak")

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByRole("meter")).toHaveTextContent("Strong")
  })

  it("observes an input by id and portals into the PasswordField slot", () => {
    vi.useFakeTimers()
    render(
      <LanguageProvider>
        <>
          <PasswordField
            id="auth-new-password"
            label="Password"
            value=""
            onChange={() => {}}
            autoComplete="new-password"
          />
          <PasswordStrengthMeter inputId="auth-new-password" />
        </>
      </LanguageProvider>,
    )

    const slot = document.getElementById("auth-new-password-strength-slot")
    expect(slot).not.toBeNull()
    expect(screen.queryByRole("meter")).not.toBeInTheDocument()

    const input = screen.getByLabelText("Password")
    fireEvent.input(input, { target: { value: "Tr0ub4dor&3x" } })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    const meter = screen.getByRole("meter")
    expect(meter).toHaveTextContent("Strong")
    // Portaled inside the field's slot, next to the password input.
    expect(slot).toContainElement(meter)
  })
})
