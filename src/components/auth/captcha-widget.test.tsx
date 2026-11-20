import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"
import { CaptchaWidget, MAX_CAPTCHA_DIFFICULTY, solveProofOfWork } from "./captcha-widget"

const fetchMock = vi.mocked(globalThis.fetch)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function leadingZeroBits(digest: Buffer): number {
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    for (let mask = 0x80; mask !== 0; mask >>= 1) {
      if (byte & mask) return bits
      bits += 1
    }
    return bits
  }
  return bits
}

const CHALLENGE = {
  ok: true,
  challengeId: "0123456789abcdef",
  prefix: "spindle-pow:0123456789abcdef:testsalt:",
  difficulty: 8,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
}

/** Routes fetch calls between the captcha endpoints and everything else. */
function mockCaptchaEndpoints(verify?: (nonce: string) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url === "/api/auth/captcha" && method === "GET") return jsonResponse(CHALLENGE)
    if (url === "/api/auth/captcha/verify" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { challengeId: string; nonce: string }
      if (verify) return verify(body.nonce)
      return jsonResponse({ ok: true, token: "captcha-token-123", expiresAt: "soon" })
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
}

function renderWidget(onToken = vi.fn(), onStatusChange?: (s: string) => void) {
  render(
    <LanguageProvider>
      <CaptchaWidget onToken={onToken} onStatusChange={onStatusChange} />
    </LanguageProvider>,
  )
  return onToken
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe("solveProofOfWork", () => {
  it("finds a nonce whose sha256(prefix+nonce) meets the difficulty", async () => {
    const nonce = await solveProofOfWork(CHALLENGE.prefix, 10)
    const digest = createHash("sha256").update(`${CHALLENGE.prefix}${nonce}`, "utf8").digest()
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(10)
  }, 10000)
})

describe("CaptchaWidget", () => {
  it("fetches a challenge, solves it, verifies, and reports the token", async () => {
    mockCaptchaEndpoints((nonce) => {
      const digest = createHash("sha256").update(`${CHALLENGE.prefix}${nonce}`, "utf8").digest()
      expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(CHALLENGE.difficulty)
      return jsonResponse({ ok: true, token: "captcha-token-123" })
    })
    const onToken = vi.fn()
    const onStatusChange = vi.fn()
    renderWidget(onToken, onStatusChange)

    await waitFor(() => expect(onToken).toHaveBeenCalledWith("captcha-token-123"))
    expect(onStatusChange).toHaveBeenCalledWith("verified")
    expect(await screen.findByText("Security check passed.")).toBeInTheDocument()

    const verifyCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/auth/captcha/verify" && init?.method === "POST",
    )
    expect(verifyCall).toBeDefined()
  }, 10000)

  it("shows a retry control when the challenge request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    const onToken = vi.fn()
    renderWidget(onToken)

    const retry = await screen.findByRole("button", { name: "Retry" })
    expect(onToken).toHaveBeenCalledWith(null)

    // Recovery: second attempt succeeds end-to-end.
    mockCaptchaEndpoints()
    await userEvent.click(retry)
    await waitFor(() => expect(onToken).toHaveBeenLastCalledWith("captcha-token-123"))
  }, 10000)

  it("surfaces an error state when verification rejects the solution", async () => {
    mockCaptchaEndpoints(() => jsonResponse({ ok: false, code: "captcha_failed" }, 403))
    renderWidget(vi.fn())

    expect(await screen.findByRole("alert")).toHaveTextContent("Security check unavailable.")
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  }, 10000)

  it("rejects challenges with an absurd difficulty instead of solving them", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === "/api/auth/captcha") {
        return jsonResponse({ ...CHALLENGE, difficulty: MAX_CAPTCHA_DIFFICULTY + 1 })
      }
      throw new Error("unexpected fetch")
    })
    renderWidget(vi.fn())

    expect(await screen.findByRole("alert")).toHaveTextContent("Security check unavailable.")
    // The verify endpoint must never be hit for a rejected challenge.
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === "/api/auth/captcha/verify"),
    ).toBe(false)
  })

  it("gives up on challenges that are already expired", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === "/api/auth/captcha") {
        return jsonResponse({ ...CHALLENGE, expiresAt: new Date(Date.now() - 1000).toISOString() })
      }
      throw new Error("unexpected fetch")
    })
    renderWidget(vi.fn())

    expect(await screen.findByRole("alert")).toHaveTextContent("Security check unavailable.")
  })
})
