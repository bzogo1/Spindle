import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AvatarUpload } from "./avatar-upload"

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function mockAvatarApi({
  initialAvatar = null,
  putStatus = 200,
}: {
  initialAvatar?: { dataUrl: string; mime: string; updatedAt: string } | null
  putStatus?: number
} = {}) {
  let stored = initialAvatar
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = requestUrl(input)
    if (!url.includes("/api/avatar")) {
      return Promise.resolve(jsonResponse({ ok: false }, 404))
    }
    if (init?.method === "PUT") {
      if (putStatus !== 200) {
        return Promise.resolve(
          jsonResponse({ ok: false, code: "invalid_avatar", message: "bad image" }, putStatus),
        )
      }
      const body = JSON.parse(String(init.body)) as { dataUrl: string }
      stored = { dataUrl: body.dataUrl, mime: "image/png", updatedAt: "2026-01-01T00:00:00Z" }
      return Promise.resolve(jsonResponse({ ok: true, avatar: stored }))
    }
    if (init?.method === "DELETE") {
      stored = null
      return Promise.resolve(jsonResponse({ ok: true, avatar: null }))
    }
    return Promise.resolve(jsonResponse({ ok: true, avatar: stored }))
  })
  return () => stored
}

function avatarCalls(method?: string) {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) =>
        requestUrl(input).includes("/api/avatar") && (!method || init?.method === method),
    )
}

async function fileInput(): Promise<HTMLInputElement> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  // The input stays disabled until the initial GET /api/avatar settles.
  await waitFor(() => expect(input).toBeEnabled())
  return input
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("AvatarUpload", () => {
  it("loads the current avatar and shows the initials fallback", async () => {
    mockAvatarApi()
    render(<AvatarUpload name="Bogdan Zogovic" />)

    expect(await screen.findByText(/Drop an image or click to browse/)).toBeInTheDocument()
    expect(avatarCalls("GET").length + avatarCalls().length).toBeGreaterThan(0)
    // No image stored → decorative initials avatar.
    await waitFor(() => expect(avatarCalls().length).toBeGreaterThan(0))
    expect(document.querySelector(".app-avatar")).toHaveAttribute("data-initial", "B")
  })

  it("shows the stored avatar image", async () => {
    mockAvatarApi({
      initialAvatar: { dataUrl: PNG_DATA_URL, mime: "image/png", updatedAt: "x" },
    })
    render(<AvatarUpload name="Bogdan" />)

    const img = await screen.findByRole("img", { name: "Bogdan avatar" })
    expect(img).toHaveAttribute("src", PNG_DATA_URL)
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument()
  })

  it("uploads a valid image as a JSON dataUrl", async () => {
    const user = userEvent.setup()
    mockAvatarApi()
    render(<AvatarUpload name="Bogdan" />)

    const input = await fileInput()
    const file = new File([PNG_BYTES], "me.png", { type: "image/png" })
    await user.upload(input, file)

    await waitFor(() => expect(avatarCalls("PUT")).toHaveLength(1))
    const putCall = avatarCalls("PUT")[0]
    expect(JSON.parse(String(putCall[1]?.body))).toEqual({ dataUrl: PNG_DATA_URL })

    expect(await screen.findByRole("img", { name: "Bogdan avatar" })).toHaveAttribute(
      "src",
      PNG_DATA_URL,
    )
  })

  it("rejects files that fail magic-byte validation without calling the API", async () => {
    const user = userEvent.setup()
    mockAvatarApi()
    render(<AvatarUpload name="Bogdan" />)

    const input = await fileInput()
    const fake = new File([new TextEncoder().encode("<svg>not really a png</svg>")], "fake.png", {
      type: "image/png",
    })
    await user.upload(input, fake)

    expect(await screen.findByRole("alert")).toHaveTextContent(/not a supported image/)
    expect(avatarCalls("PUT")).toHaveLength(0)
  })

  it("surfaces server-side upload errors", async () => {
    const user = userEvent.setup()
    mockAvatarApi({ putStatus: 422 })
    render(<AvatarUpload name="Bogdan" />)

    const input = await fileInput()
    const file = new File([PNG_BYTES], "me.png", { type: "image/png" })
    await user.upload(input, file)

    expect(await screen.findByRole("alert")).toHaveTextContent("bad image")
  })

  it("removes the avatar via DELETE", async () => {
    const user = userEvent.setup()
    mockAvatarApi({
      initialAvatar: { dataUrl: PNG_DATA_URL, mime: "image/png", updatedAt: "x" },
    })
    render(<AvatarUpload name="Bogdan" />)

    await user.click(await screen.findByRole("button", { name: /remove/i }))

    await waitFor(() => expect(avatarCalls("DELETE")).toHaveLength(1))
    await waitFor(() =>
      expect(document.querySelector(".app-avatar")).toHaveAttribute("data-initial", "B"),
    )
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })
})
