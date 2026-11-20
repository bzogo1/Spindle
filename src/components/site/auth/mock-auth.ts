"use client"

/**
 * Auth backend adapter for the marketing-site dialog.
 *
 * Every call first attempts the real `/api/auth/*` endpoints via
 * `@/lib/auth/auth-client`. The simulated mock outcomes below remain as a
 * fallback for two cases only:
 *  1. `NEXT_PUBLIC_MOCK_AUTH=1` development/preview sessions where no auth
 *     server is expected.
 *  2. Network-level failures (server unreachable) outside production, so
 *     static demos and unit tests keep working.
 *
 * A reachable server is always authoritative: credential errors, taken
 * emails, and rate limits surface as real `AuthApiError`s — never mocked.
 */

import { clientEnv } from "@/lib/env"
import type { WorkspaceRole } from "@/lib/members/permissions"
import {
  AuthApiError,
  requestEmailVerification,
  requestPasswordReset,
  signInWithPassword,
  signUpWithPassword,
  verifyTotpChallenge,
  type ClientSession,
} from "@/lib/auth/auth-client"

/** Simulated latency bounds, in milliseconds. */
export const MOCK_LATENCY_MIN_MS = 300
export const MOCK_LATENCY_MAX_MS = 800

export type MockAuthErrorCode = "invalid_credentials" | "email_taken"

export class MockAuthError extends Error {
  readonly code: MockAuthErrorCode

  constructor(code: MockAuthErrorCode, message: string) {
    super(message)
    this.name = "MockAuthError"
    this.code = code
  }
}

export type MockSession = {
  user: { name: string; email: string }
  workspace: { name: string; slug: string; role?: WorkspaceRole }
  signedInAt: string
}

export type MockCredentials = { email: string; password: string }
export type MockSignUpInput = MockCredentials & {
  workspaceName: string
  /** Proof-of-work captcha token forwarded to the real signup endpoint. */
  captchaToken?: string
}

/**
 * Session result carried back to callers. `clientSession` is the real
 * `ClientSession` (with `sessionId`/`expiresAt`) on the real auth path so the
 * session provider can be bridged; it is `null` on simulated mock fallbacks,
 * where no client session exists.
 */
export type MockAuthSessionResult = {
  session: MockSession
  clientSession: ClientSession | null
}

let mockSession: MockSession | null = null

function mockLatency(): Promise<void> {
  const ms = MOCK_LATENCY_MIN_MS + Math.random() * (MOCK_LATENCY_MAX_MS - MOCK_LATENCY_MIN_MS)
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Demo trigger: password "incorrect" always fails sign-in. */
const INVALID_CREDENTIALS_PASSWORD = "incorrect"
/** Demo trigger: this email is already registered. */
const TAKEN_EMAIL = "taken@spindle.dev"

export function getMockSession(): MockSession | null {
  return mockSession
}

export function setMockSession(session: MockSession): void {
  mockSession = session
  window.dispatchEvent(new CustomEvent("spindle:mock-session", { detail: session }))
}

export function clearMockSession(): void {
  mockSession = null
  window.dispatchEvent(new CustomEvent("spindle:mock-session", { detail: null }))
}

function displayName(email: string): string {
  const local = email.split("@")[0] ?? email
  return local.charAt(0).toUpperCase() + local.slice(1)
}

/** ClientSession -> the MockSession shape the dialog already understands. */
export function toMockSession(session: ClientSession): MockSession {
  return {
    user: { name: session.user.name ?? displayName(session.user.email), email: session.user.email },
    workspace: session.workspace ?? { name: "Personal workspace", slug: "personal" },
    signedInAt: new Date().toISOString(),
  }
}

/**
 * Mock fallback is allowed on network failure only outside production, or
 * always when the explicit mock-auth flag is on (static demos).
 */
function canFallBackToMock(): boolean {
  return clientEnv.NEXT_PUBLIC_MOCK_AUTH === "1" || clientEnv.NODE_ENV !== "production"
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof AuthApiError && error.code === "network"
}

/** Mocked sign-in. Rejects with `invalid_credentials` for the demo password. */
async function simulateSignIn({ email, password }: MockCredentials): Promise<MockSession> {
  await mockLatency()
  if (password === INVALID_CREDENTIALS_PASSWORD) {
    throw new MockAuthError("invalid_credentials", "Invalid email or password.")
  }
  return {
    user: { name: displayName(email), email },
    // Simulated sessions always land in the user's own workspace, where they
    // are the owner — mirrors what a real signup/sign-in would resolve to.
    workspace: { name: "Personal workspace", slug: "personal", role: "owner" },
    signedInAt: new Date().toISOString(),
  }
}

/** Mocked email-link send. Always succeeds after latency. */
export type EmailLinkPurpose = "reset" | "verify-email"

/**
 * Real-first sign-in. Returns the session on success; throws
 * `AuthApiError("totp_required")` is NOT thrown here — callers should use
 * `signIn` below which surfaces the challenge.
 */
export async function authSignIn(
  credentials: MockCredentials & { remember?: boolean },
): Promise<MockAuthSessionResult | { totpChallenge: string }> {
  try {
    const result = await signInWithPassword({
      email: credentials.email,
      password: credentials.password,
      remember: credentials.remember,
    })
    if (result.status === "totp_required") {
      return { totpChallenge: result.challenge }
    }
    return { session: toMockSession(result.session), clientSession: result.session }
  } catch (error) {
    if (isNetworkFailure(error) && canFallBackToMock()) {
      return { session: await simulateSignIn(credentials), clientSession: null }
    }
    if (error instanceof AuthApiError && error.code === "invalid_credentials") {
      throw new MockAuthError("invalid_credentials", "Invalid email or password.")
    }
    throw error
  }
}

/**
 * Real-first TOTP verify for the second sign-in step. Returns the same
 * {@link MockAuthSessionResult} shape as {@link authSignIn} so the
 * `ClientSession` reaches the session provider instead of being dropped by
 * `toMockSession`.
 *
 * There is no simulated TOTP fallback: a challenge only originates from the
 * real `/api/auth/signin` response (the mock sign-in never produces one), so
 * `AuthApiError`s — `totp_invalid`, `network`, rate limits — always propagate
 * to the caller unchanged.
 */
export async function verifyTotpSignIn(input: {
  challenge: string
  code: string
  remember?: boolean
}): Promise<MockAuthSessionResult> {
  const session = await verifyTotpChallenge(input)
  return { session: toMockSession(session), clientSession: session }
}

/** Kept for callers that only need the happy-path session (tests, previews). */
export async function mockSignIn(credentials: MockCredentials): Promise<MockSession> {
  const result = await authSignIn(credentials)
  if ("totpChallenge" in result) {
    throw new AuthApiError("totp_required", "This account requires two-factor authentication.")
  }
  return result.session
}

export async function mockCreateWorkspace(input: MockSignUpInput): Promise<MockAuthSessionResult> {
  try {
    const session = await signUpWithPassword({
      workspaceName: input.workspaceName,
      email: input.email,
      password: input.password,
      captchaToken: input.captchaToken,
    })
    return { session: toMockSession(session), clientSession: session }
  } catch (error) {
    if (isNetworkFailure(error) && canFallBackToMock()) {
      return { session: await simulateCreateWorkspace(input), clientSession: null }
    }
    if (error instanceof AuthApiError && error.code === "email_taken") {
      throw new MockAuthError("email_taken", "An account already uses this email.")
    }
    throw error
  }
}

// Simulated sign-up used only when the auth API is unreachable (see above).
async function simulateCreateWorkspace(input: MockSignUpInput): Promise<MockSession> {
  await mockLatency()
  if (input.email === TAKEN_EMAIL) {
    throw new MockAuthError("email_taken", "An account already uses this email.")
  }
  return {
    user: { name: displayName(input.email), email: input.email },
    // The creator of a workspace is its owner.
    workspace: { name: input.workspaceName, slug: input.workspaceName, role: "owner" },
    signedInAt: new Date().toISOString(),
  }
}

/**
 * Sends a password-reset or verification email through the real API; falls
 * back to the simulated send only when the server is unreachable outside
 * production.
 */
export async function mockSendEmailLink(
  email: string,
  purpose: EmailLinkPurpose = "reset",
): Promise<void> {
  try {
    if (purpose === "verify-email") {
      await requestEmailVerification(email)
    } else {
      await requestPasswordReset(email)
    }
  } catch (error) {
    if (isNetworkFailure(error) && canFallBackToMock()) {
      await simulateSendEmailLink(email, purpose)
      return
    }
    throw error
  }
}

async function simulateSendEmailLink(_email: string, _purpose?: EmailLinkPurpose): Promise<void> {
  await mockLatency()
}
