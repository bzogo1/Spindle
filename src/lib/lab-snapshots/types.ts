/**
 * Lab run snapshot types.
 *
 * A "lab run" in this codebase is currently a client-side mock
 * (`src/components/app/lab-mock.ts` + `lab-screen.tsx`); there is no backend
 * run model yet. These types are deliberately backend-agnostic so a real run
 * API can slot in later: a provider only needs a stable `runId` plus whatever
 * config produced the output.
 */

/** One captured image from a run (a run may produce several, e.g. per-cell). */
export interface SnapshotImage {
  /** Stable name for the image within the run, e.g. "main", "cell-3". */
  name: string
  /** PNG-encoded bytes. */
  png: Uint8Array
  width: number
  height: number
}

export interface SnapshotCaptureRequest {
  /** Stable identifier of the lab run being captured. */
  runId: string
  /** Optional tool/catalog id that produced the run. */
  toolId?: string
  /** Run parameters — part of the baseline key via `config`. */
  params?: Record<string, unknown>
  /**
   * Everything that affects the rendered output and therefore the baseline
   * key: viewport size, theme, font set, dynamic-region masks, etc.
   */
  config?: Record<string, unknown>
  /** Project scope, when the run belongs to a project. */
  projectId?: string
}

export interface SnapshotCaptureResult {
  images: SnapshotImage[]
  /** Provider-specific metadata (URL captured, renderer version, ...). */
  meta?: Record<string, unknown>
}

/**
 * Pluggable capture backend.
 *
 * Contract for a real implementation (e.g. a Playwright sidecar or a hosted
 * screenshot service):
 *
 * 1. Resolve the run's preview URL/state from `runId` (+ `projectId`).
 * 2. Render it in a deterministic environment: fixed viewport, fonts, theme,
 *    and `config.masks` applied (see `DiffOptions.maskRegions`) so dynamic
 *    regions (timestamps, sparklines) don't flake the diff.
 * 3. Wait for quiescence (network idle, fonts loaded, animations settled).
 * 4. Return one or more PNG screenshots as `SnapshotImage`s with stable
 *    `name`s — names must be deterministic across runs of the same config so
 *    baselines line up.
 *
 * Implementations must be deterministic for identical `config`: any source of
 * nondeterminism belongs in `config.masks` or the diff threshold.
 */
export interface SnapshotProvider {
  readonly name: string
  capture(request: SnapshotCaptureRequest): Promise<SnapshotCaptureResult>
}

/** A rectangular region excluded from comparison (dynamic content mask). */
export interface MaskRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface DiffOptions {
  /**
   * Per-pixel color threshold passed to pixelmatch (0–1, default 0.1).
   * Smaller = more sensitive. Raise this to tolerate anti-aliasing noise and
   * sub-pixel font rendering differences between platforms.
   */
  threshold?: number
  /**
   * Maximum allowed `diffPixels / totalPixels` for the comparison to pass
   * (default 0 — any changed pixel fails). Set e.g. 0.001 to allow a tiny
   * fraction of noise pixels.
   */
  maxDiffRatio?: number
  /**
   * Anti-aliasing handling. `false` (default) makes pixelmatch detect and
   * ignore anti-aliased pixels; `true` counts them as differences.
   */
  includeAA?: boolean
  /** Rectangles to exclude from comparison entirely. */
  maskRegions?: MaskRegion[]
  /**
   * If > 0, also produce a per-region breakdown by splitting the image into
   * `regionColumns` equal columns (rows follow the aspect ratio).
   */
  regionColumns?: number
  /** Override the highlight color of changed pixels in the diff image. */
  diffColor?: [number, number, number]
  /** Color for pixels that are darker in the actual image than the baseline. */
  diffColorAlt?: [number, number, number]
}

export interface RegionDiff {
  /** 0-based column/row of the region in the grid. */
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  diffPixels: number
  totalPixels: number
  diffRatio: number
}

export interface DiffResult {
  pass: boolean
  diffPixels: number
  totalPixels: number
  /** `diffPixels / totalPixels` (0–1). */
  diffRatio: number
  /** PNG-encoded diff visualization (changed pixels highlighted). */
  diffPng: Uint8Array
  /** Per-region breakdown, empty unless `regionColumns` was set. */
  regions: RegionDiff[]
  /** Effective thresholds used, echoed back for reporting. */
  options: Required<Pick<DiffOptions, "threshold" | "maxDiffRatio" | "includeAA">>
}
