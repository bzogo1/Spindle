// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  BACKUP_CODE_ISSUE_COUNT,
  clearUserBackupCodes,
  consumeBackupCode,
  getBackupCodeStatus,
  issueBackupCodes,
  setBackupCodeStoreForTests,
} from "./backup-codes"
import { hashBackupCode, normalizeBackupCode } from "./totp"

const USER = "user-1"
// Unambiguous alphabet: no 0/O, 1/I/L (see totp.ts backupCodeAlphabet).
const CODE_FORMAT = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/

beforeEach(() => {
  setBackupCodeStoreForTests(undefined)
})

describe("issueBackupCodes", () => {
  it("generates unique XXXX-XXXX codes and stores only hashes", async () => {
    const { codes, remaining } = await issueBackupCodes(USER)

    expect(codes).toHaveLength(BACKUP_CODE_ISSUE_COUNT)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(CODE_FORMAT)
    expect(remaining).toBe(codes.length)

    // The store holds SHA-256 digests, never plaintext.
    const digest = await hashBackupCode(codes[0])
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain(codes[0].replace("-", ""))
  })

  it("marks the user as managed with the full remaining count", async () => {
    await issueBackupCodes(USER, 4)
    expect(getBackupCodeStatus(USER)).toEqual({ managed: true, remaining: 4 })
    expect(getBackupCodeStatus("someone-else")).toEqual({
      managed: false,
      remaining: null,
    })
  })
})

describe("consumeBackupCode", () => {
  it("consumes a code once, accepting dashes, case, and spaces", async () => {
    const { codes } = await issueBackupCodes(USER, 3)
    const code = codes[0]

    const messy = `${code.slice(0, 2).toLowerCase()} ${code.slice(2, 6)}-${code.slice(6)}`
    await expect(consumeBackupCode(USER, messy)).resolves.toBe(true)
    await expect(consumeBackupCode(USER, code)).resolves.toBe(false)
    expect(getBackupCodeStatus(USER).remaining).toBe(2)
  })

  it("rejects unknown, malformed, and wrong-length codes", async () => {
    await issueBackupCodes(USER, 2)

    await expect(consumeBackupCode(USER, "ZZZZ-ZZZZ")).resolves.toBe(false)
    await expect(consumeBackupCode(USER, "SHORT")).resolves.toBe(false)
    await expect(consumeBackupCode(USER, "")).resolves.toBe(false)
    await expect(consumeBackupCode("nobody", "ABCD-1234")).resolves.toBe(false)
    expect(getBackupCodeStatus(USER).remaining).toBe(2)
  })

  it("keeps the set managed at zero remaining so old codes stay dead", async () => {
    const { codes } = await issueBackupCodes(USER, 1)
    await expect(consumeBackupCode(USER, codes[0])).resolves.toBe(true)

    expect(getBackupCodeStatus(USER)).toEqual({ managed: true, remaining: 0 })
    await expect(consumeBackupCode(USER, codes[0])).resolves.toBe(false)
  })
})

describe("regeneration and clear", () => {
  it("invalidates every previously issued code", async () => {
    const first = await issueBackupCodes(USER, 3)
    const second = await issueBackupCodes(USER, 3)

    for (const code of first.codes) {
      await expect(consumeBackupCode(USER, code)).resolves.toBe(false)
    }
    await expect(consumeBackupCode(USER, second.codes[0])).resolves.toBe(true)
    expect(getBackupCodeStatus(USER).remaining).toBe(2)
  })

  it("clear drops the managed set", async () => {
    await issueBackupCodes(USER)
    clearUserBackupCodes(USER)
    expect(getBackupCodeStatus(USER)).toEqual({ managed: false, remaining: null })
  })
})

describe("hash parity with enrollment codes", () => {
  it("hashBackupCode is case/dash insensitive like totp helpers", async () => {
    const hash = await hashBackupCode("abcd-1234")
    expect(await hashBackupCode("ABCD1234")).toBe(hash)
    expect(normalizeBackupCode("wxyz 9876")).toBe("WXYZ9876")
  })
})
