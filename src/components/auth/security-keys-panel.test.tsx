import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/lib/api/client"

import { SecurityKeysPanel } from "./security-keys-panel"

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>()
  return { ...actual, request: vi.fn() }
})

const mockedRequest = vi.mocked(request)
const fetchMock = vi.mocked(globalThis.fetch)

const CREDENTIALS_API = "/api/auth/webauthn/credentials"
const REGISTER_BEGIN_API = "/api/auth/webauthn/register/begin"
const REGISTER_COMPLETE_API = "/api/auth/webauthn/register/complete"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const keyA = {
  id: "key-1",
  label: "YubiKey 5C",
  transports: ["usb"],
  createdAt: "2026-01-01T12:00:00.000Z",
  lastUsedAt: "2026-01-02T12:00:00.000Z",
}
const keyB = {
  id: "key-2",
  label: "Touch ID",
  transports: ["internal"],
  createdAt: "2026-01-03T12:00:00.000Z",
  lastUsedAt: "2026-01-03T12:00:00.000Z",
}

function enableWebauthn() {
  Object.defineProperty(window, "PublicKeyCredential", {
    value: class PublicKeyCredential {},
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, "credentials", {
    value: { create: vi.fn(), get: vi.fn() },
    configurable: true,
  })
}

function disableWebauthn() {
  // @ts-expect-error test cleanup
  delete window.PublicKeyCredential
  // @ts-expect-error test cleanup
  delete navigator.credentials
}

beforeEach(() => {
  mockedRequest.mockReset()
  fetchMock.mockReset()
  disableWebauthn()
})

describe("SecurityKeysPanel", () => {
  it("shows the unsupported state when WebAuthn is unavailable", async () => {
    render(<SecurityKeysPanel />)
    expect(await screen.findByText("WebAuthn is not supported here")).toBeInTheDocument()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it("loads and lists registered keys", async () => {
    enableWebauthn()
    mockedRequest.mockResolvedValueOnce({ ok: true, credentials: [keyA, keyB] } as never)
    render(<SecurityKeysPanel />)

    expect(await screen.findByText("YubiKey 5C")).toBeInTheDocument()
    expect(screen.getByText("Touch ID")).toBeInTheDocument()
    expect(screen.getByText("This device")).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith("", CREDENTIALS_API)
  })

  it("shows the empty state when no keys are registered", async () => {
    enableWebauthn()
    mockedRequest.mockResolvedValueOnce({ ok: true, credentials: [] } as never)
    render(<SecurityKeysPanel />)
    expect(await screen.findByText("No security keys")).toBeInTheDocument()
  })

  it("revokes a key after confirmation", async () => {
    enableWebauthn()
    mockedRequest
      .mockResolvedValueOnce({ ok: true, credentials: [keyA] } as never)
      .mockResolvedValueOnce({ ok: true, revoked: true } as never)
    render(<SecurityKeysPanel />)

    const user = userEvent.setup()
    await screen.findByText("YubiKey 5C")
    await user.click(screen.getByRole("button", { name: /Revoke YubiKey 5C/ }))
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }))

    await waitFor(() => {
      expect(screen.queryByText("YubiKey 5C")).not.toBeInTheDocument()
    })
    expect(mockedRequest).toHaveBeenCalledWith("", `${CREDENTIALS_API}/key-1`, {
      method: "DELETE",
    })
  })

  it("runs the registration ceremony end-to-end", async () => {
    enableWebauthn()
    const create = vi.mocked(navigator.credentials.create)
    const fakeCredential = {
      id: "new-key",
      rawId: new ArrayBuffer(16),
      type: "public-key",
      authenticatorAttachment: "cross-platform",
      response: {
        clientDataJSON: new ArrayBuffer(8),
        attestationObject: new ArrayBuffer(16),
        getTransports: () => ["usb"],
      },
      getClientExtensionResults: () => ({}),
    }
    create.mockResolvedValue(fakeCredential as never)

    mockedRequest
      .mockResolvedValueOnce({ ok: true, credentials: [] } as never) // GET list
      .mockResolvedValueOnce({ ok: true, credentials: [{ ...keyA, id: "new-key" }] } as never) // reload
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          challengeId: "ch-1",
          options: {
            challenge: "Y2hhbGxlbmdl",
            rp: { name: "Spindle", id: "localhost" },
            user: { id: "dTE", name: "a@b.c", displayName: "A" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            timeout: 60000,
            excludeCredentials: [],
            authenticatorSelection: {},
            attestation: "none",
          },
        }),
      ) // POST register/begin — security-key flow ({ passkey: false })
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          credential: { ...keyA, id: "new-key", label: "Security key", kind: "security-key" },
        }),
      ) // POST register/complete

    render(<SecurityKeysPanel />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /Add security key/ }))
    await user.type(screen.getByLabelText(/Name this key/), "Office key")
    await user.click(screen.getByRole("button", { name: "Register key" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        REGISTER_BEGIN_API,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ passkey: false }),
        }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        REGISTER_COMPLETE_API,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"challengeId":"ch-1"'),
        }),
      )
    })
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTER_COMPLETE_API,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"label":"Office key"'),
      }),
    )
    expect(create).toHaveBeenCalled()
    // The credential passed to create() has ArrayBuffer challenge/user.id.
    const call = create.mock.calls[0][0] as CredentialCreationOptions
    expect(call.publicKey?.challenge).toBeInstanceOf(ArrayBuffer)
    expect(call.publicKey?.user.id).toBeInstanceOf(ArrayBuffer)
  })

  it("surfaces an error when registration is dismissed", async () => {
    enableWebauthn()
    vi.mocked(navigator.credentials.create).mockRejectedValue(
      new DOMException("dismissed", "NotAllowedError"),
    )
    mockedRequest.mockResolvedValueOnce({ ok: true, credentials: [] } as never)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        challengeId: "ch-1",
        options: {
          challenge: "eA",
          rp: { name: "Spindle", id: "localhost" },
          user: { id: "dTE", name: "a@b.c", displayName: "A" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 60000,
          excludeCredentials: [],
          authenticatorSelection: {},
          attestation: "none",
        },
      }),
    )

    render(<SecurityKeysPanel />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /Add security key/ }))
    await user.click(screen.getByRole("button", { name: "Register key" }))

    expect(await screen.findByText(/prompt was dismissed or timed out/i)).toBeInTheDocument()
  })
})
