import { z } from "zod"

/**
 * Client-safe environment configuration.
 *
 * This module defines the shared schema pieces and the `NEXT_PUBLIC_*` group.
 * Server-only values live in `src/lib/env.server.ts`, so importing `clientEnv`
 * never pulls server keys or values into a browser bundle.
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

export const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value

export const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional())
export const optionalText = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional())
export const optionalSymmetricKey = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(32, "Expected a symmetric key of at least 32 characters.").optional(),
)
export const optionalPostgresUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .regex(
      /^postgres(?:ql)?:\/\//,
      "Expected a Postgres connection string (postgres:// or postgresql://).",
    )
    .optional(),
)

export const nodeEnv = z.enum(["development", "test", "production"]).default("development")

export const apiMode = z.preprocess(emptyToUndefined, z.enum(["mock", "http"]).default("mock"))

/** Values that are safe to expose to the browser. Only `NEXT_PUBLIC_*` keys belong here. */
export const clientSchema = z.object({
  NODE_ENV: nodeEnv,
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  NEXT_PUBLIC_API_MODE: apiMode,
  NEXT_PUBLIC_API_URL: optionalUrl,
  NEXT_PUBLIC_MOCK_AUTH: z.preprocess(emptyToUndefined, z.literal("1").optional()),
})

export type ClientEnv = z.infer<typeof clientSchema>

export const clientExpectations: Record<string, string> = {
  NODE_ENV: "Expected one of: development, test, production.",
  NEXT_PUBLIC_SITE_URL: "Expected an absolute URL, for example https://spindle.app.",
  NEXT_PUBLIC_SENTRY_DSN: "Expected an absolute Sentry DSN URL.",
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

export function collectEnvIssues(
  schema: z.ZodType,
  source: EnvSource,
  expectations: Record<string, string>,
): EnvIssue[] {
  const result = schema.safeParse(source)
  if (result.success) return []

  return result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "environment")
    return { key, message: expectations[key] ?? issue.message }
  })
}

/**
 * Client values are read through explicit `process.env.NEXT_PUBLIC_*` members
 * so Next.js can inline them into the browser bundle.
 */
const rawClientEnv: EnvSource = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_API_MODE: process.env.NEXT_PUBLIC_API_MODE,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_MOCK_AUTH: process.env.NEXT_PUBLIC_MOCK_AUTH,
}

export function parseClientEnv(source: EnvSource): ClientEnv {
  const issues = collectEnvIssues(clientSchema, source, clientExpectations)
  if (issues.length > 0) throw new EnvValidationError("client", issues)
  return clientSchema.parse(source)
}

/** Browser-safe configuration. */
export const clientEnv = parseClientEnv(rawClientEnv)
