"use client"

/**
 * Accessible, drag-and-drop file tree.
 *
 * Features:
 * - Pointer-event based drag & drop (unified mouse + touch) with a grip
 *   handle, before/after/inside drop indicators and auto-expand on hover.
 * - Fully keyboard-operable reorder:
 *     Arrow keys        navigate / expand / collapse (standard tree nav)
 *     Alt+ArrowUp/Down  move the focused node within its parent
 *     Ctrl+X / Ctrl+V   cut node, then paste into the focused dir or after it
 *     Escape            cancel cut / pending drag
 *   Every move is announced through an `aria-live` region.
 * - ARIA `tree`/`treeitem`/`group` semantics with `aria-level`,
 *   `aria-expanded`, `aria-selected` and roving tabindex.
 *
 * The component is controlled: pass `tree` (e.g. from `useFileTree`) and an
 * `onMove` handler. `onMove` may return `{ ok: false, error }` to reject.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"

import {
  collectDirIds,
  findNode,
  findParent,
  filterVisibleItems,
  filterExpandedIds,
  nodePath,
  resolveDrop,
  siblingPosition,
  canMoveTo,
  canMutate,
  GIT_STATUS_META,
  type DropPosition,
  type FileTreeNode,
  type GitStatusProvider,
  type MoveNodeInput,
  type PermissionMap,
  type TreeFilter,
  type TreeRole,
  type TreeTag,
} from "@/lib/file-tree"

export interface FileTreeProps {
  tree: FileTreeNode
  /** Controlled expanded-id set. Omit for uncontrolled (all dirs expanded). */
  expandedIds?: ReadonlySet<string>
  onExpandedChange?: (ids: Set<string>) => void
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** Enter / double-click on a node. */
  onActivate?: (node: FileTreeNode) => void
  // ---- Multi-select -------------------------------------------------------
  /** Controlled multi-selection set. When provided it overrides internal state. */
  selectedIds?: ReadonlySet<string>
  /** Fired whenever the effective selection changes (click/keyboard). */
  onSelectionChange?: (ids: Set<string>) => void
  // ---- Decorations --------------------------------------------------------
  /** Git status badges per node (task: git decoration). */
  gitStatus?: GitStatusProvider
  /** Colored tag labels per node. */
  tagsFor?: (nodeId: string) => TreeTag[]
  isBookmarked?: (nodeId: string) => boolean
  isFavorite?: (nodeId: string) => boolean
  isRecent?: (nodeId: string) => boolean
  // ---- Filtering ----------------------------------------------------------
  /** Active annotation filter (bookmarks/recents/favorites/tags). */
  filter?: TreeFilter | null
  /** Predicate sources backing `filter`; defaults derive from the props above. */
  filterSources?: {
    isBookmarked?: (id: string) => boolean
    isFavorite?: (id: string) => boolean
    isRecent?: (id: string) => boolean
    tagIdsFor?: (id: string) => string[]
  }
  // ---- Permissions --------------------------------------------------------
  /** Local permission map (nodeId -> role). Omit for unrestricted. */
  permissions?: PermissionMap
  /** Role assumed for nodes without an explicit assignment (default "admin"). */
  defaultRole?: TreeRole
  /** Explicit read-only override (hides/disables mutating affordances). */
  readOnly?: boolean
  // ---- Chrome -------------------------------------------------------------
  /** Show the Expand all / Collapse all toolbar (default false). */
  showToolbar?: boolean
  /** Render a detail panel (e.g. diff viewer) for the selected node. */
  renderDetail?: (node: FileTreeNode | null) => ReactNode
  /**
   * Commit a move. Return `{ ok: false, error }` (or throw) to reject; the
   * tree itself is owned by the caller, so rejections just revert visually
   * on the next render.
   */
  onMove?: (
    nodeId: string,
    newParentId: string | null,
    index?: number,
  ) => void | { ok: boolean; error?: string }
  renderIcon?: (node: FileTreeNode) => ReactNode
  renderActions?: (node: FileTreeNode) => ReactNode
  ariaLabel?: string
  /** Show the keyboard-shortcut hint bar (default true). */
  showHints?: boolean
  className?: string
}

type DropTarget = { nodeId: string; position: DropPosition }

interface PendingDrag {
  nodeId: string
  pointerId: number
  startX: number
  startY: number
  started: boolean
}

const DRAG_THRESHOLD_PX = 6
const EXPAND_HOVER_MS = 600

function moveResultMessage(
  input: MoveNodeInput,
  tree: FileTreeNode,
): { ok: boolean; message: string } {
  const node = findNode(tree, input.nodeId)
  const name = node?.name ?? input.nodeId
  const dest =
    input.newParentId === null || input.newParentId === tree.id
      ? tree.name
      : (findNode(tree, input.newParentId)?.name ?? input.newParentId)
  return { ok: true, message: `Moved "${name}" to "${dest}".` }
}

export function FileTree({
  tree,
  expandedIds,
  onExpandedChange,
  selectedId = null,
  onSelect,
  onActivate,
  selectedIds,
  onSelectionChange,
  gitStatus,
  tagsFor,
  isBookmarked,
  isFavorite,
  isRecent,
  filter = null,
  filterSources,
  permissions,
  defaultRole = "admin",
  readOnly = false,
  showToolbar = false,
  renderDetail,
  onMove,
  renderIcon,
  renderActions,
  ariaLabel = "Files",
  showHints = true,
  className,
}: FileTreeProps) {
  const isControlled = expandedIds !== undefined
  const [innerExpanded, setInnerExpanded] = useState<Set<string>>(
    () => new Set(collectDirIds(tree)),
  )
  const expanded = isControlled ? expandedIds : innerExpanded

  const [focusedId, setFocusedId] = useState<string | null>(selectedId ?? tree.id)
  const [announcement, setAnnouncement] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [cutId, setCutId] = useState<string | null>(null)
  // Multi-select: internal set used unless `selectedIds` controls it.
  const [innerSelection, setInnerSelection] = useState<Set<string>>(() =>
    selectedId ? new Set([selectedId]) : new Set(),
  )
  const selection = useMemo<ReadonlySet<string>>(
    () => selectedIds ?? innerSelection,
    [selectedIds, innerSelection],
  )
  // Type-ahead buffer + last anchor for shift-range selection.
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: "", at: 0 })
  const anchorIdRef = useRef<string | null>(selectedId ?? null)

  const dragRef = useRef<PendingDrag | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const announce = useCallback((message: string) => setAnnouncement(message), [])

  const setDrop = useCallback((target: DropTarget | null) => {
    dropTargetRef.current = target
    setDropTarget(target)
  }, [])

  // Effective filter predicate sources: explicit `filterSources` win,
  // otherwise derive from the decoration props.
  const sources = useMemo(
    () => ({
      isBookmarked: filterSources?.isBookmarked ?? isBookmarked,
      isFavorite: filterSources?.isFavorite ?? isFavorite,
      isRecent: filterSources?.isRecent ?? isRecent,
      tagIdsFor:
        filterSources?.tagIdsFor ??
        (tagsFor ? (id: string) => tagsFor(id).map((tag) => tag.id) : undefined),
    }),
    [filterSources, isBookmarked, isFavorite, isRecent, tagsFor],
  )

  // When a filter is active, ancestors of every match are force-expanded so
  // matches inside collapsed dirs become visible (view-only; the persisted
  // `expanded` set is untouched).
  const autoExpanded = useMemo(
    () => filterExpandedIds(tree, filter, sources),
    [tree, filter, sources],
  )

  const isExpanded = useCallback(
    (id: string) => id === tree.id || expanded.has(id) || autoExpanded.has(id),
    [expanded, autoExpanded, tree.id],
  )

  const rows = useMemo(
    () => filterVisibleItems(tree, isExpanded, filter, sources),
    [tree, isExpanded, filter, sources],
  )

  // Ids of rows currently allowed to render (filter applied). Children of an
  // expanded dir render only when they appear in this set.
  const renderableIds = useMemo(() => new Set(rows.map((row) => row.node.id)), [rows])

  // Roving tabindex fallback: if the focused id left the visible set (e.g. its
  // parent collapsed), keep the root tabbable so the tree stays reachable.
  const effectiveFocusId = rows.some((row) => row.node.id === focusedId) ? focusedId : tree.id

  /** True when `node` may be mutated under the permission/read-only model. */
  const canEditNode = useCallback(
    (node: FileTreeNode): boolean => {
      if (readOnly) return false
      if (!permissions) return true
      return canMutate(tree, node.id, permissions, defaultRole)
    },
    [readOnly, permissions, tree, defaultRole],
  )

  const expandAll = useCallback(() => {
    const all = new Set(collectDirIds(tree))
    all.add(tree.id)
    if (isControlled) onExpandedChange?.(all)
    else setInnerExpanded(all)
    announce("Expanded all folders.")
  }, [tree, isControlled, onExpandedChange, announce])

  const collapseAll = useCallback(() => {
    // Keep the root expanded; collapse every other dir.
    const next = new Set<string>()
    if (isControlled) onExpandedChange?.(next)
    else setInnerExpanded(next)
    announce("Collapsed all folders.")
  }, [isControlled, onExpandedChange, announce])

  /** Replace the effective selection and notify. */
  const applySelection = useCallback(
    (ids: Set<string>, primaryId?: string) => {
      setInnerSelection(ids)
      onSelectionChange?.(ids)
      if (primaryId !== undefined) {
        anchorIdRef.current = primaryId
        setFocusedId(primaryId)
        onSelect?.(primaryId)
      }
    },
    [onSelectionChange, onSelect],
  )

  /** Shift-range selection: select every visible row between anchor and `id`. */
  const selectRangeTo = useCallback(
    (id: string) => {
      const anchorId = anchorIdRef.current
      const ids = new Set(selection)
      if (anchorId && anchorId !== id) {
        const a = rows.findIndex((row) => row.node.id === anchorId)
        const b = rows.findIndex((row) => row.node.id === id)
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a]
          for (let i = from; i <= to; i += 1) {
            if (rows[i].node.id !== tree.id) ids.add(rows[i].node.id)
          }
        }
      }
      ids.add(id)
      applySelection(ids, id)
    },
    [rows, selection, tree.id, applySelection],
  )

  const toggleExpand = useCallback(
    (id: string, force?: boolean) => {
      const node = findNode(tree, id)
      if (!node || node.type !== "dir") return
      const currently = isExpanded(id)
      const next = force ?? !currently
      if (next === currently) return
      const updated = new Set(expanded)
      if (next) updated.add(id)
      else updated.delete(id)
      if (isControlled) onExpandedChange?.(updated)
      else setInnerExpanded(updated)
    },
    [tree, expanded, isExpanded, isControlled, onExpandedChange],
  )

  const focusRow = useCallback((id: string) => {
    setFocusedId(id)
    const el = document.getElementById(`ft-node-${id}`)
    el?.focus()
    el?.scrollIntoView({ block: "nearest" })
  }, [])

  /** Commit a resolved move and announce the outcome. */
  const commitMove = useCallback(
    (input: MoveNodeInput) => {
      if (readOnly) {
        announce("Read-only mode: moving is disabled.")
        return false
      }
      if (
        permissions &&
        !canMoveTo(tree, input.nodeId, input.newParentId, permissions, defaultRole)
      ) {
        announce("You don't have permission to move this node there.")
        return false
      }
      if (!onMove) {
        announce("Moving is not available.")
        return false
      }
      let result: void | { ok: boolean; error?: string }
      try {
        result = onMove(input.nodeId, input.newParentId, input.index)
      } catch (error) {
        announce(error instanceof Error ? error.message : "Move failed.")
        return false
      }
      if (result && typeof result === "object" && "ok" in result && !result.ok) {
        announce(result.error ?? "Move rejected.")
        return false
      }
      const { message } = moveResultMessage(input, tree)
      announce(message)
      // Keep focus on the moved node so keyboard users don't lose their place.
      setFocusedId(input.nodeId)
      return true
    },
    [onMove, announce, tree, readOnly, permissions, defaultRole],
  )

  // ---- Keyboard reorder -------------------------------------------------

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, node: FileTreeNode) => {
    // Treeitems nest (groups inside treeitems), so key events bubble through
    // ancestor rows. Only the row that actually has focus handles the key.
    if (event.target !== event.currentTarget) return
    const key = event.key
    const mod = event.ctrlKey || event.metaKey

    if (mod && (key === "x" || key === "X")) {
      event.preventDefault()
      if (node.id === tree.id) {
        announce("The root cannot be moved.")
        return
      }
      if (!canEditNode(node)) {
        announce("Read-only: you can't move this node.")
        return
      }
      setCutId(node.id)
      announce(`Cut "${node.name}". Press Ctrl+V to paste it.`)
      return
    }
    if (mod && (key === "v" || key === "V")) {
      event.preventDefault()
      if (!cutId) {
        announce("Nothing to paste. Press Ctrl+X on a node first.")
        return
      }
      const target = findNode(tree, node.id)
      if (!target) return
      const position: DropPosition = target.type === "dir" ? "inside" : "after"
      const input = resolveDrop(tree, cutId, node.id, position)
      setCutId(null)
      if (!input) {
        announce(`Cannot paste "${findNode(tree, cutId)?.name ?? cutId}" there.`)
        return
      }
      commitMove(input)
      // Reveal the destination when pasting into a collapsed dir.
      if (position === "inside") toggleExpand(node.id, true)
      return
    }
    if (key === "Escape") {
      if (cutId) {
        setCutId(null)
        announce("Move cancelled.")
      }
      return
    }

    if (mod && (key === "a" || key === "A")) {
      event.preventDefault()
      const ids = new Set<string>()
      for (const row of rows) {
        if (row.node.id !== tree.id) ids.add(row.node.id)
      }
      applySelection(ids)
      announce(`Selected ${ids.size} item${ids.size === 1 ? "" : "s"}.`)
      return
    }
    if (event.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault()
      if (node.id === tree.id) {
        announce("The root cannot be moved.")
        return
      }
      if (!canEditNode(node)) {
        announce("Read-only: you can't move this node.")
        return
      }
      const pos = siblingPosition(tree, node.id)
      const parent = pos?.parentId ? findNode(tree, pos.parentId) : tree
      if (!pos || !parent) return
      const siblings = [...parent.children].sort((a, b) => a.order - b.order)
      const sibling = key === "ArrowUp" ? siblings[pos.index - 1] : siblings[pos.index + 1]
      if (!sibling) {
        announce(
          key === "ArrowUp"
            ? `"${node.name}" is already first.`
            : `"${node.name}" is already last.`,
        )
        return
      }
      const input = resolveDrop(tree, node.id, sibling.id, key === "ArrowUp" ? "before" : "after")
      if (!input) {
        announce(`Cannot move "${node.name}" there.`)
        return
      }
      commitMove(input)
      return
    }

    switch (key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault()
        const delta = key === "ArrowDown" ? 1 : -1
        const index = rows.findIndex((row) => row.node.id === node.id)
        const next = rows[index + delta]
        if (next) focusRow(next.node.id)
        return
      }
      case "ArrowRight": {
        event.preventDefault()
        if (node.type !== "dir") return
        if (!isExpanded(node.id)) {
          toggleExpand(node.id, true)
          return
        }
        const index = rows.findIndex((row) => row.node.id === node.id)
        const next = rows[index + 1]
        if (next && next.parentId === node.id) focusRow(next.node.id)
        return
      }
      case "ArrowLeft": {
        event.preventDefault()
        if (node.type === "dir" && isExpanded(node.id) && node.id !== tree.id) {
          toggleExpand(node.id, false)
          return
        }
        const parent = findParent(tree, node.id)
        if (parent) focusRow(parent.id)
        return
      }
      case "Home": {
        event.preventDefault()
        if (rows[0]) focusRow(rows[0].node.id)
        return
      }
      case "End": {
        event.preventDefault()
        const last = rows[rows.length - 1]
        if (last) focusRow(last.node.id)
        return
      }
      case "Enter":
      case " ": {
        event.preventDefault()
        onActivate?.(node)
        return
      }
      default: {
        // Type-ahead: printable characters jump to the next row whose name
        // starts with the accumulated buffer (resets after ~1s).
        if (key.length === 1 && !mod && !event.altKey) {
          const now = Date.now()
          const buffer =
            now - typeaheadRef.current.at > 1000 ? key : typeaheadRef.current.text + key
          typeaheadRef.current = { text: buffer, at: now }
          const needle = buffer.toLowerCase()
          const index = rows.findIndex((row) => row.node.id === node.id)
          for (let step = 1; step <= rows.length; step += 1) {
            const candidate = rows[(index + step) % rows.length]
            if (!candidate || candidate.node.id === tree.id) continue
            if (candidate.node.name.toLowerCase().startsWith(needle)) {
              focusRow(candidate.node.id)
              announce(`Jumped to "${candidate.node.name}".`)
              return
            }
          }
        }
        return
      }
    }
  }

  // ---- Pointer drag & drop ----------------------------------------------

  const clearExpandTimer = () => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }

  const endDrag = useCallback(() => {
    clearExpandTimer()
    dragRef.current = null
    setDrop(null)
    setDraggingId(null)
  }, [setDrop])

  const computeDropTarget = useCallback(
    (clientX: number, clientY: number): DropTarget | null => {
      const hit = document.elementFromPoint(clientX, clientY)
      const rowEl = hit?.closest?.("[data-ft-row]") as HTMLElement | null
      const overId = rowEl?.dataset.ftRow
      if (!overId || overId === dragRef.current?.nodeId) return null
      const node = findNode(tree, overId)
      if (!node) return null
      const rect = rowEl.getBoundingClientRect()
      const y = (clientY - rect.top) / rect.height
      let position: DropPosition
      if (node.type === "dir") {
        if (y < 0.25) position = "before"
        else if (y > 0.75) position = "after"
        else position = "inside"
      } else {
        position = y < 0.5 ? "before" : "after"
      }
      // Don't even offer drops that would create a cycle.
      if (resolveDrop(tree, dragRef.current!.nodeId, overId, position) === null) {
        return null
      }
      return { nodeId: overId, position }
    },
    [tree],
  )

  const handleGripPointerDown = (event: PointerEvent<HTMLElement>, node: FileTreeNode) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (!canEditNode(node)) {
      announce("Read-only: dragging is disabled for this node.")
      return
    }
    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleGripPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.started) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
      if (distance < DRAG_THRESHOLD_PX) return
      drag.started = true
      setDraggingId(drag.nodeId)
      const name = findNode(tree, drag.nodeId)?.name ?? drag.nodeId
      announce(`Picked up "${name}". Drop on a folder to move it inside.`)
    }
    const target = computeDropTarget(event.clientX, event.clientY)
    setDrop(target)

    // Auto-expand collapsed dirs when hovering them as an "inside" target.
    clearExpandTimer()
    if (target?.position === "inside") {
      const over = findNode(tree, target.nodeId)
      if (over?.type === "dir" && !isExpanded(over.id)) {
        expandTimerRef.current = setTimeout(() => {
          toggleExpand(over.id, true)
          expandTimerRef.current = null
        }, EXPAND_HOVER_MS)
      }
    }
  }

  const handleGripPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.started) {
      const target = dropTargetRef.current
      if (target) {
        const input = resolveDrop(tree, drag.nodeId, target.nodeId, target.position)
        if (input) {
          commitMove(input)
          if (target.position === "inside") {
            const over = findNode(tree, target.nodeId)
            if (over?.type === "dir") toggleExpand(over.id, true)
          }
        } else {
          announce("Cannot drop there.")
        }
      }
    }
    endDrag()
  }

  // ---- Render ------------------------------------------------------------

  const sortedChildren = (node: FileTreeNode) =>
    [...node.children].sort((a, b) => a.order - b.order)

  const renderNode = (node: FileTreeNode, depth: number): ReactNode => {
    const isDir = node.type === "dir"
    const expandedNode = isExpanded(node.id)
    const isDropInside = dropTarget?.nodeId === node.id && dropTarget.position === "inside"
    const dropLine =
      dropTarget?.nodeId === node.id &&
      (dropTarget.position === "before" || dropTarget.position === "after")
        ? dropTarget.position
        : null
    const path = nodePath(tree, node.id)
    // Force-expanded by an active filter (not in the persisted expanded set):
    // collapsing won't hide it until the filter clears — reflect that in the UI.
    const forceExpanded = node.id !== tree.id && autoExpanded.has(node.id) && !expanded.has(node.id)

    return (
      <div key={node.id} role="presentation">
        <div
          role="treeitem"
          id={`ft-node-${node.id}`}
          data-ft-row={node.id}
          data-ft-type={node.type}
          aria-level={depth + 1}
          aria-expanded={isDir ? expandedNode : undefined}
          aria-selected={selection.has(node.id) || selectedId === node.id}
          aria-label={path ? path.join(" / ") : node.name}
          tabIndex={effectiveFocusId === node.id ? 0 : -1}
          className={[
            "ft-row",
            draggingId === node.id ? "is-dragging" : "",
            isDropInside ? "is-drop-inside" : "",
            selection.has(node.id) || selectedId === node.id ? "is-selected" : "",
            cutId === node.id ? "is-cut" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onKeyDown={(event) => handleKeyDown(event, node)}
          onFocus={() => setFocusedId(node.id)}
          onClick={(event) => {
            // Treeitems nest (groups inside treeitems): stop the click from
            // bubbling into ancestor rows, which would re-handle selection.
            event.stopPropagation()
            setFocusedId(node.id)
            if (node.id === tree.id) return
            const mod = event.ctrlKey || event.metaKey
            if (mod) {
              // Ctrl/Cmd-click: toggle this node in the multi-selection.
              const next = new Set(selection)
              if (next.has(node.id)) next.delete(node.id)
              else next.add(node.id)
              applySelection(next, node.id)
              return
            }
            if (event.shiftKey) {
              // Shift-click: range-select from the last anchor to this row.
              selectRangeTo(node.id)
              return
            }
            applySelection(new Set([node.id]), node.id)
          }}
          onDoubleClick={() => onActivate?.(node)}
        >
          <div className="ft-row-line" style={{ paddingLeft: depth * 16 }}>
            <button
              type="button"
              className="ft-grip"
              aria-label={`Drag to reorder ${node.name}`}
              title={canEditNode(node) ? "Drag to reorder" : "Read-only"}
              disabled={!canEditNode(node)}
              onPointerDown={(event) => handleGripPointerDown(event, node)}
              onPointerMove={handleGripPointerMove}
              onPointerUp={handleGripPointerUp}
              onPointerCancel={endDrag}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            {isDir ? (
              <button
                type="button"
                className="ft-caret"
                aria-expanded={expandedNode}
                aria-disabled={forceExpanded || undefined}
                title={forceExpanded ? "Expanded to show filter matches" : undefined}
                aria-label={`${expandedNode ? "Collapse" : "Expand"} ${node.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleExpand(node.id)
                }}
              >
                <span aria-hidden="true">{expandedNode ? "▾" : "▸"}</span>
              </button>
            ) : (
              <span className="ft-caret ft-caret--spacer" aria-hidden="true" />
            )}
            {renderIcon ? renderIcon(node) : null}
            <span className="ft-name">{node.name}</span>
            <NodeBadges
              node={node}
              gitStatus={gitStatus}
              tagsFor={tagsFor}
              isBookmarked={isBookmarked}
              isFavorite={isFavorite}
              isRecent={isRecent}
            />
            {renderActions ? (
              <span className="ft-actions" data-ft-actions={node.id}>
                {renderActions(node)}
              </span>
            ) : null}
            {dropLine ? <span className={`ft-drop-line ft-drop-line--${dropLine}`} /> : null}
          </div>
          {isDir && expandedNode ? (
            <div role="group" className="ft-group">
              {sortedChildren(node)
                .filter((child) => renderableIds.has(child.id))
                .map((child) => renderNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const selectedNode = selectedId ? findNode(tree, selectedId) : null

  return (
    <div className={className ? `ft-tree ${className}` : "ft-tree"}>
      {showToolbar ? (
        <div className="ft-toolbar" role="toolbar" aria-label="Tree actions">
          <button type="button" className="ft-tool" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="ft-tool" onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      ) : null}
      <div role="tree" aria-label={ariaLabel} className="ft-tree-items">
        {renderNode(tree, 0)}
      </div>
      {renderDetail ? <div className="ft-detail">{renderDetail(selectedNode)}</div> : null}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      {showHints ? (
        <p className="ft-hints">
          Drag the grip to reorder. Keyboard: Arrow keys navigate, Alt+↑/↓ moves a node,{" "}
          <kbd>Ctrl</kbd>+<kbd>X</kbd> cuts and <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes. <kbd>Ctrl</kbd>
          +<kbd>A</kbd> selects all; type to jump to a name.
        </p>
      ) : null}
    </div>
  )
}

// ---- Decorations -----------------------------------------------------------

interface NodeBadgesProps {
  node: FileTreeNode
  gitStatus?: GitStatusProvider
  tagsFor?: (nodeId: string) => TreeTag[]
  isBookmarked?: (nodeId: string) => boolean
  isFavorite?: (nodeId: string) => boolean
  isRecent?: (nodeId: string) => boolean
}

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  marginLeft: 4,
  fontSize: "0.75em",
  lineHeight: 1,
  userSelect: "none",
}

/** Small decoration chips rendered after the node name. */
function NodeBadges({
  node,
  gitStatus,
  tagsFor,
  isBookmarked,
  isFavorite,
  isRecent,
}: NodeBadgesProps) {
  const status = gitStatus?.get(node.id)
  const tags = tagsFor?.(node.id) ?? []
  const bookmarked = isBookmarked?.(node.id) ?? false
  const favorite = isFavorite?.(node.id) ?? false
  const recent = isRecent?.(node.id) ?? false
  if (!status && tags.length === 0 && !bookmarked && !favorite && !recent) return null

  return (
    <span className="ft-badges" data-ft-badges={node.id}>
      {status ? (
        <span
          className={`ft-git-badge ft-git-badge--${status.kind}`}
          style={{ ...badgeStyle, color: GIT_STATUS_META[status.kind].color }}
          title={`${GIT_STATUS_META[status.kind].label}${status.staged ? " (staged)" : ""}`}
          aria-label={`Git status: ${GIT_STATUS_META[status.kind].label}`}
        >
          {status.short ?? GIT_STATUS_META[status.kind].short}
        </span>
      ) : null}
      {bookmarked ? (
        <span style={badgeStyle} title="Bookmarked" aria-label="Bookmarked">
          ⚑
        </span>
      ) : null}
      {favorite ? (
        <span style={badgeStyle} title="Favorite" aria-label="Favorite">
          ★
        </span>
      ) : null}
      {recent ? (
        <span style={badgeStyle} title="Recently opened" aria-label="Recently opened">
          ◷
        </span>
      ) : null}
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="ft-tag-badge"
          style={{
            ...badgeStyle,
            color: "#fff",
            background: tag.color,
            borderRadius: 3,
            padding: "0 4px",
          }}
          title={`Tag: ${tag.name}`}
          aria-label={`Tag: ${tag.name}`}
        >
          {tag.name}
        </span>
      ))}
    </span>
  )
}
