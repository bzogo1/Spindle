// @vitest-environment node

import { describe, expect, it } from "vitest"

import { createLogger, REDACTED, redactUrl } from "./logger"

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

describe("logger", () => {
  it("redacts cookies, tokens, signed URLs, and file contents", () => {
    const { logger, lines } = captureLogs()

    logger.info(
      {
        requestId: "req_1",
        userId: "user_1",
        headers: {
          cookie: "session=cookie-secret",
          authorization: "Bearer bearer-secret",
          "set-cookie": "theme=dark; token=set-cookie-secret",
        },
        tokens: { accessToken: "access-secret", refreshToken: "refresh-secret" },
        apiKey: "api-key-secret",
        password: "password-secret",
        upload: {
          fileName: "notes.txt",
          content: "file-content-secret",
          signedUrl:
            "https://storage.example.com/notes.txt?X-Amz-Signature=signature-secret&X-Amz-Credential=credential-secret",
        },
      },
      "upload failed",
    )

    const output = lines.join("")

    expect(output).not.toContain("cookie-secret")
    expect(output).not.toContain("bearer-secret")
    expect(output).not.toContain("set-cookie-secret")
    expect(output).not.toContain("access-secret")
    expect(output).not.toContain("refresh-secret")
    expect(output).not.toContain("api-key-secret")
    expect(output).not.toContain("password-secret")
    expect(output).not.toContain("file-content-secret")
    expect(output).not.toContain("signature-secret")
    expect(output).not.toContain("credential-secret")

    expect(output).toContain(REDACTED)
    expect(output).toContain("req_1")
    expect(output).toContain("user_1")
    expect(output).toContain("notes.txt")
  })

  it("redacts secrets nested in arrays and deep objects", () => {
    const { logger, lines } = captureLogs()

    logger.warn({
      events: [
        { kind: "upload", secret: "array-secret" },
        { kind: "download", meta: { deeper: { authorization: "Bearer deep-bearer-secret" } } },
      ],
    })

    const output = lines.join("")
    expect(output).not.toContain("array-secret")
    expect(output).not.toContain("deep-bearer-secret")
    expect(output).toContain("upload")
  })

  it("redacts signed URL query values but keeps the path", () => {
    expect(redactUrl("/files/report.pdf?token=query-secret&X-Amz-Signature=signature-secret")).toBe(
      `/files/report.pdf?token=${encodeURIComponent(REDACTED)}&X-Amz-Signature=${encodeURIComponent(REDACTED)}`,
    )
    expect(redactUrl("https://user:pass@storage.example.com/report.pdf?token=query-secret")).toBe(
      `https://storage.example.com/report.pdf?token=${encodeURIComponent(REDACTED)}`,
    )
  })

  it("redacts credentials embedded in error messages", () => {
    const { logger, lines } = captureLogs()
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart"

    logger.error(new Error(`request failed for Bearer bearer-secret and ${jwt}`), "handled")

    const output = lines.join("")
    expect(output).not.toContain("bearer-secret")
    expect(output).not.toContain(jwt)
    expect(output).toContain(REDACTED)
  })

  it("keeps benign context and marks circular references", () => {
    const { logger, entries } = captureLogs()
    const context: Record<string, unknown> = { requestId: "req_2", projectId: "project_2" }
    context.self = context

    logger.info(context, "ok")

    const [entry] = entries()
    expect(entry).toMatchObject({ requestId: "req_2", projectId: "project_2", self: "[Circular]" })
  })
})
