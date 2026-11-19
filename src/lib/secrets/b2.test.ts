import { describe, expect, it, vi } from "vitest"

import { isB2AuthError, resolveB2Credentials, withB2Credentials } from "./b2"
import { SecretsConfigurationError } from "./keyring"

const source = {
  B2_KEY_ID: "current-key-id",
  B2_APPLICATION_KEY: "current-application-key",
  B2_BUCKET: "spindle-projects",
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
}

describe("B2 credentials", () => {
  it("resolves the current credentials", () => {
    expect(resolveB2Credentials(source)).toEqual({
      current: {
        keyId: "current-key-id",
        applicationKey: "current-application-key",
        bucket: "spindle-projects",
        endpoint: "https://s3.us-west-004.backblazeb2.com",
      },
      previous: undefined,
    })
  })

  it("resolves the previous pair only when both parts are present", () => {
    const credentials = resolveB2Credentials({
      ...source,
      B2_KEY_ID_PREVIOUS: "previous-key-id",
      B2_APPLICATION_KEY_PREVIOUS: "previous-application-key",
    })

    expect(credentials.previous).toEqual({
      keyId: "previous-key-id",
      applicationKey: "previous-application-key",
      bucket: "spindle-projects",
      endpoint: "https://s3.us-west-004.backblazeb2.com",
    })

    expect(
      resolveB2Credentials({ ...source, B2_KEY_ID_PREVIOUS: "previous-key-id" }).previous,
    ).toBeUndefined()
  })

  it("fails without a key id, application key, or bucket", () => {
    expect(() => resolveB2Credentials({ B2_APPLICATION_KEY: "key", B2_BUCKET: "bucket" })).toThrow(
      SecretsConfigurationError,
    )
    expect(() => resolveB2Credentials({ B2_KEY_ID: "id", B2_BUCKET: "bucket" })).toThrow(
      SecretsConfigurationError,
    )
    expect(() => resolveB2Credentials({ B2_KEY_ID: "id", B2_APPLICATION_KEY: "key" })).toThrow(
      SecretsConfigurationError,
    )
  })

  it("recognizes auth failures", () => {
    expect(isB2AuthError({ status: 401 })).toBe(true)
    expect(isB2AuthError({ statusCode: 403 })).toBe(true)
    expect(isB2AuthError({ $metadata: { httpStatusCode: 401 } })).toBe(true)
    expect(isB2AuthError({ status: 500 })).toBe(false)
    expect(isB2AuthError(new Error("network"))).toBe(false)
  })

  it("retries once with the previous key on an auth error", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValueOnce("uploaded")

    const result = await withB2Credentials(operation, {
      ...source,
      B2_KEY_ID_PREVIOUS: "previous-key-id",
      B2_APPLICATION_KEY_PREVIOUS: "previous-application-key",
    })

    expect(result).toBe("uploaded")
    expect(operation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ keyId: "previous-key-id" }),
      "previous",
    )
  })

  it("does not retry a non-auth error or when no previous key exists", async () => {
    const networkError = new Error("network")

    await expect(
      withB2Credentials(vi.fn().mockRejectedValue(networkError), source),
    ).rejects.toThrow("network")

    const operation = vi.fn().mockRejectedValue({ status: 403 })
    await expect(withB2Credentials(operation, source)).rejects.toEqual({ status: 403 })
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
