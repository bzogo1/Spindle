import { LAB_NOTEBOOK_TEMPLATES } from "./lab-mock"

/**
 * Shareable lab notebook links. The notebook catalog is mock data
 * (`lab-mock.ts`), so a shared link only needs to carry the view state — the
 * recipient's browser resolves it against the same seeded cells:
 *
 * - `notebook` — the notebook template id; ids outside the seeded template
 *   catalog are ignored.
 * - `nbexec` — per-cell execution counts as `cellId:count` pairs joined by
 *   commas, e.g. `nbexec=cell-02:2,tidal-code-1:1`. Cells absent from the list
 *   are treated as never run this session, and unknown ids are dropped.
 * - `nbfilter` — the row-filter text applied to notebook tables.
 *
 * Unrelated params are preserved when building a share href, matching
 * `lab-snapshot-share.ts`.
 */

export const LAB_NOTEBOOK_PARAM = "notebook"
export const LAB_NOTEBOOK_EXEC_PARAM = "nbexec"
export const LAB_NOTEBOOK_FILTER_PARAM = "nbfilter"

/** Upper bound per cell so hand-edited links cannot request absurd states. */
const MAX_CELL_EXECUTIONS = 99
const MAX_FILTER_LENGTH = 200

const TEMPLATE_IDS = new Set(LAB_NOTEBOOK_TEMPLATES.map((template) => template.id))
const CELL_IDS = new Set(
  LAB_NOTEBOOK_TEMPLATES.flatMap((template) => template.cells.map((cell) => cell.id)),
)

export interface LabNotebookShareState {
  /** Notebook template id from `?notebook=` — must be a seeded template. */
  notebook?: string
  /** Session executions per cell id from `?nbexec=cellId:count,…`. */
  cells?: Record<string, number>
  /** Row-filter text from `?nbfilter=`. */
  filter?: string
}

function parseExecParam(raw: string | null): Record<string, number> | undefined {
  if (!raw) return undefined
  const cells: Record<string, number> = {}
  for (const part of raw.split(",")) {
    const separator = part.indexOf(":")
    if (separator === -1) continue
    const id = part.slice(0, separator)
    const count = Number(part.slice(separator + 1))
    if (
      CELL_IDS.has(id) &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= MAX_CELL_EXECUTIONS
    ) {
      cells[id] = count
    }
  }
  return Object.keys(cells).length > 0 ? cells : undefined
}

/**
 * Read the share params out of a URL query (`useSearchParams()` result or any
 * `{ get }`-shaped object). Absent or undecodable params yield `undefined`
 * fields so the notebook falls back to its seeded state.
 */
export function parseLabNotebookShareParams(searchParams: {
  get(name: string): string | null
}): LabNotebookShareState {
  const state: LabNotebookShareState = {}

  const notebook = searchParams.get(LAB_NOTEBOOK_PARAM)
  if (notebook && TEMPLATE_IDS.has(notebook)) state.notebook = notebook

  const cells = parseExecParam(searchParams.get(LAB_NOTEBOOK_EXEC_PARAM))
  if (cells) state.cells = cells

  const filter = searchParams.get(LAB_NOTEBOOK_FILTER_PARAM)
  if (filter) state.filter = filter.slice(0, MAX_FILTER_LENGTH)

  return state
}

/**
 * Build the query string for a shareable lab URL. Starts from `base`
 * (typically the current `location.search`) and sets or removes the share
 * params so a link carries exactly one notebook view state.
 */
export function labNotebookShareParams(
  state: LabNotebookShareState,
  base?: string | URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "")
  params.delete(LAB_NOTEBOOK_PARAM)
  params.delete(LAB_NOTEBOOK_EXEC_PARAM)
  params.delete(LAB_NOTEBOOK_FILTER_PARAM)

  if (state.notebook && TEMPLATE_IDS.has(state.notebook)) {
    params.set(LAB_NOTEBOOK_PARAM, state.notebook)
  }

  if (state.cells) {
    const pairs = Object.entries(state.cells)
      .filter(([id, count]) => CELL_IDS.has(id) && Number.isInteger(count) && count > 0)
      .map(([id, count]) => `${id}:${count}`)
    if (pairs.length > 0) params.set(LAB_NOTEBOOK_EXEC_PARAM, pairs.join(","))
  }

  if (state.filter) params.set(LAB_NOTEBOOK_FILTER_PARAM, state.filter)

  return params
}

/**
 * Absolute share URL for the current lab page. `window` is only touched when
 * the factory runs (on click), matching `labSnapshotShareHref`.
 */
export function labNotebookShareHref(
  state: LabNotebookShareState,
  pathname: string,
  search: string,
): string {
  const query = labNotebookShareParams(state, search).toString()
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}${pathname}${query ? `?${query}` : ""}`
}
