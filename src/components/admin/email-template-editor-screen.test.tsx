import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EmailTemplateEditorScreen, type EditableTemplate } from "./email-template-editor-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const TEMPLATES: EditableTemplate[] = [
  {
    id: "tpl_1",
    name: "Welcome",
    subject: "Welcome, {{name}}",
    body: "Hi {{name}}, visit {{url}}",
    variables: ["name", "url"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
]

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (handler) return Promise.resolve(handler(url, init))
    if (url === "/api/admin/email-templates") {
      return Promise.resolve(jsonResponse({ ok: true, templates: TEMPLATES }))
    }
    if (url === "/api/admin/email-templates/preview") {
      return Promise.resolve(jsonResponse({ ok: true, subject: "s", body: "b" }))
    }
    return Promise.resolve(jsonResponse({ ok: true }))
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  mockFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("EmailTemplateEditorScreen", () => {
  it("renders the template list", async () => {
    render(<EmailTemplateEditorScreen />)
    expect(await screen.findByText("Welcome")).toBeInTheDocument()
    expect(screen.getByText("Welcome, {{name}}")).toBeInTheDocument()
    expect(screen.getAllByText("{{name}}").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /New template/ })).toBeInTheDocument()
  })

  it("shows the empty state when there are no templates", async () => {
    mockFetch((url) =>
      url === "/api/admin/email-templates"
        ? jsonResponse({ ok: true, templates: [] })
        : jsonResponse({ ok: true }),
    )
    render(<EmailTemplateEditorScreen />)
    expect(await screen.findByText("No email templates")).toBeInTheDocument()
  })

  it("loads a template into the editor and requests a debounced preview", async () => {
    const user = userEvent.setup()
    render(<EmailTemplateEditorScreen />)
    await user.click(await screen.findByText("Welcome"))

    expect(screen.getByLabelText("Name")).toHaveValue("Welcome")
    expect(screen.getByLabelText("Subject")).toHaveValue("Welcome, {{name}}")

    await waitFor(
      () => {
        const previewCall = fetchMock.mock.calls.find(
          ([input]) => String(input) === "/api/admin/email-templates/preview",
        )
        expect(previewCall).toBeTruthy()
        const payload = JSON.parse(String((previewCall?.[1] as RequestInit).body))
        expect(payload.subject).toBe("Welcome, {{name}}")
        expect(payload.vars).toEqual({})
      },
      { timeout: 3000 },
    )
  })

  it("creates a template via POST", async () => {
    const user = userEvent.setup()
    render(<EmailTemplateEditorScreen />)
    await screen.findByText("Welcome")

    await user.click(screen.getByRole("button", { name: /New template/ }))
    await user.type(screen.getByLabelText("Name"), "Digest")
    // userEvent.type treats "{" as key syntax — paste literal placeholder text.
    await user.click(screen.getByLabelText("Subject"))
    await user.paste("Digest for {{name}}")
    await user.click(screen.getByLabelText("Body (plain text)"))
    await user.paste("Hello {{name}}")
    await user.click(screen.getByRole("button", { name: /Create template/ }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === "/api/admin/email-templates" && init?.method === "POST",
      )
      expect(post).toBeTruthy()
      const payload = JSON.parse(String((post?.[1] as RequestInit).body))
      expect(payload).toMatchObject({
        name: "Digest",
        subject: "Digest for {{name}}",
        body: "Hello {{name}}",
      })
    })
  })

  it("updates a template via PUT", async () => {
    const user = userEvent.setup()
    render(<EmailTemplateEditorScreen />)
    await user.click(await screen.findByText("Welcome"))

    const subject = screen.getByLabelText("Subject")
    await user.clear(subject)
    await user.click(subject)
    await user.paste("Updated {{name}}")
    await user.click(screen.getByRole("button", { name: /Save changes/ }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === "/api/admin/email-templates/tpl_1" && init?.method === "PUT",
      )
      expect(put).toBeTruthy()
    })
  })

  it("deletes a template after confirmation", async () => {
    const user = userEvent.setup()
    mockFetch((url, init) => {
      if (url === "/api/admin/email-templates/tpl_1" && init?.method === "DELETE") {
        return jsonResponse({ ok: true, deleted: true })
      }
      if (url === "/api/admin/email-templates") {
        const isRead = !init?.method || init.method === "GET"
        return jsonResponse({ ok: true, templates: isRead ? TEMPLATES : [] })
      }
      return jsonResponse({ ok: true, subject: "s", body: "b" })
    })
    render(<EmailTemplateEditorScreen />)
    await user.click(await screen.findByText("Welcome"))

    await user.click(screen.getByRole("button", { name: "Delete" }))
    await user.click(await screen.findByRole("button", { name: "Delete template" }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === "/api/admin/email-templates/tpl_1" && init?.method === "DELETE",
      )
      expect(del).toBeTruthy()
    })
  })
})
