/**
 * Geolocation-emulation probe for lab pages (playwright).
 *
 * For each preset location it creates a browser context with
 * `geolocation` + `permissions: ["geolocation"]`, loads the target route,
 * reads back `navigator.geolocation` coordinates inside the page, and
 * optionally captures a screenshot. Results → JSON report under
 * `.lab-snapshots/geolocation/` (or LAB_SNAPSHOT_DIR).
 *
 * Usage:
 *   tsx scripts/lab-geolocation.ts [--url <path>] [--routes a,b]
 *     [--base-url <url>] [--dir <path>] [--preset <name>] [--no-screenshot]
 *
 * Presets: nyc, london, tokyo, sydney, "deny" (permission denied path is
 * simulated by NOT granting the permission for the "denied" pseudo-preset).
 * Custom locations via LAB_GEO_PRESETS JSON:
 *   [{"name":"...","latitude":..,"longitude":..,"accuracy":..}]
 *
 * Env: PLAYWRIGHT_BASE_URL (default http://localhost:3000), LAB_SNAPSHOT_DIR.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"

interface GeoPreset {
  name: string
  latitude?: number
  longitude?: number
  accuracy?: number
  /** When true, the geolocation permission is denied. */
  denied?: boolean
}

const DEFAULT_PRESETS: GeoPreset[] = [
  { name: "nyc", latitude: 40.7128, longitude: -74.006, accuracy: 20 },
  { name: "london", latitude: 51.5074, longitude: -0.1278, accuracy: 20 },
  { name: "tokyo", latitude: 35.6762, longitude: 139.6503, accuracy: 20 },
  { name: "sydney", latitude: -33.8688, longitude: 151.2093, accuracy: 20 },
  { name: "denied", denied: true },
]

const DEFAULT_ROUTES = ["/lab"]

interface CliOptions {
  url?: string
  routes: string[]
  dir?: string
  baseUrl?: string
  preset?: string
  screenshot: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { routes: [], screenshot: true }
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
      case "--no-screenshot":
        opts.screenshot = false
        break
      default:
        if (argv[i].startsWith("--")) throw new Error(`Unknown option: ${argv[i]}`)
    }
  }
  return opts
}

function presets(): GeoPreset[] {
  const raw = process.env.LAB_GEO_PRESETS
  if (!raw) return DEFAULT_PRESETS
  try {
    const parsed = JSON.parse(raw) as GeoPreset[]
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((p) => p.name)) {
      return parsed
    }
  } catch {
    // fall through
  }
  return DEFAULT_PRESETS
}

interface GeoResult {
  preset: string
  route: string
  url: string
  /** What the page observed via navigator.geolocation. */
  observed?: { latitude: number; longitude: number; accuracy: number }
  /** True when getCurrentPosition errored (e.g. permission denied). */
  denied?: boolean
  errorCode?: number
  errorMessage?: string
  screenshot?: string
  capturedAt: string
}

/** Read geolocation inside the page with a timeout so the denied path
 * resolves via the error callback instead of hanging. */
async function readPageGeolocation(page: import("playwright").Page): Promise<{
  observed?: GeoResult["observed"]
  denied?: boolean
  errorCode?: number
  errorMessage?: string
}> {
  return page.evaluate(
    () =>
      new Promise((resolvePromise) => {
        if (!("geolocation" in navigator)) {
          resolvePromise({ errorMessage: "geolocation API unavailable" })
          return
        }
        const timer = setTimeout(
          () => resolvePromise({ errorMessage: "getCurrentPosition timed out" }),
          10_000,
        )
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer)
            resolvePromise({
              observed: {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              },
            })
          },
          (err) => {
            clearTimeout(timer)
            resolvePromise({
              denied: err.code === err.PERMISSION_DENIED,
              errorCode: err.code,
              errorMessage: err.message,
            })
          },
          { timeout: 8_000, maximumAge: 0 },
        )
      }),
  )
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2))
  const baseUrl = cli.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
  const routes = cli.url ? [cli.url] : cli.routes.length > 0 ? cli.routes : DEFAULT_ROUTES
  const all = presets()
  const matrix = cli.preset ? all.filter((p) => p.name === cli.preset) : all
  if (matrix.length === 0) {
    console.error(`Unknown preset "${cli.preset}". Available: ${all.map((p) => p.name).join(", ")}`)
    return 2
  }

  const outRoot = join(cli.dir ?? process.env.LAB_SNAPSHOT_DIR ?? ".lab-snapshots", "geolocation")
  await mkdir(outRoot, { recursive: true })

  const browser = await chromium.launch()
  const results: GeoResult[] = []

  try {
    for (const route of routes) {
      for (const preset of matrix) {
        const url = route.startsWith("http") ? route : `${baseUrl}${route}`
        const contextOptions: Parameters<typeof browser.newContext>[0] = {
          permissions: preset.denied ? [] : ["geolocation"],
        }
        if (!preset.denied && preset.latitude != null && preset.longitude != null) {
          contextOptions.geolocation = {
            latitude: preset.latitude,
            longitude: preset.longitude,
            accuracy: preset.accuracy ?? 20,
          }
        }
        const context = await browser.newContext(contextOptions)
        const page = await context.newPage()
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
          const geo = await readPageGeolocation(page)

          let screenshot: string | undefined
          if (cli.screenshot) {
            const safeRoute = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "root"
            const file = `${preset.name}__${safeRoute}.png`
            await page.screenshot({ path: join(outRoot, file), fullPage: false })
            screenshot = file
          }

          results.push({
            preset: preset.name,
            route,
            url,
            ...geo,
            screenshot,
            capturedAt: new Date().toISOString(),
          })
          const observed = geo.observed
            ? `${geo.observed.latitude.toFixed(4)},${geo.observed.longitude.toFixed(4)}`
            : geo.denied
              ? "denied"
              : `error: ${geo.errorMessage ?? geo.errorCode}`
          console.log(`${preset.name.padEnd(8)} ${route.padEnd(12)} → ${observed}`)
        } catch (error) {
          results.push({
            preset: preset.name,
            route,
            url,
            errorMessage: error instanceof Error ? error.message : String(error),
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

  const reportPath = join(outRoot, "geolocation-report.json")
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl,
        presets: matrix,
        results,
      },
      null,
      2,
    ),
  )
  const failures = results.filter((r) => r.errorMessage && !r.observed && !r.denied).length
  console.log(`\n${results.length} probe(s) → ${reportPath}`)
  return failures > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
