import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useChatWorkspace } from "@/lib/api"
import type { ChatWorkspace } from "@/lib/api"

import { ChatScreen, chatExportJson, chatExportMarkdown } from "./chat-screen"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    useChatWorkspace: vi.fn(),
  }
})

const workspaceQuery = vi.mocked(useChatWorkspace)

function buildWorkspace(overrides: Partial<ChatWorkspace> = {}): ChatWorkspace {
  return {
    project: {
      id: "prj_01",
      name: "Coastal Resilience",
      owner: "bogdan",
      storageLimitBytes: 5 * 1024 * 1024 * 1024,
    },
    activeChannelId: "channel-field-notes",
    anonymous: false,
    botEnabled: true,
    channels: [
      {
        id: "channel-field-notes",
        name: "field-notes",
        kind: "channel",
        memberCount: 8,
        unreadCount: 2,
        lastMessagePreview: "Adding the site IDs",
      },
      {
        id: "channel-data-cleaning",
        name: "data-cleaning",
        kind: "channel",
        memberCount: 5,
      },
      { id: "dm-mara", name: "Mara", kind: "dm", memberCount: 2 },
    ],
    messages: [
      {
        id: "msg-1",
        channelId: "channel-field-notes",
        authorId: "user-mara",
        authorName: "Mara",
        anonymous: false,
        body: "New survey batch is in /data.",
        createdAt: "2026-11-19T09:14:00.000Z",
        status: "sent",
        reactions: [{ emoji: "🎉", userIds: ["user-mara", "user-theo"] }],
      },
      {
        id: "msg-2",
        channelId: "channel-field-notes",
        authorId: "user-jules",
        authorName: "Jules",
        anonymous: false,
        body: "Site IDs are in the shared note.",
        mentions: [{ id: "user-mara", name: "Mara" }],
        createdAt: "2026-11-19T09:21:00.000Z",
        status: "sent",
      },
      {
        id: "msg-3",
        channelId: "channel-data-cleaning",
        authorId: "user-theo",
        authorName: "Theo",
        anonymous: false,
        body: "Duplicates isolated in archive.",
        createdAt: "2026-11-19T08:40:00.000Z",
        status: "sent",
      },
    ],
    members: [
      { id: "user-bogdan", name: "You", online: true },
      { id: "user-mara", name: "Mara", online: true },
      { id: "user-theo", name: "Theo", online: false },
    ],
    typing: [],
    ...overrides,
  }
}

const chatActions = {
  selectChannel: vi.fn(),
  setAnonymous: vi.fn(),
  setBotEnabled: vi.fn(),
  createThread: vi.fn(),
  toggleReaction: vi.fn(),
  sendMessage: vi.fn(),
  retryMessage: vi.fn(),
}

function mockWorkspace(workspace: ChatWorkspace = buildWorkspace()) {
  for (const action of Object.values(chatActions)) action.mockReset()
  for (const action of Object.values(chatActions)) action.mockResolvedValue({ ok: true })
  workspaceQuery.mockReturnValue({
    status: "success",
    data: workspace,
    error: undefined,
    isEmpty: false,
    isRetrying: false,
    refetch: vi.fn(),
    actions: chatActions,
  } as never)
}

describe("ChatScreen", () => {
  beforeEach(() => {
    mockWorkspace()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders threads, messages, and the presence strip", () => {
    render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /field-notes/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /data-cleaning/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Mara/ })).toBeInTheDocument()

    // Only the active channel's messages are shown.
    expect(screen.getByText("New survey batch is in /data.")).toBeInTheDocument()
    expect(screen.getByText("Site IDs are in the shared note.")).toBeInTheDocument()
    expect(screen.queryByText("Duplicates isolated in archive.")).not.toBeInTheDocument()

    // Presence: members with online/offline state and a count.
    const presence = screen.getByLabelText("Workspace presence")
    expect(presence).toHaveTextContent("Mara")
    expect(presence).toHaveTextContent("Theo")
    expect(presence).toHaveTextContent("2 of 3 online")

    // Unread badge on the channel with unread mail.
    expect(screen.getByLabelText("2 unread")).toBeInTheDocument()
  })

  it("switches channels and toggles anonymous mode", () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.click(screen.getByRole("button", { name: /data-cleaning/ }))
    expect(chatActions.selectChannel).toHaveBeenCalledWith("channel-data-cleaning")

    fireEvent.click(screen.getByRole("checkbox", { name: /Anonymous mode/ }))
    expect(chatActions.setAnonymous).toHaveBeenCalledWith(true)
  })

  it("toggles the chat bot from the thread tools", () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.click(screen.getByRole("checkbox", { name: /Spindle Bot/ }))
    expect(chatActions.setBotEnabled).toHaveBeenCalledWith(false)
  })

  it("renders bot messages and presence entries distinctly", () => {
    const workspace = buildWorkspace({
      members: [
        ...buildWorkspace().members,
        { id: "bot-spindle", name: "Spindle Bot", online: true, bot: true },
      ],
      messages: [
        ...buildWorkspace().messages,
        {
          id: "msg-bot",
          channelId: "channel-field-notes",
          authorId: "bot-spindle",
          authorName: "Spindle Bot",
          anonymous: false,
          body: "All systems nominal in #field-notes.",
          bot: true,
          createdAt: "2026-11-19T09:45:00.000Z",
          status: "sent",
        },
      ],
    })
    mockWorkspace(workspace)
    const { container } = render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByText("All systems nominal in #field-notes.")).toBeInTheDocument()
    // The "bot" badge appears on both the message header and the presence entry.
    expect(screen.getAllByText("bot").length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector(".app-chat-avatar.is-bot")).toBeInTheDocument()

    // The presence strip tags the bot member too.
    const presence = screen.getByLabelText("Workspace presence")
    expect(presence).toHaveTextContent("Spindle Bot")
  })

  it("renders anonymous messages with a pseudonym, badge, and hidden-identity notice", () => {
    const workspace = buildWorkspace({
      anonymous: true,
      messages: [
        ...buildWorkspace().messages,
        {
          id: "msg-anon",
          channelId: "channel-field-notes",
          authorId: "user-bogdan",
          authorName: "Anonymous surveyor",
          anonymous: true,
          body: "Can someone review the consent form?",
          createdAt: "2026-11-19T09:30:00.000Z",
          status: "sent",
        },
      ],
    })
    mockWorkspace(workspace)
    const { container } = render(<ChatScreen projectId="prj_01" />)

    // The pseudonym replaces the real author name and is flagged as anon.
    expect(screen.getAllByText("Anonymous surveyor").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("anon")).toBeInTheDocument()
    const avatar = container.querySelector(".app-chat-avatar.is-anonymous")
    expect(avatar?.textContent).toBe("?")

    // The composer announces the anonymous posting identity.
    expect(screen.getByText(/identity hidden in this thread/)).toBeInTheDocument()
  })

  it("creates a new thread from the channels sidebar", async () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.click(screen.getByRole("button", { name: "New thread" }))
    fireEvent.change(screen.getByLabelText("New thread name"), {
      target: { value: "grant-writing" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => expect(chatActions.createThread).toHaveBeenCalledWith("grant-writing"))
  })

  it("sends a message and resolves @mentions against the roster", async () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.change(screen.getByLabelText(/Message field-notes/), {
      target: { value: "@Mara can you check the gauge?" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith(
        "@Mara can you check the gauge?",
        undefined,
        [{ id: "user-mara", name: "Mara" }],
        undefined,
      ),
    )
  })

  it("replies to a message and sends with the reply target", async () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0])

    // The composer announces the pending reply and can cancel it.
    expect(screen.getByText(/Replying to Mara/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Message field-notes/), {
      target: { value: "On it." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith("On it.", undefined, undefined, "msg-1"),
    )
  })

  it("cancels a pending reply without sending", () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }))

    expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument()
  })

  it("renders replies indented with a quoted parent", () => {
    const workspace = buildWorkspace({
      messages: [
        ...buildWorkspace().messages,
        {
          id: "msg-reply",
          channelId: "channel-field-notes",
          authorId: "user-bogdan",
          authorName: "You",
          anonymous: false,
          body: "Following up on this.",
          replyToId: "msg-1",
          createdAt: "2026-11-19T09:30:00.000Z",
          status: "sent",
        },
      ],
    })
    mockWorkspace(workspace)
    const { container } = render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByText("Following up on this.")).toBeInTheDocument()
    expect(container.querySelector(".app-chat-message.is-reply")).toBeInTheDocument()

    // The quote repeats the parent's author and a snippet of its body.
    const quote = container.querySelector(".app-chat-reply-quote")
    expect(quote?.textContent).toContain("Mara")
    expect(quote?.textContent).toContain("New survey batch is in /data.")
  })

  it("does not resolve unknown @handles as mentions", async () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.change(screen.getByLabelText(/Message field-notes/), {
      target: { value: "cc @stranger on this" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith(
        "cc @stranger on this",
        undefined,
        undefined,
        undefined,
      ),
    )
  })

  it("renders existing reactions and quick-react buttons", () => {
    render(<ChatScreen projectId="prj_01" />)

    // Seeded reaction on msg-1 shows its count.
    expect(screen.getByRole("button", { name: /🎉 reaction, 2 people/ })).toBeInTheDocument()
    // Quick reactions are offered on every sent message.
    const addButtons = screen.getAllByRole("button", { name: "Add 👍 reaction" })
    expect(addButtons.length).toBeGreaterThan(0)
  })

  it("toggles a reaction on a message", async () => {
    render(<ChatScreen projectId="prj_01" />)

    fireEvent.click(screen.getAllByRole("button", { name: "Add 👍 reaction" })[0])

    await waitFor(() => expect(chatActions.toggleReaction).toHaveBeenCalledWith("msg-1", "👍"))
  })

  it("renders mention chips on messages that carry mentions", () => {
    render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByText("@Mara")).toBeInTheDocument()
  })

  it("shows a typing indicator for members composing in the active thread", () => {
    mockWorkspace(
      buildWorkspace({
        typing: [{ channelId: "channel-field-notes", memberId: "user-mara", memberName: "Mara" }],
      }),
    )
    render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByRole("status")).toHaveTextContent("Mara is typing…")
  })

  it("marks away members and shows last-seen for offline members", () => {
    const workspace = buildWorkspace({
      members: [
        { id: "user-bogdan", name: "You", online: true },
        { id: "user-mara", name: "Mara", online: true, away: true },
        {
          id: "user-theo",
          name: "Theo",
          online: false,
          lastSeenAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        },
      ],
    })
    mockWorkspace(workspace)
    render(<ChatScreen projectId="prj_01" />)

    const presence = screen.getByLabelText("Workspace presence")
    // Away members still count as online; the suffix calls them out.
    expect(presence).toHaveTextContent("2 of 3 online · 1 away")
    // The offline member's last-seen timestamp is surfaced in the strip.
    expect(presence).toHaveTextContent("last seen 2 h ago")
  })

  it("toggles the members panel with per-member presence and typing state", () => {
    const workspace = buildWorkspace({
      members: [
        { id: "user-bogdan", name: "You", online: true },
        { id: "user-mara", name: "Mara", online: true },
        {
          id: "user-theo",
          name: "Theo",
          online: false,
          lastSeenAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        },
      ],
      typing: [{ channelId: "channel-field-notes", memberId: "user-mara", memberName: "Mara" }],
    })
    mockWorkspace(workspace)
    render(<ChatScreen projectId="prj_01" />)

    const toggle = screen.getByRole("button", { name: "Toggle members panel" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByLabelText("Members")).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")

    const panel = screen.getByLabelText("Members")
    expect(panel).toHaveTextContent("Mara")
    expect(panel).toHaveTextContent("online")
    expect(panel).toHaveTextContent("typing…")
    expect(panel).toHaveTextContent("offline · last seen 30 min ago")

    fireEvent.click(toggle)
    expect(screen.queryByLabelText("Members")).not.toBeInTheDocument()
  })

  it("shows the empty state when no channel is active", () => {
    mockWorkspace(buildWorkspace({ channels: [], messages: [] }))
    render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByText("No channels")).toBeInTheDocument()
  })

  it("simulates attachment upload progress and sends completed files", async () => {
    const { container } = render(<ChatScreen projectId="prj_01" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["survey,data"], "notes.csv", { type: "text/csv" })

    fireEvent.change(input, { target: { files: [file] } })

    expect(screen.getByText("notes.csv")).toBeInTheDocument()
    expect(
      screen.getByRole("progressbar", { name: "notes.csv upload progress" }),
    ).toBeInTheDocument()
    // The file alone cannot be sent until the mock upload completes.
    expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled()

    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(), {
      timeout: 4000,
    })

    fireEvent.change(screen.getByLabelText(/Message field-notes/), {
      target: { value: "CSV attached" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith(
        "CSV attached",
        [{ name: "notes.csv", sizeBytes: file.size }],
        undefined,
        undefined,
      ),
    )
    // The uploaded file leaves the pending list once it rides the message.
    await waitFor(() => expect(screen.queryByText("notes.csv")).not.toBeInTheDocument())
  })

  it("keeps a file that finishes uploading during send in the pending list", async () => {
    let resolveSend: ((value: { ok: boolean }) => void) | undefined
    chatActions.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve as (value: { ok: boolean }) => void
        }),
    )
    const { container } = render(<ChatScreen projectId="prj_01" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, {
      target: { files: [new File(["late"], "late.csv", { type: "text/csv" })] },
    })
    fireEvent.change(screen.getByLabelText(/Message field-notes/), {
      target: { value: "hi" },
    })
    // Send fires while the file is still uploading, so it is not attached.
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith("hi", undefined, undefined, undefined),
    )

    // The upload completes while sendMessage is still in flight.
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(), {
      timeout: 4000,
    })

    resolveSend?.({ ok: true })
    // The file was never sent, so it must remain pending — not silently dropped.
    await waitFor(() => expect(screen.getByText("late.csv")).toBeInTheDocument())
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("fails uploads whose name contains 'fail' and supports remove and retry", async () => {
    const { container } = render(<ChatScreen projectId="prj_01" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, {
      target: { files: [new File(["x"], "fail-report.txt", { type: "text/plain" })] },
    })

    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument(), {
      timeout: 2000,
    })
    expect(screen.getByRole("button", { name: "Retry fail-report.txt" })).toBeInTheDocument()

    // Retry re-queues the upload, which fails again on the same trigger.
    fireEvent.click(screen.getByRole("button", { name: "Retry fail-report.txt" }))
    expect(
      screen.getByRole("progressbar", { name: "fail-report.txt upload progress" }),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument(), {
      timeout: 2000,
    })

    fireEvent.click(screen.getByRole("button", { name: "Remove fail-report.txt" }))
    expect(screen.queryByText("fail-report.txt")).not.toBeInTheDocument()
  })

  it("renders message attachments with a mock download action", () => {
    const createObjectURL = vi.fn(() => "blob:mock")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    const workspace = buildWorkspace({
      messages: [
        ...buildWorkspace().messages,
        {
          id: "msg-files",
          channelId: "channel-field-notes",
          authorId: "user-mara",
          authorName: "Mara",
          anonymous: false,
          body: "",
          attachments: [{ id: "att-1", name: "dataset.csv", sizeBytes: 4096 }],
          createdAt: "2026-11-19T09:40:00.000Z",
          status: "sent",
        },
      ],
    })
    mockWorkspace(workspace)
    render(<ChatScreen projectId="prj_01" />)

    expect(screen.getByText("dataset.csv")).toBeInTheDocument()
    expect(screen.getByText("4 KB")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Download dataset.csv" }))
    expect(createObjectURL).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")
  })

  it("filters messages by search, highlights matches, and reports the count", () => {
    const { container } = render(<ChatScreen projectId="prj_01" />)

    fireEvent.change(screen.getByLabelText("Search messages in field-notes"), {
      target: { value: "SURVEY" },
    })

    // Only the matching message stays visible; the other channel message is filtered out.
    // (The body is split by <mark> nodes, so assert on textContent.)
    const body = container.querySelector(".app-chat-message-body p")
    expect(body?.textContent).toBe("New survey batch is in /data.")
    expect(screen.queryByText("Site IDs are in the shared note.")).not.toBeInTheDocument()

    // The match is wrapped in a highlight element, preserving the original casing.
    const marks = container.querySelectorAll("mark.app-chat-highlight")
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].textContent).toBe("survey")

    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 messages match")

    // Clearing restores the full thread.
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.getByText("Site IDs are in the shared note.")).toBeInTheDocument()
    expect(container.querySelector("mark.app-chat-highlight")).not.toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("renders fenced code blocks with a copy button and inline code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const workspace = buildWorkspace({
      messages: [
        {
          id: "msg-code",
          channelId: "channel-field-notes",
          authorId: "user-mara",
          authorName: "Mara",
          anonymous: false,
          body: "Run `npm test` first:\n\n```ts\nconst x = 1\n```\n\nDone.",
          createdAt: "2026-11-19T09:30:00.000Z",
          status: "sent",
        },
      ],
    })
    mockWorkspace(workspace)
    const { container } = render(<ChatScreen projectId="prj_01" />)

    // Inline code span is styled, not part of the plain-text paragraph.
    const inline = container.querySelector(".app-chat-inline-code")
    expect(inline?.textContent).toBe("npm test")

    // Fenced block renders as pre>code with its language tag.
    const code = container.querySelector(".app-chat-code-pre code")
    expect(code?.textContent).toBe("const x = 1")
    expect(container.querySelector(".app-chat-code-lang")?.textContent).toBe("ts")

    // Copy button writes the raw code to the clipboard. (fireEvent rather
    // than userEvent: userEvent.setup() installs its own clipboard mock.)
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1"))
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument())
  })

  it("shows a no-matches empty state when the search hits nothing", () => {
    const { container } = render(<ChatScreen projectId="prj_01" />)

    fireEvent.change(screen.getByLabelText("Search messages in field-notes"), {
      target: { value: "nonexistent" },
    })

    expect(screen.getByText("No matches")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("0 of 2 messages match")
    expect(container.querySelector(".app-chat-message-body p")).not.toBeInTheDocument()
  })

  it("matches attachment names during search", () => {
    const workspace = buildWorkspace({
      messages: [
        ...buildWorkspace().messages,
        {
          id: "msg-files",
          channelId: "channel-field-notes",
          authorId: "user-mara",
          authorName: "Mara",
          anonymous: false,
          body: "",
          attachments: [{ id: "att-1", name: "dataset.csv", sizeBytes: 4096 }],
          createdAt: "2026-11-19T09:40:00.000Z",
          status: "sent",
        },
      ],
    })
    mockWorkspace(workspace)
    const { container } = render(<ChatScreen projectId="prj_01" />)

    fireEvent.change(screen.getByLabelText("Search messages in field-notes"), {
      target: { value: "dataset" },
    })

    const name = container.querySelector(".app-chat-attachment-name")
    expect(name?.textContent).toBe("dataset.csv")
    expect(name?.querySelector("mark")).toHaveTextContent("dataset")
    expect(container.querySelector(".app-chat-message-body p")).not.toBeInTheDocument()
  })

  it("exports the active channel history as JSON", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const user = userEvent.setup()

    render(<ChatScreen projectId="prj_01" />)
    await user.click(screen.getByRole("button", { name: "Export channel" }))
    await user.click(screen.getByRole("menuitem", { name: "Export as JSON" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    const payload = JSON.parse(await blob.text())
    // Only the active channel's messages are exported, not the whole workspace.
    expect(payload.channel).toMatchObject({ id: "channel-field-notes", name: "field-notes" })
    expect(payload.messageCount).toBe(2)
    expect(payload.messages.map((message: { body: string }) => message.body)).toEqual([
      "New survey batch is in /data.",
      "Site IDs are in the shared note.",
    ])
    expect(payload.messages[0]).toMatchObject({
      authorName: "Mara",
      createdAt: "2026-11-19T09:14:00.000Z",
    })
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("exports the active channel history as Markdown", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const user = userEvent.setup()

    render(<ChatScreen projectId="prj_01" />)
    await user.click(screen.getByRole("button", { name: "Export channel" }))
    await user.click(screen.getByRole("menuitem", { name: "Export as Markdown" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    const markdown = await blob.text()
    expect(markdown).toContain("# field-notes")
    expect(markdown).toContain("2 messages exported")
    expect(markdown).toContain("**Mara** — 2026-11-19T09:14:00.000Z")
    expect(markdown).toContain("New survey batch is in /data.")
    expect(markdown).not.toContain("Duplicates isolated in archive.")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("shows slash-command suggestions on '/' and applies one with Enter", () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/" } })
    expect(screen.getByRole("listbox", { name: "Chat commands" })).toBeInTheDocument()
    // Every command is listed, including bot commands tagged for the bot.
    expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(6)

    // Typing narrows the list; Enter inserts the highlighted command.
    fireEvent.change(composer, { target: { value: "/sh" } })
    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent("/shrug")

    fireEvent.keyDown(composer, { key: "Enter" })
    expect(composer).toHaveValue("/shrug ")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("closes the command palette with Escape", () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/" } })
    expect(screen.getByRole("listbox", { name: "Chat commands" })).toBeInTheDocument()

    fireEvent.keyDown(composer, { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    // The draft is untouched so the user can keep typing.
    expect(composer).toHaveValue("/")
  })

  it("rewrites /me into an action message before sending", async () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/me waves hello" } })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith(
        "You waves hello",
        undefined,
        undefined,
        undefined,
      ),
    )
  })

  it("sends bot commands verbatim so Spindle Bot still answers them", async () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/status" } })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(chatActions.sendMessage).toHaveBeenCalledWith(
        "/status",
        undefined,
        undefined,
        undefined,
      ),
    )
  })

  it("sets and clears the channel topic with /topic without sending", () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/topic survey week 3" } })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    expect(chatActions.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByText(/Topic: survey week 3/)).toBeInTheDocument()

    fireEvent.change(composer, { target: { value: "/topic" } })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    expect(screen.queryByText(/Topic:/)).not.toBeInTheDocument()
  })

  it("handles /remind locally without posting to the channel", () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/remind 10 check the gauge" } })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    expect(chatActions.sendMessage).not.toHaveBeenCalled()
    // The composer clears so the same draft can't double-fire.
    expect(composer).toHaveValue("")
  })

  it("keeps the draft and sends nothing when a command is missing arguments", async () => {
    render(<ChatScreen projectId="prj_01" />)
    const composer = screen.getByLabelText(/Message field-notes/)

    fireEvent.change(composer, { target: { value: "/me" } })
    fireEvent.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() => expect(chatActions.sendMessage).not.toHaveBeenCalled())
    expect(composer).toHaveValue("/me")
  })
})

describe("chatExportJson", () => {
  it("serializes channel metadata and every message field", () => {
    const workspace = buildWorkspace()
    const channel = workspace.channels[0]
    const messages = workspace.messages.filter((message) => message.channelId === channel.id)

    const payload = JSON.parse(chatExportJson(channel, messages))

    expect(payload.channel).toEqual({
      id: "channel-field-notes",
      name: "field-notes",
      kind: "channel",
      memberCount: 8,
    })
    expect(payload.messageCount).toBe(2)
    expect(payload.messages[0]).toMatchObject({
      id: "msg-1",
      authorId: "user-mara",
      authorName: "Mara",
      anonymous: false,
      body: "New survey batch is in /data.",
      createdAt: "2026-11-19T09:14:00.000Z",
      status: "sent",
      replyToId: null,
      reactions: [{ emoji: "🎉", userIds: ["user-mara", "user-theo"] }],
    })
    expect(payload.messages[1].mentions).toEqual([{ id: "user-mara", name: "Mara" }])
    expect(typeof payload.exportedAt).toBe("string")
  })
})

describe("chatExportMarkdown", () => {
  it("renders author, timestamp, body, attachments, and reply context", () => {
    const workspace = buildWorkspace({
      messages: [
        ...buildWorkspace().messages,
        {
          id: "msg-reply",
          channelId: "channel-field-notes",
          authorId: "user-theo",
          authorName: "Theo",
          anonymous: false,
          body: "On it.",
          replyToId: "msg-1",
          attachments: [{ id: "att-1", name: "notes.txt", sizeBytes: 2048 }],
          createdAt: "2026-11-19T09:25:00.000Z",
          status: "sent",
        },
      ],
    })
    const channel = workspace.channels[0]
    const messages = workspace.messages.filter((message) => message.channelId === channel.id)
    const messagesById = new Map(messages.map((message) => [message.id, message]))

    const markdown = chatExportMarkdown(channel, messages, messagesById)

    expect(markdown).toContain("# field-notes")
    expect(markdown).toContain("3 messages exported")
    expect(markdown).toContain("**Theo** — 2026-11-19T09:25:00.000Z")
    expect(markdown).toContain("> Reply to Mara: New survey batch is in /data.")
    expect(markdown).toContain("- Attachment: notes.txt (2 KB)")
    expect(markdown).toContain("- Reactions: 🎉 (2)")
  })
})
