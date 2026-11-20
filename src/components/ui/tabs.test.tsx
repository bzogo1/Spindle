import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

function TestTabs({ orientation }: { orientation?: "horizontal" | "vertical" }) {
  return (
    <Tabs defaultValue="account" orientation={orientation}>
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">Account panel</TabsContent>
      <TabsContent value="password">Password panel</TabsContent>
    </Tabs>
  )
}

describe("Tabs", () => {
  it("shows the default tab panel", () => {
    render(<TestTabs />)

    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Account panel")
  })

  it("switches panels on click", async () => {
    const user = userEvent.setup()
    render(<TestTabs />)

    await user.click(screen.getByRole("tab", { name: "Password" }))

    expect(screen.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Password panel")
  })

  it("navigates tabs with arrow keys", async () => {
    const user = userEvent.setup()
    render(<TestTabs />)

    screen.getByRole("tab", { name: "Account" }).focus()
    await user.keyboard("{ArrowRight}")

    expect(screen.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true")
  })

  it("uses a roving tabindex across triggers", async () => {
    const user = userEvent.setup()
    render(<TestTabs />)

    const account = screen.getByRole("tab", { name: "Account" })
    const password = screen.getByRole("tab", { name: "Password" })

    // Radix keeps every trigger at -1 until focus enters the group; the
    // tablist itself is the initial tab stop. Once an arrow key moves focus,
    // exactly one trigger carries tabindex 0.
    account.focus()
    await user.keyboard("{ArrowRight}")

    expect(password).toHaveAttribute("tabindex", "0")
    expect(account).toHaveAttribute("tabindex", "-1")
  })

  it("links each tab panel to its trigger via aria-labelledby", () => {
    render(<TestTabs />)

    const panel = screen.getByRole("tabpanel")
    const trigger = screen.getByRole("tab", { name: "Account" })
    expect(panel).toHaveAttribute("aria-labelledby", trigger.id)
  })

  it("marks orientation on the root", () => {
    render(<TestTabs orientation="vertical" />)
    const tabs = document.querySelector('[data-slot="tabs"]')
    expect(tabs).toHaveAttribute("data-orientation", "vertical")
  })
})
