// @vitest-environment node

import { describe, expect, it } from "vitest"

import { createLogger } from "../logger"
import {
  contextFields,
  extendLogContext,
  getContextLogger,
  getLogContext,
  runWithLogContext,
  withLogContext,
} from "./context"

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

describe("log context", () => {
  it("returns undefined outside a context", () => {
    expect(getLogContext()).toBeUndefined()
    expect(contextFields()).toEqual({})
  })

  it("exposes fields inside runWithLogContext and across awaits", async () => {
    await runWithLogContext({ requestId: "req_1", userId: "user_1" }, async () => {
      await Promise.resolve()
      expect(getLogContext()).toMatchObject({ requestId: "req_1", userId: "user_1" })
      expect(contextFields()).toEqual({ requestId: "req_1", userId: "user_1" })
    })
  })

  it("merges nested contexts, inner fields winning", () => {
    runWithLogContext({ requestId: "req_1", projectId: "project_1" }, () => {
      runWithLogContext({ projectId: "project_2", traceId: "trace_1" }, () => {
        expect(getLogContext()).toMatchObject({
          requestId: "req_1",
          projectId: "project_2",
          traceId: "trace_1",
        })
      })
      expect(getLogContext()).toMatchObject({ requestId: "req_1", projectId: "project_1" })
    })
  })

  it("extendLogContext mutates the active context and drops nullish fields", () => {
    runWithLogContext({ requestId: "req_1" }, () => {
      extendLogContext({ userId: "user_9", projectId: null })
      expect(contextFields()).toEqual({ requestId: "req_1", userId: "user_9" })
    })
  })

  it("extendLogContext outside a context returns the fields without storing them", () => {
    expect(extendLogContext({ requestId: "req_x" })).toEqual({ requestId: "req_x" })
    expect(getLogContext()).toBeUndefined()
  })

  it("withLogContext wraps a function with merged fields", async () => {
    const fn = withLogContext({ requestId: "req_w" }, async (suffix: string) => {
      await Promise.resolve()
      return `${getLogContext()?.requestId}:${suffix}`
    })

    await runWithLogContext({ userId: "user_w" }, async () => {
      await expect(fn("ok")).resolves.toBe("req_w:ok")
      // The wrapped function's context does not leak into the caller.
      expect(getLogContext()).toEqual({ userId: "user_w" })
    })
  })
})

describe("getContextLogger", () => {
  it("binds context fields to every log line", () => {
    const { logger, entries } = captureLogs()

    runWithLogContext({ requestId: "req_2", projectId: "project_2" }, () => {
      getContextLogger(logger).info({ event: "thing.happened" }, "thing happened")
    })

    expect(entries()[0]).toMatchObject({
      requestId: "req_2",
      projectId: "project_2",
      event: "thing.happened",
    })
  })

  it("returns the base logger unchanged outside a context", () => {
    const { logger } = captureLogs()
    expect(getContextLogger(logger)).toBe(logger)
  })

  it("keeps core redaction on context-bound loggers", () => {
    const { logger, lines } = captureLogs()

    runWithLogContext({ requestId: "req_3" }, () => {
      getContextLogger(logger).info({ apiKey: "secret-key" }, "leak check")
    })

    expect(lines.join("")).not.toContain("secret-key")
  })
})
