/**
 * Pluggable git-status decoration layer for the file tree.
 *
 * A `GitStatusProvider` answers "what is the VCS state of node X?" for any
 * node id. The tree component renders badges via `provider.get(node.id)`.
 *
 * `LocalGitStatusProvider` is a pure-local adapter (no git binary): it holds
 * an in-memory map seeded by the caller — useful for mocks, tests and
 * non-git backends that already know the dirty set.
 */

export type GitStatusKind =
  "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflicted"

export interface GitStatus {
  kind: GitStatusKind
  /** Short human label, e.g. "M", "A", "??". */
  short?: string
  /** Optional staged flag. */
  staged?: boolean
}

export const GIT_STATUS_META: Record<
  GitStatusKind,
  { short: string; label: string; color: string }
> = {
  modified: { short: "M", label: "Modified", color: "#d29922" },
  added: { short: "A", label: "Added", color: "#3fb950" },
  deleted: { short: "D", label: "Deleted", color: "#f85149" },
  untracked: { short: "??", label: "Untracked", color: "#8b949e" },
  renamed: { short: "R", label: "Renamed", color: "#a371f7" },
  conflicted: { short: "!", label: "Conflicted", color: "#f85149" },
}

/**
 * Backend-facing provider contract. Implementations should be cheap to call
 * (they run once per visible row per render).
 */
export interface GitStatusProvider {
  get(nodeId: string): GitStatus | undefined
  /** Optional bulk snapshot for tools/debug UIs. */
  entries?(): Iterable<[string, GitStatus]>
}

/** In-memory provider seeded with a `{ nodeId: status }` map. */
export class LocalGitStatusProvider implements GitStatusProvider {
  private readonly statuses = new Map<string, GitStatus>()

  constructor(seed?: Record<string, GitStatus | GitStatusKind>) {
    if (seed) {
      for (const [id, value] of Object.entries(seed)) {
        this.set(id, typeof value === "string" ? { kind: value } : value)
      }
    }
  }

  get(nodeId: string): GitStatus | undefined {
    return this.statuses.get(nodeId)
  }

  set(nodeId: string, status: GitStatus | GitStatusKind): this {
    this.statuses.set(nodeId, typeof status === "string" ? { kind: status } : status)
    return this
  }

  delete(nodeId: string): boolean {
    return this.statuses.delete(nodeId)
  }

  clear(): void {
    this.statuses.clear()
  }

  entries(): Iterable<[string, GitStatus]> {
    return this.statuses.entries()
  }
}

/**
 * Adapter that derives statuses from a flat `path -> status` map (the shape
 * most git backends return). Node ids are matched directly; callers that use
 * different ids should map them before constructing the provider.
 */
export function gitStatusProviderFromMap(
  map: Record<string, GitStatus | GitStatusKind>,
): LocalGitStatusProvider {
  return new LocalGitStatusProvider(map)
}

/** Convenience: wrap a lookup function as a provider. */
export function functionGitStatusProvider(
  fn: (nodeId: string) => GitStatus | GitStatusKind | undefined,
): GitStatusProvider {
  return {
    get(nodeId) {
      const value = fn(nodeId)
      if (!value) return undefined
      return typeof value === "string" ? { kind: value } : value
    },
  }
}
