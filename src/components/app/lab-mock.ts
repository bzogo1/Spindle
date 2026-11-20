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
