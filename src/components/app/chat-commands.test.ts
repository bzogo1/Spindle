import { describe, expect, it } from "vitest"

import { executeChatCommand, matchChatCommands, parseCommandDraft } from "./chat-commands"

const user = { anonymous: false }

describe("parseCommandDraft", () => {
  it("splits a draft into command name and args", () => {
    expect(parseCommandDraft("/me waves hello")).toEqual({ name: "me", args: "waves hello" })
    expect(parseCommandDraft("  /shrug  ")).toEqual({ name: "shrug", args: "" })
    expect(parseCommandDraft("/tableflip")).toEqual({ name: "tableflip", args: "" })
  })

  it("returns null for non-command drafts", () => {
    expect(parseCommandDraft("hello /me")).toBeNull()
    expect(parseCommandDraft("just chatting")).toBeNull()
    expect(parseCommandDraft("/")).toBeNull()
    expect(parseCommandDraft("")).toBeNull()
  })
})

describe("matchChatCommands", () => {
  it("lists every command for an empty query, user commands first", () => {
    const names = matchChatCommands("").map((command) => command.name)
    expect(names).toContain("me")
    expect(names).toContain("topic")
    expect(names).toContain("remind")
    expect(names).toContain("status")
    // User commands lead so local actions are easy to reach.
    expect(names.indexOf("me")).toBeLessThan(names.indexOf("status"))
  })

  it("filters by name prefix", () => {
    expect(matchChatCommands("sh").map((command) => command.name)).toEqual(["shrug"])
    expect(matchChatCommands("t").map((command) => command.name)).toEqual(["tableflip", "topic"])
    expect(matchChatCommands("zzz")).toEqual([])
  })
})

describe("executeChatCommand", () => {
  it("rewrites /me into an action message", () => {
    expect(executeChatCommand("/me waves hello", user)).toEqual({
      type: "send",
      body: "You waves hello",
    })
  })

  it("uses the anonymous identity for /me in anonymous mode", () => {
    expect(executeChatCommand("/me waves", { anonymous: true })).toEqual({
      type: "send",
      body: "Anonymous surveyor waves",
    })
  })

  it("requires an argument for /me", () => {
    expect(executeChatCommand("/me", user)).toEqual({
      type: "usage",
      usage: "/me <action>",
    })
  })

  it("appends kaomoji for /shrug, /tableflip, and /unflip", () => {
    expect(executeChatCommand("/shrug", user)).toEqual({
      type: "send",
      body: "¯\\_(ツ)_/¯",
    })
    expect(executeChatCommand("/shrug well well", user)).toEqual({
      type: "send",
      body: "well well ¯\\_(ツ)_/¯",
    })
    expect(executeChatCommand("/tableflip", user)).toEqual({
      type: "send",
      body: "(╯°□°)╯︵ ┻━┻",
    })
    expect(executeChatCommand("/unflip nice try", user)).toEqual({
      type: "send",
      body: "nice try ┬─┬ ノ( ゜-゜ノ)",
    })
  })

  it("sets or clears the topic via /topic", () => {
    expect(executeChatCommand("/topic survey week 3", user)).toEqual({
      type: "topic",
      topic: "survey week 3",
    })
    expect(executeChatCommand("/topic", user)).toEqual({ type: "topic", topic: "" })
  })

  it("parses /remind delays in seconds, minutes, and hours", () => {
    expect(executeChatCommand("/remind 30s check the gauge", user)).toEqual({
      type: "remind",
      minutes: 0.5,
      text: "check the gauge",
    })
    expect(executeChatCommand("/remind 10 check in", user)).toEqual({
      type: "remind",
      minutes: 10,
      text: "check in",
    })
    expect(executeChatCommand("/remind 2h wrap up", user)).toEqual({
      type: "remind",
      minutes: 120,
      text: "wrap up",
    })
  })

  it("rejects malformed /remind input", () => {
    expect(executeChatCommand("/remind check in", user)).toEqual({
      type: "usage",
      usage: "/remind <when> <text>",
    })
    expect(executeChatCommand("/remind 10m", user)).toEqual({
      type: "usage",
      usage: "/remind <when> <text>",
    })
  })

  it("leaves bot commands and unknown slash input untouched", () => {
    expect(executeChatCommand("/status", user)).toBeNull()
    expect(executeChatCommand("/help", user)).toBeNull()
    expect(executeChatCommand("/commands", user)).toBeNull()
    expect(executeChatCommand("/bogus", user)).toBeNull()
    expect(executeChatCommand("plain message", user)).toBeNull()
  })
})
