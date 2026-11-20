import { describe, expect, it } from "vitest"

import { buildSecurityReport, redactRun, redactText, scanRunForSecrets } from "./security"
import { buildOpsEvent, buildOpsRun, buildOpsStep } from "./fixtures"

const FAKE_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456"

describe("scanRunForSecrets", () => {
  it("returns a clean scan for benign runs", () => {
    const scan = scanRunForSecrets(buildOpsRun())
    expect(scan.findings).toEqual([])
    expect(scan.totalMatches).toBe(0)
    expect(scan.scannedFields).toBeGreaterThan(0)
    const report = buildSecurityReport(scan)
    expect(report.risk).toBe("clean")
    expect(report.recommendations[0]).toContain("No secrets")
  })

  it("detects API keys in step payloads and event messages", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Call API",
          payload: { headers: { authorization: `Bearer ${FAKE_KEY}` } },
        }),
      ],
      events: [buildOpsEvent({ id: "e1", message: `configured key ${FAKE_KEY} for prod` })],
    })
    const scan = scanRunForSecrets(run)
    const apiKey = scan.findings.find((f) => f.detector === "api_key")
    const bearer = scan.findings.find((f) => f.detector === "bearer_token")
    expect(apiKey).toBeTruthy()
    expect(apiKey!.count).toBeGreaterThanOrEqual(1)
    // Bearer + key overlap: the bearer pattern also matches the token part.
    expect(bearer).toBeTruthy()
    // Locations point at step payload and event message.
    const refs = apiKey!.locations.map((l) => `${l.target}:${l.ref}:${l.field}`)
    expect(refs.some((r) => r.startsWith("event:e1"))).toBe(true)
    // Samples must be redacted — never contain the raw key.
    for (const f of scan.findings) {
      expect(f.sample).not.toContain(FAKE_KEY)
    }
  })

  it("detects emails as low-severity PII", () => {
    const run = buildOpsRun({
      events: [buildOpsEvent({ id: "e1", message: "notify alice@example.com please" })],
    })
    const scan = scanRunForSecrets(run)
    const email = scan.findings.find((f) => f.detector === "email")
    expect(email?.severity).toBe("low")
    expect(email?.count).toBe(1)
  })

  it("detects private key blocks and JWTs", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOg==\n-----END RSA PRIVATE KEY-----"
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    const run = buildOpsRun({
      events: [
        buildOpsEvent({ id: "e1", message: `key material: ${pem}` }),
        buildOpsEvent({ id: "e2", message: `token ${jwt}` }),
      ],
    })
    const scan = scanRunForSecrets(run)
    expect(scan.findings.find((f) => f.detector === "private_key")?.severity).toBe("critical")
    expect(scan.findings.find((f) => f.detector === "jwt")?.severity).toBe("high")
    const report = buildSecurityReport(scan)
    expect(report.risk).toBe("high")
    expect(report.recommendations.some((r) => r.includes("Rotate"))).toBe(true)
  })

  it("detects secret assignments", () => {
    const run = buildOpsRun({
      events: [buildOpsEvent({ id: "e1", message: 'config: { api_key: "abcdef1234567890" }' })],
    })
    const scan = scanRunForSecrets(run)
    expect(scan.findings.find((f) => f.detector === "secret_assignment")).toBeTruthy()
  })

  it("detects JSON-shaped secrets with quoted keys and spaced values", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Configure",
          payload: { body: '{"password": "correct horse battery"}' },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    const finding = scan.findings.find((f) => f.detector === "secret_assignment")
    expect(finding).toBeTruthy()
    expect(finding!.count).toBeGreaterThanOrEqual(1)
  })

  it('detects secrets in object form {password: "x"} below the length floor', () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Auth",
          // 1-char value: under secret_assignment's 8-char floor, but the
          // key name alone establishes sensitivity (same as redactValue).
          payload: { password: "x" },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    const finding = scan.findings.find((f) => f.detector === "secret_key")
    expect(finding).toBeTruthy()
    expect(finding!.severity).toBe("high")
    // Location should point at the payload leaf, not just the run.
    expect(finding!.locations.some((l) => l.field.includes("password"))).toBe(true)
  })

  it("detects short secrets under camelCase keys like apiKey", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Auth",
          payload: { apiKey: "hunter2" }, // 7 chars — under the regex floor
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    expect(scan.findings.find((f) => f.detector === "secret_key")).toBeTruthy()
  })

  it("detects compound secret keys like secretKey", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Auth",
          payload: { secretKey: "abc12345" },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    // SECRET_KEY_RE matches the `secret` substring; the key-anchored detector
    // has no adjacency requirement, so camelCase compounds are covered.
    expect(scan.findings.find((f) => f.detector === "secret_key")).toBeTruthy()
  })

  it('detects nested secret keys {config:{secret:"..."}}', () => {
    const run = buildOpsRun({
      events: [
        buildOpsEvent({
          id: "e1",
          message: "loaded config",
          data: { config: { secret: "nestedsecret9" } },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    const finding = scan.findings.find((f) => f.detector === "secret_key")
    expect(finding).toBeTruthy()
    expect(finding!.locations.some((l) => l.field.includes("secret"))).toBe(true)
  })

  it("does not propagate the secret keyHint across object boundaries", () => {
    // {password:{nested:"x"}} — redactValue drops the parent hint at object
    // boundaries (children judged by their own keys), so the scan must too.
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Wrap",
          payload: { password: { nested: "x" } },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    expect(scan.findings.find((f) => f.detector === "secret_key")).toBeUndefined()
    const redacted = redactRun(run) as typeof run
    expect(redacted.steps[0].payload?.password).toEqual({ nested: "x" })
  })

  it("treats borderline keys like passwordHint consistently for scan and redact", () => {
    // SECRET_KEY_RE uses substring semantics, so `passwordHint` IS
    // secret-bearing for BOTH scan (secret_key finding) and redactRun
    // (wholesale [REDACTED:secret_key]). Conservative by design: the key
    // name declares sensitivity. Documented boundary — do not "fix" one
    // side without the other.
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "UI",
          payload: { passwordHint: "must be 8+ chars" },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    expect(scan.findings.find((f) => f.detector === "secret_key")).toBeTruthy()
    const redacted = redactRun(run)
    expect(redacted.steps[0].payload?.passwordHint).toBe("[REDACTED:secret_key]")
  })

  it("detects secrets inside arrays under secret keys", () => {
    const run = buildOpsRun({
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Bulk",
          payload: { passwords: ["a"] },
        }),
      ],
    })
    const scan = scanRunForSecrets(run)
    const finding = scan.findings.find((f) => f.detector === "secret_key")
    expect(finding).toBeTruthy()
    expect(finding!.count).toBe(1)
  })

  it("redact-then-rescan yields zero matches (runbook §8.3 recipe)", () => {
    const run = buildOpsRun({
      prompt: `deploy with password=hunter2secret`,
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Auth",
          payload: { password: "supersecret1", apiKey: "hunter2abc", secret: "s" },
        }),
      ],
      events: [
        buildOpsEvent({
          id: "e1",
          message: "ok",
          data: { config: { secret: "nestedsecret9" } },
        }),
      ],
    })
    expect(scanRunForSecrets(run).totalMatches).toBeGreaterThan(0)
    const redacted = redactRun(run)
    expect(scanRunForSecrets(redacted).totalMatches).toBe(0)
  })

  it("scans top-level run fields (prompt, name, summary, actor)", () => {
    const run = buildOpsRun({
      prompt: `please use key ${FAKE_KEY}`,
      summary: "finished for alice@example.com",
      actor: "bob@example.com",
    })
    const scan = scanRunForSecrets(run)
    const apiKey = scan.findings.find((f) => f.detector === "api_key")
    const email = scan.findings.find((f) => f.detector === "email")
    expect(apiKey).toBeTruthy()
    expect(email).toBeTruthy()
    const targets = new Set(
      [...(apiKey?.locations ?? []), ...(email?.locations ?? [])].map((l) => l.target),
    )
    expect(targets.has("run")).toBe(true)
  })
})

describe("redactText / redactRun", () => {
  it("redacts all detector matches", () => {
    const dirty = `key ${FAKE_KEY} mail bob@example.com`
    const clean = redactText(dirty)
    expect(clean).not.toContain(FAKE_KEY)
    expect(clean).not.toContain("bob@example.com")
    expect(clean).toContain("[REDACTED:api_key]")
    expect(clean).toContain("[REDACTED:email]")
  })

  it("redactRun sanitizes steps, events, and prompt without mutating input", () => {
    const run = buildOpsRun({
      prompt: `use ${FAKE_KEY} carefully`,
      summary: "done for bob@example.com",
      steps: [
        buildOpsStep({
          id: "s1",
          title: "Fetch",
          detail: `auth ${FAKE_KEY}`,
          payload: { note: "mail carol@example.com" },
        }),
      ],
      events: [
        buildOpsEvent({ id: "e1", message: `token ${FAKE_KEY}`, data: { k: "dave@example.com" } }),
      ],
    })
    const redacted = redactRun(run)
    expect(redacted.prompt).not.toContain(FAKE_KEY)
    expect(redacted.summary).not.toContain("bob@example.com")
    expect(redacted.steps[0].detail).not.toContain(FAKE_KEY)
    expect(JSON.stringify(redacted.steps[0].payload)).not.toContain("carol@example.com")
    expect(redacted.events[0].message).not.toContain(FAKE_KEY)
    expect(JSON.stringify(redacted.events[0].data)).not.toContain("dave@example.com")
    // Original untouched.
    expect(run.prompt).toContain(FAKE_KEY)
    expect(redacted.id).toBe(run.id)
  })

  it("redactRun leaves clean runs unchanged in content", () => {
    const run = buildOpsRun()
    const redacted = redactRun(run)
    expect(redacted.prompt).toBe(run.prompt)
    expect(redacted.steps).toHaveLength(run.steps.length)
  })

  it("redactRun redacts actor and secret-keyed object entries", () => {
    const run = buildOpsRun({
      actor: "carol@example.com",
      steps: [
        buildOpsStep({
          id: "s1",
          kind: "tool_call",
          title: "Auth",
          payload: {
            password: "short", // under a secret key — redacted regardless of detectors
            nested: { apiSecret: "also-secret" },
            benign: "visible",
          },
        }),
      ],
    })
    const redacted = redactRun(run)
    expect(redacted.actor).toBe("[REDACTED:email]")
    const payload = redacted.steps[0].payload as Record<string, unknown>
    expect(payload.password).toBe("[REDACTED:secret_key]")
    expect((payload.nested as Record<string, unknown>).apiSecret).toBe("[REDACTED:secret_key]")
    expect(payload.benign).toBe("visible")
  })
})
