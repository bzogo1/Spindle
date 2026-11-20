import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { QueryState } from "./query-state"

describe("QueryState", () => {
  it("renders a loading panel by default", () => {
    render(
      <QueryState status="loading" loading={<p>Custom loading</p>}>
        <p>Content</p>
      </QueryState>,
    )

    expect(screen.getByText("Custom loading")).toBeInTheDocument()
    expect(screen.queryByText("Content")).not.toBeInTheDocument()
  })

  it("renders an error state with retry", async () => {
    const onRetry = vi.fn()
    render(
      <QueryState status="error" errorTitle="Runs did not load" onRetry={onRetry}>
        <p>Content</p>
      </QueryState>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Runs did not load")
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("renders the empty presentation when the result set is empty", () => {
    render(
      <QueryState
        status="success"
        isEmpty
        emptyTitle="No runs yet"
        emptyBody="Start a run to see its trace."
        primaryAction={{ label: "Start a run", href: "/projects/prj_01/agent" }}
      >
        <p>Content</p>
      </QueryState>,
    )

    expect(screen.getByRole("heading", { name: "No runs yet" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Start a run" })).toHaveAttribute(
      "href",
      "/projects/prj_01/agent",
    )
  })

  it("passes data to the children render prop on success", () => {
    render(
      <QueryState status="success" data={{ name: "Tidal survey" }}>
        {(data) => <p>{data.name}</p>}
      </QueryState>,
    )

    expect(screen.getByText("Tidal survey")).toBeInTheDocument()
  })
})
