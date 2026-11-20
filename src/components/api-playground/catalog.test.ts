import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { API_ENDPOINTS, endpointsByGroup, getEndpoint } from "./catalog"

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])

describe("API endpoint catalog", () => {
  it("has unique ids", () => {
    const ids = API_ENDPOINTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every endpoint uses a valid method and an /api path", () => {
    for (const endpoint of API_ENDPOINTS) {
      expect(METHODS.has(endpoint.method)).toBe(true)
      expect(endpoint.path.startsWith("/api/")).toBe(true)
      expect(endpoint.summary.length).toBeGreaterThan(0)
      expect(endpoint.group.length).toBeGreaterThan(0)
    }
  })

  it("path params referenced in the template are the only braces", () => {
    for (const endpoint of API_ENDPOINTS) {
      const matches = endpoint.path.match(/\{[^}/]+\}/g) ?? []
      for (const match of matches) {
        expect(match).toMatch(/^\{[a-zA-Z][\w-]*\}$/)
      }
    }
  })

  it("getEndpoint finds by id", () => {
    expect(getEndpoint("profile-get")?.path).toBe("/api/profile")
    expect(getEndpoint("nope")).toBeUndefined()
  })

  it("groups every endpoint exactly once", () => {
    const grouped = endpointsByGroup().flatMap((g) => g.endpoints)
    expect(grouped).toHaveLength(API_ENDPOINTS.length)
    const groups = endpointsByGroup().map((g) => g.group)
    expect(new Set(groups).size).toBe(groups.length)
  })
})

/**
 * Catalog drift guard: every catalog entry must correspond to a real route
 * handler under `src/app/api` that exports the claimed HTTP method.
 * Route dirs use `[param]` segments; catalog paths use `{param}`.
 */
describe("catalog vs route handlers", () => {
  const API_DIR = join(process.cwd(), "src", "app", "api")
  const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

  function collectRoutes(dir: string, prefix: string[] = []): Map<string, Set<string>> {
    const routes = new Map<string, Set<string>>()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        for (const [path, methods] of collectRoutes(full, [...prefix, entry.name])) {
          routes.set(path, methods)
        }
      } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
        const source = readFileSync(full, "utf8")
        const methods = new Set<string>()
        for (const method of HTTP_METHODS) {
          if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source)) {
            methods.add(method)
          }
        }
        const segments = prefix.map((s) => s.replace(/^\[(.+)\]$/, "{$1}"))
        routes.set(`/api/${segments.join("/")}`, methods)
      }
    }
    return routes
  }

  const routes = collectRoutes(API_DIR)

  it("scans a non-trivial number of route files", () => {
    expect(routes.size).toBeGreaterThan(20)
  })

  it("every catalog path+method exists in src/app/api", () => {
    const missing: string[] = []
    for (const endpoint of API_ENDPOINTS) {
      const methods = routes.get(endpoint.path)
      if (!methods) {
        missing.push(`${endpoint.method} ${endpoint.path} (no route file)`)
      } else if (!methods.has(endpoint.method)) {
        missing.push(
          `${endpoint.method} ${endpoint.path} (route exports: ${[...methods].join(", ") || "none"})`,
        )
      }
    }
    expect(missing).toEqual([])
  })
})
