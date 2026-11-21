/**
 * Static catalog for the Lab screen's tool runner (DEV-lab-tools).
 *
 * The backend has no lab-tools endpoint yet, so the tool definitions and
 * snapshot fixtures live here as constants — same pattern as
 * `dashboard-mock.ts`. Run records are persisted through `api.lab`
 * (`listLabSessions` / `createLabSession`); parameters and logs are kept
 * client-side until the API grows fields for them.
 */

import type { LucideIcon } from "lucide-react"
import { Download, ListFilter, Map as MapIcon, Waves } from "lucide-react"

export type LabToolParamKind = "text" | "textarea" | "number" | "select" | "slider" | "checkbox"

export interface LabToolParamOption {
  value: string
  label: string
}

export interface LabToolParam {
  key: string
  label: string
  kind: LabToolParamKind
  required?: boolean
  placeholder?: string
  help?: string
  /** Bounds for `number` and `slider` params. */
  min?: number
  max?: number
  step?: number
  options?: LabToolParamOption[]
  defaultValue?: string | number | boolean
}

export interface LabTool {
  id: string
  name: string
  description: string
  icon: LucideIcon
  params: LabToolParam[]
}

export const LAB_TOOLS: LabTool[] = [
  {
    id: "tide-analysis",
    name: "Tide analysis",
    description: "Harmonic decomposition of a tidal dataset over a sliding window.",
    icon: Waves,
    params: [
      {
        key: "dataset",
        label: "Dataset",
        kind: "select",
        required: true,
        options: [
          { value: "tidal-2026.csv", label: "Tidal 2026" },
          { value: "harbor-2025.csv", label: "Harbor 2025" },
        ],
        defaultValue: "tidal-2026.csv",
      },
      {
        key: "windowDays",
        label: "Analysis window (days)",
        kind: "slider",
        min: 1,
        max: 30,
        step: 1,
        defaultValue: 14,
      },
      {
        key: "detrend",
        label: "Remove linear trend",
        kind: "checkbox",
        defaultValue: true,
      },
    ],
  },
  {
    id: "survey-clean",
    name: "Survey data cleaning",
    description: "Validate a survey export, drop empty rows, and flag low-confidence records.",
    icon: ListFilter,
    params: [
      {
        key: "inputPath",
        label: "Input file",
        kind: "text",
        required: true,
        placeholder: "data/survey-export.csv",
      },
      {
        key: "minConfidence",
        label: "Minimum confidence (%)",
        kind: "slider",
        min: 0,
        max: 100,
        step: 5,
        defaultValue: 60,
      },
      {
        key: "dropEmptyRows",
        label: "Drop empty rows",
        kind: "checkbox",
        defaultValue: true,
      },
      {
        key: "notes",
        label: "Cleaning notes",
        kind: "textarea",
        placeholder: "Anything the reviewer should know about this pass.",
      },
    ],
  },
  {
    id: "species-map",
    name: "Species distribution map",
    description: "Rasterize occurrence records into a distribution grid for one species.",
    icon: MapIcon,
    params: [
      {
        key: "species",
        label: "Species",
        kind: "text",
        required: true,
        placeholder: "e.g. Larus argentatus",
      },
      {
        key: "resolutionKm",
        label: "Grid resolution",
        kind: "select",
        options: [
          { value: "0.5", label: "0.5 km" },
          { value: "1", label: "1 km" },
          { value: "5", label: "5 km" },
        ],
        defaultValue: "1",
      },
      {
        key: "bufferKm",
        label: "Coastal buffer (km)",
        kind: "slider",
        min: 0,
        max: 50,
        step: 5,
        defaultValue: 10,
      },
      {
        key: "simulateFailure",
        label: "Simulate a failed run",
        kind: "checkbox",
        help: "Demo flag — the run ends in a failed state with an error log.",
      },
    ],
  },
  {
    id: "export-results",
    name: "Export results",
    description: "Package the latest run outputs into a downloadable archive.",
    icon: Download,
    params: [
      {
        key: "format",
        label: "Format",
        kind: "select",
        required: true,
        options: [
          { value: "csv", label: "CSV" },
          { value: "parquet", label: "Parquet" },
          { value: "json", label: "JSON" },
        ],
        defaultValue: "csv",
      },
      {
        key: "compression",
        label: "Compression",
        kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "gzip", label: "gzip" },
          { value: "zstd", label: "zstd" },
        ],
        defaultValue: "gzip",
      },
      {
        key: "includeMetadata",
        label: "Include run metadata",
        kind: "checkbox",
        defaultValue: true,
      },
    ],
  },
]

export interface LabSnapshot {
  id: string
  name: string
  /** Display label for the environment the snapshot belongs to. */
  environment: string
  description: string
  sizeBytes: number
  createdAt: string
  /** Browser label when this capture came from a cross-browser test run. */
  browser?: string
  /** Browser id (`chromium` | `firefox` | `webkit`) for browser captures. */
  browserId?: string
  /**
   * Preview seed override. Browser captures share the source snapshot's seed
   * so every browser renders the same underlying workspace and only the
   * seeded rendering drift differs — that is what the pixel diff measures.
   */
  previewSeed?: string
}

/**
 * Browser matrix for cross-browser snapshot testing. `chromium` is the
 * reference browser: its capture is the "expected" render and every other
 * browser's capture is pixel-diffed against it.
 */
export interface LabBrowser {
  id: string
  label: string
  /** Rendering engine tag shown next to the browser name. */
  engine: string
}

export const LAB_BROWSERS: LabBrowser[] = [
  { id: "chromium", label: "Chromium", engine: "Blink" },
  { id: "firefox", label: "Firefox", engine: "Gecko" },
  { id: "webkit", label: "WebKit", engine: "WebKit" },
]

/** Reference browser id for the cross-browser matrix. */
export const LAB_BROWSER_REFERENCE_ID = "chromium"

/**
 * Per-browser rendering drift (0–1): the fraction of mutable preview
 * elements a browser capture perturbs. Chromium is the reference (0), so
 * Firefox diffs stay small and WebKit diffs are larger — the mock stand-in
 * for real cross-browser rendering differences until a browser farm exists.
 */
export const LAB_BROWSER_RENDER_DELTA: Record<string, number> = {
  chromium: 0,
  firefox: 0.15,
  webkit: 0.6,
}

/** FNV-1a hash → 32-bit seed, same algorithm as `lab-snapshot-preview.ts`. */
function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Derive the per-browser capture of a snapshot for the cross-browser test
 * matrix. Deterministic: the same source + browser always produces the same
 * capture, so re-running "Test across browsers" yields identical rows.
 */
export function labBrowserSnapshot(source: LabSnapshot, browser: LabBrowser): LabSnapshot {
  // Small deterministic size wobble (±2 MB) so browser captures do not all
  // report the exact byte size of their source.
  const sizeDelta = ((hashString(`${source.id}:${browser.id}`) % 9) - 4) * 512 * 1024
  return {
    id: `${source.id}--${browser.id}`,
    name: `${source.name} — ${browser.label}`,
    environment: source.environment,
    browser: browser.label,
    browserId: browser.id,
    previewSeed: source.id,
    description: `Cross-browser capture of “${source.name}” rendered in ${browser.label} (${browser.engine}).`,
    sizeBytes: Math.max(0, source.sizeBytes + sizeDelta),
    createdAt: source.createdAt,
  }
}

export type LabSnapshotApprovalStatus = "pending" | "approved" | "rejected"

/**
 * Seeded review status per snapshot, keyed by snapshot id. `SnapshotsPanel`
 * keeps this in state so Approve/Reject can flip a capture's status until a
 * real snapshot backend exists — same pattern as `LAB_SNAPSHOT_BASELINES`.
 */
export const LAB_SNAPSHOT_APPROVALS: Record<string, LabSnapshotApprovalStatus> = {
  "snap-01": "approved",
  "snap-02": "pending",
  "snap-03": "approved",
  "snap-04": "rejected",
  "snap-05": "pending",
  "snap-06": "approved",
  "snap-07": "pending",
}

/**
 * Seeded baselines: the reference snapshot for each environment, keyed by the
 * environment display label (the same string snapshots carry in
 * `environment`). `SnapshotsPanel` keeps this in state so "Set baseline" can
 * switch the reference until a real snapshot backend exists.
 */
export const LAB_SNAPSHOT_BASELINES: Record<string, string> = {
  RStudio: "snap-01",
  JupyterLab: "snap-02",
  "VS Code": "snap-03",
  Terminal: "snap-04",
}

export const LAB_SNAPSHOTS: LabSnapshot[] = [
  {
    id: "snap-01",
    name: "Pre-analysis baseline",
    environment: "RStudio",
    description: "Workspace state before the November tide analysis pass.",
    sizeBytes: 48 * 1024 * 1024,
    createdAt: "2026-11-18T16:40:00.000Z",
  },
  {
    id: "snap-02",
    name: "Clean survey inputs",
    environment: "JupyterLab",
    description: "Validated survey exports ready for the cleaning notebook.",
    sizeBytes: 132 * 1024 * 1024,
    createdAt: "2026-11-17T09:05:00.000Z",
  },
  {
    id: "snap-03",
    name: "Species grid v2",
    environment: "VS Code",
    description: "Distribution grid after the coastal buffer fix.",
    sizeBytes: 96 * 1024 * 1024,
    createdAt: "2026-11-15T14:22:00.000Z",
  },
  {
    id: "snap-04",
    name: "Export bundle",
    environment: "Terminal",
    description: "Last packaged results archive before the schema bump.",
    sizeBytes: 12 * 1024 * 1024,
    createdAt: "2026-11-12T11:30:00.000Z",
  },
  {
    id: "snap-05",
    name: "Post-review state",
    environment: "RStudio",
    description: "Workspace after the analyst review pass; candidate new baseline.",
    sizeBytes: 51 * 1024 * 1024,
    createdAt: "2026-11-19T09:15:00.000Z",
  },
  {
    id: "snap-06",
    name: "Raw survey dump",
    environment: "JupyterLab",
    description: "Uncleaned survey export snapshot before the validation pass.",
    sizeBytes: 118 * 1024 * 1024,
    createdAt: "2026-11-16T08:45:00.000Z",
  },
  {
    id: "snap-07",
    name: "Species grid v3",
    environment: "VS Code",
    description: "Distribution grid after the coastline boundary fix.",
    sizeBytes: 104 * 1024 * 1024,
    createdAt: "2026-11-16T17:05:00.000Z",
  },
]

/* -------------------------------------------------------------------------- */
/* Notebook view (JupyterLab environment)                                      */
/* -------------------------------------------------------------------------- */

export interface LabNotebookTableColumn {
  /** Row key this column reads. */
  key: string
  label: string
}

/** Mock DataFrame preview rendered as a sortable table inside a cell output. */
export interface LabNotebookTable {
  columns: LabNotebookTableColumn[]
  rows: Record<string, string | number>[]
}

export interface LabNotebookOutput {
  id: string
  kind: "text" | "error" | "table"
  content: string
  /** Required when `kind === "table"`; ignored otherwise. */
  table?: LabNotebookTable
}

export interface LabNotebookCell {
  id: string
  /** Jupyter-style execution count; `null` for markdown cells. */
  executionCount: number | null
  kind: "code" | "markdown"
  source: string
  outputs: LabNotebookOutput[]
}

/**
 * Static cells for the mock Jupyter notebook. Outputs are pre-rendered so the
 * pane reads like an executed notebook; the Run buttons in `NotebookView`
 * simulate re-execution until a real kernel backend exists.
 */
export const LAB_NOTEBOOK_CELLS: LabNotebookCell[] = [
  {
    id: "cell-01",
    executionCount: null,
    kind: "markdown",
    source: "# Tidal analysis\n\nLoad the 2026 tidal export and inspect salinity by site.",
    outputs: [],
  },
  {
    id: "cell-02",
    executionCount: 1,
    kind: "code",
    source: 'import pandas as pd\n\ndf = pd.read_csv("data/tidal-2026.csv")\ndf.head()',
    outputs: [
      {
        id: "cell-02-out-1",
        kind: "text",
        content: "shape: (240, 3) · salinity mean 29.8 PSU",
      },
      {
        id: "cell-02-out-2",
        kind: "table",
        content: "",
        table: {
          columns: [
            { key: "site", label: "site" },
            { key: "salinity", label: "salinity (PSU)" },
            { key: "turbidity", label: "turbidity (NTU)" },
          ],
          rows: [
            { site: "Harbor North", salinity: 30.4, turbidity: 12.1 },
            { site: "Harbor South", salinity: 29.7, turbidity: 18.4 },
            { site: "Estuary Mouth", salinity: 28.9, turbidity: 34.2 },
            { site: "Reef Flat", salinity: 31.2, turbidity: 8.7 },
            { site: "Channel East", salinity: 27.6, turbidity: 41.5 },
            { site: "Channel West", salinity: 30.8, turbidity: 15.9 },
            { site: "Lagoon Inner", salinity: 32.1, turbidity: 6.3 },
            { site: "Outer Shoal", salinity: 26.9, turbidity: 48.2 },
          ],
        },
      },
    ],
  },
  {
    id: "cell-03",
    executionCount: 2,
    kind: "code",
    source: 'df.groupby("site")["salinity"].describe()',
    outputs: [
      {
        id: "cell-03-out-1",
        kind: "text",
        content:
          "count  mean   std   min   25%   50%   75%   max\n120   29.7  1.4   26.9  28.9  29.8  30.6  33.1",
      },
    ],
  },
  {
    id: "cell-04",
    executionCount: 3,
    kind: "code",
    source:
      'ax = df.plot.line(x="hour", y="salinity", by="site")\nax.figure.savefig("outputs/salinity-by-site.png")',
    outputs: [
      {
        id: "cell-04-out-1",
        kind: "text",
        content: "saved outputs/salinity-by-site.png (640×480)",
      },
    ],
  },
  {
    id: "cell-05",
    executionCount: 4,
    kind: "code",
    source:
      'model = df[df["quality"] == "good"].copy()\nmodel["salinity"].corr(model["turbidity"])',
    outputs: [
      {
        id: "cell-05-out-1",
        kind: "text",
        content: "-0.42",
      },
    ],
  },
]

export interface LabNotebookRevision {
  id: string
  /** Short revision tag, e.g. "rev-12". */
  label: string
  author: string
  createdAt: string
  /** One-line description of what changed in this revision. */
  summary: string
}

/**
 * Seeded notebook revision history, newest first. `NotebookView` keeps the
 * active pointer in state so "Restore" can roll the notebook back (mock)
 * until checkpoint storage exists.
 */
export const LAB_NOTEBOOK_HISTORY: LabNotebookRevision[] = [
  {
    id: "rev-12",
    label: "rev-12",
    author: "ada",
    createdAt: "2026-11-19T15:42:00.000Z",
    summary: "Filtered the salinity plot to quality-checked rows.",
  },
  {
    id: "rev-11",
    label: "rev-11",
    author: "ada",
    createdAt: "2026-11-18T11:20:00.000Z",
    summary: "Added the groupby describe cell for per-site salinity stats.",
  },
  {
    id: "rev-10",
    label: "rev-10",
    author: "bogdan",
    createdAt: "2026-11-17T09:05:00.000Z",
    summary: "Initial notebook scaffold with the tidal-2026 loader.",
  },
]

export const LAB_NOTEBOOK_CURRENT_REVISION = "rev-12"

/* -------------------------------------------------------------------------- */
/* Notebook templates                                                          */
/* -------------------------------------------------------------------------- */

export interface LabNotebookTemplate {
  id: string
  name: string
  description: string
  /** Display name used in the pane title and exported files. */
  fileName: string
  cells: LabNotebookCell[]
}

function templateCell(
  id: string,
  kind: LabNotebookCell["kind"],
  executionCount: number | null,
  source: string,
  output?: string,
): LabNotebookCell {
  return {
    id,
    kind,
    executionCount,
    source,
    outputs: output ? [{ id: `${id}-out`, kind: "text", content: output }] : [],
  }
}

/**
 * Pre-built notebook templates for the JupyterLab environment pane. Picking
 * one in the template dropdown swaps the whole notebook — same client-side
 * pattern as the seeded snapshot baselines until a notebook backend exists.
 */
export const LAB_NOTEBOOK_TEMPLATES: LabNotebookTemplate[] = [
  {
    id: "analysis",
    name: "analysis.ipynb",
    description: "The seeded tidal notebook shipped with the JupyterLab environment.",
    fileName: "analysis.ipynb",
    cells: LAB_NOTEBOOK_CELLS,
  },
  {
    id: "tidal-baseline",
    name: "Tide analysis baseline",
    description: "Harmonic decomposition of the November tidal dataset.",
    fileName: "tidal-analysis.ipynb",
    cells: [
      templateCell(
        "tidal-md-1",
        "markdown",
        null,
        "# Tide analysis baseline\n\nDecompose the November 2026 tidal record into harmonic constituents and check residual drift against the harbor baseline.",
      ),
      templateCell(
        "tidal-code-1",
        "code",
        1,
        'tidal = pd.read_csv("data/tidal-2026.csv")\ntidal.head()',
        "shape: (240, 3) · salinity mean 29.8 PSU",
      ),
      templateCell(
        "tidal-code-2",
        "code",
        2,
        'sites = gpd.read_file("data/sites.geojson")\nmodel = smf.ols("salinity ~ turbidity + C(site)", data=tidal).fit()\nmodel.summary()',
        "R-squared: 0.87 · residuals look clean",
      ),
    ],
  },
  {
    id: "survey-cleaning",
    name: "Survey cleaning pass",
    description: "Validate a survey export and flag low-confidence records.",
    fileName: "survey-cleaning.ipynb",
    cells: [
      templateCell(
        "survey-md-1",
        "markdown",
        null,
        "# Survey cleaning pass\n\nDrop empty rows, normalize site codes, and mark records below the confidence floor for review.",
      ),
      templateCell(
        "survey-code-1",
        "code",
        1,
        'raw = pd.read_csv("data/survey-export.csv")\nclean = raw.dropna(subset=["site", "reading"])\nclean["site"] = clean["site"].str.upper()\nclean.shape',
        "(1,284, 6) rows kept · 37 dropped",
      ),
      templateCell(
        "survey-code-2",
        "code",
        2,
        'low_conf = clean[clean["confidence"] < 0.6]\nlow_conf.to_csv("outputs/low-confidence.csv", index=False)',
        "outputs/low-confidence.csv written",
      ),
    ],
  },
  {
    id: "species-grid",
    name: "Species distribution grid",
    description: "Rasterize occurrence records into a coastal distribution grid.",
    fileName: "species-grid.ipynb",
    cells: [
      templateCell(
        "species-md-1",
        "markdown",
        null,
        "# Species distribution grid\n\nBuffer the coastline and rasterize Larus argentatus occurrences onto a 1 km grid.",
      ),
      templateCell(
        "species-code-1",
        "code",
        1,
        'occ = pd.read_csv("data/occurrences.csv")\ngrid = rasterize(occ, resolution_km=1, buffer_km=10)\ngrid.plot(figsize=(8, 6))',
        "grid: 214 cells · 61 occupied",
      ),
    ],
  },
]

/** Default template loaded when the JupyterLab pane first renders. */
export const LAB_NOTEBOOK_DEFAULT_TEMPLATE_ID = "analysis"

/**
 * Serialize notebook cells to a nbformat 4 document (`.ipynb`). Text outputs
 * become stream payloads, tables become `execute_result` text grids, errors
 * become error outputs, and markdown cells pass through as markdown.
 */
export function labNotebookToIpynb(cells: LabNotebookCell[]) {
  return {
    cells: cells.map((cell) => {
      const source = cell.source.split("\n")
      if (cell.kind === "markdown") {
        return { cell_type: "markdown", metadata: {}, source }
      }
      const outputs = cell.outputs.map((output) => {
        if (output.kind === "error") {
          return {
            output_type: "error",
            ename: "Error",
            evalue: output.content,
            traceback: [],
          }
        }
        if (output.kind === "table" && output.table) {
          const table = output.table
          const header = table.columns.map((column) => column.label).join("  ")
          const body = table.rows.map((row) =>
            table.columns.map((column) => String(row[column.key] ?? "")).join("  "),
          )
          return {
            output_type: "execute_result",
            execution_count: cell.executionCount,
            metadata: {},
            data: { "text/plain": [header, ...body].join("\n") },
          }
        }
        return {
          output_type: "stream",
          name: "stdout",
          text: output.content.split("\n"),
        }
      })
      return {
        cell_type: "code",
        execution_count: cell.executionCount,
        metadata: {},
        outputs,
        source,
      }
    }),
    metadata: {
      kernelspec: {
        display_name: "Python 3 (ipykernel)",
        language: "python",
        name: "python3",
      },
      language_info: { name: "python", version: "3.12.1" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
}

/** Rows appended to a notebook table output each time its cell re-runs. */
export const LAB_NOTEBOOK_APPENDED_ROWS_PER_RUN = 8

/**
 * Deterministic extra rows for one re-execution of a table-output cell.
 * Numeric columns jitter around their first-row value; string columns cycle
 * through the values already present, so appended batches read like fresh
 * readings of the same survey. Same `table` + `batch` always yields the same
 * rows, which keeps shared `?nbexec=` links reproducible.
 */
export function labNotebookAppendedRows(
  table: LabNotebookTable,
  batch: number,
): Record<string, string | number>[] {
  const prototype = table.rows[0] ?? {}
  const stringValues = new Map<string, string[]>()
  for (const column of table.columns) {
    if (typeof prototype[column.key] === "number") continue
    const seen = new Set<string>()
    for (const row of table.rows) {
      const value = row[column.key]
      if (typeof value === "string" && value !== "") seen.add(value)
    }
    stringValues.set(column.key, [...seen])
  }

  return Array.from({ length: LAB_NOTEBOOK_APPENDED_ROWS_PER_RUN }, (_, index) => {
    const n = batch * LAB_NOTEBOOK_APPENDED_ROWS_PER_RUN + index
    const row: Record<string, string | number> = {}
    for (const column of table.columns) {
      const base = prototype[column.key]
      if (typeof base === "number") {
        // ±0.5 jitter around the column's reference value, one decimal place.
        row[column.key] = Number((base + (((n * 37) % 11) - 5) / 10).toFixed(1))
      } else {
        const values = stringValues.get(column.key) ?? []
        row[column.key] = values.length > 0 ? values[n % values.length] : `${column.label} ${n + 1}`
      }
    }
    return row
  })
}

/* -------------------------------------------------------------------------- */
/* Performance benchmarks                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One simulated benchmark run for a snapshot capture: deterministic
 * render/capture timings standing in for real profiling until a benchmark
 * backend exists. `LabSession` carries only `createdAt`/`endedAt` and
 * `LabSnapshot` only `sizeBytes`/`createdAt`, so perf data is derived here —
 * same role as `labBrowserSnapshot` for the cross-browser matrix.
 */
export interface LabBenchmarkRun {
  /** Stable id: `${snapshotId}:bench-${runIndex}`. */
  id: string
  snapshotId: string
  /** 1-based index within the snapshot's benchmark history (oldest first). */
  runIndex: number
  /** Simulated environment render time in milliseconds. */
  renderMs: number
  /** Simulated screenshot/capture encode time in milliseconds. */
  captureMs: number
  /** `renderMs + captureMs`. */
  totalMs: number
  /** Deterministic timestamp just before the snapshot's `createdAt`. */
  createdAt: string
}

/** Benchmark runs seeded per snapshot for the history/compare UI. */
export const LAB_BENCHMARK_RUNS_PER_SNAPSHOT = 5

/** Hours between consecutive seeded benchmark runs. */
const LAB_BENCHMARK_RUN_SPACING_HOURS = 6

/**
 * Derive the seeded benchmark history for a snapshot. Timings scale mildly
 * with snapshot size (bigger captures render slower) plus a per-run jitter
 * from the snapshot id, so the same snapshot always yields the same runs and
 * different snapshots differ. The newest run lands one hour before the
 * snapshot's `createdAt`; earlier runs step back by
 * `LAB_BENCHMARK_RUN_SPACING_HOURS`.
 */
export function labSnapshotBenchmarkRuns(snapshot: LabSnapshot): LabBenchmarkRun[] {
  const sizeWeight = Math.round(Math.log2(snapshot.sizeBytes / (1024 * 1024)) * 18)
  const capturedAt = new Date(snapshot.createdAt).getTime()
  const base = Number.isNaN(capturedAt) ? Date.now() : capturedAt

  return Array.from({ length: LAB_BENCHMARK_RUNS_PER_SNAPSHOT }, (_, index) => {
    const runIndex = index + 1
    const seed = hashString(`${snapshot.id}:benchmark:${runIndex}`)
    const jitter = (bits: number) => ((seed >>> bits) % 1000) / 1000
    const renderMs = Math.round(90 + jitter(0) * 240 + sizeWeight)
    const captureMs = Math.round(30 + jitter(10) * 110)
    const createdAt = new Date(
      base -
        ((LAB_BENCHMARK_RUNS_PER_SNAPSHOT - runIndex) * LAB_BENCHMARK_RUN_SPACING_HOURS + 1) *
          3_600_000,
    ).toISOString()
    return {
      id: `${snapshot.id}:bench-${runIndex}`,
      snapshotId: snapshot.id,
      runIndex,
      renderMs,
      captureMs,
      totalMs: renderMs + captureMs,
      createdAt,
    }
  })
}
