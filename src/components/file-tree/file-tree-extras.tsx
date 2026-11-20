"use client"

/**
 * `FileTreeExtrasBar` — a compact toolbar that wires the annotation stores
 * (bookmarks / recents / favorites / tags / collections), sharing and the
 * local permission model into a usable UI.
 *
 * It is intentionally controlled: pass the object returned by
 * `useTreeAnnotations` plus the current multi-selection and apply callbacks.
 */

import { useState } from "react"

import type { TreeRole } from "@/lib/file-tree"

import type { TreeAnnotations } from "./use-tree-annotations"

export interface FileTreeExtrasBarProps {
  annotations: TreeAnnotations
  /** Currently selected node ids (for share payloads / collections). */
  selectedNodeIds?: string[]
  /** Called when a collection is applied — typically selects those nodes. */
  onApplyNodeIds?: (nodeIds: string[]) => void
  /** Called with the generated share URL (defaults to clipboard copy). */
  onShare?: (shareUrl: string) => void
  /** Node id whose permission role is being edited (optional). */
  permissionNodeId?: string | null
  /** Expanded ids captured into share payloads. */
  expandedIds?: string[]
}

const ROLE_OPTIONS: TreeRole[] = ["viewer", "editor", "admin"]

export function FileTreeExtrasBar({
  annotations,
  selectedNodeIds = [],
  onApplyNodeIds,
  onShare,
  permissionNodeId = null,
  expandedIds,
}: FileTreeExtrasBarProps) {
  const { filter, setFilter, clearFilter, tags, collections, permissions } = annotations
  const [collectionName, setCollectionName] = useState("")
  const [status, setStatus] = useState("")

  const tagList = tags.list()
  const collectionList = collections.list()
  const activeTagIds = filter.tagIds ?? []

  const toggleFlag = (key: "bookmarkOnly" | "favoriteOnly" | "recentOnly") => {
    setFilter({ ...filter, [key]: !filter[key] })
  }

  const toggleTagFilter = (tagId: string) => {
    const next = activeTagIds.includes(tagId)
      ? activeTagIds.filter((id) => id !== tagId)
      : [...activeTagIds, tagId]
    setFilter({ ...filter, tagIds: next.length ? next : undefined })
  }

  const applyCollection = (id: string) => {
    const collection = collections.get(id)
    if (!collection) return
    const { nodeIds, filter: collectionFilter } = annotations.applyCollection(collection)
    if (collectionFilter) {
      setFilter({
        bookmarkOnly: collectionFilter.bookmarkOnly,
        favoriteOnly: collectionFilter.favoriteOnly,
        recentOnly: collectionFilter.recentOnly,
        tagIds: collectionFilter.tagIds?.length ? [...collectionFilter.tagIds] : undefined,
      })
    }
    onApplyNodeIds?.(nodeIds)
    setStatus(`Applied "${collection.name}".`)
  }

  const saveCollection = () => {
    const name = collectionName.trim()
    if (!name) return
    annotations.saveCollection(name, selectedNodeIds)
    setCollectionName("")
    setStatus(`Saved collection "${name}".`)
  }

  const share = async () => {
    const url = annotations.buildShareUrl(selectedNodeIds, expandedIds)
    if (onShare) {
      onShare(url)
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setStatus("Share link copied to clipboard.")
    } catch {
      setStatus("Clipboard unavailable — copy the link manually.")
    }
  }

  const currentRole = permissionNodeId ? (permissions[permissionNodeId] ?? "admin") : null

  return (
    <div className="ft-extras" role="toolbar" aria-label="Tree extras">
      <button
        type="button"
        className="ft-extra"
        aria-pressed={Boolean(filter.bookmarkOnly)}
        onClick={() => toggleFlag("bookmarkOnly")}
      >
        Bookmarks
      </button>
      <button
        type="button"
        className="ft-extra"
        aria-pressed={Boolean(filter.favoriteOnly)}
        onClick={() => toggleFlag("favoriteOnly")}
      >
        Favorites
      </button>
      <button
        type="button"
        className="ft-extra"
        aria-pressed={Boolean(filter.recentOnly)}
        onClick={() => toggleFlag("recentOnly")}
      >
        Recent
      </button>
      <button type="button" className="ft-extra" onClick={clearFilter}>
        Clear filter
      </button>
      <button
        type="button"
        className="ft-extra"
        aria-pressed={annotations.smartFoldersEnabled}
        title="Show Recent / Bookmarks / Favorites smart folders at the top of the tree"
        onClick={annotations.toggleSmartFolders}
      >
        Smart folders
      </button>

      {tagList.length > 0 ? (
        <span className="ft-extra-group" role="group" aria-label="Tag filter">
          {tagList.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="ft-extra ft-extra--tag"
              style={{ borderColor: tag.color }}
              aria-pressed={activeTagIds.includes(tag.id)}
              onClick={() => toggleTagFilter(tag.id)}
            >
              {tag.name}
            </button>
          ))}
        </span>
      ) : null}

      {collectionList.length > 0 ? (
        <select
          className="ft-extra ft-extra--select"
          aria-label="Apply collection"
          value=""
          onChange={(event) => {
            if (event.target.value) applyCollection(event.target.value)
          }}
        >
          <option value="">Collections…</option>
          {collectionList.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
      ) : null}

      <span className="ft-extra-group">
        <input
          className="ft-extra ft-extra--input"
          aria-label="New collection name"
          placeholder="Collection name"
          value={collectionName}
          onChange={(event) => setCollectionName(event.target.value)}
        />
        <button type="button" className="ft-extra" onClick={saveCollection}>
          Save selection
        </button>
      </span>

      {permissionNodeId ? (
        <label className="ft-extra ft-extra--role">
          Role
          <select
            aria-label={`Role for ${permissionNodeId}`}
            value={currentRole ?? "admin"}
            onChange={(event) => {
              const role = event.target.value as TreeRole
              annotations.setNodeRole(permissionNodeId, role)
              setStatus(`Set ${permissionNodeId} role to ${role}.`)
            }}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="button" className="ft-extra" onClick={() => void share()}>
        Share
      </button>

      {status ? (
        <span className="ft-extra-status" role="status">
          {status}
        </span>
      ) : null}
    </div>
  )
}
