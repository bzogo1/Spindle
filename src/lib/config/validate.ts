import type { EnvIssue, EnvSource } from "../env"

/**
 * Semantic, cross-field environment validation.
 *
 * `src/lib/env-schema.ts` validates each variable in isolation (type, format,
 * length). This module checks the rules a per-field schema cannot express:
 * conditional requirements ("if B2_KEY_ID is set, B2_BUCKET is required"),
 * per-environment expectations (no localhost databases in production),
 * feature-flag interactions (mock auth must never reach production), and
 * secret-strength heuristics for non-production environments.
 *
 * Nothing here reads `process.env` directly and nothing here is imported by
 * client code; `validateRuntimeConfig` takes an `EnvSource` so it can run in
 * build tooling, the container entrypoint, or tests. Issue messages never
 * include variable values.
 */

export type ConfigIssueSeverity = "error" | "warning"

export type ConfigIssue = EnvIssue & {
  /** Stable rule id, e.g. `database.local-host-in-production`. */
  rule: string
  severity: ConfigIssueSeverity
}

export type RuntimeConfigReport = {
  issues: ConfigIssue[]
  /** Issues that should fail validation. */
  errors: ConfigIssue[]
  /** Issues worth surfacing but not blocking on. */
  warnings: ConfigIssue[]
  /** True when no error-severity issues were found. */
  valid: boolean
}

/** Blank strings count as unset, matching `emptyToUndefined` in env-schema.ts. */
function unset(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() === "" ? undefined : value
}

function isSet(source: EnvSource, key: string): boolean {
  return unset(source[key]) !== undefined
}

function value(source: EnvSource, key: string): string | undefined {
  return unset(source[key])?.trim()
}

function isAbsoluteUrl(raw: string): boolean {
  try {
    new URL(raw)
    return true
  } catch {
    return false
  }
}

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

/** Hostnames that only make sense for a local/dev database. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

function isLocalHost(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost")
}

/** Same placeholder list as `src/lib/secrets/validate.ts`, kept local to avoid a dependency cycle. */
const PLACEHOLDER = /^(change[-_ ]?me|replace[-_ ]?me|example|todo|secret|password|test|xxx+)$/i

const SYMMETRIC_SECRET_KEYS = [
  "SESSION_SECRET",
  "SESSION_SECRET_PREVIOUS",
  "EDGE_HMAC_SECRET",
  "EDGE_HMAC_SECRET_PREVIOUS",
  "WORKER_SECRET",
  "WORKER_SECRET_PREVIOUS",
] as const

const CREDENTIAL_SECRET_KEYS = [
  "B2_APPLICATION_KEY",
  "RESEND_API_KEY",
  "LLM_API_KEY",
  "SENTRY_AUTH_TOKEN",
] as const

/** Minimum recommended lengths; the schema already enforces the hard floor of 32 for symmetric keys. */
const SYMMETRIC_KEY_RECOMMENDED = 48
const CREDENTIAL_MIN_LENGTH = 20
const MIN_DISTINCT_CHARACTERS = 8

function distinctCharacters(raw: string): number {
  return new Set(raw).size
}

/**
 * Rotation pairs: the `*_PREVIOUS` variable only makes sense while the
 * current variable is also set, and rotating to the same value is a no-op.
 */
const ROTATION_PAIRS: ReadonlyArray<readonly [current: string, previous: string]> = [
  ["SESSION_SECRET", "SESSION_SECRET_PREVIOUS"],
  ["EDGE_HMAC_SECRET", "EDGE_HMAC_SECRET_PREVIOUS"],
  ["WORKER_SECRET", "WORKER_SECRET_PREVIOUS"],
  ["B2_KEY_ID", "B2_KEY_ID_PREVIOUS"],
  ["B2_APPLICATION_KEY", "B2_APPLICATION_KEY_PREVIOUS"],
]

const B2_GROUP_KEYS = ["B2_KEY_ID", "B2_APPLICATION_KEY", "B2_BUCKET", "B2_ENDPOINT"] as const
const B2_PREVIOUS_KEYS = ["B2_KEY_ID_PREVIOUS", "B2_APPLICATION_KEY_PREVIOUS"] as const

function checkDatabaseUrls(source: EnvSource, production: boolean, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = value(source, key)
    if (raw === undefined) {
      if (production) {
        push(
          key,
          "database.required-in-production",
          "error",
          "Required in production; there is no local fallback outside development.",
        )
      }
      continue
    }

    const url = parseUrl(raw)
    if (!url || !/^postgres(?:ql)?:$/.test(url.protocol)) {
      // The zod schema already reports malformed values; only add the
      // cross-field host check when the URL at least parses.
      continue
    }

    if (production && isLocalHost(url)) {
      push(
        key,
        "database.local-host-in-production",
        "error",
        "Points at a local database host; production must use the managed Postgres instance.",
      )
    }
  }
}

function checkPublicUrls(source: EnvSource, production: boolean, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  const siteUrl = value(source, "NEXT_PUBLIC_SITE_URL")
  if (siteUrl === undefined) {
    if (production) {
      push(
        "NEXT_PUBLIC_SITE_URL",
        "public-url.site-url-required-in-production",
        "error",
        "Required in production for canonical links and sharing metadata.",
      )
    }
  } else {
    const url = parseUrl(siteUrl)
    if (production && url && url.protocol !== "https:") {
      push(
        "NEXT_PUBLIC_SITE_URL",
        "public-url.site-url-not-https",
        "error",
        "Must use https:// in production so canonical links and shared URLs are secure.",
      )
    }
  }

  const apiUrl = value(source, "NEXT_PUBLIC_API_URL")
  if (production && apiUrl !== undefined) {
    const url = parseUrl(apiUrl)
    if (url && url.protocol !== "https:") {
      push(
        "NEXT_PUBLIC_API_URL",
        "public-url.api-url-not-https",
        "error",
        "Must use https:// in production; browsers block mixed-content calls to http:// APIs.",
      )
    }
  }
}

function checkFeatureFlags(source: EnvSource, production: boolean, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  if (production) {
    // NEXT_PUBLIC_API_MODE defaults to "mock" when unset, so an absent value
    // still serves fixture data.
    const apiMode = value(source, "NEXT_PUBLIC_API_MODE") ?? "mock"
    if (apiMode === "mock") {
      push(
        "NEXT_PUBLIC_API_MODE",
        "feature-flag.mock-api-mode-in-production",
        "warning",
        'Set NEXT_PUBLIC_API_MODE=http in production; "mock" serves fixture data, not the real API.',
      )
    }

    if (source.NEXT_PUBLIC_MOCK_AUTH?.trim() === "1") {
      push(
        "NEXT_PUBLIC_MOCK_AUTH",
        "feature-flag.mock-auth-in-production",
        "error",
        "The mock-authenticated app shell must never be enabled in production; it bypasses real sign-in.",
      )
    }
  } else if (value(source, "CSP_ENFORCE") === "1") {
    push(
      "CSP_ENFORCE",
      "feature-flag.csp-enforce-outside-production",
      "warning",
      "CSP_ENFORCE is only honored when NODE_ENV=production; this value is ignored.",
    )
  }
}

function checkServiceGroups(source: EnvSource, production: boolean, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  // Backblaze B2 is all-or-nothing: a partial credential set cannot upload.
  const b2Present = B2_GROUP_KEYS.filter((key) => isSet(source, key))
  if (b2Present.length > 0) {
    for (const key of B2_GROUP_KEYS) {
      if (!isSet(source, key)) {
        push(
          key,
          "service.b2-incomplete",
          "error",
          "Backblaze B2 requires B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET and B2_ENDPOINT together.",
        )
      }
    }
  }

  // Exactly one of the previous-pair variables set means a rotation was
  // started but never finished.
  const previousCount = B2_PREVIOUS_KEYS.filter((key) => isSet(source, key)).length
  if (previousCount === 1) {
    const missing = B2_PREVIOUS_KEYS.find((key) => !isSet(source, key))
    push(
      missing ?? "B2_KEY_ID_PREVIOUS",
      "service.b2-rotation-pair-incomplete",
      "warning",
      "Set both B2_KEY_ID_PREVIOUS and B2_APPLICATION_KEY_PREVIOUS while rotating, or clear both.",
    )
  }

  // LLM provider: the API key alone is useless without a base URL and model.
  if (isSet(source, "LLM_API_KEY")) {
    for (const key of ["LLM_BASE_URL", "LLM_MODEL"] as const) {
      if (!isSet(source, key)) {
        push(
          key,
          "service.llm-incomplete",
          "error",
          "LLM_API_KEY is set; LLM_BASE_URL and LLM_MODEL are required to call the provider.",
        )
      }
    }
  } else if (isSet(source, "LLM_BASE_URL") || isSet(source, "LLM_MODEL")) {
    push(
      "LLM_API_KEY",
      "service.llm-without-key",
      "warning",
      "LLM_BASE_URL/LLM_MODEL are set but LLM_API_KEY is missing; the provider cannot be called.",
    )
  }

  const endpoint = value(source, "B2_ENDPOINT")
  if (production && endpoint !== undefined) {
    const url = parseUrl(endpoint)
    if (url && url.protocol !== "https:") {
      push(
        "B2_ENDPOINT",
        "service.b2-endpoint-not-https",
        "error",
        "Must use https:// in production; object storage credentials must not traverse plaintext.",
      )
    }
  }

  const llmBaseUrl = value(source, "LLM_BASE_URL")
  if (production && llmBaseUrl !== undefined) {
    const url = parseUrl(llmBaseUrl)
    if (url && url.protocol !== "https:") {
      push(
        "LLM_BASE_URL",
        "service.llm-base-url-not-https",
        "error",
        "Must use https:// in production so API keys are not sent over plaintext.",
      )
    }
  }
}

function checkRotationPairs(source: EnvSource, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  for (const [current, previous] of ROTATION_PAIRS) {
    const currentValue = value(source, current)
    const previousValue = value(source, previous)

    if (previousValue !== undefined && currentValue === undefined) {
      push(
        previous,
        "rotation.previous-without-current",
        "error",
        `Set ${current} before ${previous}; a previous key with no current key verifies nothing.`,
      )
    } else if (
      currentValue !== undefined &&
      previousValue !== undefined &&
      currentValue === previousValue
    ) {
      push(
        previous,
        "rotation.previous-equals-current",
        "warning",
        `Must differ from ${current}; otherwise the rotation does not change the key.`,
      )
    }
  }
}

function checkOAuthProviders(source: EnvSource, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  const raw = value(source, "OAUTH_PROVIDERS_JSON")
  if (raw === undefined) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    push(
      "OAUTH_PROVIDERS_JSON",
      "oauth.invalid-json",
      "error",
      "Must be a JSON object; at runtime a malformed value silently disables every OAuth provider.",
    )
    return
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    push(
      "OAUTH_PROVIDERS_JSON",
      "oauth.not-an-object",
      "error",
      "Must be a JSON object mapping provider names to their configuration.",
    )
    return
  }

  for (const [name, config] of Object.entries(parsed as Record<string, unknown>)) {
    const fail = (message: string) =>
      push(
        "OAUTH_PROVIDERS_JSON",
        "oauth.provider-invalid",
        "error",
        `Provider "${name}" ${message}; it will be ignored at runtime.`,
      )

    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      fail("must be an object")
      continue
    }

    const provider = config as Record<string, unknown>

    if (typeof provider.clientId !== "string" || provider.clientId.trim() === "") {
      fail("is missing a non-empty clientId")
    }
    for (const urlKey of ["authorizeUrl", "tokenUrl"] as const) {
      const url = provider[urlKey]
      if (typeof url !== "string" || !isAbsoluteUrl(url)) {
        fail(`has a missing or invalid ${urlKey}`)
      }
    }
    if (provider.userinfoUrl !== undefined) {
      const url = provider.userinfoUrl
      if (typeof url !== "string" || !isAbsoluteUrl(url)) {
        fail("has an invalid userinfoUrl")
      }
    }
    if (
      provider.scopes !== undefined &&
      (!Array.isArray(provider.scopes) ||
        provider.scopes.some((scope) => typeof scope !== "string" || scope.trim() === ""))
    ) {
      fail("has a scopes value that is not an array of non-empty strings")
    }
  }
}

function checkSecretStrength(source: EnvSource, production: boolean, issues: ConfigIssue[]) {
  // Strength heuristics are a non-production aid: in production the secret
  // store contract (scripts/secrets/check.ts) owns presence and placeholders,
  // and operators rotate on a schedule rather than tuning entropy here.
  if (production) return

  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  for (const key of [...SYMMETRIC_SECRET_KEYS, ...CREDENTIAL_SECRET_KEYS]) {
    const raw = value(source, key)
    if (raw === undefined) continue

    if (PLACEHOLDER.test(raw)) {
      push(
        key,
        "secret.placeholder-value",
        "warning",
        "Looks like a placeholder, not a real secret.",
      )
      continue
    }

    const isSymmetric = (SYMMETRIC_SECRET_KEYS as readonly string[]).includes(key)
    const minLength = isSymmetric ? SYMMETRIC_KEY_RECOMMENDED : CREDENTIAL_MIN_LENGTH
    if (raw.length < minLength) {
      push(
        key,
        "secret.below-recommended-length",
        "warning",
        isSymmetric
          ? `Symmetric keys shorter than ${SYMMETRIC_KEY_RECOMMENDED} characters are weaker than recommended.`
          : `Credentials shorter than ${CREDENTIAL_MIN_LENGTH} characters are weaker than recommended.`,
      )
    }

    if (distinctCharacters(raw) < MIN_DISTINCT_CHARACTERS) {
      push(
        key,
        "secret.low-entropy",
        "warning",
        "Very few distinct characters; generate the value with a cryptographic random source.",
      )
    }
  }
}

function checkSentryConsistency(source: EnvSource, issues: ConfigIssue[]) {
  const push = (key: string, rule: string, severity: ConfigIssueSeverity, message: string) =>
    issues.push({ key, rule, severity, message })

  // The browser sample rate only applies when the browser also has a DSN.
  if (
    isSet(source, "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE") &&
    !isSet(source, "NEXT_PUBLIC_SENTRY_DSN")
  ) {
    push(
      "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
      "sentry.sample-rate-without-dsn",
      "warning",
      "NEXT_PUBLIC_SENTRY_DSN is not set, so browser tracing is disabled and this rate has no effect.",
    )
  }
}

/**
 * Validates cross-field and per-environment rules that the zod schemas in
 * `env-schema.ts` cannot express. Returns every issue found; `valid` is true
 * when no error-severity issues remain.
 *
 * This function never throws and never includes variable values in messages,
 * so it is safe to call from build tooling and the container entrypoint.
 */
export function validateRuntimeConfig(source: EnvSource): RuntimeConfigReport {
  const issues: ConfigIssue[] = []
  const production = source.NODE_ENV === "production"

  checkDatabaseUrls(source, production, issues)
  checkPublicUrls(source, production, issues)
  checkFeatureFlags(source, production, issues)
  checkServiceGroups(source, production, issues)
  checkRotationPairs(source, issues)
  checkOAuthProviders(source, issues)
  checkSecretStrength(source, production, issues)
  checkSentryConsistency(source, issues)

  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")

  return { issues, errors, warnings, valid: errors.length === 0 }
}

/**
 * Error-severity issues projected onto the `EnvIssue` shape used by
 * `EnvValidationError`, so `env.server.ts` (or another caller) can merge them
 * into the existing schema-issue list without adapting types.
 */
export function collectRuntimeConfigIssues(source: EnvSource): EnvIssue[] {
  return validateRuntimeConfig(source).errors.map(({ key, message }) => ({ key, message }))
}
