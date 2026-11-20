import { describe, expect, it } from "vitest"

import { passwordlessRequestSchema, sanitizeNextPath } from "./schemas"

describe("passwordlessRequestSchema", () => {
  it("accepts an optional next path", () => {
    const parsed = passwordlessRequestSchema.parse({
      email: "Ada@Lab.Edu",
      next: "/dashboard/files",
    })
    expect(parsed.email).toBe("ada@lab.edu")
    expect(parsed.purpose).toBe("signin")
    expect(parsed.next).toBe("/dashboard/files")
  })

  it("defaults purpose and leaves next undefined when omitted", () => {
    const parsed = passwordlessRequestSchema.parse({ email: "ada@lab.edu" })
    expect(parsed.purpose).toBe("signin")
    expect(parsed.next).toBeUndefined()
  })

  it("rejects invalid emails", () => {
    expect(passwordlessRequestSchema.safeParse({ email: "nope" }).success).toBe(false)
  })
})

describe("sanitizeNextPath", () => {
  it("keeps same-origin app paths", () => {
    expect(sanitizeNextPath("/dashboard/files?x=1")).toBe("/dashboard/files?x=1")
    expect(sanitizeNextPath("/")).toBe("/")
  })

  it("rejects absolute, protocol-relative, and non-path values", () => {
    expect(sanitizeNextPath("https://evil.example")).toBeNull()
    expect(sanitizeNextPath("//evil.example")).toBeNull()
    expect(sanitizeNextPath("dashboard")).toBeNull()
    expect(sanitizeNextPath("")).toBeNull()
    expect(sanitizeNextPath(null)).toBeNull()
    expect(sanitizeNextPath(undefined)).toBeNull()
  })
})
