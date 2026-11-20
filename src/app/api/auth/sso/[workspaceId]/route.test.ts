// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MemoryLoginAlertStore, setLoginAlertStoreForTests } from "@/lib/auth/login-alerts"
import { devAssertionSecret, signDevAssertion } from "@/lib/workspace-sso-protocol"
import { resetWorkspaceSsoForTests, updateWorkspaceSsoConfig } from "@/lib/workspace-sso"
import { resetWorkspaceSettingsForTests, updateWorkspaceSettings } from "@/lib/workspace-settings"

const getWorkspace = vi.fn()
const upsertOAuthUser = vi.fn()
const addWorkspaceMember = vi.fn()
const createSessionForUser = vi.fn()
const mockOAuthEnabled = vi.fn(() => true)

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getWorkspace,
      upsertOAuthUser,
      addWorkspaceMember,
      createSessionForUser,
    }),
  }
})

vi.mock("@/lib/auth/oauth-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/oauth-providers")>()
  return {
    ...actual,
    mockOAuthEnabled: () => mockOAuthEnabled(),
  }
})

import { GET, POST } from "./route"

const WORKSPACE_ID = "ws-1"
const ENTITY_ID = "https://idp.example.com/entity"
const SSO_URL = "https://idp.example.com/sso"

const workspace = { id: WORKSPACE_ID, name: "Research team", slug: "research-team" }

const authUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const tokenPair = {
  accessToken: "access.jwt",
  refreshToken: "refresh.token",
  session: {
    user: authUser,
    workspace: { name: "Research team", slug: "research-team" },
    sessionId: "sess_1",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
}

let ipCounter = 0
function call(
  method: "GET" | "POST",
  options: { body?: unknown; origin?: string; workspaceId?: string } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.0.${++ipCounter}`,
  }
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  if (options.origin) headers.origin = options.origin
  const request = new Request(
    `http://localhost/api/auth/sso/${options.workspaceId ?? WORKSPACE_ID}`,
    init,
  )
  const params = Promise.resolve({ workspaceId: options.workspaceId ?? WORKSPACE_ID })
  return method === "GET" ? GET(request, { params }) : POST(request, { params })
}

function enableSso(provider: "saml" | "oidc" = "saml", extra: Record<string, unknown> = {}) {
  updateWorkspaceSsoConfig(WORKSPACE_ID, {
    enabled: true,
    provider,
    entityId: ENTITY_ID,
    ssoUrl: SSO_URL,
    ...extra,
  })
}

function validAssertion(overrides: Record<string, unknown> = {}) {
  const input = {
    workspaceId: WORKSPACE_ID,
    email: "ada@example.com",
    name: "Ada",
    secret: devAssertionSecret(WORKSPACE_ID, ENTITY_ID),
    ...overrides,
  }
  return {
    email: input.email as string,
    name: input.name as string,
    assertion: signDevAssertion({
      workspaceId: input.workspaceId as string,
      email: input.email as string,
      name: input.name as string,
      secret: input.secret as string,
    }),
  }
}

let alertStore: MemoryLoginAlertStore

beforeEach(() => {
  getWorkspace.mockReset().mockResolvedValue(workspace)
  upsertOAuthUser.mockReset().mockResolvedValue({ user: authUser, created: true })
  addWorkspaceMember.mockReset().mockResolvedValue({ workspace, role: "member" })
  createSessionForUser.mockReset().mockResolvedValue(tokenPair)
  mockOAuthEnabled.mockReset().mockReturnValue(true)
  resetWorkspaceSsoForTests()
  resetWorkspaceSettingsForTests()
  alertStore = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(alertStore)
})

describe("GET /api/auth/sso/[workspaceId]", () => {
  it("returns 404 when SSO is not configured or disabled", async () => {
    expect((await call("GET")).status).toBe(404)

    updateWorkspaceSsoConfig(WORKSPACE_ID, { enabled: false, provider: "saml" })
    expect((await call("GET")).status).toBe(404)
  })

  it("returns an SAML redirect URL with devMode flag", async () => {
    enableSso("saml")

    const response = await call("GET")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.devMode).toBe(true)
    expect(body.provider).toBe("saml")

    const url = new URL(body.redirectUrl)
    expect(url.origin + url.pathname).toBe(SSO_URL)
    expect(url.searchParams.get("SAMLRequest")).toBeTruthy()
    expect(url.searchParams.get("RelayState")).toBe(WORKSPACE_ID)
  })

  it("returns an OIDC authorize URL with state", async () => {
    enableSso("oidc")

    const response = await call("GET")
    const body = await response.json()
    const url = new URL(body.redirectUrl)
    expect(url.searchParams.get("client_id")).toBe(ENTITY_ID)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("state")).toBe(body.state)
  })

  it("returns 503 when the provider is set but URLs are missing", async () => {
    updateWorkspaceSsoConfig(WORKSPACE_ID, {
      enabled: true,
      provider: "saml",
      entityId: "",
      ssoUrl: "",
    })
    const response = await call("GET")
    expect(response.status).toBe(503)
  })
})

describe("POST /api/auth/sso/[workspaceId]", () => {
  beforeEach(() => {
    enableSso("saml", { allowedDomains: ["example.com"] })
  })

  it("rejects cross-origin requests", async () => {
    const response = await call("POST", {
      body: validAssertion(),
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("returns 404 when mock auth is disabled (dev assertion gate)", async () => {
    mockOAuthEnabled.mockReturnValue(false)
    const response = await call("POST", { body: validAssertion() })
    expect(response.status).toBe(404)
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("returns 404 when SSO is not configured", async () => {
    resetWorkspaceSsoForTests()
    const response = await call("POST", { body: validAssertion() })
    expect(response.status).toBe(404)
  })

  it("rejects malformed bodies and bad assertion formats", async () => {
    expect((await call("POST", { body: "not-json{" })).status).toBe(400)
    expect((await call("POST", { body: { email: "a@b.c" } })).status).toBe(400)
    expect((await call("POST", { body: { ...validAssertion(), assertion: "zz" } })).status).toBe(
      400,
    )
  })

  it("returns generic 401 for a bad assertion (no enumeration)", async () => {
    const response = await call("POST", {
      body: { ...validAssertion(), assertion: "0".repeat(64) },
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "sso_login_failed" })
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("returns generic 401 when the email domain is not allowlisted", async () => {
    const response = await call("POST", {
      body: validAssertion({
        workspaceId: WORKSPACE_ID,
        email: "mallory@evil.example",
        name: "Mallory",
        secret: devAssertionSecret(WORKSPACE_ID, ENTITY_ID),
      }),
    })
    expect(response.status).toBe(401)
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("logs in, joins the workspace, and sets auth cookies", async () => {
    const response = await call("POST", { body: validAssertion() })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.session).toBeDefined()

    expect(upsertOAuthUser).toHaveBeenCalledWith({
      email: "ada@example.com",
      name: "Ada",
      provider: "saml",
    })
    expect(addWorkspaceMember).toHaveBeenCalledWith({
      userId: authUser.id,
      workspace,
      role: "member",
    })
    expect(createSessionForUser).toHaveBeenCalledWith(authUser.id)

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("spindle_at=")
    expect(setCookie).toContain("spindle_rt=")
  })

  it("uses the workspace defaultJoinRole when set to admin", async () => {
    updateWorkspaceSettings(WORKSPACE_ID, { defaultJoinRole: "admin" })

    const response = await call("POST", { body: validAssertion() })
    expect(response.status).toBe(200)
    expect(addWorkspaceMember).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }))
  })

  it("skips the domain check when allowedDomains is empty", async () => {
    updateWorkspaceSsoConfig(WORKSPACE_ID, { allowedDomains: [] })

    const response = await call("POST", {
      body: validAssertion({
        workspaceId: WORKSPACE_ID,
        email: "anyone@other.dev",
        name: "Any",
        secret: devAssertionSecret(WORKSPACE_ID, ENTITY_ID),
      }),
    })
    expect(response.status).toBe(200)
  })

  it("returns 404 when the workspace does not exist", async () => {
    getWorkspace.mockResolvedValue(null)
    const response = await call("POST", { body: validAssertion() })
    expect(response.status).toBe(404)
  })
})
