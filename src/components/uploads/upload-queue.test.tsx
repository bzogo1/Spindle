import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { UploadQueue } from "@/lib/uploads/queue"
import { MemoryUploadStore, type PersistedUpload } from "@/lib/uploads/persistence"
import { MockUploadTransport } from "@/lib/uploads/transport"

import { UploadQueuePanel } from "./upload-queue"

function makeFile(name: string, size = 32, lastModified = 1_700_000_000_000): File {
  return new File([new Uint8Array(size)], name, {
    type: "application/octet-stream",
    lastModified,
  })
}

// The panel builds its own UploadQueue from these props; keep parts small and
// concurrency at 1 so statuses are easy to observe deterministically.
function renderPanel(
  transport: MockUploadTransport,
  props: { maxAttempts?: number; onAllComplete?: () => void } = {},
) {
  return render(
    <UploadQueuePanel
      transport={transport}
      concurrency={1}
      chunkSize={8}
      maxAttempts={props.maxAttempts ?? 3}
      onAllComplete={props.onAllComplete}
    />,
  )
}

function selectFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  // The panel's default store is localStorage-backed; persisted entries must
  // not leak between tests.
  localStorage.clear()
})

describe("UploadQueuePanel", () => {
  it("renders the dropzone and hides the totals bar when empty", () => {
    renderPanel(new MockUploadTransport())

    expect(screen.getByText(/Drag files here or browse/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add files/i })).toBeInTheDocument()
    // No file rows or progress bars until something is queued.
    expect(document.querySelector("ul")).toBeNull()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("lists files added through the file input and reports aggregate progress", async () => {
    const onAllComplete = vi.fn()
    const { container } = renderPanel(new MockUploadTransport(), { onAllComplete })

    selectFiles(container, [makeFile("notes.txt"), makeFile("data.bin")])

    expect(await screen.findByText("notes.txt")).toBeInTheDocument()
    expect(screen.getByText("data.bin")).toBeInTheDocument()

    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2))
    expect(screen.getByText("2/2 files")).toBeInTheDocument()
    expect(onAllComplete).toHaveBeenCalledTimes(1)
  })

  it("adds files dropped onto the dropzone", async () => {
    const { container } = renderPanel(new MockUploadTransport())

    const zone = screen.getByText(/Drag files here or browse/).closest("div")!
    fireEvent.drop(zone, {
      dataTransfer: { files: [makeFile("dropped.bin")] },
    })

    expect(await screen.findByText("dropped.bin")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
    expect(container.querySelector("ul")).not.toBeNull()
  })

  it("shows per-file status, part counts and progress while uploading", async () => {
    const transport = new MockUploadTransport({ latencyMs: 30 })
    const { container } = renderPanel(transport)

    selectFiles(container, [makeFile("slow.bin", 24)])

    expect(await screen.findByText("slow.bin")).toBeInTheDocument()
    // 24 bytes / 8-byte parts = 3 parts.
    await waitFor(() => expect(screen.getByText(/\d+\/3 parts/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
  })

  it("surfaces upload errors with the failure message", async () => {
    const transport = new MockUploadTransport({ shouldFail: () => true })
    const { container } = renderPanel(transport, { maxAttempts: 1 })

    selectFiles(container, [makeFile("broken.bin")])

    expect(await screen.findByText("Error")).toBeInTheDocument()
    expect(screen.getByText(/mock upload failure/)).toBeInTheDocument()
    expect(screen.getByText("0/1 files · 1 failed")).toBeInTheDocument()
  })

  it("pauses and resumes an in-flight upload", async () => {
    const transport = new MockUploadTransport({ latencyMs: 25 })
    const { container } = renderPanel(transport)

    selectFiles(container, [makeFile("pause.bin", 64)])

    const pauseButton = await screen.findByRole("button", { name: /pause/i })
    fireEvent.click(pauseButton)
    expect(await screen.findByText("Paused")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /resume/i }))
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
    // 8 parts, each uploaded exactly once.
    expect(transport.uploadCount).toBe(8)
  })

  it("retries a failed file and completes it", async () => {
    let failing = true
    const transport = new MockUploadTransport({ shouldFail: () => failing })
    const { container } = renderPanel(transport, { maxAttempts: 1 })

    selectFiles(container, [makeFile("flaky.bin")])
    expect(await screen.findByText("Error")).toBeInTheDocument()

    failing = false
    fireEvent.click(screen.getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
  })

  it("cancels an upload and offers resume", async () => {
    const transport = new MockUploadTransport({ latencyMs: 25 })
    const { container } = renderPanel(transport)

    selectFiles(container, [makeFile("cancel.bin", 64)])

    const cancelButton = await screen.findByRole("button", { name: /cancel/i })
    fireEvent.click(cancelButton)
    expect(await screen.findByText("Cancelled")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /resume/i }))
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument())
  })

  it("removes a file from the list", async () => {
    const transport = new MockUploadTransport({ latencyMs: 25 })
    const { container } = renderPanel(transport)

    selectFiles(container, [makeFile("gone.bin")])
    expect(await screen.findByText("gone.bin")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /remove/i }))
    await waitFor(() => expect(screen.queryByText("gone.bin")).not.toBeInTheDocument())
  })

  it("fires onAllComplete for an externally-supplied queue", async () => {
    const transport = new MockUploadTransport()
    const queue = new UploadQueue({
      transport,
      concurrency: 1,
      chunkSize: 8,
      sleep: () => Promise.resolve(),
    })
    await queue.ready
    const onAllComplete = vi.fn()
    const { container } = render(
      <UploadQueuePanel transport={transport} queue={queue} onAllComplete={onAllComplete} />,
    )

    selectFiles(container, [makeFile("external.txt"), makeFile("external2.bin")])

    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2))
    expect(onAllComplete).toHaveBeenCalledTimes(1)
  })

  it("does not fire onAllComplete for an external queue until every file completes", async () => {
    // ok.bin is added first so it gets session mock-upload-1; bad.bin gets
    // mock-upload-2 and fails on its first attempt (maxAttempts: 1).
    const transport = new MockUploadTransport({
      shouldFail: ({ sessionId, partNumber, attempt }) =>
        sessionId === "mock-upload-2" && partNumber === 1 && attempt === 1,
    })
    const queue = new UploadQueue({
      transport,
      concurrency: 1,
      chunkSize: 8,
      maxAttempts: 1,
      sleep: () => Promise.resolve(),
    })
    await queue.ready
    const onAllComplete = vi.fn()
    const { container } = render(
      <UploadQueuePanel transport={transport} queue={queue} onAllComplete={onAllComplete} />,
    )

    selectFiles(container, [makeFile("ok.bin"), makeFile("bad.bin")])

    // The first file completes while the second is still in error, so the
    // all-complete callback must not fire.
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(1))
    await waitFor(() => expect(screen.getByText("Error")).toBeInTheDocument())
    expect(onAllComplete).not.toHaveBeenCalled()

    // Retrying the failed file lets the queue reach all-complete, which fires
    // the callback exactly once.
    fireEvent.click(screen.getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(onAllComplete).toHaveBeenCalledTimes(1))
  })

  it("renders restored entries as awaiting their file", async () => {
    const transport = new MockUploadTransport()
    const store = new MemoryUploadStore()
    const persisted: PersistedUpload = {
      id: "restored-1",
      fileKey: "resume.bin:32:1700000000000",
      fileName: "resume.bin",
      size: 32,
      key: "resume.bin",
      partSize: 8,
      uploadedParts: [{ partNumber: 1, etag: "e1" }],
      status: "paused",
      updatedAt: 1_700_000_000_000,
    }
    await store.save(persisted)

    const queue = new UploadQueue({
      transport,
      store,
      concurrency: 1,
      chunkSize: 8,
      checksums: false,
      sleep: () => Promise.resolve(),
    })
    await queue.ready
    render(<UploadQueuePanel transport={transport} queue={queue} />)

    expect(await screen.findByText("resume.bin")).toBeInTheDocument()
    expect(screen.getByText(/waiting for file/)).toBeInTheDocument()
    expect(screen.getByText("Paused")).toBeInTheDocument()
    // Awaiting entries cannot resume until the File is re-selected, so the
    // Resume/Retry button is hidden; Remove stays available.
    expect(screen.queryByRole("button", { name: /resume|retry/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument()
  })
})
