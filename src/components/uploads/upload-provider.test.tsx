import { useEffect, useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { QueueSnapshot } from "@/lib/uploads/queue"
import { MockUploadTransport } from "@/lib/uploads/transport"

import { UploadQueueDock } from "./upload-dock"
import { UploadsProvider, useUploadsQueue } from "./upload-provider"

function QueueProbe() {
  const { queue } = useUploadsQueue()
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  useEffect(() => queue.subscribe(setSnapshot), [queue])
  return <output data-testid="queue-size">{snapshot?.files.length ?? 0}</output>
}

function renderWithProvider(ui: React.ReactNode, transport = new MockUploadTransport()) {
  return render(<UploadsProvider transport={transport}>{ui}</UploadsProvider>)
}

function dropFiles(files: File[], { defaultPrevented = false } = {}) {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"] },
  })
  if (defaultPrevented) event.preventDefault()
  window.dispatchEvent(event)
  return event
}

describe("UploadsProvider", () => {
  it("enqueues window-level file drops into the shared queue", async () => {
    renderWithProvider(<QueueProbe />)
    expect(screen.getByTestId("queue-size")).toHaveTextContent("0")

    dropFiles([new File(["hello"], "notes.txt", { type: "text/plain" })])

    await waitFor(() => expect(screen.getByTestId("queue-size")).toHaveTextContent("1"))
  })

  it("ignores drops already handled by nested drop zones", () => {
    renderWithProvider(<QueueProbe />)
    dropFiles([new File(["x"], "handled.txt")], { defaultPrevented: true })
    expect(screen.getByTestId("queue-size")).toHaveTextContent("0")
  })

  it("ignores drops without files", () => {
    renderWithProvider(<QueueProbe />)
    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [], types: ["Files"] },
    })
    window.dispatchEvent(event)
    expect(screen.getByTestId("queue-size")).toHaveTextContent("0")
  })
})

describe("UploadQueueDock", () => {
  it("opens the shared queue panel and lists dropped files", async () => {
    renderWithProvider(<UploadQueueDock />)

    dropFiles([new File(["data"], "report.pdf", { type: "application/pdf" })])

    fireEvent.click(screen.getByRole("button", { name: /open upload queue/i }))

    await waitFor(() => expect(screen.getByText("report.pdf")).toBeInTheDocument())
    // Chunked engine runs through the mock transport and completes.
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
  })

  it("exposes disclosure semantics and restores focus on Escape", async () => {
    renderWithProvider(<UploadQueueDock />)

    const pill = screen.getByRole("button", { name: /open upload queue/i })
    expect(pill).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(pill)
    expect(pill).toHaveAttribute("aria-expanded", "true")
    expect(pill).toHaveAttribute("aria-controls")

    // Focus moves into the panel; Escape closes and returns it to the pill.
    const closeButton = screen.getByRole("button", { name: "Close" })
    expect(closeButton).toHaveFocus()
    fireEvent.keyDown(closeButton, { key: "Escape" })

    expect(pill).toHaveAttribute("aria-expanded", "false")
    expect(pill).toHaveFocus()
  })

  it("exposes pause/resume/retry controls through the queue panel", async () => {
    const transport = new MockUploadTransport({ latencyMs: 20 })
    renderWithProvider(<UploadQueueDock />, transport)

    dropFiles([new File(["data"], "slow.bin")])
    fireEvent.click(screen.getByRole("button", { name: /open upload queue/i }))

    const pauseButton = await screen.findByRole("button", { name: /pause/i })
    fireEvent.click(pauseButton)
    expect(await screen.findByText("Paused")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /resume/i }))
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
  })
})
