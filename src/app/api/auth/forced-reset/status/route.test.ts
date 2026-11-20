// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getForcedResetStore, setForcedResetStoreForTests } from "@/lib/auth/forced-reset"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET } from "./route"

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

function cookie(uid = user.id, email = user.email) {
  return createAccessToken({ sid: "s1", uid, email, name: user.name }).token
}

let ipCounter = 0

function get(authCookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.8.${ipCounter}` }
  if (authCookie) headers.cookie = `${ACCESS_COOKIE}=${authCookie}`
  return GET(new Request("http://localhost/api/auth/forced-reset/status", { headers }))
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setForcedResetStoreForTests(undefined)
})

describe("GET /api/auth/forced-reset/status", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("reports required:false when no flag is set", async () => {
    const response = await get(cookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, required: false })
  })

  it("reports the caller's own flag only", async () => {
    getForcedResetStore().require("u1", { reason: "admin action", setBy: "root@lab.edu" })
    getForcedResetStore().require("u2")

    const response = await get(cookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      required: true,
      reason: "admin action",
      setBy: "root@lab.edu",
    })
    expect(typeof body.setAt).toBe("string")
  })

  it("scopes the flag to the token uid, not a query param", async () => {
    // Even if a client guesses another user's id there is no parameter to
    // pass — the uid always comes from the verified access token.
    getForcedResetStore().require("someone-else")
    const response = await get(cookie())
    expect(await response.json()).toMatchObject({ ok: true, required: false })
  })
})
