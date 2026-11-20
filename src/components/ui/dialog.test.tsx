import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"

function TestDialog({ showFooterClose = false }: { showFooterClose?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>Are you sure?</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton={showFooterClose}>
          <button type="button">Cancel</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe("Dialog", () => {
  it("opens on trigger click and renders a labelled dialog", async () => {
    const user = userEvent.setup()
    render(<TestDialog />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open dialog" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Confirm" })).toBeInTheDocument()
    expect(screen.getByText("Are you sure?")).toBeInTheDocument()
  })

  it("closes via the built-in close button", async () => {
    const user = userEvent.setup()
    render(<TestDialog />)

    await user.click(screen.getByRole("button", { name: "Open dialog" }))
    await screen.findByRole("dialog")

    await user.click(screen.getByRole("button", { name: "Close" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<TestDialog />)

    await user.click(screen.getByRole("button", { name: "Open dialog" }))
    await screen.findByRole("dialog")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("renders a footer close button when showCloseButton", async () => {
    const user = userEvent.setup()
    render(<TestDialog showFooterClose />)

    await user.click(screen.getByRole("button", { name: "Open dialog" }))
    await screen.findByRole("dialog")

    const closeButtons = screen.getAllByRole("button", { name: "Close" })
    expect(closeButtons.length).toBeGreaterThanOrEqual(1)
  })

  it("DialogClose closes the dialog", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Panel</DialogTitle>
          <DialogClose asChild>
            <button type="button">Done</button>
          </DialogClose>
        </DialogContent>
      </Dialog>,
    )

    await user.click(screen.getByRole("button", { name: "Open" }))
    await screen.findByRole("dialog")

    await user.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
