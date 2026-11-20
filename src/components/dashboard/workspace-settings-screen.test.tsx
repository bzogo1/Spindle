import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Toaster } from "@/components/ui/toast"

import { DashboardWorkspaceSettingsScreen } from "./workspace-settings-screen"

function renderScreen() {
  return render(
    <>
      <DashboardWorkspaceSettingsScreen />
      <Toaster />
    </>,
  )
}

describe("DashboardWorkspaceSettingsScreen", () => {
  it("renders the General tab with name, slug, and description fields", () => {
    renderScreen()

    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute(
      "data-state",
      "active",
    )
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Northlight Research")
    expect(screen.getByLabelText("Slug")).toHaveValue("northlight")
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Independent research workspace.",
    )
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  })

  it("renders Members and Billing as disabled tab stubs", () => {
    renderScreen()

    expect(screen.getByRole("tab", { name: /Members/ })).toBeDisabled()
    expect(screen.getByRole("tab", { name: /Billing/ })).toBeDisabled()
  })

  it("enables save when a field changes and keeps state local", async () => {
    const user = userEvent.setup()
    renderScreen()

    const nameInput = screen.getByLabelText("Workspace name")
    await user.clear(nameInput)
    await user.type(nameInput, "Northlight Labs")

    // Slug auto-derives from the name until it is edited directly.
    expect(screen.getByLabelText("Slug")).toHaveValue("northlight-labs")

    const saveButton = screen.getByRole("button", { name: "Save changes" })
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    // After saving, the new values become the baseline and save disables again.
    expect(await screen.findByText("Workspace settings saved")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Northlight Labs")
  })

  it("opens a confirm dialog for delete and confirms locally", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole("button", { name: "Delete workspace" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Delete Northlight Research?")

    await user.click(within(dialog).getByRole("button", { name: "Delete workspace" }))

    expect(await screen.findByText("Delete workspace confirmed")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens a confirm dialog for leave and cancels without confirming", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole("button", { name: "Leave workspace" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Leave Northlight Research?")

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByText("Leave workspace confirmed")).not.toBeInTheDocument()
  })
})
