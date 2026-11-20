import type { ReactElement, ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Guard tests for the `(app)` root layout. The layout is a server component,
 * so we exercise it by calling it directly with mocked `next/headers` cookies
 * and a `redirect` that throws like the real one.
 */

const cookieJar = new Map<string, string>()
const cookiesMock = vi.fn(async () => ({
  get: (name: string) =>
    cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined,
}))
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})

vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  cookies: () => cookiesMock(),
}))

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => redirectMock(url),
}))

async function loadLayout() {
  vi.resetModules()
  const layout = await import("./layout")
  const provider = await import("@/components/app/mock-session-provider")
  return { AppLayout: layout.default, MockSessionProvider: provider.MockSessionProvider }
}

function findByType(node: ReactNode, type: unknown): ReactElement | null {
  if (node === null || node === undefined || typeof node !== "object") return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType(child, type)
      if (found) return found
    }
    return null
  }
  const element = node as ReactElement
  if (element.type === type) return element
  return findByType((element.props as { children?: ReactNode }).children, type)
}

const SIGN_IN = "/sign-in"

beforeEach(() => {
  cookieJar.clear()
  cookiesMock.mockClear()
  redirectMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("(app) layout guard — real session mode", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_AUTH", "")
  })

  it("redirects to sign-in when no session cookie is present", async () => {
    const { AppLayout } = await loadLayout()

    await expect(AppLayout({ children: null })).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN}`)
    expect(redirectMock).toHaveBeenCalledWith(SIGN_IN)
  })

  it("redirects when only an invalid access token cookie is present", async () => {
    const { AppLayout } = await loadLayout()
    cookieJar.set("spindle_at", "garbage.token.value")

    await expect(AppLayout({ children: null })).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN}`)
  })

  it("renders the shell with an expired-but-validly-signed access token", async () => {
    const { AppLayout, MockSessionProvider } = await loadLayout()
    const { signAuthToken } = await import("@/lib/auth/token-codec")
    // Signature is genuine; only `exp` is in the past. The server guard must
    // not bounce it — the client session provider refreshes via /api/auth/session.
    cookieJar.set(
      "spindle_at",
      signAuthToken({
        purpose: "access",
        sid: "s1",
        uid: "u1",
        email: "a@b.c",
        name: null,
        exp: Math.floor(Date.now() / 1000) - 60,
      }),
    )

    const tree = await AppLayout({ children: null })
    const provider = findByType(tree, MockSessionProvider)

    expect(redirectMock).not.toHaveBeenCalled()
    expect(provider).not.toBeNull()
    expect((provider!.props as { initialSession?: unknown }).initialSession).toBeUndefined()
  })

  it("renders the shell with a valid signed access token", async () => {
    const { AppLayout, MockSessionProvider } = await loadLayout()
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    cookieJar.set(
      "spindle_at",
      createAccessToken({ sid: "s1", uid: "u1", email: "a@b.c", name: null }).token,
    )

    const tree = await AppLayout({ children: null })
    const provider = findByType(tree, MockSessionProvider)

    expect(redirectMock).not.toHaveBeenCalled()
    expect(provider).not.toBeNull()
    // Real mode: no mock session is passed; the provider adapts useAuthSession.
    expect((provider!.props as { initialSession?: unknown }).initialSession).toBeUndefined()
  })

  it("renders the shell when only the refresh cookie is present", async () => {
    const { AppLayout, MockSessionProvider } = await loadLayout()
    cookieJar.set("spindle_rt", "opaque-refresh-token")

    const tree = await AppLayout({ children: null })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(findByType(tree, MockSessionProvider)).not.toBeNull()
  })
})

describe("(app) layout guard — mock auth mode", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_AUTH", "1")
  })

  it("redirects to sign-in without a valid mock session cookie", async () => {
    const { AppLayout } = await loadLayout()

    await expect(AppLayout({ children: null })).rejects.toThrow(`NEXT_REDIRECT:${SIGN_IN}`)
  })

  it("renders with the decoded mock session as initialSession", async () => {
    const { AppLayout, MockSessionProvider } = await loadLayout()
    const { encodeMockSession } = await import("@/lib/auth/mock-session")
    const session = {
      user: { name: "Ada", email: "ada@lab.edu" },
      workspace: { name: "Lab", slug: "lab" },
      signedInAt: "2026-11-19T12:00:00.000Z",
    }
    cookieJar.set("spindle_mock_session", encodeMockSession(session))

    const tree = await AppLayout({ children: null })
    const provider = findByType(tree, MockSessionProvider)

    expect(redirectMock).not.toHaveBeenCalled()
    expect((provider!.props as { initialSession?: unknown }).initialSession).toEqual(session)
  })
})
