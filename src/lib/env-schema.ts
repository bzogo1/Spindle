import { z } from "zod"

import type { EnvIssue, EnvSource } from "./env"

/**
 * Server/build-only zod schemas for environment validation.
 *
 * Kept out of `src/lib/env.ts` on purpose: that module is reachable from the
 * browser (`clientEnv`, `instrumentation-client.ts`), and importing zod there
 * would put the whole validation library into every client bundle. This file
 * is imported only by `env.server.ts`, `next.config.ts` tooling, and tests.
 */

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
  NEXT_PUBLIC_SENTRY_RELEASE: optionalText,
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(1).optional(),
  ),
  NEXT_PUBLIC_API_MODE: apiMode,
  NEXT_PUBLIC_API_URL: optionalUrl,
  NEXT_PUBLIC_MOCK_AUTH: z.preprocess(emptyToUndefined, z.literal("1").optional()),
})

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
