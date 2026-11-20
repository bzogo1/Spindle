"use client"

/**
 * Minimal snapshot-diff viewer for lab run outputs.
 *
 * Standalone on purpose: `lab-screen.tsx` is actively developed, so this
 * component takes plain image URLs (baseline / actual / diff PNGs, e.g. served
 * from an API route or object storage) and diff stats — wire it into the Lab
 * UI once a real snapshot backend exists.
 *
 * Views:
 *  - side:     baseline | actual | pixelmatch diff, side by side
 *  - overlay:  actual layered over baseline
 *  - heat:     actual with a perceptual-diff heatmap grid overlay
 *              (`heatmap` prop, from `comparePerceptual` in lab-snapshots)
 */

import { useState } from "react"

export interface SnapshotDiffStats {
  pass: boolean
  diffPixels: number
  totalPixels: number
  /** 0–1 fraction of changed pixels. */
  diffRatio: number
}

/** Coarse grid of per-cell diff ratios (0–1), row-major. */
export interface SnapshotHeatmap {
  columns: number
  rows: number
  /** `columns * rows` entries, each the cell's diff ratio. */
  cells: number[]
}

export interface PerceptualStats {
  /** Fraction of pixels with luminance delta > epsilon (0–1). */
  pixelDiffRatio: number
  /** Mean absolute luminance delta, 0–1. */
  meanLuminanceDelta: number
  /** SSIM-lite over the luminance grid, 0–1. */
  ssim: number
}

export interface SnapshotDiffViewerProps {
  title?: string
  baselineUrl: string
  actualUrl: string
  /** URL of the pixelmatch diff image; shown when provided. */
  diffUrl?: string | null
  stats?: SnapshotDiffStats | null
  /** Perceptual heatmap overlay data (enables the "Heatmap" view). */
  heatmap?: SnapshotHeatmap | null
  /** Perceptual summary stats shown in the footer when provided. */
  perceptual?: PerceptualStats | null
}

type ViewMode = "side" | "overlay" | "heat"

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(3)}%`
}

/** Map a 0–1 diff ratio to a heat color (blue → yellow → red). */
function heatColor(ratio: number): string {
  const t = Math.min(1, Math.max(0, ratio * 4)) // most diffs are < 25% per cell
  // Simple 3-stop ramp.
  if (t < 0.5) {
    const u = t / 0.5
    return `rgb(${Math.round(40 + 215 * u)},${Math.round(80 + 100 * u)},255)`
  }
  const u = (t - 0.5) / 0.5
  return `rgb(255,${Math.round(180 - 120 * u)},${Math.round(80 - 60 * u)})`
}

export function SnapshotDiffViewer({
  title = "Snapshot diff",
  baselineUrl,
  actualUrl,
  diffUrl,
  stats,
  heatmap,
  perceptual,
}: SnapshotDiffViewerProps) {
  const [view, setView] = useState<ViewMode>("side")
  const modes: ViewMode[] = heatmap ? ["side", "overlay", "heat"] : ["side", "overlay"]

  return (
    <section className="app-panel" aria-labelledby="snapshot-diff-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="snapshot-diff-heading">{title}</h2>
          <p>Baseline vs latest capture, with changed pixels highlighted.</p>
        </div>
        <div className="flex items-center gap-2">
          {stats ? (
            <span
              className={`app-badge ${stats.pass ? "is-succeeded" : "is-failed"}`}
              title={`${stats.diffPixels} of ${stats.totalPixels} pixels differ`}
            >
              {stats.pass ? "Match" : `${formatPct(stats.diffRatio)} diff`}
            </span>
          ) : null}
          <div className="flex gap-1" role="group" aria-label="Diff view mode">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`fm-btn${view === mode ? "fm-btn--solid" : ""}`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {mode === "side" ? "Side by side" : mode === "overlay" ? "Overlay" : "Heatmap"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "side" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <figure>
            <figcaption className="app-field-hint mb-1">Baseline</figcaption>
            <img src={baselineUrl} alt="Baseline snapshot" className="w-full rounded border" />
          </figure>
          <figure>
            <figcaption className="app-field-hint mb-1">Actual</figcaption>
            <img src={actualUrl} alt="Actual snapshot" className="w-full rounded border" />
          </figure>
          {diffUrl ? (
            <figure>
              <figcaption className="app-field-hint mb-1">Diff</figcaption>
              <img src={diffUrl} alt="Snapshot diff" className="w-full rounded border" />
            </figure>
          ) : null}
        </div>
      ) : view === "overlay" ? (
        <div className="relative inline-block">
          <img src={baselineUrl} alt="Baseline snapshot" className="rounded border opacity-40" />
          <img
            src={actualUrl}
            alt="Actual snapshot overlay"
            className="absolute inset-0 h-full w-full rounded border"
          />
        </div>
      ) : heatmap ? (
        <div className="relative inline-block">
          <img src={actualUrl} alt="Actual snapshot with diff heatmap" className="rounded border" />
          <div
            className="pointer-events-none absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${heatmap.columns}, 1fr)`,
              gridTemplateRows: `repeat(${heatmap.rows}, 1fr)`,
            }}
            aria-hidden="true"
          >
            {heatmap.cells.map((ratio, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: heatColor(ratio),
                  opacity: ratio > 0 ? 0.15 + Math.min(0.55, ratio * 2) : 0,
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {stats ? (
        <p className="app-field-hint mt-3">
          {stats.diffPixels.toLocaleString()} / {stats.totalPixels.toLocaleString()} pixels changed
          ({formatPct(stats.diffRatio)})
          {stats.pass ? " — within threshold." : " — exceeds threshold."}
        </p>
      ) : null}

      {perceptual ? (
        <p className="app-field-hint mt-1">
          Perceptual: {(perceptual.pixelDiffRatio * 100).toFixed(2)}% pixels above luma ε,{" "}
          {(perceptual.meanLuminanceDelta * 100).toFixed(2)}% mean Δluma, SSIM-lite{" "}
          {perceptual.ssim.toFixed(3)}.
        </p>
      ) : null}
    </section>
  )
}
