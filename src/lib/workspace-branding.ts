import { z } from "zod"

/**
 * Workspace branding — DEVELOPMENT seam.
 *
 * In-memory, per-process store for per-workspace visual identity applied to
 * the sign-in experience (display name, logo text/URL, accent/background
 * colors). Like {@link MemoryAuthBackend} and `workspace-settings` this loses
 * state on restart; production MUST persist these rows.
 *
 * SLUG LOOKUP: the auth backend exposes `getWorkspace(id)` but no slug
 * lookup, so each record captures `workspaceSlug` (and `workspaceName` for
 * the displayName fallback) at write time. {@link getBrandingBySlug} scans
 * the store — acceptable for a dev seam; a production store should index on
 * slug directly.
 */

const MAX_URL_LENGTH = 2048
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/** http(s) only — branding images may be hotlinked from anywhere, but never other schemes. */
export function isAllowedLogoUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === "https:" || url.protocol === "http:"
}

/** "" means "unset"; anything else must be a #rrggbb hex color. */
const optionalHexColor = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Must be a hex color like #1a2b3c.")
  .or(z.literal(""))

/** "" means "unset"; anything else must be an http(s) URL. */
const optionalLogoUrl = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine((value) => value === "" || isAllowedLogoUrl(value), {
    message: "Logo URL must be an http(s) URL.",
  })

/**
 * Client-settable branding fields. Strict: unknown keys are rejected so a
 * buggy client cannot smuggle arbitrary JSON (or the internal slug/name
 * bookkeeping fields) into the store.
 */
export const workspaceBrandingSchema = z
  .object({
    /** Overrides the workspace name on branded surfaces. "" → fall back to workspace name. */
    displayName: z.string().trim().max(80),
    /** Short label shown next to/under the logo (e.g. "Acme Labs"). */
    logoText: z.string().trim().max(40),
    /** Optional logo image URL (http/https). "" → text/mark only. */
    logoUrl: optionalLogoUrl,
    /** Primary accent color applied to branded auth surfaces. "" → default theme. */
    accentColor: optionalHexColor,
    /** Optional page background tint. "" → default theme. */
    backgroundColor: optionalHexColor,
  })
  .strict()

export type WorkspaceBrandingInput = z.infer<typeof workspaceBrandingSchema>

/** Partial-update shape accepted by {@link updateWorkspaceBranding}. */
export const workspaceBrandingPatchSchema = workspaceBrandingSchema.partial().strict()

export type WorkspaceBrandingPatch = z.infer<typeof workspaceBrandingPatchSchema>

/**
 * Stored record: the client fields plus internal bookkeeping — the slug used
 * for anonymous lookups and the workspace name captured at write time, which
 * backs the displayName fallback.
 */
export type WorkspaceBranding = WorkspaceBrandingInput & {
  /** Workspace slug at last write; powers {@link getBrandingBySlug}. */
  workspaceSlug: string
  /** Workspace name at last write; displayName falls back to this. */
  workspaceName: string
}

export const DEFAULT_WORKSPACE_BRANDING: WorkspaceBranding = {
  displayName: "",
  logoText: "",
  logoUrl: "",
  accentColor: "",
  backgroundColor: "",
  workspaceSlug: "",
  workspaceName: "",
}

/**
 * The SAFE public subset returned by `GET /api/workspaces/brand` and applied
 * to sign-in pages. Deliberately excludes workspaceSlug/workspaceName
 * internals — only what a login screen needs to render.
 */
export type PublicWorkspaceBranding = {
  displayName: string
  logoText: string
  accentColor: string
  backgroundColor: string
  logoUrl: string
}

const store = new Map<string, WorkspaceBranding>()

/** Full stored record for `workspaceId`, or null when never configured. */
export function getWorkspaceBranding(workspaceId: string): WorkspaceBranding | null {
  const stored = store.get(workspaceId)
  return stored ? { ...stored } : null
}

/**
 * Slug lookup for the public brand endpoint / sign-in page. The backend has
 * no `getWorkspaceBySlug`, so this scans stored records for a slug match
 * (case-insensitive — slugs are lowercase by convention but be lenient).
 */
export function getBrandingBySlug(slug: string): WorkspaceBranding | null {
  const needle = slug.trim().toLowerCase()
  if (!needle) return null
  for (const record of store.values()) {
    if (record.workspaceSlug.toLowerCase() === needle) return { ...record }
  }
  return null
}

/**
 * Resolves a public branding record from either a workspace id or a slug
 * (the sign-in page accepts `?workspace=`/`?brand=` carrying either). Returns
 * the SAFE subset, or null when nothing is configured.
 */
export function getPublicBrandingByKey(key: string): PublicWorkspaceBranding | null {
  const trimmed = key.trim()
  if (!trimmed) return null
  const record = getWorkspaceBranding(trimmed) ?? getBrandingBySlug(trimmed)
  return record ? toPublicBranding(record) : null
}

/** Projects a stored record onto the public subset (displayName fallback applied). */
export function toPublicBranding(record: WorkspaceBranding): PublicWorkspaceBranding {
  return {
    displayName: record.displayName || record.workspaceName,
    logoText: record.logoText,
    accentColor: record.accentColor,
    backgroundColor: record.backgroundColor,
    logoUrl: record.logoUrl,
  }
}

/**
 * Merges `patch` over the stored branding after strict zod validation and
 * refreshes the slug/name bookkeeping. Throws a ZodError on invalid input —
 * callers (the API route) should pre-validate with
 * {@link workspaceBrandingPatchSchema.safeParse}.
 */
export function updateWorkspaceBranding(
  workspaceId: string,
  slug: string,
  patch: WorkspaceBrandingPatch,
  workspaceName = "",
): WorkspaceBranding {
  const parsed = workspaceBrandingPatchSchema.parse(patch)
  const previous = getWorkspaceBranding(workspaceId) ?? { ...DEFAULT_WORKSPACE_BRANDING }
  const clean: WorkspaceBranding = {
    displayName: parsed.displayName ?? previous.displayName,
    logoText: parsed.logoText ?? previous.logoText,
    logoUrl: parsed.logoUrl ?? previous.logoUrl,
    accentColor: parsed.accentColor ?? previous.accentColor,
    backgroundColor: parsed.backgroundColor ?? previous.backgroundColor,
    workspaceSlug: slug || previous.workspaceSlug,
    workspaceName: workspaceName || previous.workspaceName,
  }
  store.set(workspaceId, clean)
  return { ...clean }
}

/** TEST-ONLY: clears all stored branding. */
export function resetWorkspaceBrandingForTests(): void {
  store.clear()
}
