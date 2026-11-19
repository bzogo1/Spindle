/**
 * Mocked auth backend for the marketing-site dialog.
 *
 * Every mock outcome lives behind {@link MOCK_AUTH_ENABLED} and the three
 * `mock*` functions, so the real auth client (see DEV-035/036) can replace
 * this module without touching the forms. No network requests are made.
 */

export const MOCK_AUTH_ENABLED = true

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
  workspace: { name: string; slug: string }
  signedInAt: string
}

export type MockCredentials = { email: string; password: string }
export type MockSignUpInput = MockCredentials & { workspaceName: string }

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

/** Mocked sign-in. Rejects with `invalid_credentials` for the demo password. */
export async function mockSignIn({ email, password }: MockCredentials): Promise<MockSession> {
  await mockLatency()
  if (password === INVALID_CREDENTIALS_PASSWORD) {
    throw new MockAuthError("invalid_credentials", "Invalid email or password.")
  }
  const session: MockSession = {
    user: { name: displayName(email), email },
    workspace: { name: "Personal workspace", slug: "personal" },
    signedInAt: new Date().toISOString(),
  }
  return session
}

/** Mocked workspace sign-up. Rejects with `email_taken` for the demo email. */
export async function mockCreateWorkspace(input: MockSignUpInput): Promise<MockSession> {
  await mockLatency()
  if (input.email === TAKEN_EMAIL) {
    throw new MockAuthError("email_taken", "An account already uses this email.")
  }
  return {
    user: { name: displayName(input.email), email: input.email },
    workspace: { name: input.workspaceName, slug: input.workspaceName },
    signedInAt: new Date().toISOString(),
  }
}

/** Mocked password-reset / verification email. Always succeeds after latency. */
export async function mockSendEmailLink(_email: string): Promise<void> {
  await mockLatency()
}
