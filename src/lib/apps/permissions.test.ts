import { describe, expect, it, beforeEach } from "vitest"

import {
  APP_ROLES,
  APP_SCOPES,
  can,
  clearPermissions,
  createGrant,
  createPermissionSet,
  grantedScopes,
  grantScope,
  loadPermissions,
  revokeScope,
  scopeCovers,
  scopesForRole,
  scopesForRoles,
  storageKeyForApp,
  type ScopeGrant,
} from "./permissions"

describe("scopeCovers", () => {
  it("matches exact scopes", () => {
    expect(scopeCovers("files:read", "files:read")).toBe(true)
    expect(scopeCovers("files:read", "files:write")).toBe(false)
  })

  it("supports family wildcards", () => {
    expect(scopeCovers("files:*", "files:read")).toBe(true)
    expect(scopeCovers("files:*", "files:write")).toBe(true)
    expect(scopeCovers("files:*", "profile:read")).toBe(false)
  })

  it("supports the global wildcard", () => {
    expect(scopeCovers("*", "anything:at:all")).toBe(true)
  })
})

describe("role scopes", () => {
  it("higher roles inherit lower scopes", () => {
    const viewer = scopesForRole("viewer")
    const member = scopesForRole("member")
    for (const scope of viewer) expect(member).toContain(scope)
  })

  it("unions scopes across roles", () => {
    const scopes = scopesForRoles(["viewer", "admin"])
    expect(scopes).toContain("files:write")
    expect(scopes).toContain("webhooks:manage")
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  it("every role maps to known scopes", () => {
    for (const role of APP_ROLES) {
      for (const scope of scopesForRole(role)) {
        expect(APP_SCOPES).toContain(scope)
      }
    }
  })
})

describe("can", () => {
  const grant: ScopeGrant = createGrant("files:read", { roles: ["member", "admin"] })

  it("allows when scope, role, and expiry all match", () => {
    expect(can({ appId: "a", grants: [grant] }, "files:read", "member")).toBe(true)
  })

  it("denies roles not listed on the grant", () => {
    expect(can({ appId: "a", grants: [grant] }, "files:read", "viewer")).toBe(false)
    expect(can({ appId: "a", grants: [grant] }, "files:read", "owner")).toBe(false)
  })

  it("treats missing roles as all roles", () => {
    const open = createGrant("files:read")
    for (const role of APP_ROLES) {
      expect(can([open], "files:read", role)).toBe(true)
    }
  })

  it("denies expired grants", () => {
    const expired = createGrant("files:read", { expiresInMs: 1000, now: 1000 })
    expect(can([expired], "files:read", "member", 2000)).toBe(false)
    expect(can([expired], "files:read", "member", 1500)).toBe(true)
  })

  it("denies when nothing grants the scope", () => {
    expect(can({ appId: "a", grants: [grant] }, "agent:run", "admin")).toBe(false)
    expect(can(null, "files:read", "member")).toBe(false)
    expect(can(undefined, "files:read", "member")).toBe(false)
    expect(can([], "files:read", "member")).toBe(false)
  })

  it("respects wildcards through can()", () => {
    const wildcard = createGrant("files:*")
    expect(can([wildcard], "files:write", "viewer")).toBe(true)
  })
})

describe("persistence", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("round-trips a permission set", () => {
    const set = createPermissionSet("my-app", ["files:read", "analytics:read"])
    grantScope("my-app", set.grants[0])
    grantScope("my-app", set.grants[1])

    const loaded = loadPermissions("my-app")
    expect(loaded?.appId).toBe("my-app")
    expect(grantedScopes(loaded)).toEqual(["files:read", "analytics:read"])
  })

  it("uses a per-app storage key", () => {
    expect(storageKeyForApp("demo")).toBe("spindle.apps.permissions.demo")
    grantScope("demo", createGrant("files:read"))
    expect(window.localStorage.getItem("spindle.apps.permissions.demo")).toBeTruthy()
    expect(loadPermissions("other")).toBeNull()
  })

  it("replaces an existing grant for the same scope", () => {
    grantScope("app", createGrant("files:read", { roles: ["member"] }))
    grantScope("app", createGrant("files:read", { roles: ["admin"] }))
    const loaded = loadPermissions("app")
    expect(loaded?.grants).toHaveLength(1)
    expect(loaded?.grants[0].roles).toEqual(["admin"])
  })

  it("revokes a single scope", () => {
    grantScope("app", createGrant("files:read"))
    grantScope("app", createGrant("files:write"))
    revokeScope("app", "files:read")
    const loaded = loadPermissions("app")
    expect(grantedScopes(loaded)).toEqual(["files:write"])
  })

  it("clears permissions", () => {
    grantScope("app", createGrant("files:read"))
    clearPermissions("app")
    expect(loadPermissions("app")).toBeNull()
    expect(window.localStorage.getItem(storageKeyForApp("app"))).toBeNull()
  })

  it("returns null for corrupt storage", () => {
    window.localStorage.setItem(storageKeyForApp("app"), "{not json")
    expect(loadPermissions("app")).toBeNull()
    window.localStorage.setItem(storageKeyForApp("app"), JSON.stringify({ grants: "nope" }))
    expect(loadPermissions("app")).toBeNull()
  })

  it("honours an injected storage", () => {
    const memory = new Map<string, string>()
    const fakeStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
      key: () => null,
      length: 0,
    } as Storage

    grantScope("app", createGrant("files:read"), fakeStorage)
    expect(loadPermissions("app", fakeStorage)?.grants).toHaveLength(1)
    expect(loadPermissions("app")).toBeNull()
  })
})
