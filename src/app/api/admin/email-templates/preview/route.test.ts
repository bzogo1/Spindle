// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  EMAIL_TEMPLATE_VAR_VALUE_MAX,
  listTemplates,
  resetEmailTemplateStoreForTests,
} from "@/lib/email-templates-editor"

import { POST } from "./route"

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

function req(body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.7.6.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  if (body !== undefined) headers["content-type"] = "application/json"
  return new Request("http://localhost/api/admin/email-templates/preview", {
    method: "POST",
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

describe("POST /api/admin/email-templates/preview", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await POST(req({ subject: "s", body: "b" }))
    expect(response.status).toBe(401)
  })

  it("renders variables without writing to the store", async () => {
    const response = await POST(
      req(
        {
          subject: "Hi {{name}}",
          body: "Go to {{url}}",
          vars: { name: "Ada", url: "https://x.io" },
        },
        adminCookie(),
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      subject: "Hi Ada",
      body: "Go to https://x.io",
    })
    expect(listTemplates()).toHaveLength(0)
  })

  it("renders missing variables as empty strings", async () => {
    const response = await POST(req({ subject: "Hi {{name}}", body: "{{missing}}" }, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.subject).toBe("Hi ")
    expect(body.body).toBe("")
  })

  it("renders prototype-named variables as empty strings", async () => {
    const response = await POST(
      req({ subject: "{{toString}}|{{constructor}}", body: "{{__proto__}}" }, adminCookie()),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, subject: "|", body: "" })
  })

  it("rejects invalid input with 400", async () => {
    for (const bad of [
      { subject: "s" }, // missing body
      { body: "b" }, // missing subject
      { subject: "s", body: "b", vars: "nope" },
      { subject: "s", body: "b", vars: { name: 42 } },
      {
        subject: "s",
        body: "b",
        vars: { name: "x".repeat(EMAIL_TEMPLATE_VAR_VALUE_MAX + 1) },
      },
    ]) {
      const response = await POST(req(bad, adminCookie()))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })
})
