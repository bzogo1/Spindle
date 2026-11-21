/**
 * Client-side cell-execution stats for the Lab screen.
 *
 * `NotebookView` (the JupyterLab environment pane) reports how many cells
 * have been executed this session; `LabScreen` subscribes through
 * `useSyncExternalStore` to render the counter in the lab panel header.
 * There is no kernel backend yet — everything here is in-memory mock state,
 * matching the `?nbexec=` share-param counts in `lab-notebook-share.ts`.
 */

export interface LabCellExecutionStats {
  /** Distinct code cells executed at least once this session. */
  cellsExecuted: number
  /** Total code cells in the active notebook. */
  codeCells: number
  /** Total completed cell executions — re-running a cell counts again. */
  totalRuns: number
}

const INITIAL_STATS: LabCellExecutionStats = {
  cellsExecuted: 0,
  codeCells: 0,
  totalRuns: 0,
}

let stats = INITIAL_STATS
const listeners = new Set<() => void>()

export function getLabCellExecutionStats(): LabCellExecutionStats {
  return stats
}

export function subscribeLabCellExecutionStats(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportLabCellExecutionStats(next: LabCellExecutionStats): void {
  if (
    next.cellsExecuted === stats.cellsExecuted &&
    next.codeCells === stats.codeCells &&
    next.totalRuns === stats.totalRuns
  ) {
    return
  }
  stats = next
  for (const listener of listeners) listener()
}

/** Clear the counter — called when the notebook view unmounts. */
export function resetLabCellExecutionStats(): void {
  reportLabCellExecutionStats(INITIAL_STATS)
}
