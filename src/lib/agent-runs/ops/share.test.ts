import { describe, expect, it } from "vitest"

import {
  agentRunSharePayloadFromLocation,
  createAgentRunSharePayload,
  decodeAgentRunShare,
  decodeAgentRunShareFromUrl,
  encodeAgentRunShare,
  encodeAgentRunShareForUrl,
  importAgentRunShare,
} from "./share"
import { buildOpsRun } from "./fixtures"

describe("agent run share payloads", () => {
  it("round-trips through JSON encode/decode", () => {
    const payload = createAgentRunSharePayload({
      run: buildOpsRun(),
      name: "My run",
      note: "for review",
      now: new Date("2026-02-01T00:00:00Z"),
    })
    const decoded = decodeAgentRunShare(encodeAgentRunShare(payload))
    expect(decoded).not.toBeNull()
    expect(decoded!.run.id).toBe("run_ops_01")
    expect(decoded!.name).toBe("My run")
    expect(decoded!.exportedAt).toBe("2026-02-01T00:00:00.000Z")
  })

  it("round-trips through base64url URL encoding", () => {
    const payload = createAgentRunSharePayload({ run: buildOpsRun() })
    const encoded = encodeAgentRunShareForUrl(payload)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    const decoded = decodeAgentRunShareFromUrl(encoded)
    expect(decoded?.run.prompt).toBe("Draft the methods section")
  })

  it("decodes payloads extracted from a location hash", () => {
    const payload = createAgentRunSharePayload({ run: buildOpsRun() })
    const encoded = encodeAgentRunShareForUrl(payload)
    const found = agentRunSharePayloadFromLocation(`https://app.example.com/x#share=${encoded}`)
    expect(found?.run.id).toBe("run_ops_01")
    const foundQuery = agentRunSharePayloadFromLocation(
      `https://app.example.com/x?share=${encoded}`,
    )
    expect(foundQuery?.run.id).toBe("run_ops_01")
    expect(agentRunSharePayloadFromLocation("https://app.example.com/x")).toBeNull()
  })

  it("round-trips prompts containing '%' without corruption", () => {
    const run = buildOpsRun({ prompt: "Deploy 100% to %staging% and check %25 off" })
    const payload = createAgentRunSharePayload({ run })
    // JSON path: verbatim parse, no decodeURIComponent.
    const decoded = decodeAgentRunShare(encodeAgentRunShare(payload))
    expect(decoded?.run.prompt).toBe(run.prompt)
    // URL path: base64url round-trip.
    const decodedUrl = decodeAgentRunShareFromUrl(encodeAgentRunShareForUrl(payload))
    expect(decodedUrl?.run.prompt).toBe(run.prompt)
  })

  it("decodeAgentRunShare parses raw JSON verbatim (no URI decoding)", () => {
    const run = buildOpsRun({ prompt: "keep %20 literal and %zz intact" })
    const json = encodeAgentRunShare(createAgentRunSharePayload({ run }))
    const decoded = decodeAgentRunShare(json)
    expect(decoded?.run.prompt).toBe("keep %20 literal and %zz intact")
  })

  it("normalizes lax runs missing metrics/tags on decode", () => {
    const lax = {
      version: 1,
      run: {
        id: "r1",
        prompt: "p",
        status: "succeeded",
        createdAt: "2026-01-01T00:00:00Z",
        steps: [],
        events: [],
        // metrics and tags intentionally absent
      },
      exportedAt: "2026-01-01T00:00:00Z",
    }
    const decoded = decodeAgentRunShare(JSON.stringify(lax))
    expect(decoded).not.toBeNull()
    expect(decoded!.run.metrics).toEqual({})
    expect(decoded!.run.tags).toEqual([])
    const imported = importAgentRunShare(decoded!)
    expect(imported.tags).toContain("shared:r1")
    expect(imported.metrics).toEqual({})
  })

  it("rejects malformed payloads", () => {
    expect(decodeAgentRunShare("not json")).toBeNull()
    expect(decodeAgentRunShare(JSON.stringify({ version: 2, run: {} }))).toBeNull()
    expect(decodeAgentRunShare(JSON.stringify({ version: 1, run: { id: 1 } }))).toBeNull()
    expect(decodeAgentRunShareFromUrl("!!!not-base64!!!")).toBeNull()
  })

  it("import assigns a fresh id and shared tag", () => {
    const payload = createAgentRunSharePayload({ run: buildOpsRun() })
    const imported = importAgentRunShare(payload, { now: new Date("2026-03-01T00:00:00Z") })
    expect(imported.id).not.toBe("run_ops_01")
    expect(imported.id).toContain("run_import_")
    expect(imported.tags).toContain("shared:run_ops_01")
    expect(imported.createdAt).toBe("2026-03-01T00:00:00.000Z")
    expect(imported.prompt).toBe("Draft the methods section")
  })
})
