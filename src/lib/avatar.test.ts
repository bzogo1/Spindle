import { describe, expect, it } from "vitest"

import {
  AVATAR_MAX_BYTES,
  avatarBytesFromJsonBody,
  decodeAvatarBase64,
  getAvatar,
  parseAvatarUpload,
  removeAvatar,
  resetAvatarsForTests,
  setAvatar,
  sniffAvatarMime,
} from "./avatar"

// 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64")

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const GIF87A_BYTES = new TextEncoder().encode("GIF87a\x01\x00\x01\x00\x80\x00\x00")
const GIF89A_BYTES = new TextEncoder().encode("GIF89a\x01\x00\x01\x00\x80\x00\x00")
const WEBP_BYTES = (() => {
  const bytes = new Uint8Array(20)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return bytes
})()

describe("sniffAvatarMime", () => {
  it("detects PNG, JPEG, GIF, and WebP magic bytes", () => {
    expect(sniffAvatarMime(PNG_BYTES)).toBe("image/png")
    expect(sniffAvatarMime(JPEG_BYTES)).toBe("image/jpeg")
    expect(sniffAvatarMime(GIF87A_BYTES)).toBe("image/gif")
    expect(sniffAvatarMime(GIF89A_BYTES)).toBe("image/gif")
    expect(sniffAvatarMime(WEBP_BYTES)).toBe("image/webp")
  })

  it("requires the full GIF87a/GIF89a signature, not just a GIF8 prefix", () => {
    expect(sniffAvatarMime(new TextEncoder().encode("GIF8zz not a gif"))).toBeNull()
    expect(sniffAvatarMime(new TextEncoder().encode("GIF8"))).toBeNull()
    expect(sniffAvatarMime(new TextEncoder().encode("GIF87"))).toBeNull()
  })

  it("rejects non-image and SVG payloads", () => {
    expect(
      sniffAvatarMime(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBeNull()
    expect(sniffAvatarMime(new TextEncoder().encode("plain text"))).toBeNull()
    expect(sniffAvatarMime(new Uint8Array(0))).toBeNull()
    // RIFF but not WEBP (e.g. WAV).
    const wav = new Uint8Array(12)
    wav.set([0x52, 0x49, 0x46, 0x46], 0)
    wav.set([0x57, 0x41, 0x56, 0x45], 8)
    expect(sniffAvatarMime(wav)).toBeNull()
  })
})

describe("parseAvatarUpload", () => {
  it("accepts a valid PNG and returns a data URL", () => {
    const result = parseAvatarUpload({ bytes: PNG_BYTES, declaredMime: "image/png" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.avatar.mime).toBe("image/png")
      expect(result.avatar.dataUrl).toBe(`data:image/png;base64,${PNG_BASE64}`)
    }
  })

  it("trusts magic bytes over a lying declared MIME", () => {
    const result = parseAvatarUpload({ bytes: PNG_BYTES, declaredMime: "image/svg+xml" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.avatar.mime).toBe("image/png")
  })

  it("rejects empty uploads", () => {
    const result = parseAvatarUpload({ bytes: new Uint8Array(0) })
    expect(result).toEqual({ ok: false, error: "Choose an image file to upload." })
  })

  it("rejects oversized uploads", () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1)
    big.set(PNG_BYTES.subarray(0, 8), 0)
    const result = parseAvatarUpload({ bytes: big })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/2 MB or smaller/)
  })

  it("rejects bytes that do not sniff as a supported image", () => {
    const result = parseAvatarUpload({
      bytes: new TextEncoder().encode("MZ\x90\x00 not an image"),
      declaredMime: "image/png",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not a supported image/)
  })
})

describe("decodeAvatarBase64 / avatarBytesFromJsonBody", () => {
  it("decodes raw base64 and data URLs", () => {
    expect(decodeAvatarBase64(PNG_BASE64)).toEqual(PNG_BYTES)
    expect(decodeAvatarBase64(`data:image/png;base64,${PNG_BASE64}`)).toEqual(PNG_BYTES)
    expect(decodeAvatarBase64("not base64!!!")).toBeNull()
    expect(decodeAvatarBase64("")).toBeNull()
  })

  it("extracts bytes and declared mime from a dataUrl body", () => {
    const result = avatarBytesFromJsonBody({
      dataUrl: `data:image/webp;base64,${Buffer.from(WEBP_BYTES).toString("base64")}`,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.declaredMime).toBe("image/webp")
      expect(sniffAvatarMime(result.bytes)).toBe("image/webp")
    }
  })

  it("extracts bytes from a raw base64 data body with a mime hint", () => {
    const result = avatarBytesFromJsonBody({
      data: Buffer.from(GIF89A_BYTES).toString("base64"),
      mime: "image/gif",
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.declaredMime).toBe("image/gif")
  })

  it("rejects malformed bodies", () => {
    expect(avatarBytesFromJsonBody(null).ok).toBe(false)
    expect(avatarBytesFromJsonBody({}).ok).toBe(false)
    expect(avatarBytesFromJsonBody({ data: "!!!" }).ok).toBe(false)
  })
})

describe("avatar store", () => {
  it("stores, reads, and removes avatars per principal", () => {
    resetAvatarsForTests()
    expect(getAvatar("user:1")).toBeNull()

    const record = setAvatar("user:1", {
      dataUrl: `data:image/png;base64,${PNG_BASE64}`,
      mime: "image/png",
    })
    expect(record.updatedAt).toBeTruthy()
    expect(getAvatar("user:1")?.dataUrl).toBe(record.dataUrl)
    expect(getAvatar("user:2")).toBeNull()

    expect(removeAvatar("user:1")).toBe(true)
    expect(getAvatar("user:1")).toBeNull()
    expect(removeAvatar("user:1")).toBe(false)
  })
})
