import { render, screen } from "@testing-library/react"
import { Home } from "lucide-react"
import { describe, expect, it } from "vitest"

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

function TestBreadcrumb({ custom = false }: { custom?: boolean }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        {custom ? <BreadcrumbSeparator>/</BreadcrumbSeparator> : <BreadcrumbSeparator />}
        <BreadcrumbItem>
          <BreadcrumbLink href="/docs">Docs</BreadcrumbLink>
        </BreadcrumbItem>
        {custom ? <BreadcrumbSeparator>/</BreadcrumbSeparator> : <BreadcrumbSeparator />}
        <BreadcrumbItem>
          <BreadcrumbPage>Current</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

describe("Breadcrumb", () => {
  it("renders a nav landmark with breadcrumb label", () => {
    render(<TestBreadcrumb />)
    expect(screen.getByRole("navigation", { name: "breadcrumb" })).toBeInTheDocument()
  })

  it("renders ordered list items", () => {
    render(<TestBreadcrumb />)
    expect(screen.getByRole("list")).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })

  it("renders links with hrefs", () => {
    render(<TestBreadcrumb />)
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs")
  })

  it("marks the current page with aria-current and does not render it as a link", () => {
    render(<TestBreadcrumb />)
    const page = screen.getByText("Current")
    expect(page).toHaveAttribute("aria-current", "page")
    expect(page).not.toHaveAttribute("href")
    expect(screen.queryByRole("link", { name: "Current" })).not.toBeInTheDocument()
  })

  it("renders default chevron separators", () => {
    const { container } = render(<TestBreadcrumb />)
    const separators = container.querySelectorAll('[data-slot="breadcrumb-separator"]')
    expect(separators).toHaveLength(2)
    separators.forEach((sep) => expect(sep.querySelector("svg")).not.toBeNull())
  })

  it("supports custom separator content", () => {
    render(<TestBreadcrumb custom />)
    expect(screen.getAllByText("/")).toHaveLength(2)
  })

  it("renders icons inside links", () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">
              <Home data-testid="home-icon" />
              Home
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )

    expect(screen.getByTestId("home-icon")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Home/ })).toContainElement(
      screen.getByTestId("home-icon"),
    )
  })

  it("flips the default separator chevron in RTL", () => {
    const { container } = render(<TestBreadcrumb />)
    const svg = container.querySelector('[data-slot="breadcrumb-separator"] svg')

    expect(svg).toHaveClass("rtl:-scale-x-100")
  })

  it("hides separators and ellipsis from accessibility tree", () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const sep = container.querySelector('[data-slot="breadcrumb-separator"]')
    expect(sep).toHaveAttribute("aria-hidden", "true")
    const ellipsis = container.querySelector('[data-slot="breadcrumb-ellipsis"]')
    expect(ellipsis).toHaveAttribute("aria-hidden", "true")
  })
})
