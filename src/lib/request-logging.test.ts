// @vitest-environment node

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createLogger, REDACTED } from "./logger"
import { getRequestLogger, setRequestLogContext, withRequestLogging } from "./request-logging"

const sentry = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }))

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: sentry.addBreadcrumb,
}))

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

function makeRequest(
  path = "/api/projects/project_1/files?X-Amz-Signature=url-secret",
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(`https://spindle.app${path}`, init)
}

describe("withRequestLogging", () => {
  beforeEach(() => {
    sentry.addBreadcrumb.mockClear()
  })

  it("logs exactly one summary line with the request context", async () => {
    const { logger, entries } = captureLogs()
    const handler = withRequestLogging(
      async (request: NextRequest) => {
        setRequestLogContext(request, { userId: "user_1", projectId: "project_1" })
        return Response.json({ ok: true })
      },
      { logger },
    )

    const response = await handler(
      makeRequest(undefined, {
        method: "POST",
        headers: { "x-request-id": "req-from-client", cookie: "session=cookie-secret" },
      }),
      {},
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("x-request-id")).toBe("req-from-client")

    const records = entries()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: "api.request",
      requestId: "req-from-client",
      method: "POST",
      path: "/api/projects/project_1/files",
      status: 200,
      userId: "user_1",
      projectId: "project_1",
    })
    expect(typeof records[0].durationMs).toBe("number")

    const output = JSON.stringify(records)
    expect(output).not.toContain("url-secret")
    expect(output).not.toContain("cookie-secret")
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled()
  })

  it("generates a request id and records handled errors as breadcrumbs", async () => {
    const { logger, entries } = captureLogs()
    const handler = withRequestLogging(
      async () => Response.json({ error: "forbidden" }, { status: 403 }),
      { logger },
    )

    const response = await handler(makeRequest("/api/projects/project_2"), {})

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
    expect(entries()[0]).toMatchObject({ status: 403, userId: null, projectId: null })
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "api",
        level: "warning",
        data: expect.objectContaining({ status: 403 }),
      }),
    )
  })

  it("logs a failed request once, redacts the error, and rethrows", async () => {
    const { logger, lines, entries } = captureLogs()
    const failure = new Error("upload failed with Bearer bearer-secret")
    const handler = withRequestLogging(
      async () => {
        throw failure
      },
      { logger },
    )

    await expect(handler(makeRequest("/api/projects/project_3/uploads"), {})).rejects.toBe(failure)

    const records = entries()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: "api.request",
      path: "/api/projects/project_3/uploads",
      status: 500,
      error: { type: "Error" },
    })
    expect(JSON.stringify(records[0].error)).toContain(REDACTED)
    expect(lines.join("")).not.toContain("bearer-secret")
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "api", level: "error" }),
    )
  })

  it("binds the request logger to the request id and sanitises handler logs", async () => {
    const { logger, lines, entries } = captureLogs()
    const handler = withRequestLogging(
      async (request: NextRequest) => {
        getRequestLogger(request).info({ file: { content: "file-content-secret" } }, "uploading")
        return Response.json({ ok: true })
      },
      { logger },
    )

    await handler(makeRequest("/api/uploads", { headers: { "x-request-id": "req-handler" } }), {})

    expect(entries()).toHaveLength(2)
    expect(entries()[0]).toMatchObject({ requestId: "req-handler", msg: "uploading" })
    expect(entries()[1]).toMatchObject({ event: "api.request", requestId: "req-handler" })
    expect(lines.join("")).not.toContain("file-content-secret")
  })
})
