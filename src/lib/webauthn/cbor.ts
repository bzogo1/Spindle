/**
 * Minimal CBOR decoder — just enough for WebAuthn structures.
 *
 * Supported: unsigned ints, negative ints, byte strings, text strings,
 * arrays, maps (definite lengths), tags (unwrapped), and simple values
 * (true/false/null + half/single/double floats). Indefinite-length items
 * throw — WebAuthn payloads never use them.
 *
 * `decodeCborItem` returns the decoded value plus the offset just past the
 * item, which callers need because `authData.attestedCredentialData` embeds
 * a COSE key whose byte length must be known to locate trailing extensions.
 */

export type CborValue =
  null | boolean | number | string | Uint8Array | CborValue[] | Map<number | string, CborValue>

export class CborError extends Error {}

const INDEFINITE = 31

/** Reads the argument bytes for additional info >= 24. */
function readArgument(
  data: Uint8Array,
  offset: number,
  info: number,
): { value: number; offset: number } {
  if (info === 24) {
    if (offset >= data.length) throw new CborError("Truncated CBOR")
    return { value: data[offset], offset: offset + 1 }
  }
  if (info === 25) {
    if (offset + 2 > data.length) throw new CborError("Truncated CBOR")
    return { value: (data[offset] << 8) | data[offset + 1], offset: offset + 2 }
  }
  if (info === 26) {
    if (offset + 4 > data.length) throw new CborError("Truncated CBOR")
    return {
      value: new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0),
      offset: offset + 4,
    }
  }
  if (info === 27) {
    if (offset + 8 > data.length) throw new CborError("Truncated CBOR")
    const view = new DataView(data.buffer, data.byteOffset + offset, 8)
    const value = view.getBigUint64(0)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CborError("CBOR integer too large")
    }
    return { value: Number(value), offset: offset + 8 }
  }
  throw new CborError(`Unsupported CBOR additional info ${info}`)
}

/**
 * For majors 0–6 the additional info encodes an argument (value or length);
 * for major 7 it is the simple/float selector itself and carries no argument.
 */
function head(
  data: Uint8Array,
  offset: number,
): { major: number; info: number; arg: number; next: number } {
  if (offset >= data.length) throw new CborError("Unexpected end of CBOR data")
  const byte = data[offset]
  const major = byte >> 5
  const info = byte & 0x1f
  let cursor = offset + 1
  let arg = info
  if (major !== 7 && info >= 24) {
    const read = readArgument(data, cursor, info)
    arg = read.value
    cursor = read.offset
  }
  return { major, info, arg, next: cursor }
}

export function decodeCborItem(data: Uint8Array, offset = 0): { value: CborValue; next: number } {
  const { major, info, arg, next: contentStart } = head(data, offset)

  switch (major) {
    case 0:
      return { value: arg, next: contentStart }
    case 1:
      return { value: -1 - arg, next: contentStart }
    case 2: {
      if (arg === INDEFINITE) throw new CborError("Indefinite-length byte string unsupported")
      if (contentStart + arg > data.length) throw new CborError("Truncated byte string")
      return { value: data.slice(contentStart, contentStart + arg), next: contentStart + arg }
    }
    case 3: {
      if (arg === INDEFINITE) throw new CborError("Indefinite-length text string unsupported")
      if (contentStart + arg > data.length) throw new CborError("Truncated text string")
      return {
        value: new TextDecoder().decode(data.slice(contentStart, contentStart + arg)),
        next: contentStart + arg,
      }
    }
    case 4: {
      if (arg === INDEFINITE) throw new CborError("Indefinite-length array unsupported")
      let cursor = contentStart
      const items: CborValue[] = []
      for (let i = 0; i < arg; i += 1) {
        const item = decodeCborItem(data, cursor)
        items.push(item.value)
        cursor = item.next
      }
      return { value: items, next: cursor }
    }
    case 5: {
      if (arg === INDEFINITE) throw new CborError("Indefinite-length map unsupported")
      let cursor = contentStart
      const map = new Map<number | string, CborValue>()
      for (let i = 0; i < arg; i += 1) {
        const key = decodeCborItem(data, cursor)
        cursor = key.next
        if (typeof key.value !== "number" && typeof key.value !== "string") {
          throw new CborError("Map key must be int or text")
        }
        const entry = decodeCborItem(data, cursor)
        cursor = entry.next
        map.set(key.value, entry.value)
      }
      return { value: map, next: cursor }
    }
    case 6:
      // Tag: decode the following item and return it (tags are advisory here).
      return decodeCborItem(data, contentStart)
    case 7: {
      // Simple values and floats: `info` is the raw additional info.
      if (info === 20) return { value: false, next: contentStart }
      if (info === 21) return { value: true, next: contentStart }
      if (info === 22 || info === 23) return { value: null, next: contentStart }
      if (info === 25) {
        if (contentStart + 2 > data.length) throw new CborError("Truncated float16")
        const view = new DataView(data.buffer, data.byteOffset + contentStart, 2)
        return { value: view.getFloat16(0), next: contentStart + 2 }
      }
      if (info === 26) {
        if (contentStart + 4 > data.length) throw new CborError("Truncated float32")
        const view = new DataView(data.buffer, data.byteOffset + contentStart, 4)
        return { value: view.getFloat32(0), next: contentStart + 4 }
      }
      if (info === 27) {
        if (contentStart + 8 > data.length) throw new CborError("Truncated float64")
        const view = new DataView(data.buffer, data.byteOffset + contentStart, 8)
        return { value: view.getFloat64(0), next: contentStart + 8 }
      }
      throw new CborError(`Unsupported CBOR simple value ${info}`)
    }
    default:
      throw new CborError(`Unsupported CBOR major type ${major}`)
  }
}

/** Decodes exactly one CBOR item; throws unless it consumes all input. */
export function decodeCbor(data: Uint8Array): CborValue {
  const { value, next } = decodeCborItem(data, 0)
  if (next !== data.length) throw new CborError("Trailing bytes after CBOR item")
  return value
}
