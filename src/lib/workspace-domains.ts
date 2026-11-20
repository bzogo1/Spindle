import { randomBytes } from "node:crypto"

import { z } from "zod"

/**
 * Workspace custom-domain configuration — DEVELOPMENT seam.
 *
 * In-memory, per-process store for a workspace's custom hostname
 * (e.g. `app.customer.com`) plus its verification state. Like
 * {@link MemoryAuthBackend} and `workspace-sso` this loses state on restart;
 * production MUST persist these rows.
 *
 * IMPORTANT — CONFIGURATION + VERIFICATION SEAM ONLY: this module stores
 * domain records and simulates ownership verification. It does NOT route
 * traffic: no middleware, proxy, or host-based dispatch is implemented here.
 * Pointing a hostname at the app, TLS termination, and actually serving the
 * workspace on that hostname are deployment/edge concerns handled outside
 * this store (see docs). Nothing here changes how requests are routed.
 *
 * VERIFICATION SEAM: real DNS verification requires a TXT-record lookup,
 * which cannot run offline. {@link checkVerification} is the single seam
 * where that lookup belongs — production swaps its body for a
 * DNS-over-HTTPS TXT query against the domain's authoritative nameservers.
 * The dev implementation simply compares the admin-presented token against
 * the stored `verificationToken` (the value the admin is told to publish as
 * a TXT record). See {@link verifyWorkspaceDomain}.
 *
 * DOMAIN UNIQUENESS: a domain may be claimed by at most one workspace, in
 * ANY status (pending, verified, or disabled). Setting a domain already held
 * by another workspace throws {@link WorkspaceDomainError} with code
 * `domain_unavailable` — pending claims are rejected too, so two workspaces
 * cannot race to verify the same hostname. Re-setting the same domain on the
 * SAME workspace is allowed and replaces the record (fresh token, back to
 * `pending`).
 */

export type WorkspaceDomainStatus = "pending" | "verified" | "disabled"

export type WorkspaceDomain = {
  /** Normalized lowercase hostname, e.g. "app.example.com". */
  domain: string
  status: WorkspaceDomainStatus
  /**
   * Secret token the admin must publish as a DNS TXT record. In production
   * the TXT value is `spindle-verify=<verificationToken>`; the UI renders
   * that full record value. This is a bearer-ish secret — API reads only
   * expose it to owner/admin roles.
   */
  verificationToken: string
  /** ISO timestamp of successful verification, when status is "verified". */
  verifiedAt: string | null
  /** ISO timestamp of record creation. */
  createdAt: string
}

/** Error codes thrown by the store; API routes map them to HTTP statuses. */
export type WorkspaceDomainErrorCode = "invalid_domain" | "domain_unavailable" | "invalid_status"

export class WorkspaceDomainError extends Error {
  readonly code: WorkspaceDomainErrorCode

  constructor(code: WorkspaceDomainErrorCode, message: string) {
    super(message)
    this.name = "WorkspaceDomainError"
    this.code = code
  }
}

/**
 * Bare hostname only — no scheme, port, path, query, or credentials. Labels
 * are 1–63 chars of letters/digits/hyphens (no leading/trailing hyphen), at
 * least two labels, TLD alphabetic 2–63 chars, total ≤ 253 chars.
 */
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export const workspaceDomainInputSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(
        DOMAIN_PATTERN,
        "Must be a bare domain name like app.example.com (no protocol or path).",
      ),
  })
  .strict()

export type WorkspaceDomainInput = z.infer<typeof workspaceDomainInputSchema>

/** DNS TXT record name/prefix convention shown to admins. */
export const VERIFICATION_TXT_PREFIX = "spindle-verify="

/** Full TXT record value an admin should publish for `record`. */
export function verificationTxtValue(record: WorkspaceDomain): string {
  return `${VERIFICATION_TXT_PREFIX}${record.verificationToken}`
}

const store = new Map<string, WorkspaceDomain>() // workspaceId -> record
const domainIndex = new Map<string, string>() // normalized domain -> workspaceId

function newVerificationToken(): string {
  return randomBytes(24).toString("base64url")
}

function copy(record: WorkspaceDomain): WorkspaceDomain {
  return { ...record }
}

/** Returns the workspace's custom-domain record, or null when unset. */
export function getWorkspaceDomain(workspaceId: string): WorkspaceDomain | null {
  const record = store.get(workspaceId)
  return record ? copy(record) : null
}

/**
 * Sets (or replaces) the workspace's single custom domain. The domain is
 * normalized to lowercase and must be a bare hostname. One domain per
 * workspace — a new value fully replaces the previous record (status resets
 * to `pending`, fresh verification token). Throws {@link WorkspaceDomainError}
 * with `invalid_domain` or `domain_unavailable`.
 */
export function setWorkspaceDomain(
  workspaceId: string,
  rawDomain: string,
  now?: number,
): WorkspaceDomain {
  const parsed = workspaceDomainInputSchema.safeParse({ domain: rawDomain })
  if (!parsed.success) {
    throw new WorkspaceDomainError(
      "invalid_domain",
      parsed.error.issues[0]?.message ?? "Invalid domain.",
    )
  }
  const domain = parsed.data.domain

  const claimant = domainIndex.get(domain)
  if (claimant !== undefined && claimant !== workspaceId) {
    throw new WorkspaceDomainError(
      "domain_unavailable",
      "This domain is already claimed by another workspace.",
    )
  }

  const previous = store.get(workspaceId)
  if (previous && previous.domain !== domain) {
    domainIndex.delete(previous.domain)
  }

  const record: WorkspaceDomain = {
    domain,
    status: "pending",
    verificationToken: newVerificationToken(),
    verifiedAt: null,
    createdAt: new Date(now ?? Date.now()).toISOString(),
  }
  store.set(workspaceId, record)
  domainIndex.set(domain, workspaceId)
  return copy(record)
}

/**
 * VERIFICATION SEAM. In production this is where a real DNS-over-HTTPS TXT
 * lookup runs: query `_domainkey`-style TXT records for the configured
 * domain and check that `spindle-verify=<token>` is published. The dev seam
 * cannot do network I/O, so it compares the admin-presented token (typed
 * into the UI after they add the DNS record) against the stored
 * `verificationToken`.
 *
 * Returns true when the presented token matches the pending record's token.
 */
export function checkVerification(workspaceId: string, presentedToken: string): boolean {
  const record = store.get(workspaceId)
  if (!record || record.status === "disabled") return false
  if (record.status === "verified") return true
  return record.verificationToken === presentedToken.trim()
}

/**
 * Marks the workspace's domain verified when {@link checkVerification}
 * accepts the presented token. Idempotent for already-verified records.
 * Returns the updated record, or null when no domain is configured / the
 * token does not match / the domain is disabled.
 */
export function verifyWorkspaceDomain(
  workspaceId: string,
  presentedToken: string,
  now?: number,
): WorkspaceDomain | null {
  const record = store.get(workspaceId)
  if (!record || record.status === "disabled") return null
  if (record.status === "verified") return copy(record)
  if (!checkVerification(workspaceId, presentedToken)) return null

  const verified: WorkspaceDomain = {
    ...record,
    status: "verified",
    verifiedAt: new Date(now ?? Date.now()).toISOString(),
  }
  store.set(workspaceId, verified)
  return copy(verified)
}

/**
 * Sets the domain status directly ("pending" or "disabled" — "disabled"
 * suspends use of the hostname without deleting the record or its
 * verification). Returns the updated record or null when none is
 * configured. "verified" is NOT accepted here: it must go through
 * {@link verifyWorkspaceDomain} so the DNS/token check and `verifiedAt`
 * timestamp are always applied — this prevents a token-less bypass.
 * Throws {@link WorkspaceDomainError} with `invalid_status` for "verified".
 */
export function setWorkspaceDomainStatus(
  workspaceId: string,
  status: WorkspaceDomainStatus,
): WorkspaceDomain | null {
  const record = store.get(workspaceId)
  if (!record) return null
  if (status === "verified") {
    throw new WorkspaceDomainError(
      "invalid_status",
      '"verified" can only be set via verifyWorkspaceDomain.',
    )
  }
  const next: WorkspaceDomain = { ...record, status }
  store.set(workspaceId, next)
  return copy(next)
}

/** Removes the workspace's custom domain entirely. Returns true when one existed. */
export function removeWorkspaceDomain(workspaceId: string): boolean {
  const record = store.get(workspaceId)
  if (!record) return false
  store.delete(workspaceId)
  domainIndex.delete(record.domain)
  return true
}

/** TEST-ONLY: clears all stored domain records. */
export function resetWorkspaceDomainsForTests(): void {
  store.clear()
  domainIndex.clear()
}
