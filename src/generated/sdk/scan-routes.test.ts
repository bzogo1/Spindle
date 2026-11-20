import { describe, expect, it } from "vitest"

import {
  endpointName,
  extractDocComment,
  findRouteWarnings,
  isCatchAllSegment,
  parseRouteSource,
  routePathFromSegments,
} from "../../../scripts/sdk/scan-routes"

describe("routePathFromSegments", () => {
  it("maps dynamic segments to :params", () => {
    expect(routePathFromSegments(["api", "auth", "oauth", "[provider]"])).toEqual({
      path: "/api/auth/oauth/:provider",
      pathParams: ["provider"],
    })
  })

  it("leaves static segments untouched", () => {
    expect(routePathFromSegments(["api", "contact"])).toEqual({
      path: "/api/contact",
      pathParams: [],
    })
  })
})

describe("isCatchAllSegment", () => {
  it("detects [...x] and [[...x]] but not [x]", () => {
    expect(isCatchAllSegment("[...slug]")).toBe(true)
    expect(isCatchAllSegment("[[...slug]]")).toBe(true)
    expect(isCatchAllSegment("[provider]")).toBe(false)
    expect(isCatchAllSegment("slug")).toBe(false)
  })
})

describe("extractDocComment", () => {
  it("returns null when unrelated code sits between comment and export", () => {
    const source = `/** Docs for something else */\nconst x = 1\n\nexport async function GET() {}`
    expect(extractDocComment(source, source.indexOf("export async function"))).toBeNull()
  })

  it("extracts a JSDoc body directly above the export", () => {
    const source = `const y = 2\n\n/**\n * GET /api/x — does a thing.\n * Second line.\n */\nexport async function GET() {}`
    const doc = extractDocComment(source, source.indexOf("export async function"))
    expect(doc).toBe("GET /api/x — does a thing.\nSecond line.")
  })
})

describe("parseRouteSource", () => {
  it("extracts multiple methods with docs", () => {
    const source = `
/** GET docs */
export async function GET(request: Request) {}
export async function PUT(request: Request) {}
`
    const handlers = parseRouteSource(source)
    expect(handlers.map((h) => h.method)).toEqual(["GET", "PUT"])
    expect(handlers[0].doc).toContain("GET docs")
    expect(handlers[1].doc).toBeNull()
  })

  it("ignores const-style exports (reported via findRouteWarnings)", () => {
    const source = `export const GET = async () => {}`
    expect(parseRouteSource(source)).toEqual([])
  })
})

describe("findRouteWarnings", () => {
  it("flags const-style and brace re-export handlers", () => {
    const source = `
export const POST = async () => {}
export { GET } from "./handlers"
export async function PUT() {}
`
    const warnings = findRouteWarnings(source, [])
    expect(warnings.some((w) => w.includes("export const POST"))).toBe(true)
    expect(warnings.some((w) => w.includes("re-export"))).toBe(true)
    expect(warnings.some((w) => w.includes("PUT"))).toBe(false)
  })

  it("flags catch-all segments", () => {
    const warnings = findRouteWarnings("", ["[...slug]"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("catch-all")
  })

  it("returns no warnings for clean routes", () => {
    expect(findRouteWarnings("export async function GET() {}", ["profile"])).toEqual([])
  })
})

describe("endpointName", () => {
  it("builds method + PascalCase path names", () => {
    expect(endpointName("POST", ["api", "auth", "signin"])).toBe("postAuthSignin")
    expect(endpointName("GET", ["api", "auth", "2fa", "backup-codes"])).toBe(
      "getAuth2faBackupCodes",
    )
    expect(endpointName("GET", ["api", "auth", "oauth", "[provider]"])).toBe(
      "getAuthOauthProvider",
    )
  })
})
