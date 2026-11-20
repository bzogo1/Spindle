import { LAB_SNAPSHOTS } from "./lab-mock"

/**
 * Shareable lab snapshot links. The snapshot catalog is mock data
 * (`lab-mock.ts`), so a shared link only needs to carry snapshot ids — the
 * recipient's browser resolves them against the same seeded catalog:
 *
 * - `snapshot` — a single snapshot id. On load the lab screen opens that
 *   capture's comparison view: against its environment baseline when one is
 *   set, otherwise as a lone selection awaiting a second pick.
 * - `compare` — an ordered pair `A,B` that opens the side-by-side comparison
 *   directly, e.g. `compare=snap-01,snap-05`.
 *
 * `compare` wins when both params are present. Unknown or duplicate ids are
 * dropped so hand-edited links degrade to the plain snapshots panel instead
 * of producing invalid state. Unrelated params are preserved when building a
 * share href, matching `dashboard-share.ts`.
 */

export const LAB_SNAPSHOT_SHARE_PARAM = "snapshot"
export const LAB_SNAPSHOT_COMPARE_PARAM = "compare"

export interface LabSnapshotShareState {
  /** Single snapshot id from `?snapshot=`. */
  snapshot?: string
  /** Ordered compare pair `[A, B]` from `?compare=A,B`. */
  compare?: [string, string]
}

const SNAPSHOT_IDS = new Set(LAB_SNAPSHOTS.map((snapshot) => snapshot.id))

function isKnownSnapshotId(id: string): boolean {
  return SNAPSHOT_IDS.has(id)
}

/**
 * Read the share params out of a URL query (`useSearchParams()` result or any
 * `{ get }`-shaped object). Absent or undecodable params yield `undefined`
 * fields so the panel falls back to its current selection.
 */
export function parseLabSnapshotShareParams(searchParams: {
  get(name: string): string | null
}): LabSnapshotShareState {
  const state: LabSnapshotShareState = {}

  const compare = searchParams.get(LAB_SNAPSHOT_COMPARE_PARAM)
  if (compare) {
    const [a, b, ...rest] = compare.split(",")
    if (rest.length === 0 && a && b && a !== b && isKnownSnapshotId(a) && isKnownSnapshotId(b)) {
      state.compare = [a, b]
    }
  }

  if (!state.compare) {
    const snapshot = searchParams.get(LAB_SNAPSHOT_SHARE_PARAM)
    if (snapshot && isKnownSnapshotId(snapshot)) state.snapshot = snapshot
  }

  return state
}

/**
 * Build the query string for a shareable lab URL. Starts from `base`
 * (typically the current `location.search`) and sets or removes the share
 * params so a link carries exactly one view state.
 */
export function labSnapshotShareParams(
  state: LabSnapshotShareState,
  base?: string | URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "")
  params.delete(LAB_SNAPSHOT_SHARE_PARAM)
  params.delete(LAB_SNAPSHOT_COMPARE_PARAM)

  if (state.compare) {
    const [a, b] = state.compare
    if (isKnownSnapshotId(a) && isKnownSnapshotId(b) && a !== b) {
      params.set(LAB_SNAPSHOT_COMPARE_PARAM, `${a},${b}`)
    }
  } else if (state.snapshot && isKnownSnapshotId(state.snapshot)) {
    params.set(LAB_SNAPSHOT_SHARE_PARAM, state.snapshot)
  }

  return params
}

/**
 * Absolute share URL for the current lab page. `window` is only touched when
 * the factory runs (on click), matching `AgentRunShareButton`.
 */
export function labSnapshotShareHref(
  state: LabSnapshotShareState,
  pathname: string,
  search: string,
): string {
  const query = labSnapshotShareParams(state, search).toString()
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}${pathname}${query ? `?${query}` : ""}`
}
