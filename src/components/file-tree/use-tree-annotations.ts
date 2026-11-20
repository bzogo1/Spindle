"use client"

/**
 * React binding for the file-tree annotation stores (bookmarks, recents,
 * favorites, tags, collections) plus the local permission map.
 *
 * Stores are synchronous localStorage-backed objects; this hook subscribes
 * to their change events and bumps a version counter so consumers re-render.
 * All stores accept an injectable `StorageLike` for tests.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react"

import {
  BookmarkStore,
  CollectionStore,
  FavoriteStore,
  RecentFilesStore,
  TagStore,
  clearRole,
  createSharePayload,
  encodeSharePayloadForUrl,
  loadPermissions,
  savePermissions,
  setRole,
  bookmarkFolder,
  favoriteFolder,
  recentFolder,
  withSmartFolders,
  type CollectionFilter,
  type FileTreeNode,
  type PermissionMap,
  type SharePayload,
  type StorageLike,
  type TreeCollection,
  type TreeFilter,
  type TreeRole,
  type TreeTag,
} from "@/lib/file-tree"

export interface UseTreeAnnotationsOptions {
  /** Inject a storage (tests); defaults to localStorage. */
  storage?: StorageLike | null
  /** Initial permission map (defaults to the persisted one). */
  permissions?: PermissionMap
}

export interface TreeAnnotations {
  bookmarks: BookmarkStore
  favorites: FavoriteStore
  recents: RecentFilesStore
  tags: TagStore
  collections: CollectionStore
  // Bumped whenever any store changes — use as a memo dep if needed.
  version: number

  // ---- predicates (stable across renders) ---------------------------------
  isBookmarked: (id: string) => boolean
  isFavorite: (id: string) => boolean
  isRecent: (id: string) => boolean
  tagIdsFor: (id: string) => string[]
  tagsFor: (id: string) => TreeTag[]

  // ---- mutations ----------------------------------------------------------
  toggleBookmark: (id: string) => void
  toggleFavorite: (id: string) => void
  recordOpen: (id: string) => void

  // ---- filter -------------------------------------------------------------
  filter: TreeFilter
  setFilter: (filter: TreeFilter) => void
  clearFilter: () => void

  // ---- collections --------------------------------------------------------
  saveCollection: (name: string, nodeIds: string[]) => TreeCollection
  applyCollection: (collection: TreeCollection) => { nodeIds: string[]; filter?: CollectionFilter }
  removeCollection: (id: string) => void

  // ---- share --------------------------------------------------------------
  /** Build + URL-encode a share payload for the given selection. */
  buildShareUrl: (nodeIds: string[], expandedIds?: string[]) => string
  buildSharePayload: (nodeIds: string[], expandedIds?: string[]) => SharePayload

  // ---- permissions --------------------------------------------------------
  permissions: PermissionMap
  setNodeRole: (nodeId: string, role: TreeRole) => void
  clearNodeRole: (nodeId: string) => void

  // ---- smart folders --------------------------------------------------------
  /** Whether Recent/Bookmarks/Favorites smart folders are enabled. */
  smartFoldersEnabled: boolean
  toggleSmartFolders: () => void
  /** Synthetic smart-folder nodes for the current annotation state. */
  smartFolderNodes: (tree: FileTreeNode) => FileTreeNode[]
  /** `tree` with smart folders prepended (no-op when disabled/empty). */
  withSmartFolderNodes: (tree: FileTreeNode) => FileTreeNode
}

export function useTreeAnnotations(options: UseTreeAnnotationsOptions = {}): TreeAnnotations {
  const storage = options.storage
  const [stores] = useState(() => ({
    bookmarks: new BookmarkStore(storage),
    favorites: new FavoriteStore(storage),
    recents: new RecentFilesStore(storage),
    tags: new TagStore(storage),
    collections: new CollectionStore(storage),
  }))

  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // Subscribe once to every store's change event; bump `version` so
  // useSyncExternalStore sees a new snapshot and consumers re-render.
  useSyncExternalStore(
    useCallback(
      (onChange) => {
        const wrapped = () => {
          bump()
          onChange()
        }
        const unsubs = [
          stores.bookmarks.subscribe(wrapped),
          stores.favorites.subscribe(wrapped),
          stores.recents.subscribe(wrapped),
          stores.tags.subscribe(wrapped),
          stores.collections.subscribe(wrapped),
        ]
        return () => unsubs.forEach((unsub) => unsub())
      },
      [stores, bump],
    ),
    () => version,
    () => version,
  )

  const [filter, setFilterState] = useState<TreeFilter>({})
  const setFilter = useCallback((next: TreeFilter) => setFilterState(next), [])
  const clearFilter = useCallback(() => setFilterState({}), [])

  const [permissions, setPermissions] = useState<PermissionMap>(
    // Pass `storage` through verbatim: explicit `null` means "no storage"
    // and must NOT fall back to real localStorage.
    () => options.permissions ?? loadPermissions(storage),
  )
  const setNodeRole = useCallback(
    (nodeId: string, role: TreeRole) => {
      setPermissions((prev) => {
        const next = setRole(prev, nodeId, role)
        savePermissions(next, storage)
        return next
      })
    },
    [storage],
  )
  const clearNodeRole = useCallback(
    (nodeId: string) => {
      setPermissions((prev) => {
        const next = clearRole(prev, nodeId)
        savePermissions(next, storage)
        return next
      })
    },
    [storage],
  )

  // ---- smart folders --------------------------------------------------------

  const [smartFoldersEnabled, setSmartFoldersEnabled] = useState(false)
  const toggleSmartFolders = useCallback(() => setSmartFoldersEnabled((v) => !v), [])

  const smartFolderNodes = useCallback(
    (tree: FileTreeNode): FileTreeNode[] => {
      if (!smartFoldersEnabled) return []
      const folders: FileTreeNode[] = []
      const recentIds = stores.recents.ids()
      if (recentIds.length > 0) folders.push(recentFolder(tree, recentIds))
      const bookmarkIds = stores.bookmarks.ids()
      if (bookmarkIds.length > 0) folders.push(bookmarkFolder(tree, bookmarkIds))
      const favoriteIds = stores.favorites.ids()
      if (favoriteIds.length > 0) folders.push(favoriteFolder(tree, favoriteIds))
      return folders
    },
    [stores, smartFoldersEnabled],
  )

  const withSmartFolderNodes = useCallback(
    (tree: FileTreeNode) => withSmartFolders(tree, smartFolderNodes(tree)),
    [smartFolderNodes],
  )

  const isBookmarked = useCallback((id: string) => stores.bookmarks.has(id), [stores])
  const isFavorite = useCallback((id: string) => stores.favorites.has(id), [stores])
  const isRecent = useCallback((id: string) => stores.recents.has(id), [stores])
  const tagIdsFor = useCallback((id: string) => stores.tags.tagIdsFor(id), [stores])
  const tagsFor = useCallback((id: string) => stores.tags.tagsFor(id), [stores])

  const toggleBookmark = useCallback((id: string) => void stores.bookmarks.toggle(id), [stores])
  const toggleFavorite = useCallback((id: string) => void stores.favorites.toggle(id), [stores])
  const recordOpen = useCallback((id: string) => void stores.recents.recordOpen(id), [stores])

  const saveCollection = useCallback(
    (name: string, nodeIds: string[]) =>
      stores.collections.create(name, nodeIds, {
        ...(filter.bookmarkOnly ? { bookmarkOnly: true } : {}),
        ...(filter.favoriteOnly ? { favoriteOnly: true } : {}),
        ...(filter.recentOnly ? { recentOnly: true } : {}),
        ...(filter.tagIds?.length ? { tagIds: [...filter.tagIds] } : {}),
      }),
    [stores, filter],
  )

  const applyCollection = useCallback(
    (collection: TreeCollection) => ({
      nodeIds: stores.collections.nodeIds(collection.id),
      filter: collection.filter,
    }),
    [stores],
  )

  const removeCollection = useCallback((id: string) => void stores.collections.remove(id), [stores])

  const buildSharePayload = useCallback(
    (nodeIds: string[], expandedIds?: string[]) =>
      createSharePayload({
        nodeIds,
        expandedIds,
        filters: {
          bookmarkOnly: filter.bookmarkOnly || undefined,
          favoriteOnly: filter.favoriteOnly || undefined,
          recentOnly: filter.recentOnly || undefined,
          tagIds: filter.tagIds?.length ? [...filter.tagIds] : undefined,
        },
        bookmarks: stores.bookmarks.ids(),
        favorites: stores.favorites.ids(),
        tags: Object.fromEntries(
          stores.tags.list().map((tag) => [tag.id, stores.tags.nodeIdsWithTag(tag.id)]),
        ),
      }),
    [stores, filter],
  )

  const buildShareUrl = useCallback(
    (nodeIds: string[], expandedIds?: string[]) =>
      `#share=${encodeSharePayloadForUrl(buildSharePayload(nodeIds, expandedIds))}`,
    [buildSharePayload],
  )

  return useMemo(
    () => ({
      bookmarks: stores.bookmarks,
      favorites: stores.favorites,
      recents: stores.recents,
      tags: stores.tags,
      collections: stores.collections,
      version,
      isBookmarked,
      isFavorite,
      isRecent,
      tagIdsFor,
      tagsFor,
      toggleBookmark,
      toggleFavorite,
      recordOpen,
      filter,
      setFilter,
      clearFilter,
      saveCollection,
      applyCollection,
      removeCollection,
      buildSharePayload,
      buildShareUrl,
      permissions,
      setNodeRole,
      clearNodeRole,
      smartFoldersEnabled,
      toggleSmartFolders,
      smartFolderNodes,
      withSmartFolderNodes,
    }),
    [
      stores,
      version,
      isBookmarked,
      isFavorite,
      isRecent,
      tagIdsFor,
      tagsFor,
      toggleBookmark,
      toggleFavorite,
      recordOpen,
      filter,
      setFilter,
      clearFilter,
      saveCollection,
      applyCollection,
      removeCollection,
      buildSharePayload,
      buildShareUrl,
      permissions,
      setNodeRole,
      clearNodeRole,
      smartFoldersEnabled,
      toggleSmartFolders,
      smartFolderNodes,
      withSmartFolderNodes,
    ],
  )
}
