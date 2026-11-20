import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * public/pwa/sw-core.js is a classic script (loaded by the service worker via
 * importScripts), so it cannot be imported as an ES module. Evaluate it once
 * and exercise the pure routing helpers the SW uses in its fetch handler.
 */
interface SwCore {
  CACHE_VERSION: string
  PRECACHE_URLS: string[]
  OUTBOX_DB_NAME: string
  OUTBOX_STORE_NAME: string
  OUTBOX_SYNC_TAG: string
  cacheNames(version?: string): Record<string, string>
  classifyRequest(
    request: {
      url: string
      method?: string
      mode?: string
      destination?: string
      headers?: Record<string, string> | Headers | [string, string][]
    },
    origin?: string,
  ): "network-only" | "network-first" | "stale-while-revalidate" | "cache-first"
  isCacheableResponse(
    response: { status: number; type?: string },
    requestUrl: string,
    origin?: string,
  ): boolean
}

type ClassifyInput = Parameters<SwCore["classifyRequest"]>[0]

const swCoreSource = readFileSync(join(process.cwd(), "public/pwa/sw-core.js"), "utf8")

const swCore = new Function(
  `${swCoreSource}\n;return (typeof self !== "undefined" ? self : globalThis).SpindlePwa;`,
)() as SwCore

const ORIGIN = "https://spindle.test"

function req(url: string, init: Partial<ClassifyInput> = {}): ClassifyInput {
  return { url, ...init }
}

describe("sw-core cache routing", () => {
  it("routes same-origin navigations to network-first", () => {
    expect(swCore.classifyRequest(req(`${ORIGIN}/pricing`, { mode: "navigate" }), ORIGIN)).toBe(
      "network-first",
    )
    expect(
      swCore.classifyRequest(
        req(`${ORIGIN}/docs/guide`, { headers: { accept: "text/html,application/xhtml+xml" } }),
        ORIGIN,
      ),
    ).toBe("network-first")
  })

  it("routes hashed _next/static assets to cache-first", () => {
    expect(swCore.classifyRequest(req(`${ORIGIN}/_next/static/chunks/app.js`), ORIGIN)).toBe(
      "cache-first",
    )
  })

  it("routes static file extensions and asset destinations to cache-first", () => {
    expect(swCore.classifyRequest(req(`${ORIGIN}/assets/planet.png`), ORIGIN)).toBe("cache-first")
    expect(swCore.classifyRequest(req(`${ORIGIN}/font`, { destination: "font" }), ORIGIN)).toBe(
      "cache-first",
    )
  })

  it("routes other same-origin GETs to stale-while-revalidate", () => {
    expect(swCore.classifyRequest(req(`${ORIGIN}/docs?_rsc=abc`), ORIGIN)).toBe(
      "stale-while-revalidate",
    )
  })

  it("never caches API or mutation requests", () => {
    expect(swCore.classifyRequest(req(`${ORIGIN}/api/projects`), ORIGIN)).toBe("network-only")
    expect(swCore.classifyRequest(req(`${ORIGIN}/projects`, { method: "POST" }), ORIGIN)).toBe(
      "network-only",
    )
    expect(swCore.classifyRequest(req(`${ORIGIN}/x`, { method: "DELETE" }), ORIGIN)).toBe(
      "network-only",
    )
  })

  it("never caches requests carrying credential headers", () => {
    expect(
      swCore.classifyRequest(
        req(`${ORIGIN}/sync`, { headers: { Authorization: "Bearer t" } }),
        ORIGIN,
      ),
    ).toBe("network-only")
  })

  it("caches allowlisted font hosts but nothing else cross-origin", () => {
    expect(swCore.classifyRequest(req("https://fonts.gstatic.com/s/inter.woff2"), ORIGIN)).toBe(
      "cache-first",
    )
    expect(swCore.classifyRequest(req("https://cdn.example.com/lib.js"), ORIGIN)).toBe(
      "network-only",
    )
  })

  it("produces versioned cache names", () => {
    const names = swCore.cacheNames("test-v")
    expect(names.static).toBe("test-v-static")
    expect(names.pages).toBe("test-v-pages")
    expect(swCore.CACHE_VERSION).toContain("spindle-pwa")
  })

  it("exposes precache URLs and outbox constants shared with the client", () => {
    expect(swCore.PRECACHE_URLS).toContain("/offline.html")
    expect(swCore.OUTBOX_DB_NAME).toBe("spindle-outbox")
    expect(swCore.OUTBOX_STORE_NAME).toBe("requests")
    expect(swCore.OUTBOX_SYNC_TAG).toBe("spindle-outbox")
  })
})

describe("sw-core isCacheableResponse", () => {
  it("accepts ok responses and rejects errors", () => {
    expect(swCore.isCacheableResponse({ status: 200 }, `${ORIGIN}/a.js`, ORIGIN)).toBe(true)
    expect(swCore.isCacheableResponse({ status: 404 }, `${ORIGIN}/a.js`, ORIGIN)).toBe(false)
    expect(swCore.isCacheableResponse({ status: 500 }, `${ORIGIN}/a.js`, ORIGIN)).toBe(false)
  })

  it("allows opaque responses only for allowlisted font hosts", () => {
    expect(
      swCore.isCacheableResponse({ status: 0 }, "https://fonts.gstatic.com/f.woff2", ORIGIN),
    ).toBe(true)
    expect(swCore.isCacheableResponse({ status: 0 }, "https://evil.example/x", ORIGIN)).toBe(false)
  })
})
