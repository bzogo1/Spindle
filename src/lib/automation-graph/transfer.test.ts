import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  graphTransferFormatForFileName,
  parseGraphImport,
  serializeGraphJson,
  serializeGraphYaml,
  updateNode,
} from "./index"
import type { AutomationGraph } from "./types"

function sampleGraph(): AutomationGraph {
  let graph = createEmptyGraph("Digest")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "agent.task", { x: 300, y: 0 })
  const t = graph.nodes[0]
  const a = graph.nodes[1]
  graph = addEdgeToGraph(graph, {
    sourceNodeId: t.id,
    sourcePort: "out",
    targetNodeId: a.id,
    targetPort: "in",
  })
  graph = updateNode(graph, a.id, { config: { ...a.config, prompt: "Summarize the run." } })
  return graph
}

describe("serializeGraphJson / serializeGraphYaml", () => {
  it("round-trips through JSON", () => {
    const graph = sampleGraph()
    const result = parseGraphImport(serializeGraphJson(graph), "json")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph).toEqual(graph)
  })

  it("round-trips through YAML", () => {
    const graph = sampleGraph()
    const yaml = serializeGraphYaml(graph)
    expect(yaml).toContain("version:")
    expect(yaml).toContain("graph:")
    const result = parseGraphImport(yaml, "yaml")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph).toEqual(graph)
  })
})

describe("parseGraphImport", () => {
  it("accepts a bare AutomationGraph without the DSL envelope", () => {
    const graph = sampleGraph()
    const result = parseGraphImport(JSON.stringify(graph), "json")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph.id).toBe(graph.id)
  })

  it("rejects malformed JSON", () => {
    const result = parseGraphImport("{not json", "json")
    expect(result).toEqual({ ok: false, error: "The file is not valid JSON." })
  })

  it("rejects malformed YAML", () => {
    const result = parseGraphImport("foo: [unclosed", "yaml")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("The file is not valid YAML.")
  })

  it("rejects payloads that are not graphs", () => {
    for (const source of ['{"version":1}', "42", "null", '"hello"']) {
      const result = parseGraphImport(source, "json")
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe("The file does not contain a valid automation graph.")
      }
    }
  })

  it("rejects graphs with malformed node entries", () => {
    const graph = sampleGraph()
    const broken = { ...graph, nodes: [null, ...graph.nodes.slice(1)] }
    const result = parseGraphImport(JSON.stringify(broken), "json")
    expect(result.ok).toBe(false)
  })

  it("rejects duplicate node ids", () => {
    const graph = sampleGraph()
    const broken = { ...graph, nodes: [graph.nodes[0], graph.nodes[0]] }
    const result = parseGraphImport(JSON.stringify(broken), "json")
    expect(result.ok).toBe(false)
  })

  it("rejects graphs with error-severity validation issues", () => {
    // Edge pointing at a missing node.
    const graph = sampleGraph()
    const broken = {
      ...graph,
      edges: [
        {
          id: "e_bad",
          sourceNodeId: "missing",
          sourcePort: "out",
          targetNodeId: graph.nodes[0].id,
          targetPort: "in",
        },
      ],
    }
    const result = parseGraphImport(JSON.stringify(broken), "json")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/errors:/)
  })

  it("defaults a missing graph name", () => {
    const graph = { ...sampleGraph(), name: "" }
    const result = parseGraphImport(JSON.stringify(graph), "json")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph.name).toBe("Imported automation")
  })
})

describe("graphTransferFormatForFileName", () => {
  it("detects yaml extensions", () => {
    expect(graphTransferFormatForFileName("a.yaml")).toBe("yaml")
    expect(graphTransferFormatForFileName("a.YML")).toBe("yaml")
    expect(graphTransferFormatForFileName("a.json")).toBe("json")
    expect(graphTransferFormatForFileName("a")).toBe("json")
  })
})
