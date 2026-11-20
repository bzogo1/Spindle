import { beforeEach, describe, expect, it } from "vitest"

import { enrollEmailSeries, resetEmailSeriesForTests } from "@/lib/email-series"
import { GET } from "./route"

let ipCounter = 0

function get(query: string, ip?: string) {
  return GET(
    new Request(`http://localhost/api/email-series/status?${query}`, {
      headers: { "x-forwarded-for": ip ?? `10.7.7.${++ipCounter}` },
    }),
  )
}

beforeEach(() => {
  resetEmailSeriesForTests()
})

describe("GET /api/email-series/status", () => {
  it("requires an email parameter", async () => {
    expect((await get("")).status).toBe(400)
    expect((await get("email=not-an-email")).status).toBe(400)
  })

  it("reports enrolled:false for unknown addresses", async () => {
    const data = await (await get("email=nobody@b.c")).json()
    expect(data).toMatchObject({ ok: true, enrolled: false })
  })

  it("returns enrollment progress", async () => {
    enrollEmailSeries({ email: "a@b.c", name: "A" })
    const data = await (await get("email=a@b.c")).json()
    expect(data).toMatchObject({
      ok: true,
      enrolled: true,
      status: "active",
      nextStepIndex: 0,
      sentSteps: [],
    })
    expect(data.nextSendAt).toBeTruthy()
  })
})
