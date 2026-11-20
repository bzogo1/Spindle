import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { ApiPlayground } from "./api-playground"
import { loadHistory } from "./request"

describe("ApiPlayground", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders the request builder and response pane", () => {
    render(<ApiPlayground />)
    expect(screen.getByText("Endpoint")).toBeInTheDocument()
    expect(screen.getByText("Query parameters")).toBeInTheDocument()
    expect(screen.getByText("Headers")).toBeInTheDocument()
    expect(screen.getByText("Bearer token (optional)")).toBeInTheDocument()
    expect(screen.getByText("Body (JSON)")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument()
  })

  it("lists catalog endpoints grouped by section", () => {
    render(<ApiPlayground />)
    const select = screen.getByLabelText(/Endpoint/)
    // optgroups render as elements; check a few known options exist in the DOM.
    expect(select).toBeInTheDocument()
    expect(screen.getByText("GET /api/profile")).toBeInTheDocument()
    expect(screen.getByText("POST /api/auth/signin")).toBeInTheDocument()
  })

  it("send button is enabled for a default path", () => {
    render(<ApiPlayground />)
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled()
  })

  it("disables send until path params are filled", async () => {
    const user = userEvent.setup()
    render(<ApiPlayground />)

    await user.selectOptions(screen.getByLabelText(/Endpoint/), "auth-oauth-provider")
    const send = screen.getByRole("button", { name: "Send request" })
    expect(send).toBeDisabled()
    expect(screen.getByText(/Fill in path parameter/)).toBeInTheDocument()

    await user.type(screen.getByLabelText("provider"), "github")
    expect(send).toBeEnabled()
  })

  it("records history entries after a request", async () => {
    const user = userEvent.setup()
    render(<ApiPlayground />)

    // jsdom fetch is not defined; stub a minimal same-origin response.
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('{"hello":"world"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch
    try {
      await user.click(screen.getByRole("button", { name: "Send request" }))
      // Response body renders the pretty-printed JSON.
      expect(await screen.findByText(/world/)).toBeInTheDocument()
      const history = loadHistory()
      expect(history).toHaveLength(1)
      expect(history[0].url).toBe("/api/auth/signin")
      expect(history[0].status).toBe(200)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
