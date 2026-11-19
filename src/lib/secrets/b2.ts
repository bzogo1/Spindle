import type { EnvSource } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

import { SecretsConfigurationError } from "./keyring"

export type B2Credentials = {
  keyId: string
  applicationKey: string
  bucket: string
  endpoint?: string
}

export type B2CredentialSet = {
  current: B2Credentials
  previous?: B2Credentials
}

/**
 * Resolves the current B2 credentials and, during a rotation window, the
 * previous pair. A previous pair is only usable when both its key id and
 * application key are present.
 */
export function resolveB2Credentials(source: EnvSource = getServerEnv()): B2CredentialSet {
  const current = buildCredentials(
    source.B2_KEY_ID,
    source.B2_APPLICATION_KEY,
    source.B2_BUCKET,
    source.B2_ENDPOINT,
    "current",
  )

  const previousKeyId = source.B2_KEY_ID_PREVIOUS?.trim()
  const previousApplicationKey = source.B2_APPLICATION_KEY_PREVIOUS?.trim()
  const previous =
    previousKeyId && previousApplicationKey
      ? {
          keyId: previousKeyId,
          applicationKey: previousApplicationKey,
          bucket: current.bucket,
          endpoint: current.endpoint,
        }
      : undefined

  return { current, previous }
}

function buildCredentials(
  keyId: string | undefined,
  applicationKey: string | undefined,
  bucket: string | undefined,
  endpoint: string | undefined,
  label: "current" | "previous",
): B2Credentials {
  const normalizedKeyId = keyId?.trim()
  const normalizedApplicationKey = applicationKey?.trim()
  const normalizedBucket = bucket?.trim()

  if (!normalizedKeyId) {
    throw new SecretsConfigurationError(
      label === "current" ? "B2_KEY_ID" : "B2_KEY_ID_PREVIOUS",
      "is required for Backblaze B2 access.",
    )
  }

  if (!normalizedApplicationKey) {
    throw new SecretsConfigurationError(
      label === "current" ? "B2_APPLICATION_KEY" : "B2_APPLICATION_KEY_PREVIOUS",
      "is required for Backblaze B2 access.",
    )
  }

  if (!normalizedBucket) {
    throw new SecretsConfigurationError("B2_BUCKET", "is required for Backblaze B2 access.")
  }

  return {
    keyId: normalizedKeyId,
    applicationKey: normalizedApplicationKey,
    bucket: normalizedBucket,
    endpoint: endpoint?.trim() || undefined,
  }
}

/** Recognizes the auth failures that should trigger a retry with the old key. */
export function isB2AuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false

  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }

  const status = candidate.status ?? candidate.statusCode ?? candidate.$metadata?.httpStatusCode

  return status === 401 || status === 403 || candidate.code === "Unauthorized"
}

/**
 * Runs a B2 operation with the current key and retries once with the previous
 * key on an auth error. This keeps a long-lived process working while a key is
 * being rotated out.
 */
export async function withB2Credentials<T>(
  operation: (credentials: B2Credentials, attempt: "current" | "previous") => Promise<T>,
  source: EnvSource = getServerEnv(),
): Promise<T> {
  const credentials = resolveB2Credentials(source)

  try {
    return await operation(credentials.current, "current")
  } catch (error) {
    if (!credentials.previous || !isB2AuthError(error)) throw error
    return operation(credentials.previous, "previous")
  }
}
