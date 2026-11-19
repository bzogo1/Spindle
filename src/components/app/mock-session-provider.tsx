"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

import {
  clearMockSessionCookie,
  persistMockSession,
  type MockSessionData,
  type MockSessionUser,
  type MockSessionWorkspace,
} from "@/lib/auth/mock-session"

export type MockSessionStatus = "authenticated" | "unauthenticated"

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

/**
 * Provides the mocked session to the `(app)` shell. The server layout has
 * already verified the cookie before rendering, so `initialSession` is always
 * populated here; the context shape mirrors the future server session so DEV-27
 * can swap the implementation without touching consumers.
 */
export function MockSessionProvider({
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

export function useMockSession(): MockSessionContextValue {
  const context = useContext(MockSessionContext)
  if (!context) {
    throw new Error("useMockSession must be used within MockSessionProvider")
  }
  return context
}
