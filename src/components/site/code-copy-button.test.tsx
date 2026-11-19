import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CodeCopyButton } from "@/components/site/code-copy-button"

const CODE = "echo 'hello'\nnpm run build"

function renderBlock() {
  return render(
    <div data-code-block>
      <CodeCopyButton code={CODE} label="Quickstart" />
      <pre>
        <code>{CODE}</code>
      </pre>
    </div>,
  )
}

function setClipboard(writeText: (() => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  })
}

function setExecCommand(execCommand: (() => boolean) | undefined) {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
  })
}

beforeEach(() => {
  setExecCommand(undefined)
})

afterEach(() => {
  setClipboard(undefined)
  setExecCommand(undefined)
  window.getSelection()?.removeAllRanges()
})

describe("CodeCopyButton", () => {
  it("copies the exact source and announces success", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    renderBlock()

    await user.click(screen.getByRole("button", { name: "Copy Quickstart code" }))

    expect(writeText).toHaveBeenCalledWith(CODE)
    expect(await screen.findByText("Copied")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Quickstart copied to clipboard.")
  })

  it("copies with Ctrl+Shift+C while the block has focus", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    renderBlock()

    screen.getByRole("button", { name: "Copy Quickstart code" }).focus()
    await user.keyboard("{Control>}{Shift>}c{/Shift}{/Control}")

    expect(writeText).toHaveBeenCalledWith(CODE)
  })

  it("falls back to execCommand when the clipboard API is unavailable", async () => {
    const user = userEvent.setup()
    const execCommand = vi.fn(() => true)
    setClipboard(undefined)
    setExecCommand(execCommand)
    renderBlock()

    await user.click(screen.getByRole("button", { name: "Copy Quickstart code" }))

    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(await screen.findByText("Copied")).toBeInTheDocument()
  })

  it("selects the code when every copy method fails", async () => {
    const user = userEvent.setup()
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")))
    setExecCommand(vi.fn(() => false))
    renderBlock()

    await user.click(screen.getByRole("button", { name: "Copy Quickstart code" }))

    expect(await screen.findByText("Copy failed")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copy failed. The code is selected so you can copy it manually.",
    )
    expect(window.getSelection()?.toString()).toBe(CODE)
  })
})
