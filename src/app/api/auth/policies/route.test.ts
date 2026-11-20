// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import {
  DEFAULT_SECURITY_POLICIES,
  MemorySecurityPolicyStore,
  setSecurityPolicyStoreForTests,
  type SecurityPolicies,
} from "@/lib/auth/security-policies"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET, PUT } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const validBody: SecurityPolicies = {
  requireTwoFactor: true,
  sessionMaxAgeHours: 12,
  allowedSignInWindow: { start: "08:00", end: "20:00" },
  minPasswordLength: 10,
}

let store: MemorySecurityPolicyStore

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set("cookie", `${ACCESS_COOKIE}=${cookie}`)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function get(cookie?: string) {
  return GET(request("/api/auth/policies", {}, cookie))
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    request(
      "/api/auth/policies",
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      cookie,
    ),
  )
}

beforeEach(() => {
  getUserById
    .mockReset()
    .mockImplementation(async (id: string) => (id === "u1" || id === "u2" ? { ...user, id } : null))
  store = new MemorySecurityPolicyStore()
  setSecurityPolicyStoreForTests(store)
})

describe("GET /api/auth/policies", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects tokens whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get(accessCookie())
    expect(response.status).toBe(401)
  })

  it("returns default policies for a fresh principal", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.policies).toEqual(DEFAULT_SECURITY_POLICIES)
  })
})

describe("PUT /api/auth/policies", () => {
  it("rejects cross-origin requests", async () => {
    const response = await put(validBody, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests", async () => {
    const response = await put(validBody)
    expect(response.status).toBe(401)
  })

  it("rejects malformed bodies", async () => {
    expect((await put("not json", accessCookie())).status).toBe(400)
    expect((await put({ requireTwoFactor: true }, accessCookie())).status).toBe(400)
    expect(
      (
        await put(
          { ...validBody, allowedSignInWindow: { start: "9am", end: "17:00" } },
          accessCookie(),
        )
      ).status,
    ).toBe(400)
  })

  it("stores the policy and echoes it back", async () => {
    const response = await put(validBody, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.policies).toEqual(validBody)
    expect(store.getPolicies("u1")).toEqual(validBody)

    // GET reflects the saved policy.
    const getResponse = await get(accessCookie())
    const getData = await getResponse.json()
    expect(getData.policies).toEqual(validBody)
  })

  it("scopes policies per principal", async () => {
    await put(validBody, accessCookie("u1"))
    const other = await get(accessCookie("u2"))
    const data = await other.json()
    expect(data.policies).toEqual(DEFAULT_SECURITY_POLICIES)
  })
})
