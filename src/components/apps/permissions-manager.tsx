"use client"

import { useCallback, useEffect, useState } from "react"

import {
  APP_ROLES,
  APP_SCOPES,
  can,
  clearPermissions,
  createGrant,
  grantScope,
  loadPermissions,
  revokeScope,
  type AppPermissionSet,
  type AppRole,
} from "@/lib/apps/permissions"

export interface PermissionsManagerProps {
  appId: string
  /** Role used for the "effective access" preview column. */
  previewRole?: AppRole
}

const EXPIRY_OPTIONS: { label: string; expiresInMs?: number }[] = [
  { label: "No expiry" },
  { label: "7 days", expiresInMs: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", expiresInMs: 30 * 24 * 60 * 60 * 1000 },
]

/**
 * Demo permissions manager: lists every known scope, lets a reviewer grant or
 * revoke it (with optional role restriction and expiry), and previews what a
 * given role can actually do via `can()`.
 */
export function PermissionsManager({ appId, previewRole = "member" }: PermissionsManagerProps) {
  const [permissions, setPermissions] = useState<AppPermissionSet | null>(null)
  const [expiryIndex, setExpiryIndex] = useState(0)
  const [roleFilter, setRoleFilter] = useState<AppRole | "all">("all")

  const reload = useCallback(() => {
    setPermissions(loadPermissions(appId))
  }, [appId])

  useEffect(() => {
    reload()
  }, [reload])

  function handleGrant(scope: string) {
    const expiry = EXPIRY_OPTIONS[expiryIndex]
    grantScope(
      appId,
      createGrant(scope, {
        roles: roleFilter === "all" ? undefined : [roleFilter],
        expiresInMs: expiry.expiresInMs,
      }),
    )
    reload()
  }

  function handleRevoke(scope: string) {
    revokeScope(appId, scope)
    reload()
  }

  function handleClear() {
    clearPermissions(appId)
    reload()
  }

  return (
    <div className="permissions-manager">
      <div className="permissions-manager-controls">
        <label>
          Grant to role{" "}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as AppRole | "all")}
          >
            <option value="all">All roles</option>
            {APP_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expiry{" "}
          <select value={expiryIndex} onChange={(e) => setExpiryIndex(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--ghost" onClick={handleClear}>
          Clear all grants
        </button>
      </div>

      <table className="permissions-table">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Granted to</th>
            <th>{previewRole} can use?</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {APP_SCOPES.map((scope) => {
            const grant = permissions?.grants.find((g) => g.scope === scope)
            const allowed = can(permissions, scope, previewRole)
            return (
              <tr key={scope}>
                <td>
                  <code>{scope}</code>
                </td>
                <td>
                  {grant ? (
                    <span>
                      {grant.roles ? grant.roles.join(", ") : "all roles"}
                      {grant.expiresAt
                        ? ` · expires ${new Date(grant.expiresAt).toLocaleDateString()}`
                        : ""}
                    </span>
                  ) : (
                    <span className="permissions-none">—</span>
                  )}
                </td>
                <td>{allowed ? "yes" : "no"}</td>
                <td>
                  {grant ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => handleRevoke(scope)}
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => handleGrant(scope)}
                    >
                      Grant
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
