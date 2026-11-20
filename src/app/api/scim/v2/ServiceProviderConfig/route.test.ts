// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { createScimToken, resetScimTokensForTests } from "@/lib/scim-tokens"
import { SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG } from "@/lib/scim"

import { GET } from "./route"

let ipCounter = 0
let bearer: string

function call(token?: string | null) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.0.${++ipCounter}`,
  }
  const value = token === undefined ? bearer : token
  if (value) headers.authorization = `Bearer ${value}`
  return GET(new Request("http://localhost/api/scim/v2/ServiceProviderConfig", { headers }))
}

beforeEach(() => {
  resetScimTokensForTests()
  bearer = createScimToken("ws-1").token
})

describe("GET /api/scim/v2/ServiceProviderConfig", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call(null)
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("Bearer")
  })

  it("returns the capability document for a valid token", async () => {
    const response = await call()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      schemas: [SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [expect.objectContaining({ type: "oauthbearertoken" })],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: "/api/scim/v2/ServiceProviderConfig",
      },
    })
  })
})
