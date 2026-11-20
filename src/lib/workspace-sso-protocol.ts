import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import type { WorkspaceSsoConfig } from "@/lib/workspace-sso"

/**
 * SAML/OIDC protocol plumbing — DEVELOPMENT SCAFFOLD.
 *
 * This module builds the *outbound* half of a workspace-SSO flow (the AuthnRequest
 * redirect for SAML, the authorize URL for OIDC) plus a DEV-MODE assertion path
 * used until a real IdP can be integrated.
 *
 * DOCUMENTED LIMITATIONS (all deliberate — no external calls, no new deps):
 *
 *  - SAML: a real AuthnRequest must be DEFLATE-compressed, base64-encoded, and
 *    (for HTTP-POST binding) XML-signed with the service provider's private key.
 *    We emit an UNSIGNED, uncompressed base64 XML scaffold as `SAMLRequest` so
 *    the redirect shape is correct and testable; a real IdP will reject it.
 *    Production needs a SAML library (e.g. `@node-saml/node-saml`) plus key
 *    management — tracked as a follow-up.
 *  - OIDC: the authorize URL is fully formed (state, nonce, PKCE-ready), but
 *    there is no token exchange / ID-token signature verification endpoint yet.
 *    Production needs discovery (`.well-known/openid-configuration`), JWKS
 *    validation, and nonce/state persistence — follow-up.
 *  - Dev assertions: `verifyDevAssertion` accepts an HMAC-SHA256 "assertion"
 *    keyed by a per-workspace secret derived from PUBLIC config values
 *    (`sha256(workspaceId + entityId)`). Anyone who can read the SSO config can
 *    mint one, so this path MUST stay gated behind `mockOAuthEnabled()`
 *    (NEXT_PUBLIC_MOCK_AUTH=1, never in production). It exists so the full
 *    login → membership → session pipeline is exercisable in dev. Real SAML
 *    response / OIDC ID-token signature verification is a documented follow-up
 *    requiring a proper library.
 */

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url")
}

/**
 * Random URL-safe token for OIDC `state`/`nonce`. 32 bytes of entropy,
 * base64url-encoded (~43 chars). Callers persist `state` server-side (or in
 * the client flow) and reject mismatches — persistence is a follow-up.
 */
export function generateState(): string {
  return base64Url(randomBytes(32))
}

/** Random URL-safe nonce for the OIDC authorize request. */
export function generateNonce(): string {
  return base64Url(randomBytes(32))
}

/**
 * Builds the SSO redirect URL for a workspace, or `null` when the config is
 * incomplete (missing `ssoUrl`/`entityId` — the route maps that to 503).
 *
 * SAML: `GET {ssoUrl}?SAMLRequest=<base64-unsigned-AuthnRequest>&RelayState=…`
 *   `acsUrl` is the assertion consumer service URL embedded in the request —
 *   in dev this is our own POST endpoint.
 * OIDC: `GET {ssoUrl}?client_id={entityId}&redirect_uri=…&response_type=code
 *   &scope=openid email profile&state=…&nonce=…`
 *   `redirectUri` is where the IdP sends the authorization `code`.
 */
export function buildAuthnRequestUrl(
  config: WorkspaceSsoConfig,
  options: {
    workspaceId: string
    /** SAML RelayState / opaque round-trip value. Defaults to workspaceId. */
    relayState?: string
    /** SAML AssertionConsumerServiceURL. */
    acsUrl?: string
    /** OIDC redirect_uri (authorization-code return address). */
    redirectUri?: string
    /** OIDC state; generated when omitted. */
    state?: string
    /** OIDC nonce; generated when omitted. */
    nonce?: string
  },
): string | null {
  if (!config.enabled || config.provider === "none") return null
  if (!config.ssoUrl || !config.entityId) return null

  if (config.provider === "saml") {
    return buildSamlRedirectUrl(config, options)
  }
  return buildOidcAuthorizeUrl(config, options)
}

function buildSamlRedirectUrl(
  config: WorkspaceSsoConfig,
  options: { workspaceId: string; relayState?: string; acsUrl?: string },
): string | null {
  const ssoUrl = config.ssoUrl
  const entityId = config.entityId
  if (!ssoUrl || !entityId) return null

  const relayState = options.relayState ?? options.workspaceId
  const acsUrl = options.acsUrl ?? ""
  const requestId = `_${randomBytes(16).toString("hex")}`
  const issueInstant = new Date().toISOString()

  // UNSIGNED SCAFFOLD — see module docblock. Real SP-initiated SSO requires
  // deflate + base64 + XML signature; this emits the pre-signature XML so the
  // wire shape (SAMLRequest + RelayState params) is exercisable in dev.
  const authnRequestXml =
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}" ` +
    `AssertionConsumerServiceURL="${escapeXml(acsUrl)}" ` +
    `Destination="${escapeXml(ssoUrl)}">` +
    `<saml:Issuer>${escapeXml(entityId)}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`

  const samlRequest = Buffer.from(authnRequestXml, "utf8").toString("base64")

  const url = new URL(ssoUrl)
  url.searchParams.set("SAMLRequest", samlRequest)
  url.searchParams.set("RelayState", relayState)
  return url.toString()
}

function buildOidcAuthorizeUrl(
  config: WorkspaceSsoConfig,
  options: {
    workspaceId: string
    redirectUri?: string
    state?: string
    nonce?: string
  },
): string | null {
  const ssoUrl = config.ssoUrl
  const entityId = config.entityId
  if (!ssoUrl || !entityId) return null

  // `entityId` doubles as the OIDC client_id per the workspace-sso config seam
  // (there is no separate client-id field). A real deployment would store a
  // dedicated client id + secret in a secrets store — see module docblock.
  const url = new URL(ssoUrl)
  url.searchParams.set("client_id", entityId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", options.state ?? generateState())
  url.searchParams.set("nonce", options.nonce ?? generateNonce())
  if (options.redirectUri) {
    url.searchParams.set("redirect_uri", options.redirectUri)
  }
  return url.toString()
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

// ---------------------------------------------------------------------------
// DEV-MODE assertion path
// ---------------------------------------------------------------------------

/**
 * Per-workspace shared secret for dev assertions.
 *
 * DEV-ONLY: derived from PUBLIC config values (`workspaceId` + `entityId`),
 * so it is NOT a real secret — anyone who can read the SSO config can recompute
 * it. It exists solely to exercise the login pipeline in development, gated
 * behind `mockOAuthEnabled()` at the route. Real signature verification
 * (SAML XML-DSig / OIDC JWKS) is a follow-up.
 */
export function devAssertionSecret(workspaceId: string, entityId: string): string {
  return createHash("sha256")
    .update(`spindle-sso-dev-secret\n${workspaceId}\n${entityId}`, "utf8")
    .digest("hex")
}

function assertionPayload(input: {
  workspaceId: string
  email: string
  name?: string | null
}): string {
  return [
    "spindle-sso-dev-assertion-v1",
    input.workspaceId,
    input.email.trim().toLowerCase(),
    (input.name ?? "").trim(),
  ].join("\n")
}

/**
 * DEV-ONLY: mints a dev assertion for tests/local IdP shims. Never call this
 * from production code paths — see module docblock.
 */
export function signDevAssertion(input: {
  workspaceId: string
  email: string
  name?: string | null
  secret: string
}): string {
  return createHmac("sha256", input.secret).update(assertionPayload(input), "utf8").digest("hex")
}

/**
 * Verifies a dev-mode SSO assertion: HMAC-SHA256 over
 * `workspaceId + email + name` keyed by the per-workspace derived secret.
 * Constant-time comparison; returns `false` on any mismatch or malformed
 * input. Callers must map `false` to a generic error (no enumeration).
 */
export function verifyDevAssertion(input: {
  workspaceId: string
  email: string
  name?: string | null
  assertion: string
  secret: string
}): boolean {
  if (!/^[0-9a-f]{64}$/i.test(input.assertion)) return false
  const expected = signDevAssertion(input)
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(input.assertion.toLowerCase(), "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
