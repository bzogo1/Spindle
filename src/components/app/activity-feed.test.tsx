import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { ActivityEvent } from "@/lib/api/types"

import { ActivityFeed } from "./activity-feed"

const now = new Date().toISOString()

function buildEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt_1",
    projectId: "prj_01",
    projectName: "Coastal resilience",
    kind: "file",
    actor: { id: "usr_01", name: "Bogdan" },
    summary: "uploaded README.md",
    createdAt: now,
    ...overrides,
  }
}

describe("ActivityFeed", () => {
  it("renders nothing when there are no events", () => {
    const { container } = render(<ActivityFeed events={[]} projectId="prj_01" />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders each event with actor, summary, target, and timestamp", () => {
    render(
      <ActivityFeed
        events={[
          buildEvent({
            id: "evt_1",
            summary: "uploaded README.md",
            target: "docs/README.md",
          }),
        ]}
        projectId="prj_01"
      />,
    )

    const item = screen.getByRole("listitem")
    expect(item).toHaveTextContent("Bogdan")
    expect(item).toHaveTextContent("uploaded README.md docs/README.md")
    expect(item).toHaveTextContent("just now")
    expect(item).toHaveTextContent("file")
  })

  it("links the project name to the event's project when projectId is set", () => {
    render(
      <ActivityFeed
        events={[buildEvent({ projectId: "prj_02", projectName: "Tide gauges" })]}
        projectId="prj_01"
      />,
    )

    expect(screen.getByRole("link", { name: "Tide gauges" })).toHaveAttribute(
      "href",
      "/projects/prj_02",
    )
  })

  it("falls back to the provided projectId when the event has none", () => {
    render(
      <ActivityFeed
        events={[buildEvent({ projectId: undefined, projectName: "Coastal resilience" })]}
        projectId="prj_09"
      />,
    )

    expect(screen.getByRole("link", { name: "Coastal resilience" })).toHaveAttribute(
      "href",
      "/projects/prj_09",
    )
  })

  it("renders the project name as plain text when no project id is known", () => {
    render(
      <ActivityFeed
        events={[buildEvent({ projectId: undefined, projectName: "Coastal resilience" })]}
      />,
    )

    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText("Coastal resilience", { exact: false })).toBeInTheDocument()
  })

  it("falls back to 'Workspace' when no project id or name is known", () => {
    render(<ActivityFeed events={[buildEvent({ projectId: undefined, projectName: undefined })]} />)

    expect(screen.getByText("Workspace", { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("renders the actor initials avatar and a semantic time element", () => {
    const { container } = render(<ActivityFeed events={[buildEvent()]} projectId="prj_01" />)

    expect(container.querySelector(".app-activity-avatar")).toHaveTextContent("B")

    const time = screen.getByText("just now").closest("time")
    expect(time).toHaveAttribute("dateTime", now)
  })

  it("groups events under day headings when groupByDay is set", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    render(
      <ActivityFeed
        events={[
          buildEvent({ id: "evt_today", createdAt: now }),
          buildEvent({ id: "evt_yesterday", createdAt: yesterday }),
          buildEvent({ id: "evt_today_2", createdAt: now }),
        ]}
        projectId="prj_01"
        groupByDay
      />,
    )

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeInTheDocument()
    // Two lists: the "Today" bucket holds both of today's events.
    const lists = screen.getAllByRole("list")
    expect(lists).toHaveLength(2)
    expect(lists[0].querySelectorAll("li")).toHaveLength(2)
    expect(lists[1].querySelectorAll("li")).toHaveLength(1)
  })

  it("does not render day headings by default", () => {
    render(
      <ActivityFeed
        events={[buildEvent({ id: "evt_1" }), buildEvent({ id: "evt_2", createdAt: now })]}
        projectId="prj_01"
      />,
    )

    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(screen.getAllByRole("list")).toHaveLength(1)
  })

  it("wraps case-insensitive term matches in mark.app-activity-mark", () => {
    const { container } = render(
      <ActivityFeed
        events={[
          buildEvent({
            id: "evt_1",
            actor: { id: "usr_01", name: "Bogdan" },
            summary: "uploaded README.md",
            target: "docs/readme-notes.md",
          }),
        ]}
        projectId="prj_01"
        term="readme"
      />,
    )

    const marks = container.querySelectorAll("mark.app-activity-mark")
    // Summary + target each contain a "readme" hit (actor name does not).
    expect(marks).toHaveLength(2)
    expect(marks[0]).toHaveTextContent("README")
    expect(marks[1]).toHaveTextContent("readme")
  })

  it("does not render marks when no term is provided", () => {
    const { container } = render(
      <ActivityFeed events={[buildEvent({ summary: "uploaded README.md" })]} projectId="prj_01" />,
    )

    expect(container.querySelector("mark.app-activity-mark")).not.toBeInTheDocument()
  })

  it("reveals more events via the Show more button when pageSize is set", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    render(
      <ActivityFeed
        events={[
          buildEvent({ id: "evt_1", createdAt: now }),
          buildEvent({ id: "evt_2", createdAt: now }),
          buildEvent({ id: "evt_3", createdAt: yesterday }),
        ]}
        projectId="prj_01"
        groupByDay
        pageSize={2}
      />,
    )

    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText("2 of 3 shown")).toBeInTheDocument()
    // Only the first page's day bucket is rendered.
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Yesterday" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Show more" }))

    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument()
  })
})
