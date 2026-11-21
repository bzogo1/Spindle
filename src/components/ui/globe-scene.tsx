"use client"

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"
import createGlobe, { type COBEOptions } from "cobe"
import * as Sentry from "@sentry/nextjs"

import { cn } from "@/lib/utils"

/** Pointer travel (px) per radian of horizontal rotation. Lower turns faster. */
const MOVEMENT_DAMPING = 1200
/** Vertical drag sensitivity; slightly stiffer so tilting feels controlled. */
const THETA_DAMPING = 1600
/** Idle drift in radians per millisecond (~0.22 rad/s: a turn every ~29s). */
const AUTO_SPIN_SPEED = 0.00022
/** How far a drag may tilt away from the configured theta, in radians. */
const MAX_THETA_OFFSET = 0.5
/** Subtle cursor-follow parallax at the canvas edges, in radians. */
const HOVER_PHI = 0.14
const HOVER_THETA = 0.1
/**
 * Drag follow stiffness, in radians per second. The displayed rotation is a
 * critically damped spring toward the pointer target, so it accelerates and
 * settles instead of being glued to the cursor (lower is floatier).
 */
const DRAG_OMEGA = 9
/**
 * Damping ratio once a drag ends. Below 1 the spring overshoots the rotation
 * it settles on and springs back with a small (a couple of degrees) bounce;
 * while dragging it stays critically damped so the globe never wobbles under
 * the pointer. Reduced motion keeps the critical damping.
 */
const RELEASE_DAMPING = 0.4
/** Exponential-smoothing time constants (ms); lower is snappier. */
const HOVER_TAU = 260
const SPIN_TAU = 420

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

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
  const reducedMotion = useRef<MediaQueryList | null>(null)
  /** Drag rotation target, in radians, accumulated from pointer movement. */
  const dragTarget = useRef({ phi: 0, theta: 0 })
  /** Smoothed drag rotation actually applied; springs toward dragTarget. */
  const dragOffset = useRef({ phi: 0, theta: 0 })
  /** Angular velocity of the drag spring (radians per second). */
  const dragVelocity = useRef({ phi: 0, theta: 0 })
  /** Pointer-follow parallax target, in radians; eased into hoverOffset. */
  const hoverTarget = useRef({ phi: 0, theta: 0 })
  /** Smoothed parallax actually applied. */
  const hoverOffset = useRef({ phi: 0, theta: 0 })
  /** Pointer id while a drag is in progress, else null. */
  const pointerIdRef = useRef<number | null>(null)
  /** Last pointer sample; horizontal and vertical drag deltas derive from it. */
  const lastPointerRef = useRef({ x: 0, y: 0 })
  /**
   * Auto-rotation weight: starts at 0 and eases up, drops to 0 while dragging,
   * and comes back after release. Stays at 0 under reduced motion.
   */
  const spinFactorRef = useRef(0)
  /** Previous frame timestamp, for delta-time based smoothing. */
  const lastFrameRef = useRef<number | null>(null)
  /** Current theme; read each frame by onRender to pick the palette. */
  const darkRef = useRef(true)
  /** Tracks IntersectionObserver state for the render-pause gate. */
  const inViewRef = useRef(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const setCanvasCursor = (grabbing: boolean) => {
    if (canvasRef.current) {
      canvasRef.current.style.cursor = grabbing ? "grabbing" : "grab"
    }
  }

  /** Map the cursor position to a small, signed rotation offset. */
  const updateHover = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const nx = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
    const ny = clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1)
    hoverTarget.current.phi = nx * HOVER_PHI
    hoverTarget.current.theta = ny * HOVER_THETA
  }

  const resetHover = () => {
    hoverTarget.current.phi = 0
    hoverTarget.current.theta = 0
  }

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== pointerIdRef.current) return
    pointerIdRef.current = null
    const canvas = event.currentTarget
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
    setCanvasCursor(false)
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
            const now = performance.now()
            const previous = lastFrameRef.current
            lastFrameRef.current = now
            // Clamp the frame delta so resuming after a pause (hidden tab,
            // offscreen gate, first frame) cannot make the globe jump.
            const dt = clamp(previous === null ? 16.7 : now - previous, 0, 48)
            const reduced = reducedMotion.current?.matches ?? false
            const dragging = pointerIdRef.current !== null

            // Auto-rotation is decorative; it stops while dragging and under
            // prefers-reduced-motion, then eases back in so it never snaps.
            const spinTarget = dragging || reduced ? 0 : 1
            spinFactorRef.current +=
              (spinTarget - spinFactorRef.current) * (1 - Math.exp(-dt / SPIN_TAU))
            phiRef.current += AUTO_SPIN_SPEED * dt * spinFactorRef.current

            // Follow the pointer with a critically damped spring rather than
            // pinning the globe to it: the rotation eases in behind quick
            // drags and glides the last few degrees after the pointer stops,
            // which reads as weight instead of a rigid, sticky object.
            const dtSeconds = dt / 1000
            const stiffness = DRAG_OMEGA * DRAG_OMEGA
            // Elastic only after release: underdamped then, so the residual
            // velocity carries the globe just past its resting rotation and
            // it eases back, instead of stopping dead on pointer-up.
            const dampingRatio = dragging || reduced ? 1 : RELEASE_DAMPING
            const damping = 2 * dampingRatio * DRAG_OMEGA
            const phiAcceleration =
              stiffness * (dragTarget.current.phi - dragOffset.current.phi) -
              damping * dragVelocity.current.phi
            dragVelocity.current.phi += phiAcceleration * dtSeconds
            dragOffset.current.phi += dragVelocity.current.phi * dtSeconds
            const thetaAcceleration =
              stiffness * (dragTarget.current.theta - dragOffset.current.theta) -
              damping * dragVelocity.current.theta
            dragVelocity.current.theta += thetaAcceleration * dtSeconds
            dragOffset.current.theta += dragVelocity.current.theta * dtSeconds

            // Gentle parallax toward the cursor; off for reduced motion.
            const hoverEase = 1 - Math.exp(-dt / HOVER_TAU)
            const hoverPhiTarget = reduced ? 0 : hoverTarget.current.phi
            const hoverThetaTarget = reduced ? 0 : hoverTarget.current.theta
            hoverOffset.current.phi += (hoverPhiTarget - hoverOffset.current.phi) * hoverEase
            hoverOffset.current.theta += (hoverThetaTarget - hoverOffset.current.theta) * hoverEase

            state.phi = phiRef.current + dragOffset.current.phi + hoverOffset.current.phi
            state.theta = clamp(
              config.theta + dragOffset.current.theta + hoverOffset.current.theta,
              -1,
              1,
            )
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
          "size-full touch-none opacity-0 transition-opacity duration-500 contain-[layout_paint_size] select-none",
        )}
        ref={canvasRef}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return
          pointerIdRef.current = event.pointerId
          lastPointerRef.current = { x: event.clientX, y: event.clientY }
          resetHover()
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Capture is a nicety that keeps a drag alive outside the canvas;
            // ignore environments that do not support it.
          }
          setCanvasCursor(true)
        }}
        onPointerMove={(event) => {
          const canvas = event.currentTarget
          if (pointerIdRef.current === event.pointerId) {
            const last = lastPointerRef.current
            const dx = event.clientX - last.x
            const dy = event.clientY - last.y
            dragTarget.current.phi += dx / MOVEMENT_DAMPING
            dragTarget.current.theta = clamp(
              dragTarget.current.theta + dy / THETA_DAMPING,
              -MAX_THETA_OFFSET,
              MAX_THETA_OFFSET,
            )
            lastPointerRef.current = { x: event.clientX, y: event.clientY }
            return
          }
          // No drag: let a mouse subtly steer the sphere (touch has no hover).
          if (event.pointerType === "mouse") updateHover(canvas, event.clientX, event.clientY)
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          pointerIdRef.current = null
          setCanvasCursor(false)
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" && pointerIdRef.current === null) {
            updateHover(event.currentTarget, event.clientX, event.clientY)
          }
        }}
        onPointerLeave={() => {
          if (pointerIdRef.current === null) resetHover()
        }}
      />
    </div>
  )
}
