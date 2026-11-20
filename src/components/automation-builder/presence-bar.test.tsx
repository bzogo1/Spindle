import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Collaborator, PresenceState } from "@/lib/automation-graph"

import { PresenceBar } from "./presence-bar"

const local: Collaborator = { id: "u_local", name: "You", color: "#f00" }

const peer = (name: string): PresenceState => ({
  user: { id: `u_${name}`, name, color: "#0af" },
  nodeId: "n1",
  updatedAt: Date.now(),
})

describe("PresenceBar", () => {
  it("renders the local user and peers as collaborators", () => {
    render(<PresenceBar local={local} peers={[peer("Maya"), peer("Ihor")]} />)

    expect(screen.getByRole("group", { name: "Collaborators (3)" })).toBeInTheDocument()
    expect(screen.getByText("3 collaborators")).toBeInTheDocument()
    expect(screen.getByTitle("You (you)")).toBeInTheDocument()
    expect(screen.getByTitle("Maya")).toBeInTheDocument()
    expect(screen.getByTitle("Ihor")).toBeInTheDocument()
  })

  it("copies the current URL when Share is clicked", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    render(<PresenceBar local={local} peers={[]} />)
    await user.click(screen.getByRole("button", { name: "Copy share link" }))

    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(await screen.findByText("Link copied")).toBeInTheDocument()
  })
})
