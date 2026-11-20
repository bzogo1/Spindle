"use client"

/**
 * Client-side device fingerprint collector.
 *
 * Produces a *stable-ish* hash of low-entropy device signals so the auth
 * layer can tell "same browser profile as last time" from "a different
 * device" without ever transmitting the raw signals. Privacy notes:
 *
 *  - Only a SHA-256 (or FNV-1a fallback) digest leaves the browser. Raw
 *    signals are hashed in-memory and discarded; nothing is persisted to
 *    localStorage/sessionStorage by this module.
 *  - Signals are the standard fingerprinting surface: user agent, screen
 *    geometry, timezone, language list, hardware hints, plus a lightweight
 *    canvas render hash and WebGL vendor/renderer strings. No PII (no name,
 *    email, MAC, serial, or ever cookies) is collected.
 *  - The algorithm is versioned (`fp1:` prefix on the hash) so a future
 *    collector change can coexist with stored fingerprints during rollout.
 *
 * Stability expectations: identical browsers produce identical hashes;
 * browser updates, zoom changes, or devtools docking may shift individual
 * signals — that is why the server treats fingerprint *changes* as a soft
 * signal, not a hard failure.
 */

export const DEVICE_FINGERPRINT_VERSION = "fp1"
export const DEVICE_FINGERPRINT_PREFIX = `${DEVICE_FINGERPRINT_VERSION}:`

export type DeviceFingerprint = {
  /** Algorithm version, e.g. `"fp1"`. */
  version: string
  /** Versioned digest, e.g. `"fp1:9f86d0…"`. Safe to send to the server. */
  hash: string
}

/**
 * Raw signals. Every field is nullable — collectors degrade gracefully when
 * an API is unavailable (privacy mode, missing WebGL, SSR).
 */
export type DeviceSignals = {
  userAgent: string | null
  language: string | null
  languages: string[]
  platform: string | null
  hardwareConcurrency: number | null
  deviceMemory: number | null
  maxTouchPoints: number | null
  screenWidth: number | null
  screenHeight: number | null
  colorDepth: number | null
  pixelDepth: number | null
  devicePixelRatio: number | null
  timezone: string | null
  timezoneOffsetMinutes: number | null
  /** FNV-1a hex of a small canvas render; null when canvas is unavailable. */
  canvasHash: string | null
  webglVendor: string | null
  webglRenderer: string | null
}

function fnv1a64(input: string): string {
  // FNV-1a 64-bit — deterministic, dependency-free fallback digest.
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, "0")
}

async function sha256Hex(input: string): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  } catch {
    return null
  }
}

/** Deterministic serialization: fixed key order, JSON for nested arrays. */
function canonicalize(signals: DeviceSignals): string {
  return JSON.stringify({
    ua: signals.userAgent,
    lang: signals.language,
    langs: signals.languages,
    platform: signals.platform,
    cores: signals.hardwareConcurrency,
    mem: signals.deviceMemory,
    touch: signals.maxTouchPoints,
    sw: signals.screenWidth,
    sh: signals.screenHeight,
    cd: signals.colorDepth,
    pd: signals.pixelDepth,
    dpr: signals.devicePixelRatio,
    tz: signals.timezone,
    tzo: signals.timezoneOffsetMinutes,
    canvas: signals.canvasHash,
    glv: signals.webglVendor,
    glr: signals.webglRenderer,
  })
}

/** Hashes already-collected signals into the versioned fingerprint digest. */
export async function hashDeviceSignals(signals: DeviceSignals): Promise<string> {
  const canonical = canonicalize(signals)
  const digest = (await sha256Hex(canonical)) ?? fnv1a64(canonical)
  return `${DEVICE_FINGERPRINT_PREFIX}${digest}`
}

function safe<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

/** Tiny 2D canvas render hashed with FNV-1a; captures GPU/font rasterization. */
function collectCanvasHash(): string | null {
  return safe(() => {
    if (typeof document === "undefined") return null
    const canvas = document.createElement("canvas")
    canvas.width = 220
    canvas.height = 40
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.textBaseline = "top"
    ctx.font = "14px 'Arial'"
    ctx.fillStyle = "#f60"
    ctx.fillRect(0, 0, 220, 40)
    ctx.fillStyle = "#069"
    ctx.fillText("spindle-device-fp", 4, 12)
    ctx.strokeStyle = "#000"
    ctx.beginPath()
    ctx.arc(200, 20, 12, 0, Math.PI * 2)
    ctx.stroke()
    const dataUrl = canvas.toDataURL()
    return dataUrl.length > 0 ? fnv1a64(dataUrl) : null
  })
}

/** WebGL vendor/renderer via the standard (often masked) parameters only. */
function collectWebglSignals(): { vendor: string | null; renderer: string | null } {
  return (
    safe(() => {
      if (typeof document === "undefined") return { vendor: null, renderer: null }
      const canvas = document.createElement("canvas")
      const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl") ?? null
      if (!gl || !("getParameter" in gl)) return { vendor: null, renderer: null }
      const glContext = gl as WebGLRenderingContext
      const vendor = glContext.getParameter(glContext.VENDOR)
      const renderer = glContext.getParameter(glContext.RENDERER)
      return {
        vendor: typeof vendor === "string" ? vendor : null,
        renderer: typeof renderer === "string" ? renderer : null,
      }
    }) ?? { vendor: null, renderer: null }
  )
}

/** Gathers every signal the collector understands; each read is guarded. */
export function collectDeviceSignals(): DeviceSignals {
  const nav = typeof navigator === "undefined" ? null : navigator
  const screenInfo = typeof screen === "undefined" ? null : screen
  const webgl = collectWebglSignals()
  return {
    userAgent: safe(() => nav?.userAgent ?? null) ?? null,
    language: safe(() => nav?.language ?? null) ?? null,
    languages: safe(() => Array.from(nav?.languages ?? [])) ?? [],
    platform: safe(() => nav?.platform ?? null) ?? null,
    hardwareConcurrency: safe(() => nav?.hardwareConcurrency ?? null) ?? null,
    deviceMemory:
      safe(() => (nav as Navigator & { deviceMemory?: number })?.deviceMemory ?? null) ?? null,
    maxTouchPoints: safe(() => nav?.maxTouchPoints ?? null) ?? null,
    screenWidth: safe(() => screenInfo?.width ?? null) ?? null,
    screenHeight: safe(() => screenInfo?.height ?? null) ?? null,
    colorDepth: safe(() => screenInfo?.colorDepth ?? null) ?? null,
    pixelDepth: safe(() => screenInfo?.pixelDepth ?? null) ?? null,
    devicePixelRatio:
      safe(() => (typeof window !== "undefined" ? window.devicePixelRatio : null)) ?? null,
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone) ?? null,
    timezoneOffsetMinutes: safe(() => new Date().getTimezoneOffset()) ?? null,
    canvasHash: collectCanvasHash(),
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
  }
}

/** Collects signals and hashes them into a {@link DeviceFingerprint}. */
export async function collectDeviceFingerprint(): Promise<DeviceFingerprint> {
  return {
    version: DEVICE_FINGERPRINT_VERSION,
    hash: await hashDeviceSignals(collectDeviceSignals()),
  }
}

let cachedFingerprint: Promise<DeviceFingerprint> | null = null

/**
 * Memoized fingerprint for the lifetime of the page. The hash is cheap but
 * canvas/WebGL reads are not free, and the value cannot legitimately change
 * within a browsing session (a change means the profile changed — which a
 * reload will pick up anyway).
 */
export function getDeviceFingerprint(): Promise<DeviceFingerprint> {
  cachedFingerprint ??= collectDeviceFingerprint()
  return cachedFingerprint
}

/** Test hook: drops the memoized fingerprint. */
export function resetDeviceFingerprintCacheForTests(): void {
  cachedFingerprint = null
}

/**
 * Registers/refreshes the fingerprint for the current session via
 * `POST /api/auth/fingerprint`. Best-effort by design: callers should not
 * block sign-in flows on it, and non-OK responses resolve to `false` so the
 * caller can decide whether to retry later (e.g. on the next session tick).
 */
export async function registerDeviceFingerprintWithServer(): Promise<boolean> {
  try {
    const fingerprint = await getDeviceFingerprint()
    const response = await fetch("/api/auth/fingerprint", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: fingerprint.hash }),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Drops this session's fingerprint record via `DELETE /api/auth/fingerprint`.
 * Called best-effort during sign-out, BEFORE the auth cookies are cleared —
 * the request must carry the still-valid `spindle_at` cookie so the server
 * can resolve the session id. Never throws.
 */
export async function unregisterDeviceFingerprintWithServer(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/fingerprint", {
      method: "DELETE",
      credentials: "same-origin",
    })
    return response.ok
  } catch {
    return false
  }
}
