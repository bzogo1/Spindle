import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NewsletterForm } from "./newsletter-form"
import { HONEYPOT_FIELD, NEWSLETTER_SOURCE } from "@/lib/site-forms"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("NewsletterForm", () => {
  it("requires a valid email before submitting", async () => {
    const user = userEvent.setup()
    const { container } = render(<NewsletterForm />)
    const form = container.querySelector("form")!

    // fireEvent.submit bypasses jsdom's native constraint validation so the
    // component's own checks run (browsers block empty submits natively).
    fireEvent.submit(form)
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Product updates"), "nope")
    fireEvent.submit(form)
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("requires consent before submitting", async () => {
    const user = userEvent.setup()
    const { container } = render(<NewsletterForm />)
    const form = container.querySelector("form")!

    await user.type(screen.getByLabelText("Product updates"), "reader@lab.edu")
    fireEvent.submit(form)
    expect(screen.getByRole("alert")).toHaveTextContent(/Privacy Policy/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts email, source, consent, and honeypot to /api/newsletter", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, message: "subscribed" }))
    render(<NewsletterForm />)

    await user.type(screen.getByLabelText("Product updates"), "  reader@lab.edu  ")
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "Subscribe" }))

    expect(await screen.findByText(/You're subscribed/)).toBeInTheDocument()

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("/api/newsletter")
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      email: "reader@lab.edu",
      source: NEWSLETTER_SOURCE,
      consent: true,
    })
    expect(body).toHaveProperty(HONEYPOT_FIELD, "")
  })

  it("shows the server message on failure", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: false, message: "Too many attempts." }, 429),
    )
    render(<NewsletterForm />)

    await user.type(screen.getByLabelText("Product updates"), "reader@lab.edu")
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "Subscribe" }))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts."))
  })

  it("shows a connection error when fetch rejects", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new Error("offline"))
    render(<NewsletterForm />)

    await user.type(screen.getByLabelText("Product updates"), "reader@lab.edu")
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "Subscribe" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Check your connection/),
    )
  })
})
