import { render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { UnsubscribeForm } from "./unsubscribe-form"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const subscribedStatus = {
  ok: true,
  email: "reader@lab.edu",
  scope: "marketing",
  subscribed: true,
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("UnsubscribeForm", () => {
  it("shows an invalid-link state when no token is provided", () => {
    render(<UnsubscribeForm />)
    expect(screen.getByRole("alert")).toHaveTextContent(/missing or incomplete/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("loads status and confirms unsubscribe with a POST", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(subscribedStatus))
      .mockResolvedValueOnce(jsonResponse({ ok: true, subscribed: false }))

    render(<UnsubscribeForm token="tok123" email="reader@lab.edu" />)

    // Status fetch happens on mount.
    expect(await screen.findByText("Confirm unsubscribe.")).toBeInTheDocument()
    expect(screen.getByText("reader@lab.edu")).toBeInTheDocument()
    expect(screen.getByText(/marketing emails/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Unsubscribe" }))

    expect(await screen.findByText("You're unsubscribed.")).toBeInTheDocument()

    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(url).toBe("/api/email/unsubscribe")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toMatchObject({ token: "tok123" })
  })

  it("keeps the confirm button after a transient POST failure so the user can retry", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(subscribedStatus))
      .mockResolvedValueOnce(jsonResponse({ ok: false, message: "Too many attempts." }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true, subscribed: false }))

    render(<UnsubscribeForm token="tok" />)
    await screen.findByText("Confirm unsubscribe.")

    await user.click(screen.getByRole("button", { name: "Unsubscribe" }))

    // Error is shown inline, but the confirm button stays — no reload needed.
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts.")
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Unsubscribe" }))
    expect(await screen.findByText("You're unsubscribed.")).toBeInTheDocument()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it("keeps the confirm button when the POST fetch rejects", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(subscribedStatus))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, subscribed: false }))

    render(<UnsubscribeForm token="tok" />)
    await screen.findByText("Confirm unsubscribe.")

    await user.click(screen.getByRole("button", { name: "Unsubscribe" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Check your connection/)
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeInTheDocument()
  })

  it("offers a retry when the status GET fails", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(subscribedStatus))

    render(<UnsubscribeForm token="tok" />)

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Confirm unsubscribe.")).toBeInTheDocument()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it("shows the already-unsubscribed state without a confirm button", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, email: "gone@lab.edu", scope: "all", subscribed: false }),
    )
    render(<UnsubscribeForm token="tok" />)

    expect(await screen.findByText("Already unsubscribed.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).not.toBeInTheDocument()
    expect(screen.getByText(/all Spindle emails/)).toBeInTheDocument()
  })

  it("shows the server error for an invalid token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: false, message: "This unsubscribe link is invalid or has expired." }, 400),
    )
    render(<UnsubscribeForm token="bad" />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/)
  })

  it("drops to the invalid state when POST returns 400", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(subscribedStatus))
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, message: "This unsubscribe link is invalid or has expired." },
          400,
        ),
      )

    render(<UnsubscribeForm token="tok" />)
    await screen.findByText("Confirm unsubscribe.")
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }))

    expect(await screen.findByText("Link problem")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).not.toBeInTheDocument()
  })

  it("SSR output is a static card, never the perpetual loader (noscript-safe)", () => {
    const html = renderToString(<UnsubscribeForm token="tok" email="reader@lab.edu" />)
    expect(html).toContain("Email preferences")
    expect(html).toContain("reader@lab.edu")
    expect(html).toContain("hello@spindle.example")
    expect(html).not.toContain("Checking your unsubscribe link")
  })
})
