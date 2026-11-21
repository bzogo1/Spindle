"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { IntegrationConnectionCounter } from "@/components/site/integration-connection-counter"

type NodeStatus = "connected" | "degraded" | "offline"

/** Human-readable labels for the connection status shown in node tooltips. */
const CONNECTION_STATUS_LABELS: Record<NodeStatus, string> = {
  connected: "Connected",
  degraded: "Degraded",
  offline: "Offline",
}

type NodeSpec = {
  id: string
  orb: string
  name: string
  /** Tool version shown in the node tooltip (e.g. "v4.4", "2025.09"). */
  version?: string
  /** Live connection state rendered as the colored dot on the node orb. */
  connectionStatus: NodeStatus
  size: number
  small?: boolean
  accent?: boolean
  /** Angle in degrees on the ellipse (0 = right, -90 = top; y axis points down). */
  angle: number
  /** Radial multiplier — values > 1 place the node outside the main ring. */
  radius?: number
}

const NODES: NodeSpec[] = [
  {
    id: "jupyterlab",
    orb: "JL",
    name: "JupyterLab",
    version: "v4.4",
    connectionStatus: "connected",
    size: 76,
    angle: 180,
    radius: 0.92,
  },
  {
    id: "rstudio",
    orb: "R",
    name: "RStudio",
    version: "2025.09",
    connectionStatus: "degraded",
    size: 76,
    angle: 0,
    radius: 0.92,
  },
  {
    id: "vscode",
    orb: "VS",
    name: "VS Code",
    version: "v1.105",
    connectionStatus: "connected",
    size: 68,
    angle: -120,
    radius: 1,
  },
  {
    id: "quarto",
    orb: "Q",
    name: "Quarto",
    version: "v1.8",
    connectionStatus: "offline",
    size: 68,
    angle: -60,
    radius: 1,
  },
  {
    id: "csv-parquet",
    orb: "CSV",
    name: "CSV / Parquet",
    version: "Parquet 2.0",
    connectionStatus: "connected",
    size: 68,
    angle: 120,
    radius: 1,
  },
  {
    id: "netcdf",
    orb: "NC",
    name: "NetCDF",
    version: "v4.9",
    connectionStatus: "degraded",
    size: 68,
    angle: 60,
    radius: 1,
  },
  {
    id: "zotero",
    orb: "Z",
    name: "Zotero",
    version: "v7.1",
    connectionStatus: "connected",
    size: 50,
    small: true,
    angle: 180,
    radius: 1.24,
  },
  {
    id: "searxng",
    orb: "SX",
    name: "SearXNG",
    version: "2025.10",
    connectionStatus: "connected",
    size: 50,
    small: true,
    accent: true,
    angle: 0,
    radius: 1.24,
  },
]

const HUB_ID = "spindle"
const HUB_RADIUS = 50
/** Extra room around each orb for its name label and breathing scale. */
const LABEL_ROOM = 18
/** Orbs render ~1.7x larger in fullscreen (see styles.css). */
const FULLSCREEN_SCALE = 1.7

/** Fallback canvas matching the diagram's intrinsic 960/360 aspect ratio. */
const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 360

type Point = { x: number; y: number }
type Edge = { a: string; b: string; from: Point; to: Point; flow: boolean }
type TracePath = { nodes: string[]; edgeIdx: Set<number> }

const NODE_NAMES = new Map<string, string>([
  [HUB_ID, "Spindle"],
  ...NODES.map((n): [string, string] => [n.id, n.name]),
])

/**
 * Lightweight deterministic force relaxation. Each node is anchored to a point
 * on an ellipse around the hub (keeps the constellation shape at any size) and
 * pairwise repulsion pushes overlapping nodes apart. Runs synchronously — 8
 * nodes, a few hundred iterations — whenever the container size changes.
 */
function computeLayout(width: number, height: number, scale = 1): Point[] {
  const cx = width / 2
  const cy = height / 2
  const rx = Math.max(90, width * 0.4)
  const ry = Math.max(70, height * 0.36)

  const anchors: Point[] = NODES.map((node) => {
    const rad = (node.angle * Math.PI) / 180
    const r = node.radius ?? 1
    return { x: cx + Math.cos(rad) * rx * r, y: cy + Math.sin(rad) * ry * r }
  })

  const positions = anchors.map((p) => ({ ...p }))
  const radii = NODES.map((n) => (n.size / 2 + LABEL_ROOM) * scale)

  const clamp = (p: Point, i: number) => {
    const mx = radii[i] + 6
    const my = radii[i] + 30 * scale // room for the name under the orb
    p.x = Math.min(Math.max(p.x, mx), Math.max(mx, width - mx))
    p.y = Math.min(Math.max(p.y, my), Math.max(my, height - my))
  }

  // The hub sits at the center and never moves; satellites get pushed away from it.
  const all: Point[] = [...positions, { x: cx, y: cy }]
  const allRadii = [...radii, HUB_RADIUS * scale]

  for (let iter = 0; iter < 260; iter++) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) {
          dx = (i - j) * 0.37
          dy = (i + j) * 0.53
          d = Math.hypot(dx, dy)
        }
        const minDist = allRadii[i] + allRadii[j] + 8
        if (d < minDist) {
          const push = ((minDist - d) / d) * 0.5
          const fx = dx * push
          const fy = dy * push
          if (j < positions.length) {
            b.x -= fx
            b.y -= fy
          }
          if (i < positions.length) {
            a.x += fx
            a.y += fy
          }
        }
      }
    }
    // Spring back toward the ellipse anchor so the layout keeps its shape.
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]
      p.x += (anchors[i].x - p.x) * 0.04
      p.y += (anchors[i].y - p.y) * 0.04
      clamp(p, i)
    }
  }

  return positions
}

const ARROW_DIRECTIONS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/**
 * Breadth-first shortest path over the wire graph. Returns the ordered node
 * ids plus the indices of the edges that make up the path, or null when the
 * destination can't be reached.
 */
function findTracePath(edges: Edge[], from: string, to: string): TracePath | null {
  const adjacency = new Map<string, { to: string; edge: number }[]>()
  const link = (a: string, b: string, edge: number) => {
    const list = adjacency.get(a)
    if (list) list.push({ to: b, edge })
    else adjacency.set(a, [{ to: b, edge }])
  }
  edges.forEach((edge, i) => {
    link(edge.a, edge.b, i)
    link(edge.b, edge.a, i)
  })

  const previous = new Map<string, { from: string; edge: number }>()
  const queue = [from]
  const seen = new Set([from])
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === to) break
    for (const { to: next, edge } of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      previous.set(next, { from: current, edge })
      queue.push(next)
    }
  }
  if (!seen.has(to)) return null

  const nodes = [to]
  const edgeIdx = new Set<number>()
  let cursor = to
  while (cursor !== from) {
    const step = previous.get(cursor)
    if (!step) return null
    edgeIdx.add(step.edge)
    nodes.push(step.from)
    cursor = step.from
  }
  nodes.reverse()
  return { nodes, edgeIdx }
}

/**
 * Integrations "network" diagram on the marketing homepage: Spindle as a
 * central hub wired to eight tools. Node positions are computed from the
 * measured container size (force-relaxed ellipse layout) and recalculated on
 * resize, so the constellation never overlaps at any viewport width.
 *
 * Trace-a-path mode: click (or focus + Enter/Space on) any two nodes — hub
 * included — and the shortest wire path between them is highlighted while the
 * rest of the web dims. Clicking the start node again, the destination, or
 * pressing Escape clears the trace.
 */
export function IntegrationsNetwork() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hubRef = useRef<HTMLButtonElement>(null)
  const nodeRefs = useRef<Array<HTMLLIElement | null>>([])
  const [showLabels, setShowLabels] = useState(true)
  const [paused, setPaused] = useState(false)
  const [query, setQuery] = useState("")
  const [size, setSize] = useState<{ width: number; height: number; scale: number } | null>(null)
  const [traceStart, setTraceStart] = useState<string | null>(null)
  const [traceEnd, setTraceEnd] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === scrollRef.current)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const network = el.querySelector<HTMLElement>(".network")
      const rect = (network ?? el).getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      // In fullscreen the orbs render ~1.7x larger — spread nodes out to match.
      const scale = el.matches(":fullscreen") ? FULLSCREEN_SCALE : 1
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height), scale })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.querySelector(".network")) observer.observe(el.querySelector(".network") as Element)
    document.addEventListener("fullscreenchange", measure)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      document.removeEventListener("fullscreenchange", measure)
      window.removeEventListener("resize", measure)
    }
  }, [])

  const width = size?.width ?? DEFAULT_WIDTH
  const height = size?.height ?? DEFAULT_HEIGHT
  const scale = size?.scale ?? 1

  const { positions, edges } = useMemo(() => {
    const pos = computeLayout(width, height, scale)
    const hub: Point = { x: width / 2, y: height / 2 }
    // Every tool links to the hub.
    const result: Edge[] = pos.map((to, i) => ({
      a: HUB_ID,
      b: NODES[i].id,
      from: hub,
      to,
      flow: true,
    }))
    // Each small outer node also links through to its nearest main-ring node.
    NODES.forEach((node, i) => {
      if (!node.small) return
      let best = -1
      let bestD = Infinity
      pos.forEach((p, j) => {
        if (NODES[j].small) return
        const d = Math.hypot(p.x - pos[i].x, p.y - pos[i].y)
        if (d < bestD) {
          bestD = d
          best = j
        }
      })
      if (best >= 0) {
        result.push({ a: NODES[best].id, b: node.id, from: pos[best], to: pos[i], flow: true })
      }
    })
    return { positions: pos, edges: result }
  }, [width, height, scale])

  const path = useMemo(
    () =>
      traceStart && traceEnd && traceStart !== traceEnd
        ? findTracePath(edges, traceStart, traceEnd)
        : null,
    [edges, traceStart, traceEnd],
  )
  const pathNodes = useMemo(() => new Set(path?.nodes ?? []), [path])
  const tracing = traceStart !== null || traceEnd !== null

  // Search-node: case-insensitive match on tool name/orb dims the rest.
  const normalizedQuery = query.trim().toLowerCase()
  const searching = normalizedQuery.length > 0
  const nodeMatches = useMemo(
    () =>
      NODES.map(
        (node) =>
          !searching ||
          node.name.toLowerCase().includes(normalizedQuery) ||
          node.orb.toLowerCase().includes(normalizedQuery),
      ),
    [searching, normalizedQuery],
  )
  const matchCount = nodeMatches.filter(Boolean).length
  const matchingIds = useMemo(
    () => new Set(NODES.filter((_, i) => nodeMatches[i]).map((node) => node.id)),
    [nodeMatches],
  )
  const edgeDimmed = (edge: Edge) =>
    searching && !matchingIds.has(edge.a) && !matchingIds.has(edge.b)

  const selectNode = (id: string) => {
    if (id === traceStart) {
      // Clicking the start node again cancels the whole trace.
      setTraceStart(null)
      setTraceEnd(null)
      return
    }
    if (id === traceEnd) {
      setTraceEnd(null)
      return
    }
    if (!traceStart) setTraceStart(id)
    else if (!traceEnd) setTraceEnd(id)
    else {
      // A trace is already complete — a fresh click starts a new one.
      setTraceStart(id)
      setTraceEnd(null)
    }
  }

  const clearTrace = () => {
    setTraceStart(null)
    setTraceEnd(null)
  }

  const nodeKeyDown = (id: string) => (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      selectNode(id)
    }
  }

  const networkKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      clearTrace()
      return
    }
    const direction = ARROW_DIRECTIONS[event.key]
    if (!direction) return
    event.preventDefault()

    // Focusable items in layout space: the eight tool nodes plus the hub.
    const items: { el: HTMLElement | null; x: number; y: number }[] = [
      ...NODES.map((_, i) => ({
        el: nodeRefs.current[i],
        x: positions[i].x,
        y: positions[i].y,
      })),
      { el: hubRef.current, x: width / 2, y: height / 2 },
    ]
    const current = items.findIndex(({ el }) => el === document.activeElement)
    if (current === -1) {
      // Focus is on the diagram container itself — enter at the first node.
      items[0]?.el?.focus()
      return
    }
    const from = items[current]
    // Pick the item most aligned with the arrow direction, preferring the
    // closest one; fall back to sequential movement when nothing qualifies.
    let bestIndex = -1
    let bestScore = -Infinity
    items.forEach((item, index) => {
      if (index === current || !item.el) return
      const nx = item.x - from.x
      const ny = item.y - from.y
      const distance = Math.hypot(nx, ny)
      if (distance === 0) return
      const alignment = (nx * direction.x + ny * direction.y) / distance
      if (alignment <= 0.2) return
      const score = alignment / distance
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    })
    const target = bestIndex === -1 ? (current + 1) % items.length : bestIndex
    items[target]?.el?.focus()
  }

  const nodeTraceClass = (id: string, base: string) => {
    if (!tracing) return base
    const classes = [base]
    if (pathNodes.has(id)) classes.push("node--trace-on")
    if (id === traceStart) classes.push("node--trace-start")
    if (id === traceEnd) classes.push("node--trace-end")
    if (path && !pathNodes.has(id)) classes.push("node--trace-off")
    return classes.join(" ")
  }

  const hubTraceClass = () => {
    if (!tracing) return "network-hub"
    const classes = ["network-hub"]
    if (pathNodes.has(HUB_ID)) classes.push("network-hub--trace-on")
    if (traceStart === HUB_ID) classes.push("network-hub--trace-start")
    if (traceEnd === HUB_ID) classes.push("network-hub--trace-end")
    if (path && !pathNodes.has(HUB_ID)) classes.push("network-hub--trace-off")
    return classes.join(" ")
  }

  const wireTraceClass = (edgeIndex: number, base: string) => {
    if (!tracing) return base
    if (path?.edgeIdx.has(edgeIndex)) return `${base} wire--trace-on`
    if (path) return `${base} wire--trace-off`
    return base
  }

  const nodeName = (id: string) => NODE_NAMES.get(id) ?? id
  const statusText = !traceStart
    ? "Click two nodes to trace a path"
    : !traceEnd
      ? `${nodeName(traceStart)} selected — click a destination`
      : path
        ? `Path: ${path.nodes.map(nodeName).join(" → ")} (${path.nodes.length - 1} hop${path.nodes.length === 2 ? "" : "s"})`
        : `${nodeName(traceStart)} → ${nodeName(traceEnd)}: no path found`

  /** Wraps the first occurrence of the query in the tool name in a <mark>. */
  const renderNodeName = (name: string) => {
    if (!searching) return name
    const index = name.toLowerCase().indexOf(normalizedQuery)
    if (index === -1) return name
    return (
      <>
        {name.slice(0, index)}
        <mark className="node-name-mark">{name.slice(index, index + normalizedQuery.length)}</mark>
        {name.slice(index + normalizedQuery.length)}
      </>
    )
  }

  /**
   * Reset the diagram's view: clears any pan/zoom transform applied to the
   * canvas or scroll container and leaves fullscreen, restoring the default
   * centered, fitted layout. The layout itself is derived from the measured
   * size, so once the transform is gone the constellation re-centers on its
   * own (the fullscreenchange listener re-measures and re-spreads nodes).
   */
  const resetView = () => {
    const root = scrollRef.current
    if (!root) return
    const PAN_ZOOM_VARS = ["--pan-x", "--pan-y", "--zoom", "--view-scale", "--tx", "--ty"]
    for (const el of [root, root.querySelector<HTMLElement>(".network")]) {
      if (!el) continue
      el.style.transform = ""
      el.style.translate = ""
      el.style.scale = ""
      for (const prop of PAN_ZOOM_VARS) el.style.removeProperty(prop)
      el.classList.remove("network--panned", "network--zoomed", "network--dragging")
    }
    if (document.fullscreenElement === root || root.matches(":fullscreen")) {
      void document.exitFullscreen?.().catch(() => {})
    }
  }

  /** Toggle fullscreen on the diagram's scroll container (`.network-scroll`). */
  const toggleFullscreen = () => {
    const root = scrollRef.current
    if (!root) return
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {})
    } else {
      void root.requestFullscreen?.().catch(() => {})
    }
  }

  return (
    <div className="network-scroll" ref={scrollRef}>
      <div className="network-toolbar">
        <label className="network-search">
          <svg className="icon icon--xs" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools…"
            aria-label="Search tools in the diagram"
            autoComplete="off"
          />
        </label>
        {searching ? (
          <span className="network-search-count" aria-live="polite">
            {matchCount} of {NODES.length} tools
          </span>
        ) : null}
        <p className="network-trace-status" aria-live="polite">
          {statusText}
        </p>
        <IntegrationConnectionCounter toolCount={NODES.length} />
        {tracing ? (
          <button type="button" className="network-labels-toggle" onClick={clearTrace}>
            Clear path
          </button>
        ) : null}
        <button
          type="button"
          className="network-labels-toggle"
          aria-pressed={showLabels}
          onClick={() => setShowLabels((value) => !value)}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href="#i-eye" />
          </svg>
          {showLabels ? "Hide labels" : "Show labels"}
        </button>
        <button
          type="button"
          className="network-labels-toggle"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href={paused ? "#i-play" : "#i-pause"} />
          </svg>
          {paused ? "Resume animations" : "Pause animations"}
        </button>
        <button
          type="button"
          className="network-labels-toggle network-reset-view"
          aria-label="Reset view"
          title="Reset view"
          onClick={resetView}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href="#i-refresh" />
          </svg>
          Reset view
        </button>
        <button
          type="button"
          className="network-labels-toggle network-fullscreen"
          aria-pressed={isFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Expand diagram"}
          title={isFullscreen ? "Exit fullscreen" : "Expand diagram"}
          onClick={toggleFullscreen}
        >
          <svg
            className="icon icon--xs network-fullscreen-icon network-fullscreen-icon--enter"
            aria-hidden="true"
          >
            <use href="#i-expand" />
          </svg>
          <svg
            className="icon icon--xs network-fullscreen-icon network-fullscreen-icon--exit"
            aria-hidden="true"
          >
            <use href="#i-compress" />
          </svg>
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
      <div
        className={`network${showLabels ? "" : " network--labels-hidden"}${paused ? " network--paused" : ""}${searching ? " network--searching" : ""}`}
        role="group"
        tabIndex={0}
        aria-label="Spindle connected to JupyterLab, RStudio, VS Code, Quarto, CSV and Parquet, NetCDF, Zotero, and SearXNG. Click two nodes to trace the path between them. Use arrow keys to move between nodes."
        onKeyDown={networkKeyDown}
      >
        <svg
          className="network-lines"
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          <line className="network-guide" x1="0" y1={height / 2} x2={width} y2={height / 2} />
          <line
            className="network-guide network-guide--soft"
            x1="0"
            y1={height * 0.18}
            x2={width}
            y2={height * 0.18}
          />
          <line
            className="network-guide network-guide--soft"
            x1="0"
            y1={height * 0.82}
            x2={width}
            y2={height * 0.82}
          />
          <line
            className="network-guide network-guide--soft"
            x1={width / 2}
            y1="0"
            x2={width / 2}
            y2={height}
          />
          <g className="network-wires">
            {edges.map((edge, i) => {
              const d = `M${edge.from.x} ${edge.from.y} L${edge.to.x} ${edge.to.y}`
              const length = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y)
              const delay = -(((i * 0.9 + 0.4) % 4.4) + 4.4) % 4.4
              const duration = 4.2 + ((i * 7) % 10) / 10
              return (
                <g key={i} className={edgeDimmed(edge) ? "wire-group--dim" : undefined}>
                  <path className={wireTraceClass(i, "wire")} d={d} />
                  <path
                    className={wireTraceClass(i, "wire-flow")}
                    style={
                      {
                        "--flow-length": length.toFixed(2),
                        "--flow-delay": `${delay.toFixed(2)}s`,
                        "--flow-duration": `${duration.toFixed(1)}s`,
                      } as CSSProperties
                    }
                    d={d}
                  />
                </g>
              )
            })}
          </g>
        </svg>
        <button
          type="button"
          ref={hubRef}
          className={hubTraceClass()}
          aria-label="Spindle hub — click to trace a path"
          onClick={() => selectNode(HUB_ID)}
        >
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle className="hub-pulse" cx="16" cy="16" r="12" />
            <circle className="hub-pulse hub-pulse--late" cx="16" cy="16" r="12" />
            <g className="hub-orbit">
              <circle cx="16" cy="4" r="1.7" fill="currentColor" />
            </g>
            <path
              d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="8" cy="22" r="2.2" fill="currentColor" />
          </svg>
        </button>
        <ul className="network-nodes">
          {NODES.map((node, i) => {
            const p = positions[i]
            const matchClass = searching ? (nodeMatches[i] ? " node--match" : " node--dim") : ""
            const base = node.small
              ? node.accent
                ? `node node--${node.id} node--small node--accent${matchClass}`
                : `node node--${node.id} node--small${matchClass}`
                : `node node--${node.id}${matchClass}`
            return (
              <Tooltip key={node.id}>
                <TooltipTrigger asChild>
                  <li
                    ref={(el) => {
                      nodeRefs.current[i] = el
                    }}
                    className={nodeTraceClass(node.id, base)}
                    style={
                      {
                        "--x": `${p.x}px`,
                        "--y": `${p.y}px`,
                      } as CSSProperties
                    }
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.name} — click to trace a path`}
                    onClick={() => selectNode(node.id)}
                    onKeyDown={nodeKeyDown(node.id)}
                  >
                    <span className="node-orb">
                      {node.orb}
                      <span
                        className={`node-status node-status--${node.connectionStatus}`}
                        role="img"
                        aria-label={`${node.name} connection status: ${node.connectionStatus}`}
                      />
                    </span>
                    <span className="node-name">{renderNodeName(node.name)}</span>
                  </li>
                </TooltipTrigger>
                <TooltipContent className="ui-tooltip">
                  {node.name} · {node.version} · {CONNECTION_STATUS_LABELS[node.connectionStatus]}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/**
 * Toggle for the integrations network diagram's tool-name labels. Kept for
 * callers that render it as a sibling of the diagram; it flips the
 * `network--labels-hidden` class on the nearest `.network` element.
 */
export function IntegrationsLabelsToggle() {
  const ref = useRef<HTMLButtonElement>(null)
  const [labelsHidden, setLabelsHidden] = useState(false)

  // Keep aria-pressed in sync if the class is changed elsewhere.
  useEffect(() => {
    const network = ref.current
      ?.closest(".network-scroll")
      ?.querySelector<HTMLElement>(".network")
    if (!network) return
    setLabelsHidden(network.classList.contains("network--labels-hidden"))
    const observer = new MutationObserver(() => {
      setLabelsHidden(network.classList.contains("network--labels-hidden"))
    })
    observer.observe(network, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="network-toolbar">
      <button
        ref={ref}
        type="button"
        className="network-labels-toggle"
        aria-pressed={labelsHidden}
        onClick={() => {
          const network = ref.current
            ?.closest(".network-scroll")
            ?.querySelector<HTMLElement>(".network")
          if (!network) return
          const hidden = network.classList.toggle("network--labels-hidden")
          setLabelsHidden(hidden)
        }}
      >
        <svg className="icon icon--xs" aria-hidden="true">
          <use href="#i-eye" />
        </svg>
        {labelsHidden ? "Show labels" : "Hide labels"}
      </button>
    </div>
  )
}
