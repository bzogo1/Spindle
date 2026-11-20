import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Awareness, type AwarenessState } from "@/lib/collab/awareness"
import { CollaborativeDocument } from "@/lib/collab/document"
import type { CollabClient, CollabClientHandlers } from "@/lib/collab/sync"
import type { OfflineOpQueue } from "@/lib/collab/offline"
import type { CrdtOp } from "@/lib/collab/crdt"

import { CollaborativeDoc } from "./CollaborativeDoc"

const presence = (name: string, cursor: number | null): AwarenessState => ({
  user: { id: `u-${name}`, name, color: "#123456" },
  cursor,
  updatedAt: 1,
})

function makeClient() {
  const handlers: { current?: CollabClientHandlers } = {}
  const mock = {
    connected: true,
    sendOps: vi.fn(),
    sendAwareness: vi.fn(),
    setHandlers: vi.fn((h: CollabClientHandlers) => {
      handlers.current = h
    }),
  }
  const client = mock as unknown as CollabClient
  return { client, mock, handlers }
}

describe("CollaborativeDoc", () => {
  it("renders the shared document in an editor", () => {
    const doc = new CollaborativeDocument("me", "shared text")
    render(<CollaborativeDoc document={doc} clientId="me" />)
    expect(screen.getByRole("textbox")).toHaveValue("shared text")
  })

  it("shows remote presence cursors from the awareness instance", () => {
    const doc = new CollaborativeDocument("me", "hello")
    const awareness = new Awareness()
    awareness.apply("peer-1", presence("Bob", 2))

    render(<CollaborativeDoc document={doc} clientId="me" awareness={awareness} />)
    // Name appears both as a cursor flag and in the presence roster.
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0)
    // Own presence is excluded from the cursor overlay (roster marks "you").
    expect(screen.queryByText("me")).not.toBeInTheDocument()
    expect(screen.getByText("me (you)")).toBeInTheDocument()
  })

  it("broadcasts local presence and cleans up on unmount", () => {
    const doc = new CollaborativeDocument("me", "hi")
    const { client, mock } = makeClient()
    const awareness = new Awareness()

    const { unmount } = render(
      <CollaborativeDoc document={doc} clientId="me" client={client} awareness={awareness} />,
    )

    // Mount effect broadcasts the local user's awareness state.
    expect(mock.sendAwareness).toHaveBeenCalled()
    const sent = mock.sendAwareness.mock.calls.at(-1)?.[0] as AwarenessState
    expect(sent.user.id).toBe("me")
    expect(awareness.get("me")?.user.id).toBe("me")

    unmount()
    expect(mock.sendAwareness).toHaveBeenLastCalledWith(null)
    expect(awareness.get("me")).toBeUndefined()
  })

  it("routes remote ops through the sync handlers into the document", () => {
    const doc = new CollaborativeDocument("me", "base")
    const { client, handlers } = makeClient()
    render(<CollaborativeDoc document={doc} clientId="me" client={client} />)

    const peer = new CollaborativeDocument("peer", "")
    const ops = peer.insertText(0, "remote ") as CrdtOp[]

    act(() => {
      handlers.current?.onOps?.(ops)
    })
    expect(doc.text).toContain("remote ")
    expect(screen.getByRole("textbox")).toHaveValue(doc.text)
  })

  it("routes remote awareness into the shared Awareness and re-renders cursors", () => {
    const doc = new CollaborativeDocument("me", "hello")
    const awareness = new Awareness()
    const { client, handlers } = makeClient()
    render(<CollaborativeDoc document={doc} clientId="me" client={client} awareness={awareness} />)

    act(() => {
      handlers.current?.onAwareness?.("peer-9", presence("Carol", 4))
    })
    expect(screen.getAllByText("Carol").length).toBeGreaterThan(0)

    act(() => {
      handlers.current?.onAwareness?.("peer-9", null)
    })
    expect(screen.queryByText("Carol")).not.toBeInTheDocument()
  })

  it("flushes the offline queue when the client connects", async () => {
    const doc = new CollaborativeDocument("me", "text")
    const { client, mock, handlers } = makeClient()
    const queued: CrdtOp[] = []
    const offlineQueue = {
      load: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn(async (send: (op: CrdtOp) => Promise<boolean>) => {
        let sent = 0
        for (const op of queued.splice(0)) {
          if (await send(op)) sent += 1
        }
        return sent
      }),
    } as unknown as OfflineOpQueue & {
      load: ReturnType<typeof vi.fn>
      flush: ReturnType<typeof vi.fn>
    }
    render(
      <CollaborativeDoc document={doc} clientId="me" client={client} offlineQueue={offlineQueue} />,
    )

    expect(offlineQueue.load).toHaveBeenCalled()
    // Simulate queued ops existing, then the socket opening.
    const peer = new CollaborativeDocument("peer", "")
    queued.push(...(peer.insertText(0, "q") as CrdtOp[]))

    await act(async () => {
      handlers.current?.onOpen?.()
    })
    expect(mock.sendOps).toHaveBeenCalled()
  })
})

describe("CollaborativeDoc conflict resolution", () => {
  it("shows a conflict banner for concurrent same-range edits and resolves via the CRDT", () => {
    const doc = new CollaborativeDocument("me")
    const peer = new CollaborativeDocument("peer")
    // Converge both replicas on "hello".
    const seedOps = doc.insertText(0, "hello")
    peer.applyRemoteOps(seedOps)

    const { client, handlers } = makeClient()
    render(<CollaborativeDoc document={doc} clientId="me" client={client} />)

    // Local user types " mine" at the end…
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello mine" } })
    expect(doc.text).toBe("hello mine")

    // …while the peer concurrently types " theirs" at the same spot.
    const remoteOps = peer.insertText(5, " theirs")
    act(() => {
      handlers.current?.onOps?.(remoteOps)
    })

    // CRDT merged both; the banner surfaces the two versions.
    expect(doc.text).toContain("mine")
    expect(doc.text).toContain("theirs")
    const banner = screen.getByTestId("conflict-banner")
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent("mine")
    expect(banner).toHaveTextContent("theirs")

    // "Keep mine" removes the remote contribution through CRDT ops.
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }))
    expect(doc.text).toContain("mine")
    expect(doc.text).not.toContain("theirs")
    expect(screen.queryByTestId("conflict-banner")).not.toBeInTheDocument()
  })
})

describe("CollaborativeDoc presence status", () => {
  it("omits explicit 'online' status so peers derive it from updatedAt", () => {
    const doc = new CollaborativeDocument("me", "hi")
    const { client, mock } = makeClient()
    render(<CollaborativeDoc document={doc} clientId="me" client={client} />)

    const sent = mock.sendAwareness.mock.calls.at(-1)?.[0] as AwarenessState
    expect(sent.status).toBeUndefined()
    expect(sent.updatedAt).toBeGreaterThan(0)
  })

  it("sends explicit 'idle' once the idle threshold is exceeded", () => {
    const doc = new CollaborativeDocument("me", "hi")
    const { client, mock } = makeClient()
    // Negative threshold ⇒ always idle (deterministic, no timer fakery).
    render(<CollaborativeDoc document={doc} clientId="me" client={client} idleAfterMs={-1} />)

    const sent = mock.sendAwareness.mock.calls.at(-1)?.[0] as AwarenessState
    expect(sent.status).toBe("idle")
  })
})
