import { describe, expect, it, vi } from "vitest"

import type { UploadSession } from "./transport"
import { B2Transport, S3MultipartTransport } from "./transport"

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

type FetchCall = { url: string; method: string; headers: Headers; body: unknown }

function recordFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    })
    return handler(url, init)
  })
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch }
}

const session: UploadSession = {
  sessionId: "upload-1",
  uploadId: "upload-1",
  key: "dir/report.pdf",
}

describe("S3MultipartTransport", () => {
  it("initUpload posts ?uploads and parses an XML UploadId", async () => {
    const { calls, fetchImpl } = recordFetch(() =>
      textResponse(
        `<InitiateMultipartUploadResult><UploadId>xml-id-1</UploadId></InitiateMultipartUploadResult>`,
      ),
    )
    const transport = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/bucket/",
      fetchImpl,
    })

    const result = await transport.initUpload({
      key: "dir/report.pdf",
      fileName: "report.pdf",
      size: 100,
    })

    expect(result).toMatchObject({
      sessionId: "xml-id-1",
      uploadId: "xml-id-1",
      key: "dir/report.pdf",
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("POST")
    expect(calls[0].url).toContain("https://s3.example.com/bucket/dir/report.pdf?uploads=")
  })

  it("initUpload parses a JSON UploadId and merges auth headers", async () => {
    const { calls, fetchImpl } = recordFetch(() => jsonResponse({ uploadId: "json-id-2" }))
    const transport = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/bucket",
      auth: () => ({ Authorization: "Bearer token" }),
      fetchImpl,
    })

    const result = await transport.initUpload({ key: "a.bin", fileName: "a.bin", size: 1 })
    expect(result.uploadId).toBe("json-id-2")
    expect(calls[0].headers.get("authorization")).toBe("Bearer token")
  })

  it("initUpload rejects on HTTP errors and missing UploadId", async () => {
    const failing = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("nope", { status: 500 })) as typeof fetch,
    })
    await expect(failing.initUpload({ key: "k", fileName: "k", size: 1 })).rejects.toThrow(
      "S3 initUpload failed: 500",
    )

    const missing = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("<x/>")) as typeof fetch,
    })
    await expect(missing.initUpload({ key: "k", fileName: "k", size: 1 })).rejects.toThrow(
      "missing UploadId",
    )
  })

  it("uploadPart PUTs the blob, sends a checksum header and strips ETag quotes", async () => {
    const { calls, fetchImpl } = recordFetch(() =>
      textResponse("", { headers: { etag: '"abc123"' } }),
    )
    const transport = new S3MultipartTransport({ baseUrl: "https://s3.example.com/b", fetchImpl })
    const onProgress = vi.fn()
    const hex = "a".repeat(64)

    const part = await transport.uploadPart(
      session,
      {
        partNumber: 3,
        data: new Blob(["chunk"], { type: "application/octet-stream" }),
        checksum: `sha256:${hex}`,
      },
      undefined,
      onProgress,
    )

    expect(part).toEqual({ partNumber: 3, etag: "abc123" })
    expect(calls[0].method).toBe("PUT")
    expect(calls[0].url).toContain("partNumber=3")
    expect(calls[0].url).toContain("uploadId=upload-1")
    expect(calls[0].headers.get("x-amz-checksum-sha256")).toBeTruthy()
    expect(onProgress).toHaveBeenCalledWith(5)
  })

  it("uploadPart rejects without an ETag or on HTTP errors", async () => {
    const noEtag = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("")) as typeof fetch,
    })
    await expect(
      noEtag.uploadPart(session, { partNumber: 1, data: new Blob(["x"]) }),
    ).rejects.toThrow("missing ETag")

    const failing = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("", { status: 403 })) as typeof fetch,
    })
    await expect(
      failing.uploadPart(session, { partNumber: 1, data: new Blob(["x"]) }),
    ).rejects.toThrow("S3 uploadPart 1 failed: 403")
  })

  it("completeUpload sends sorted XML parts and parses Location", async () => {
    const { calls, fetchImpl } = recordFetch(() =>
      textResponse(
        `<CompleteMultipartUploadResult><Location>https://s3.example.com/b/dir/report.pdf</Location></CompleteMultipartUploadResult>`,
      ),
    )
    const transport = new S3MultipartTransport({ baseUrl: "https://s3.example.com/b", fetchImpl })

    const result = await transport.completeUpload(session, [
      { partNumber: 2, etag: '"e&2"' },
      { partNumber: 1, etag: '"e1"' },
    ])

    expect(result.location).toBe("https://s3.example.com/b/dir/report.pdf")
    const body = String(calls[0].body)
    expect(calls[0].method).toBe("POST")
    expect(calls[0].url).toContain("uploadId=upload-1")
    expect(body.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(
      body.indexOf("<PartNumber>2</PartNumber>"),
    )
    expect(body).toContain("e&amp;2")
  })

  it("completeUpload rejects on HTTP errors", async () => {
    const transport = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("err", { status: 400 })) as typeof fetch,
    })
    await expect(transport.completeUpload(session, [{ partNumber: 1, etag: "e" }])).rejects.toThrow(
      "S3 completeUpload failed: 400",
    )
  })

  it("abortUpload tolerates 404 but rejects other errors", async () => {
    const ok = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch,
    })
    await expect(ok.abortUpload(session)).resolves.toBeUndefined()

    const gone = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("", { status: 404 })) as typeof fetch,
    })
    await expect(gone.abortUpload(session)).resolves.toBeUndefined()

    const failing = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("", { status: 500 })) as typeof fetch,
    })
    await expect(failing.abortUpload(session)).rejects.toThrow("S3 abortUpload failed: 500")
  })

  it("listParts parses JSON and XML part lists", async () => {
    const json = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () =>
        jsonResponse({
          Parts: [
            { PartNumber: 2, ETag: '"e2"' },
            { partNumber: 1, etag: "e1" },
          ],
        })) as typeof fetch,
    })
    await expect(json.listParts(session)).resolves.toEqual([
      { partNumber: 1, etag: "e1" },
      { partNumber: 2, etag: "e2" },
    ])

    const xml = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () =>
        textResponse(
          `<ListPartsResult><Part><PartNumber>2</PartNumber><ETag>"x2"</ETag></Part><Part><PartNumber>1</PartNumber><ETag>"x1"</ETag></Part></ListPartsResult>`,
        )) as typeof fetch,
    })
    await expect(xml.listParts(session)).resolves.toEqual([
      { partNumber: 1, etag: "x1" },
      { partNumber: 2, etag: "x2" },
    ])
  })

  it("listParts rejects on HTTP errors", async () => {
    const transport = new S3MultipartTransport({
      baseUrl: "https://s3.example.com/b",
      fetchImpl: (async () => textResponse("", { status: 403 })) as typeof fetch,
    })
    await expect(transport.listParts(session)).rejects.toThrow("S3 listParts failed: 403")
  })
})

describe("B2Transport", () => {
  const options = {
    apiUrl: "https://api.backblazeb2.com",
    accountId: "account-1",
    applicationKey: "key-1",
    bucketId: "bucket-1",
  }

  function b2Fetch(
    overrides: {
      authorize?: Response
      start?: unknown
      partUrl?: unknown
      complete?: unknown
      cancel?: unknown
    } = {},
  ) {
    return recordFetch((url) => {
      if (url.endsWith("/b2_authorize_account")) {
        return (
          overrides.authorize ??
          jsonResponse({
            authorizationToken: "auth-tok",
            apiInfo: { storageApi: { apiUrl: "https://api2.example.com/" } },
          })
        )
      }
      if (url.endsWith("/b2_start_large_file")) {
        return jsonResponse(overrides.start ?? { fileId: "file-1" })
      }
      if (url.endsWith("/b2_get_upload_part_url")) {
        return jsonResponse(
          overrides.partUrl ?? {
            uploadUrl: "https://upload.example.com/part",
            authorizationToken: "part-tok",
          },
        )
      }
      if (url.endsWith("/b2_complete_large_file")) {
        return jsonResponse(overrides.complete ?? { fileId: "file-1", fileName: "report.pdf" })
      }
      if (url.endsWith("/b2_cancel_large_file")) {
        return jsonResponse(overrides.cancel ?? { fileId: "file-1" })
      }
      if (url === "https://upload.example.com/part") {
        return textResponse("", { headers: { "x-bz-content-sha1": "" } })
      }
      return textResponse("not found", { status: 404 })
    })
  }

  it("initUpload authorizes once, starts the file and returns part-url state", async () => {
    const { calls, fetchImpl } = b2Fetch()
    const transport = new B2Transport({ ...options, fetchImpl })

    const result = await transport.initUpload({
      key: "report.pdf",
      fileName: "report.pdf",
      size: 100,
      contentType: "application/pdf",
    })

    expect(result.sessionId).toBe("file-1")
    expect(result.state).toMatchObject({
      uploadUrl: "https://upload.example.com/part",
      authToken: "part-tok",
    })

    const authCalls = calls.filter((c) => c.url.endsWith("/b2_authorize_account"))
    expect(authCalls).toHaveLength(1)
    const expected = `Basic ${btoa(`${options.accountId}:${options.applicationKey}`)}`
    expect(authCalls[0].headers.get("authorization")).toBe(expected)

    // apiInfo.storageApi.apiUrl overrides the initial api host.
    const startCall = calls.find((c) => c.url.endsWith("/b2_start_large_file"))
    expect(startCall?.url).toBe("https://api2.example.com/b2api/v2/b2_start_large_file")
    expect(startCall?.headers.get("authorization")).toBe("auth-tok")

    // Authorization is cached across subsequent API calls.
    await transport.listParts()
    expect(calls.filter((c) => c.url.endsWith("/b2_authorize_account"))).toHaveLength(1)
  })

  it("initUpload returns the persisted session when resuming", async () => {
    const { calls, fetchImpl } = b2Fetch()
    const transport = new B2Transport({ ...options, fetchImpl })

    const result = await transport.initUpload({
      key: "k",
      fileName: "k",
      size: 1,
      resumeUploadId: "existing-file",
    })

    expect(result).toMatchObject({ sessionId: "existing-file", uploadId: "existing-file" })
    expect(calls).toHaveLength(0)
  })

  it("initUpload propagates authorization failures", async () => {
    const { fetchImpl } = b2Fetch({ authorize: jsonResponse({ message: "bad" }, 401) })
    const transport = new B2Transport({ ...options, fetchImpl })
    await expect(transport.initUpload({ key: "k", fileName: "k", size: 1 })).rejects.toThrow(
      "B2 authorize failed: 401",
    )
  })

  it("uploadPart posts to the session upload URL with part headers", async () => {
    const { calls, fetchImpl } = b2Fetch()
    const transport = new B2Transport({ ...options, fetchImpl })
    const session: UploadSession = {
      sessionId: "file-1",
      uploadId: "file-1",
      state: { uploadUrl: "https://upload.example.com/part", authToken: "part-tok" },
    }

    const result = await transport.uploadPart(session, {
      partNumber: 2,
      data: new Blob(["chunk"]),
    })

    const call = calls.find((c) => c.url === "https://upload.example.com/part")
    expect(call?.method).toBe("POST")
    expect(call?.headers.get("authorization")).toBe("part-tok")
    expect(call?.headers.get("x-bz-part-number")).toBe("2")
    expect(result).toEqual({ partNumber: 2, etag: "b2-file-1-2" })
  })

  it("uploadPart uses the x-bz-content-sha1 response header as etag", async () => {
    const { calls, fetchImpl } = recordFetch(() =>
      textResponse("", { headers: { "x-bz-content-sha1": "deadbeef" } }),
    )
    const transport = new B2Transport({ ...options, fetchImpl })
    const session: UploadSession = {
      sessionId: "file-1",
      state: { uploadUrl: "https://upload.example.com/part", authToken: "t" },
    }
    const result = await transport.uploadPart(session, { partNumber: 1, data: new Blob(["x"]) })
    expect(result.etag).toBe("deadbeef")
    expect(calls[0].headers.get("x-bz-content-sha1")).toBe("do_not_verify")
  })

  it("uploadPart rejects when the session lacks upload state", async () => {
    const transport = new B2Transport({ ...options, fetchImpl: vi.fn() as unknown as typeof fetch })
    await expect(
      transport.uploadPart(
        { sessionId: "s", uploadId: "s" },
        { partNumber: 1, data: new Blob(["x"]) },
      ),
    ).rejects.toThrow("B2 session missing upload URL")
  })

  it("completeUpload sends a sorted partSha1Array and returns a b2 location", async () => {
    const { calls, fetchImpl } = b2Fetch()
    const transport = new B2Transport({ ...options, fetchImpl })

    const result = await transport.completeUpload({ sessionId: "file-1", uploadId: "file-1" }, [
      { partNumber: 2, etag: "sha-2" },
      { partNumber: 1, etag: "sha-1" },
    ])

    expect(result).toEqual({ key: "report.pdf", location: "b2://bucket-1/report.pdf" })
    const call = calls.find((c) => c.url.endsWith("/b2_complete_large_file"))
    const body = JSON.parse(String(call?.body)) as { partSha1Array: string[] }
    expect(body.partSha1Array).toEqual(["sha-1", "sha-2"])
  })

  it("abortUpload calls b2_cancel_large_file", async () => {
    const { calls, fetchImpl } = b2Fetch()
    const transport = new B2Transport({ ...options, fetchImpl })
    await transport.abortUpload({ sessionId: "file-1", uploadId: "file-1" })
    expect(calls.some((c) => c.url.endsWith("/b2_cancel_large_file"))).toBe(true)
  })

  it("listParts returns an empty list (unsupported by the B2 native API)", async () => {
    const transport = new B2Transport({ ...options, fetchImpl: vi.fn() as unknown as typeof fetch })
    await expect(transport.listParts()).resolves.toEqual([])
  })
})
