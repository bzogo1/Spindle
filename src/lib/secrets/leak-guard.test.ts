// @vitest-environment node

import { describe, expect, it } from "vitest"

import { containsSecret, REDACTED, scrubError, scrubSecrets } from "./leak-guard"

// Fixtures are assembled at runtime so the literal credential strings never
// appear in the repo (scripts/secrets/leak-detection would flag them).
const ghToken = `ghp_${"a1B2".repeat(9)}`
const openAiKey = `sk-proj-${"xY9".repeat(8)}-${"zZ7".repeat(8)}`
const awsKey = `AKIA${"IOSFODNN7EXAMPLE"}`
const jwt = `${"eyJ" + "hbGciOiJIUzI1NiJ9"}.${"eyJzdWIiOiIxMjM0NTY3ODkwIn0"}.${"c2lnbmF0dXJlMTIz"}`
const privateKey = `-----BEGIN ${"PRIVATE"} KEY-----\n${"QUJD".repeat(12)}\n-----END ${"PRIVATE"} KEY-----`
const connString = `postgres://app:${"s3cr3t" + "Pssw0rd"}@db.example.com/app`

describe("scrubSecrets", () => {
  it("redacts GitHub, OpenAI, AWS, and JWT credentials", () => {
    const input = [
      `token ${ghToken} leaked`,
      `key ${openAiKey}`,
      `aws ${awsKey} here`,
      `jwt ${jwt}`,
    ].join("; ")

    const output = scrubSecrets(input)

    expect(output).not.toContain("ghp_")
    expect(output).not.toContain("sk-proj-")
    expect(output).not.toContain("AKIA")
    expect(output).not.toContain("eyJhbGci")
    expect(output).toContain(REDACTED)
    expect(output).toContain("leaked")
  })

  it("redacts private key blocks including their bodies", () => {
    const input = `error:\n${privateKey}\nmore`

    const output = scrubSecrets(input)

    expect(output).not.toContain("QUJD")
    expect(output).not.toContain("PRIVATE KEY")
    expect(output).toContain("more")
  })

  it("keeps the Bearer scheme label readable", () => {
    expect(scrubSecrets("Authorization: Bearer abc.def.ghi")).toBe(
      `Authorization: Bearer ${REDACTED}`,
    )
  })

  it("redacts passwords inside connection strings", () => {
    const output = scrubSecrets(`failed: ${connString}`)
    expect(output).toBe(`failed: postgres://app:${REDACTED}@db.example.com/app`)
  })

  it("redacts secret assignments but leaves placeholders and env references", () => {
    const dirty = scrubSecrets(`SESSION_SECRET="${"v4lue".repeat(4)}" other`)
    expect(dirty).toBe(`SESSION_SECRET="${REDACTED}" other`)

    const clean = scrubSecrets(
      "SESSION_SECRET=process.env.SESSION_SECRET API_KEY=<your-key> TOKEN=${TOKEN}",
    )
    expect(clean).toContain("process.env.SESSION_SECRET")
    expect(clean).toContain("<your-key>")
    expect(clean).toContain("${TOKEN}")
  })

  it("leaves ordinary text untouched", () => {
    const text = "User bob@example.com updated profile at /settings"
    expect(scrubSecrets(text)).toBe(text)
    expect(containsSecret(text)).toBe(false)
  })

  it("handles empty input", () => {
    expect(scrubSecrets("")).toBe("")
  })
})

describe("scrubError", () => {
  it("scrubs message and stack without mutating the original", () => {
    const error = new Error(`connect failed with ${ghToken}`)
    error.stack = "Error: connect failed\n    at handler (src/x.ts:1:1)"

    const scrubbed = scrubError(error)

    expect(scrubbed.message).not.toContain("ghp_")
    expect(scrubbed.message).toContain(REDACTED)
    expect(scrubbed.stack).not.toContain("ghp_")
    expect(error.message).toContain("ghp_") // original untouched
    expect(scrubbed.name).toBe(error.name)
  })
})
