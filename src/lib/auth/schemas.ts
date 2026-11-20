import { z } from "zod"

/**
 * zod schemas for `/api/auth/*` request bodies. Kept in one module so route
 * handlers stay thin and the client can mirror the shapes.
 */

export const emailField = z.string().trim().toLowerCase().email().max(320)

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(1024),
  remember: z.boolean().optional().default(true),
})

export const signUpSchema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/, "Use letters, numbers, spaces, dashes."),
  email: emailField,
  password: z.string().min(8).max(1024),
  remember: z.boolean().optional().default(true),
})

export const tokenSchema = z.object({
  token: z.string().min(1).max(512),
})

export const passwordlessRequestSchema = z.object({
  email: emailField,
  purpose: z.enum(["signin", "verify-email"]).optional().default("signin"),
  /** Optional in-app path to land on after the magic link is consumed. */
  next: z.string().max(2048).optional(),
})

/**
 * Returns `value` only when it is a safe same-origin app path (`/...` but not
 * `//...`). Anything else — absolute URLs, protocol-relative paths, junk —
 * is treated as absent so callers can fall back to a default.
 */
export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (!value) return null
  return value.startsWith("/") && !value.startsWith("//") ? value : null
}

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(8).max(1024),
})

export const totpVerifyLoginSchema = z.object({
  challenge: z.string().min(1).max(2048),
  code: z.string().min(6).max(16),
  remember: z.boolean().optional().default(true),
})

export const totpCodeSchema = z.object({
  code: z.string().min(6).max(16),
})

export const disableTotpSchema = z.object({
  password: z.string().min(1).max(1024),
})

export const oauthCallbackSchema = z.object({
  provider: z.string().regex(/^[a-z0-9-]{2,32}$/),
  code: z.string().min(1).max(2048),
  redirectUri: z.string().url().max(2048),
  /** PKCE verifier held client-side since the authorize redirect. */
  codeVerifier: z.string().min(43).max(128),
})

export type SignInInput = z.infer<typeof signInSchema>
export type SignUpInput = z.infer<typeof signUpSchema>
