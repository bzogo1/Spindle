"use client"

import { useEffect, useRef } from "react"
import createGlobe, { type COBEOptions } from "cobe"
import * as Sentry from "@sentry/nextjs"

import { cn } from "@/lib/utils"

const MOVEMENT_DAMPING = 1400

/**
 * Dark-theme palette. cobe 0.6.5 re-reads `dark`, `diffuse`, `mapBrightness`,
 * `mapBaseBrightness`, `baseColor`, `markerColor`, and `glowColor` from the
 * onRender state every frame, so `GlobeScene` swaps in GLOBE_CONFIG_LIGHT's
 * values when the page is in light mode — no `update()`/rebuild needed.
 */
const GLOBE_CONFIG: COBEOptions = {
  // Init-cost budget: the texture bake (mapSamples) and the backing-store
  // size dominate first paint. 640px at ≤1.5 dpr is indistinguishable at
  // the sizes this globe renders, and `devicePixelRatio` is additionally
  // clamped to `min(dpr, 1.5)` at createGlobe time below.
  width: 640,
  height: 640,
  onRender: () => {},
  devicePixelRatio: 1.5,
  phi: 0,
  theta: 0.3,
  dark: 1,
  diffuse: 1.1,
  mapSamples: 10000,
  mapBrightness: 6,
  // Keep the oceans dark so the continent dots read as an earth map.
  mapBaseBrightness: 0,
  baseColor: [0.55, 0.78, 0.5],
  // Spindle accent green instead of the default Magic UI orange.
  markerColor: [200 / 255, 240 / 255, 131 / 255],
  glowColor: [0.34, 0.58, 0.3],
  markers: [
    { location: [14.5995, 120.9842], size: 0.03 },
    { location: [19.076, 72.8777], size: 0.1 },
    { location: [23.8103, 90.4125], size: 0.05 },
    { location: [30.0444, 31.2357], size: 0.07 },
    { location: [39.9042, 116.4074], size: 0.08 },
    { location: [-23.5505, -46.6333], size: 0.1 },
    { location: [19.4326, -99.1332], size: 0.1 },
    { location: [40.7128, -74.006], size: 0.1 },
    { location: [34.6937, 135.5022], size: 0.05 },
    { location: [41.0082, 28.9784], size: 0.06 },
  ],
}

/**
 * Light-theme palette. `dark: 0` alone would leave the sphere looking like a
 * flat dark smudge on light pages — cobe's shader mixes the earth map against
 * a `pow(g, .4)` falloff and adds `glowColor` as a halo — so the light variant
 * also lowers the map brightness, raises the ocean floor, deepens the base
 * green for contrast against the light page background, and softens the glow.
 */
const GLOBE_CONFIG_LIGHT: COBEOptions = {
  ...GLOBE_CONFIG,
  dark: 0,
  diffuse: 1.2,
  mapBrightness: 4,
  // Oceans need a nonzero floor or they vanish into the light background.
  mapBaseBrightness: 0.15,
  baseColor: [0.5, 0.7, 0.45],
  markerColor: [0.42, 0.6, 0.18],
  glowColor: [0.18, 0.34, 0.16],
}

/**
 * Theme truth for the globe. The site theme script toggles `.dark` on
 * <html>; `light` class / `data-theme` cover other hosts, and
 * prefers-color-scheme is the last resort (same sources the dither field
 * watches via its MutationObserver + matchMedia pair).
 */
function readGlobeDark(): boolean {
  const root = document.documentElement
  if (root.classList.contains("dark")) return true
  if (root.classList.contains("light")) return false
  const dataTheme = root.getAttribute("data-theme")
  if (dataTheme === "dark") return true
  if (dataTheme === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** Palette uniforms swapped per theme; everything else stays from `config`. */
const THEME_UNIFORM_KEYS = [
  "dark",
  "diffuse",
  "mapBrightness",
  "mapBaseBrightness",
  "baseColor",
  "markerColor",
  "glowColor",
] as const

export function GlobeScene({
  className,
  config = GLOBE_CONFIG,
}: {
  className?: string
  config?: COBEOptions
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phiRef = useRef(0)
  const widthRef = useRef(0)
  const pointerInteracting = useRef<number | null>(null)
  const reducedMotion = useRef<MediaQueryList | null>(null)
  /** Drag target rotation offset, in radians. */
  const dragTarget = useRef(0)
  /** Smoothed offset actually applied to phi; eases toward dragTarget. */
  const dragOffset = useRef(0)
  /** Current theme; read each frame by onRender to pick the palette. */
  const darkRef = useRef(true)
  /** Tracks IntersectionObserver state for the render-pause gate. */
  const inViewRef = useRef(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const updatePointerInteraction = (value: number | null) => {
    pointerInteracting.current = value
    if (canvasRef.current) {
      canvasRef.current.style.cursor = value !== null ? "grabbing" : "grab"
    }
  }

  const updateMovement = (clientX: number) => {
    if (pointerInteracting.current !== null) {
      dragTarget.current += (clientX - pointerInteracting.current) / MOVEMENT_DAMPING
    }
  }

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)")
    darkRef.current = readGlobeDark()

    // Theme switches usually toggle `.dark`/`data-theme` on <html>; the
    // prefers-color-scheme listener covers "system" mode following the OS.
    // cobe renders every frame, so flipping the ref is enough — the next
    // onRender picks up the new palette with no rebuild.
    const themeObserver = new MutationObserver(() => {
      darkRef.current = readGlobeDark()
    })
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const onSchemeChange = () => {
      darkRef.current = readGlobeDark()
    }
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    darkQuery.addEventListener("change", onSchemeChange)

    const onResize = () => {
      if (canvasRef.current) {
        widthRef.current = canvasRef.current.offsetWidth
      }
    }

    window.addEventListener("resize", onResize)
    onResize()

    // Cap the backing-store density for the built-in globe: above 1.5x the
    // extra pixels are invisible at this render size but cost fill-rate and
    // texture memory. Custom configs keep their own devicePixelRatio.
    const pixelRatio =
      config === GLOBE_CONFIG
        ? Math.min(window.devicePixelRatio || 1, 1.5)
        : (config.devicePixelRatio ?? 1)

    const globe = (() => {
      const canvas = canvasRef.current
      if (!canvas) return null

      // cobe needs WebGL. Some environments (headless browsers, older GPUs,
      // WebGL disabled) do not have it, and cobe throws a TypeError when the
      // context is null. Skip the decorative globe instead of crashing.
      try {
        const probe = document.createElement("canvas")
        const context = probe.getContext("webgl2") || probe.getContext("webgl")
        if (!context) return null
      } catch {
        return null
      }

      try {
        return createGlobe(canvas, {
          ...config,
          // The built-in globe clamps dpr; custom configs pass through.
          ...(config === GLOBE_CONFIG ? { devicePixelRatio: pixelRatio } : {}),
          width: widthRef.current * 2,
          height: widthRef.current * 2,
          onRender: (state) => {
            // Auto-rotation is decorative; under prefers-reduced-motion the
            // globe only turns while the visitor drags it.
            if (!pointerInteracting.current && !reducedMotion.current?.matches) {
              phiRef.current += 0.005
            }
            // Ease the displayed offset toward the drag target each frame,
            // replacing the motion spring this component used to use.
            dragOffset.current += (dragTarget.current - dragOffset.current) * 0.08
            state.phi = phiRef.current + dragOffset.current
            // `w` must match the canvas backing-store size
            // (clientWidth × devicePixelRatio) or the globe distorts.
            state.width = widthRef.current * pixelRatio
            state.height = widthRef.current * pixelRatio
            // Theme-aware palette for the built-in globe only: a custom
            // `config` prop keeps full control (its own `dark`/colours win).
            if (config === GLOBE_CONFIG) {
              const palette = darkRef.current ? GLOBE_CONFIG : GLOBE_CONFIG_LIGHT
              for (const key of THEME_UNIFORM_KEYS) {
                state[key] = palette[key]
              }
            }
          },
        })
      } catch (error) {
        console.warn("Globe: could not create the WebGL scene.", error)
        Sentry.captureException(error)
        return null
      }
    })()

    // cobe/phenomenon expose no pause API: their scheduler calls the globe
    // instance's `render` every animation frame. Shadowing `render` with a
    // no-op keeps the ticker alive (a cheap function call per frame) but
    // skips all uniform setup, draw calls, and shader work — an effective
    // pause with no teardown/recreate cost when scrolling back.
    const originalRender =
      globe && typeof globe.render === "function" ? globe.render.bind(globe) : null
    const setGlobePaused = (paused: boolean) => {
      if (!globe || !originalRender) return
      globe.render = paused ? () => {} : originalRender
    }

    // Pause while the tab is hidden (browsers throttle rAF anyway, but this
    // also covers throttled-but-running cases) or while the canvas is fully
    // offscreen.
    const syncGlobePaused = () => {
      setGlobePaused(document.hidden || !inViewRef.current)
    }
    document.addEventListener("visibilitychange", syncGlobePaused)

    let visibilityObserver: IntersectionObserver | null = null
    const container = containerRef.current
    if (container && typeof IntersectionObserver !== "undefined") {
      visibilityObserver = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1]
        inViewRef.current = entry ? entry.isIntersecting : true
        syncGlobePaused()
      })
      visibilityObserver.observe(container)
    }
    syncGlobePaused()

    const fadeTimer = globe
      ? window.setTimeout(() => {
          if (canvasRef.current) canvasRef.current.style.opacity = "1"
        }, 0)
      : null

    return () => {
      globe?.destroy()
      if (fadeTimer !== null) window.clearTimeout(fadeTimer)
      themeObserver.disconnect()
      darkQuery.removeEventListener("change", onSchemeChange)
      document.removeEventListener("visibilitychange", syncGlobePaused)
      visibilityObserver?.disconnect()
      window.removeEventListener("resize", onResize)
    }
  }, [config])

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 mx-auto aspect-square w-full max-w-150", className)}
    >
      <canvas
        className={cn(
          "size-full opacity-0 transition-opacity duration-500 contain-[layout_paint_size]",
        )}
        ref={canvasRef}
        onPointerDown={(e) => {
          pointerInteracting.current = e.clientX
          updatePointerInteraction(e.clientX)
        }}
        onPointerUp={() => updatePointerInteraction(null)}
        onPointerOut={() => updatePointerInteraction(null)}
        onMouseMove={(e) => updateMovement(e.clientX)}
        onTouchMove={(e) => e.touches[0] && updateMovement(e.touches[0].clientX)}
      />
    </div>
  )
}
