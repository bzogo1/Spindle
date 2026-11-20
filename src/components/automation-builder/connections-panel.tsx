"use client"

import { useMemo, useState } from "react"
import { Link2, Trash2 } from "lucide-react"

import {
  getNode,
  getNodeType,
  type AutomationGraph,
  type ConnectionResult,
  type GraphConnection,
} from "@/lib/automation-graph"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ConnectionsPanelProps {
  graph: AutomationGraph
  selectedEdgeId: string | null
  onSelectEdge: (edgeId: string | null) => void
  onConnectAttempt: (conn: GraphConnection) => ConnectionResult
  onRemoveEdge: (edgeId: string) => void
}

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

/**
 * Keyboard-accessible alternative to drag-and-drop edge creation: pick a
 * source node/port and a target node/port from dropdowns and press Connect.
 */
export function ConnectionsPanel({
  graph,
  selectedEdgeId,
  onSelectEdge,
  onConnectAttempt,
  onRemoveEdge,
}: ConnectionsPanelProps) {
  const [sourceNodeId, setSourceNodeId] = useState("")
  const [sourcePort, setSourcePort] = useState("")
  const [targetNodeId, setTargetNodeId] = useState("")
  const [targetPort, setTargetPort] = useState("")
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const nodesWithOutputs = useMemo(
    () => graph.nodes.filter((node) => (getNodeType(node.type)?.outputs.length ?? 0) > 0),
    [graph.nodes],
  )
  const nodesWithInputs = useMemo(
    () => graph.nodes.filter((node) => (getNodeType(node.type)?.inputs.length ?? 0) > 0),
    [graph.nodes],
  )

  const sourceNode = sourceNodeId ? getNode(graph, sourceNodeId) : undefined
  const targetNode = targetNodeId ? getNode(graph, targetNodeId) : undefined
  const sourcePorts = getNodeType(sourceNode?.type ?? "")?.outputs ?? []
  const targetPorts = getNodeType(targetNode?.type ?? "")?.inputs ?? []

  function handleConnect() {
    if (!sourceNodeId || !sourcePort || !targetNodeId || !targetPort) {
      setFeedback({ ok: false, text: "Choose a source and target port first." })
      return
    }
    const result = onConnectAttempt({
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort,
    })
    setFeedback(
      result.ok ? { ok: true, text: "Connection added." } : { ok: false, text: result.reason },
    )
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-connections-heading"
    >
      <h3
        id="builder-connections-heading"
        className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
      >
        Connections
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="conn-source-node" className="text-[11px]">
            From node
          </Label>
          <select
            id="conn-source-node"
            className={selectClass}
            value={sourceNodeId}
            onChange={(event) => {
              setSourceNodeId(event.target.value)
              setSourcePort("")
            }}
          >
            <option value="">Select…</option>
            {nodesWithOutputs.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="conn-source-port" className="text-[11px]">
            Output port
          </Label>
          <select
            id="conn-source-port"
            className={selectClass}
            value={sourcePort}
            onChange={(event) => setSourcePort(event.target.value)}
            disabled={!sourceNodeId}
          >
            <option value="">Select…</option>
            {sourcePorts.map((port) => (
              <option key={port.id} value={port.id}>
                {port.label ?? port.id} ({port.type})
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="conn-target-node" className="text-[11px]">
            To node
          </Label>
          <select
            id="conn-target-node"
            className={selectClass}
            value={targetNodeId}
            onChange={(event) => {
              setTargetNodeId(event.target.value)
              setTargetPort("")
            }}
          >
            <option value="">Select…</option>
            {nodesWithInputs.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="conn-target-port" className="text-[11px]">
            Input port
          </Label>
          <select
            id="conn-target-port"
            className={selectClass}
            value={targetPort}
            onChange={(event) => setTargetPort(event.target.value)}
            disabled={!targetNodeId}
          >
            <option value="">Select…</option>
            {targetPorts.map((port) => (
              <option key={port.id} value={port.id}>
                {port.label ?? port.id} ({port.type})
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button type="button" size="sm" onClick={handleConnect} className="w-full">
        <Link2 aria-hidden="true" />
        Connect nodes
      </Button>
      {feedback ? (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={cn(
            "text-[11px]",
            feedback.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {feedback.text}
        </p>
      ) : null}

      {graph.edges.length > 0 ? (
        <ul className="border-border/60 mt-1 flex max-h-36 flex-col gap-1 overflow-y-auto border-t pt-2">
          {graph.edges.map((edge) => {
            const source = getNode(graph, edge.sourceNodeId)
            const target = getNode(graph, edge.targetNodeId)
            const selected = edge.id === selectedEdgeId
            return (
              <li
                key={edge.id}
                className={cn(
                  "flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px]",
                  selected && "bg-accent/60",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => onSelectEdge(selected ? null : edge.id)}
                  aria-pressed={selected}
                  aria-label={`Edge from ${source?.label ?? edge.sourceNodeId} to ${target?.label ?? edge.targetNodeId}`}
                >
                  {source?.label ?? "?"}.{edge.sourcePort} → {target?.label ?? "?"}.
                  {edge.targetPort}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded p-0.5"
                  aria-label="Delete connection"
                  onClick={() => onRemoveEdge(edge.id)}
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="border-border/60 text-muted-foreground border-t pt-2 text-[11px]">
          No connections yet.
        </p>
      )}
    </section>
  )
}
