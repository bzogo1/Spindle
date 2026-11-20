/**
 * Colored tags for file-tree nodes.
 *
 * Tags are user-defined labels (`{ id, name, color }`) that can be attached
 * to any node id. Assignments live in a localStorage-backed store; the tag
 * definitions themselves are persisted too, so colors survive reloads.
 *
 * `filterByTag(tree, tagId)` returns the set of node ids carrying the tag,
 * which the UI intersects with `visibleItems` to implement the tag filter.
 */

import { defaultStorage, type StorageLike } from "./annotations"

export interface TreeTag {
  id: string
  name: string
  /** CSS color (hex/rgb/name). */
  color: string
}

const TAGS_KEY = "spindle:tree-tags"
const ASSIGN_KEY = "spindle:tree-tag-assignments" // { nodeId: tagId[] }

function readJson<T>(storage: StorageLike | null, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota errors
  }
}

interface Listener {
  (): void
}

export class TagStore {
  private readonly storage: StorageLike | null
  private tags = new Map<string, TreeTag>()
  private assignments = new Map<string, Set<string>>()
  private readonly listeners = new Set<Listener>()

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage
    this.load()
  }

  private load() {
    try {
      const tags = readJson<unknown>(this.storage, TAGS_KEY, [])
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (
            tag &&
            typeof tag === "object" &&
            typeof (tag as TreeTag).id === "string" &&
            typeof (tag as TreeTag).name === "string"
          ) {
            const t = tag as TreeTag
            this.tags.set(t.id, { id: t.id, name: t.name, color: t.color ?? "#8b949e" })
          }
        }
      }
      const assignments = readJson<Record<string, unknown>>(this.storage, ASSIGN_KEY, {})
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        for (const [nodeId, tagIds] of Object.entries(assignments)) {
          // Guard against corrupt payloads: only arrays of known tag ids survive.
          if (!Array.isArray(tagIds)) continue
          this.assignments.set(
            nodeId,
            new Set(tagIds.filter((t): t is string => typeof t === "string" && this.tags.has(t))),
          )
        }
      }
    } catch {
      // Corrupt storage — start with empty stores rather than crashing.
      this.tags.clear()
      this.assignments.clear()
    }
  }

  private persist() {
    writeJson(this.storage, TAGS_KEY, [...this.tags.values()])
    const flat: Record<string, string[]> = {}
    for (const [nodeId, tagIds] of this.assignments) {
      if (tagIds.size > 0) flat[nodeId] = [...tagIds]
    }
    writeJson(this.storage, ASSIGN_KEY, flat)
  }

  // ---- tag definitions ----------------------------------------------------

  list(): TreeTag[] {
    return [...this.tags.values()]
  }

  get(tagId: string): TreeTag | undefined {
    return this.tags.get(tagId)
  }

  create(name: string, color = "#8b949e"): TreeTag {
    const tag: TreeTag = {
      id: `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      color,
    }
    this.tags.set(tag.id, tag)
    this.persist()
    this.emit()
    return tag
  }

  update(tagId: string, patch: Partial<Pick<TreeTag, "name" | "color">>): TreeTag | null {
    const tag = this.tags.get(tagId)
    if (!tag) return null
    const next = { ...tag, ...patch, id: tag.id }
    this.tags.set(tagId, next)
    this.persist()
    this.emit()
    return next
  }

  remove(tagId: string): boolean {
    if (!this.tags.delete(tagId)) return false
    for (const set of this.assignments.values()) set.delete(tagId)
    this.persist()
    this.emit()
    return true
  }

  // ---- node assignments ---------------------------------------------------

  tagsFor(nodeId: string): TreeTag[] {
    const ids = this.assignments.get(nodeId)
    if (!ids) return []
    return [...ids].map((id) => this.tags.get(id)).filter((t): t is TreeTag => Boolean(t))
  }

  tagIdsFor(nodeId: string): string[] {
    return [...(this.assignments.get(nodeId) ?? [])]
  }

  assign(nodeId: string, tagId: string): boolean {
    const tag = this.tags.get(tagId)
    if (!tag) return false
    let set = this.assignments.get(nodeId)
    if (!set) {
      set = new Set()
      this.assignments.set(nodeId, set)
    }
    if (set.has(tagId)) return false
    set.add(tagId)
    this.persist()
    this.emit()
    return true
  }

  unassign(nodeId: string, tagId: string): boolean {
    const set = this.assignments.get(nodeId)
    if (!set?.delete(tagId)) return false
    this.persist()
    this.emit()
    return true
  }

  toggle(nodeId: string, tagId: string): boolean {
    return this.tagIdsFor(nodeId).includes(tagId)
      ? this.unassign(nodeId, tagId)
      : this.assign(nodeId, tagId)
  }

  /** Node ids carrying `tagId` (optionally including descendants — caller decides). */
  nodeIdsWithTag(tagId: string): string[] {
    const out: string[] = []
    for (const [nodeId, ids] of this.assignments) {
      if (ids.has(tagId)) out.push(nodeId)
    }
    return out
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
