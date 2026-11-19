import type { EnvSource } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

import {
  isB2AuthError,
  resolveB2Credentials,
  withB2Credentials,
  type B2CredentialSet,
  type B2Credentials,
} from "./b2"
import {
  dualKeySecrets,
  secretCatalog,
  secretVariables,
  type SecretDefinition,
  type SecretService,
} from "./catalog"
import {
  edgeCanonicalRequest,
  signEdgeRequest,
  verifyEdgeRequest,
  type EdgeRequest,
  type EdgeVerification,
} from "./edge"
import {
  createKeyring,
  hmacSha256,
  safeEqual,
  SecretsConfigurationError,
  signWithKeyring,
  verifyWithKeyring,
  type Keyring,
} from "./keyring"
import { signSession, verifySession, type SessionClaims, type SessionVerification } from "./session"
import {
  validateSecretEnvironment,
  type SecretIssue,
  type SecretValidationResult,
} from "./validate"

export {
  createKeyring,
  dualKeySecrets,
  edgeCanonicalRequest,
  hmacSha256,
  isB2AuthError,
  resolveB2Credentials,
  safeEqual,
  secretCatalog,
  secretVariables,
  SecretsConfigurationError,
  signEdgeRequest,
  signSession,
  signWithKeyring,
  validateSecretEnvironment,
  verifyEdgeRequest,
  verifySession,
  verifyWithKeyring,
  withB2Credentials,
}

export type {
  B2CredentialSet,
  B2Credentials,
  EdgeRequest,
  EdgeVerification,
  Keyring,
  SecretDefinition,
  SecretIssue,
  SecretService,
  SecretValidationResult,
  SessionClaims,
  SessionVerification,
}

/**
 * Server-only accessors for the secret-store values. Import this module from
 * server code only; none of these values may reach a client component.
 */

export function sessionKeyring(source: EnvSource = getServerEnv()): Keyring {
  return createKeyring(source.SESSION_SECRET, source.SESSION_SECRET_PREVIOUS, "SESSION_SECRET")
}

export function edgeKeyring(source: EnvSource = getServerEnv()): Keyring {
  return createKeyring(
    source.EDGE_HMAC_SECRET,
    source.EDGE_HMAC_SECRET_PREVIOUS,
    "EDGE_HMAC_SECRET",
  )
}

export function workerKeyring(source: EnvSource = getServerEnv()): Keyring {
  return createKeyring(source.WORKER_SECRET, source.WORKER_SECRET_PREVIOUS, "WORKER_SECRET")
}

export function resendApiKey(source: EnvSource = getServerEnv()): string {
  return requireSecret(source.RESEND_API_KEY, "RESEND_API_KEY")
}

export function llmCredentials(source: EnvSource = getServerEnv()): {
  apiKey: string
  baseUrl: string
  model: string
} {
  return {
    apiKey: requireSecret(source.LLM_API_KEY, "LLM_API_KEY"),
    baseUrl: requireSecret(source.LLM_BASE_URL, "LLM_BASE_URL"),
    model: requireSecret(source.LLM_MODEL, "LLM_MODEL"),
  }
}

export function workerSecret(source: EnvSource = getServerEnv()): string {
  return workerKeyring(source).current
}

/** Accepts the current worker secret and the previous one during a rotation. */
export function verifyWorkerToken(
  presented: string | undefined,
  source: EnvSource = getServerEnv(),
): boolean {
  if (!presented) return false

  const keyring = workerKeyring(source)

  if (safeEqual(presented, keyring.current)) return true
  return keyring.previous ? safeEqual(presented, keyring.previous) : false
}

export type RotationOverlapCheck = {
  service: SecretService
  key: string
  hasPrevious: boolean
  currentAccepted: boolean
  previousAccepted: boolean
}

/**
 * Proves that the running code accepts both keys for every dual-key secret.
 * The production runbook runs this before removing a previous value.
 */
export function checkRotationOverlap(source: EnvSource = getServerEnv()): RotationOverlapCheck[] {
  const entries = [
    {
      service: "session" as const,
      key: "SESSION_SECRET",
      current: source.SESSION_SECRET,
      previous: source.SESSION_SECRET_PREVIOUS,
    },
    {
      service: "edge" as const,
      key: "EDGE_HMAC_SECRET",
      current: source.EDGE_HMAC_SECRET,
      previous: source.EDGE_HMAC_SECRET_PREVIOUS,
    },
    {
      service: "worker" as const,
      key: "WORKER_SECRET",
      current: source.WORKER_SECRET,
      previous: source.WORKER_SECRET_PREVIOUS,
    },
  ]

  return entries.map((entry) => {
    const current = entry.current?.trim()
    const previous = entry.previous?.trim()

    if (!current) {
      return {
        service: entry.service,
        key: entry.key,
        hasPrevious: Boolean(previous),
        currentAccepted: false,
        previousAccepted: false,
      }
    }

    const keyring = createKeyring(current, previous, entry.key)
    const payload = "spindle-rotation-check"

    return {
      service: entry.service,
      key: entry.key,
      hasPrevious: Boolean(keyring.previous),
      currentAccepted:
        verifyWithKeyring(keyring, payload, signWithKeyring(keyring, payload)) === "current",
      previousAccepted: keyring.previous
        ? verifyWithKeyring(keyring, payload, hmacSha256(keyring.previous, payload)) === "previous"
        : false,
    }
  })
}

function requireSecret(value: string | undefined, key: string): string {
  const normalized = value?.trim()

  if (!normalized) {
    throw new SecretsConfigurationError(
      key,
      "is required but was not provided by the secret store.",
    )
  }

  return normalized
}
