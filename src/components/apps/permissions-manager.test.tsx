import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { PermissionsManager } from "./permissions-manager"
import { can, loadPermissions } from "@/lib/apps/permissions"

describe("PermissionsManager", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("lists every scope with grant controls", () => {
    render(<PermissionsManager appId="demo-app" />)
    expect(screen.getByText("files:read")).toBeInTheDocument()
    expect(screen.getByText("webhooks:manage")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Grant" }).length).toBeGreaterThan(0)
  })

  it("grants and revokes scopes persisted in localStorage", async () => {
    const user = userEvent.setup()
    render(<PermissionsManager appId="demo-app" />)

    const grantButtons = screen.getAllByRole("button", { name: "Grant" })
    await user.click(grantButtons[0])

    const stored = loadPermissions("demo-app")
    expect(stored?.grants).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Revoke" }))
    expect(loadPermissions("demo-app")?.grants).toHaveLength(0)
  })

  it("reflects effective access for the preview role", async () => {
    const user = userEvent.setup()
    render(<PermissionsManager appId="demo-app" previewRole="viewer" />)

    // Grant files:read restricted to admins only.
    await user.selectOptions(screen.getByLabelText(/Grant to role/), "admin")
    const filesReadRow = screen.getByText("files:read").closest("tr")!
    await user.click(filesReadRow.querySelector("button") as HTMLElement)

    // viewer cannot use it → row shows "no" for the preview column.
    const cells = filesReadRow.querySelectorAll("td")
    expect(cells[2].textContent).toBe("no")
    expect(can(loadPermissions("demo-app"), "files:read", "viewer")).toBe(false)
    expect(can(loadPermissions("demo-app"), "files:read", "admin")).toBe(true)
  })
})
