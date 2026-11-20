import { describe, expect, it } from "vitest"

import {
  assessContactSpam,
  CONTACT_SPAM_LIMITS,
  DISPOSABLE_EMAIL_DOMAINS,
  SPAM_TIMESTAMP_FIELD,
  spamVerdict,
  type SpamSignal,
} from "./contact-spam"

const NOW = Date.parse("2025-06-01T12:00:00.000Z")

function renderedAt(secondsAgo: number): string {
  return new Date(NOW - secondsAgo * 1000).toISOString()
}

const cleanInput = {
  renderedAt: renderedAt(30),
  name: "Ada Lovelace",
  email: "ada@lab.edu",
  subject: "Export question",
  message: "How do I export a lab session to CSV?",
}

const codes = (signals: SpamSignal[]) => signals.map((s) => s.code)
const severities = (signals: SpamSignal[]) => signals.map((s) => s.severity)

describe("SPAM_TIMESTAMP_FIELD", () => {
  it("is the hidden renderedAt field name", () => {
    expect(SPAM_TIMESTAMP_FIELD).toBe("renderedAt")
  })
})

describe("assessContactSpam — clean input", () => {
  it("returns no signals for a normal submission", () => {
    const signals = assessContactSpam(cleanInput, { now: NOW })
    expect(signals).toEqual([])
    expect(spamVerdict(signals)).toBe("pass")
  })

  it("accepts a single link and normal punctuation", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        message: "See https://example.com/docs for details. Thanks!",
      },
      { now: NOW },
    )
    expect(signals).toEqual([])
  })

  it("ignores the script check for very short texts", () => {
    const signals = assessContactSpam({ ...cleanInput, subject: "", message: "" }, { now: NOW })
    expect(codes(signals)).not.toContain("non-latin")
  })
})

describe("assessContactSpam — time trap", () => {
  it("flags a missing renderedAt", () => {
    const { renderedAt: _omit, ...rest } = cleanInput
    const signals = assessContactSpam(rest, { now: NOW })
    expect(codes(signals)).toContain("trap-missing")
    expect(spamVerdict(signals)).toBe("suspicious")
  })

  it("flags a null or empty renderedAt", () => {
    expect(codes(assessContactSpam({ ...cleanInput, renderedAt: null }, { now: NOW }))).toContain(
      "trap-missing",
    )
    expect(codes(assessContactSpam({ ...cleanInput, renderedAt: "" }, { now: NOW }))).toContain(
      "trap-missing",
    )
  })

  it("flags an unparseable renderedAt", () => {
    const signals = assessContactSpam({ ...cleanInput, renderedAt: "not-a-date" }, { now: NOW })
    expect(codes(signals)).toContain("trap-invalid")
  })

  it("flags submissions faster than minFillSeconds", () => {
    const signals = assessContactSpam({ ...cleanInput, renderedAt: renderedAt(1) }, { now: NOW })
    expect(codes(signals)).toContain("trap-too-fast")
    expect(spamVerdict(signals)).toBe("suspicious")
  })

  it("does not flag a submission just above the threshold", () => {
    const signals = assessContactSpam(
      { ...cleanInput, renderedAt: renderedAt(CONTACT_SPAM_LIMITS.minFillSeconds + 1) },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("trap-too-fast")
  })

  it("flags timestamps older than maxFormAgeSeconds", () => {
    const signals = assessContactSpam(
      { ...cleanInput, renderedAt: renderedAt(CONTACT_SPAM_LIMITS.maxFormAgeSeconds + 60) },
      { now: NOW },
    )
    expect(codes(signals)).toContain("trap-stale")
  })

  it("flags timestamps too far in the future", () => {
    const signals = assessContactSpam(
      { ...cleanInput, renderedAt: renderedAt(-CONTACT_SPAM_LIMITS.maxClockSkewSeconds - 10) },
      { now: NOW },
    )
    expect(codes(signals)).toContain("trap-future")
  })

  it("tolerates small clock skew into the future", () => {
    const signals = assessContactSpam({ ...cleanInput, renderedAt: renderedAt(-30) }, { now: NOW })
    expect(codes(signals)).not.toContain("trap-future")
    expect(codes(signals)).not.toContain("trap-too-fast")
  })

  it("honours a custom minFillSeconds limit", () => {
    const signals = assessContactSpam(
      { ...cleanInput, renderedAt: renderedAt(10) },
      { now: NOW, limits: { minFillSeconds: 30 } },
    )
    expect(codes(signals)).toContain("trap-too-fast")
  })
})

describe("assessContactSpam — link signals", () => {
  it("flags more than maxLinks links as suspicious", () => {
    const message = "Check https://a.example https://b.example https://c.example for info."
    const signals = assessContactSpam({ ...cleanInput, message }, { now: NOW })
    expect(codes(signals)).toContain("links")
    expect(severities(signals)).toContain("suspicious")
  })

  it("drops link-dominated text", () => {
    const link = "https://spam.example/" + "x".repeat(80)
    const message = `${link} ${link} ${link}`
    const signals = assessContactSpam({ ...cleanInput, subject: "Hi", message }, { now: NOW })
    expect(codes(signals)).toContain("link-spam")
    expect(severities(signals)).toContain("drop")
    expect(spamVerdict(signals)).toBe("drop")
  })

  it("does not flag www. links within the limit", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        message:
          "I was wondering how the export works — please see www.example.com and https://other.example/path when you have a moment, thanks!",
      },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("links")
    expect(codes(signals)).not.toContain("link-spam")
  })

  it("strips trailing prose punctuation before measuring link density", () => {
    // Two links at the count limit, each followed by a long tail of sentence
    // punctuation. Unstripped, the punctuation would dominate the density;
    // stripped, the real links are a modest share of the text.
    const signals = assessContactSpam(
      {
        ...cleanInput,
        message: `see https://a.example${".!?".repeat(10)} and https://b.example${",;:".repeat(10)} done`,
      },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("links")
    expect(codes(signals)).not.toContain("link-spam")
  })

  it("counts links hidden in the name field", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        name: "https://a.example https://b.example https://c.example",
        message: "A perfectly ordinary question about exports.",
      },
      { now: NOW },
    )
    expect(codes(signals)).toContain("links")
  })
})

describe("assessContactSpam — repeated characters", () => {
  it("flags a long run of one character as suspicious", () => {
    const signals = assessContactSpam(
      { ...cleanInput, message: `Please help me ${"a".repeat(10)} thanks` },
      { now: NOW },
    )
    expect(codes(signals)).toContain("repeated-chars")
    expect(severities(signals)).toContain("suspicious")
  })

  it("drops an extreme run of one character", () => {
    const signals = assessContactSpam(
      { ...cleanInput, message: `Wow ${"z".repeat(20)} cool` },
      { now: NOW },
    )
    expect(codes(signals)).toContain("repeated-chars")
    expect(severities(signals)).toContain("drop")
    expect(spamVerdict(signals)).toBe("drop")
  })

  it("does not flag normal repeated letters or alternating patterns", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        message: "I really really really need help with booking, book book book.",
      },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("repeated-chars")
  })

  it("ignores whitespace runs — pasted logs and code stay clean", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        message: `Here is the log output:\n${" ".repeat(30)}indent level one\n${"\t".repeat(20)}done`,
      },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("repeated-chars")
    expect(spamVerdict(signals)).toBe("pass")
  })
})

describe("assessContactSpam — non-Latin content", () => {
  it("flags mostly non-Latin text", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        subject: "",
        message:
          "\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435, \u043a\u0430\u043a \u0434\u0435\u043b\u0430?",
      },
      { now: NOW },
    )
    expect(codes(signals)).toContain("non-latin")
    expect(spamVerdict(signals)).toBe("suspicious")
  })

  it("does not flag a mostly Latin message with a few accented characters", () => {
    const signals = assessContactSpam(
      {
        ...cleanInput,
        message:
          "Café naïve résumé — how do I export my session? The façade of the data should be fine, jalapeño aside.",
      },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("non-latin")
  })
})

describe("assessContactSpam — disposable email", () => {
  it("flags a known disposable domain", () => {
    const signals = assessContactSpam(
      { ...cleanInput, email: "throwaway123@mailinator.com" },
      { now: NOW },
    )
    expect(codes(signals)).toContain("disposable-email")
    expect(spamVerdict(signals)).toBe("suspicious")
  })

  it("matches disposable domains case-insensitively and on subdomains", () => {
    for (const email of ["a@YOPMAIL.COM", "b@sub.guerrillamail.com"]) {
      const signals = assessContactSpam({ ...cleanInput, email }, { now: NOW })
      expect(codes(signals)).toContain("disposable-email")
    }
  })

  it("does not flag normal domains that merely contain a listed name", () => {
    const signals = assessContactSpam(
      { ...cleanInput, email: "ada@mailinator.com.evil.example" },
      { now: NOW },
    )
    expect(codes(signals)).not.toContain("disposable-email")
  })

  it("honours a custom disposableDomains list", () => {
    const signals = assessContactSpam(
      { ...cleanInput, email: "ada@corp.example" },
      { now: NOW, disposableDomains: ["corp.example"] },
    )
    expect(codes(signals)).toContain("disposable-email")
  })

  it("has a non-empty default domain list", () => {
    expect(DISPOSABLE_EMAIL_DOMAINS.length).toBeGreaterThan(0)
  })
})

describe("spamVerdict", () => {
  const sig = (severity: SpamSignal["severity"]): SpamSignal => ({
    code: "x",
    severity,
  })

  it("passes with no signals", () => {
    expect(spamVerdict([])).toBe("pass")
  })

  it("is suspicious with only suspicious signals", () => {
    expect(spamVerdict([sig("suspicious"), sig("suspicious")])).toBe("suspicious")
  })

  it("drops when any signal is drop severity", () => {
    expect(spamVerdict([sig("suspicious"), sig("drop")])).toBe("drop")
  })
})
