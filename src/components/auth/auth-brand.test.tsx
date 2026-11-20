import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"
import { siteName } from "@/lib/seo"

import { AuthBrand } from "./auth-brand"

function renderBrand(props?: { name?: string; logoUrl?: string }) {
  return render(
    <LanguageProvider>
      <AuthBrand {...props} />
    </LanguageProvider>,
  )
}

describe("AuthBrand", () => {
  it("falls back to the shared product name", () => {
    renderBrand()
    expect(screen.getByText(siteName)).toBeInTheDocument()
  })

  it("falls back to the product name when the override is blank", () => {
    renderBrand({ name: "   " })
    expect(screen.getByText(siteName)).toBeInTheDocument()
  })

  it("uses the provided workspace name", () => {
    renderBrand({ name: "Acme Labs" })
    expect(screen.getByText("Acme Labs")).toBeInTheDocument()
    expect(screen.queryByText(siteName)).not.toBeInTheDocument()
  })

  it("renders the logo image instead of the default mark when logoUrl is set", () => {
    const { container } = renderBrand({ logoUrl: "https://cdn.example.com/logo.png" })
    const img = container.querySelector("img")
    expect(img).toHaveAttribute("src", "https://cdn.example.com/logo.png")
  })
})
