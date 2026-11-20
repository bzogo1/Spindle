"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { useAuthSession } from "@/components/auth/session-provider"
import type { ClientSession } from "@/lib/auth/auth-client"
import {
  clearMockSessionCookie,
  persistMockSession,
  SIGN_IN_PATH,
  type MockSessionData,
  type MockSessionUser,
  type MockSessionWorkspace,
} from "@/lib/auth/mock-session"

export type MockSessionStatus = "loading" | "authenticated" | "unauthenticated"

export type MockSessionContextValue = {
  user: MockSessionUser | null
  workspace: MockSessionWorkspace | null
  status: MockSessionStatus
  /** Additional workspaces the switcher can pretend to exist; mock-only. */
  workspaces: MockSessionWorkspace[]
  signIn: (session: MockSessionData) => void
  signOut: () => void
  switchWorkspace: (workspace: MockSessionWorkspace) => void
}

const MockSessionContext = createContext<MockSessionContextValue | null>(null)

/** Extra workspaces offered by the mock workspace switcher. */
const MOCK_WORKSPACES: MockSessionWorkspace[] = [
  { name: "Personal workspace", slug: "personal" },
  { name: "Research team", slug: "research-team" },
]

/** Workspace used when the real session has none attached yet. */
const FALLBACK_WORKSPACE: MockSessionWorkspace = { name: "Personal workspace", slug: "personal" }

function displayName(email: string): string {
  const local = email.split("@")[0] ?? email
  return local.charAt(0).toUpperCase() + local.slice(1)
}

/** ClientSession -> the MockSessionData-ish shape the shell consumes. */
function toShellSession(session: ClientSession): MockSessionData {
  return {
    user: {
      name: session.user.name ?? displayName(session.user.email),
      email: session.user.email,
    },
    workspace: session.workspace ?? FALLBACK_WORKSPACE,
    signedInAt: new Date().toISOString(),
  }
}

/**
 * Provides the session to the `(app)` shell in one of two modes:
 *
 *  - Mock mode (`initialSession` provided): the cookie-verified session from
 *    the server layout, unchanged from the original mock-auth implementation.
 *  - Real mode (`initialSession` absent): adapts the global
 *    `AuthSessionProvider` (`useAuthSession`) into the same context shape so
 *    consumers never learn which backend is active.
 *
 * The server layout has already verified a cookie before rendering either
 * mode; in real mode that check is only "a session cookie exists", so this
 * provider also bounces visitors back to sign-in if the client-side session
 * resolves to unauthenticated.
 */
export function MockSessionProvider({
  initialSession,
  children,
}: {
  initialSession?: MockSessionData
  children: React.ReactNode
}) {
  if (initialSession) {
    return (
      <MockSessionProviderImpl initialSession={initialSession}>{children}</MockSessionProviderImpl>
    )
  }
  return <RealSessionAdapter>{children}</RealSessionAdapter>
}

/**
 * Mock-mode implementation. The server layout has already verified the cookie
 * before rendering, so `initialSession` is always populated here; the context
 * shape mirrors the future server session so consumers never change.
 */
function MockSessionProviderImpl({
  initialSession,
  children,
}: {
  initialSession: MockSessionData
  children: React.ReactNode
}) {
  const [session, setSession] = useState<MockSessionData>(initialSession)
  const [workspace, setWorkspace] = useState<MockSessionWorkspace>(initialSession.workspace)

  const signIn = useCallback((next: MockSessionData) => {
    persistMockSession(next)
    setSession(next)
    setWorkspace(next.workspace)
  }, [])

  const signOut = useCallback(() => {
    clearMockSessionCookie()
    // Full navigation: the server guard must see the cleared cookie, and the
    // marketing site loads its own root layout anyway.
    window.location.assign("/")
  }, [])

  const switchWorkspace = useCallback((next: MockSessionWorkspace) => {
    setWorkspace(next)
  }, [])

  const value = useMemo<MockSessionContextValue>(
    () => ({
      user: session.user,
      workspace,
      status: "authenticated",
      workspaces: MOCK_WORKSPACES,
      signIn,
      signOut,
      switchWorkspace,
    }),
    [session.user, workspace, signIn, signOut, switchWorkspace],
  )

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>
}

/**
 * Real-mode adapter: maps the global `AuthSessionProvider` state onto the
 * mock-session context shape. `useAuthSession` is only called here so the
 * mock path never requires `AuthSessionProvider` to be mounted.
 */
function RealSessionAdapter({ children }: { children: React.ReactNode }) {
  const authSession = useAuthSession()
  const [workspaceOverride, setWorkspaceOverride] = useState<MockSessionWorkspace | null>(null)

  // The server guard only proves a session cookie exists; when the real
  // session resolves to signed-out (expired/revoked), send the visitor back
  // to the marketing sign-in instead of rendering a dead shell.
  useEffect(() => {
    if (authSession.status === "unauthenticated") {
      window.location.assign(SIGN_IN_PATH)
    }
  }, [authSession.status])

  const mapped = useMemo(
    () => (authSession.session ? toShellSession(authSession.session) : null),
    [authSession.session],
  )

  const workspace = workspaceOverride ?? mapped?.workspace ?? null

  const signIn = useCallback((_session: MockSessionData) => {
    // Real sessions are established by the auth dialog / magic-link flow
    // before the shell mounts; nothing inside the shell calls signIn.
  }, [])

  const { signOut: authSignOut } = authSession
  const signOut = useCallback(() => {
    void authSignOut()
  }, [authSignOut])

  const switchWorkspace = useCallback((next: MockSessionWorkspace) => {
    setWorkspaceOverride(next)
  }, [])

  const value = useMemo<MockSessionContextValue>(
    () => ({
      user: mapped?.user ?? null,
      workspace,
      status: authSession.status,
      workspaces: mapped ? [mapped.workspace] : [],
      signIn,
      signOut,
      switchWorkspace,
    }),
    [mapped, workspace, authSession.status, signIn, signOut, switchWorkspace],
  )

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>
}

export function useMockSession(): MockSessionContextValue {
  const context = useContext(MockSessionContext)
  if (!context) {
    throw new Error("useMockSession must be used within MockSessionProvider")
  }
  return context
}
