/**
 * Named collections of file-tree nodes.
 *
 * A collection is a saved view: a name plus a list of node ids and an
 * optional filter spec (`{ tags?, bookmarkOnly?, favoriteOnly?, recentOnly? }`)
 * so "quick-apply" restores both the selection and the active filter.
 *
 * Persisted in localStorage; injectable storage for tests.
 */

import { defaultStorage, type StorageLike } from "./annotations"

export interface CollectionFilter {
  /** Only show nodes carrying any of these tag ids. */
  tagIds?: string[]
  bookmarkOnly?: boolean
  favoriteOnly?: boolean
  recentOnly?: boolean
}

export interface TreeCollection {
  id: string
  name: string
  /** Node ids captured when the collection was saved. */
  nodeIds: string[]
  filter?: CollectionFilter
  createdAt: string
}

const KEY = "spindle:tree-collections"

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
    // ignore
  }
}

interface Listener {
  (): void
}

export class CollectionStore {
  private readonly storage: StorageLike | null
  private collections = new Map<string, TreeCollection>()
  private readonly listeners = new Set<Listener>()

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage
    try {
      const parsed = readJson<unknown>(this.storage, KEY, [])
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (
            c &&
            typeof c === "object" &&
            typeof (c as TreeCollection).id === "string" &&
            typeof (c as TreeCollection).name === "string" &&
            Array.isArray((c as TreeCollection).nodeIds)
          ) {
            this.collections.set((c as TreeCollection).id, c as TreeCollection)
          }
        }
      }
    } catch {
      // Corrupt storage — start empty.
      this.collections.clear()
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private persist() {
    writeJson(this.storage, KEY, [...this.collections.values()])
  }

  list(): TreeCollection[] {
    return [...this.collections.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): TreeCollection | undefined {
    return this.collections.get(id)
  }

  create(name: string, nodeIds: string[], filter?: CollectionFilter): TreeCollection {
    const collection: TreeCollection = {
      id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      nodeIds: [...nodeIds],
      filter,
      createdAt: new Date().toISOString(),
    }
    this.collections.set(collection.id, collection)
    this.persist()
    this.emit()
    return collection
  }

  update(
    id: string,
    patch: Partial<Pick<TreeCollection, "name" | "nodeIds" | "filter">>,
  ): TreeCollection | null {
    const existing = this.collections.get(id)
    if (!existing) return null
    const next = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt }
    this.collections.set(id, next)
    this.persist()
    this.emit()
    return next
  }

  remove(id: string): boolean {
    if (!this.collections.delete(id)) return false
    this.persist()
    this.emit()
    return true
  }

  /** Node ids belonging to the collection (deduped). */
  nodeIds(id: string): string[] {
    return [...(this.collections.get(id)?.nodeIds ?? [])]
  }
}
