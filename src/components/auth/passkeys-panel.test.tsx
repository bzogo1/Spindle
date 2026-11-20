import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/lib/api/client"
import type { CredentialView } from "@/lib/webauthn/types"

import { PasskeysPanel } from "./passkeys-panel"

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>()
  return { ...actual, request: vi.fn() }
})

const mockedRequest = vi.mocked(request)
const fetchMock = vi.mocked(globalThis.fetch)

const CREDENTIALS_API = "/api/auth/webauthn/credentials"
const REGISTER_BEGIN_API = "/api/auth/webauthn/register/begin"
const REGISTER_COMPLETE_API = "/api/auth/webauthn/register/complete"

const passkeyA: CredentialView = {
  id: "pk-1",
  label: "iPhone",
  kind: "passkey",
  transports: ["internal"],
  createdAt: "2026-01-01T12:00:00.000Z",
  lastUsedAt: "2026-01-02T12:00:00.000Z",
}
const securityKey: CredentialView = {
  id: "key-1",
  label: "YubiKey 5C",
  kind: "security-key",
  transports: ["usb"],
  createdAt: "2026-01-01T12:00:00.000Z",
  lastUsedAt: "2026-01-02T12:00:00.000Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
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

describe("PasskeysPanel", () => {
  it("shows the unsupported state when WebAuthn is unavailable", async () => {
    render(<PasskeysPanel />)
    expect(await screen.findByText("WebAuthn is not supported here")).toBeInTheDocument()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it("lists only passkey-kind credentials, not security keys", async () => {
    enableWebauthn()
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      credentials: [passkeyA, securityKey],
    } as never)
    render(<PasskeysPanel />)

    expect(await screen.findByText("iPhone")).toBeInTheDocument()
    expect(screen.queryByText("YubiKey 5C")).not.toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith("", CREDENTIALS_API)
  })

  it("shows the empty state when no passkeys are registered", async () => {
    enableWebauthn()
    mockedRequest.mockResolvedValueOnce({ ok: true, credentials: [securityKey] } as never)
    render(<PasskeysPanel />)
    expect(await screen.findByText("No passkeys")).toBeInTheDocument()
  })

  it("revokes a passkey after confirmation", async () => {
    enableWebauthn()
    mockedRequest
      .mockResolvedValueOnce({ ok: true, credentials: [passkeyA] } as never)
      .mockResolvedValueOnce({ ok: true, revoked: true } as never)
    render(<PasskeysPanel />)

    const user = userEvent.setup()
    await screen.findByText("iPhone")
    await user.click(screen.getByRole("button", { name: /Revoke iPhone/ }))
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }))

    await waitFor(() => {
      expect(screen.queryByText("iPhone")).not.toBeInTheDocument()
    })
    expect(mockedRequest).toHaveBeenCalledWith("", `${CREDENTIALS_API}/pk-1`, {
      method: "DELETE",
    })
  })

  it("runs the resident-key registration ceremony end-to-end", async () => {
    enableWebauthn()
    const create = vi.mocked(navigator.credentials.create)
    const fakeCredential = {
      id: "new-passkey",
      rawId: new ArrayBuffer(16),
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: new ArrayBuffer(8),
        attestationObject: new ArrayBuffer(16),
        getTransports: () => ["internal"],
      },
      getClientExtensionResults: () => ({}),
    }
    create.mockResolvedValue(fakeCredential as never)

    mockedRequest.mockResolvedValueOnce({ ok: true, credentials: [] } as never) // GET list
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
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "preferred",
              requireResidentKey: true,
            },
            attestation: "none",
          },
        }),
      ) // POST register/begin — must carry { passkey: true }
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          credential: { ...passkeyA, id: "new-passkey", label: "Work iPhone" },
        }),
      ) // POST register/complete

    render(<PasskeysPanel />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /Add passkey/ }))
    await user.type(screen.getByLabelText(/Name this passkey/), "Work iPhone")
    await user.click(screen.getByRole("button", { name: "Register passkey" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        REGISTER_BEGIN_API,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ passkey: true }),
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
    expect(create).toHaveBeenCalled()
    const call = create.mock.calls[0][0] as CredentialCreationOptions
    expect(call.publicKey?.challenge).toBeInstanceOf(ArrayBuffer)
    expect(call.publicKey?.user.id).toBeInstanceOf(ArrayBuffer)
    // residentKey: "required" survives the JSON→Buffer conversion.
    expect(
      (call.publicKey as PublicKeyCredentialCreationOptions).authenticatorSelection?.residentKey,
    ).toBe("required")
    expect(await screen.findByText("Work iPhone")).toBeInTheDocument()
  })

  it("surfaces an error when the passkey prompt is dismissed", async () => {
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

    render(<PasskeysPanel />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: /Add passkey/ }))
    await user.click(screen.getByRole("button", { name: "Register passkey" }))

    expect(await screen.findByText(/prompt was dismissed or timed out/i)).toBeInTheDocument()
  })
})
