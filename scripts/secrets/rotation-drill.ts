import { randomBytes } from "node:crypto"

import {
  createKeyring,
  signEdgeRequest,
  verifyEdgeRequest,
  withB2Credentials,
} from "../../src/lib/secrets"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function newSecret(): string {
  return randomBytes(32).toString("base64url")
}

function drillEdgeHmac() {
  const now = Math.floor(Date.now() / 1000)
  const oldKey = newSecret()
  const newKey = newSecret()
  const request = { method: "GET", path: "/api/health" }

  const oldKeyring = createKeyring(oldKey, undefined, "EDGE_HMAC_SECRET")
  const overlapKeyring = createKeyring(newKey, oldKey, "EDGE_HMAC_SECRET")
  const rotatedKeyring = createKeyring(newKey, undefined, "EDGE_HMAC_SECRET")

  const oldSigned = signEdgeRequest(request, { keyring: oldKeyring, now })
  const oldDuringOverlap = verifyEdgeRequest(
    { ...request, timestamp: oldSigned.timestamp, signature: oldSigned.signature },
    { keyring: overlapKeyring, now },
  )
  assert(
    oldDuringOverlap.ok && oldDuringOverlap.key === "previous",
    "edge HMAC rejected the previous key during the overlap window",
  )

  const newSigned = signEdgeRequest(request, { keyring: overlapKeyring, now })
  const newDuringOverlap = verifyEdgeRequest(
    { ...request, timestamp: newSigned.timestamp, signature: newSigned.signature },
    { keyring: overlapKeyring, now },
  )
  assert(
    newDuringOverlap.ok && newDuringOverlap.key === "current",
    "edge HMAC did not sign and verify with the current key during overlap",
  )

  const oldAfterCleanup = verifyEdgeRequest(
    { ...request, timestamp: oldSigned.timestamp, signature: oldSigned.signature },
    { keyring: rotatedKeyring, now },
  )
  assert(
    !oldAfterCleanup.ok && oldAfterCleanup.reason === "invalid-signature",
    "edge HMAC still accepted the previous key after cleanup",
  )

  const newAfterCleanup = verifyEdgeRequest(
    { ...request, timestamp: newSigned.timestamp, signature: newSigned.signature },
    { keyring: rotatedKeyring, now },
  )
  assert(
    newAfterCleanup.ok && newAfterCleanup.key === "current",
    "edge HMAC rejected the current key after cleanup",
  )
}

async function drillB2Rotation() {
  const oldKeyId = `old-${randomBytes(8).toString("hex")}`
  const newKeyId = `new-${randomBytes(8).toString("hex")}`
  const oldApplicationKey = newSecret()
  const newApplicationKey = newSecret()
  const shared = {
    B2_BUCKET: "rotation-drill",
    B2_ENDPOINT: "https://s3.example.com",
  }
  const overlapSource = {
    ...shared,
    B2_KEY_ID: newKeyId,
    B2_APPLICATION_KEY: newApplicationKey,
    B2_KEY_ID_PREVIOUS: oldKeyId,
    B2_APPLICATION_KEY_PREVIOUS: oldApplicationKey,
  }
  const rotatedSource = {
    ...shared,
    B2_KEY_ID: newKeyId,
    B2_APPLICATION_KEY: newApplicationKey,
  }
  const oldOnlySource = {
    ...shared,
    B2_KEY_ID: oldKeyId,
    B2_APPLICATION_KEY: oldApplicationKey,
  }

  const providerKeys = new Set([oldKeyId, newKeyId])
  const providerOperation = async (credentials: { keyId: string }, attempt: string) => {
    if (!providerKeys.has(credentials.keyId)) throw { status: 403 }
    return attempt
  }

  const healthyAttempts: string[] = []
  const healthyResult = await withB2Credentials(async (credentials, attempt) => {
    healthyAttempts.push(attempt)
    return providerOperation(credentials, attempt)
  }, overlapSource)
  assert(
    healthyResult === "current" && healthyAttempts.join(">") === "current",
    "B2 current key did not serve healthy overlap traffic",
  )

  const fallbackAttempts: string[] = []
  let failCurrent = true
  const fallbackResult = await withB2Credentials(async (credentials, attempt) => {
    fallbackAttempts.push(attempt)
    if (attempt === "current" && failCurrent) {
      failCurrent = false
      throw { status: 403 }
    }
    return providerOperation(credentials, attempt)
  }, overlapSource)
  assert(
    fallbackResult === "previous" && fallbackAttempts.join(">") === "current>previous",
    "B2 did not recover one current-key auth failure with the previous pair",
  )

  providerKeys.delete(oldKeyId)

  const finalAttempts: string[] = []
  const finalResult = await withB2Credentials(async (credentials, attempt) => {
    finalAttempts.push(attempt)
    return providerOperation(credentials, attempt)
  }, rotatedSource)
  assert(
    finalResult === "current" && finalAttempts.join(">") === "current",
    "B2 current key failed after the previous pair was removed",
  )

  let revokedKeyRejected = false
  try {
    await withB2Credentials(providerOperation, oldOnlySource)
  } catch {
    revokedKeyRejected = true
  }
  assert(revokedKeyRejected, "B2 accepted a revoked key after cleanup")
}

async function main() {
  drillEdgeHmac()
  await drillB2Rotation()

  console.log(
    "edge-hmac drill: previous verified during overlap, current signed, old rejected after cleanup",
  )
  console.log("b2 drill: current served overlap, previous recovered one 403, revoked key rejected")
  console.log("Rotation drill passed (ephemeral keys; no store or provider calls).")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
