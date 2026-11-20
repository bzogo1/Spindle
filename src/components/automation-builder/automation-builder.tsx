"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ClipboardCopy, Workflow } from "lucide-react"

import {
  addEdgeToGraph,
  addNodeToGraph,
  canConnect,
  createEmptyGraph,
  deleteGraphVersion,
  generateCode,
  recordAutomationRun,
  recordGraphVersion,
  removeEdgeFromGraph,
  removeNodeFromGraph,
  serializeGraph,
  updateGraphVersionComment,
  updateNode,
  useGraphVersions,
  validateGraph,
  type AutomationGraph,
  type AutomationTemplate,
  type ConnectionResult,
  type DryRunReport,
  type GraphConnection,
  type GraphIssue,
  type NodeRunStatus,
  addNodeComment,
  deleteNodeComment,
  useAutomationPresence,
  useNodeComments,
} from "@/lib/automation-graph"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { NODE_WIDTH } from "./layout"
import { GraphCanvas } from "./graph-canvas"
import { NodePalette } from "./node-palette"
import { InspectorPanel } from "./inspector-panel"
import { ValidationPanel } from "./validation-panel"
import { ConnectionsPanel } from "./connections-panel"
import { DryRunPanel } from "./dry-run-panel"
import { TemplatePicker } from "./template-picker"
import { VersionHistoryPanel } from "./version-history-panel"
import { PresenceBar } from "./presence-bar"
import { CommentsPanel } from "./comments-panel"
import { AssistPanel } from "./assist-panel"
import { MarketplacePanel } from "./marketplace-panel"
import { GraphTransferControls } from "./graph-transfer-controls"
import { TestRunnerPanel } from "./test-runner-panel"
import { MonitoringPanel } from "./monitoring-panel"
import { DebuggerPanel } from "./debugger-panel"
import { ProfilerPanel } from "./profiler-panel"
import { OptimizationPanel } from "./optimization-panel"
import { SecurityPanel } from "./security-panel"
import { CompliancePanel } from "./compliance-panel"

export interface AutomationBuilderProps {
  /**
   * Controlled graph. When provided, the builder is fully controlled and
   * `onGraphChange` must be used to persist mutations.
   */
  graph?: AutomationGraph
  /** Initial graph for uncontrolled usage. */
  defaultGraph?: AutomationGraph
  onGraphChange?: (graph: AutomationGraph) => void
  /** Optional controlled dry-run report. */
  report?: DryRunReport | null
  onReportChange?: (report: DryRunReport | null) => void
  /**
   * localStorage scope for version history. Defaults to the graph id; pass a
   * stable key when the parent regenerates graph ids (e.g. the studio dialog
   * rebuilds a starter graph on every open).
   */
  historyScope?: string
  className?: string
}

let nodeCounter = 0

export function AutomationBuilder({
  graph: controlledGraph,
  defaultGraph,
  onGraphChange,
  report: controlledReport,
  onReportChange,
  historyScope: historyScopeProp,
  className,
}: AutomationBuilderProps) {
  const [internalGraph, setInternalGraph] = useState<AutomationGraph>(
    () => defaultGraph ?? createEmptyGraph(),
  )
  const graph = controlledGraph ?? internalGraph
  const [internalReport, setInternalReport] = useState<DryRunReport | null>(null)
  const report = controlledReport !== undefined ? controlledReport : internalReport
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, NodeRunStatus>>({})
  const [copied, setCopied] = useState<"dsl" | "code" | null>(null)

  // Version history is scoped per automation; default to the graph id, but
  // let parents pass a stable key when they regenerate graph objects.
  const historyScope = historyScopeProp ?? graph.id
  const versions = useGraphVersions(historyScope)

  // Collaboration: simulated + cross-tab presence and per-node comments,
  // scoped to the same key as version history.
  const nodeIds = useMemo(() => graph.nodes.map((node) => node.id), [graph.nodes])
  const { local: collaborator, peers } = useAutomationPresence(
    historyScope,
    { nodeId: selectedNodeId },
    nodeIds,
  )
  const allComments = useNodeComments(historyScope)
  const peerSelections = useMemo(() => {
    const map = new Map<string, { name: string; color: string }[]>()
    for (const peer of peers) {
      if (!peer.nodeId) continue
      const list = map.get(peer.nodeId) ?? []
      list.push({ name: peer.user.name, color: peer.user.color })
      map.set(peer.nodeId, list)
    }
    return map
  }, [peers])
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const comment of allComments) {
      counts[comment.nodeId] = (counts[comment.nodeId] ?? 0) + 1
    }
    return counts
  }, [allComments])
  const selectedComments = useMemo(
    () =>
      selectedNodeId ? allComments.filter((comment) => comment.nodeId === selectedNodeId) : [],
    [allComments, selectedNodeId],
  )
  const handleAddComment = useCallback(
    (body: string) => {
      if (!selectedNodeId) return
      addNodeComment(historyScope, { nodeId: selectedNodeId, body, author: collaborator })
    },
    [historyScope, selectedNodeId, collaborator],
  )
  const handleDeleteComment = useCallback(
    (commentId: string) => {
      deleteNodeComment(historyScope, commentId)
    },
    [historyScope],
  )
  // `commit` marks the graph dirty; the effect below records a snapshot once
  // edits settle so drags/typing collapse into a single version.
  const snapshotPending = useRef(false)

  useEffect(() => {
    if (!snapshotPending.current) return
    const timer = window.setTimeout(() => {
      snapshotPending.current = false
      recordGraphVersion(historyScope, graph)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [graph, historyScope])

  const commit = useCallback(
    (next: AutomationGraph) => {
      if (controlledGraph === undefined) setInternalGraph(next)
      onGraphChange?.(next)
      snapshotPending.current = true
      // Edits invalidate the previous dry-run trace.
      setStatuses({})
      setInternalReport(null)
      onReportChange?.(null)
    },
    [controlledGraph, onGraphChange, onReportChange],
  )

  const setReport = useCallback(
    (next: DryRunReport | null) => {
      if (controlledReport === undefined) setInternalReport(next)
      onReportChange?.(next)
      // Feed the local run log so the monitoring panel has metrics.
      if (next && next.status !== "rejected") {
        recordAutomationRun(historyScope, graph, next)
      }
    },
    [controlledReport, onReportChange, historyScope, graph],
  )

  const issues = useMemo(() => validateGraph(graph), [graph])
  const errorNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const issue of issues) {
      if (issue.severity === "error" && issue.nodeId) ids.add(issue.nodeId)
    }
    return ids
  }, [issues])
  const warningNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const issue of issues) {
      if (issue.severity === "warning" && issue.nodeId && !errorNodeIds.has(issue.nodeId)) {
        ids.add(issue.nodeId)
      }
    }
    return ids
  }, [issues, errorNodeIds])

  // Clicking a validation issue jumps the canvas selection to the offending
  // node or edge so the user can see what needs fixing.
  const handleSelectIssue = useCallback((issue: GraphIssue) => {
    if (issue.nodeId) {
      setSelectedNodeId(issue.nodeId)
      setSelectedEdgeId(null)
    } else if (issue.edgeId) {
      setSelectedEdgeId(issue.edgeId)
      setSelectedNodeId(null)
    }
  }, [])

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  )

  const addNode = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      nodeCounter += 1
      const pos = position ?? {
        x: 60 + (nodeCounter % 6) * (NODE_WIDTH + 40),
        y: 60 + (nodeCounter % 4) * 140,
      }
      commit(addNodeToGraph(graph, type, pos))
    },
    [graph, commit],
  )

  const handleConnectAttempt = useCallback(
    (conn: GraphConnection): ConnectionResult => {
      const check = canConnect(graph, conn)
      if (!check.ok) return check
      commit(addEdgeToGraph(graph, conn))
      setSelectedEdgeId(null)
      return { ok: true }
    },
    [graph, commit],
  )

  const loadTemplate = useCallback(
    (template: AutomationTemplate) => {
      // Templates produce a fresh graph (new ids); drop any stale selection.
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      commit(template.build())
    },
    [commit],
  )

  // Restoring keeps the current graph id so the history scope stays stable
  // even when `historyScope` defaults to `graph.id`.
  const restoreVersion = useCallback(
    (restored: AutomationGraph) => {
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      commit({ ...restored, id: graph.id })
    },
    [commit, graph.id],
  )

  // Imported graphs replace the canvas like templates do: fresh selection,
  // then a normal commit so history/dry-run invalidation still applies.
  const handleImportGraph = useCallback(
    (imported: AutomationGraph) => {
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      commit(imported)
    },
    [commit],
  )

  const snapshotNow = useCallback(
    (label?: string) => {
      recordGraphVersion(historyScope, graph, label)
    },
    [historyScope, graph],
  )

  const deleteVersion = useCallback(
    (versionId: string) => {
      deleteGraphVersion(historyScope, versionId)
    },
    [historyScope],
  )

  const updateVersionComment = useCallback(
    (versionId: string, comment: string) => {
      updateGraphVersionComment(historyScope, versionId, comment)
    },
    [historyScope],
  )

  const handleUpdateNode = useCallback(
    (nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => {
      commit(updateNode(graph, nodeId, patch))
    },
    [graph, commit],
  )

  async function copyText(kind: "dsl" | "code", text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — ignore silently.
    }
  }

  return (
    <section
      className={cn("flex h-full min-h-0 flex-col gap-3", className)}
      aria-label="Automation builder"
    >
      {/* Header */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-52 flex-1 gap-1.5">
          <Label htmlFor="automation-builder-name" className="text-xs">
            Automation name
          </Label>
          <Input
            id="automation-builder-name"
            value={graph.name}
            onChange={(event) => commit({ ...graph, name: event.target.value })}
            placeholder="Untitled automation"
          />
        </div>
        <p className="text-muted-foreground pb-2 text-xs" aria-live="polite">
          {graph.nodes.length} node{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length}{" "}
          connection{graph.edges.length === 1 ? "" : "s"}
          {issues.some((issue) => issue.severity === "error") ? " · has errors" : ""}
        </p>
        <TemplatePicker onLoadTemplate={loadTemplate} />
        <GraphTransferControls graph={graph} onImport={handleImportGraph} />
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              Marketplace
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Template marketplace</DialogTitle>
              <DialogDescription>
                Browse community templates — installing replaces the current canvas.
              </DialogDescription>
            </DialogHeader>
            <MarketplacePanel onInstall={loadTemplate} />
          </DialogContent>
        </Dialog>
        <PresenceBar local={collaborator} peers={peers} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyText("dsl", serializeGraph(graph))}
        >
          {copied === "dsl" ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          {copied === "dsl" ? "Copied" : "Copy DSL"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyText("code", generateCode(graph))}
        >
          {copied === "code" ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          {copied === "code" ? "Copied" : "Copy code"}
        </Button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-3">
        <NodePalette onAddNode={(type) => addNode(type)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <GraphCanvas
            graph={graph}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            statuses={statuses}
            errorNodeIds={errorNodeIds}
            warningNodeIds={warningNodeIds}
            peerSelections={peerSelections}
            commentCounts={commentCounts}
            onSelectNode={(id) => {
              setSelectedNodeId(id)
              if (id) setSelectedEdgeId(null)
            }}
            onSelectEdge={setSelectedEdgeId}
            onMoveNode={(nodeId, position) => commit(updateNode(graph, nodeId, { position }))}
            onConnectAttempt={handleConnectAttempt}
            onAddNodeAt={(type, position) => addNode(type, position)}
          />
        </div>

        {/* Sidebar */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto">
          <InspectorPanel
            node={selectedNode}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={(nodeId) => {
              commit(removeNodeFromGraph(graph, nodeId))
              setSelectedNodeId(null)
            }}
          />
          <CommentsPanel
            nodeId={selectedNodeId}
            nodeLabel={selectedNode?.label}
            comments={selectedComments}
            localAuthorId={collaborator.id}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
          />
          <ValidationPanel issues={issues} onSelectIssue={handleSelectIssue} />
          <AssistPanel
            onApply={(next) => {
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
              commit(next)
            }}
          />
          <ConnectionsPanel
            graph={graph}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
            onConnectAttempt={handleConnectAttempt}
            onRemoveEdge={(edgeId) => {
              commit(removeEdgeFromGraph(graph, edgeId))
              setSelectedEdgeId(null)
            }}
          />
          <DryRunPanel
            graph={graph}
            report={report}
            onReport={setReport}
            onStatusesChange={setStatuses}
          />
          <DebuggerPanel graph={graph} />
          <ProfilerPanel graph={graph} />
          <TestRunnerPanel graph={graph} scope={historyScope} />
          <OptimizationPanel graph={graph} onApply={commit} />
          <SecurityPanel graph={graph} />
          <CompliancePanel graph={graph} />
          <MonitoringPanel scope={historyScope} />
          <VersionHistoryPanel
            versions={versions}
            onRestore={restoreVersion}
            onSnapshot={snapshotNow}
            onDelete={deleteVersion}
            currentGraph={graph}
            onUpdateComment={updateVersionComment}
          />
        </div>
      </div>

      <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <Workflow className="size-3" aria-hidden="true" />
        Drag nodes to arrange them · drag from an output port to an input port to connect · use the
        Connections panel for keyboard access.
      </p>
    </section>
  )
}
