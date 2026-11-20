import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"
import type { PublicWorkspaceBranding } from "@/lib/workspace-branding"

import { AuthSplitShell } from "./auth-split-shell"

function branding(overrides: Partial<PublicWorkspaceBranding> = {}): PublicWorkspaceBranding {
  return {
    displayName: "",
    logoText: "",
    accentColor: "",
    backgroundColor: "",
    logoUrl: "",
    ...overrides,
  }
}

function renderShell(value?: PublicWorkspaceBranding | null) {
  return render(
    <LanguageProvider>
      <AuthSplitShell mode="sign-in" branding={value}>
        <div>form</div>
      </AuthSplitShell>
    </LanguageProvider>,
  )
}

function main(): HTMLElement {
  return screen.getByRole("main")
}

describe("AuthSplitShell branding", () => {
  it("applies accent and background colors as scoped CSS custom properties", () => {
    renderShell(
      branding({
        accentColor: "#112233",
        backgroundColor: "#0a0b0c",
        logoText: "Acme",
        displayName: "Acme Inc",
      }),
    )

    const style = main().style
    expect(style.getPropertyValue("--accent")).toBe("#112233")
    expect(style.getPropertyValue("--ui-primary")).toBe("#112233")
    expect(style.getPropertyValue("--ui-background")).toBe("#0a0b0c")
    // The workspace name wins the wordmark.
    expect(screen.getByText("Acme")).toBeInTheDocument()
  })

  it("applies backgroundColor on its own when no accent is set", () => {
    renderShell(branding({ backgroundColor: "#102030" }))

    const style = main().style
    expect(style.getPropertyValue("--ui-background")).toBe("#102030")
    expect(style.getPropertyValue("--accent")).toBe("")
  })

  it("sets no custom properties without branding or with empty colors", () => {
    const { unmount } = renderShell()
    expect(main().style.getPropertyValue("--ui-background")).toBe("")
    unmount()

    renderShell(branding({ accentColor: "  ", backgroundColor: "" }))
    expect(main().style.getPropertyValue("--ui-background")).toBe("")
    expect(main().style.getPropertyValue("--accent")).toBe("")
  })
})
