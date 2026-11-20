import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAuthSession, type SessionContextValue } from "@/components/auth/session-provider"
import type { ClientSession } from "@/lib/auth/auth-client"
import {
  MOCK_SESSION_COOKIE,
  decodeMockSession,
  readMockSessionCookie,
  SIGN_IN_PATH,
  type MockSessionData,
} from "@/lib/auth/mock-session"

import { MockSessionProvider, useMockSession } from "./mock-session-provider"

vi.mock("@/components/auth/session-provider", () => ({
  useAuthSession: vi.fn(),
}))

const authSessionMock = vi.mocked(useAuthSession)

const initialSession: MockSessionData = {
  user: { name: "Ada Lovelace", email: "ada@lab.edu" },
  workspace: { name: "Research team", slug: "research-team" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function wrapper({ children }: { children: ReactNode }) {
  return <MockSessionProvider initialSession={initialSession}>{children}</MockSessionProvider>
}

function resetSessionCookie() {
  document.cookie = `${MOCK_SESSION_COOKIE}=; Path=/; Max-Age=0`
}

afterEach(() => {
  resetSessionCookie()
})

describe("MockSessionProvider", () => {
  it("exposes the initial session as authenticated", () => {
    const { result } = renderHook(() => useMockSession(), { wrapper })

    expect(result.current.status).toBe("authenticated")
    expect(result.current.user).toEqual(initialSession.user)
    expect(result.current.workspace).toEqual(initialSession.workspace)
    expect(result.current.workspaces.length).toBeGreaterThan(0)
  })

  it("persists and exposes a new session on signIn", () => {
    const { result } = renderHook(() => useMockSession(), { wrapper })

    const next: MockSessionData = {
      user: { name: "Grace Hopper", email: "grace@navy.mil" },
      workspace: { name: "Compiler lab", slug: "compiler-lab" },
      signedInAt: "2026-11-20T08:30:00.000Z",
    }

    act(() => {
      result.current.signIn(next)
    })

    expect(result.current.user).toEqual(next.user)
    expect(result.current.workspace).toEqual(next.workspace)
    expect(readMockSessionCookie()).toEqual(next)
    expect(document.cookie).toContain(`${MOCK_SESSION_COOKIE}=`)
  })

  it("switches the active workspace without touching the user", () => {
    const { result } = renderHook(() => useMockSession(), { wrapper })

    const target = result.current.workspaces.find(
      (option) => option.slug !== initialSession.workspace.slug,
    )
    expect(target).toBeDefined()

    act(() => {
      result.current.switchWorkspace(target!)
    })

    expect(result.current.workspace).toEqual(target)
    expect(result.current.user).toEqual(initialSession.user)
  })

  it("clears the session cookie on signOut", () => {
    const { result } = renderHook(() => useMockSession(), { wrapper })

    act(() => {
      result.current.signIn(initialSession)
    })
    expect(readMockSessionCookie()).not.toBeNull()

    act(() => {
      result.current.signOut()
    })

    expect(readMockSessionCookie()).toBeNull()
    expect(decodeMockSession(document.cookie)).toBeNull()
  })

  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => useMockSession())).toThrow(
      "useMockSession must be used within MockSessionProvider",
    )
  })
})

const clientSession: ClientSession = {
  user: { id: "user-1", email: "grace@navy.mil", name: null, emailVerified: true },
  workspace: null,
  sessionId: "sess-1",
  expiresAt: "2026-11-20T00:00:00.000Z",
}

function mockAuthSession(overrides: Partial<SessionContextValue> = {}) {
  const signOut = vi.fn(async () => {})
  authSessionMock.mockReturnValue({
    user: null,
    workspace: null,
    session: null,
    status: "unauthenticated",
    signIn: vi.fn(),
    signOut,
    ...overrides,
  })
  return signOut
}

function realWrapper({ children }: { children: ReactNode }) {
  return <MockSessionProvider>{children}</MockSessionProvider>
}

describe("MockSessionProvider (real-session mode)", () => {
  const originalLocation = window.location
  let assignMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assignMock = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: assignMock },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    authSessionMock.mockReset()
  })

  it("maps an authenticated ClientSession onto the shell shape", () => {
    mockAuthSession({
      session: clientSession,
      user: clientSession.user,
      status: "authenticated",
    })

    const { result } = renderHook(() => useMockSession(), { wrapper: realWrapper })

    expect(authSessionMock).toHaveBeenCalled()
    expect(result.current.status).toBe("authenticated")
    // name is null -> derived from the email local part.
    expect(result.current.user).toEqual({ name: "Grace", email: "grace@navy.mil" })
    // workspace is null -> fallback workspace.
    expect(result.current.workspace).toEqual({ name: "Personal workspace", slug: "personal" })
    expect(result.current.workspaces).toEqual([{ name: "Personal workspace", slug: "personal" }])
  })

  it("prefers the session name and workspace when present", () => {
    const session: ClientSession = {
      ...clientSession,
      user: { ...clientSession.user, name: "Grace Hopper" },
      workspace: { name: "Compiler lab", slug: "compiler-lab" },
    }
    mockAuthSession({
      session,
      user: session.user,
      workspace: session.workspace,
      status: "authenticated",
    })

    const { result } = renderHook(() => useMockSession(), { wrapper: realWrapper })

    expect(result.current.user).toEqual({ name: "Grace Hopper", email: "grace@navy.mil" })
    expect(result.current.workspace).toEqual({ name: "Compiler lab", slug: "compiler-lab" })
  })

  it("passes the loading status through while the session resolves", () => {
    mockAuthSession({ status: "loading" })

    const { result } = renderHook(() => useMockSession(), { wrapper: realWrapper })

    expect(result.current.status).toBe("loading")
    expect(result.current.user).toBeNull()
    expect(result.current.workspace).toBeNull()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it("redirects to sign-in when the real session resolves unauthenticated", () => {
    mockAuthSession({ status: "unauthenticated" })

    renderHook(() => useMockSession(), { wrapper: realWrapper })

    expect(assignMock).toHaveBeenCalledWith(SIGN_IN_PATH)
  })

  it("delegates signOut to the auth session", () => {
    const authSignOut = mockAuthSession({
      session: clientSession,
      user: clientSession.user,
      status: "authenticated",
    })

    const { result } = renderHook(() => useMockSession(), { wrapper: realWrapper })

    act(() => {
      result.current.signOut()
    })

    expect(authSignOut).toHaveBeenCalledTimes(1)
  })

  it("switchWorkspace overrides the session workspace locally", () => {
    mockAuthSession({
      session: clientSession,
      user: clientSession.user,
      status: "authenticated",
    })

    const { result } = renderHook(() => useMockSession(), { wrapper: realWrapper })
    const target = { name: "Other", slug: "other" }

    act(() => {
      result.current.switchWorkspace(target)
    })

    expect(result.current.workspace).toEqual(target)
  })
})
