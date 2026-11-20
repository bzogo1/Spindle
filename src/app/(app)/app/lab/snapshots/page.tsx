import { PNG } from "pngjs"

import { AppPage } from "@/components/app/app-page"
import { SnapshotDiffViewer } from "@/components/lab/snapshot-diff-viewer"
import { SnapshotAnalysisPanel } from "@/components/lab/snapshot-analysis-panel"
import { PerfReportPanel } from "@/components/lab/perf-report-panel"
import { A11yReportPanel } from "@/components/lab/a11y-report-panel"
import {
  analyzeHtmlForA11y,
  analyzeSnapshotDiff,
  buildPerfBaselines,
  comparePerceptual,
  compareSnapshots,
  evaluatePerfReport,
  type CaptureMetrics,
} from "@/lib/lab-snapshots"

export const dynamic = "force-dynamic"

const W = 320
const H = 200

/** Deterministic "workspace capture": window chrome, sidebar, chart blocks. */
function renderCapture(variant: "baseline" | "actual"): Uint8Array {
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      // Background: dark UI gradient.
      png.data[i] = 16 + Math.floor((x / W) * 8)
      png.data[i + 1] = 21 + Math.floor((y / H) * 10)
      png.data[i + 2] = 31
      png.data[i + 3] = 255
    }
  }
  const rect = (x0: number, y0: number, w: number, h: number, r: number, g: number, b: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        const i = (y * W + x) * 4
        png.data[i] = r
        png.data[i + 1] = g
        png.data[i + 2] = b
      }
    }
  }

  // Title bar — differs between variants (layout-ish change).
  rect(0, 0, W, 24, variant === "baseline" ? 30 : 90, variant === "baseline" ? 41 : 60, 51)
  // Sidebar.
  rect(0, 24, 56, H - 24, 26, 32, 44)
  // Content panel.
  rect(64, 32, W - 72, 80, 35, 43, 58)
  // Chart bars — one bar changes height/color in "actual".
  const barHeights = [30, 44, 58, 40, 66]
  for (let i = 0; i < barHeights.length; i++) {
    const h = variant === "actual" && i === 2 ? barHeights[i] + 18 : barHeights[i]
    rect(80 + i * 44, 96 - h, 28, h, 91, 140, 255)
  }
  // Status strip.
  rect(64, 150, W - 72, 34, variant === "baseline" ? 24 : 60, 30, 40)
  return new Uint8Array(PNG.sync.write(png))
}

function dataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`
}

/** Sample markup with deliberate issues for the static a11y panel. */
const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<body>
  <h1>Run output</h1>
  <h3>Skipped heading level</h3>
  <img src="chart.png">
  <input type="text" placeholder="notes">
  <p style="color:#777777;background:#888888;">Low contrast note</p>
</body>
</html>`

export default function LabSnapshotsPage() {
  const baselinePng = renderCapture("baseline")
  const actualPng = renderCapture("actual")

  const diff = compareSnapshots(actualPng, baselinePng, { regionColumns: 4 })
  const analysis = analyzeSnapshotDiff(diff, { name: "workspace-capture", gridColumns: 8 })
  const perceptual = comparePerceptual(actualPng, baselinePng)
  const a11y = analyzeHtmlForA11y(SAMPLE_HTML)

  // Demo perf data: stable history + one regressed capture.
  const history: CaptureMetrics[] = [
    { name: "workspace-capture", durationMs: 420, bytes: 18_400 },
    { name: "workspace-capture", durationMs: 455, bytes: 18_900 },
    { name: "workspace-capture", durationMs: 438, bytes: 18_200 },
  ]
  const baselines = buildPerfBaselines(history)
  const current: CaptureMetrics[] = [
    { name: "workspace-capture", durationMs: 690, bytes: 19_100 },
    { name: "sidebar-capture", durationMs: 180, bytes: 9_800 },
  ]
  const perf = evaluatePerfReport(current, baselines, {
    maxDurationMs: 1_000,
    maxBytes: 100_000,
  })

  return (
    <AppPage
      title="Snapshot intelligence"
      lede="Heuristic diff analysis, perceptual comparison, capture performance, and static accessibility checks for lab run snapshots. Demo data is generated deterministically on each render."
    >
      <div className="grid gap-4">
        <SnapshotDiffViewer
          title="Workspace capture — baseline vs actual"
          baselineUrl={dataUri(baselinePng)}
          actualUrl={dataUri(actualPng)}
          diffUrl={dataUri(diff.diffPng)}
          stats={{
            pass: diff.pass,
            diffPixels: diff.diffPixels,
            totalPixels: diff.totalPixels,
            diffRatio: diff.diffRatio,
          }}
          heatmap={{
            columns: perceptual.grid.columns,
            rows: perceptual.grid.rows,
            cells: perceptual.heatmap.map((c) => c.diffRatio),
          }}
          perceptual={{
            pixelDiffRatio: perceptual.pixelDiffRatio,
            meanLuminanceDelta: perceptual.meanLuminanceDelta,
            ssim: perceptual.ssim,
          }}
        />
        <SnapshotAnalysisPanel analysis={analysis} />
        <PerfReportPanel report={perf} />
        <A11yReportPanel report={a11y} />
      </div>
    </AppPage>
  )
}
