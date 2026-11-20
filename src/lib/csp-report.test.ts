import { describe, expect, it } from "vitest"

import { parseCspReports, summarizeCspViolations } from "./csp-report"

describe("parseCspReports", () => {
  it("parses a legacy report-uri payload", () => {
    const violations = parseCspReports({
      "csp-report": {
        "document-uri": "https://app.example.com/dashboard",
        referrer: "",
        "violated-directive": "script-src",
        "effective-directive": "script-src",
        "original-policy": "script-src 'self'",
        disposition: "report",
        "blocked-uri": "https://evil.example.com/x.js",
        "status-code": 200,
        "script-sample": "",
      },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      directive: "script-src",
      blockedUri: "https://evil.example.com/x.js",
      documentUri: "https://app.example.com/dashboard",
      disposition: "report",
      statusCode: 200,
      format: "report-uri",
    })
  })

  it("parses a Reporting API array of csp-violation reports", () => {
    const violations = parseCspReports([
      {
        type: "csp-violation",
        age: 12,
        url: "https://app.example.com/docs",
        user_agent: "Mozilla/5.0",
        body: {
          documentURL: "https://app.example.com/docs",
          referrer: "https://app.example.com/",
          blockedURL: "inline",
          effectiveDirective: "script-src-elem",
          violatedDirective: "script-src-elem",
          disposition: "enforce",
          sourceFile: "https://app.example.com/docs",
          lineNumber: 42,
          columnNumber: 7,
          sample: "alert(1)",
          statusCode: 200,
        },
      },
      {
        type: "deprecation",
        body: { id: "x" },
      },
    ])

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      directive: "script-src-elem",
      blockedUri: "inline",
      documentUri: "https://app.example.com/docs",
      sourceFile: "https://app.example.com/docs",
      lineNumber: 42,
      sample: "alert(1)",
      disposition: "enforce",
      format: "report-to",
    })
  })

  it("parses bare legacy and bare Reporting API bodies", () => {
    const legacy = parseCspReports({
      "violated-directive": "img-src",
      "blocked-uri": "https://tracker.example.com/p.gif",
      "document-uri": "https://app.example.com/",
    })
    const modern = parseCspReports({
      violatedDirective: "connect-src",
      blockedURL: "https://api.analytics.example.com",
      documentURL: "https://app.example.com/",
    })

    expect(legacy[0]).toMatchObject({ directive: "img-src", format: "report-uri" })
    expect(modern[0]).toMatchObject({ directive: "connect-src", format: "report-to" })
  })

  it("handles arrays of legacy envelopes and ignores junk", () => {
    const violations = parseCspReports([
      {
        "csp-report": {
          "violated-directive": "style-src",
          "blocked-uri": "https://fonts.example.com",
        },
      },
      null,
      42,
      "nope",
      { unrelated: true },
    ])

    expect(violations).toHaveLength(1)
    expect(violations[0].directive).toBe("style-src")
  })

  it("returns empty for unrecognised payloads", () => {
    expect(parseCspReports(null)).toEqual([])
    expect(parseCspReports({ hello: "world" })).toEqual([])
    expect(parseCspReports("string")).toEqual([])
  })

  it("truncates oversized strings", () => {
    const [v] = parseCspReports({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": `https://x.example.com/${"a".repeat(5000)}`,
        "document-uri": "https://app.example.com/",
      },
    })
    expect(v.blockedUri.length).toBeLessThanOrEqual(2048)
  })
})

describe("summarizeCspViolations", () => {
  it("groups by directive+blockedUri, counts, and sorts by frequency", () => {
    const make = (blocked: string, directive = "script-src", doc = "https://app.example.com/") => ({
      directive,
      blockedUri: blocked,
      documentUri: doc,
      disposition: "report",
      format: "report-uri" as const,
    })

    const summary = summarizeCspViolations([
      make("https://evil.example.com/a.js"),
      make("https://evil.example.com/a.js"),
      make("https://evil.example.com/a.js", "script-src", "https://app.example.com/x"),
      make("https://tracker.example.com/p.gif", "img-src"),
    ])

    expect(summary.total).toBe(4)
    expect(summary.byDirective).toEqual({ "script-src": 3, "img-src": 1 })
    expect(summary.groups[0]).toMatchObject({
      directive: "script-src",
      blockedUri: "https://evil.example.com/a.js",
      count: 3,
    })
    expect(summary.groups[0].documentUris).toEqual([
      "https://app.example.com/",
      "https://app.example.com/x",
    ])
    expect(summary.groups[1].count).toBe(1)
  })

  it("returns an empty summary for no violations", () => {
    expect(summarizeCspViolations([])).toEqual({
      total: 0,
      byDirective: {},
      groups: [],
    })
  })
})
