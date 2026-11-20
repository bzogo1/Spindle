/**
 * Client-safe environment configuration.
 *
 * This module defines the `NEXT_PUBLIC_*` group with a hand-rolled validator
 * instead of zod: it is imported by `instrumentation-client.ts` and other
 * browser entrypoints, so every dependency here lands in the initial client
 * bundle on every route. The zod schemas used for server/build validation
 * live in `src/lib/env.server.ts` (via `src/lib/env-schema.ts`), which is
 * never reachable from the browser.
 *
 * This module and `env.server.ts` are the only places allowed to read
 * `process.env`. Everything else imports the typed accessors, so a missing or
 * malformed value fails at build/boot with one message that names every
 * offending variable.
 */

export type EnvSource = Record<string, string | undefined>

export type EnvIssue = {
  key: string
  message: string
}

export type ClientEnv = {
  NODE_ENV: "development" | "test" | "production"
  NEXT_PUBLIC_SITE_URL?: string
  NEXT_PUBLIC_SENTRY_DSN?: string
  NEXT_PUBLIC_SENTRY_RELEASE?: string
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE?: number
  NEXT_PUBLIC_API_MODE: "mock" | "http"
  NEXT_PUBLIC_API_URL?: string
  NEXT_PUBLIC_MOCK_AUTH?: "1"
}

/**
 * Release reported to Sentry when no deploy commit SHA or explicit override is
 * configured. Shared by the browser and server/edge configs so all three
 * runtimes report the same fallback.
 */
export const DEFAULT_SENTRY_RELEASE = "spindle@1.0.0"

export const clientExpectations: Record<string, string> = {
  NODE_ENV: "Expected one of: development, test, production.",
  NEXT_PUBLIC_SITE_URL: "Expected an absolute URL, for example https://spindle.app.",
  NEXT_PUBLIC_SENTRY_DSN: "Expected an absolute Sentry DSN URL.",
  NEXT_PUBLIC_SENTRY_RELEASE: "Expected a non-empty release identifier.",
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "Expected a number between 0 and 1.",
  NEXT_PUBLIC_API_MODE: "Expected one of: mock, http.",
  NEXT_PUBLIC_API_URL: "Expected an absolute API base URL.",
  NEXT_PUBLIC_MOCK_AUTH: 'Expected "1" to enable the mock-authenticated app shell.',
}

export class EnvValidationError extends Error {
  readonly issues: EnvIssue[]

  constructor(scope: string, issues: EnvIssue[]) {
    super(formatEnvError(scope, issues))
    this.name = "EnvValidationError"
    this.issues = issues
  }
}

/** Renders every issue at once. Values are never included in the output. */
export function formatEnvError(scope: string, issues: EnvIssue[]) {
  const width = Math.max(...issues.map((issue) => issue.key.length))
  const lines = issues.map((issue) => `  ${issue.key.padEnd(width)}  ${issue.message}`)

  return [
    `Invalid ${scope} environment configuration:`,
    "",
    ...lines,
    "",
    "Set these values in .env.local for local development, or in the deployment environment for production.",
    "See .env.example and the README for the full checklist.",
  ].join("\n")
}

const NODE_ENVS = ["development", "test", "production"] as const
const API_MODES = ["mock", "http"] as const

/** Blank strings count as unset, matching the zod `emptyToUndefined` preprocess. */
function unset(value: string | undefined) {
  return typeof value === "string" && value.trim() === "" ? undefined : value
}

function isAbsoluteUrl(value: string) {
  try {
    // Same acceptance as zod's z.url(): anything the WHATWG parser accepts.
    new URL(value)
    return true
  } catch {
    return false
  }
}

const INVALID_URL = "__invalid_url__"

function optionalUrlValue(raw: string | undefined): string | undefined {
  const value = unset(raw)
  if (value === undefined) return undefined
  return isAbsoluteUrl(value) ? value : INVALID_URL
}

/**
 * Client values are read through explicit `process.env.NEXT_PUBLIC_*` members
 * so Next.js can inline them into the browser bundle.
 */
const rawClientEnv: EnvSource = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  NEXT_PUBLIC_API_MODE: process.env.NEXT_PUBLIC_API_MODE,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_MOCK_AUTH: process.env.NEXT_PUBLIC_MOCK_AUTH,
}

/**
 * Validates the browser-safe group without pulling zod into the client
 * bundle. Issue order matches the previous zod object shape so error output
 * is unchanged.
 */
export function parseClientEnv(source: EnvSource): ClientEnv {
  const issues: EnvIssue[] = []

  const nodeEnvRaw = source.NODE_ENV
  let nodeEnv: ClientEnv["NODE_ENV"] = "development"
  if (nodeEnvRaw !== undefined) {
    if ((NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
      nodeEnv = nodeEnvRaw as ClientEnv["NODE_ENV"]
    } else {
      issues.push({ key: "NODE_ENV", message: clientExpectations.NODE_ENV })
    }
  }

  const siteUrl = optionalUrlValue(source.NEXT_PUBLIC_SITE_URL)
  if (siteUrl === INVALID_URL) {
    issues.push({ key: "NEXT_PUBLIC_SITE_URL", message: clientExpectations.NEXT_PUBLIC_SITE_URL })
  }

  const sentryDsn = optionalUrlValue(source.NEXT_PUBLIC_SENTRY_DSN)
  if (sentryDsn === INVALID_URL) {
    issues.push({
      key: "NEXT_PUBLIC_SENTRY_DSN",
      message: clientExpectations.NEXT_PUBLIC_SENTRY_DSN,
    })
  }

  // NEXT_PUBLIC_SENTRY_RELEASE is free-form text; blanks count as unset and
  // any non-empty value is valid, matching optionalText in env-schema.ts.
  const sentryReleaseRaw = unset(source.NEXT_PUBLIC_SENTRY_RELEASE)
  const sentryRelease = sentryReleaseRaw === undefined ? undefined : sentryReleaseRaw.trim()

  // Fraction of browser traces sent to Sentry; blanks count as unset and the
  // instrumentation falls back to its own default. Anything outside [0, 1]
  // or non-numeric is rejected rather than silently clamped.
  const tracesSampleRateRaw = unset(source.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
  let tracesSampleRate: number | undefined
  if (tracesSampleRateRaw !== undefined) {
    const parsed = Number(tracesSampleRateRaw)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      tracesSampleRate = parsed
    } else {
      issues.push({
        key: "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
        message: clientExpectations.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      })
    }
  }

  const apiModeRaw = unset(source.NEXT_PUBLIC_API_MODE)
  let apiMode: ClientEnv["NEXT_PUBLIC_API_MODE"] = "mock"
  if (apiModeRaw !== undefined) {
    if ((API_MODES as readonly string[]).includes(apiModeRaw)) {
      apiMode = apiModeRaw as ClientEnv["NEXT_PUBLIC_API_MODE"]
    } else {
      issues.push({ key: "NEXT_PUBLIC_API_MODE", message: clientExpectations.NEXT_PUBLIC_API_MODE })
    }
  }

  const apiUrl = optionalUrlValue(source.NEXT_PUBLIC_API_URL)
  if (apiUrl === INVALID_URL) {
    issues.push({ key: "NEXT_PUBLIC_API_URL", message: clientExpectations.NEXT_PUBLIC_API_URL })
  }

  // NEXT_PUBLIC_MOCK_AUTH is a literal "1" flag; blanks count as unset via
  // the same emptyToUndefined preprocess the zod schema used.
  const mockAuth = unset(source.NEXT_PUBLIC_MOCK_AUTH)
  const mockAuthValue = mockAuth === "1" ? ("1" as const) : undefined
  if (mockAuth !== undefined && mockAuth !== "1") {
    issues.push({ key: "NEXT_PUBLIC_MOCK_AUTH", message: clientExpectations.NEXT_PUBLIC_MOCK_AUTH })
  }

  if (issues.length > 0) throw new EnvValidationError("client", issues)

  return {
    NODE_ENV: nodeEnv,
    NEXT_PUBLIC_SITE_URL: siteUrl === INVALID_URL ? undefined : siteUrl,
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn === INVALID_URL ? undefined : sentryDsn,
    NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease,
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: tracesSampleRate,
    NEXT_PUBLIC_API_MODE: apiMode,
    NEXT_PUBLIC_API_URL: apiUrl === INVALID_URL ? undefined : apiUrl,
    NEXT_PUBLIC_MOCK_AUTH: mockAuthValue,
  }
}

/** Browser-safe configuration. */
export const clientEnv = parseClientEnv(rawClientEnv)
