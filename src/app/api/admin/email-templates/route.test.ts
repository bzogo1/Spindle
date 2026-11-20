// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetEmailTemplateStoreForTests } from "@/lib/email-templates-editor"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function req(method: string, query = "", body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.7.4.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  if (body !== undefined) headers["content-type"] = "application/json"
  return new Request(`http://localhost/api/admin/email-templates${query}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailTemplateStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/email-templates", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("GET"))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(req("GET", "", undefined, cookieFor("user@example.com", "u9")))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists templates for an admin", async () => {
    await POST(req("POST", "", { name: "N", subject: "S {{v}}", body: "B" }, adminCookie()))
    const response = await GET(req("GET", "", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.templates).toHaveLength(1)
    expect(body.templates[0]).toMatchObject({ name: "N", variables: ["v"] })
  })
})

describe("POST /api/admin/email-templates", () => {
  const valid = { name: "Welcome", subject: "Hi {{name}}", body: "Body {{url}}" }

  it("rejects unauthenticated requests with 401", async () => {
    const response = await POST(req("POST", "", valid))
    expect(response.status).toBe(401)
  })

  it("creates a template with extracted variables", async () => {
    const response = await POST(req("POST", "", valid, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.template).toMatchObject({
      name: "Welcome",
      subject: "Hi {{name}}",
      body: "Body {{url}}",
      variables: ["name", "url"],
    })
  })

  it("rejects invalid input with 400", async () => {
    for (const bad of [
      { name: "", subject: "s", body: "b" },
      { name: "n", subject: "", body: "b" },
      { name: "n", subject: "s", body: "" },
      { name: "n", subject: "s" },
      "not-an-object",
    ]) {
      const response = await POST(req("POST", "", bad, adminCookie()))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/email-templates", {
        method: "POST",
        headers: {
          "x-forwarded-for": "10.7.4.99",
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
          "content-type": "application/json",
        },
        body: "{nope",
      }),
    )
    expect(response.status).toBe(400)
  })
})
