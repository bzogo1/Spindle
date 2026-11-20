import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { NodeComment } from "@/lib/automation-graph"

import { CommentsPanel } from "./comments-panel"

function comment(overrides: Partial<NodeComment> = {}): NodeComment {
  return {
    id: "c1",
    nodeId: "n1",
    authorId: "u1",
    authorName: "Maya",
    body: "Check the error branch",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderPanel(overrides?: Partial<Parameters<typeof CommentsPanel>[0]>) {
  const onAddComment = vi.fn()
  const onDeleteComment = vi.fn()
  render(
    <CommentsPanel
      nodeId="n1"
      nodeLabel="Schedule trigger"
      comments={[comment()]}
      localAuthorId="u1"
      onAddComment={onAddComment}
      onDeleteComment={onDeleteComment}
      {...overrides}
    />,
  )
  return { onAddComment, onDeleteComment }
}

describe("CommentsPanel", () => {
  it("prompts to select a node when nothing is selected", () => {
    renderPanel({ nodeId: null, comments: [] })
    expect(screen.getByText(/Select a node on the canvas/)).toBeInTheDocument()
    expect(screen.queryByLabelText("New comment")).not.toBeInTheDocument()
  })

  it("lists comments for the selected node", () => {
    renderPanel()
    expect(screen.getByText("Comments · Schedule trigger")).toBeInTheDocument()
    expect(screen.getByText("Check the error branch")).toBeInTheDocument()
    expect(screen.getByText("Maya")).toBeInTheDocument()
  })

  it("shows an empty state when the node has no comments", () => {
    renderPanel({ comments: [] })
    expect(screen.getByText("No comments on this node yet.")).toBeInTheDocument()
  })

  it("submits a new comment and clears the draft", async () => {
    const user = userEvent.setup()
    const { onAddComment } = renderPanel({ comments: [] })

    await user.type(screen.getByLabelText("New comment"), "Looks good")
    await user.click(screen.getByRole("button", { name: "Add comment" }))

    expect(onAddComment).toHaveBeenCalledWith("Looks good")
    expect(screen.getByLabelText("New comment")).toHaveValue("")
  })

  it("keeps the add button disabled for blank drafts", async () => {
    const user = userEvent.setup()
    const { onAddComment } = renderPanel({ comments: [] })

    const button = screen.getByRole("button", { name: "Add comment" })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText("New comment"), "   ")
    expect(button).toBeDisabled()
    expect(onAddComment).not.toHaveBeenCalled()
  })

  it("lets the local author delete their own comment only", async () => {
    const user = userEvent.setup()
    const { onDeleteComment } = renderPanel({
      comments: [comment(), comment({ id: "c2", authorId: "u2", authorName: "Ihor" })],
    })

    const deleteButtons = screen.getAllByRole("button", { name: /Delete comment by/ })
    expect(deleteButtons).toHaveLength(1)
    await user.click(deleteButtons[0])
    expect(onDeleteComment).toHaveBeenCalledWith("c1")
  })
})
