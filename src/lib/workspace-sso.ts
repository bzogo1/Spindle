import { z } from "zod"

/**
 * Workspace SSO configuration — DEVELOPMENT seam.
 *
 * In-memory, per-process store for workspace SSO *settings only*. Like
 * {@link MemoryAuthBackend} and {@link workspace-settings} this loses state
 * on restart; production MUST persist these rows.
 *
 * IMPORTANT — CONFIGURATION STORAGE ONLY: this module stores provider
 * settings (entity ID, SSO URL, domains, enforcement flag). It does NOT
 * implement SAML or OIDC protocol flows, assertion validation, signature
 * checks, or any login redirection — those are deferred to later tasks.
 * Nothing here authenticates anyone; `enabled`/`enforced` are inert flags
 * until the protocol layer lands.
 *
 * SECRET HYGIENE: this store must NEVER hold private keys, signing
 * certificates, client secrets, or assertion material. The certificate
 * fields below are deliberately limited to a boolean "configured" flag and
 * a non-secret fingerprint suffix (last 4 chars) used purely for display
 * ("is a certificate on file, and which one roughly"). If a future feature
 * needs real material it belongs in a secrets store, not here.
 */

const MAX_URL_LENGTH = 2048
const MAX_DOMAINS = 100
const DOMAIN_PATTERN = /^(?=.{1,253}\.?$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i

/**
 * URLs must be `https:`, or `http:` only when targeting localhost —
 * matching the dev-seam convention that remote plaintext endpoints are
 * never acceptable for identity configuration.
 */
export function isAllowedSsoUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === "https:") return true
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
  }
  return false
}

/** "" means "unset"; anything else must be an https (or localhost http) URL. */
const optionalSsoUrl = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine((value) => value === "" || isAllowedSsoUrl(value), {
    message: "Must be an https URL (http is allowed only for localhost).",
  })

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(DOMAIN_PATTERN, "Must look like a domain name (e.g. example.com).")

export const workspaceSsoConfigSchema = z
  .object({
    /** Master switch. INERT until the SSO protocol layer is implemented. */
    enabled: z.boolean(),
    /** Identity provider protocol. "none" = SSO not configured. */
    provider: z.enum(["none", "saml", "oidc"]),
    /** SAML Entity ID / OIDC issuer identifier. URL-shaped per spec. */
    entityId: optionalSsoUrl,
    /** SAML SSO endpoint / OIDC authorization endpoint URL. */
    ssoUrl: optionalSsoUrl,
    /**
     * Certificate handling — CONFIG METADATA ONLY. `certificateConfigured`
     * records that an operator has a cert on file; `certificateFingerprintLast4`
     * stores at most a short non-secret fingerprint suffix for display. The
     * certificate itself (and any private key) must NEVER be stored here.
     */
    certificateConfigured: z.boolean(),
    certificateFingerprintLast4: z
      .string()
      .trim()
      .max(16)
      .regex(/^[a-zA-Z0-9]*$/, "Fingerprint suffix may only contain letters and digits."),
    /**
     * When true, workspace members must authenticate via SSO.
     * WARNING: enforcement is NOT implemented yet — this flag is stored
     * for forward compatibility and currently has no effect on login.
     */
    enforced: z.boolean(),
    /** Email/domain allowlist for SSO-provisioned members. */
    allowedDomains: z.array(domainSchema).max(MAX_DOMAINS),
  })
  .strict()

export type WorkspaceSsoConfig = z.infer<typeof workspaceSsoConfigSchema>

/** Partial-update shape accepted by {@link updateWorkspaceSsoConfig}. */
export const workspaceSsoConfigPatchSchema = workspaceSsoConfigSchema.partial().strict()

export type WorkspaceSsoConfigPatch = z.infer<typeof workspaceSsoConfigPatchSchema>

export const DEFAULT_WORKSPACE_SSO_CONFIG: WorkspaceSsoConfig = {
  enabled: false,
  provider: "none",
  entityId: "",
  ssoUrl: "",
  certificateConfigured: false,
  certificateFingerprintLast4: "",
  enforced: false,
  allowedDomains: [],
}

const store = new Map<string, WorkspaceSsoConfig>()

export function getWorkspaceSsoConfig(workspaceId: string): WorkspaceSsoConfig {
  const stored = store.get(workspaceId)
  return stored
    ? { ...stored, allowedDomains: [...stored.allowedDomains] }
    : {
        ...DEFAULT_WORKSPACE_SSO_CONFIG,
        allowedDomains: [],
      }
}

/**
 * Merges `patch` over the stored config after strict zod validation.
 * Throws a ZodError on invalid input — callers (the API route) should
 * pre-validate with {@link workspaceSsoConfigPatchSchema.safeParse}.
 */
export function updateWorkspaceSsoConfig(
  workspaceId: string,
  patch: WorkspaceSsoConfigPatch,
): WorkspaceSsoConfig {
  const parsed = workspaceSsoConfigPatchSchema.parse(patch)
  const next: WorkspaceSsoConfig = { ...getWorkspaceSsoConfig(workspaceId) }
  for (const key of Object.keys(parsed) as (keyof WorkspaceSsoConfigPatch)[]) {
    const value = parsed[key]
    if (value === undefined) continue
    if (key === "allowedDomains" && Array.isArray(value)) {
      // Dedupe while preserving order; domainSchema already lowercased.
      ;(next as Record<string, unknown>)[key] = [...new Set(value as string[])]
    } else {
      ;(next as Record<string, unknown>)[key] = value
    }
  }
  store.set(workspaceId, next)
  return { ...next, allowedDomains: [...next.allowedDomains] }
}

/** TEST-ONLY: clears all stored SSO configs. */
export function resetWorkspaceSsoForTests(): void {
  store.clear()
}

/**
 * Response masking. SSO endpoint/entity URLs can reveal internal IdP
 * infrastructure (hostnames, tenant paths), so API reads return only the
 * origin plus a `/***` marker. The stored value is untouched — an admin who
 * leaves a masked field unchanged simply omits it from the PATCH (partial
 * update semantics), and entering a new value replaces it.
 */
export const SSO_URL_MASK_SUFFIX = "/***"

export function maskSsoUrlForDisplay(value: string): string {
  if (!value) return value
  try {
    return `${new URL(value).origin}${SSO_URL_MASK_SUFFIX}`
  } catch {
    return SSO_URL_MASK_SUFFIX
  }
}

export function maskWorkspaceSsoConfig(config: WorkspaceSsoConfig): WorkspaceSsoConfig {
  return {
    ...config,
    entityId: maskSsoUrlForDisplay(config.entityId),
    ssoUrl: maskSsoUrlForDisplay(config.ssoUrl),
    allowedDomains: [...config.allowedDomains],
  }
}
