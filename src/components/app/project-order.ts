"use client"

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"

/**
 * Manual project ordering for the dashboard and projects screens. There is no
 * backend field for a custom project order yet, so the sequence of project ids
 * a user arranges by drag-and-drop is persisted to localStorage (same pattern
 * as `dashboard-layout.ts`) and layered on top of the active sort: ranked ids
 * keep their manual positions, anything missing from the stored order (new or
 * previously filtered-out projects) falls back to the end in sorted order.
 */

/** Handlers + state a draggable project card/row needs from the hook. */
export interface ProjectDragBinding {
  draggable: true
  dragging: boolean
  dropTarget: boolean
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

export interface ProjectDragOrder {
  /** Manual order of project ids, or null when the active sort rules. */
  order: string[] | null
  /** True while a drag is in flight (used to suppress hover styles). */
  isDragging: boolean
  /** Bind drag-and-drop handlers to the card/row for `projectId`.
   * `ids` must be the currently displayed project ids in display order. */
  bind: (projectId: string, ids: string[]) => ProjectDragBinding
  /** Clear the manual order (e.g. when the sort dropdown changes). */
  reset: () => void
}

function readStoredOrder(storageKey: string): string[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((id): id is string => typeof id === "string")
    return ids.length > 0 ? ids : null
  } catch {
    // Corrupt payload or unavailable storage — fall back to sorted order.
    return null
  }
}

function writeStoredOrder(storageKey: string, order: string[] | null) {
  try {
    if (order && order.length > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify(order))
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // Storage can be unavailable (private mode); ordering still applies
    // for this session via React state.
  }
}

/** Move `fromId` to `toId`'s position inside `ids`; returns `ids` unchanged
 * when either id is missing or they are the same. */
export function reorderIds(ids: string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from === -1 || to === -1 || from === to) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Stable-sort `items` by their position in the manual `order`. Items missing
 * from the order keep their incoming (sorted) relative order at the end.
 */
export function orderByManual<T extends { id: string }>(
  items: T[],
  order: string[] | null,
): T[] {
  if (!order || order.length === 0) return items
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const rankA = rank.get(a.id)
    const rankB = rank.get(b.id)
    if (rankA === undefined && rankB === undefined) return 0
    if (rankA === undefined) return 1
    if (rankB === undefined) return -1
    return rankA - rankB
  })
}

export function useProjectDragOrder(storageKey: string): ProjectDragOrder {
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  // Mirror of `order` so drop commits never read a stale closure value.
  const orderRef = useRef<string[] | null>(null)

  useEffect(() => {
    const stored = readStoredOrder(storageKey)
    orderRef.current = stored
    setOrder(stored)
  }, [storageKey])

  const commit = useCallback(
    (ids: string[], fromId: string, toId: string) => {
      const next = reorderIds(ids, fromId, toId)
      if (next === ids) return
      // Merge with any previously stored ids that are not currently displayed
      // (e.g. filtered out) so their manual positions are not lost.
      const previous = orderRef.current
      const merged = previous
        ? [...next, ...previous.filter((id) => !next.includes(id))]
        : next
      orderRef.current = merged
      setOrder(merged)
      writeStoredOrder(storageKey, merged)
    },
    [storageKey],
  )

  const bind = useCallback(
    (projectId: string, ids: string[]): ProjectDragBinding => ({
      draggable: true,
      dragging: dragId === projectId,
      dropTarget: dropId === projectId && dragId !== null && dragId !== projectId,
      onDragStart: (event) => {
        setDragId(projectId)
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", projectId)
      },
      onDragOver: (event) => {
        if (dragId === null || dragId === projectId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setDropId(projectId)
      },
      onDrop: (event) => {
        event.preventDefault()
        const fromId = dragId
        setDragId(null)
        setDropId(null)
        if (fromId && fromId !== projectId) commit(ids, fromId, projectId)
      },
      onDragEnd: () => {
        setDragId(null)
        setDropId(null)
      },
    }),
    [dragId, dropId, commit],
  )

  const reset = useCallback(() => {
    orderRef.current = null
    setOrder(null)
    writeStoredOrder(storageKey, null)
  }, [storageKey])

  return { order, isDragging: dragId !== null, bind, reset }
}
