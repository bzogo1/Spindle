"use client"

/**
 * Side-by-side snapshot comparison for the Lab screen.
 *
 * Until a real snapshot backend exists, previews are deterministic mock SVG
 * captures (`lab-snapshot-preview.ts`) and the pixel diff runs in the browser
 * on canvas — the server-side pixelmatch pipeline in `src/lib/lab-snapshots`
 * stays the source of truth for CI. When canvas is unavailable (jsdom, very
 * old browsers) the panel degrades to metadata + previews without diff stats.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent as ReactFormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react"
import { ArrowLeftRight, StickyNote, X } from "lucide-react"

import type { LabSnapshot } from "./lab-mock"
import {
  snapshotPreviewUrl,
  SNAPSHOT_PREVIEW_HEIGHT,
  SNAPSHOT_PREVIEW_WIDTH,
} from "./lab-snapshot-preview"
import { formatBytes, formatDateTime, formatRelativeTime } from "./format"
import { formatDurationMs } from "./agent-run-log-utils"
import {
  DEFAULT_SNAPSHOT_FAIL_PERCENT,
  DEFAULT_SNAPSHOT_WARN_PERCENT,
  formatDiffRatioPercent,
  labSnapshotDiffStatus,
  resolvePairThresholds,
  snapshotDiffStatusBadgeClass,
  snapshotDiffStatusLabel,
  useLabSnapshotThresholds,
  type LabSnapshotDiffStatus,
  type LabSnapshotThresholdOverride,
} from "./lab-snapshot-thresholds"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"

type CompareView = "side" | "overlay" | "diff"

/** Which preview an annotation is pinned to; absent for general notes. */
export type SnapshotAnnotationTarget = "A" | "B" | "diff"

export interface SnapshotAnnotation {
  id: string
  note: string
  target?: SnapshotAnnotationTarget
  /** Pin position as 0–1 fractions of the preview width/height. */
  x?: number
  y?: number
  createdAt: string
}

/** Draft for the annotation form — set by clicking a preview or "Add note". */
interface AnnotationDraft {
  target?: SnapshotAnnotationTarget
  x?: number
  y?: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function annotationTargetLabel(target: SnapshotAnnotationTarget | undefined): string {
  if (target === "A") return "A preview"
  if (target === "B") return "B preview"
  if (target === "diff") return "Diff preview"
  return "General note"
}

export interface SnapshotDiffImage {
  diffUrl: string
  diffPixels: number
  totalPixels: number
  /** 0–1 fraction of changed pixels. */
  diffRatio: number
  width: number
  height: number
}

/** Outcome of a completed comparison, reported to the snapshots panel so it
 * can badge each capture with its latest diff status. */
export interface SnapshotComparisonResult {
  baseId: string
  otherId: string
  status: LabSnapshotDiffStatus
  /** 0–1 fraction of changed pixels. */
  diffRatio: number
  diffPixels: number
  totalPixels: number
}

/** Per-channel Euclidean distance normalized to 0–1; mirrors pixelmatch's
 * `threshold` semantics closely enough for mock captures. */
const PIXEL_THRESHOLD = 0.1
const DIFF_COLOR: [number, number, number] = [255, 51, 85]

function pixelDelta(a: Uint8ClampedArray, ai: number, b: Uint8ClampedArray, bi: number): number {
  const dr = a[ai] - b[bi]
  const dg = a[ai + 1] - b[bi + 1]
  const db = a[ai + 2] - b[bi + 2]
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.67
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = window.setTimeout(() => {
      reject(new Error("Preview image load timed out"))
    }, 5000)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error("Preview image failed to load"))
    }
    image.src = src
  })
}

/**
 * Rasterize both previews and produce a diff visualization + stats.
 * Returns `null` when canvas 2D is unavailable; throws on decode failures.
 */
export async function computeSnapshotDiff(
  base: LabSnapshot,
  other: LabSnapshot,
): Promise<SnapshotDiffImage | null> {
  const probe = document.createElement("canvas")
  const context = probe.getContext("2d")
  if (!context) return null

  const [baseImage, otherImage] = await Promise.all([
    loadImage(snapshotPreviewUrl(base)),
    loadImage(snapshotPreviewUrl(other)),
  ])

  const width = SNAPSHOT_PREVIEW_WIDTH
  const height = SNAPSHOT_PREVIEW_HEIGHT
  const baseCanvas = document.createElement("canvas")
  baseCanvas.width = width
  baseCanvas.height = height
  const baseCtx = baseCanvas.getContext("2d")
  if (!baseCtx) return null
  baseCtx.drawImage(baseImage, 0, 0, width, height)
  const baseData = baseCtx.getImageData(0, 0, width, height)

  const otherCanvas = document.createElement("canvas")
  otherCanvas.width = width
  otherCanvas.height = height
  const otherCtx = otherCanvas.getContext("2d")
  if (!otherCtx) return null
  otherCtx.drawImage(otherImage, 0, 0, width, height)
  const otherData = otherCtx.getImageData(0, 0, width, height)

  const diffCanvas = document.createElement("canvas")
  diffCanvas.width = width
  diffCanvas.height = height
  const diffCtx = diffCanvas.getContext("2d")
  if (!diffCtx) return null
  const diffImage = diffCtx.createImageData(width, height)

  const totalPixels = width * height
  let diffPixels = 0
  for (let i = 0; i < totalPixels; i++) {
    const p = i * 4
    const changed = pixelDelta(otherData.data, p, baseData.data, p) > PIXEL_THRESHOLD
    if (changed) {
      diffPixels++
      diffImage.data[p] = DIFF_COLOR[0]
      diffImage.data[p + 1] = DIFF_COLOR[1]
      diffImage.data[p + 2] = DIFF_COLOR[2]
      diffImage.data[p + 3] = 255
    } else {
      // Dimmed grayscale baseline, like pixelmatch's unchanged-pixel render.
      const gray = Math.round(
        (baseData.data[p] * 0.299 + baseData.data[p + 1] * 0.587 + baseData.data[p + 2] * 0.114) *
          0.45,
      )
      diffImage.data[p] = gray
      diffImage.data[p + 1] = gray
      diffImage.data[p + 2] = gray
      diffImage.data[p + 3] = 255
    }
  }
  diffCtx.putImageData(diffImage, 0, 0)
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels
  return {
    diffUrl: diffCanvas.toDataURL("image/png"),
    diffPixels,
    totalPixels,
    diffRatio,
    width,
    height,
  }
}

function sizeDelta(base: LabSnapshot, other: LabSnapshot): string {
  const delta = other.sizeBytes - base.sizeBytes
  if (delta === 0) return "same size"
  const magnitude = formatBytes(Math.abs(delta))
  return delta > 0 ? `${magnitude} larger` : `${magnitude} smaller`
}

function createdDelta(base: LabSnapshot, other: LabSnapshot): string {
  const delta = new Date(other.createdAt).getTime() - new Date(base.createdAt).getTime()
  if (!Number.isFinite(delta) || delta === 0) return "same time"
  const magnitude = formatDurationMs(Math.abs(delta))
  return delta > 0 ? `${magnitude} later` : `${magnitude} earlier`
}

function MetaRow({
  label,
  baseValue,
  otherValue,
  baseDelta,
  otherDelta,
}: {
  label: string
  baseValue: string
  otherValue: string
  baseDelta?: string
  otherDelta?: string
}) {
  return (
    <div className="app-lab-compare-meta-row">
      <dt>{label}</dt>
      <dd>
        <span className="app-lab-compare-col-head">A</span> {baseValue}
        {baseDelta ? <span className="app-lab-compare-delta">{baseDelta}</span> : null}
      </dd>
      <dd>
        <span className="app-lab-compare-col-head">B</span> {otherValue}
        {otherDelta ? <span className="app-lab-compare-delta">{otherDelta}</span> : null}
      </dd>
    </div>
  )
}

/**
 * Number input for a diff-threshold percent. Keeps a local string while the
 * field is being edited (so partial input like "0." survives) and commits the
 * parsed percent on blur; an empty field commits `undefined` (inherit/reset).
 */
function ThresholdPercentInput({
  id,
  label,
  value,
  placeholder,
  onCommit,
}: {
  id: string
  label: string
  /** Current percent, or `undefined` when inheriting a fallback. */
  value: number | undefined
  placeholder?: string
  onCommit: (value: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value))
  // Resync when the committed value changes elsewhere (storage event, reset).
  useEffect(() => {
    setText(value === undefined ? "" : String(value))
  }, [value])

  return (
    <div className="app-field">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        step={0.01}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const trimmed = text.trim()
          if (trimmed === "") {
            onCommit(undefined)
            return
          }
          const parsed = Number(trimmed)
          onCommit(Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : undefined)
        }}
      />
    </div>
  )
}

function CompareFigure({
  label,
  snapshot,
  url,
  badge,
  annotations,
  onPin,
}: {
  label: SnapshotAnnotationTarget
  snapshot: LabSnapshot
  url: string
  badge?: string
  /** Annotations pinned to this figure's preview. */
  annotations?: SnapshotAnnotation[]
  onPin?: (target: SnapshotAnnotationTarget, x: number, y: number) => void
}) {
  const displayLabel = label === "diff" ? "Diff" : label
  const pins = (annotations ?? []).filter(
    (annotation) =>
      annotation.target === label && annotation.x !== undefined && annotation.y !== undefined,
  )
  return (
    <figure className="app-lab-compare-figure">
      <figcaption>
        <span className="app-lab-compare-col-head">{displayLabel}</span> {snapshot.name}
        {badge ? <span className="app-lab-compare-delta">{badge}</span> : null}
      </figcaption>
      <div
        className="app-lab-compare-media"
        role="button"
        tabIndex={0}
        aria-label={`Pin an annotation on the ${displayLabel} preview`}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          // Marker clicks (and clicks landing on one) must not start a new pin.
          if ((event.target as HTMLElement).closest(".app-lab-compare-marker")) return
          const rect = event.currentTarget.getBoundingClientRect()
          const x = rect.width > 0 ? clamp01((event.clientX - rect.left) / rect.width) : 0
          const y = rect.height > 0 ? clamp01((event.clientY - rect.top) / rect.height) : 0
          onPin?.(label, x, y)
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          onPin?.(label, 0.5, 0.5)
        }}
      >
        <img
          src={url}
          alt={`${displayLabel}: ${snapshot.name} preview`}
          width={SNAPSHOT_PREVIEW_WIDTH}
          height={SNAPSHOT_PREVIEW_HEIGHT}
        />
        {pins.map((annotation) => (
          <span
            key={annotation.id}
            className="app-lab-compare-marker"
            style={{ left: `${(annotation.x ?? 0) * 100}%`, top: `${(annotation.y ?? 0) * 100}%` }}
            title={annotation.note}
          />
        ))}
      </div>
    </figure>
  )
}

export function SnapshotComparePanel({
  base,
  other,
  baselineIds,
  headerActions,
  annotations: controlledAnnotations,
  onAddAnnotation,
  onRemoveAnnotation,
  onDiffResult,
  onSwap,
  onClose,
}: {
  /** First-selected snapshot — shown as column/side "A" (baseline). */
  base: LabSnapshot
  /** Second-selected snapshot — shown as column/side "B" (actual). */
  other: LabSnapshot
  /** Ids of snapshots that are their environment's baseline reference. */
  baselineIds?: ReadonlySet<string>
  /** Extra controls rendered at the start of the header action row. */
  headerActions?: ReactNode
  /**
   * Annotations for this snapshot pair. When omitted the panel keeps them in
   * local state; `SnapshotsPanel` passes a controlled list keyed by pair so
   * notes survive closing and reopening the comparison.
   */
  annotations?: SnapshotAnnotation[]
  onAddAnnotation?: (annotation: SnapshotAnnotation) => void
  onRemoveAnnotation?: (id: string) => void
  /**
   * Called once a pixel diff completes (and again if the effective thresholds
   * change the status), so the snapshots panel can badge each capture with
   * its latest comparison outcome.
   */
  onDiffResult?: (result: SnapshotComparisonResult) => void
  onSwap: () => void
  onClose: () => void
}) {
  const [view, setView] = useState<CompareView>("side")
  const [overlayOpacity, setOverlayOpacity] = useState(45)
  const [diff, setDiff] = useState<SnapshotDiffImage | null | "unavailable">(null)
  const [localAnnotations, setLocalAnnotations] = useState<SnapshotAnnotation[]>([])
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null)
  const [annotationNote, setAnnotationNote] = useState("")
  const annotationSeq = useRef(0)

  const annotations = controlledAnnotations ?? localAnnotations

  const startAnnotationDraft = (draft: AnnotationDraft) => {
    setAnnotationDraft(draft)
    setAnnotationNote("")
  }

  const handlePin = (target: SnapshotAnnotationTarget, x: number, y: number) => {
    startAnnotationDraft({ target, x, y })
  }

  const handleAnnotationSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const note = annotationNote.trim()
    if (!note || !annotationDraft) return
    const annotation: SnapshotAnnotation = {
      id: `ann-${Date.now().toString(36)}-${++annotationSeq.current}`,
      note,
      ...annotationDraft,
      createdAt: new Date().toISOString(),
    }
    if (onAddAnnotation) {
      onAddAnnotation(annotation)
    } else {
      setLocalAnnotations((previous) => [...previous, annotation])
    }
    setAnnotationDraft(null)
    setAnnotationNote("")
  }

  const handleRemoveAnnotation = (id: string) => {
    if (onRemoveAnnotation) {
      onRemoveAnnotation(id)
    } else {
      setLocalAnnotations((previous) => previous.filter((a) => a.id !== id))
    }
  }

  const baseUrl = snapshotPreviewUrl(base)
  const otherUrl = snapshotPreviewUrl(other)

  // Diff thresholds: global warn/fail percents plus optional per-snapshot
  // overrides, persisted to localStorage (see lab-snapshot-thresholds.ts).
  const { thresholds, updateGlobalThresholds, setSnapshotOverride } = useLabSnapshotThresholds()
  const resolvedThresholds = useMemo(
    () => resolvePairThresholds(thresholds, base.id, other.id),
    [thresholds, base.id, other.id],
  )

  useEffect(() => {
    let cancelled = false
    setDiff(null)
    computeSnapshotDiff(base, other)
      .then((result) => {
        if (!cancelled) setDiff(result ?? "unavailable")
      })
      .catch(() => {
        if (!cancelled) setDiff("unavailable")
      })
    return () => {
      cancelled = true
    }
  }, [base, other])

  const diffStatus =
    diff !== null && diff !== "unavailable"
      ? labSnapshotDiffStatus(diff.diffRatio, resolvedThresholds)
      : null

  // Report the outcome so the snapshots panel can badge each capture. The
  // status is recomputed when thresholds change, so a settings tweak updates
  // the reported result without re-running the pixel diff.
  useEffect(() => {
    if (!onDiffResult || !diffStatus || diff === null || diff === "unavailable") return
    onDiffResult({
      baseId: base.id,
      otherId: other.id,
      status: diffStatus,
      diffRatio: diff.diffRatio,
      diffPixels: diff.diffPixels,
      totalPixels: diff.totalPixels,
    })
  }, [onDiffResult, diffStatus, diff, base.id, other.id])

  const thresholdOverrideRows = [
    { slot: "A", snapshot: base },
    { slot: "B", snapshot: other },
  ] as const
  const overrideSnapshotName = resolvedThresholds.overrideSnapshotId
    ? resolvedThresholds.overrideSnapshotId === other.id
      ? other.name
      : base.name
    : null

  const commitSnapshotOverride = (snapshotId: string, patch: LabSnapshotThresholdOverride) => {
    const current = thresholds.overrides[snapshotId] ?? {}
    const next: LabSnapshotThresholdOverride = { ...current }
    for (const [key, value] of Object.entries(patch) as [
      keyof LabSnapshotThresholdOverride,
      number | undefined,
    ][]) {
      if (value === undefined) {
        delete next[key]
      } else {
        next[key] = value
      }
    }
    setSnapshotOverride(snapshotId, next)
  }

  return (
    <div className="app-lab-compare" aria-label="Snapshot comparison">
      <div className="app-lab-compare-head">
        <div>
          <h3>Snapshot comparison</h3>
          <p>
            <strong>A</strong> {base.name} vs <strong>B</strong> {other.name} — mock captures,
            diffed in the browser.
          </p>
        </div>
        <div className="app-lab-compare-actions">
          {headerActions}
          <div className="flex gap-1" role="group" aria-label="Comparison view mode">
            {(
              [
                ["side", "Side by side"],
                ["overlay", "Overlay"],
                ["diff", "Diff"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`fm-btn${view === mode ? "fm-btn--solid" : ""}`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="fm-btn" onClick={onSwap}>
            <ArrowLeftRight aria-hidden="true" className="size-3.5" />
            Swap
          </button>
          <button type="button" className="fm-btn" onClick={onClose} aria-label="Close comparison">
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </div>

      <dl className="app-lab-compare-meta">
        <MetaRow label="Environment" baseValue={base.environment} otherValue={other.environment} />
        {base.browser || other.browser ? (
          <MetaRow
            label="Browser"
            baseValue={base.browser ?? "—"}
            otherValue={other.browser ?? "—"}
          />
        ) : null}
        <MetaRow
          label="Size"
          baseValue={formatBytes(base.sizeBytes)}
          otherValue={formatBytes(other.sizeBytes)}
          otherDelta={sizeDelta(base, other)}
        />
        <MetaRow
          label="Created"
          baseValue={formatDateTime(base.createdAt)}
          otherValue={formatDateTime(other.createdAt)}
          otherDelta={createdDelta(base, other)}
        />
        <MetaRow label="Description" baseValue={base.description} otherValue={other.description} />
      </dl>

      {diff !== null && diff !== "unavailable" && diffStatus ? (
        <p className="app-lab-compare-stats">
          <span className={`app-badge ${snapshotDiffStatusBadgeClass(diffStatus)}`}>
            {snapshotDiffStatusLabel(diffStatus)}
          </span>{" "}
          {diff.diffPixels.toLocaleString()} / {diff.totalPixels.toLocaleString()} pixels changed (
          {formatDiffRatioPercent(diff.diffRatio)})
          {diffStatus === "pass"
            ? " — within thresholds."
            : diffStatus === "warn"
              ? ` — above the ${resolvedThresholds.warnPercent}% warn threshold.`
              : ` — exceeds the ${resolvedThresholds.failPercent}% fail threshold.`}
        </p>
      ) : diff === "unavailable" ? (
        <p className="app-field-hint">
          Pixel diff is unavailable in this browser — showing previews only.
        </p>
      ) : (
        <p className="app-field-hint" role="status">
          Computing pixel diff…
        </p>
      )}

      <section className="app-lab-compare-thresholds" aria-label="Diff thresholds">
        <h4>Diff thresholds</h4>
        <p className="app-field-hint">
          A comparison warns when the changed-pixel ratio exceeds the warn threshold and fails above
          the fail threshold. Effective for this pair: warn {resolvedThresholds.warnPercent}% · fail{" "}
          {resolvedThresholds.failPercent}% (
          {overrideSnapshotName ? `override for ${overrideSnapshotName}` : "global defaults"}
          ). B&apos;s override wins over A&apos;s; empty fields inherit the global values. Saved in
          this browser.
        </p>
        <div className="app-lab-threshold-grid">
          <ThresholdPercentInput
            id="lab-threshold-warn"
            label="Warn threshold (%)"
            value={thresholds.warnPercent}
            onCommit={(value) =>
              updateGlobalThresholds({
                warnPercent: value ?? DEFAULT_SNAPSHOT_WARN_PERCENT,
              })
            }
          />
          <ThresholdPercentInput
            id="lab-threshold-fail"
            label="Fail threshold (%)"
            value={thresholds.failPercent}
            onCommit={(value) =>
              updateGlobalThresholds({
                failPercent: value ?? DEFAULT_SNAPSHOT_FAIL_PERCENT,
              })
            }
          />
        </div>
        <div className="app-lab-threshold-overrides">
          {thresholdOverrideRows.map(({ slot, snapshot }) => {
            const override = thresholds.overrides[snapshot.id]
            const hasOverride = override !== undefined
            return (
              <div key={snapshot.id} className="app-lab-threshold-override">
                <div className="app-lab-threshold-override-head">
                  <strong>
                    {slot} · {snapshot.name}
                  </strong>
                  {hasOverride ? (
                    <button
                      type="button"
                      className="fm-btn"
                      onClick={() => setSnapshotOverride(snapshot.id, null)}
                    >
                      Reset to global
                    </button>
                  ) : null}
                </div>
                <div className="app-lab-threshold-override-fields">
                  <ThresholdPercentInput
                    id={`lab-threshold-${snapshot.id}-warn`}
                    label="Warn threshold (%)"
                    value={override?.warnPercent}
                    placeholder={`Global ${thresholds.warnPercent}%`}
                    onCommit={(value) =>
                      commitSnapshotOverride(snapshot.id, { warnPercent: value })
                    }
                  />
                  <ThresholdPercentInput
                    id={`lab-threshold-${snapshot.id}-fail`}
                    label="Fail threshold (%)"
                    value={override?.failPercent}
                    placeholder={`Global ${thresholds.failPercent}%`}
                    onCommit={(value) =>
                      commitSnapshotOverride(snapshot.id, { failPercent: value })
                    }
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {view === "side" ? (
        <div className="app-lab-compare-figures">
          <CompareFigure
            label="A"
            snapshot={base}
            url={baseUrl}
            badge={baselineIds?.has(base.id) ? "Baseline" : undefined}
            annotations={annotations}
            onPin={handlePin}
          />
          <CompareFigure
            label="B"
            snapshot={other}
            url={otherUrl}
            badge={baselineIds?.has(other.id) ? "Baseline" : undefined}
            annotations={annotations}
            onPin={handlePin}
          />
          {diff !== null && diff !== "unavailable" ? (
            <CompareFigure
              label="diff"
              snapshot={other}
              url={diff.diffUrl}
              badge={formatDiffRatioPercent(diff.diffRatio)}
              annotations={annotations}
              onPin={handlePin}
            />
          ) : null}
        </div>
      ) : view === "overlay" ? (
        <div className="app-lab-compare-overlay-wrap">
          <div className="app-lab-compare-overlay">
            <img
              src={baseUrl}
              alt={`A: ${base.name} preview`}
              width={SNAPSHOT_PREVIEW_WIDTH}
              height={SNAPSHOT_PREVIEW_HEIGHT}
            />
            <img
              src={otherUrl}
              alt={`B: ${other.name} preview overlay`}
              width={SNAPSHOT_PREVIEW_WIDTH}
              height={SNAPSHOT_PREVIEW_HEIGHT}
              style={{ opacity: overlayOpacity / 100 }}
            />
          </div>
          <div className="app-lab-compare-opacity">
            <span className="app-field-hint">B opacity</span>
            <Slider
              value={overlayOpacity}
              onValueChange={(next) =>
                setOverlayOpacity(typeof next === "number" ? next : (next[0] ?? 45))
              }
              min={0}
              max={100}
              step={5}
              aria-label="Overlay opacity"
              className="flex-1"
            />
            <span className="app-lab-slider-value">{overlayOpacity}%</span>
          </div>
        </div>
      ) : diff !== null && diff !== "unavailable" ? (
        <div className="app-lab-compare-figures">
          <CompareFigure
            label="diff"
            snapshot={other}
            url={diff.diffUrl}
            badge={`${diff.diffPixels.toLocaleString()} px${
              baselineIds?.has(other.id) ? " · Baseline" : ""
            }`}
            annotations={annotations}
            onPin={handlePin}
          />
        </div>
      ) : diff === "unavailable" ? (
        <p className="app-field-hint">Pixel diff is unavailable in this browser.</p>
      ) : (
        <p className="app-field-hint">Diff preview is still computing…</p>
      )}

      <section className="app-lab-compare-annotations" aria-label="Annotations">
        <div className="app-lab-compare-annotations-head">
          <h4>Annotations{annotations.length > 0 ? ` (${annotations.length})` : ""}</h4>
          <button type="button" className="fm-btn" onClick={() => startAnnotationDraft({})}>
            <StickyNote aria-hidden="true" className="size-3.5" />
            Add note
          </button>
        </div>
        <p className="app-field-hint">
          Click a preview to pin a note to it, or add a general note for this comparison.
        </p>
        {annotationDraft ? (
          <form className="app-lab-compare-annotation-form" onSubmit={handleAnnotationSubmit}>
            <p className="app-field-hint">
              {annotationDraft.target !== undefined &&
              annotationDraft.x !== undefined &&
              annotationDraft.y !== undefined
                ? `Pinned to the ${annotationTargetLabel(annotationDraft.target)} at ${Math.round(
                    annotationDraft.x * 100,
                  )}% · ${Math.round(annotationDraft.y * 100)}%.`
                : "General note — not pinned to a preview."}
            </p>
            <Textarea
              value={annotationNote}
              onChange={(event) => setAnnotationNote(event.target.value)}
              placeholder="What should the reviewer look at?"
              rows={2}
              maxLength={500}
              aria-label="Annotation note"
              autoFocus
            />
            <div className="app-lab-compare-annotation-form-actions">
              <button
                type="submit"
                className="fm-btn fm-btn--solid"
                disabled={!annotationNote.trim()}
              >
                Add annotation
              </button>
              <button
                type="button"
                className="fm-btn"
                onClick={() => {
                  setAnnotationDraft(null)
                  setAnnotationNote("")
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {annotations.length > 0 ? (
          <ul className="app-lab-compare-annotation-list">
            {annotations.map((annotation) => (
              <li key={annotation.id} className="app-lab-compare-annotation">
                <span className="app-lab-compare-annotation-marker" aria-hidden="true" />
                <div className="app-lab-compare-annotation-body">
                  <p>{annotation.note}</p>
                  <span className="app-lab-compare-annotation-meta">
                    {annotationTargetLabel(annotation.target)}
                    {annotation.x !== undefined && annotation.y !== undefined
                      ? ` · ${Math.round(annotation.x * 100)}% · ${Math.round(annotation.y * 100)}%`
                      : ""}{" "}
                    · {formatRelativeTime(annotation.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="fm-btn"
                  aria-label={`Remove annotation: ${annotation.note}`}
                  onClick={() => handleRemoveAnnotation(annotation.id)}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-field-hint">No annotations yet.</p>
        )}
      </section>
    </div>
  )
}
