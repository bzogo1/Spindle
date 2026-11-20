import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientSession } from "./auth-client"

const SESSION: ClientSession = {
  user: { id: "u1", email: "a@b.co", name: "A", emailVerified: true },
  workspace: { name: "WS", slug: "ws" },
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function freshClient() {
  vi.resetModules()
  return import("./auth-client")
}

/**
 * Module instances imported by earlier tests keep living (listeners, timers,
 * BroadcastChannel) and would react to this module's cross-tab broadcasts,
 * scheduling extra refreshes against the shared fetch mock. Removing
 * BroadcastChannel for the duration of a test isolates the fresh module.
 */
async function withIsolatedBroadcast<T>(fn: () => Promise<T>): Promise<T> {
  const ctor = window.BroadcastChannel
  delete (window as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel
  try {
    return await fn()
  } finally {
    if (ctor) {
      window.BroadcastChannel = ctor
    } else {
      delete (window as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel
    }
  }
}

const fetchMock = () => vi.mocked(globalThis.fetch)

beforeEach(() => {
  fetchMock().mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("auth-client refresh", () => {
  it("shares one in-flight refresh across concurrent callers (single-flight)", async () => {
    const client = await freshClient()
    let resolveFetch: ((r: Response) => void) | null = null
    fetchMock().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const first = client.refreshAccessToken()
    const second = client.refreshAccessToken()
    const third = client.refreshAccessToken()

    // Let microtasks run so all callers attach to the same promise.
    await Promise.resolve()
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    expect(fetchMock()).toHaveBeenCalledWith(
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    )

    resolveFetch!(jsonResponse({ ok: true, session: SESSION }))
    const [a, b, c] = await Promise.all([first, second, third])
    expect(a?.sessionId).toBe("s1")
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(client.getCurrentSession()?.user.email).toBe("a@b.co")
  })

  it("performs a new refresh after the previous one settled (rotation)", async () => {
    const client = await freshClient()
    // A fresh Response per call — bodies cannot be re-read.
    fetchMock().mockImplementation(async () => jsonResponse({ ok: true, session: SESSION }))

    await client.refreshAccessToken()
    await client.refreshAccessToken()
    expect(fetchMock()).toHaveBeenCalledTimes(2)
  })

  it("clears the session and notifies listeners on 401", async () => {
    const client = await freshClient()
    client.acceptSession(SESSION)
    const seen: (ClientSession | null)[] = []
    client.onAuthStateChange((s) => seen.push(s))

    fetchMock().mockResolvedValue(
      jsonResponse({ ok: false, code: "invalid_token", message: "expired" }, 401),
    )
    const result = await client.refreshAccessToken()
    expect(result).toBeNull()
    expect(client.getCurrentSession()).toBeNull()
    expect(seen.at(-1)).toBeNull()
  })

  it("re-arms the refresh timer after a transient failure", async () => {
    vi.useFakeTimers()
    await withIsolatedBroadcast(async () => {
      const client = await freshClient()
      // Expires ~5s after the refresh lead time so the timer fires almost
      // immediately once fake timers advance.
      client.acceptSession({
        ...SESSION,
        expiresAt: new Date(Date.now() + 65_000).toISOString(),
      })

      // First scheduled refresh hits a transient network failure.
      fetchMock().mockRejectedValueOnce(new TypeError("fetch failed"))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetchMock()).toHaveBeenCalledTimes(1)

      // The retry timer must fire and recover the session.
      fetchMock().mockResolvedValueOnce(jsonResponse({ ok: true, session: SESSION }))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(fetchMock()).toHaveBeenCalledTimes(2)
      expect(client.getCurrentSession()?.sessionId).toBe("s1")
    })
  })

  it("does not retry the scheduled refresh after an auth failure", async () => {
    vi.useFakeTimers()
    await withIsolatedBroadcast(async () => {
      const client = await freshClient()
      client.acceptSession({
        ...SESSION,
        expiresAt: new Date(Date.now() + 65_000).toISOString(),
      })

      fetchMock().mockResolvedValue(
        jsonResponse({ ok: false, code: "invalid_token", message: "expired" }, 401),
      )
      await vi.advanceTimersByTimeAsync(60_000)

      expect(fetchMock()).toHaveBeenCalledTimes(1)
      expect(client.getCurrentSession()).toBeNull()
    })
  })

  it("dedupes concurrent loadSession calls", async () => {
    const client = await freshClient()
    fetchMock().mockResolvedValue(jsonResponse({ ok: true, session: SESSION }))

    const [a, b] = await Promise.all([client.loadSession(), client.loadSession()])
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    expect(a?.sessionId).toBe("s1")
    expect(b?.sessionId).toBe("s1")
  })

  it("maps network failures to a network AuthApiError", async () => {
    const client = await freshClient()
    fetchMock().mockRejectedValue(new TypeError("fetch failed"))
    await expect(client.requestPasswordReset("a@b.co")).rejects.toMatchObject({
      name: "AuthApiError",
      code: "network",
    })
  })
})

describe("beginOAuthSignIn returnTo", () => {
  const originalLocation = window.location
  let assignMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assignMock = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: assignMock },
      writable: true,
      configurable: true,
    })
    window.sessionStorage.clear()
    fetchMock().mockResolvedValue(
      jsonResponse({
        provider: "google",
        clientId: "client-id",
        authorizeUrl: "https://accounts.example.com/authorize",
        scopes: ["openid", "email"],
        redirectUri: "http://localhost/oauth/callback",
      }),
    )
  })

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    window.sessionStorage.clear()
  })

  async function storedReturnTo(returnTo?: string): Promise<string | null> {
    const client = await freshClient()
    await client.beginOAuthSignIn({ provider: "google", returnTo })
    expect(assignMock).toHaveBeenCalled()
    const raw = window.sessionStorage.getItem("spindle:oauth-pending")
    return raw ? (JSON.parse(raw) as { returnTo: string }).returnTo : null
  }

  it("keeps an in-app returnTo", async () => {
    expect(await storedReturnTo("/projects/abc?tab=files")).toBe("/projects/abc?tab=files")
  })

  it("defaults to /app when returnTo is omitted", async () => {
    expect(await storedReturnTo()).toBe("/app")
  })

  it.each(["//evil.example.com", "https://evil.example.com", "evil"])(
    "falls back to /app for non-in-app returnTo %s",
    async (returnTo) => {
      expect(await storedReturnTo(returnTo)).toBe("/app")
    },
  )
})
