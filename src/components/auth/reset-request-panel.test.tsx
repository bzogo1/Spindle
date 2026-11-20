import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ResetRequestPanel } from "./reset-request-panel"
import { LanguageProvider } from "@/components/i18n/language-provider"

afterEach(() => {
  window.sessionStorage.clear()
  vi.useRealTimers()
})

describe("ResetRequestPanel", () => {
  it("scopes the resend cooldown to the reset-password flow", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const { container } = render(
      <LanguageProvider>
        <ResetRequestPanel />
      </LanguageProvider>,
    )

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "ada@lab.edu" },
    })
    fireEvent.submit(container.querySelector("form")!)

    // The sent confirmation means the cooldown deadline was persisted.
    expect(await screen.findByRole("status")).toBeInTheDocument()
    expect(
      window.sessionStorage.getItem("spindle:auth:resend-cooldown:reset-password"),
    ).not.toBeNull()
    expect(window.sessionStorage.getItem("spindle:auth:resend-cooldown")).toBeNull()
  })
})
