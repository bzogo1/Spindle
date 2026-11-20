import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { CollaborativeDocument } from "@/lib/collab/document"
import type { CollabClient } from "@/lib/collab/sync"
import type { OfflineOpQueue } from "@/lib/collab/offline"
import type { CrdtOp } from "@/lib/collab/crdt"

import { CollaborativeEditor } from "./CollaborativeEditor"

// jsdom may lack rAF depending on config; the caret-restore path uses it.
beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }
  }
})

const fakeClient = (connected = true) =>
  ({
    connected,
    sendOps: vi.fn(),
    sendAwareness: vi.fn(),
    setHandlers: vi.fn(),
  }) as unknown as CollabClient & { sendOps: ReturnType<typeof vi.fn> }

describe("CollaborativeEditor", () => {
  it("renders the document's initial text", () => {
    const doc = new CollaborativeDocument("me", "hello world")
    render(<CollaborativeEditor document={doc} />)
    expect(screen.getByRole("textbox")).toHaveValue("hello world")
  })

  it("applies local edits to the document and broadcasts ops", () => {
    const doc = new CollaborativeDocument("me", "hello")
    const client = fakeClient()
    const onSelectionChange = vi.fn()
    render(
      <CollaborativeEditor document={doc} client={client} onSelectionChange={onSelectionChange} />,
    )

    const area = screen.getByRole("textbox") as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: "hello world" } })

    expect(doc.text).toBe("hello world")
    expect(client.sendOps).toHaveBeenCalled()
    const ops = client.sendOps.mock.calls[0][0] as CrdtOp[]
    expect(ops.length).toBeGreaterThan(0)
    expect(onSelectionChange).toHaveBeenCalled()
  })

  it("does not broadcast while disconnected but queues offline ops", async () => {
    const doc = new CollaborativeDocument("me", "hi")
    const client = fakeClient(false)
    const offlineQueue = { push: vi.fn().mockResolvedValue(undefined) } as unknown as OfflineOpQueue
    render(<CollaborativeEditor document={doc} client={client} offlineQueue={offlineQueue} />)

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi!" } })

    expect(client.sendOps).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(offlineQueue.push).toHaveBeenCalled())
  })

  it("updates the textarea when remote ops are applied", () => {
    const doc = new CollaborativeDocument("me", "base")
    const peer = new CollaborativeDocument("peer", "")
    render(<CollaborativeEditor document={doc} />)

    const area = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(area).toHaveValue("base")

    // Remote peer inserts at the start; ops are CRDT-legal for our doc.
    const ops = peer.insertText(0, "remote ")
    act(() => {
      doc.applyRemoteOps(ops)
    })

    expect(doc.text).toContain("remote ")
    expect(area.value).toBe(doc.text)
  })

  it("passes through placeholder and disabled props", () => {
    const doc = new CollaborativeDocument("me")
    render(<CollaborativeEditor document={doc} placeholder="Write…" disabled />)
    const area = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(area).toHaveAttribute("placeholder", "Write…")
    expect(area).toBeDisabled()
  })
})

describe("CollaborativeEditor local-edit isolation", () => {
  it("does not run the remote caret-restore path for local edits", () => {
    const rafCalls: FrameRequestCallback[] = []
    const orig = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCalls.push(cb)
      return 0
    }
    try {
      const doc = new CollaborativeDocument("me", "ab")
      render(<CollaborativeEditor document={doc} />)
      const area = screen.getByRole("textbox") as HTMLTextAreaElement

      fireEvent.change(area, { target: { value: "abc" } })
      expect(doc.text).toBe("abc")
      // The synchronous subscribe callback must skip local edits — no rAF
      // caret restore scheduled.
      expect(rafCalls).toHaveLength(0)

      // Sanity: a genuine remote op still goes through the caret path.
      const peer = new CollaborativeDocument("peer", "")
      const ops = peer.insertText(0, "Z")
      act(() => {
        doc.applyRemoteOps(ops)
      })
      expect(rafCalls.length).toBeGreaterThan(0)
      expect(area.value).toBe(doc.text)
    } finally {
      globalThis.requestAnimationFrame = orig
    }
  })
})

describe("CollaborativeEditor remote-update window", () => {
  it("accepts an edit immediately after a remote update is applied", async () => {
    const doc = new CollaborativeDocument("me", "ab")
    const peer = new CollaborativeDocument("peer", "")
    render(<CollaborativeEditor document={doc} />)
    const area = screen.getByRole("textbox") as HTMLTextAreaElement

    const ops = peer.insertText(0, "Z")
    act(() => {
      doc.applyRemoteOps(ops)
    })
    // Flush the microtask that releases the remote-edit guard, then type.
    await act(async () => {})
    fireEvent.change(area, { target: { value: `${doc.text}!` } })
    expect(doc.text).toBe("Zab!")
    expect(area.value).toBe("Zab!")
  })
})
