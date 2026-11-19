import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { configuredEnvKeys } from "@/lib/env.server"

import { dualKeySecrets, secretCatalog, secretVariables } from "./catalog"

describe("secret catalog", () => {
  it("covers every required service", () => {
    expect(secretCatalog.map((entry) => entry.service).sort()).toEqual([
      "b2",
      "database",
      "edge",
      "llm",
      "resend",
      "session",
      "worker",
    ])
  })

  it("has no duplicate variables", () => {
    expect(new Set(secretVariables).size).toBe(secretVariables.length)
  })

  it("gives every dual-key secret a previous variable", () => {
    expect(dualKeySecrets.length).toBeGreaterThan(0)

    for (const entry of dualKeySecrets) {
      expect(entry.previousVariables?.length).toBeGreaterThan(0)
    }
  })

  it("keeps the catalog and the env schema in sync", () => {
    const configured = new Set(configuredEnvKeys)

    for (const key of secretVariables) {
      expect(configured.has(key)).toBe(true)
    }
  })

  it("documents every variable with an empty value in .env.example", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8")
    const documented = new Map(
      [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((match) => [match[1], match[2]]),
    )

    for (const key of secretVariables) {
      expect(documented.has(key)).toBe(true)
      expect(documented.get(key)?.trim()).toBe("")
    }
  })
})
