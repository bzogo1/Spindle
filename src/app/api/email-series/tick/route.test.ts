import { beforeEach, describe, expect, it, vi } from "vitest"

const processEmailSeriesQueue = vi.fn()
const getServerEnv = vi.fn()

vi.mock("@/lib/email-series", () => ({
  processEmailSeriesQueue: (...args: unknown[]) => processEmailSeriesQueue(...args),
}))
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => getServerEnv(),
}))

import { POST } from "./route"

let ipCounter = 0

function post(headers: Record<string, string> = {}, ip?: string) {
  return POST(
    new Request("http://localhost/api/email-series/tick", {
      method: "POST",
      headers: {
        "x-forwarded-for": ip ?? `10.6.6.${++ipCounter}`,
        ...headers,
      },
    }),
  )
}

beforeEach(() => {
  processEmailSeriesQueue.mockReset()
  processEmailSeriesQueue.mockResolvedValue({
    checked: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    completed: 0,
  })
  getServerEnv.mockReset()
})

describe("POST /api/email-series/tick", () => {
  it("runs the queue when SESSION_SECRET is unset outside production", async () => {
    getServerEnv.mockReturnValue({ NODE_ENV: "test", SESSION_SECRET: undefined })
    const response = await post()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ ok: true, sent: 1 })
    expect(processEmailSeriesQueue).toHaveBeenCalledTimes(1)
  })

  it("fails closed in production without SESSION_SECRET", async () => {
    getServerEnv.mockReturnValue({ NODE_ENV: "production", SESSION_SECRET: undefined })
    const response = await post()
    expect(response.status).toBe(503)
    expect(processEmailSeriesQueue).not.toHaveBeenCalled()
  })

  it("requires the bearer secret when SESSION_SECRET is set", async () => {
    getServerEnv.mockReturnValue({
      NODE_ENV: "production",
      SESSION_SECRET: "top-secret-value",
    })

    expect((await post()).status).toBe(401)
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401)
    expect(processEmailSeriesQueue).not.toHaveBeenCalled()

    const okResponse = await post({ authorization: "Bearer top-secret-value" })
    expect(okResponse.status).toBe(200)
    expect(processEmailSeriesQueue).toHaveBeenCalledTimes(1)
  })

  it("returns 500 when the queue throws", async () => {
    getServerEnv.mockReturnValue({ NODE_ENV: "test", SESSION_SECRET: undefined })
    processEmailSeriesQueue.mockRejectedValue(new Error("boom"))
    expect((await post()).status).toBe(500)
  })
})
