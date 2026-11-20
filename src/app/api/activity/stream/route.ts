import { fail } from "@/lib/auth/http"
import { subscribeActivityEvents } from "@/lib/activity/hub"
import { notificationPrincipalFromRequest } from "@/lib/notifications/principal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/activity/stream — Server-Sent Events feed of project-activity
 * updates for the caller's principal.
 *
 * Each frame is `data: <json>` carrying one `ActivityStreamEvent`
 * (`{ type: "activity", activity }`). Comment frames (`: ping`) keep the
 * connection alive through proxies every HEARTBEAT_MS.
 *
 * Mirrors `GET /api/notifications/stream` — see that route for the
 * transport rationale (App Router cannot upgrade to WebSocket; SSE matches
 * the agent-log stream convention). The principal resolver is shared with
 * the notifications channel.
 *
 * NOTE: the hub is in-memory and per-process — on serverless/multi-instance
 * deployments each instance only sees events published on that instance.
 * A shared bus (Postgres LISTEN/NOTIFY, Redis, …) is the follow-up once the
 * activity data layer lands.
 */
const HEARTBEAT_MS = 25_000

export function GET(request: Request) {
  const principal = notificationPrincipalFromRequest(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to receive activity updates.")
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe?.()
    unsubscribe = null
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      unsubscribe = subscribeActivityEvents(principal, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`)
      })

      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS)
      // Let proxies/clients know the stream is live immediately.
      send(": connected\n\n")
    },
    cancel() {
      cleanup()
    },
  })

  // Client disconnects surface as an abort on the request signal in the
  // Node runtime; belt-and-braces alongside the stream's cancel() callback.
  request.signal.addEventListener("abort", cleanup, { once: true })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Disable proxy buffering (nginx/Envoy) so events flush immediately.
      "x-accel-buffering": "no",
    },
  })
}
