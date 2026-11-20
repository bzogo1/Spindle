/**
 * App permissions model for third-party-style apps running against Spindle.
 *
 * An app requests *scopes* (e.g. `files:read`). Each scope can be granted to
 * specific workspace roles and optionally expires. Grants are persisted in
 * `localStorage` so the playground and developer portal can demonstrate the
 * flow without a backend.
 */

export const APP_SCOPES = [
  "profile:read",
  "profile:write",
  "files:read",
  "files:write",
  "workspaces:read",
  "workspaces:write",
  "analytics:read",
  "analytics:write",
  "notifications:read",
  "agent:run",
  "webhooks:manage",
] as const

export type AppScope = (typeof APP_SCOPES)[number]

export const APP_ROLES = ["viewer", "member", "admin", "owner"] as const
export type AppRole = (typeof APP_ROLES)[number]

/** Scopes each role may hold. Higher roles inherit lower roles' scopes. */
export const ROLE_SCOPES: Record<AppRole, readonly AppScope[]> = {
  viewer: ["profile:read", "files:read", "workspaces:read", "analytics:read"],
  member: [
    "profile:read",
    "profile:write",
    "files:read",
    "files:write",
    "workspaces:read",
    "workspaces:write",
    "analytics:read",
    "analytics:write",
    "notifications:read",
  ],
  admin: [
    "profile:read",
    "profile:write",
    "files:read",
    "files:write",
    "workspaces:read",
    "workspaces:write",
    "analytics:read",
    "analytics:write",
    "notifications:read",
    "agent:run",
    "webhooks:manage",
  ],
  owner: [
    "profile:read",
    "profile:write",
    "files:read",
    "files:write",
    "workspaces:read",
    "workspaces:write",
    "analytics:read",
    "analytics:write",
    "notifications:read",
    "agent:run",
    "webhooks:manage",
  ],
}

export interface ScopeGrant {
  /** Exact scope (`files:read`), family wildcard (`files:*`), or `*`. */
  scope: string
  /** Roles allowed to use this grant. Omit to allow every role. */
  roles?: AppRole[]
  grantedAt: string
  /** ISO timestamp after which the grant no longer applies. */
  expiresAt?: string
}

export interface AppPermissionSet {
  appId: string
  grants: ScopeGrant[]
}

export interface GrantOptions {
  roles?: AppRole[]
  /** Milliseconds from now until expiry. Omit for a non-expiring grant. */
  expiresInMs?: number
  now?: number
}

const STORAGE_PREFIX = "spindle.apps.permissions."

export function storageKeyForApp(appId: string): string {
  return `${STORAGE_PREFIX}${appId}`
}

/** All scopes a single role may be granted. */
export function scopesForRole(role: AppRole): AppScope[] {
  return [...ROLE_SCOPES[role]]
}

/** Union of scopes across the given roles. */
export function scopesForRoles(roles: readonly AppRole[]): AppScope[] {
  const seen = new Set<AppScope>()
  for (const role of roles) {
    for (const scope of ROLE_SCOPES[role]) seen.add(scope)
  }
  return [...seen]
}

/** True when `granted` covers `required` (exact, family wildcard, or `*`). */
export function scopeCovers(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true
  if (granted.endsWith(":*")) {
    return required.startsWith(granted.slice(0, -1))
  }
  return false
}

function grantIsActive(grant: ScopeGrant, now: number): boolean {
  if (!grant.expiresAt) return true
  const expiry = Date.parse(grant.expiresAt)
  return Number.isFinite(expiry) && expiry > now
}

function grantAppliesToRole(grant: ScopeGrant, role: AppRole): boolean {
  return !grant.roles || grant.roles.includes(role)
}

/**
 * Core authorization check. `permissions` may be a full permission set or a
 * bare grant list; `now` is a millisecond timestamp (defaults to `Date.now()`).
 */
export function can(
  permissions: AppPermissionSet | ScopeGrant[] | null | undefined,
  scope: string,
  role: AppRole,
  now: number = Date.now(),
): boolean {
  if (!permissions) return false
  const grants = Array.isArray(permissions) ? permissions : permissions.grants
  return grants.some(
    (grant) =>
      grantIsActive(grant, now) &&
      grantAppliesToRole(grant, role) &&
      scopeCovers(grant.scope, scope),
  )
}

export function createGrant(scope: string, options: GrantOptions = {}): ScopeGrant {
  const now = options.now ?? Date.now()
  const grant: ScopeGrant = {
    scope,
    grantedAt: new Date(now).toISOString(),
  }
  if (options.roles && options.roles.length > 0) grant.roles = [...options.roles]
  if (options.expiresInMs !== undefined && options.expiresInMs > 0) {
    grant.expiresAt = new Date(now + options.expiresInMs).toISOString()
  }
  return grant
}

export function createPermissionSet(
  appId: string,
  scopes: readonly string[],
  options: GrantOptions = {},
): AppPermissionSet {
  return {
    appId,
    grants: scopes.map((scope) => createGrant(scope, options)),
  }
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage
  return null
}

/** Load the persisted permission set for an app, or null when none exists. */
export function loadPermissions(appId: string, storage?: Storage): AppPermissionSet | null {
  const store = getStorage(storage)
  if (!store) return null
  try {
    const raw = store.getItem(storageKeyForApp(appId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as AppPermissionSet
    if (!parsed || !Array.isArray(parsed.grants)) return null
    return { appId: parsed.appId ?? appId, grants: parsed.grants }
  } catch {
    return null
  }
}

function persist(appId: string, set: AppPermissionSet, storage?: Storage): AppPermissionSet {
  const store = getStorage(storage)
  if (store) {
    try {
      store.setItem(storageKeyForApp(appId), JSON.stringify(set))
    } catch {
      // Storage may be full or unavailable; the in-memory set still works.
    }
  }
  return set
}

/**
 * Add or replace a grant. A grant with the same `scope` replaces the previous
 * one so re-granting can change roles or expiry.
 */
export function grantScope(appId: string, grant: ScopeGrant, storage?: Storage): AppPermissionSet {
  const existing = loadPermissions(appId, storage)
  const grants = (existing?.grants ?? []).filter((g) => g.scope !== grant.scope)
  grants.push(grant)
  return persist(appId, { appId, grants }, storage)
}

export function revokeScope(appId: string, scope: string, storage?: Storage): AppPermissionSet {
  const existing = loadPermissions(appId, storage)
  const grants = (existing?.grants ?? []).filter((g) => g.scope !== scope)
  return persist(appId, { appId, grants }, storage)
}

export function clearPermissions(appId: string, storage?: Storage): void {
  const store = getStorage(storage)
  if (!store) return
  try {
    store.removeItem(storageKeyForApp(appId))
  } catch {
    // ignore
  }
}

/** Scopes granted to at least one role, for display in review tooling. */
export function grantedScopes(set: AppPermissionSet | null): string[] {
  if (!set) return []
  return set.grants.map((grant) => grant.scope)
}
