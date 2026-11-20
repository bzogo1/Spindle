// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { WorkspaceMemberInfo } from "@/lib/auth/backend"
import {
  buildListResponse,
  buildScimError,
  buildServiceProviderConfig,
  extractActiveFromPatch,
  parseScimFilter,
  parseScimUser,
  scimPatchOpSchema,
  userToScim,
  SCIM_SCHEMA_ERROR,
  SCIM_SCHEMA_LIST_RESPONSE,
  SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG,
  SCIM_SCHEMA_USER,
} from "@/lib/scim"

const member: WorkspaceMemberInfo = {
  user: {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  role: "admin",
}

describe("userToScim", () => {
  it("renders a member as a SCIM User resource", () => {
    const user = userToScim(member)
    expect(user).toMatchObject({
      schemas: [SCIM_SCHEMA_USER],
      id: "user-1",
      userName: "ada@example.com",
      emails: [{ value: "ada@example.com", type: "work", primary: true }],
      name: { formatted: "Ada Lovelace" },
      active: true,
      meta: {
        resourceType: "User",
        created: "2026-01-01T00:00:00.000Z",
        location: "/api/scim/v2/Users/user-1",
      },
    })
  })

  it("omits name.formatted and URL-encodes the id in meta.location", () => {
    const anonymous: WorkspaceMemberInfo = {
      user: { ...member.user, id: "u/1", name: null },
      role: "member",
    }
    const user = userToScim(anonymous, "/scim")
    expect(user.name).toEqual({})
    expect(user.meta.location).toBe("/scim/Users/u%2F1")
  })
})

describe("parseScimUser", () => {
  it("parses a minimal body with userName only", () => {
    const result = parseScimUser({ userName: "New@Example.com" })
    expect(result).toEqual({
      ok: true,
      data: { userName: "New@Example.com", email: "new@example.com", displayName: null },
    })
  })

  it("prefers the primary email over userName", () => {
    const result = parseScimUser({
      userName: "not-an-email",
      emails: [
        { value: "other@example.com", primary: false },
        { value: "Primary@Example.com", primary: true },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe("primary@example.com")
  })

  it("falls back to a non-primary email when userName is not an email", () => {
    const result = parseScimUser({
      userName: "ada",
      emails: [{ value: "ada@example.com" }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe("ada@example.com")
  })

  it("builds displayName from formatted or given+family names", () => {
    const formatted = parseScimUser({
      userName: "a@b.co",
      name: { formatted: "  Ada Lovelace  ", givenName: "Ignored" },
    })
    expect(formatted.ok && formatted.data.displayName).toBe("Ada Lovelace")

    const parts = parseScimUser({
      userName: "a@b.co",
      name: { givenName: "Ada", familyName: "Lovelace" },
    })
    expect(parts.ok && parts.data.displayName).toBe("Ada Lovelace")
  })

  it("rejects bodies without a resolvable email", () => {
    const noEmail = parseScimUser({ userName: "not-an-email" })
    expect(noEmail.ok).toBe(false)

    const badShape = parseScimUser({ userName: 42 })
    expect(badShape.ok).toBe(false)

    const nonObject = parseScimUser("nope")
    expect(nonObject.ok).toBe(false)
  })

  it("ignores unknown attributes but rejects wrong-typed known ones", () => {
    const ok = parseScimUser({
      userName: "a@b.co",
      schemas: [SCIM_SCHEMA_USER],
      externalId: "ext-1",
      active: true,
    })
    expect(ok.ok).toBe(true)

    const bad = parseScimUser({ userName: "a@b.co", active: "yes" })
    expect(bad.ok).toBe(false)
  })
})

describe("parseScimFilter", () => {
  it("returns none for empty/missing filters", () => {
    expect(parseScimFilter(null)).toEqual({ kind: "none" })
    expect(parseScimFilter("")).toEqual({ kind: "none" })
    expect(parseScimFilter("   ")).toEqual({ kind: "none" })
  })

  it("parses userName eq with single or double quotes, case-insensitive", () => {
    expect(parseScimFilter('userName eq "ada@example.com"')).toEqual({
      kind: "userName",
      value: "ada@example.com",
    })
    expect(parseScimFilter(" UserName EQ 'ada@example.com' ")).toEqual({
      kind: "userName",
      value: "ada@example.com",
    })
  })

  it("rejects every other filter shape as unsupported", () => {
    for (const filter of [
      'emails eq "a@b.co"',
      'userName co "ada"',
      'userName eq "a" and userName eq "b"',
      'name.formatted eq "Ada"',
      "userName eq ada@example.com",
    ]) {
      expect(parseScimFilter(filter)).toEqual({ kind: "unsupported" })
    }
  })
})

describe("buildListResponse / buildScimError", () => {
  it("builds a ListResponse envelope with correct counts", () => {
    const resources = [userToScim(member)]
    const response = buildListResponse(resources, { startIndex: 1, totalResults: 42 })
    expect(response).toEqual({
      schemas: [SCIM_SCHEMA_LIST_RESPONSE],
      totalResults: 42,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: resources,
    })
  })

  it("builds an Error resource with string status", () => {
    expect(buildScimError(404, "User not found.")).toEqual({
      schemas: [SCIM_SCHEMA_ERROR],
      status: "404",
      detail: "User not found.",
    })
  })
})

describe("scimPatchOpSchema / extractActiveFromPatch", () => {
  const ops = (operations: unknown[]) =>
    scimPatchOpSchema.parse({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: operations,
    }).Operations

  it("extracts active from path-targeted replace/add", () => {
    const operations = ops([
      { op: "replace", path: "active", value: false },
      { op: "add", path: "Active", value: true },
    ])
    // Last applicable op wins.
    expect(extractActiveFromPatch(operations)).toEqual({ found: true, active: true })
  })

  it("extracts active from a value-object operation without a path", () => {
    const operations = ops([{ op: "replace", value: { active: false } }])
    expect(extractActiveFromPatch(operations)).toEqual({ found: true, active: false })
  })

  it("ignores remove ops, other paths, and non-boolean values", () => {
    const operations = ops([
      { op: "remove", path: "active" },
      { op: "replace", path: "displayName", value: "x" },
      { op: "replace", path: "active", value: "yes" },
      { op: "replace", value: { displayName: "x" } },
    ])
    expect(extractActiveFromPatch(operations)).toEqual({ found: false })
  })

  it("rejects malformed PatchOp bodies", () => {
    expect(scimPatchOpSchema.safeParse({ Operations: [] }).success).toBe(false)
    expect(scimPatchOpSchema.safeParse({}).success).toBe(false)
    expect(scimPatchOpSchema.safeParse(null).success).toBe(false)
  })
})

describe("buildServiceProviderConfig", () => {
  it("declares the honest capability set", () => {
    const config = buildServiceProviderConfig("/api/scim/v2/ServiceProviderConfig")
    expect(config.schemas).toEqual([SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG])
    expect(config.patch).toEqual({ supported: true })
    expect(config.bulk).toEqual({ supported: false })
    expect(config.filter).toEqual({ supported: true, maxResults: 200 })
    expect(config.changePassword).toEqual({ supported: false })
    expect(config.sort).toEqual({ supported: false })
    expect(config.etag).toEqual({ supported: false })
    expect(config.authenticationSchemes).toHaveLength(1)
    expect(config.authenticationSchemes[0].type).toBe("oauthbearertoken")
    expect(config.meta.location).toBe("/api/scim/v2/ServiceProviderConfig")
  })
})
