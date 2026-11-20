// @vitest-environment node
import { describe, expect, it } from "vitest"

import { decodeCbor, decodeCborItem } from "./cbor"
import { encodeCbor, type Encoded } from "./test-utils"

describe("decodeCbor", () => {
  it("decodes unsigned ints including multi-byte arguments", () => {
    expect(decodeCbor(new Uint8Array([0x00]))).toBe(0)
    expect(decodeCbor(new Uint8Array([0x17]))).toBe(23)
    expect(decodeCbor(new Uint8Array([0x18, 0xff]))).toBe(255)
    expect(decodeCbor(new Uint8Array([0x19, 0x01, 0x00]))).toBe(256)
    expect(decodeCbor(new Uint8Array([0x1a, 0x00, 0x01, 0x00, 0x00]))).toBe(65536)
  })

  it("decodes negative ints", () => {
    expect(decodeCbor(new Uint8Array([0x20]))).toBe(-1)
    expect(decodeCbor(new Uint8Array([0x37]))).toBe(-24)
    // -7 (COSE ES256 alg) encodes as 0x26
    expect(decodeCbor(new Uint8Array([0x26]))).toBe(-7)
  })

  it("decodes byte and text strings", () => {
    expect(decodeCbor(new Uint8Array([0x42, 0xde, 0xad]))).toEqual(new Uint8Array([0xde, 0xad]))
    expect(decodeCbor(new Uint8Array([0x63, 0x66, 0x6f, 0x6f]))).toBe("foo")
  })

  it("decodes arrays and maps", () => {
    const value = decodeCbor(encodeCbor([1, "two", [3]]))
    expect(value).toEqual([1, "two", [3]])

    const map = decodeCbor(
      encodeCbor(
        new Map<Encoded, Encoded>([
          ["fmt", "none"],
          ["authData", new Uint8Array([1, 2])],
        ]),
      ),
    )
    expect(map).toBeInstanceOf(Map)
    expect((map as Map<string, unknown>).get("fmt")).toBe("none")
    expect((map as Map<string, unknown>).get("authData")).toEqual(new Uint8Array([1, 2]))
  })

  it("decodes simple values and floats", () => {
    expect(decodeCbor(new Uint8Array([0xf4]))).toBe(false)
    expect(decodeCbor(new Uint8Array([0xf5]))).toBe(true)
    expect(decodeCbor(new Uint8Array([0xf6]))).toBeNull()
    expect(decodeCbor(new Uint8Array([0xfa, 0x3f, 0x80, 0, 0]))).toBe(1)
  })

  it("unwraps tags", () => {
    // tag 1 (epoch date) wrapping int 0 → 0
    expect(decodeCbor(new Uint8Array([0xc1, 0x00]))).toBe(0)
  })

  it("rejects indefinite lengths, trailing data, and truncation", () => {
    expect(() => decodeCbor(new Uint8Array([0x5f]))).toThrow()
    expect(() => decodeCbor(new Uint8Array([0x00, 0x00]))).toThrow(/Trailing/)
    expect(() => decodeCbor(new Uint8Array([0x41]))).toThrow()
  })

  it("decodeCborItem reports the offset just past the item", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03])
    const item = decodeCborItem(data, 0)
    expect(item.value).toBe(1)
    expect(item.next).toBe(1)
  })
})
