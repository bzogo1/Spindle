import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu"

function TestNav() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Products</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavigationMenuLink href="/a">Feature A</NavigationMenuLink>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="/docs">Docs</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}

describe("NavigationMenu", () => {
  it("renders list, trigger, and links", () => {
    render(<TestNav />)

    expect(screen.getByRole("button", { name: /products/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs")
    expect(document.querySelector('[data-slot="navigation-menu-list"]')).toBeInTheDocument()
  })

  it("exposes viewport state via data-viewport", () => {
    const { unmount } = render(<TestNav />)
    expect(document.querySelector('[data-slot="navigation-menu"]')).toHaveAttribute(
      "data-viewport",
      "true",
    )
    unmount()

    render(
      <NavigationMenu viewport={false}>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger>More</NavigationMenuTrigger>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    )
    expect(document.querySelector('[data-slot="navigation-menu"]')).toHaveAttribute(
      "data-viewport",
      "false",
    )
  })

  it("opens content on trigger click", async () => {
    const user = userEvent.setup()
    render(<TestNav />)

    const trigger = screen.getByRole("button", { name: /products/i })
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByRole("link", { name: "Feature A" })).toBeInTheDocument()
  })
})
