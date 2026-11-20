import { z } from "zod"

import type { WorkspaceMemberInfo } from "@/lib/auth/backend"

/**
 * SCIM 2.0 protocol helpers — pure functions, no I/O.
 *
 * This implements the subset of RFC 7643/7644 an IdP actually needs for
 * user provisioning against this API:
 *  - User resources in/out ({@link userToScim}, {@link parseScimUser})
 *  - ListResponse envelopes ({@link buildListResponse})
 *  - Error envelopes ({@link buildScimError})
 *  - Filter parsing limited to `userName eq "value"` ({@link parseScimFilter})
 *  - PATCH bodies limited to `active` toggles (parsed in the route layer)
 *
 * Everything else — groups, bulk, sorting, complex filters — is intentionally
 * unsupported and reported honestly via {@link buildServiceProviderConfig}.
 */

export const SCIM_SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User"
export const SCIM_SCHEMA_LIST_RESPONSE = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
export const SCIM_SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error"
export const SCIM_SCHEMA_PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
export const SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"

/** Base path IdPs are configured with; `meta.location` values derive from it. */
export const SCIM_BASE_PATH = "/api/scim/v2"

// ---------------------------------------------------------------------------
// User resources
// ---------------------------------------------------------------------------

export type ScimEmail = {
  value: string
  type?: string
  primary?: boolean
}

export type ScimUserResource = {
  schemas: string[]
  id: string
  userName: string
  emails: ScimEmail[]
  name: { formatted?: string }
  /**
   * SCIM `active` maps to workspace membership: a member is active, a
   * deprovisioned user is removed from the roster entirely (there is no
   * persisted "inactive member" state in the backend).
   */
  active: boolean
  meta: {
    resourceType: "User"
    created: string
    location: string
  }
}

/** Renders one workspace member as a SCIM User resource. */
export function userToScim(
  member: WorkspaceMemberInfo,
  basePath: string = SCIM_BASE_PATH,
): ScimUserResource {
  const { user } = member
  const name = user.name?.trim()
  return {
    schemas: [SCIM_SCHEMA_USER],
    id: user.id,
    userName: user.email,
    emails: [{ value: user.email, type: "work", primary: true }],
    name: name ? { formatted: name } : {},
    active: true,
    meta: {
      resourceType: "User",
      created: user.createdAt,
      location: `${basePath}/Users/${encodeURIComponent(user.id)}`,
    },
  }
}

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

const scimEmailSchema = z.looseObject({
  value: z.string().trim().min(1).max(320),
  type: z.string().max(40).optional(),
  primary: z.boolean().optional(),
})

const scimNameSchema = z
  .looseObject({
    formatted: z.string().trim().max(200).optional(),
    givenName: z.string().trim().max(100).optional(),
    familyName: z.string().trim().max(100).optional(),
  })
  .nullable()
  .optional()

/**
 * Validates an inbound SCIM User (POST /Users). Unknown attributes are
 * allowed (SCIM clients send many we ignore) but the fields we consume are
 * strictly typed. Returns the normalised provisioning input.
 */
const scimUserBodySchema = z.looseObject({
  userName: z.string().trim().min(1).max(320),
  emails: z.array(scimEmailSchema).max(20).optional(),
  name: scimNameSchema,
  active: z.boolean().optional(),
})

export type ParsedScimUser = {
  userName: string
  /** Resolved email — required because accounts are keyed by email. */
  email: string
  /** Display name derived from `name` or null when absent. */
  displayName: string | null
}

export type ParseScimUserResult = { ok: true; data: ParsedScimUser } | { ok: false; detail: string }

function pickScimEmail(
  userName: string,
  emails: z.infer<typeof scimEmailSchema>[] | undefined,
): string | null {
  if (emails && emails.length > 0) {
    const ordered = [...emails].sort(
      (a, b) => Number(b.primary === true) - Number(a.primary === true),
    )
    for (const entry of ordered) {
      if (entry.value.includes("@")) return entry.value.toLowerCase()
    }
  }
  // Many IdPs send the email as userName with no emails[] member.
  return userName.includes("@") ? userName.toLowerCase() : null
}

export function parseScimUser(body: unknown): ParseScimUserResult {
  const parsed = scimUserBodySchema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      detail: parsed.error.issues[0]?.message ?? "Invalid SCIM User resource.",
    }
  }
  const { userName, emails, name } = parsed.data
  const email = pickScimEmail(userName, emails)
  if (!email) {
    return {
      ok: false,
      detail: "A valid email is required (emails[] or an email-shaped userName).",
    }
  }
  const displayName =
    name?.formatted?.trim() ||
    [name?.givenName, name?.familyName].filter(Boolean).join(" ").trim() ||
    null
  return { ok: true, data: { userName, email, displayName } }
}

// ---------------------------------------------------------------------------
// Filters — documented subset
// ---------------------------------------------------------------------------

/**
 * Filter support is intentionally minimal: only `userName eq "value"`
 * (attribute name case-insensitive, single or double quotes). Anything else
 * returns `{ kind: "unsupported" }` so the route can answer 400 rather than
 * silently returning unfiltered results — a wrong answer here would leak
 * the whole roster to a client that thinks it filtered.
 */
export type ScimFilterResult =
  { kind: "none" } | { kind: "userName"; value: string } | { kind: "unsupported" }

const USERNAME_EQ_PATTERN = /^\s*userName\s+eq\s+["']([^"']*)["']\s*$/i

export function parseScimFilter(raw: string | null | undefined): ScimFilterResult {
  const filter = raw?.trim()
  if (!filter) return { kind: "none" }
  const match = USERNAME_EQ_PATTERN.exec(filter)
  if (!match) return { kind: "unsupported" }
  return { kind: "userName", value: match[1] }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type ScimListResponse<T = ScimUserResource> = {
  schemas: string[]
  totalResults: number
  startIndex: number
  itemsPerPage: number
  Resources: T[]
}

/**
 * Builds a SCIM ListResponse. `startIndex` is 1-based per RFC 7644; the
 * caller is responsible for having already sliced `resources` to the page.
 */
export function buildListResponse<T>(
  resources: T[],
  options: { startIndex: number; totalResults: number },
): ScimListResponse<T> {
  return {
    schemas: [SCIM_SCHEMA_LIST_RESPONSE],
    totalResults: options.totalResults,
    startIndex: options.startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  }
}

export type ScimErrorResource = {
  schemas: string[]
  status: string
  detail: string
}

export function buildScimError(status: number, detail: string): ScimErrorResource {
  return {
    schemas: [SCIM_SCHEMA_ERROR],
    status: String(status),
    detail,
  }
}

// ---------------------------------------------------------------------------
// PATCH bodies — documented subset
// ---------------------------------------------------------------------------

const patchOperationSchema = z.looseObject({
  op: z.string().trim().min(1).max(20),
  path: z.string().trim().max(200).optional(),
  value: z.unknown().optional(),
})

export const scimPatchOpSchema = z.looseObject({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(patchOperationSchema).min(1).max(100),
})

export type ScimPatchOp = z.infer<typeof scimPatchOpSchema>

/**
 * Extracts the effective `active` value from a PatchOp body, if present.
 *
 * Supported forms (everything else is ignored by design):
 *  - `{ op: "replace"|"add", path: "active", value: true|false }`
 *  - `{ op: "replace"|"add", value: { active: true|false } }` (path omitted)
 *
 * The LAST applicable operation wins, matching PATCH semantics. Returns
 * `undefined` when no operation targets `active`.
 */
export function extractActiveFromPatch(
  operations: ScimPatchOp["Operations"],
): { found: true; active: boolean } | { found: false } {
  let result: { found: true; active: boolean } | { found: false } = { found: false }
  for (const operation of operations) {
    const op = operation.op.toLowerCase()
    if (op !== "replace" && op !== "add") continue

    let candidate: unknown
    if (operation.path !== undefined) {
      if (operation.path.trim().toLowerCase() !== "active") continue
      candidate = operation.value
    } else if (
      operation.value !== null &&
      typeof operation.value === "object" &&
      !Array.isArray(operation.value)
    ) {
      candidate = (operation.value as Record<string, unknown>).active
      if (candidate === undefined) continue
    } else {
      continue
    }

    if (typeof candidate === "boolean") {
      result = { found: true, active: candidate }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// ServiceProviderConfig — honest capability declaration
// ---------------------------------------------------------------------------

export function buildServiceProviderConfig(location: string) {
  return {
    schemas: [SCIM_SCHEMA_SERVICE_PROVIDER_CONFIG],
    patch: { supported: true },
    sort: { supported: false },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    bulk: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Bearer Token",
        description:
          "Workspace SCIM token issued under /api/workspaces/[id]/scim-tokens. Send as 'Authorization: Bearer <token>'.",
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location,
    },
  }
}
