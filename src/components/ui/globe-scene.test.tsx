import { render } from "@testing-library/react"
import type { COBEOptions } from "cobe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GlobeScene } from "./globe-scene"

const createGlobe = vi.fn()
const update = vi.fn()

vi.mock("cobe", () => ({
  default: (...args: unknown[]) => createGlobe(...args),
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

// cobe v2 has no render loop: GlobeScene drives frames itself via
// requestAnimationFrame -> globe.update(state). jsdom does not implement
// rAF, so capture the scheduled callback and fire frames manually.
let rafQueue: FrameRequestCallback[] = []

function renderFrame(): Partial<COBEOptions> {
  const callback = rafQueue.shift()
  expect(callback).toBeDefined()
  callback!(0)
  expect(update).toHaveBeenCalled()
  return update.mock.calls.at(-1)?.[0] as Partial<COBEOptions>
}

const CUSTOM_CONFIG: COBEOptions = {
  width: 800,
  height: 800,
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.3,
  dark: 1,
  diffuse: 2,
  mapSamples: 1000,
  mapBrightness: 9,
  mapBaseBrightness: 0.5,
  baseColor: [0.1, 0.2, 0.3],
  markerColor: [0.4, 0.5, 0.6],
  glowColor: [0.7, 0.8, 0.9],
  markers: [],
}

describe("GlobeScene theme palette", () => {
  beforeEach(() => {
    document.documentElement.className = ""
    document.documentElement.removeAttribute("data-theme")
    update.mockClear()
    createGlobe.mockReturnValue({ update, destroy: vi.fn() })
    // jsdom has no WebGL; the component probes for a context before creating
    // the globe, so fake one to reach createGlobe.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never)

    rafQueue = []
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafQueue.push(callback)
      return rafQueue.length
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame
  })

  afterEach(() => {
    document.documentElement.className = ""
    document.documentElement.removeAttribute("data-theme")
    vi.restoreAllMocks()
  })

  it("uses the dark palette when the page is dark", () => {
    document.documentElement.classList.add("dark")
    render(<GlobeScene />)

    const state = renderFrame()
    expect(state.dark).toBe(1)
    expect(state.mapBrightness).toBe(6)
    expect(state.mapBaseBrightness).toBe(0)
    expect(state.glowColor).toEqual([0.34, 0.58, 0.3])
  })

  it("uses the light palette when the page is light", () => {
    document.documentElement.classList.add("light")
    render(<GlobeScene />)

    const state = renderFrame()
    expect(state.dark).toBe(0)
    // dark:0 alone is not enough — oceans need a floor and the glow must
    // soften or the sphere reads as a dark smudge on the light page.
    expect(state.mapBaseBrightness).toBeGreaterThan(0)
    expect(state.glowColor).not.toEqual([0.34, 0.58, 0.3])
    expect(state.baseColor).not.toEqual([0.55, 0.78, 0.5])
  })

  it("switches palette on theme change without recreating the globe", async () => {
    document.documentElement.classList.add("dark")
    render(<GlobeScene />)
    expect(renderFrame().dark).toBe(1)

    document.documentElement.classList.remove("dark")
    document.documentElement.classList.add("light")
    // MutationObserver callbacks are microtasks.
    await Promise.resolve()

    expect(renderFrame().dark).toBe(0)
    expect(createGlobe).toHaveBeenCalledTimes(1)
  })

  it("honours data-theme when no class is present", () => {
    document.documentElement.setAttribute("data-theme", "light")
    render(<GlobeScene />)

    expect(renderFrame().dark).toBe(0)
  })

  it("falls back to prefers-color-scheme with no class or data-theme", () => {
    // The setup matchMedia stub reports matches:false (light).
    render(<GlobeScene />)
    expect(renderFrame().dark).toBe(0)
  })

  it("leaves a custom config untouched by the theme palettes", () => {
    document.documentElement.classList.add("light")
    render(<GlobeScene config={CUSTOM_CONFIG} />)

    const state = renderFrame()
    expect(state.dark).toBeUndefined()
    expect(state.baseColor).toBeUndefined()
    // Rotation/resize uniforms still flow through update() for custom configs.
    expect(state.phi).toBeTypeOf("number")
    expect(state.width).toBe(0)
  })
})
