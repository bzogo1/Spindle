import { describe, expect, it } from "vitest"

import { PASSWORD_STRENGTH_LABELS, scorePassword } from "./password-strength"

describe("scorePassword", () => {
  it("scores an empty password as the weakest", () => {
    const result = scorePassword("")
    expect(result.score).toBe(0)
    expect(result.level).toBe(0)
    expect(result.label).toBe(PASSWORD_STRENGTH_LABELS[0])
  })

  it("caps common blocklist passwords at Weak", () => {
    for (const password of [
      "password",
      "Password1!",
      "123456",
      "qwerty",
      "letmein",
      "sunshine2024",
      "iloveyou",
    ]) {
      expect(scorePassword(password).level).toBe(0)
      expect(scorePassword(password).label).toBe("Weak")
    }
  })

  it("rates long mixed-class passwords as Strong", () => {
    const result = scorePassword("Tr0ub4dor&3x")
    expect(result.level).toBe(3)
    expect(result.label).toBe("Strong")
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it("penalizes sequential character runs", () => {
    const sequential = scorePassword("abcdefgh")
    const varied = scorePassword("q7#x2$mZ9w")
    expect(sequential.score).toBeLessThan(varied.score)
    expect(sequential.level).toBe(0)
  })

  it("penalizes repeated characters and tiny alphabets", () => {
    for (const password of ["aaaaaaaaaaaaaaaaaaaa", "abababababababab", "abcabcabcabcabc"]) {
      expect(scorePassword(password).level).toBe(0)
    }
  })

  it("rewards length and character-class variety monotonically-ish", () => {
    const short = scorePassword("aB3$x")
    const longer = scorePassword("aB3$xY9!kQ2#vL8@m")
    expect(longer.score).toBeGreaterThan(short.score)
    expect(longer.level).toBeGreaterThanOrEqual(short.level)
  })

  it("always returns a score in range with a matching label", () => {
    for (const password of ["x", "correct horse battery staple", "Z9#kQ2$vL8nM4&pR"]) {
      const result = scorePassword(password)
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
      expect(result.label).toBe(PASSWORD_STRENGTH_LABELS[result.level])
    }
  })
})
