import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ScreenState } from "./screen-state"

describe("ScreenState", () => {
  it("renders the screen loading panel with its matching skeleton", () => {
    const { container } = render(
      <ScreenState<string> screen="files" status="loading">
        {() => <p>Files</p>}
      </ScreenState>,
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Loading files")
    expect(container.querySelector('[data-variant="files"]')).toBeInTheDocument()
    expect(screen.queryByText("Files")).not.toBeInTheDocument()
  })

  it("renders the screen empty copy when the result set is empty", () => {
    render(
      <ScreenState<string[]> screen="lab" status="success" isEmpty data={[]}>
        {(sessions) => <p>{sessions.length} sessions</p>}
      </ScreenState>,
    )

    expect(screen.getByRole("heading", { name: "No lab sessions yet" })).toBeInTheDocument()
    expect(screen.getByText(/Start a session to run code/)).toBeInTheDocument()
  })

  it("renders the screen error copy inside an alert", () => {
    render(
      <ScreenState<string> screen="chat" status="error" error={new Error("boom")}>
        {() => <p>Messages</p>}
      </ScreenState>,
    )

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Chat did not load")
    expect(alert).toHaveTextContent(/We could not load messages/)
  })

  it("prefers explicit copy over the screen defaults", () => {
    render(
      <ScreenState<string> screen="settings" status="error" errorTitle="Custom failure">
        {() => <p>Settings</p>}
      </ScreenState>,
    )

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Custom failure")
    expect(alert).toHaveTextContent("We could not load settings")
    expect(alert).not.toHaveTextContent("Settings did not load")
  })

  it("renders children with data on success", () => {
    render(
      <ScreenState<{ name: string }> screen="project" status="success" data={{ name: "Harbor" }}>
        {(project) => <p>{project.name}</p>}
      </ScreenState>,
    )

    expect(screen.getByText("Harbor")).toBeInTheDocument()
  })
})
