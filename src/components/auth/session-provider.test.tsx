import { StrictMode } from "react"
import { act, render, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientSession } from "@/lib/auth/auth-client"

const authClient = vi.hoisted(() => ({
  getCurrentSession: vi.fn<() => ClientSession | null>(() => null),
  onAuthStateChange: vi.fn(),
  loadSession: vi.fn<() => Promise<ClientSession | null>>(),
  ensureFreshSession: vi.fn<() => Promise<ClientSession | null>>(),
  acceptSession: vi.fn(),
  signOut: vi.fn<() => Promise<void>>(),
}))

vi.mock("@/lib/auth/auth-client", () => authClient)

const fingerprintClient = vi.hoisted(() => ({
  registerDeviceFingerprintWithServer: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  unregisterDeviceFingerprintWithServer: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
}))

vi.mock("@/lib/device/fingerprint-client", () => fingerprintClient)

import { AuthSessionProvider, useAuthSession, type SessionContextValue } from "./session-provider"

const session: ClientSession = {
  user: { id: "u1", email: "researcher@lab.edu", name: "Researcher", emailVerified: true },
  workspace: { name: "Lab", slug: "lab" },
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

let captured: SessionContextValue | null = null
let listener: ((next: ClientSession | null) => void) | null = null

function Capture() {
  captured = useAuthSession()
  return null
}

function renderProvider() {
  return render(
    <AuthSessionProvider>
      <Capture />
    </AuthSessionProvider>,
  )
}

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  captured = null
  listener = null
  assignMock = vi.fn()
  authClient.getCurrentSession.mockReturnValue(null)
  authClient.loadSession.mockReturnValue(new Promise(() => {}))
  authClient.ensureFreshSession.mockResolvedValue(null)
  authClient.onAuthStateChange.mockImplementation((cb: (next: ClientSession | null) => void) => {
    listener = cb
    return () => {}
  })
  authClient.signOut.mockResolvedValue(undefined)
  fingerprintClient.registerDeviceFingerprintWithServer.mockClear()
  fingerprintClient.registerDeviceFingerprintWithServer.mockResolvedValue(true)
  fingerprintClient.unregisterDeviceFingerprintWithServer.mockClear()
  // mockClear does not reset implementations — restore the default so a
  // test that overrides the return value cannot leak into later tests.
  fingerprintClient.unregisterDeviceFingerprintWithServer.mockResolvedValue(true)
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
})

describe("AuthSessionProvider", () => {
  it("reports loading until the first session resolution completes", async () => {
    let resolveLoad!: (value: ClientSession | null) => void
    authClient.loadSession.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
    )
    renderProvider()

    expect(captured?.status).toBe("loading")
    expect(captured?.user).toBeNull()

    await act(async () => {
      resolveLoad(null)
      await Promise.resolve()
    })
    expect(captured?.status).toBe("unauthenticated")
  })

  it("becomes authenticated when the session resolves (via auth-state change)", async () => {
    // The real loadSession adopts the session and notifies subscribers.
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()

    await waitFor(() => expect(captured?.status).toBe("authenticated"))
    expect(captured?.user?.email).toBe("researcher@lab.edu")
    expect(captured?.workspace?.slug).toBe("lab")
    expect(captured?.session).toEqual(session)
  })

  it("starts authenticated when a session is already cached", () => {
    authClient.getCurrentSession.mockReturnValue(session)
    authClient.loadSession.mockResolvedValue(session)
    renderProvider()

    expect(captured?.status).toBe("authenticated")
    expect(captured?.user?.email).toBe("researcher@lab.edu")
  })

  it("follows auth-state changes from the client subscription", async () => {
    authClient.loadSession.mockResolvedValue(null)
    renderProvider()

    await waitFor(() => expect(captured?.status).toBe("unauthenticated"))

    act(() => listener?.(session))
    expect(captured?.status).toBe("authenticated")
    expect(captured?.user?.id).toBe("u1")

    act(() => listener?.(null))
    expect(captured?.status).toBe("unauthenticated")
    expect(captured?.session).toBeNull()
  })

  it("re-checks the session when the document becomes visible", async () => {
    authClient.loadSession.mockResolvedValue(null)
    renderProvider()
    await waitFor(() => expect(captured?.status).toBe("unauthenticated"))

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(authClient.ensureFreshSession).toHaveBeenCalledTimes(1)
  })

  it("ignores visibilitychange while the document is hidden", async () => {
    authClient.loadSession.mockResolvedValue(null)
    renderProvider()
    await waitFor(() => expect(captured?.status).toBe("unauthenticated"))

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    })
    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(authClient.ensureFreshSession).not.toHaveBeenCalled()
    } finally {
      // @ts-expect-error removing the own property restores the jsdom getter
      delete document.visibilityState
    }
  })

  it("removes the visibilitychange listener on unmount", async () => {
    authClient.loadSession.mockResolvedValue(null)
    const { unmount } = renderProvider()
    await waitFor(() => expect(captured?.status).toBe("unauthenticated"))

    unmount()
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(authClient.ensureFreshSession).not.toHaveBeenCalled()
  })

  it("unsubscribes from auth-state changes on unmount", async () => {
    const unsubscribe = vi.fn()
    authClient.onAuthStateChange.mockReturnValue(unsubscribe)
    authClient.loadSession.mockResolvedValue(null)
    const { unmount } = renderProvider()
    await waitFor(() => expect(captured?.status).toBe("unauthenticated"))

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("signIn adopts the session through the auth client", () => {
    authClient.loadSession.mockResolvedValue(null)
    renderProvider()

    act(() => captured?.signIn(session))
    expect(authClient.acceptSession).toHaveBeenCalledWith(session)
  })

  it("registers the device fingerprint once a session is established", async () => {
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()

    await waitFor(() =>
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1),
    )
  })

  it("does not register a fingerprint while unauthenticated", async () => {
    authClient.loadSession.mockResolvedValue(null)
    renderProvider()
    await waitFor(() => expect(captured?.status).toBe("unauthenticated"))

    expect(fingerprintClient.registerDeviceFingerprintWithServer).not.toHaveBeenCalled()
  })

  it("does not re-register for the same session id", async () => {
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()
    await waitFor(() =>
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1),
    )

    // A redundant auth-state emission for the same session must not re-POST.
    act(() => listener?.({ ...session }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)
  })

  it("registers again when a new session id appears", async () => {
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()
    await waitFor(() =>
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1),
    )

    act(() => listener?.({ ...session, sessionId: "s2" }))
    await waitFor(() =>
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(2),
    )
  })

  it("makes at most FINGERPRINT_MAX_ATTEMPTS attempts per session", async () => {
    vi.useFakeTimers()
    try {
      fingerprintClient.registerDeviceFingerprintWithServer.mockResolvedValue(false)
      authClient.loadSession.mockImplementation(async () => {
        listener?.(session)
        return session
      })
      renderProvider()
      await act(async () => {})
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)

      // First (and only) retry after the delay: attempt #2.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(2)

      // Retries exhausted — no third POST ever fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries on a later session emission only after retries are exhausted", async () => {
    vi.useFakeTimers()
    try {
      fingerprintClient.registerDeviceFingerprintWithServer.mockResolvedValue(false)
      authClient.loadSession.mockImplementation(async () => {
        listener?.(session)
        return session
      })
      renderProvider()
      await act(async () => {})
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)

      // While the retry is still pending, a duplicate emission must NOT
      // start another attempt chain.
      act(() => listener?.({ ...session }))
      await act(async () => {})
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)

      // Exhaust the retry; the attempt marker clears.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(2)

      // Now a fresh emission (e.g. after token refresh) registers again.
      act(() => listener?.({ ...session }))
      await act(async () => {})
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not start a duplicate POST while registration is in flight", async () => {
    // Never-resolving POST keeps the attempt "in flight" for the test.
    fingerprintClient.registerDeviceFingerprintWithServer.mockReturnValue(
      new Promise<boolean>(() => {}),
    )
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()
    await waitFor(() =>
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1),
    )

    // A session re-emission (new object, same sessionId) mid-flight must not
    // fire a second concurrent request.
    act(() => listener?.({ ...session }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)
  })

  it("registers only once under StrictMode double-mount", async () => {
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    render(
      <StrictMode>
        <AuthSessionProvider>
          <Capture />
        </AuthSessionProvider>
      </StrictMode>,
    )

    await waitFor(() =>
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)
  })

  it("stops after a successful retry and marks the session done", async () => {
    vi.useFakeTimers()
    try {
      fingerprintClient.registerDeviceFingerprintWithServer
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true)
      authClient.loadSession.mockImplementation(async () => {
        listener?.(session)
        return session
      })
      renderProvider()
      await act(async () => {})
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)

      // The delayed retry succeeds and marks the session done.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(2)

      act(() => listener?.({ ...session }))
      await act(async () => {})
      expect(fingerprintClient.registerDeviceFingerprintWithServer).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("signOut revokes the session then navigates to /", async () => {
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()
    await waitFor(() => expect(captured?.status).toBe("authenticated"))

    await act(async () => {
      await captured?.signOut()
    })

    expect(authClient.signOut).toHaveBeenCalledTimes(1)
    // Fingerprint record is dropped before the session is revoked.
    expect(fingerprintClient.unregisterDeviceFingerprintWithServer).toHaveBeenCalledTimes(1)
    expect(
      fingerprintClient.unregisterDeviceFingerprintWithServer.mock.invocationCallOrder[0],
    ).toBeLessThan(authClient.signOut.mock.invocationCallOrder[0])
    expect(assignMock).toHaveBeenCalledWith("/")
  })

  it("does not block sign-out when fingerprint cleanup stalls", async () => {
    vi.useFakeTimers()
    try {
      // unregister never resolves — the timeout race must still let sign-out
      // proceed within FINGERPRINT_UNREGISTER_TIMEOUT_MS (4s).
      fingerprintClient.unregisterDeviceFingerprintWithServer.mockReturnValue(
        new Promise<boolean>(() => {}),
      )
      authClient.loadSession.mockResolvedValue(null)
      renderProvider()
      await act(async () => {})

      const pending = captured?.signOut()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000)
      })
      await act(async () => {
        await pending
      })

      expect(authClient.signOut).toHaveBeenCalledTimes(1)
      expect(assignMock).toHaveBeenCalledWith("/")
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not navigate away when signOut fails", async () => {
    authClient.signOut.mockRejectedValue(new Error("network down"))
    authClient.loadSession.mockImplementation(async () => {
      listener?.(session)
      return session
    })
    renderProvider()
    await waitFor(() => expect(captured?.status).toBe("authenticated"))

    await expect(act(async () => captured?.signOut())).rejects.toThrow("network down")
    expect(assignMock).not.toHaveBeenCalled()
  })
})

describe("useAuthSession", () => {
  it("throws when used outside AuthSessionProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderHook(() => useAuthSession())).toThrow(
      "useAuthSession must be used within AuthSessionProvider",
    )
    consoleError.mockRestore()
  })
})
