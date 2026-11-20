/**
 * Chunked splitting of Blobs/Files for multipart-style uploads.
 *
 * Chunks are 1-indexed to match S3/B2 part numbering conventions.
 */

export interface FileChunk {
  /** 1-based part number. */
  index: number
  /** Byte offset of the chunk start within the source blob. */
  start: number
  /** Byte offset one past the chunk end (exclusive). */
  end: number
  size: number
  blob: Blob
  /** Lowercase hex content hash, filled in by {@link hashBlob}. */
  checksum?: string
}

export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024 // 8 MiB

/**
 * Split a Blob/File into ordered chunks of at most `chunkSize` bytes.
 * The final chunk may be smaller. An empty blob yields a single zero-byte
 * chunk so callers always have at least one part to reason about.
 */
export function buildChunks(blob: Blob, chunkSize: number = DEFAULT_CHUNK_SIZE): FileChunk[] {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new RangeError(`chunkSize must be a positive number, got ${chunkSize}`)
  }

  const size = blob.size
  if (size === 0) {
    return [{ index: 1, start: 0, end: 0, size: 0, blob: blob.slice(0, 0) }]
  }

  const chunks: FileChunk[] = []
  let offset = 0
  let index = 1
  while (offset < size) {
    const end = Math.min(offset + chunkSize, size)
    chunks.push({
      index,
      start: offset,
      end,
      size: end - offset,
      blob: blob.slice(offset, end),
    })
    offset = end
    index += 1
  }
  return chunks
}

/**
 * Compute a content hash for a blob. Uses SHA-256 via WebCrypto when
 * available and falls back to a synchronous FNV-1a hash otherwise
 * (e.g. non-secure contexts or test environments without subtle crypto).
 *
 * Returns a `sha256:`/`fnv1a:` prefixed hex string so transports can pick
 * the matching algorithm (S3 expects base64-encoded checksums; adapt in the
 * transport layer).
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest("SHA-256", await blob.arrayBuffer())
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    return `sha256:${hex}`
  }
  return `fnv1a:${fnv1aHex(await blob.arrayBuffer())}`
}

function fnv1aHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  // FNV-1a 64-bit, kept in two 32-bit halves.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193)
    h2 = Math.imul(h2 ^ bytes[i], 0x85ebca6b)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`
}
