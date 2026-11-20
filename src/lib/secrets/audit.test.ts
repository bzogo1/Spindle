import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createSecretAccessEvent,
  defaultSecretAccessLogPath,
  parseSecretAccessLog,
  readSecretAccessLog,
  recordSecretAccess,
  resolveSecretService,
  SecretAuditError,
  summarizeSecretAccess,
  withSecretAccessAudit,
  type SecretAccessEvent,
} from "./audit"

let logDir: string
let logPath: string

const baseInput = {
  actor: { kind: "system" as const, name: "secrets-check" },
  secretName: "SESSION_SECRET",
  action: "check" as const,
  source: "scripts/secrets/check.ts",
  environment: "prod",
}

beforeEach(() => {
  logDir = mkdtempSync(join(tmpdir(), "secret-audit-"))
  logPath = join(logDir, "audit.jsonl")
})

afterEach(() => {
  rmSync(logDir, { recursive: true, force: true })
})

function readLines(): SecretAccessEvent[] {
  return readSecretAccessLog(logPath)
}

describe("recordSecretAccess", () => {
  it("appends one JSON object per line with who/what/when/which-secret", () => {
    const event = recordSecretAccess(baseInput, {
      path: logPath,
      now: new Date("2025-01-02T03:04:05.000Z"),
    })

    expect(event.id).toMatch(/^saa_/)
    expect(event.timestamp).toBe("2025-01-02T03:04:05.000Z")
    expect(event.service).toBe("session")

    const lines = readFileSync(logPath, "utf8").trim().split("\n")
    expect(lines).toHaveLength(1)

    const stored = JSON.parse(lines[0]) as SecretAccessEvent
    expect(stored).toEqual(event)
    expect(stored.secretName).toBe("SESSION_SECRET")
  })

  it("appends successive events to the same file", () => {
    recordSecretAccess(baseInput, { path: logPath })
    recordSecretAccess(
      { ...baseInput, secretName: "RESEND_API_KEY", action: "read" },
      { path: logPath },
    )

    expect(readLines()).toHaveLength(2)
  })

  it("creates the parent directory when missing", () => {
    const nested = join(logDir, "nested", "deep", "audit.jsonl")
    recordSecretAccess(baseInput, { path: nested })

    expect(readSecretAccessLog(nested)).toHaveLength(1)
  })

  it("dryRun builds the event without writing anything", () => {
    const event = recordSecretAccess(baseInput, { path: logPath, dryRun: true })

    expect(event.secretName).toBe("SESSION_SECRET")
    expect(() => readFileSync(logPath, "utf8")).toThrow()
  })

  it("never writes a secret value, even when context text embeds credentials", () => {
    recordSecretAccess(
      {
        ...baseInput,
        reason: "upstream said Bearer abc.def.ghi and https://x.test/f?sig=zzz",
      },
      { path: logPath },
    )

    const raw = readFileSync(logPath, "utf8")
    expect(raw).not.toContain("abc.def.ghi")
    expect(raw).not.toContain("sig=zzz")
    expect(raw).toContain("[Redacted]")
  })

  it("rejects secret names that are not env-var shaped", () => {
    for (const bad of ["session_secret", "sk-live-123", "", "A B", "1PASSWORD"]) {
      expect(() =>
        recordSecretAccess({ ...baseInput, secretName: bad }, { path: logPath }),
      ).toThrow(SecretAuditError)
    }
  })

  it("rejects unknown actions and actor kinds", () => {
    expect(() =>
      recordSecretAccess({ ...baseInput, action: "exfiltrate" as never }, { path: logPath }),
    ).toThrow(SecretAuditError)
    expect(() =>
      recordSecretAccess({ ...baseInput, actor: { kind: "ghost" as never } }, { path: logPath }),
    ).toThrow(SecretAuditError)
  })

  it("throws SecretAuditError when the log cannot be written", () => {
    const blocker = join(logDir, "blocker")
    writeFileSync(blocker, "not a directory")

    expect(() => recordSecretAccess(baseInput, { path: join(blocker, "audit.jsonl") })).toThrow(
      SecretAuditError,
    )
  })
})

describe("parseSecretAccessLog", () => {
  it("skips blank and malformed lines", () => {
    const text = [
      JSON.stringify({
        id: "saa_1",
        timestamp: "2025-01-01T00:00:00Z",
        actor: { kind: "system" },
        secretName: "A_B",
        action: "read",
      }),
      "",
      "not json",
      JSON.stringify({ hello: "world" }),
      JSON.stringify({
        id: "saa_2",
        timestamp: "2025-01-01T00:01:00Z",
        actor: { kind: "user" },
        secretName: "C_D",
        action: "read",
      }),
    ].join("\n")

    const events = parseSecretAccessLog(text)
    expect(events.map((event) => event.id)).toEqual(["saa_1", "saa_2"])
  })
})

describe("withSecretAccessAudit", () => {
  it("records an allowed access on success and returns the value", async () => {
    const result = await withSecretAccessAudit(
      "WORKER_SECRET",
      () => "secret-value",
      { actor: { kind: "service", name: "worker" }, source: "worker/run.ts" },
      { path: logPath },
    )

    expect(result).toBe("secret-value")
    const [event] = readLines()
    expect(event.allowed).toBe(true)
    expect(event.secretName).toBe("WORKER_SECRET")
  })

  it("records a denied access and rethrows on failure", async () => {
    const failure = new Error("store unreachable")

    await expect(
      withSecretAccessAudit(
        "LLM_API_KEY",
        () => {
          throw failure
        },
        { actor: { kind: "service", name: "llm-client" } },
        { path: logPath },
      ),
    ).rejects.toBe(failure)

    const [event] = readLines()
    expect(event.allowed).toBe(false)
    expect(event.reason).toContain("store unreachable")
  })
})

describe("summarizeSecretAccess", () => {
  function event(overrides: Partial<SecretAccessEvent>): SecretAccessEvent {
    return {
      id: `saa_${Math.random().toString(36).slice(2)}`,
      timestamp: "2025-01-01T00:00:00.000Z",
      actor: { kind: "system", name: "test" },
      secretName: "SESSION_SECRET",
      action: "read",
      ...overrides,
    }
  }

  it("aggregates counts per secret, actor, action, and day", () => {
    const events = [
      event({ secretName: "SESSION_SECRET", timestamp: "2025-01-01T01:00:00Z" }),
      event({
        secretName: "SESSION_SECRET",
        timestamp: "2025-01-01T02:00:00Z",
        actor: { kind: "user", name: "alice" },
      }),
      event({ secretName: "RESEND_API_KEY", timestamp: "2025-01-02T01:00:00Z", action: "verify" }),
      event({
        secretName: "RESEND_API_KEY",
        timestamp: "2025-01-02T02:00:00Z",
        allowed: false,
        reason: "denied",
      }),
    ]

    const summary = summarizeSecretAccess(events)

    expect(summary.totalEvents).toBe(4)
    expect(summary.firstTimestamp).toBe("2025-01-01T01:00:00Z")
    expect(summary.lastTimestamp).toBe("2025-01-02T02:00:00Z")

    const session = summary.bySecret.find((entry) => entry.secretName === "SESSION_SECRET")
    expect(session?.count).toBe(2)
    expect(session?.distinctActors).toBe(2)
    expect(session?.service).toBe("session")

    const resend = summary.bySecret.find((entry) => entry.secretName === "RESEND_API_KEY")
    expect(resend?.denied).toBe(1)
    expect(resend?.service).toBe("resend")

    expect(summary.byAction.find((entry) => entry.action === "verify")?.count).toBe(1)
    expect(summary.byDay).toEqual([
      { day: "2025-01-01", count: 2 },
      { day: "2025-01-02", count: 2 },
    ])

    expect(summary.anomalies).toEqual([
      {
        type: "denied-access",
        secretName: "RESEND_API_KEY",
        detail: "1 denied or failed access attempt(s)",
        count: 1,
      },
    ])
  })

  it("flags secrets outside the catalog and high per-day volume", () => {
    const events = [
      event({ secretName: "NOT_A_REAL_SECRET" }),
      ...Array.from({ length: 5 }, () =>
        event({ secretName: "B2_APPLICATION_KEY", timestamp: "2025-01-01T00:00:00Z" }),
      ),
    ]

    const summary = summarizeSecretAccess(events, { highVolumePerDay: 3 })
    const types = summary.anomalies.map((anomaly) => anomaly.type)

    expect(types).toContain("unknown-secret")
    expect(types).toContain("high-volume")
    expect(summary.anomalies.find((anomaly) => anomaly.type === "high-volume")?.secretName).toBe(
      "B2_APPLICATION_KEY",
    )
  })

  it("returns an empty summary for no events", () => {
    const summary = summarizeSecretAccess([])

    expect(summary.totalEvents).toBe(0)
    expect(summary.bySecret).toEqual([])
    expect(summary.anomalies).toEqual([])
  })
})

describe("helpers", () => {
  it("resolves catalog services for current and previous variables", () => {
    expect(resolveSecretService("SESSION_SECRET")).toBe("session")
    expect(resolveSecretService("SESSION_SECRET_PREVIOUS")).toBe("session")
    expect(resolveSecretService("SOMETHING_ELSE")).toBeUndefined()
  })

  it("defaults the log path to .spindle/secret-access-audit.jsonl", () => {
    expect(defaultSecretAccessLogPath()).toMatch(/\.spindle[/\\]secret-access-audit\.jsonl$/)
  })

  it("createSecretAccessEvent fills id and timestamp", () => {
    const event = createSecretAccessEvent(baseInput, { now: new Date("2025-06-01T00:00:00Z") })

    expect(event.id).toMatch(/^saa_/)
    expect(event.timestamp).toBe("2025-06-01T00:00:00.000Z")
  })
})
