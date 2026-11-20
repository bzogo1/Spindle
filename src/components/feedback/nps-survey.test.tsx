import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NpsSurvey } from "./nps-survey"
import { HONEYPOT_FIELD } from "@/lib/site-form-constants"

const STORAGE_KEY = "spindle.nps.v1"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function storedState() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(fetch).mockReset()
})

describe("NpsSurvey", () => {
  it("renders eleven score buttons, none pressed initially", () => {
    render(<NpsSurvey variant="page" />)

    // Exactly the 11 score buttons: no dismiss on the page variant, and no
    // Back/Send until a score is picked.
    expect(screen.getAllByRole("button")).toHaveLength(11)
    expect(screen.getByRole("button", { name: "5 out of 10" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "10 out of 10" })).toBeInTheDocument()
    expect(screen.queryByLabelText(/anything we should know/i)).not.toBeInTheDocument()
  })

  it("selecting a score reveals the optional comment and submit", async () => {
    const user = userEvent.setup()
    render(<NpsSurvey variant="page" />)

    await user.click(screen.getByRole("button", { name: "8 out of 10" }))

    expect(screen.getByRole("button", { name: "8 out of 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByLabelText(/anything we should know/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeInTheDocument()
  })

  it("submits score, comment, and source to /api/nps and thanks the user", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, message: "Thanks" }))
    render(<NpsSurvey variant="page" source="page" />)

    await user.click(screen.getByRole("button", { name: "10 out of 10" }))
    await user.type(screen.getByLabelText(/anything we should know/i), "  Great product  ")
    await user.click(screen.getByRole("button", { name: "Send feedback" }))

    expect(await screen.findByRole("status")).toHaveTextContent(/Thanks for the feedback/)

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("/api/nps")
    expect(JSON.parse(String(init?.body))).toEqual({
      score: 10,
      comment: "Great product",
      source: "page",
      [HONEYPOT_FIELD]: "",
    })
    expect(storedState()).toMatchObject({ status: "submitted", score: 10 })
  })

  it("submits without a comment when the field is left empty", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    render(<NpsSurvey />)

    await user.click(await screen.findByRole("button", { name: "3 out of 10" }))
    await user.click(screen.getByRole("button", { name: "Send feedback" }))

    await screen.findByRole("status")
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body.score).toBe(3)
    expect(body.comment).toBeUndefined()
    expect(body.source).toBe("widget")
    expect(body).toHaveProperty(HONEYPOT_FIELD, "")
  })

  it("renders an off-screen honeypot input that stays out of the a11y tree", async () => {
    const user = userEvent.setup()
    const { container } = render(<NpsSurvey variant="page" />)

    await user.click(screen.getByRole("button", { name: "9 out of 10" }))

    const honeypot = container.querySelector(`input[name="${HONEYPOT_FIELD}"]`)
    expect(honeypot).not.toBeNull()
    expect(honeypot).toHaveAttribute("tabindex", "-1")
    // aria-hidden wrapper keeps it out of the accessibility tree.
    expect(honeypot!.closest("[aria-hidden='true']")).not.toBeNull()
  })

  it("keeps the dismiss control on the success card and preserves the submitted record", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    const { container } = render(<NpsSurvey />)

    await user.click(await screen.findByRole("button", { name: "10 out of 10" }))
    await user.click(screen.getByRole("button", { name: "Send feedback" }))
    await screen.findByRole("status")

    // The X is still rendered in the success phase.
    await user.click(screen.getByRole("button", { name: "Dismiss survey" }))
    expect(container).toBeEmptyDOMElement()
    // Closing the thanks card must not downgrade "submitted" to "dismissed".
    expect(storedState()).toMatchObject({ status: "submitted", score: 10 })
  })

  it("shows the server error and lets the user retry", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: false, message: "Too many responses." }, 429),
    )
    render(<NpsSurvey variant="page" />)

    await user.click(screen.getByRole("button", { name: "4 out of 10" }))
    await user.click(screen.getByRole("button", { name: "Send feedback" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many responses.")
    // Still on the comment step — not the success state.
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeInTheDocument()
  })

  it("dismisses the floating card and remembers it", async () => {
    const user = userEvent.setup()
    const { container, unmount } = render(<NpsSurvey />)

    await user.click(await screen.findByRole("button", { name: "Dismiss survey" }))
    expect(container).toBeEmptyDOMElement()
    expect(storedState()).toMatchObject({ status: "dismissed" })

    // A fresh mount stays hidden.
    unmount()
    const second = render(<NpsSurvey />)
    await waitFor(() => expect(second.container).toBeEmptyDOMElement())
  })

  it("hides the floating card when a response was already stored", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: "submitted", score: 9, at: new Date().toISOString() }),
    )
    const { container } = render(<NpsSurvey />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("page variant renders even when the floating card was dismissed", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: "dismissed", at: new Date().toISOString() }),
    )
    render(<NpsSurvey variant="page" />)
    expect(screen.getByRole("button", { name: "0 out of 10" })).toBeInTheDocument()
  })

  it("moves through scores with arrow keys", async () => {
    const user = userEvent.setup()
    render(<NpsSurvey variant="page" />)

    // Pick a starting score, then arrow keys move selection and focus together.
    await user.click(screen.getByRole("button", { name: "5 out of 10" }))
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("button", { name: "6 out of 10" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "6 out of 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await user.keyboard("{Home}")
    expect(screen.getByRole("button", { name: "0 out of 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await user.keyboard("{End}")
    expect(screen.getByRole("button", { name: "10 out of 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })
})
