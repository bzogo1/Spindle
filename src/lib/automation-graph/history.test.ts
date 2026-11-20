import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  createEmptyGraph,
  addNodeToGraph,
  GRAPH_HISTORY_MAX_VERSIONS,
  graphHistoryStorageKey,
  readGraphVersions,
  recordGraphVersion,
  deleteGraphVersion,
  useGraphVersions,
} from "./index"
import { serializeGraph } from "./graph"

beforeEach(() => {
  window.localStorage.clear()
})

function graphWithNode(name = "G") {
  const graph = createEmptyGraph(name)
  return addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
}

describe("recordGraphVersion / readGraphVersions", () => {
  it("persists versions newest-first under a versioned key", () => {
    recordGraphVersion("scope-a", graphWithNode("First"))
    recordGraphVersion("scope-a", graphWithNode("Second"))

    const versions = readGraphVersions("scope-a")
    expect(versions).toHaveLength(2)
    expect(versions[0].graph.name).toBe("Second")
    expect(versions[1].graph.name).toBe("First")
    expect(versions[0].createdAt).toBeTruthy()
    expect(window.localStorage.getItem(graphHistoryStorageKey("scope-a"))).toBeTruthy()
  })

  it("scopes history per key", () => {
    recordGraphVersion("scope-a", graphWithNode("A"))
    recordGraphVersion("scope-b", graphWithNode("B"))

    expect(readGraphVersions("scope-a")).toHaveLength(1)
    expect(readGraphVersions("scope-b")).toHaveLength(1)
    expect(readGraphVersions("scope-a")[0].graph.name).toBe("A")
  })

  it("dedupes a graph identical to the newest version", () => {
    const graph = graphWithNode("Same")
    const first = recordGraphVersion("scope", graph)
    const second = recordGraphVersion("scope", graph)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(readGraphVersions("scope")).toHaveLength(1)
  })

  it("dedupes a graph that differs from the head only by graph.id", () => {
    // Restoring a version keeps the current graph.id, so the restored graph
    // must not be recorded as a near-duplicate of the stored snapshot.
    const graph = graphWithNode("Same")
    recordGraphVersion("scope", graph)

    const restored = { ...graph, id: "g_restored_other_id" }
    expect(recordGraphVersion("scope", restored)).toBeNull()
    expect(readGraphVersions("scope")).toHaveLength(1)
  })

  it("relabels the head version when the graph is unchanged", () => {
    const graph = graphWithNode("Same")
    recordGraphVersion("scope", graph)
    const relabeled = recordGraphVersion("scope", graph, "checkpoint")

    expect(relabeled?.label).toBe("checkpoint")
    expect(readGraphVersions("scope")).toHaveLength(1)
    expect(readGraphVersions("scope")[0].label).toBe("checkpoint")
    // Relabeling with no label or the same label is a no-op.
    expect(recordGraphVersion("scope", graph)).toBeNull()
    expect(recordGraphVersion("scope", graph, "checkpoint")).toBeNull()
  })

  it("stores an optional trimmed label", () => {
    const version = recordGraphVersion("scope", graphWithNode(), "  before refactor  ")
    expect(version?.label).toBe("before refactor")
    expect(readGraphVersions("scope")[0].label).toBe("before refactor")
  })

  it("caps the history at GRAPH_HISTORY_MAX_VERSIONS", () => {
    for (let i = 0; i < GRAPH_HISTORY_MAX_VERSIONS + 5; i += 1) {
      const graph = graphWithNode(`v${i}`)
      // Vary node config so each snapshot differs from the previous head.
      graph.nodes[0].config.cron = `0 ${i} * * *`
      recordGraphVersion("scope", graph)
    }

    const versions = readGraphVersions("scope")
    expect(versions).toHaveLength(GRAPH_HISTORY_MAX_VERSIONS)
    expect(versions[0].graph.name).toBe(`v${GRAPH_HISTORY_MAX_VERSIONS + 4}`)
  })

  it("returns [] for unknown scopes and corrupt payloads", () => {
    expect(readGraphVersions("nope")).toEqual([])
    window.localStorage.setItem(graphHistoryStorageKey("bad"), "{not json")
    expect(readGraphVersions("bad")).toEqual([])
    window.localStorage.setItem(
      graphHistoryStorageKey("wrong"),
      JSON.stringify([{ id: 1 }, { foo: "bar" }]),
    )
    expect(readGraphVersions("wrong")).toEqual([])
  })
})

describe("deleteGraphVersion", () => {
  it("removes a single version and keeps the rest", () => {
    recordGraphVersion("scope", graphWithNode("One"))
    const second = recordGraphVersion("scope", graphWithNode("Two"))

    deleteGraphVersion("scope", second!.id)

    const versions = readGraphVersions("scope")
    expect(versions).toHaveLength(1)
    expect(versions[0].graph.name).toBe("One")
  })

  it("is a no-op for unknown ids", () => {
    recordGraphVersion("scope", graphWithNode("One"))
    deleteGraphVersion("scope", "gv_missing")
    expect(readGraphVersions("scope")).toHaveLength(1)
  })
})

describe("useGraphVersions", () => {
  it("returns stored versions and updates on record", () => {
    const { result } = renderHook(() => useGraphVersions("scope"))
    expect(result.current).toEqual([])

    act(() => {
      recordGraphVersion("scope", graphWithNode("Live"))
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].graph.name).toBe("Live")
  })
})

describe("round-trip through serializeGraph", () => {
  it("stored graphs re-serialize identically", () => {
    const graph = graphWithNode("Round trip")
    recordGraphVersion("scope", graph)
    const [version] = readGraphVersions("scope")
    expect(serializeGraph(version.graph)).toBe(serializeGraph(graph))
  })
})

describe("version comments", () => {
  it("stores, updates, and clears comments on versions", async () => {
    const { updateGraphVersionComment } = await import("./history")
    const version = recordGraphVersion("comments", graphWithNode("V1"), "first")
    expect(version).not.toBeNull()

    updateGraphVersionComment("comments", version!.id, "added the trigger")
    expect(readGraphVersions("comments")[0].comment).toBe("added the trigger")

    updateGraphVersionComment("comments", version!.id, "   ")
    expect(readGraphVersions("comments")[0].comment).toBeUndefined()

    updateGraphVersionComment("comments", "missing-id", "nope")
    expect(readGraphVersions("comments")).toHaveLength(1)
  })
})
