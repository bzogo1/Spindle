import { AsyncLocalStorage } from "node:async_hooks"
import type { Logger } from "pino"

import { logger as defaultLogger } from "../logger"

/**
 * Request-scoped log context via AsyncLocalStorage.
 *
 * `withRequestLogging` (src/lib/request-logging.ts) binds a child pino logger
 * to the `Request` object, which works for route handlers but does not reach
 * deeper calls (services, jobs, server components) unless the `Request` is
 * threaded through. This module stores the same correlation fields in an
 * AsyncLocalStorage slot instead, so `getContextLogger()` works anywhere
 * inside `runWithLogContext` — including `await` continuations — without
 * changing function signatures.
 *
 * Compatibility notes for Next.js:
 * - Works in the Node.js runtime (route handlers, server actions, server
 *   components rendered on the server). AsyncLocalStorage context survives
 *   `await` but does not cross into the Edge runtime or client components.
 * - Enter the context as early as possible (route handler wrapper, server
 *   action, or `instrumentation` hook) so every downstream log line carries
 *   the ids.
 */

export type LogContextFields = {
  /** Correlates all log lines for one inbound request. */
  requestId?: string | null
  /** Optional upstream trace id (e.g. from a tracing header or Sentry). */
  traceId?: string | null
  userId?: string | null
  projectId?: string | null
  /** Domain-specific fields merged into every log line in this scope. */
  [key: string]: unknown
}

const storage = new AsyncLocalStorage<LogContextFields>()

/** The active log context, or `undefined` outside `runWithLogContext`. */
export function getLogContext(): LogContextFields | undefined {
  return storage.getStore()
}

/** Runs `fn` with `fields` as the active log context. Returns `fn`'s result. */
export function runWithLogContext<T>(fields: LogContextFields, fn: () => T): T {
  const parent = storage.getStore()
  return storage.run({ ...parent, ...fields }, fn)
}

/**
 * Like `runWithLogContext`, but runs `fn` with the exact `store` object. Use
 * when the caller needs a live reference: `extendLogContext` mutates the
 * store in place, so mutations are visible through `store` even after `fn`
 * has returned and the ALS scope has exited.
 */
export function runWithLogContextStore<T>(store: LogContextFields, fn: () => T): T {
  return storage.run(store, fn)
}

/**
 * Wraps an async function so it executes inside a log context. Fields already
 * present in an enclosing context are preserved unless overridden.
 */
export function withLogContext<A extends unknown[]>(
  fields: LogContextFields,
  fn: (...args: A) => unknown,
) {
  return (...args: A) => runWithLogContext(fields, () => fn(...args))
}

/**
 * Merges fields into the active context for the remainder of the current
 * async scope. Mutates the store object in place so wrappers holding a
 * reference to the context (e.g. `withHttpLogging`'s summary line) observe
 * the update even after the ALS scope has exited. No-op outside a context.
 */
export function extendLogContext(fields: LogContextFields): LogContextFields {
  const current = storage.getStore()
  if (!current) return fields
  Object.assign(current, fields)
  return current
}

/** Context fields reduced to the entries safe to bind onto a logger. */
export function contextFields(): Record<string, unknown> {
  return contextFieldsFrom(storage.getStore())
}

/** Same reduction as `contextFields`, for an explicit context object. */
export function contextFieldsFrom(context: LogContextFields | undefined): Record<string, unknown> {
  if (!context) return {}

  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null) fields[key] = value
  }
  return fields
}

/**
 * A pino logger bound to the active context. Inside `runWithLogContext` every
 * line carries the context fields; outside it behaves like `base`.
 *
 * Pass the request-scoped logger (`getRequestLogger(request)`) as `base`
 * when one exists so request id and domain bindings combine.
 */
export function getContextLogger(base: Logger = defaultLogger): Logger {
  const fields = contextFields()
  return Object.keys(fields).length > 0 ? base.child(fields) : base
}
