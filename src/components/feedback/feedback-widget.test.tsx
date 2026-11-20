import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FeedbackWidget } from "./feedback-widget"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function openWidget(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Send feedback" }))
  await screen.findByRole("dialog")
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Message"), "The export button does nothing.")
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("FeedbackWidget", () => {
  it("renders a floating trigger that opens an accessible dialog", async () => {
    const user = userEvent.setup()
    render(<FeedbackWidget />)

    const trigger = screen.getByRole("button", { name: "Send feedback" })
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(trigger)

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Send feedback" })).toBeInTheDocument()
    expect(screen.getByLabelText("Category")).toBeInTheDocument()
    expect(screen.getByLabelText(/Message/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument()
  })

  it("opens immediately when defaultOpen is set", async () => {
    render(<FeedbackWidget defaultOpen />)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<FeedbackWidget />)

    await openWidget(user)
    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("blocks submission and shows an error for a too-short message", async () => {
    const user = userEvent.setup()
    render(<FeedbackWidget />)

    await openWidget(user)
    await user.type(screen.getByLabelText("Message"), "too short")
    await user.click(screen.getByRole("button", { name: "Submit" }))

    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects a malformed optional email before hitting the API", async () => {
    const user = userEvent.setup()
    render(<FeedbackWidget />)

    await openWidget(user)
    await fillValidForm(user)
    await user.type(screen.getByLabelText(/Email/), "not-an-email")
    await user.click(screen.getByRole("button", { name: "Submit" }))

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts to /api/feedback and shows the success state", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, message: "Thanks" }))
    render(<FeedbackWidget />)

    await openWidget(user)
    await user.selectOptions(screen.getByLabelText("Category"), "bug")
    await fillValidForm(user)
    await user.type(screen.getByLabelText(/Email/), "ada@lab.edu")
    await user.click(screen.getByRole("button", { name: "Submit" }))

    expect(await screen.findByText("Thanks for the feedback")).toBeInTheDocument()

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("/api/feedback")
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      category: "bug",
      message: "The export button does nothing.",
      email: "ada@lab.edu",
    })
    expect(body).toHaveProperty("website", "")
  })

  it("resets the form via 'Send another' after success", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, message: "Thanks" }))
    render(<FeedbackWidget />)

    await openWidget(user)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Submit" }))
    await screen.findByText("Thanks for the feedback")

    await user.click(screen.getByRole("button", { name: "Send another" }))
    expect(screen.getByLabelText("Message")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument()
  })

  it("surfaces server field errors", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          message: "Please check the form and try again.",
          errors: { message: "Server says no." },
        },
        400,
      ),
    )
    render(<FeedbackWidget />)

    await openWidget(user)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Submit" }))

    expect(await screen.findByText("Server says no.")).toBeInTheDocument()
    expect(screen.getByText("Please check the form and try again.")).toBeInTheDocument()
  })

  it("shows a connection error when fetch rejects", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new Error("offline"))
    render(<FeedbackWidget />)

    await openWidget(user)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Submit" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Check your connection/),
    )
  })
})
