// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { createTemplate, resetEmailTemplateStoreForTests } from "@/lib/email-templates-editor"

import { DELETE, GET, PUT } from "./route"

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

function req(method: string, id: string, body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.7.5.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  if (body !== undefined) headers["content-type"] = "application/json"
  return new Request(`http://localhost/api/admin/email-templates/${id}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const adminCookie = () => cookieFor("admin@example.com", "admin-1")

let templateId: string

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailTemplateStoreForTests()
  templateId = createTemplate({
    name: "Welcome",
    subject: "Hi {{name}}",
    body: "Body {{url}}",
  }).id
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/email-templates/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("GET", templateId), ctx(templateId))
    expect(response.status).toBe(401)
  })

  it("returns the template for an admin", async () => {
    const response = await GET(req("GET", templateId, undefined, adminCookie()), ctx(templateId))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.template).toMatchObject({ id: templateId, name: "Welcome" })
  })

  it("returns 404 for an unknown id", async () => {
    const response = await GET(
      req("GET", "tpl_missing", undefined, adminCookie()),
      ctx("tpl_missing"),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })
})

describe("PUT /api/admin/email-templates/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await PUT(req("PUT", templateId, { name: "X" }), ctx(templateId))
    expect(response.status).toBe(401)
  })

  it("updates fields and recomputes variables", async () => {
    const response = await PUT(
      req("PUT", templateId, { subject: "Hey {{name}}", body: "New {{extra}}" }, adminCookie()),
      ctx(templateId),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.template).toMatchObject({
      subject: "Hey {{name}}",
      body: "New {{extra}}",
      variables: ["name", "extra"],
    })
  })

  it("rejects an empty patch and invalid input with 400", async () => {
    for (const bad of [{}, { name: "" }, { subject: "" }]) {
      const response = await PUT(req("PUT", templateId, bad, adminCookie()), ctx(templateId))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("returns 404 for an unknown id", async () => {
    const response = await PUT(
      req("PUT", "tpl_missing", { name: "X" }, adminCookie()),
      ctx("tpl_missing"),
    )
    expect(response.status).toBe(404)
  })
})

describe("DELETE /api/admin/email-templates/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await DELETE(req("DELETE", templateId), ctx(templateId))
    expect(response.status).toBe(401)
  })

  it("deletes the template", async () => {
    const response = await DELETE(
      req("DELETE", templateId, undefined, adminCookie()),
      ctx(templateId),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, deleted: true })

    const after = await GET(req("GET", templateId, undefined, adminCookie()), ctx(templateId))
    expect(after.status).toBe(404)
  })

  it("returns 404 for an unknown id", async () => {
    const response = await DELETE(
      req("DELETE", "tpl_missing", undefined, adminCookie()),
      ctx("tpl_missing"),
    )
    expect(response.status).toBe(404)
  })
})
