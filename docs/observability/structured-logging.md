# Structured logging

Spindle logs structured JSON via [pino](https://getpino.io). Every line is a
single JSON object on stdout/stderr, ready for log aggregation ( Loki,
Datadog, etc.). This document describes what already exists, the conventions
to follow, and how to adopt the helpers in `src/lib/logging/`.

## What already exists

| Piece            | Location                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core logger      | `src/lib/logger.ts`          | `logger` singleton + `createLogger()` factory. Emits JSON with `level`, ISO `time`, `service: "spindle"`, and `msg`.                                                                                                                                                                                                                                                                                                |
| Secret redaction | `src/lib/logger.ts`          | Every log argument passes through `sanitizeForLog` via a pino `logMethod` hook: recursive key/suffix matching (`token`, `secret`, `password`, `apiKey`, `cookie`, `authorization`, …), signed-URL query stripping, Bearer/Basic and JWT scrubbing in strings, depth cap (8), circular-reference marking, `Error` serialisation.                                                                                     |
| Request wrapper  | `src/lib/request-logging.ts` | `withRequestLogging(handler)` for Next.js route handlers: generates/propagates `x-request-id`, emits one `api.request` summary line (`requestId`, `method`, `path`, `status`, `durationMs`, `userId`, `projectId`, `error`), sets the `x-request-id` response header, adds Sentry breadcrumbs on ≥400. `getRequestLogger(request)` / `setRequestLogContext(request, …)` give handlers a request-bound child logger. |

The core logger's redaction is **not optional and cannot be bypassed** — it
runs inside a pino hook on every write. You never need to pre-sanitise
secrets; you _should_ pre-sanitise PII you don't want in logs (see below).

## Modules in `src/lib/logging/`

### `context.ts` — request-scoped log context

`withRequestLogging` binds context to the `Request` object. That works for
route handlers but does not reach deeper layers (services, jobs, server
actions) unless the request is threaded through every call. `context.ts`
stores the same correlation fields in an `AsyncLocalStorage` slot instead.

```ts
import { runWithLogContext, getContextLogger, extendLogContext } from "@/lib/logging"

await runWithLogContext({ requestId, userId, projectId }, async () => {
  // Anywhere in this async scope — including nested awaits:
  getContextLogger().info({ event: "invoice.created" }, "invoice created")
  extendLogContext({ plan: "pro" }) // enriches subsequent lines + wrappers
})
```

API:

- `runWithLogContext(fields, fn)` — enter a context; nested calls merge, inner fields win.
- `runWithLogContextStore(store, fn)` — same, but `fn` receives the exact store object so mutations via `extendLogContext` stay visible to the caller after the scope exits (used by `withHttpLogging`).
- `withLogContext(fields, fn)` — wrap an existing function.
- `getLogContext()` / `contextFields()` — read the active context.
- `extendLogContext(fields)` — merge fields into the active context (mutates the store; no-op outside a context).
- `getContextLogger(base?)` — pino child bound to the context fields; returns `base` (default `logger`) unchanged outside a context.

**Next.js compatibility:** AsyncLocalStorage works in the Node.js runtime —
route handlers, server actions, and server components rendered on the
server. It does not propagate into the Edge runtime or client components.
Enter the context as early as possible (route handler wrapper, server action,
or an `instrumentation` hook) so every downstream line carries the ids.

### `http.ts` — generic HTTP request logging

`withHttpLogging(handler, { logger? })` wraps any `(request: Request, ...args)`
handler — including plain `Request`/`Response` endpoints and webhooks that
don't use `NextRequest`. It emits the same `api.request` event shape as
`withRequestLogging`, enters a log context for the handler (so
`getContextLogger()` works downstream), propagates `x-request-id`, and
rethrows handler errors after logging them.

```ts
export const POST = withHttpLogging(async (request: Request) => {
  extendLogContext({ source: "webhook" })
  return Response.json({ ok: true })
})
```

`logHttpRequest({ request, response, durationMs, logger?, error? })` emits a
single summary line for cases where timing/response happen outside a wrapper.

**When to use which:** app API routes that need Sentry breadcrumbs →
`withRequestLogging`. Everything else (webhooks, plain Request handlers,
non-Next fetch endpoints) → `withHttpLogging`.

### `redact.ts` — PII field redaction

The core logger strips _credentials_. `redact.ts` covers _personal data_ that
is not a secret but still identifies a person. Apply `redactPii(value)` to
objects before logging when you want to keep debuggable shape:

```ts
import { redactPii, maskEmail, hashIdentifier } from "@/lib/logging"

log.info({ invite: redactPii({ email: invite.email, role: invite.role }) })
// -> { invite: { email: "j***@example.com", role: "admin" } }

log.info({ subjectHash: hashIdentifier(user.id) }) // stable pseudonymous id
```

- `maskEmail("jane.doe@example.com")` → `"j***@example.com"`
- `redactPii(value)` — recursive copy; PII keys (`email`, `phoneNumber`,
  `address`, `firstName`, `ipAddress`, …) are masked or replaced with
  `"[Redacted]"`; input is not mutated; circular refs marked.
- `hashIdentifier(value, salt?)` — SHA-256 truncated to 16 hex chars for
  correlating events without exposing raw ids.
- `isPiiKey(key)` — predicate used internally.

Note: `redactPii` only rewrites _field values_, not emails inside free-text
strings. Never interpolate PII into log messages — pass it as structured
fields instead.

## Field standards

Every log line should be queryable without parsing `msg`. Conventions:

- **`event`** — dotted, past-tense-ish event name: `api.request`,
  `invoice.created`, `agent.run.finished`. This is the primary filter field.
- **`msg`** — short human sentence, lowercase, no trailing period. Never put
  dynamic data in `msg`; it belongs in fields.
- **Correlation ids** — `requestId` (per request), `traceId` (optional
  upstream), `userId`, `projectId`. Set via `setRequestLogContext` /
  `extendLogContext`, never hand-rolled per call site.
- **Errors** — pass the `Error` object as the first argument
  (`logger.error(err, "failed to …")`) or as `{ error }`; the core logger
  serialises `{ type, message, stack }` with credential scrubbing.
- **Duration** — `durationMs` (number, one decimal max) for timed operations.
- **Status codes** — numeric HTTP `status` on request lines.

Example line:

```json
{
  "level": "info",
  "time": "2025-01-01T00:00:00.000Z",
  "service": "spindle",
  "requestId": "req_1",
  "userId": "user_1",
  "event": "api.request",
  "method": "GET",
  "path": "/api/projects",
  "status": 200,
  "durationMs": 12.3,
  "msg": "api request"
}
```

## Redaction rules summary

Two layers, both automatic:

1. **Credentials** (`logger.ts`, always on): any key normalising to a
   sensitive name or ending in `token|secret|password|apikey|credential|
cookie|signature` → `"[Redacted]"`; signed-URL query params, userinfo,
   fragments stripped from URLs; `Bearer …`, `Basic …`, and JWT patterns
   scrubbed from strings; recursion through objects/arrays, depth 8, cycles
   → `"[Circular]"`.
2. **PII** (`redact.ts`, opt-in via `redactPii`): email/phone/address/name/IP
   fields masked or removed before logging.

If you find yourself wanting to log a field that gets redacted, rename the
_log field_ (e.g. log `fileName` + `fileSize`, not `fileContent`) — do not
weaken the rules.

## Adopting in new code

- **Route handlers (app router):** wrap with `withRequestLogging` (existing
  convention). Inside, use `getRequestLogger(request)` for request-bound
  lines and `setRequestLogContext(request, { userId, projectId })` once the
  session/project resolve.
- **Services/jobs/server actions:** wrap the entry point in
  `runWithLogContext({ requestId, … })` (or call it from an already-wrapped
  handler) and use `getContextLogger()` everywhere below. Prefer this over
  passing a `logger` parameter through every function.
- **Non-Next endpoints / webhooks:** use `withHttpLogging`.
- **Tests:** build loggers with `createLogger({ destination })` writing to an
  in-memory array — see `src/lib/logger.test.ts` and
  `src/lib/logging/*.test.ts` for the pattern.

## Checklist for a new log line

- [ ] `event` field present and dotted
- [ ] No secrets or PII in fields or `msg` (credentials auto-redacted; PII via `redactPii`)
- [ ] Correlation ids come from context, not literals
- [ ] Errors passed as `Error` objects, not `String(err)`
- [ ] One line per event — no `console.log` (ESLint/test env may allow it, but it bypasses redaction)
