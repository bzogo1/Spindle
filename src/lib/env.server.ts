import { z } from "zod"

import {
  clientExpectations,
  EnvValidationError,
  type ClientEnv,
  type EnvIssue,
  type EnvSource,
} from "./env"
import {
  clientSchema,
  collectEnvIssues,
  emptyToUndefined,
  nodeEnv,
  optionalPostgresUrl,
  optionalSymmetricKey,
  optionalText,
  optionalUrl,
} from "./env-schema"

export { EnvValidationError } from "./env"

/**
 * Server-only environment configuration.
 *
 * Import this from server code and build tooling only; client components must
 * use `clientEnv` from `@/lib/env`.
 */

/** Server-only values. Never import this shape into a client component. */
const serverSchema = z.object({
  NODE_ENV: nodeEnv,
  NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
  DATABASE_URL: optionalPostgresUrl,
  DIRECT_URL: optionalPostgresUrl,
  SENTRY_DSN: optionalUrl,
  SENTRY_RELEASE: optionalText,
  // Commit SHAs injected by the deploy platform (Vercel) or CI (GitHub
  // Actions). Read at runtime so server/edge events can be tied to the exact
  // build when no explicit SENTRY_RELEASE override is set.
  VERCEL_GIT_COMMIT_SHA: optionalText,
  GITHUB_SHA: optionalText,

  // Secret-store values. They are optional in the base schema so development
  // and CI can run without production credentials; `npm run secrets:check`
  // enforces the full production contract before the container starts.
  B2_KEY_ID: optionalText,
  B2_APPLICATION_KEY: optionalText,
  B2_KEY_ID_PREVIOUS: optionalText,
  B2_APPLICATION_KEY_PREVIOUS: optionalText,
  B2_BUCKET: optionalText,
  B2_ENDPOINT: optionalUrl,
  RESEND_API_KEY: optionalText,
  CONTACT_TO_EMAIL: optionalText,
  CONTACT_FROM_EMAIL: optionalText,
  LLM_API_KEY: optionalText,
  LLM_BASE_URL: optionalUrl,
  LLM_MODEL: optionalText,
  SESSION_SECRET: optionalSymmetricKey,
  SESSION_SECRET_PREVIOUS: optionalSymmetricKey,
  EDGE_HMAC_SECRET: optionalSymmetricKey,
  EDGE_HMAC_SECRET_PREVIOUS: optionalSymmetricKey,
  WORKER_SECRET: optionalSymmetricKey,
  WORKER_SECRET_PREVIOUS: optionalSymmetricKey,
  // JSON map of OAuth providers for the PKCE sign-in flow, e.g.
  // {"github":{"clientId":"…","clientSecret":"…","authorizeUrl":"…","tokenUrl":"…","userinfoUrl":"…","scopes":["read:user","user:email"]}}.
  // Optional; /api/auth/oauth/* returns 404 for unconfigured providers.
  OAUTH_PROVIDERS_JSON: optionalText,

  // Opt-in CSP enforcement switch (issue 051). Set to "1" to enforce the
  // full Content-Security-Policy from src/lib/security-headers.ts instead of
  // the safe subset; only honored when NODE_ENV=production because the full
  // policy breaks Turbopack RSC eval under `next dev`. Read when
  // next.config.ts evaluates headers() at build/`next start`, so it must be
  // present in both environments.
  CSP_ENFORCE: z.preprocess(emptyToUndefined, z.literal("1").optional()),
})

/** Build-time values read by `next.config.ts`; never shipped to a runtime. */
const buildSchema = z.object({
  CI: optionalText,
  SENTRY_AUTH_TOKEN: optionalText,
  // `npm run analyze` sets ANALYZE=true; the bundle analyzer only enables on
  // the exact "true" value, matching the previous direct process.env read.
  // Untrimmed so whitespace-padded values stay disabled, as before.
  ANALYZE: z.preprocess(emptyToUndefined, z.string().optional()),
  // Same release inputs as the server schema, plus the browser override:
  // next.config.ts folds them into NEXT_PUBLIC_SENTRY_RELEASE so the client
  // bundle reports the deploy commit without exposing the raw SHA vars.
  NEXT_PUBLIC_SENTRY_RELEASE: optionalText,
  VERCEL_GIT_COMMIT_SHA: optionalText,
  GITHUB_SHA: optionalText,
})

export type ServerEnv = z.infer<typeof serverSchema>
export type BuildEnv = z.infer<typeof buildSchema>

const serverExpectations: Record<string, string> = {
  NODE_ENV: clientExpectations.NODE_ENV,
  NEXT_RUNTIME: "Expected one of: nodejs, edge.",
  DATABASE_URL: "Expected a Postgres connection string (postgres:// or postgresql://).",
  DIRECT_URL: "Expected a Postgres connection string (postgres:// or postgresql://).",
  SENTRY_DSN: "Expected an absolute Sentry DSN URL.",
  SENTRY_RELEASE: "Expected a non-empty release identifier.",
  VERCEL_GIT_COMMIT_SHA: "Expected a commit SHA set by the Vercel build.",
  GITHUB_SHA: "Expected a commit SHA set by GitHub Actions.",
  B2_KEY_ID: "Expected a non-empty Backblaze B2 key id.",
  B2_APPLICATION_KEY: "Expected a non-empty Backblaze B2 application key.",
  B2_KEY_ID_PREVIOUS: "Expected a non-empty Backblaze B2 key id during rotation.",
  B2_APPLICATION_KEY_PREVIOUS: "Expected a non-empty Backblaze B2 application key during rotation.",
  B2_BUCKET: "Expected a non-empty Backblaze B2 bucket name.",
  B2_ENDPOINT: "Expected an absolute Backblaze B2 S3 endpoint URL.",
  RESEND_API_KEY: "Expected a non-empty Resend API key.",
  CONTACT_TO_EMAIL: "Expected the mailbox that receives contact-form submissions.",
  CONTACT_FROM_EMAIL: "Expected a verified Resend sender address for contact email.",
  LLM_API_KEY: "Expected a non-empty LLM provider API key.",
  LLM_BASE_URL: "Expected an absolute LLM provider base URL.",
  LLM_MODEL: "Expected a non-empty LLM model identifier.",
  SESSION_SECRET: "Expected a symmetric key of at least 32 characters.",
  SESSION_SECRET_PREVIOUS: "Expected the previous symmetric key during rotation.",
  EDGE_HMAC_SECRET: "Expected a symmetric key of at least 32 characters.",
  EDGE_HMAC_SECRET_PREVIOUS: "Expected the previous symmetric key during rotation.",
  WORKER_SECRET: "Expected a symmetric key of at least 32 characters.",
  WORKER_SECRET_PREVIOUS: "Expected the previous symmetric key during rotation.",
  OAUTH_PROVIDERS_JSON: "Expected a JSON object describing OAuth providers.",
  CSP_ENFORCE: 'Expected "1" to enforce the full Content-Security-Policy in production.',
}

const buildExpectations: Record<string, string> = {
  CI: "Expected a non-empty CI marker.",
  SENTRY_AUTH_TOKEN: "Expected a non-empty Sentry auth token.",
  ANALYZE: 'Expected "true" to enable the webpack bundle analyzer.',
  NEXT_PUBLIC_SENTRY_RELEASE: "Expected a non-empty release identifier.",
  VERCEL_GIT_COMMIT_SHA: "Expected a commit SHA set by the Vercel build.",
  GITHUB_SHA: "Expected a commit SHA set by GitHub Actions.",
}

/** Keys that must stay documented in `.env.example`. */
export const configuredEnvKeys: readonly string[] = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_API_MODE",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_MOCK_AUTH",
  "DATABASE_URL",
  "DIRECT_URL",
  "SENTRY_DSN",
  "SENTRY_RELEASE",
  "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_SENTRY_RELEASE",
  "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
  "B2_KEY_ID_PREVIOUS",
  "B2_APPLICATION_KEY_PREVIOUS",
  "B2_BUCKET",
  "B2_ENDPOINT",
  "RESEND_API_KEY",
  "CONTACT_TO_EMAIL",
  "CONTACT_FROM_EMAIL",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "SESSION_SECRET",
  "SESSION_SECRET_PREVIOUS",
  "EDGE_HMAC_SECRET",
  "EDGE_HMAC_SECRET_PREVIOUS",
  "WORKER_SECRET",
  "WORKER_SECRET_PREVIOUS",
  "OAUTH_PROVIDERS_JSON",
  // Optional auth knob parsed lazily by src/lib/auth/magic-link-config.ts,
  // which deliberately keeps it out of the typed ServerEnv schema.
  "MAGIC_LINK_TTL_MINUTES",
  "CSP_ENFORCE",
]

export function parseServerEnv(source: EnvSource): ServerEnv {
  const issues = collectEnvIssues(serverSchema, source, serverExpectations)
  if (issues.length > 0) throw new EnvValidationError("server", issues)
  return serverSchema.parse(source)
}

export function parseBuildEnv(source: EnvSource): BuildEnv {
  const issues = collectEnvIssues(buildSchema, source, buildExpectations)
  if (issues.length > 0) throw new EnvValidationError("build", issues)
  return buildSchema.parse(source)
}

let cachedServerEnv: ServerEnv | undefined

export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("Server environment configuration cannot be read in the browser.")
  }

  if (source !== process.env) return parseServerEnv(source)
  cachedServerEnv ??= parseServerEnv(source)
  return cachedServerEnv
}

export function getBuildEnv(source: EnvSource = process.env): BuildEnv {
  return parseBuildEnv(source)
}

function requiredProductionIssues(source: EnvSource): EnvIssue[] {
  if (source.NODE_ENV !== "production") return []
  if (source.NEXT_PUBLIC_SITE_URL?.trim()) return []

  return [
    {
      key: "NEXT_PUBLIC_SITE_URL",
      message: `Required in production. ${clientExpectations.NEXT_PUBLIC_SITE_URL}`,
    },
  ]
}

/**
 * Validates every group together so the failure lists all bad variables in one
 * pass. Called from `next.config.ts` (build and `next start`) and from the
 * container entrypoint script.
 */
export function validateEnv(source: EnvSource = process.env): {
  client: ClientEnv
  server: ServerEnv
  build: BuildEnv
} {
  const issues = [
    ...collectEnvIssues(clientSchema, source, clientExpectations),
    ...collectEnvIssues(serverSchema, source, serverExpectations),
    ...collectEnvIssues(buildSchema, source, buildExpectations),
    ...requiredProductionIssues(source),
  ]

  if (issues.length > 0) throw new EnvValidationError("application", issues)

  return {
    client: clientSchema.parse(source),
    server: serverSchema.parse(source),
    build: buildSchema.parse(source),
  }
}

/**
 * Server-only configuration. Parsed lazily on first property access so
 * importing this module (for example from a unit test) does not require a
 * server runtime; the first real read validates and caches the schema.
 */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, property) {
    return getServerEnv()[property as keyof ServerEnv]
  },
})
