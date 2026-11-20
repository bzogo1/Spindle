"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GitBranch, MessageSquare, X } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  getNodeType,
  type AutomationGraph,
  type ConnectionResult,
  type GraphConnection,
  type GraphEdge,
  type GraphNode,
  type NodeRunStatus,
} from "@/lib/automation-graph"

import {
  NODE_HEADER_HEIGHT,
  NODE_WIDTH,
  PORT_DOT_SIZE,
  PORT_ROW_HEIGHT,
  canvasSize,
  edgePath,
  nodeHeight,
  portAnchor,
  type Point,
} from "./layout"

interface PendingConnection {
  sourceNodeId: string
  sourcePort: string
  cursor: Point
}

/** A collaborator currently focused on a node. */
export interface NodePeer {
  name: string
  color: string
}

interface GraphCanvasProps {
  graph: AutomationGraph
  selectedNodeId: string | null
  selectedEdgeId?: string | null
  statuses?: Record<string, NodeRunStatus>
  errorNodeIds?: ReadonlySet<string>
  warningNodeIds?: ReadonlySet<string>
  /** nodeId → collaborators with that node selected (presence overlay). */
  peerSelections?: ReadonlyMap<string, NodePeer[]>
  /** nodeId → comment count badge. */
  commentCounts?: Readonly<Record<string, number>>
  onSelectNode: (nodeId: string | null) => void
  onSelectEdge: (edgeId: string | null) => void
  onMoveNode: (nodeId: string, position: Point) => void
  /** Returns whether the connection was accepted; rejection reason shown in canvas. */
  onConnectAttempt: (conn: GraphConnection) => ConnectionResult
  onAddNodeAt: (type: string, position: Point) => void
}

function toLocalPoint(container: HTMLElement, clientX: number, clientY: number): Point {
  const rect = container.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function CanvasNode({
  node,
  selected,
  status,
  hasError,
  hasWarning,
  peers = [],
  commentCount = 0,
  onSelect,
  onMove,
  onStartConnection,
}: {
  node: GraphNode
  selected: boolean
  status?: NodeRunStatus
  hasError: boolean
  hasWarning: boolean
  peers?: NodePeer[]
  commentCount?: number
  onSelect: () => void
  onMove: (position: Point) => void
  onStartConnection: (nodeId: string, portId: string) => void
}) {
  const def = getNodeType(node.type)
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const rows = Math.max(def?.inputs.length ?? 0, def?.outputs.length ?? 0, 1)
  const height = nodeHeight(node)

  function handleHeaderPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    // Don't start a drag when interacting with port dots or buttons.
    if ((event.target as HTMLElement).closest("[data-port]")) return
    dragRef.current = {
      pointerId: event.pointerId,
      dx: event.clientX - node.position.x,
      dy: event.clientY - node.position.y,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect()
  }

  function handleHeaderPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    onMove({ x: event.clientX - drag.dx, y: event.clientY - drag.dy })
  }

  function handleHeaderPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      setDragging(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Node ${node.label} (${def?.label ?? node.type})${
        peers.length > 0 ? ` — also viewed by ${peers.map((peer) => peer.name).join(", ")}` : ""
      }`}
      aria-pressed={selected}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "bg-card text-card-foreground absolute rounded-lg border shadow-sm transition-shadow outline-none select-none",
        "focus-visible:ring-ring focus-visible:ring-2",
        selected ? "border-primary ring-primary/40 ring-2" : "border-border",
        hasError && "border-destructive/70",
        !hasError && hasWarning && "border-amber-500/70",
        dragging && "cursor-grabbing opacity-90",
      )}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: NODE_WIDTH,
        height,
      }}
    >
      {/* Header — drag handle */}
      <div
        className={cn(
          "border-border/60 flex h-[42px] cursor-grab items-center gap-2 rounded-t-lg border-b px-3",
          dragging && "cursor-grabbing",
        )}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            status === "success" && "bg-emerald-400",
            status === "error" && "bg-red-400",
            status === "running" && "animate-pulse bg-sky-400",
            status === "skipped" && "bg-zinc-500",
            (!status || status === "pending") && "bg-zinc-400",
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</span>
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
          {def?.category ?? node.type}
        </span>
      </div>

      {/* Port rows */}
      <div className="relative" style={{ height: height - NODE_HEADER_HEIGHT }}>
        {Array.from({ length: rows }, (_, i) => {
          const input = def?.inputs[i]
          const output = def?.outputs[i]
          const top = i * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2
          return (
            <div
              key={i}
              className="absolute inset-x-0"
              style={{ top: top - PORT_ROW_HEIGHT / 2, height: PORT_ROW_HEIGHT }}
            >
              {input ? (
                <>
                  <button
                    type="button"
                    data-port
                    data-port-node={node.id}
                    data-port-id={input.id}
                    data-port-dir="in"
                    aria-label={`${node.label} input ${input.label ?? input.id}`}
                    className="bg-card absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400/80"
                    style={{
                      left: -PORT_DOT_SIZE / 2,
                      width: PORT_DOT_SIZE,
                      height: PORT_DOT_SIZE,
                    }}
                  />
                  <span className="text-muted-foreground absolute top-1/2 left-2 -translate-y-1/2 text-[10px]">
                    {input.label ?? input.id}
                  </span>
                </>
              ) : null}
              {output ? (
                <>
                  <button
                    type="button"
                    data-port
                    data-port-node={node.id}
                    data-port-id={output.id}
                    data-port-dir="out"
                    aria-label={`${node.label} output ${output.label ?? output.id} — drag to connect`}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      onStartConnection(node.id, output.id)
                    }}
                    className="border-primary bg-card hover:bg-primary/20 absolute top-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2"
                    style={{
                      left: NODE_WIDTH - PORT_DOT_SIZE / 2,
                      width: PORT_DOT_SIZE,
                      height: PORT_DOT_SIZE,
                    }}
                  />
                  <span className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-[10px]">
                    {output.label ?? output.id}
                  </span>
                </>
              ) : null}
            </div>
          )
        })}
      </div>

      {status ? (
        <span
          className={cn(
            "border-card pointer-events-none absolute -top-1.5 -right-1.5 rounded-full border-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase",
            status === "success" && "bg-emerald-500/90 text-white",
            status === "error" && "bg-red-500/90 text-white",
            status === "running" && "bg-sky-500/90 text-white",
            status === "skipped" && "bg-zinc-600/90 text-white",
            status === "pending" && "bg-zinc-500/90 text-white",
          )}
        >
          {status}
        </span>
      ) : null}

      {/* Collaborator presence: one pill per peer focused on this node. */}
      {peers.length > 0 ? (
        <span className="pointer-events-none absolute -bottom-6 left-1/2 flex -translate-x-1/2 gap-1">
          {peers.map((peer) => (
            <span
              key={peer.name}
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap text-white shadow-sm"
              style={{ backgroundColor: peer.color }}
            >
              <span className="size-1.5 rounded-full bg-white/80" aria-hidden="true" />
              {peer.name}
            </span>
          ))}
        </span>
      ) : null}

      {commentCount > 0 ? (
        <span
          className="border-card pointer-events-none absolute -right-1.5 -bottom-1.5 flex items-center gap-0.5 rounded-full border-2 bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white"
          aria-label={`${commentCount} comment${commentCount === 1 ? "" : "s"}`}
        >
          <MessageSquare className="size-2.5" aria-hidden="true" />
          {commentCount}
        </span>
      ) : null}
    </div>
  )
}

export function GraphCanvas({
  graph,
  selectedNodeId,
  selectedEdgeId = null,
  statuses,
  errorNodeIds,
  warningNodeIds,
  peerSelections,
  commentCounts,
  onSelectNode,
  onSelectEdge,
  onMoveNode,
  onConnectAttempt,
  onAddNodeAt,
}: GraphCanvasProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<PendingConnection | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [hoverPortKey, setHoverPortKey] = useState<string | null>(null)
  const size = canvasSize(graph.nodes)

  const pendingRef = useRef(pending)
  pendingRef.current = pending

  const finishConnection = useCallback(
    (clientX: number, clientY: number) => {
      const current = pendingRef.current
      setPending(null)
      setHoverPortKey(null)
      if (!current || !innerRef.current) return
      const hit = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-port-dir='in']")
      if (!hit) return
      const conn: GraphConnection = {
        sourceNodeId: current.sourceNodeId,
        sourcePort: current.sourcePort,
        targetNodeId: hit.dataset.portNode!,
        targetPort: hit.dataset.portId!,
      }
      const result = onConnectAttempt(conn)
      if (!result.ok) setConnectError(result.reason)
    },
    [onConnectAttempt],
  )

  const pendingActive = pending !== null
  useEffect(() => {
    if (!pendingRef.current) return
    function onMove(event: PointerEvent) {
      if (!innerRef.current) return
      const cursor = toLocalPoint(innerRef.current, event.clientX, event.clientY)
      setPending((current) => (current ? { ...current, cursor } : current))
      const hit = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-port]")
      setHoverPortKey(
        hit?.dataset.portDir === "in" ? `${hit.dataset.portNode}:${hit.dataset.portId}` : null,
      )
    }
    function onUp(event: PointerEvent) {
      finishConnection(event.clientX, event.clientY)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPending(null)
        setHoverPortKey(null)
      }
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("keydown", onKey)
    }
  }, [pendingActive, finishConnection])

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const type = event.dataTransfer.getData("application/x-automation-node")
    if (!type || !innerRef.current) return
    const rect = innerRef.current.getBoundingClientRect()
    onAddNodeAt(type, {
      x: event.clientX - rect.left - NODE_WIDTH / 2,
      y: event.clientY - rect.top - 24,
    })
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const pendingSource = pending ? nodeById.get(pending.sourceNodeId) : undefined
  const pendingFrom =
    pending && pendingSource ? portAnchor(pendingSource, pending.sourcePort, "out") : null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="border-border min-h-0 flex-1 overflow-auto rounded-lg border bg-[radial-gradient(circle_at_1px_1px,rgba(128,128,128,0.18)_1px,transparent_0)] [background-size:22px_22px]"
        onClick={() => {
          onSelectNode(null)
          onSelectEdge(null)
        }}
      >
        <div
          ref={innerRef}
          className="relative"
          style={{ width: size.width, height: size.height }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Edges */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={size.width}
            height={size.height}
            aria-hidden="true"
          >
            {graph.edges.map((edge: GraphEdge) => {
              const source = nodeById.get(edge.sourceNodeId)
              const target = nodeById.get(edge.targetNodeId)
              if (!source || !target) return null
              const from = portAnchor(source, edge.sourcePort, "out")
              const to = portAnchor(target, edge.targetPort, "in")
              const selected = edge.id === selectedEdgeId
              return (
                <path
                  key={edge.id}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={selected ? "var(--ui-primary, #c8f083)" : "rgba(148,163,184,0.55)"}
                  strokeWidth={selected ? 2.5 : 1.5}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectEdge(edge.id)
                  }}
                />
              )
            })}
            {pending && pendingFrom ? (
              <path
                d={edgePath(pendingFrom, pending.cursor)}
                fill="none"
                stroke={hoverPortKey ? "var(--ui-primary, #34d399)" : "var(--ui-primary, #c8f083)"}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            ) : null}
          </svg>

          {/* Nodes */}
          {graph.nodes.map((node) => (
            <div
              key={node.id}
              onClick={(event) => {
                event.stopPropagation()
                onSelectNode(node.id)
              }}
            >
              <CanvasNode
                node={node}
                selected={node.id === selectedNodeId}
                status={statuses?.[node.id]}
                hasError={errorNodeIds?.has(node.id) ?? false}
                hasWarning={warningNodeIds?.has(node.id) ?? false}
                peers={peerSelections?.get(node.id)}
                commentCount={commentCounts?.[node.id] ?? 0}
                onSelect={() => onSelectNode(node.id)}
                onMove={(position) => onMoveNode(node.id, position)}
                onStartConnection={(nodeId, portId) => {
                  setConnectError(null)
                  setPending({
                    sourceNodeId: nodeId,
                    sourcePort: portId,
                    cursor: portAnchor(node, portId, "out"),
                  })
                }}
              />
            </div>
          ))}

          {graph.nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="border-border text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed px-8 py-10 text-center">
                <GitBranch className="size-8 opacity-50" aria-hidden="true" />
                <p className="text-sm font-medium">Empty canvas</p>
                <p className="max-w-xs text-xs">
                  Add a node from the palette on the left, or drag a node type onto the canvas.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Connection status bar */}
      <div
        className="text-muted-foreground flex h-8 items-center gap-2 px-1 text-xs"
        aria-live="polite"
      >
        {pending ? (
          <span>
            Drag from the output port to an input port ·{" "}
            <kbd className="border-border rounded border px-1">Esc</kbd> to cancel
          </span>
        ) : connectError ? (
          <span className="text-destructive flex items-center gap-1.5" role="alert">
            {connectError}
            <button
              type="button"
              className="hover:bg-muted rounded p-0.5"
              aria-label="Dismiss connection error"
              onClick={() => setConnectError(null)}
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <span>Drag from an output port (right) to an input port (left) to connect nodes.</span>
        )}
      </div>
    </div>
  )
}
