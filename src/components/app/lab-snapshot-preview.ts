/**
 * Deterministic mock "workspace capture" previews for lab snapshots.
 *
 * There is no snapshot backend yet, so the compare UI renders a synthetic
 * SVG "capture" per snapshot — same role as `lab-mock.ts` fixtures. The SVG
 * is seeded by the snapshot id, so the same snapshot always produces the
 * same image and two snapshots produce visibly different (but structured)
 * captures that the client-side diff can highlight.
 *
 * Browser-safe: no Node imports. Keep it that way — `src/lib/lab-snapshots`
 * pulls in pngjs and must stay server-side.
 */

import { LAB_BROWSER_RENDER_DELTA, type LabSnapshot } from "./lab-mock"

export const SNAPSHOT_PREVIEW_WIDTH = 320
export const SNAPSHOT_PREVIEW_HEIGHT = 200

/** FNV-1a hash → 32-bit seed. */
function seedFromString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** mulberry32 PRNG — same algorithm as the mock snapshot provider. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PREVIEW_BG = "#10151f"
const PREVIEW_PANEL = "#1a2233"
const PREVIEW_LINE = "#2b3a55"
const PREVIEW_TEXT = "#8b98b0"
const PREVIEW_ACCENT = "#5b8cff"

function barColor(rand: () => number): string {
  const hues = [210, 160, 30, 340]
  const hue = hues[Math.floor(rand() * hues.length)]
  const light = 45 + Math.floor(rand() * 20)
  return `hsl(${hue} 70% ${light}%)`
}

/**
 * Render the mock capture as an SVG string. Layout is intentionally stable
 * across snapshots (window chrome, sidebar, grid) so pixel diffs localize to
 * the seeded chart bars, trend line, and accent block.
 *
 * Browser captures (`snapshot.browser` set, see `labBrowserSnapshot`) share
 * the source snapshot's `previewSeed`, so every browser draws the same
 * canonical layout; a per-browser drift roll then perturbs a seeded fraction
 * of the mutable elements (`LAB_BROWSER_RENDER_DELTA`). That drift is the
 * mock stand-in for real cross-browser rendering differences.
 */
export function snapshotPreviewSvg(snapshot: LabSnapshot): string {
  const isBrowserCapture = snapshot.browser !== undefined
  const seed = isBrowserCapture ? (snapshot.previewSeed ?? snapshot.id) : snapshot.id
  const rand = mulberry32(
    seedFromString(isBrowserCapture ? seed : `${seed}:${snapshot.environment}`),
  )
  const driftRand = isBrowserCapture
    ? mulberry32(seedFromString(`${seed}:drift:${snapshot.browserId ?? snapshot.browser}`))
    : null
  const drift = isBrowserCapture ? (LAB_BROWSER_RENDER_DELTA[snapshot.browserId ?? ""] ?? 0.3) : 0
  /** Perturb a canonical value when the browser's drift roll hits. */
  const drifted = (value: number, magnitude: number): number => {
    if (!driftRand || driftRand() >= drift) return value
    return value + Math.round((driftRand() * 2 - 1) * magnitude)
  }

  // Chart: 6 bars with seeded heights and colors.
  const barCount = 6
  const barWidth = 22
  const barGap = 10
  const chartX = 132
  const chartBaseY = 168
  const maxBarHeight = 96
  const bars = Array.from({ length: barCount }, (_, index) => {
    const height = drifted(18 + Math.floor(rand() * maxBarHeight), 12)
    const x = chartX + index * (barWidth + barGap)
    return { x, height, color: barColor(rand) }
  })

  // Trend line across the plot area.
  const trendPoints: string[] = []
  for (let i = 0; i <= 8; i++) {
    const x = 128 + i * 20
    const y = drifted(120 + Math.floor(rand() * 40), 14)
    trendPoints.push(`${x},${y}`)
  }

  // Sidebar file rows: fixed count, seeded widths so the diff stays local.
  const fileRows = Array.from({ length: 4 }, (_, index) => {
    const y = 44 + index * 16
    const width = drifted(40 + Math.floor(rand() * 60), 14)
    return { y, width }
  })

  // Accent block in the corner — seeded position/size.
  const accent = {
    x: drifted(236 + Math.floor(rand() * 48), 10),
    y: drifted(40 + Math.floor(rand() * 24), 10),
    w: drifted(28 + Math.floor(rand() * 20), 8),
    h: drifted(18 + Math.floor(rand() * 14), 8),
  }

  const barsSvg = bars
    .map(
      (bar) =>
        `<rect x="${bar.x}" y="${chartBaseY - bar.height}" width="${barWidth}" height="${bar.height}" rx="3" fill="${bar.color}"/>`,
    )
    .join("")

  const fileRowsSvg = fileRows
    .map(
      (row) =>
        `<rect x="20" y="${row.y}" width="${row.width}" height="6" rx="3" fill="${PREVIEW_LINE}"/>`,
    )
    .join("")

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SNAPSHOT_PREVIEW_WIDTH}" height="${SNAPSHOT_PREVIEW_HEIGHT}" viewBox="0 0 ${SNAPSHOT_PREVIEW_WIDTH} ${SNAPSHOT_PREVIEW_HEIGHT}">`,
    `<rect width="${SNAPSHOT_PREVIEW_WIDTH}" height="${SNAPSHOT_PREVIEW_HEIGHT}" fill="${PREVIEW_BG}"/>`,
    // Window chrome.
    `<rect width="${SNAPSHOT_PREVIEW_WIDTH}" height="22" fill="${PREVIEW_PANEL}"/>`,
    `<circle cx="14" cy="11" r="3.5" fill="#ff5f57"/>`,
    `<circle cx="26" cy="11" r="3.5" fill="#febc2e"/>`,
    `<circle cx="38" cy="11" r="3.5" fill="#28c840"/>`,
    `<text x="52" y="15" font-family="ui-monospace,monospace" font-size="10" fill="${PREVIEW_TEXT}">${escapeXml(snapshot.name)}</text>`,
    // Sidebar.
    `<rect x="10" y="32" width="104" height="156" rx="6" fill="${PREVIEW_PANEL}"/>`,
    fileRowsSvg,
    // Plot frame.
    `<rect x="124" y="32" width="186" height="156" rx="6" fill="${PREVIEW_PANEL}"/>`,
    `<line x1="124" y1="${chartBaseY}" x2="310" y2="${chartBaseY}" stroke="${PREVIEW_LINE}" stroke-width="1"/>`,
    barsSvg,
    `<polyline points="${trendPoints.join(" ")}" fill="none" stroke="${PREVIEW_ACCENT}" stroke-width="2"/>`,
    `<rect x="${accent.x}" y="${accent.y}" width="${accent.w}" height="${accent.h}" rx="4" fill="${PREVIEW_ACCENT}" opacity="0.85"/>`,
    `</svg>`,
  ].join("")
}

/** `data:` URL usable directly as an `<img src>` for the mock capture. */
export function snapshotPreviewUrl(snapshot: LabSnapshot): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(snapshotPreviewSvg(snapshot))}`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
