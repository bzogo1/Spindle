// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { getAccountRecoveryStore, setAccountRecoveryStoreForTests } from "@/lib/auth/recovery-store"
import { setAuthAuditLogForTests } from "@/lib/auth/audit"
import { POST } from "./route"

let ipCounter = 0
function post(body: unknown) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/recovery/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.10.0.${ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  setAccountRecoveryStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/recovery/verify", () => {
  it("rejects cross-origin requests and malformed bodies", async () => {
    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/recovery/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.10.9.1",
        },
        body: JSON.stringify({ token: "x" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect((await post({})).status).toBe(400)
  })

  it("rejects unknown tokens with reason invalid", async () => {
    const response = await post({ token: "nope" })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "invalid_token",
      reason: "invalid",
    })
  })

  it("exchanges a live token for a session token exactly once", async () => {
    const store = getAccountRecoveryStore()
    const issued = store.issue({ userId: "u1", email: "ada@lab.edu" })
    if (!issued.ok) throw new Error("issue failed")

    const response = await post({ token: issued.token })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ ok: true, email: "ada@lab.edu" })
    expect(typeof payload.sessionToken).toBe("string")

    // The emailed token cannot be replayed.
    const replay = await post({ token: issued.token })
    expect(replay.status).toBe(401)
    expect(await replay.json()).toMatchObject({ reason: "used" })

    // The session token authorises the verified phase.
    expect(store.getBySessionToken(payload.sessionToken)?.userId).toBe("u1")
  })
})
