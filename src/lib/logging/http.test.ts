// @vitest-environment node

import { describe, expect, it } from "vitest"

import { createLogger } from "../logger"
import { extendLogContext, getContextLogger, getLogContext } from "./context"
import { logHttpRequest, withHttpLogging } from "./http"

function captureLogs() {
  const lines: string[] = []
  const logger = createLogger({
    destination: {
      write(line) {
        lines.push(line)
      },
    },
  })

  return {
    logger,
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe("withHttpLogging", () => {
  it("logs one api.request summary with path only and sets x-request-id", async () => {
    const { logger, entries } = captureLogs()
    const handler = withHttpLogging(
      async (_request: Request) => Response.json({ ok: true }, { status: 201 }),
      { logger },
    )

    const response = await handler(
      new Request("https://spindle.app/api/hook?token=query-secret", {
        headers: { "x-request-id": "req_incoming" },
      }),
    )

    expect(response.status).toBe(201)
    expect(response.headers.get("x-request-id")).toBe("req_incoming")

    const summaries = entries().filter((entry) => entry.event === "api.request")
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      requestId: "req_incoming",
      method: "GET",
      path: "/api/hook",
      status: 201,
    })
    expect(summaries[0]).not.toHaveProperty("query")
    expect(JSON.stringify(summaries[0])).not.toContain("query-secret")
  })

  it("generates a request id when the header is missing or invalid", async () => {
    const { logger, entries } = captureLogs()
    const handler = withHttpLogging(async () => new Response(null, { status: 204 }), {
      logger,
    })

    const response = await handler(new Request("https://spindle.app/ping"))
    const requestId = response.headers.get("x-request-id")

    expect(requestId).toBeTruthy()
    expect(entries().find((entry) => entry.event === "api.request")).toMatchObject({
      requestId,
      status: 204,
    })
  })

  it("exposes the context inside the handler and merges extendLogContext into the summary", async () => {
    const { logger, entries } = captureLogs()
    let seenRequestId: string | undefined

    const handler = withHttpLogging(
      async (_request: Request) => {
        seenRequestId = getLogContext()?.requestId as string | undefined
        extendLogContext({ userId: "user_1", projectId: "project_1" })
        // A context-bound logger inside the handler carries the ids too.
        getContextLogger(logger).info({ event: "handler.step" }, "step")
        return Response.json({})
      },
      { logger },
    )

    await handler(new Request("https://spindle.app/api/thing", { method: "POST" }))

    expect(seenRequestId).toBeTruthy()

    const step = entries().find((entry) => entry.event === "handler.step")
    expect(step).toMatchObject({ requestId: seenRequestId })

    const summary = entries().find((entry) => entry.event === "api.request")
    expect(summary).toMatchObject({ userId: "user_1", projectId: "project_1" })
  })

  it("logs the error and rethrows when the handler throws", async () => {
    const { logger, entries } = captureLogs()
    const handler = withHttpLogging(
      async () => {
        throw new Error("boom")
      },
      { logger },
    )

    await expect(handler(new Request("https://spindle.app/api/fail"))).rejects.toThrow("boom")

    const summary = entries().find((entry) => entry.event === "api.request")
    expect(summary).toMatchObject({
      status: 500,
      error: { type: "Error", message: "boom" },
    })
  })

  it("passes through extra handler arguments", async () => {
    const { logger } = captureLogs()
    const handler = withHttpLogging(
      async (_request: Request, params: { id: string }) => Response.json({ id: params.id }),
      { logger },
    )

    const response = await handler(new Request("https://spindle.app/api/items/1"), { id: "item_1" })
    await expect(response.json()).resolves.toEqual({ id: "item_1" })
  })
})

describe("logHttpRequest", () => {
  it("emits an api.request line for an externally produced response", () => {
    const { logger, entries } = captureLogs()

    logHttpRequest({
      request: new Request("https://spindle.app/api/manual?a=1"),
      response: new Response(null, { status: 202 }),
      durationMs: 12.34,
      logger,
    })

    expect(entries()[0]).toMatchObject({
      event: "api.request",
      method: "GET",
      path: "/api/manual",
      status: 202,
      durationMs: 12.3,
    })
  })
})
