/**
 * Network-throttling probe for lab pages (playwright + CDP).
 *
 * For each network preset it loads the target route with Chromium DevTools
 * Protocol `Network.emulateNetworkConditions` applied, records navigation
 * timing (domContentLoaded / load / resource counts), and writes a JSON
 * report under `.lab-snapshots/network/` (or LAB_SNAPSHOT_DIR).
 *
 * Usage:
 *   tsx scripts/lab-network-throttle.ts [--url <path>] [--routes a,b]
 *     [--base-url <url>] [--dir <path>] [--preset slow-3g]
 *
 * Presets (CDP latency/throughput):
 *   offline   — navigator offline + 0 throughput
 *   slow-3g   — 400ms RTT, ~50KB/s down / ~25KB/s up  ("Slow 3G")
 *   fast-3g   — 150ms RTT, ~200KB/s down / ~100KB/s up ("Fast 3G")
 *   lte       — 70ms RTT, ~1.6MB/s down / ~750KB/s up
 *   none      — no throttling (baseline)
 *
 * Env: PLAYWRIGHT_BASE_URL (default http://localhost:3000), LAB_SNAPSHOT_DIR.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"

interface ThrottlePreset {
  name: string
  /** CDP: latency ms, download/upload throughput bytes/s. null = no emulation. */
  latency?: number | null
  downloadThroughput?: number | null
  uploadThroughput?: number | null
  offline?: boolean
}

const PRESETS: ThrottlePreset[] = [
  { name: "none" },
  { name: "offline", offline: true },
  {
    name: "slow-3g",
    latency: 400,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 25 * 1024,
  },
  {
    name: "fast-3g",
    latency: 150,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 100 * 1024,
  },
  {
    name: "lte",
    latency: 70,
    downloadThroughput: 1600 * 1024,
    uploadThroughput: 750 * 1024,
  },
]

const DEFAULT_ROUTES = ["/lab"]

interface CliOptions {
  url?: string
  routes: string[]
  dir?: string
  baseUrl?: string
  preset?: string
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { routes: [] }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--url":
        opts.url = next()
        break
      case "--routes":
        opts.routes = next()
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
        break
      case "--dir":
        opts.dir = next()
        break
      case "--base-url":
        opts.baseUrl = next()
        break
      case "--preset":
        opts.preset = next()
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  return opts
}

interface TimingResult {
  preset: string
  route: string
  url: string
  offline?: boolean
  domContentLoadedMs?: number
  loadMs?: number
  responseEndMs?: number
  transferSize?: number
  resourceCount?: number
  error?: string
  capturedAt: string
}

async function probe(
  page: import("playwright").Page,
  preset: ThrottlePreset,
  url: string,
): Promise<Omit<TimingResult, "preset" | "route" | "url" | "capturedAt">> {
  const cdp = await page.context().newCDPSession(page)
  try {
    if (preset.offline) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      })
    } else if (preset.latency != null) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: preset.latency,
        downloadThroughput: preset.downloadThroughput ?? -1,
        uploadThroughput: preset.uploadThroughput ?? -1,
      })
    } else {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
    }

    const response = await page.goto(url, { waitUntil: "load", timeout: 60_000 })
    const timing = await page.evaluate(() => {
      const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[]
      const resources = performance.getEntriesByType("resource")
      return {
        domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : undefined,
        loadMs: nav ? nav.loadEventEnd : undefined,
        responseEndMs: nav ? nav.responseEnd : undefined,
        transferSize: nav ? nav.transferSize : undefined,
        resourceCount: resources.length,
      }
    })
    return { ...timing, offline: preset.offline }
  } finally {
    await cdp.detach().catch(() => {})
  }
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  const baseUrl = cli.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
  const routes = cli.url ? [cli.url] : cli.routes.length > 0 ? cli.routes : DEFAULT_ROUTES
  const presets = cli.preset ? PRESETS.filter((p) => p.name === cli.preset) : PRESETS
  if (presets.length === 0) {
    console.error(
      `Unknown preset "${cli.preset}". Available: ${PRESETS.map((p) => p.name).join(", ")}`,
    )
    return 2
  }

  const outRoot = join(cli.dir ?? process.env.LAB_SNAPSHOT_DIR ?? ".lab-snapshots", "network")
  await mkdir(outRoot, { recursive: true })

  const browser = await chromium.launch()
  const results: TimingResult[] = []

  try {
    for (const route of routes) {
      for (const preset of presets) {
        const url = route.startsWith("http") ? route : `${baseUrl}${route}`
        // Fresh context per preset so offline state never leaks between runs.
        const context = await browser.newContext()
        const page = await context.newPage()
        try {
          const probeResult = await probe(page, preset, url)
          results.push({
            preset: preset.name,
            route,
            url,
            ...probeResult,
            capturedAt: new Date().toISOString(),
          })
          const load = probeResult.loadMs != null ? `${Math.round(probeResult.loadMs)}ms` : "n/a"
          console.log(`${preset.name.padEnd(9)} ${route.padEnd(12)} load=${load}`)
        } catch (error) {
          results.push({
            preset: preset.name,
            route,
            url,
            error: error instanceof Error ? error.message : String(error),
            capturedAt: new Date().toISOString(),
          })
          console.error(`FAILED ${preset.name} ${route}: ${error}`)
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }

  const reportPath = join(outRoot, "throttle-report.json")
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl,
        presets: PRESETS,
        results,
      },
      null,
      2,
    ),
  )
  const failures = results.filter((r) => r.error).length
  console.log(`\n${results.length - failures}/${results.length} probes ok → ${reportPath}`)
  return failures > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
