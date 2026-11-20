"use client"

/**
 * Cross-browser test matrix for the Lab screen's Snapshots panel.
 *
 * "Test across browsers" derives one mock capture per browser
 * (`labBrowserSnapshot` in `lab-mock.ts`) and pixel-diffs each against the
 * reference browser's capture — the same canvas diff and warn/fail thresholds
 * the snapshot comparison panel uses. Until a real browser farm exists the
 * per-browser difference is seeded rendering drift in the mock previews
 * (`LAB_BROWSER_RENDER_DELTA`), so statuses are deterministic.
 */

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import {
  LAB_BROWSER_REFERENCE_ID,
  LAB_BROWSERS,
  type LabBrowser,
  type LabSnapshot,
} from "./lab-mock"
import { computeSnapshotDiff } from "./lab-snapshot-compare"
import {
  SNAPSHOT_PREVIEW_HEIGHT,
  SNAPSHOT_PREVIEW_WIDTH,
  snapshotPreviewUrl,
} from "./lab-snapshot-preview"
import {
  formatDiffRatioPercent,
  labSnapshotDiffStatus,
  resolvePairThresholds,
  snapshotDiffStatusBadgeClass,
  snapshotDiffStatusLabel,
  useLabSnapshotThresholds,
} from "./lab-snapshot-thresholds"
import { formatBytes, formatDateTime } from "./format"

/** Per-capture diff outcome: `undefined` while computing, `"unavailable"`
 * when canvas 2D is missing, otherwise the 0–1 changed-pixel ratio. */
type BrowserDiffResult = number | "unavailable" | undefined

function browserForCapture(capture: LabSnapshot): LabBrowser | undefined {
  return LAB_BROWSERS.find((browser) => browser.id === capture.browserId)
}

export function SnapshotBrowserMatrix({
  source,
  captures,
  onComparePair,
  onClose,
}: {
  /** Snapshot the browser captures were derived from. */
  source: LabSnapshot
  /** One capture per browser, in `LAB_BROWSERS` order. */
  captures: LabSnapshot[]
  /** Open the snapshot comparison with `base` (reference) vs `other`. */
  onComparePair: (base: LabSnapshot, other: LabSnapshot) => void
  onClose: () => void
}) {
  const reference =
    captures.find((capture) => capture.browserId === LAB_BROWSER_REFERENCE_ID) ??
    captures[0] ??
    null
  const { thresholds } = useLabSnapshotThresholds()
  const [diffs, setDiffs] = useState<Record<string, BrowserDiffResult>>({})

  // Diff every non-reference capture against the reference browser's capture.
  useEffect(() => {
    if (!reference) return
    let cancelled = false
    setDiffs({})
    for (const capture of captures) {
      if (capture.id === reference.id) continue
      computeSnapshotDiff(reference, capture)
        .then((result) => {
          if (cancelled) return
          setDiffs((previous) => ({
            ...previous,
            [capture.id]: result ? result.diffRatio : "unavailable",
          }))
        })
        .catch(() => {
          if (!cancelled) {
            setDiffs((previous) => ({ ...previous, [capture.id]: "unavailable" }))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [reference, captures])

  const referenceBrowser = reference ? browserForCapture(reference) : undefined

  return (
    <div className="app-lab-compare" role="region" aria-label="Cross-browser test matrix">
      <div className="app-lab-compare-head">
        <div>
          <h3>Cross-browser test</h3>
          <p>
            Mock render of <strong>{source.name}</strong> across {LAB_BROWSERS.length} browsers —
            each capture is pixel-diffed against{" "}
            {referenceBrowser ? referenceBrowser.label : "the reference browser"}.
          </p>
        </div>
        <div className="app-lab-compare-actions">
          <button
            type="button"
            className="fm-btn"
            onClick={onClose}
            aria-label="Close browser matrix"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </div>

      <ul className="app-lab-snapshot-list">
        {captures.map((capture) => {
          const browser = browserForCapture(capture)
          const isReference = reference !== null && capture.id === reference.id
          const diff = isReference ? undefined : diffs[capture.id]
          const diffRatio = typeof diff === "number" ? diff : null
          const resolved =
            reference && diffRatio !== null
              ? resolvePairThresholds(thresholds, reference.id, capture.id)
              : null
          const status =
            resolved && diffRatio !== null ? labSnapshotDiffStatus(diffRatio, resolved) : null
          return (
            <li key={capture.id} className="app-lab-snapshot-row app-lab-browser-row">
              <span className="app-lab-browser-thumb">
                <img
                  src={snapshotPreviewUrl(capture)}
                  alt={`${browser?.label ?? capture.browser ?? "Browser"} capture preview`}
                  width={SNAPSHOT_PREVIEW_WIDTH}
                  height={SNAPSHOT_PREVIEW_HEIGHT}
                />
              </span>
              <div className="app-lab-snapshot-main">
                <span className="app-lab-snapshot-title">
                  <strong>{browser?.label ?? capture.browser ?? capture.name}</strong>
                  {browser ? <span className="app-badge is-baseline">{browser.engine}</span> : null}
                  {isReference ? (
                    <span className="app-badge is-baseline">Reference</span>
                  ) : status ? (
                    <span
                      className={`app-badge ${snapshotDiffStatusBadgeClass(status)}`}
                      title={`Pixel diff vs ${referenceBrowser?.label ?? "reference"}: ${diffRatio !== null ? formatDiffRatioPercent(diffRatio) : "unavailable"}`}
                    >
                      {snapshotDiffStatusLabel(status)}
                    </span>
                  ) : null}
                </span>
                <span className="app-lab-snapshot-meta">
                  {capture.environment} · {formatBytes(capture.sizeBytes)} ·{" "}
                  {formatDateTime(capture.createdAt)}
                </span>
                <span className="app-field-hint">
                  {isReference
                    ? "Reference render — other browsers are diffed against this capture."
                    : diff === "unavailable"
                      ? "Pixel diff is unavailable in this browser — showing the capture only."
                      : diffRatio !== null
                        ? `${formatDiffRatioPercent(diffRatio)} of pixels differ from ${referenceBrowser?.label ?? "the reference"}${status ? ` (${snapshotDiffStatusLabel(status).toLowerCase()})` : ""}.`
                        : "Computing pixel diff…"}
                </span>
              </div>
              <div className="app-lab-snapshot-actions">
                <button
                  type="button"
                  className="fm-btn"
                  disabled={isReference || !reference}
                  onClick={() => {
                    if (reference) onComparePair(reference, capture)
                  }}
                >
                  Compare
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
