/**
 * Deploy notification dispatcher for CI pipelines.
 *
 * Sends a structured "deploy" event to one or more channels configured via
 * environment variables:
 *
 *   - webhook — generic HTTP POST of the JSON payload to DEPLOY_NOTIFY_WEBHOOK_URL
 *   - email   — Resend transactional email via src/lib/email.ts (RESEND_API_KEY)
 *   - console — human-readable line on stdout (always available as fallback)
 *
 * Usage:
 *   npx tsx scripts/deploy/notify.ts --event succeeded [options]
 *
 * Options:
 *   --event <name>        required: started | succeeded | failed | rolled-back
 *   --environment <name>  overrides DEPLOY_ENVIRONMENT / VERCEL_ENV
 *   --revision <sha>      overrides DEPLOY_REVISION / VERCEL_GIT_COMMIT_SHA / GITHUB_SHA
 *   --url <url>           deployment URL (DEPLOY_URL fallback)
 *   --error <message>     failure detail, e.g. from $GITHUB_STEP_SUMMARY context
 *   --actor <name>        who/what triggered the deploy (DEPLOY_ACTOR fallback)
 *   --channels <list>     comma-separated override of DEPLOY_NOTIFY_CHANNELS
 *   --dry-run             resolve channels and print payloads without sending
 *
 * Exit codes: 0 delivered (or dry-run), 1 at least one channel failed,
 * 2 usage error. Safe to call from any CI step; no dependencies beyond the
 * repo's own toolchain (run with tsx, already a devDependency).
 *
 * See docs/deploy/notifications.md for the full env-var contract.
 */

import { env } from "node:process"

import { sendEmail, type EmailDelivery } from "../../src/lib/email"

export const DEPLOY_EVENTS = ["started", "succeeded", "failed", "rolled-back"] as const
export type DeployEvent = (typeof DEPLOY_EVENTS)[number]

export type DeployNotification = {
  event: DeployEvent
  environment: string
  revision?: string
  url?: string
  actor?: string
  error?: string
  timestamp: string
  /** CI context auto-detected from common platform variables. */
  ci?: {
    system?: string
    runId?: string
    runUrl?: string
    repository?: string
  }
}

export type NotifyChannel = "webhook" | "email" | "console"

const WEBHOOK_TIMEOUT_MS = 10_000

function readEnv(key: string): string | undefined {
  const value = env[key]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value !== "")
}

function detectCi(): DeployNotification["ci"] {
  if (env.GITHUB_ACTIONS === "true") {
    const server = readEnv("GITHUB_SERVER_URL") ?? "https://github.com"
    const repo = readEnv("GITHUB_REPOSITORY")
    const runId = readEnv("GITHUB_RUN_ID")
    return {
      system: "github-actions",
      runId,
      repository: repo,
      runUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : undefined,
    }
  }
  if (env.VERCEL === "1" || readEnv("VERCEL_ENV")) {
    return {
      system: "vercel",
      runId: readEnv("VERCEL_DEPLOYMENT_ID"),
      runUrl: readEnv("VERCEL_URL") ? `https://${readEnv("VERCEL_URL")}` : undefined,
    }
  }
  return undefined
}

/** Builds the notification payload, filling gaps from well-known CI env vars. */
export function buildNotification(
  event: DeployEvent,
  overrides: Partial<
    Pick<DeployNotification, "environment" | "revision" | "url" | "actor" | "error">
  > = {},
): DeployNotification {
  return {
    event,
    environment: firstDefined(
      overrides.environment,
      readEnv("DEPLOY_ENVIRONMENT"),
      readEnv("VERCEL_ENV"),
      readEnv("APP_ENV"),
      env.NODE_ENV === "production" ? "production" : "development",
    ) as string,
    revision: firstDefined(
      overrides.revision,
      readEnv("DEPLOY_REVISION"),
      readEnv("VERCEL_GIT_COMMIT_SHA"),
      readEnv("GITHUB_SHA"),
      readEnv("CI_COMMIT_SHA"),
    ),
    url: firstDefined(
      overrides.url,
      readEnv("DEPLOY_URL"),
      readEnv("VERCEL_URL") && `https://${readEnv("VERCEL_URL")}`,
    ),
    actor: firstDefined(overrides.actor, readEnv("DEPLOY_ACTOR"), readEnv("GITHUB_ACTOR")),
    error: overrides.error ? overrides.error.slice(0, 2000) : undefined,
    timestamp: new Date().toISOString(),
    ci: detectCi(),
  }
}

/** Resolves which channels to use from DEPLOY_NOTIFY_CHANNELS / flags. */
export function resolveChannels(override?: string): NotifyChannel[] {
  const raw = override ?? readEnv("DEPLOY_NOTIFY_CHANNELS")
  if (raw) {
    const requested = raw
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name): name is NotifyChannel =>
        (["webhook", "email", "console"] as const).includes(name as NotifyChannel),
      )
    if (requested.length > 0) return [...new Set(requested)]
  }

  // Auto mode: use every channel that has the credentials it needs.
  const auto: NotifyChannel[] = []
  if (readEnv("DEPLOY_NOTIFY_WEBHOOK_URL")) auto.push("webhook")
  if (readEnv("RESEND_API_KEY")) auto.push("email")
  if (auto.length === 0) auto.push("console")
  return auto
}

function shortRevision(revision: string | undefined): string {
  if (!revision) return "unknown"
  return revision.length > 12 ? revision.slice(0, 12) : revision
}

function consoleLine(notification: DeployNotification): string {
  const parts = [
    `[deploy] ${notification.event}`,
    `env=${notification.environment}`,
    `rev=${shortRevision(notification.revision)}`,
  ]
  if (notification.url) parts.push(`url=${notification.url}`)
  if (notification.actor) parts.push(`actor=${notification.actor}`)
  if (notification.error) parts.push(`error=${notification.error}`)
  return parts.join(" ")
}

function sendConsole(notification: DeployNotification): Promise<"sent" | "unconfigured"> {
  console.log(consoleLine(notification))
  console.log(JSON.stringify(notification, null, 2))
  return Promise.resolve("sent")
}

async function sendWebhook(
  notification: DeployNotification,
  url: string,
): Promise<"sent" | "unconfigured"> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = readEnv("DEPLOY_NOTIFY_WEBHOOK_TOKEN")
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(
      `Webhook POST failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    )
  }
  return "sent"
}

async function sendEmailChannel(notification: DeployNotification): Promise<EmailDelivery> {
  const to = firstDefined(readEnv("DEPLOY_NOTIFY_EMAIL"), readEnv("CONTACT_TO_EMAIL"))
  if (!to) return "unconfigured"

  const subject = `[deploy] ${notification.environment} ${notification.event} — ${shortRevision(notification.revision)}`
  const lines = [
    `Deploy ${notification.event} on ${notification.environment}.`,
    "",
    `Revision: ${notification.revision ?? "unknown"}`,
    `Environment: ${notification.environment}`,
    notification.url ? `URL: ${notification.url}` : undefined,
    notification.actor ? `Actor: ${notification.actor}` : undefined,
    notification.ci?.runUrl ? `CI run: ${notification.ci.runUrl}` : undefined,
    notification.error ? `Error: ${notification.error}` : undefined,
    `Timestamp: ${notification.timestamp}`,
  ].filter((line): line is string => line !== undefined)

  // Pass only the keys this send needs so getServerEnv never validates
  // unrelated app configuration inside CI.
  const delivery = await sendEmail(
    { to, subject, text: `${lines.join("\n")}\n` },
    {
      NODE_ENV: "production",
      RESEND_API_KEY: readEnv("RESEND_API_KEY"),
      CONTACT_FROM_EMAIL: readEnv("CONTACT_FROM_EMAIL"),
      CONTACT_TO_EMAIL: to,
    },
  )
  return delivery
}

export type NotifyResult = {
  channel: NotifyChannel
  status: "sent" | "unconfigured" | "failed" | "dry-run"
  detail?: string
}

/** Sends the notification to every resolved channel; never throws. */
export async function notifyDeploy(
  notification: DeployNotification,
  options: { channels?: string; dryRun?: boolean } = {},
): Promise<NotifyResult[]> {
  const channels = resolveChannels(options.channels)
  const results: NotifyResult[] = []

  for (const channel of channels) {
    if (options.dryRun) {
      results.push({ channel, status: "dry-run" })
      continue
    }

    try {
      if (channel === "webhook") {
        const url = readEnv("DEPLOY_NOTIFY_WEBHOOK_URL")
        if (!url) {
          results.push({
            channel,
            status: "unconfigured",
            detail: "DEPLOY_NOTIFY_WEBHOOK_URL not set",
          })
          continue
        }
        const status = await sendWebhook(notification, url)
        results.push({ channel, status })
      } else if (channel === "email") {
        const status = await sendEmailChannel(notification)
        results.push({
          channel,
          status,
          detail: status === "unconfigured" ? "RESEND_API_KEY or recipient not set" : undefined,
        })
      } else {
        const status = await sendConsole(notification)
        results.push({ channel, status })
      }
    } catch (error) {
      results.push({
        channel,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

type CliOptions = {
  event?: string
  environment?: string
  revision?: string
  url?: string
  error?: string
  actor?: string
  channels?: string
  dryRun: boolean
  help: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, help: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const next = () => argv[++index]
    switch (arg) {
      case "--event":
        options.event = next()
        break
      case "--environment":
        options.environment = next()
        break
      case "--revision":
        options.revision = next()
        break
      case "--url":
        options.url = next()
        break
      case "--error":
        options.error = next()
        break
      case "--actor":
        options.actor = next()
        break
      case "--channels":
        options.channels = next()
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

const USAGE = `Usage: npx tsx scripts/deploy/notify.ts --event <${DEPLOY_EVENTS.join("|")}> [options]

Options:
  --environment <name>   deployment environment (default: DEPLOY_ENVIRONMENT/VERCEL_ENV)
  --revision <sha>       commit SHA (default: DEPLOY_REVISION/VERCEL_GIT_COMMIT_SHA/GITHUB_SHA)
  --url <url>            deployment URL (default: DEPLOY_URL)
  --error <message>      failure detail for failed/rolled-back events
  --actor <name>         who triggered the deploy (default: DEPLOY_ACTOR/GITHUB_ACTOR)
  --channels <list>      comma-separated webhook,email,console (default: DEPLOY_NOTIFY_CHANNELS)
  --dry-run              print what would be sent without delivering
  --help                 show this message

Exit codes: 0 delivered or dry-run, 1 channel failure, 2 usage error.`

async function main(): Promise<number> {
  let options: CliOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    return 2
  }

  if (options.help) {
    console.log(USAGE)
    return 0
  }

  if (!options.event || !(DEPLOY_EVENTS as readonly string[]).includes(options.event)) {
    console.error(`--event is required and must be one of: ${DEPLOY_EVENTS.join(", ")}`)
    return 2
  }

  const notification = buildNotification(options.event as DeployEvent, {
    environment: options.environment,
    revision: options.revision,
    url: options.url,
    error: options.error,
    actor: options.actor,
  })

  const results = await notifyDeploy(notification, {
    channels: options.channels,
    dryRun: options.dryRun,
  })

  if (options.dryRun) {
    console.log(
      `[deploy] dry-run — resolved channels: ${results.map((r) => r.channel).join(", ") || "none"}`,
    )
    console.log(JSON.stringify(notification, null, 2))
    return 0
  }

  let failed = false
  for (const result of results) {
    if (result.status === "failed") {
      failed = true
      console.error(
        `[deploy] channel "${result.channel}" failed: ${result.detail ?? "unknown error"}`,
      )
    } else if (result.status === "unconfigured") {
      console.warn(
        `[deploy] channel "${result.channel}" skipped: ${result.detail ?? "not configured"}`,
      )
    } else {
      console.log(`[deploy] channel "${result.channel}": ${result.status}`)
    }
  }

  if (results.length === 0) {
    console.warn("[deploy] no notification channels resolved; nothing sent")
  }

  return failed ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  })
