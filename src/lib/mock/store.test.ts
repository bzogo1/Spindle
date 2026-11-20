import { describe, expect, it, vi } from "vitest"

import { getProjectTemplate } from "../project-templates"
import { CURRENT_USER, MockStore } from "./store"

describe("MockStore chat", () => {
  it("stores attachments on sent messages", () => {
    const store = new MockStore("prj_01")
    const id = store.sendChatMessage("channel-field-notes", "files attached", false, [
      { name: "data.csv", sizeBytes: 2048 },
    ])

    expect(id).toBeTruthy()
    const message = store.getState().chat.messages.find((candidate) => candidate.id === id)
    expect(message?.attachments).toEqual([
      expect.objectContaining({ name: "data.csv", sizeBytes: 2048 }),
    ])
  })

  it("accepts attachment-only messages", () => {
    const store = new MockStore("prj_01")
    const id = store.sendChatMessage("channel-field-notes", "   ", false, [
      { name: "plot.png", sizeBytes: 10 },
    ])

    expect(id).toBeTruthy()
    const message = store.getState().chat.messages.find((candidate) => candidate.id === id)
    expect(message?.body).toBe("")
    expect(message?.attachments).toHaveLength(1)
  })

  it("rejects empty messages without attachments", () => {
    const store = new MockStore("prj_01")
    expect(store.sendChatMessage("channel-field-notes", "   ")).toBeNull()
  })

  it("queues a placeholder auto-reply after the delay", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      const before = store.getState().chat.messages.length

      store.queueChatAutoReply("channel-field-notes", 50)
      expect(store.getState().chat.messages.length).toBe(before)

      vi.advanceTimersByTime(60)
      const messages = store.getState().chat.messages
      expect(messages.length).toBe(before + 1)
      expect(messages.at(-1)?.channelId).toBe("channel-field-notes")
      expect(messages.at(-1)?.status).toBe("sent")
      expect(messages.at(-1)?.authorId).not.toBe("user-bogdan")
      expect(store.getState().chat.typing).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the typing entry visible for a window before the auto-reply", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      const before = store.getState().chat.messages.length

      store.queueChatAutoReply("channel-field-notes", 1000)
      expect(store.getState().chat.typing).toHaveLength(1)
      expect(store.getState().chat.typing[0]?.channelId).toBe("channel-field-notes")

      // Typing clears ~300ms before the reply posts, leaving a visible gap.
      vi.advanceTimersByTime(700)
      expect(store.getState().chat.typing).toHaveLength(0)
      expect(store.getState().chat.messages.length).toBe(before)

      vi.advanceTimersByTime(300)
      expect(store.getState().chat.messages.length).toBe(before + 1)
      expect(store.getState().chat.typing).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("persists the anonymous preference and pseudonymizes sent messages", () => {
    const store = new MockStore("prj_01")
    expect(store.getState().chat.anonymous).toBe(false)

    store.setChatAnonymous(true)
    expect(store.getState().chat.anonymous).toBe(true)

    const id = store.sendChatMessage("channel-field-notes", "hello anonymously")
    const message = store.getState().chat.messages.find((candidate) => candidate.id === id)
    expect(message?.anonymous).toBe(true)
    expect(message?.authorName).toBe("Anonymous surveyor")
    expect(message?.authorName).not.toBe("You")
  })

  it("honors an explicit anonymous flag over the workspace preference", () => {
    const store = new MockStore("prj_01")
    store.setChatAnonymous(true)

    const id = store.sendChatMessage("channel-field-notes", "named anyway", false)
    const message = store.getState().chat.messages.find((candidate) => candidate.id === id)
    expect(message?.anonymous).toBe(false)
    expect(message?.authorName).toBe("You")
  })

  it("stores replyToId when replying to a message in the same channel", () => {
    const store = new MockStore("prj_01")
    const id = store.sendChatMessage("channel-field-notes", "following up", false, [], [], "msg-1")

    expect(id).toBeTruthy()
    const message = store.getState().chat.messages.find((candidate) => candidate.id === id)
    expect(message?.replyToId).toBe("msg-1")
  })

  it("rejects replies to messages outside the channel or missing entirely", () => {
    const store = new MockStore("prj_01")
    // msg-4 lives in channel-data-cleaning, not channel-field-notes.
    expect(
      store.sendChatMessage("channel-field-notes", "wrong channel", false, [], [], "msg-4"),
    ).toBeNull()
    expect(
      store.sendChatMessage("channel-field-notes", "no parent", false, [], [], "msg-999"),
    ).toBeNull()
  })

  it("threads the queued auto-reply under the triggering message", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      const id = store.sendChatMessage("channel-field-notes", "ping")
      const before = store.getState().chat.messages.length

      store.queueChatAutoReply("channel-field-notes", 50, id ?? undefined)
      vi.advanceTimersByTime(60)

      const reply = store.getState().chat.messages.at(-1)
      expect(store.getState().chat.messages.length).toBe(before + 1)
      expect(reply?.replyToId).toBe(id)
    } finally {
      vi.useRealTimers()
    }
  })

  it("seeds a failed message that retryChatMessage can target", () => {
    const store = new MockStore("prj_01")
    const seeded = store.getState().chat.messages.find((candidate) => candidate.id === "msg-6")
    expect(seeded?.status).toBe("failed")
    expect(seeded?.channelId).toBe("channel-data-cleaning")
  })

  it("retries a failed message back to sending, then settles to sent", () => {
    const store = new MockStore("prj_01")

    const result = store.retryChatMessage("msg-6")
    expect(result.ok).toBe(true)
    expect(
      store.getState().chat.messages.find((candidate) => candidate.id === "msg-6")?.status,
    ).toBe("sending")

    store.settleChatMessages()
    expect(
      store.getState().chat.messages.find((candidate) => candidate.id === "msg-6")?.status,
    ).toBe("sent")
  })

  it("rejects retrying a message that is not failed", () => {
    const store = new MockStore("prj_01")
    const result = store.retryChatMessage("msg-1")
    expect(result.ok).toBe(false)
    expect(
      store.getState().chat.messages.find((candidate) => candidate.id === "msg-1")?.status,
    ).toBe("sent")
  })

  it("routes @mentions of the chat bot to a rule-based bot reply", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      const body = "@Spindle Bot can you hear me?"
      const id = store.sendChatMessage("channel-field-notes", body)
      const before = store.getState().chat.messages.length

      store.queueChatResponse("channel-field-notes", 50, id ?? undefined, body)

      // The typing entry is flagged as the bot while it composes.
      expect(store.getState().chat.typing[0]?.memberId).toBe("bot-spindle")
      expect(store.getState().chat.typing[0]?.bot).toBe(true)

      vi.advanceTimersByTime(60)
      const reply = store.getState().chat.messages.at(-1)
      expect(store.getState().chat.messages.length).toBe(before + 1)
      expect(reply?.authorId).toBe("bot-spindle")
      expect(reply?.authorName).toBe("Spindle Bot")
      expect(reply?.bot).toBe(true)
      expect(reply?.replyToId).toBe(id)
      expect(reply?.body).toContain("Spindle Bot")
      expect(store.getState().chat.typing).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("answers slash commands with command-specific bot replies", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      const id = store.sendChatMessage("channel-field-notes", "/status")
      const before = store.getState().chat.messages.length

      store.queueChatResponse("channel-field-notes", 50, id ?? undefined, "/status")
      vi.advanceTimersByTime(60)

      const reply = store.getState().chat.messages.at(-1)
      expect(store.getState().chat.messages.length).toBe(before + 1)
      expect(reply?.bot).toBe(true)
      expect(reply?.body).toContain("All systems nominal")
      expect(reply?.body).toContain("#field-notes")
    } finally {
      vi.useRealTimers()
    }
  })

  it("points unknown slash commands back at /help", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      store.queueChatResponse("channel-field-notes", 50, undefined, "/bogus")
      vi.advanceTimersByTime(60)

      const reply = store.getState().chat.messages.at(-1)
      expect(reply?.bot).toBe(true)
      expect(reply?.body).toContain('Unknown command "/bogus"')
    } finally {
      vi.useRealTimers()
    }
  })

  it("falls back to the member auto-reply for messages not addressed to the bot", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      const before = store.getState().chat.messages.length

      store.queueChatResponse("channel-field-notes", 50, undefined, "just chatting")
      vi.advanceTimersByTime(60)

      const reply = store.getState().chat.messages.at(-1)
      expect(store.getState().chat.messages.length).toBe(before + 1)
      expect(reply?.bot).toBeUndefined()
      expect(["user-mara", "user-theo", "user-jules"]).toContain(reply?.authorId)
    } finally {
      vi.useRealTimers()
    }
  })

  it("adds your id when toggling an emoji chip you have not reacted to", () => {
    const store = new MockStore("prj_01")
    // msg-1 has 🎉 from user-mara and user-theo; CURRENT_USER has not reacted.
    const before = store
      .getState()
      .chat.messages.find((candidate) => candidate.id === "msg-1")
      ?.reactions?.find((reaction) => reaction.emoji === "🎉")?.userIds
    expect(before).toEqual(["user-mara", "user-theo"])

    expect(store.toggleChatReaction("msg-1", "🎉").ok).toBe(true)

    const reaction = store
      .getState()
      .chat.messages.find((candidate) => candidate.id === "msg-1")
      ?.reactions?.find((candidateReaction) => candidateReaction.emoji === "🎉")
    expect(reaction?.userIds).toEqual(["user-mara", "user-theo", CURRENT_USER.id])
  })

  it("removes your reaction and splices the chip when it becomes empty", () => {
    const store = new MockStore("prj_01")

    // 👍 on msg-1 is only from user-jules: add yours, then toggle off.
    store.toggleChatReaction("msg-1", "👍")
    let reactions = store
      .getState()
      .chat.messages.find((candidate) => candidate.id === "msg-1")?.reactions
    expect(reactions?.find((reaction) => reaction.emoji === "👍")?.userIds).toEqual([
      "user-jules",
      CURRENT_USER.id,
    ])

    store.toggleChatReaction("msg-1", "👍")
    reactions = store
      .getState()
      .chat.messages.find((candidate) => candidate.id === "msg-1")?.reactions
    expect(reactions?.find((reaction) => reaction.emoji === "👍")?.userIds).toEqual(["user-jules"])

    // Remove the other user's id via the store is not possible, so exercise
    // the empty-splice path on a fresh chip owned solely by CURRENT_USER.
    store.toggleChatReaction("msg-1", "🔥")
    store.toggleChatReaction("msg-1", "🔥")
    reactions = store
      .getState()
      .chat.messages.find((candidate) => candidate.id === "msg-1")?.reactions
    expect(reactions?.find((reaction) => reaction.emoji === "🔥")).toBeUndefined()
  })

  it("ignores bot triggers while the bot is disabled", () => {
    vi.useFakeTimers()
    try {
      const store = new MockStore("prj_01")
      expect(store.getState().chat.botEnabled).toBe(true)
      store.setChatBotEnabled(false)
      expect(store.getState().chat.botEnabled).toBe(false)

      const before = store.getState().chat.messages.length
      store.queueChatResponse("channel-field-notes", 50, undefined, "@bot hello?")
      vi.advanceTimersByTime(60)

      const reply = store.getState().chat.messages.at(-1)
      expect(store.getState().chat.messages.length).toBe(before + 1)
      expect(reply?.bot).toBeUndefined()
      expect(reply?.authorId).not.toBe("bot-spindle")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("MockStore file previews", () => {
  it("exposes a previewUrl for seeded image files", () => {
    const store = new MockStore("prj_01")
    const image = store.getState().files.find((file) => file.name === "recovery-map.png")

    expect(image?.previewUrl).toMatch(/^data:image\/svg\+xml,/)
    expect(decodeURIComponent(image!.previewUrl!)).toContain("<svg")
  })

  it("leaves previewUrl unset for non-image seeded files", () => {
    const store = new MockStore("prj_01")
    const files = store.getState().files.filter((file) => file.kind === "file")

    const nonImages = files.filter((file) => file.name !== "recovery-map.png")
    expect(nonImages.length).toBeGreaterThan(0)
    nonImages.forEach((file) => {
      expect(file.previewUrl).toBeUndefined()
    })
  })

  it("assigns previewUrl when an image upload completes", () => {
    const store = new MockStore("prj_01")
    const { accepted } = store.addUploads("folder-outputs", [
      { name: "transect.jpg", sizeBytes: 4096, mimeType: "image/jpeg" },
    ])
    expect(accepted).toHaveLength(1)

    store.tickUploads(10_000)

    const uploaded = store.getState().files.find((file) => file.name === "transect.jpg")
    expect(uploaded?.previewUrl).toMatch(/^data:image\/svg\+xml,/)
  })

  it("assigns a public video previewUrl to video uploads", () => {
    const store = new MockStore("prj_01")
    store.addUploads(null, [{ name: "drone.mp4", sizeBytes: 4096, mimeType: "video/mp4" }])

    store.tickUploads(10_000)

    const uploaded = store.getState().files.find((file) => file.name === "drone.mp4")
    expect(uploaded?.previewUrl).toBe("/assets/changelog/demo.mp4")
  })

  it("seeds version history with inline content the drawer can preview", () => {
    const store = new MockStore("prj_01")
    const files = store.getState().files.filter((file) => (file.versions?.length ?? 0) > 0)

    // Every seeded history entry carries a snapshot so "View" is never a dead end.
    expect(files.length).toBeGreaterThan(0)
    files.forEach((file) => {
      file.versions!.forEach((version) => {
        expect(version.id).toBeTruthy()
        expect(version.label).toBeTruthy()
        expect(version.createdAt).toBeTruthy()
        expect(version.author).toBeTruthy()
        expect(version.content ?? version.url).toBeTruthy()
      })
    })

    const tidal = files.find((file) => file.name === "tidal-2026.csv")
    expect(tidal?.versions?.map((version) => version.label)).toEqual(["v1", "v2"])
    // Snapshots are earlier, smaller drafts of the current excerpt.
    expect(tidal?.versions?.[0].content).toContain("A-01,28.4,4.2")
    expect(tidal?.versions?.[0].content).not.toContain("C-05")
    expect(tidal?.versions?.[1].content).toContain("B-07,29.6,4.4")
    expect(tidal?.versions?.[1].content).not.toContain("C-02")
    expect(tidal?.content).toContain("C-05,27.4,3.5")
  })

  it("restores a file version and keeps the outgoing content in history", () => {
    const store = new MockStore("prj_01")
    const before = store.getState().files.find((file) => file.id === "file-tidal")
    expect(before?.content).toContain("C-05,27.4,3.5")
    const versionCount = before?.versions?.length ?? 0

    const result = store.restoreVersion("file-tidal", "ver-tidal-v1")
    expect(result).toEqual({ ok: true })

    const restored = store.getState().files.find((file) => file.id === "file-tidal")
    // Content and size now match the v1 snapshot.
    expect(restored?.content).toBe(before?.versions?.[0].content)
    expect(restored?.sizeBytes).toBe(before?.versions?.[0].sizeBytes)
    // The previous current content was appended as a new version.
    expect(restored?.versions).toHaveLength(versionCount + 1)
    const appended = restored?.versions?.at(-1)
    expect(appended?.label).toBe("v3")
    expect(appended?.author).toBe(CURRENT_USER.name)
    expect(appended?.content).toContain("C-05,27.4,3.5")
  })

  it("rejects restoring a version without a snapshot", () => {
    const store = new MockStore("prj_01")
    const fieldNotes = store.getState().files.find((file) => file.id === "file-field-notes")
    // Simulate a URL-only version the API cannot restore inline.
    const result = store.restoreVersion("file-field-notes", "ver-missing")
    expect(result.ok).toBe(false)
    expect(fieldNotes?.content).toContain("Transect 04 is ready")
  })

  it("does not assign previewUrl to document uploads", () => {
    const store = new MockStore("prj_01")
    store.addUploads(null, [{ name: "notes.pdf", sizeBytes: 4096, mimeType: "application/pdf" }])

    store.tickUploads(10_000)

    const uploaded = store.getState().files.find((file) => file.name === "notes.pdf")
    expect(uploaded).toBeDefined()
    expect(uploaded?.previewUrl).toBeUndefined()
  })
})

describe("MockStore project templates", () => {
  it("seeds the template file tree, chat threads, and lab environments", () => {
    const store = new MockStore("prj_new", getProjectTemplate("research"))
    const state = store.getState()

    const rootFolders = state.files.filter(
      (node) => node.kind === "folder" && node.parentId === null,
    )
    expect(rootFolders.map((node) => node.name).sort()).toEqual(["data", "methods", "notebooks"])

    const questions = state.files.find((node) => node.name === "research-questions.md")
    expect(questions?.kind).toBe("file")
    expect(questions?.parentId).toBeNull()
    expect(questions?.content).toContain("Research questions")

    const protocol = state.files.find((node) => node.name === "protocol.md")
    expect(protocol?.parentId).toBe(state.files.find((node) => node.name === "methods")?.id)

    expect(state.chat.channels.map((channel) => channel.name)).toEqual([
      "general",
      "data",
      "writing",
    ])
    expect(state.chat.activeChannelId).toBe(state.chat.channels[0].id)
    expect(state.chat.messages).toHaveLength(0)

    expect(state.lab.environments.map((env) => env.kind)).toEqual([
      "jupyter",
      "rstudio",
      "terminal",
    ])
    expect(state.lab.environments.every((env) => env.status === "stopped")).toBe(true)
  })

  it("seeds an empty workspace for the blank template", () => {
    const store = new MockStore("prj_blank", getProjectTemplate("blank"))
    const state = store.getState()

    expect(state.files).toHaveLength(0)
    expect(state.chat.channels.map((channel) => channel.name)).toEqual(["general"])
    expect(state.lab.environments).toHaveLength(4)
  })

  it("keeps the rich demo seed when no template is provided", () => {
    const store = new MockStore("prj_01")
    const state = store.getState()

    expect(state.files.some((node) => node.name === "tidal-2026.csv")).toBe(true)
    expect(state.chat.channels.some((channel) => channel.id === "channel-field-notes")).toBe(true)
    expect(state.lab.environments.find((env) => env.id === "lab-rstudio")?.status).toBe("running")
  })
})
