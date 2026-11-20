import { expect, type BrowserContext, type Page } from "playwright/test"

/**
 * Shared helpers for visual regression specs.
 *
 * Determinism strategy:
 * - A fixed clock is installed before navigation so every `Date.now()` /
 *   `new Date()` in the page (mock API store, relative timestamps, presence
 *   buckets) resolves to the same instant on every run and every machine.
 *   `clock.resume()` keeps timers flowing in real time afterwards, so lazy
 *   chunks, fonts and React all behave normally.
 * - `reducedMotion: "reduce"` makes the vanilla-JS demos on the marketing
 *   site (typing loops, animated counters, agent trace) render their final
 *   state immediately instead of looping.
 * - CSS animations/transitions are neutralised by `animations: "disabled"`
 *   in `toHaveScreenshot`.
 * - Canvases (WebGL globe, dither fields) are masked because their pixels are
 *   GPU/driver dependent.
 */

export const VISUAL_CLOCK_TIME = new Date("2026-01-15T12:00:00.000Z")

/** Cookie name used by the mock-auth `(app)` guard. Mirrors src/lib/auth/mock-session.ts. */
const MOCK_SESSION_COOKIE = "spindle_mock_session"

const VISUAL_SESSION = {
  user: { name: "Ada Lovelace", email: "ada@spindle.dev" },
  workspace: { name: "Research team", slug: "research-team" },
  signedInAt: VISUAL_CLOCK_TIME.toISOString(),
}

function encodeMockSession(session: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(session))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Navigates with all determinism measures in place and waits for the page to
 * settle: `load`, best-effort `networkidle`, and `document.fonts.ready`.
 */
export async function gotoVisual(page: Page, path: string) {
  await page.clock.install({ time: VISUAL_CLOCK_TIME })
  await page.clock.resume()
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    try {
      // Pre-decide cookie consent so the marketing banner never covers the
      // captured frame (same payload shape as src/lib/consent.ts).
      const consent = encodeURIComponent(
        JSON.stringify({
          version: "1.0",
          timestamp: "2026-01-15T12:00:00.000Z",
          analytics: false,
          replay: false,
        }),
      )
      document.cookie = `spindle_consent=${consent}; path=/`
      // The app shell defaults to dark; pin it so the theme script never
      // depends on leftover state.
      window.localStorage.setItem("spindle-app-theme", "dark")
    } catch {
      // localStorage may be unavailable very early; the theme script has its own fallback.
    }
  })
  await page.goto(path, { waitUntil: "load" })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // Some pages keep a connection open (HMR, analytics); fonts + fixed clock
    // are enough for a stable frame.
  })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // Wait for images and for the document height to stop shifting — lazy
  // sections and images without intrinsic size keep growing the page after
  // networkidle, which makes fullPage screenshots non-deterministic.
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, {
      timeout: 10_000,
    })
    .catch(() => {})
  let lastHeight = -1
  for (let i = 0; i < 25; i++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    if (height === lastHeight) break
    lastHeight = height
    await page.waitForTimeout(400)
  }
  // Let reveal-on-scroll / intersection-observer states flush before capture.
  await page.waitForTimeout(300)
}

/** Plants the mock-session cookie so the `(app)` server guard lets us in. */
export async function signInToMockApp(context: BrowserContext, baseURL: string | undefined) {
  const url = baseURL ?? "http://localhost:3100"
  await context.addCookies([
    {
      name: MOCK_SESSION_COOKIE,
      value: encodeMockSession(VISUAL_SESSION),
      url,
    },
  ])
}

export type VisualScreenshotOptions = {
  /** Capture the full scrollable page instead of just the viewport. */
  fullPage?: boolean
}

/**
 * Screenshot assertion with flake-resistant defaults. Baselines live in
 * `e2e/visual/baselines/<spec>/<name>-<project>-<platform>.png` (see
 * `snapshotPathTemplate` in playwright.visual.config.ts).
 */
export async function expectVisual(
  page: Page,
  name: string,
  options: VisualScreenshotOptions = {},
) {
  // Freeze rAF-driven animation (WebGL globe, counters, demos) before the
  // shot: `mask` excludes canvases from the pixel diff but Playwright's
  // "two consecutive stable screenshots" check still compares them, so a
  // live render loop would time out before a baseline is ever written.
  // Already-scheduled callbacks fire once; their re-schedule becomes a no-op.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0
  })
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    fullPage: options.fullPage ?? true,
    mask: [page.locator("canvas")],
    threshold: 0.25,
    maxDiffPixelRatio: 0.01,
  })
}
