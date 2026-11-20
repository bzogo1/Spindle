/**
 * User-facing chat slash commands for the composer.
 *
 * Scope split with Spindle Bot: commands marked `scope: "bot"` (help,
 * status, commands) are answered by the mock store's rule-based bot reply —
 * the composer leaves them untouched so the store still sees the `/command`
 * body. Commands marked `scope: "user"` are resolved here before send:
 * message commands rewrite the body into plain text (so the bot trigger no
 * longer matches), and local commands run in the composer only.
 */

export type ChatCommandScope = "user" | "bot"

export interface ChatCommand {
  /** Command name without the leading slash, e.g. "me". */
  name: string
  /** Full invocation shown in the palette, e.g. "/me <action>". */
  usage: string
  description: string
  scope: ChatCommandScope
  /** Alternate names that also resolve to this command. */
  aliases?: string[]
}

export const CHAT_COMMANDS: ChatCommand[] = [
  {
    name: "me",
    usage: "/me <action>",
    description: "Post an action as yourself, e.g. /me waves hello",
    scope: "user",
  },
  {
    name: "shrug",
    usage: "/shrug [text]",
    description: "Append ¯\\_(ツ)_/¯ to your message",
    scope: "user",
  },
  {
    name: "tableflip",
    usage: "/tableflip [text]",
    description: "Append (╯°□°)╯︵ ┻━┻ to your message",
    scope: "user",
  },
  {
    name: "unflip",
    usage: "/unflip [text]",
    description: "Append ┬─┬ ノ( ゜-゜ノ) to your message",
    scope: "user",
  },
  {
    name: "topic",
    usage: "/topic <text>",
    description: "Set the topic shown in the thread header (empty clears it)",
    scope: "user",
  },
  {
    name: "remind",
    usage: "/remind <when> <text>",
    description: "Get a toast reminder, e.g. /remind 10m check the gauge",
    scope: "user",
  },
  {
    name: "help",
    usage: "/help",
    description: "Ask Spindle Bot what it can do",
    scope: "bot",
  },
  {
    name: "status",
    usage: "/status",
    description: "Ask Spindle Bot for a snapshot of this thread",
    scope: "bot",
  },
  {
    name: "commands",
    usage: "/commands",
    description: "Ask Spindle Bot for its command list",
    scope: "bot",
  },
]

/** Outcome of resolving a draft that starts with "/". */
export type ChatCommandResult =
  /** Rewrite the draft into this body and send it as a normal message. */
  | { type: "send"; body: string }
  /** Set (or clear, when topic is empty) the channel topic. */
  | { type: "topic"; topic: string }
  /** Schedule a reminder toast `minutes` from now. */
  | { type: "remind"; minutes: number; text: string }
  /** Bad or missing arguments — surface `usage` to the user, keep the draft. */
  | { type: "usage"; usage: string }

const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]*/i

/** Split a draft like "/me waves hi" into { name: "me", args: "waves hi" }. */
export function parseCommandDraft(draft: string): { name: string; args: string } | null {
  const trimmed = draft.trimStart()
  if (!trimmed.startsWith("/")) return null
  const rest = trimmed.slice(1)
  const match = COMMAND_NAME_PATTERN.exec(rest)
  if (!match) return null
  const name = match[0].toLowerCase()
  const args = rest.slice(match[0].length).trim()
  return { name, args }
}

function findCommand(name: string): ChatCommand | undefined {
  return CHAT_COMMANDS.find((command) => command.name === name || command.aliases?.includes(name))
}

/**
 * Palette suggestions for a draft starting with "/". Returns every command
 * whose name or alias starts with `query` (empty query lists all), user
 * commands first so local actions stay easy to reach.
 */
export function matchChatCommands(query: string): ChatCommand[] {
  const needle = query.toLowerCase()
  const matches = (command: ChatCommand) =>
    command.name.startsWith(needle) || command.aliases?.some((a) => a.startsWith(needle))
  return [
    ...CHAT_COMMANDS.filter((c) => c.scope === "user" && matches(c)),
    ...CHAT_COMMANDS.filter((c) => c.scope === "bot" && matches(c)),
  ]
}

const SHRUG = "¯\\_(ツ)_/¯"
const TABLEFLIP = "(╯°□°)╯︵ ┻━┻"
const UNFLIP = "┬─┬ ノ( ゜-゜ノ)"

/** "/remind 30s text" | "/remind 10 text" (minutes) | "/remind 2h text". */
function parseRemindDelay(args: string): { minutes: number; text: string } | null {
  const match = /^(\d+)\s*([smh])?\s+(.+)$/s.exec(args.trim())
  if (!match) return null
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2] ?? "m"
  const minutes = unit === "s" ? amount / 60 : unit === "h" ? amount * 60 : amount
  return { minutes, text: match[3].trim() }
}

/**
 * Resolve a composer draft. Returns null when the draft is not a recognized
 * user command — including unknown `/...` input and bot commands — so the
 * caller can send it unchanged (bot commands still reach Spindle Bot, unknown
 * ones get its "Unknown command" reply).
 */
export function executeChatCommand(
  draft: string,
  context: { anonymous: boolean },
): ChatCommandResult | null {
  const parsed = parseCommandDraft(draft)
  if (!parsed) return null
  const command = findCommand(parsed.name)
  if (!command || command.scope === "bot") return null
  const { args } = parsed

  switch (command.name) {
    case "me": {
      if (!args) return { type: "usage", usage: command.usage }
      const actor = context.anonymous ? "Anonymous surveyor" : "You"
      return { type: "send", body: `${actor} ${args}` }
    }
    case "shrug":
      return { type: "send", body: args ? `${args} ${SHRUG}` : SHRUG }
    case "tableflip":
      return { type: "send", body: args ? `${args} ${TABLEFLIP}` : TABLEFLIP }
    case "unflip":
      return { type: "send", body: args ? `${args} ${UNFLIP}` : UNFLIP }
    case "topic":
      return { type: "topic", topic: args }
    case "remind": {
      const parsed2 = parseRemindDelay(args)
      if (!parsed2) return { type: "usage", usage: command.usage }
      return { type: "remind", minutes: parsed2.minutes, text: parsed2.text }
    }
    default:
      return null
  }
}
