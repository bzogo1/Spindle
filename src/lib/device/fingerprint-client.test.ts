import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  collectDeviceFingerprint,
  collectDeviceSignals,
  DEVICE_FINGERPRINT_PREFIX,
  DEVICE_FINGERPRINT_VERSION,
  getDeviceFingerprint,
  hashDeviceSignals,
  registerDeviceFingerprintWithServer,
  resetDeviceFingerprintCacheForTests,
  unregisterDeviceFingerprintWithServer,
  type DeviceSignals,
} from "./fingerprint-client"

const baseSignals: DeviceSignals = {
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) TestBrowser/1.0",
  language: "en-US",
  languages: ["en-US", "en"],
  platform: "Linux x86_64",
  hardwareConcurrency: 8,
  deviceMemory: 16,
  maxTouchPoints: 0,
  screenWidth: 1920,
  screenHeight: 1080,
  colorDepth: 24,
  pixelDepth: 24,
  devicePixelRatio: 1,
  timezone: "Europe/Berlin",
  timezoneOffsetMinutes: -120,
  canvasHash: "abc123",
  webglVendor: "Google Inc.",
  webglRenderer: "ANGLE (Test)",
}

describe("hashDeviceSignals", () => {
  it("produces a versioned digest with the fp1 prefix", async () => {
    const hash = await hashDeviceSignals(baseSignals)
    expect(hash.startsWith(DEVICE_FINGERPRINT_PREFIX)).toBe(true)
    expect(hash.slice(DEVICE_FINGERPRINT_PREFIX.length)).toMatch(/^[0-9a-f]{16,128}$/)
  })

  it("is deterministic for identical signals", async () => {
    const [a, b] = await Promise.all([
      hashDeviceSignals(baseSignals),
      hashDeviceSignals({ ...baseSignals }),
    ])
    expect(a).toBe(b)
  })

  it("changes when any signal changes", async () => {
    const original = await hashDeviceSignals(baseSignals)
    const variants: DeviceSignals[] = [
      { ...baseSignals, userAgent: "different" },
      { ...baseSignals, screenWidth: 2560 },
      { ...baseSignals, timezone: "America/New_York" },
      { ...baseSignals, canvasHash: null },
      { ...baseSignals, languages: ["de-DE"] },
    ]
    for (const variant of variants) {
      expect(await hashDeviceSignals(variant)).not.toBe(original)
    }
  })

  it("handles fully-null signals (graceful degradation)", async () => {
    const empty: DeviceSignals = {
      userAgent: null,
      language: null,
      languages: [],
      platform: null,
      hardwareConcurrency: null,
      deviceMemory: null,
      maxTouchPoints: null,
      screenWidth: null,
      screenHeight: null,
      colorDepth: null,
      pixelDepth: null,
      devicePixelRatio: null,
      timezone: null,
      timezoneOffsetMinutes: null,
      canvasHash: null,
      webglVendor: null,
      webglRenderer: null,
    }
    const hash = await hashDeviceSignals(empty)
    expect(hash.startsWith(`${DEVICE_FINGERPRINT_VERSION}:`)).toBe(true)
    // Still deterministic when nothing is available.
    expect(await hashDeviceSignals(empty)).toBe(hash)
  })
})

describe("collectDeviceSignals / collectDeviceFingerprint", () => {
  beforeEach(() => {
    resetDeviceFingerprintCacheForTests()
  })

  it("collects signals without throwing in jsdom", () => {
    const signals = collectDeviceSignals()
    expect(signals.userAgent).toBeTruthy()
    expect(typeof signals.screenWidth).toBe("number")
    // jsdom has no canvas 2d / WebGL — collectors must degrade to null.
    expect(signals.canvasHash).toBeNull()
    expect(signals.webglVendor).toBeNull()
  })

  it("produces a fingerprint object with version + hash", async () => {
    const fingerprint = await collectDeviceFingerprint()
    expect(fingerprint.version).toBe(DEVICE_FINGERPRINT_VERSION)
    expect(fingerprint.hash.startsWith(DEVICE_FINGERPRINT_PREFIX)).toBe(true)
  })

  it("memoizes the fingerprint until the cache is reset", async () => {
    const first = await getDeviceFingerprint()
    const second = await getDeviceFingerprint()
    expect(second).toBe(first)
    resetDeviceFingerprintCacheForTests()
    const third = await getDeviceFingerprint()
    expect(third.hash).toBe(first.hash)
    expect(third).not.toBe(first)
  })
})

describe("registerDeviceFingerprintWithServer", () => {
  beforeEach(() => {
    resetDeviceFingerprintCacheForTests()
    vi.unstubAllGlobals()
  })

  it("POSTs the versioned hash to /api/auth/fingerprint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await registerDeviceFingerprintWithServer()

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/auth/fingerprint")
    expect(init.method).toBe("POST")
    const body = JSON.parse(String(init.body)) as { fingerprint: string }
    expect(body.fingerprint).toMatch(/^fp1:[0-9a-f]{16,128}$/)
  })

  it("returns false on non-OK responses and on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    expect(await registerDeviceFingerprintWithServer()).toBe(false)

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    expect(await registerDeviceFingerprintWithServer()).toBe(false)
  })
})

describe("unregisterDeviceFingerprintWithServer", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends DELETE /api/auth/fingerprint with same-origin credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    expect(await unregisterDeviceFingerprintWithServer()).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/auth/fingerprint")
    expect(init.method).toBe("DELETE")
    expect(init.credentials).toBe("same-origin")
  })

  it("returns false on non-OK responses and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    expect(await unregisterDeviceFingerprintWithServer()).toBe(false)

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    expect(await unregisterDeviceFingerprintWithServer()).toBe(false)
  })
})
