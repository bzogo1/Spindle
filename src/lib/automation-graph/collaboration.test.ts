import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  AUTOMATION_COLLAB_BROADCAST_CHANNEL,
  addNodeComment,
  deleteNodeComment,
  getLocalCollaborator,
  isCollabMessage,
  nodeCommentsStorageKey,
  readNodeComments,
  simulatedPresence,
  useAutomationPresence,
  useNodeComments,
} from "./index"

beforeEach(() => {
  window.localStorage.clear()
})

describe("node comments", () => {
  it("adds, reads and deletes comments scoped per key", () => {
    const comment = addNodeComment("scope-a", {
      nodeId: "n1",
      body: "  check this branch  ",
      author: { id: "u1", name: "Maya", color: "#f00" },
    })

    expect(comment).not.toBeNull()
    expect(comment!.body).toBe("check this branch")
    expect(comment!.authorName).toBe("Maya")

    addNodeComment("scope-b", { nodeId: "n1", body: "other scope" })

    const comments = readNodeComments("scope-a")
    expect(comments).toHaveLength(1)
    expect(comments[0].nodeId).toBe("n1")
    expect(window.localStorage.getItem(nodeCommentsStorageKey("scope-a"))).toBeTruthy()
  })

  it("rejects blank bodies and keeps comments in thread order", () => {
    expect(addNodeComment("scope", { nodeId: "n1", body: "   " })).toBeNull()
    addNodeComment("scope", { nodeId: "n1", body: "first" })
    addNodeComment("scope", { nodeId: "n1", body: "second" })

    expect(readNodeComments("scope").map((c) => c.body)).toEqual(["first", "second"])
  })

  it("defaults the author to the local collaborator identity", () => {
    const comment = addNodeComment("scope", { nodeId: "n1", body: "hi" })
    expect(comment!.authorId).toBe(getLocalCollaborator().id)
    expect(comment!.authorName).toBe("You")
  })

  it("deleteNodeComment removes one comment and no-ops on unknown ids", () => {
    const a = addNodeComment("scope", { nodeId: "n1", body: "a" })!
    addNodeComment("scope", { nodeId: "n1", body: "b" })

    deleteNodeComment("scope", "missing")
    expect(readNodeComments("scope")).toHaveLength(2)

    deleteNodeComment("scope", a.id)
    expect(readNodeComments("scope").map((c) => c.body)).toEqual(["b"])
  })

  it("returns [] for unknown scopes and corrupt payloads", () => {
    expect(readNodeComments("nope")).toEqual([])
    window.localStorage.setItem(nodeCommentsStorageKey("bad"), "{not json")
    expect(readNodeComments("bad")).toEqual([])
    window.localStorage.setItem(
      nodeCommentsStorageKey("wrong"),
      JSON.stringify([{ id: 1 }, { foo: "bar" }]),
    )
    expect(readNodeComments("wrong")).toEqual([])
  })
})

describe("useNodeComments", () => {
  it("returns stored comments and updates on add", () => {
    const { result } = renderHook(() => useNodeComments("scope"))
    expect(result.current).toEqual([])

    act(() => {
      addNodeComment("scope", { nodeId: "n1", body: "live" })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].body).toBe("live")
  })
})

describe("simulatedPresence", () => {
  it("returns one presence per simulated collaborator with a node selected", () => {
    const peers = simulatedPresence(["a", "b", "c"])
    expect(peers.length).toBeGreaterThan(0)
    for (const peer of peers) {
      expect(peer.nodeId).toBeTruthy()
      expect(["a", "b", "c"]).toContain(peer.nodeId)
      expect(peer.user.name).toBeTruthy()
      expect(peer.user.color).toMatch(/^#/)
    }
  })

  it("is deterministic and empty without nodes", () => {
    expect(simulatedPresence([])).toEqual([])
    expect(simulatedPresence(["x"])).toEqual(simulatedPresence(["x"]))
  })
})

describe("isCollabMessage", () => {
  it("accepts well-formed presence and leave messages", () => {
    expect(
      isCollabMessage({
        type: "presence",
        scope: "s",
        clientId: "c1",
        state: {
          user: { id: "u1", name: "Maya", color: "#f00" },
          nodeId: "n1",
          updatedAt: 1,
        },
      }),
    ).toBe(true)
    expect(isCollabMessage({ type: "presence-leave", scope: "s", clientId: "c1" })).toBe(true)
  })

  it("rejects malformed payloads", () => {
    expect(isCollabMessage(null)).toBe(false)
    expect(isCollabMessage("presence")).toBe(false)
    expect(isCollabMessage({ type: "presence", scope: "s" })).toBe(false)
    expect(
      isCollabMessage({
        type: "presence",
        scope: "s",
        clientId: "c1",
        state: { user: { id: "u1" }, updatedAt: 1 },
      }),
    ).toBe(false)
    expect(isCollabMessage({ type: "other", scope: "s", clientId: "c1" })).toBe(false)
  })
})

describe("useAutomationPresence", () => {
  it("exposes the local identity and simulated peers for the graph's nodes", () => {
    const { result } = renderHook(() =>
      useAutomationPresence("scope", { nodeId: null }, ["n1", "n2"]),
    )

    expect(result.current.local.name).toBe("You")
    expect(result.current.peers.length).toBeGreaterThan(0)
    expect(result.current.peers.every((p) => p.nodeId !== null)).toBe(true)
    // The local user is never listed as their own peer.
    expect(result.current.peers.some((p) => p.user.id === result.current.local.id)).toBe(false)
  })

  it("merges remote peers arriving over the BroadcastChannel", async () => {
    const { result } = renderHook(() => useAutomationPresence("scope", { nodeId: "n1" }, ["n1"]))

    const channel = new BroadcastChannel(AUTOMATION_COLLAB_BROADCAST_CHANNEL)
    channel.postMessage({
      type: "presence",
      scope: "scope",
      clientId: "remote-1",
      state: {
        user: { id: "remote-user", name: "Remote", color: "#0af" },
        nodeId: "n1",
        updatedAt: Date.now(),
      },
    })
    channel.close()

    await waitFor(() => {
      expect(result.current.peers.some((p) => p.user.name === "Remote")).toBe(true)
    })
  })

  it("lets two hook instances in the same tab see each other", async () => {
    // Both instances share the per-browser collaborator identity, so this
    // only works because presence dedupes on the per-instance clientId.
    const a = renderHook(
      ({ nodeId }: { nodeId: string | null }) =>
        useAutomationPresence("scope", { nodeId }, ["n1", "n2"]),
      { initialProps: { nodeId: "n1" as string | null } },
    )
    const b = renderHook(() => useAutomationPresence("scope", { nodeId: "n2" }, ["n1", "n2"]))

    // b published on mount; a's persistent channel receives it.
    await waitFor(() => {
      expect(
        a.result.current.peers.some(
          (p) => p.user.id === b.result.current.local.id && p.nodeId === "n2",
        ),
      ).toBe(true)
    })

    // a's mount-time publish happened before b subscribed; changing a's
    // selection republishes so b sees a too.
    a.rerender({ nodeId: null })
    await waitFor(() => {
      expect(
        b.result.current.peers.some(
          (p) => p.user.id === a.result.current.local.id && p.nodeId === null,
        ),
      ).toBe(true)
    })
  })

  it("ignores presence messages for other scopes", async () => {
    const { result } = renderHook(() => useAutomationPresence("scope-a", { nodeId: null }, ["n1"]))

    const channel = new BroadcastChannel(AUTOMATION_COLLAB_BROADCAST_CHANNEL)
    channel.postMessage({
      type: "presence",
      scope: "scope-b",
      clientId: "remote-2",
      state: {
        user: { id: "other", name: "OtherScope", color: "#0af" },
        nodeId: "n1",
        updatedAt: Date.now(),
      },
    })
    channel.close()

    // Give the channel a chance to deliver, then assert nothing arrived.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current.peers.some((p) => p.user.name === "OtherScope")).toBe(false)
  })
})
