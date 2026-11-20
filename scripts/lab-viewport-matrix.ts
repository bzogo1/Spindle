/**
 * Cross-device/viewport snapshot matrix capture (lab task: cross-device testing).
 *
 * Drives Playwright directly (not the test runner) to capture screenshots of
 * one or more routes across a device/viewport preset matrix, writing PNGs +
 * a manifest under `.lab-snapshots/viewport/` (or LAB_SNAPSHOT_DIR).
 *
 * Usage:
 *   tsx scripts/lab-viewport-matrix.ts [--url <path>] [--routes a,b] [--dir <path>]
 *     [--base-url <url>] [--headed] [--list]
 *
 * Presets mirror common device classes; override with LAB_VIEWPORT_PRESETS
 * as JSON: [{"name":"...","width":..,"height":..,"deviceScaleFactor":..,"isMobile":..,"hasTouch":..}]
 *
 * Env:
 *   PLAYWRIGHT_BASE_URL  default http://localhost:3000
 *   LAB_SNAPSHOT_DIR     default .lab-snapshots
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type BrowserContextOptions } from "playwright"

interface ViewportPreset {
  name: string
  width: number
  height: number
  deviceScaleFactor?: number
  isMobile?: boolean
  hasTouch?: boolean
  userAgent?: string
}

const DEFAULT_PRESETS: ViewportPreset[] = [
  {
    name: "mobile-s",
    width: 320,
    height: 568,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "mobile-l",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  { name: "laptop", width: 1280, height: 800, deviceScaleFactor: 1 },
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "wide", width: 1920, height: 1080, deviceScaleFactor: 1 },
]

const DEFAULT_ROUTES = ["/lab"]

interface CliOptions {
  url?: string
  routes: string[]
  dir?: string
  baseUrl?: string
  headed: boolean
  list: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { routes: [], headed: false, list: false }
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
      case "--headed":
        opts.headed = true
        break
      case "--list":
        opts.list = true
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  return opts
}

function presets(): ViewportPreset[] {
  const raw = process.env.LAB_VIEWPORT_PRESETS
  if (!raw) return DEFAULT_PRESETS
  try {
    const parsed = JSON.parse(raw) as ViewportPreset[]
    if (Array.isArray(parsed) && parsed.every((p) => p.name && p.width && p.height)) {
      return parsed
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_PRESETS
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  const baseUrl = cli.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
  const routes = cli.url ? [cli.url] : cli.routes.length > 0 ? cli.routes : DEFAULT_ROUTES
  const matrix = presets()

  if (cli.list) {
    console.log("Viewport presets:")
    for (const p of matrix) console.log(`  ${p.name}: ${p.width}x${p.height}`)
    console.log(`Routes: ${routes.join(", ")}`)
    return 0
  }

  const outRoot = join(cli.dir ?? process.env.LAB_SNAPSHOT_DIR ?? ".lab-snapshots", "viewport")
  await mkdir(outRoot, { recursive: true })

  const browser = await chromium.launch({ headless: !cli.headed })
  const manifest: Record<string, unknown>[] = []
  const startedAt = Date.now()

  try {
    for (const preset of matrix) {
      const contextOptions: BrowserContextOptions = {
        viewport: { width: preset.width, height: preset.height },
        deviceScaleFactor: preset.deviceScaleFactor ?? 1,
        isMobile: preset.isMobile,
        hasTouch: preset.hasTouch,
        userAgent: preset.userAgent,
      }
      const context = await browser.newContext(contextOptions)
      const page = await context.newPage()

      for (const route of routes) {
        const safeRoute = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "root"
        const file = `${preset.name}__${safeRoute}.png`
        const outPath = join(outRoot, file)
        const url = route.startsWith("http") ? route : `${baseUrl}${route}`
        const t0 = Date.now()
        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 })
          await page.evaluate(() => document.fonts?.ready)
          await page.screenshot({ path: outPath, fullPage: false })
          manifest.push({
            preset: preset.name,
            width: preset.width,
            height: preset.height,
            route,
            file,
            url,
            durationMs: Date.now() - t0,
            capturedAt: new Date().toISOString(),
          })
          console.log(`captured ${preset.name} ${route} → ${file}`)
        } catch (error) {
          manifest.push({
            preset: preset.name,
            route,
            url,
            error: error instanceof Error ? error.message : String(error),
            capturedAt: new Date().toISOString(),
          })
          console.error(`FAILED ${preset.name} ${route}: ${error}`)
        }
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }

  const manifestPath = join(outRoot, "manifest.json")
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        baseUrl,
        presets: matrix,
        captures: manifest,
      },
      null,
      2,
    ),
  )
  const failures = manifest.filter((m) => m.error).length
  console.log(
    `\n${manifest.length - failures}/${manifest.length} captures written to ${outRoot} (manifest: ${manifestPath})`,
  )
  return failures > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
