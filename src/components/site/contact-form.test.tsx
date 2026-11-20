import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContactForm } from "./contact-form"
import { HONEYPOT_FIELD } from "@/lib/site-forms"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace")
  await user.type(screen.getByLabelText("Email"), "ada@lab.edu")
  await user.selectOptions(screen.getByLabelText("Topic"), "product")
  await user.type(screen.getByLabelText("Subject"), "Export question")
  await user.type(screen.getByLabelText("Message"), "How do I export a lab session to CSV?")
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("ContactForm", () => {
  it("blocks submission and shows field errors when required fields are empty", async () => {
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.click(screen.getByRole("button", { name: "Send message" }))

    // Each error appears once inline and once in the summary list.
    expect(screen.getAllByText("Name is required.").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Email is required.").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Please choose a topic.").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Subject is required.").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/at least 10 characters/).length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("moves focus to the first invalid field on failed validation", async () => {
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus())
  })

  it("rejects a malformed email before hitting the API", async () => {
    const user = userEvent.setup()
    render(<ContactForm />)

    await user.type(screen.getByLabelText("Name"), "Ada")
    await user.type(screen.getByLabelText("Email"), "not-an-email")
    await user.selectOptions(screen.getByLabelText("Topic"), "general")
    await user.type(screen.getByLabelText("Subject"), "Hi")
    await user.type(screen.getByLabelText("Message"), "A long enough message.")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(screen.getAllByText("Enter a valid email address.").length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("shows character counters for subject and message", async () => {
    const user = userEvent.setup()
    render(<ContactForm />)

    expect(screen.getByText("0/200")).toBeInTheDocument()
    expect(screen.getByText("0/5000")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Subject"), "Hi")
    expect(screen.getByText("2/200")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Message"), "1234567890")
    expect(screen.getByText("10/5000")).toBeInTheDocument()
  })

  it("posts to /api/contact with the honeypot field and shows success with a reference", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, message: "Thanks", reference: "CT-ABC12345" }),
    )
    render(<ContactForm />)

    // Hidden render timestamp for the server-side time-trap check.
    expect(document.querySelector('input[name="renderedAt"]')).not.toBeNull()

    await fillValidForm(user)
    await user.type(screen.getByLabelText(/Order or account reference/), "ORD-778")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByText("Message sent.")).toBeInTheDocument()
    expect(screen.getByText("CT-ABC12345")).toBeInTheDocument()

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("/api/contact")
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@lab.edu",
      topic: "product",
      reference: "ORD-778",
      subject: "Export question",
    })
    expect(body).toHaveProperty(HONEYPOT_FIELD, "")
    expect(body.renderedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it("resets to a fresh form via 'Send another message'", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, reference: "CT-1" }))
    render(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await user.click(await screen.findByRole("button", { name: "Send another message" }))

    expect(screen.getByLabelText("Name")).toHaveValue("")
    expect(screen.getByLabelText("Topic")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument()
  })

  it("surfaces server field errors", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          message: "Please check the form and try again.",
          errors: { email: "Server says no." },
        },
        400,
      ),
    )
    render(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect((await screen.findAllByText("Server says no.")).length).toBeGreaterThan(0)
    const alerts = screen.getAllByRole("alert")
    expect(alerts.some((el) => el.textContent?.includes("Please check the form"))).toBe(true)
  })

  it("does not resurrect stale errors the user already fixed", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            message: "Please check the form and try again.",
            errors: { email: "Email rejected.", subject: "Subject rejected." },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            message: "Please check the form and try again.",
            errors: { message: "Message rejected." },
          },
          400,
        ),
      )
    render(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect((await screen.findAllByText("Subject rejected.")).length).toBeGreaterThan(0)

    // Fix the email field (clears its inline error); the subject error stays.
    const email = screen.getByLabelText("Email")
    await user.clear(email)
    await user.type(email, "ada@lab.edu")

    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect((await screen.findAllByText("Message rejected.")).length).toBeGreaterThan(0)

    // The server only flagged `message` — the stale subject error must not return.
    expect(screen.queryByText("Subject rejected.")).not.toBeInTheDocument()
    expect(screen.queryByText("Email rejected.")).not.toBeInTheDocument()
  })

  it("lists non-field server errors in the summary without a focus link", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          message: "Please check the form and try again.",
          errors: { form: "Submission failed globally." },
        },
        400,
      ),
    )
    render(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Send message" }))

    const summary = await screen.findByText("There is 1 problem with your message:")
    expect(summary.parentElement).toHaveTextContent("Submission failed globally.")
    // Non-field errors render as plain text, not anchor links.
    expect(screen.queryByRole("link", { name: "Submission failed globally." })).toBeNull()
  })

  it("shows a connection error when fetch rejects", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new Error("offline"))
    render(<ContactForm />)

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Check your connection/),
    )
  })
})
