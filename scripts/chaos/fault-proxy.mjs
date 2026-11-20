#!/usr/bin/env node
// Fault-injection HTTP proxy for Spindle chaos experiments.
//
//   node scripts/chaos/fault-proxy.mjs --target http://localhost:3000 --listen 4300 [options]
//
// Forwards every request to --target, optionally applying a chaos fault to
// requests that match --match. The app (or its upstream clients) is pointed at
// the proxy listen address; the proxy forwards to the real target.
//
// Fault types (all combinable):
//   --latency <ms>        delay every matching request by this many ms
//   --jitter <ms>         add up to this much random delay on top of --latency
//   --error-rate <0-1>    fraction of matching requests answered with --status
//   --status <code>       status used for injected errors (default 503)
//   --timeout-ms <ms>     if set, matching requests that take longer than this
//                         end-to-end are answered with 504 (upstream timeout
//                         simulation — the upstream request is aborted)
//   --match <substr>      only fault requests whose URL contains this string
//                         (default: all requests)
//
// Control endpoint (never forwarded, never faulted):
//   GET  /__chaos__            -> current fault config + counters
//   POST /__chaos__ {json}     -> update fault config live
//   POST /__chaos__/reset      -> clear counters, keep config
//
// Exit codes: 0 clean shutdown (SIGINT/SIGTERM or stdin EOF), 2 usage error.

import http from "node:http"
import https from "node:https"
import { parseArgs } from "node:util"

const USAGE = `Usage: node scripts/chaos/fault-proxy.mjs --target <url> --listen <port> [options]

Options:
  --target <url>        upstream the proxy forwards to (required)
  --listen <port>       port to listen on (required; use 0 for ephemeral)
  --latency <ms>        fixed delay for matching requests (default 0)
  --jitter <ms>         extra random delay 0..jitter ms (default 0)
  --error-rate <0-1>    fraction of matching requests answered with --status
  --status <code>       injected error status (default 503)
  --timeout-ms <ms>     answer 504 when the upstream takes longer than this
  --match <substr>      URL substring filter for faults (default: all)
  --help, -h            show this message

Control: GET|POST /__chaos__ , POST /__chaos__/reset`

const FAULT_KEYS = new Set(["latencyMs", "jitterMs", "errorRate", "status", "timeoutMs", "match"])

export function normalizeFault(input = {}) {
  const fault = {
    latencyMs: Math.max(0, Number(input.latencyMs) || 0),
    jitterMs: Math.max(0, Number(input.jitterMs) || 0),
    errorRate: Math.min(1, Math.max(0, Number(input.errorRate) || 0)),
    status: Math.min(599, Math.max(400, Number(input.status) || 503)),
    timeoutMs: input.timeoutMs == null ? null : Math.max(1, Number(input.timeoutMs) || 0),
    match: input.match == null || input.match === "" ? null : String(input.match),
  }
  return fault
}

function matches(fault, url) {
  if (!fault.match) return true
  return url.includes(fault.match)
}

/**
 * Start a fault-injection proxy.
 *
 * @param {object} opts
 * @param {string} opts.target        upstream base URL (http/https)
 * @param {number} [opts.port]        listen port (0 = ephemeral)
 * @param {object} [opts.fault]       initial fault (see normalizeFault)
 * @param {string} [opts.host]        listen host (default 127.0.0.1)
 * @returns {Promise<{server: http.Server, port: number, url: string,
 *   getFault: () => object, setFault: (f: object) => object,
 *   resetCounters: () => void, counters: () => object, close: () => Promise<void>}>}
 */
export function startFaultProxy(opts) {
  const target = new URL(opts.target)
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`fault proxy only supports http/https targets, got ${target.protocol}`)
  }
  const transport = target.protocol === "https:" ? https : http
  const counters = { total: 0, faulted: 0, injectedErrors: 0, timeouts: 0, forwarded: 0 }
  let fault = normalizeFault(opts.fault || {})

  const server = http.createServer((req, res) => {
    counters.total++
    const url = req.url || "/"

    // Control plane — never forwarded, never faulted.
    if (url === "/__chaos__" || url.startsWith("/__chaos__")) {
      if (req.method === "GET" && url === "/__chaos__") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ fault, counters }))
        return
      }
      if (req.method === "POST" && url === "/__chaos__/reset") {
        for (const k of Object.keys(counters)) counters[k] = 0
        res.writeHead(204)
        res.end()
        return
      }
      if (req.method === "POST" && url === "/__chaos__") {
        let body = ""
        req.on("data", (c) => {
          body += c
          if (body.length > 64 * 1024) req.destroy()
        })
        req.on("end", () => {
          try {
            const patch = body ? JSON.parse(body) : {}
            const next = normalizeFault({ ...fault, ...patch })
            for (const k of Object.keys(next)) {
              if (!FAULT_KEYS.has(k)) {
                res.writeHead(400, { "content-type": "application/json" })
                res.end(JSON.stringify({ error: `unknown fault key: ${k}` }))
                return
              }
            }
            fault = next
            res.writeHead(200, { "content-type": "application/json" })
            res.end(JSON.stringify({ fault, counters }))
          } catch {
            res.writeHead(400, { "content-type": "application/json" })
            res.end(JSON.stringify({ error: "invalid JSON body" }))
          }
        })
        return
      }
      res.writeHead(405)
      res.end()
      return
    }

    const isFaulted = matches(fault, url)
    const injectedError = isFaulted && fault.errorRate > 0 && Math.random() < fault.errorRate
    const delay =
      isFaulted && (fault.latencyMs > 0 || fault.jitterMs > 0)
        ? fault.latencyMs + Math.floor(Math.random() * (fault.jitterMs + 1))
        : 0

    if (isFaulted) counters.faulted++

    const respond = (status, payload) => {
      if (res.headersSent || res.writableEnded) return
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(payload ?? { error: "chaos-injected", status }))
    }

    const forward = () => {
      const upstreamUrl = new URL(url, target)
      const proxyReq = transport.request(
        {
          protocol: upstreamUrl.protocol,
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port || (target.protocol === "https:" ? 443 : 80),
          path: upstreamUrl.pathname + upstreamUrl.search,
          method: req.method,
          headers: { ...req.headers, host: upstreamUrl.host },
          timeout: fault.timeoutMs ?? 0,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        },
      )

      let timedOut = false
      if (fault.timeoutMs) {
        proxyReq.setTimeout(fault.timeoutMs, () => {
          timedOut = true
          counters.timeouts++
          proxyReq.destroy()
          respond(504, { error: "chaos-timeout", timeoutMs: fault.timeoutMs })
        })
      }

      proxyReq.on("error", (err) => {
        if (timedOut || res.headersSent || res.writableEnded) return
        respond(502, { error: "upstream-error", message: err.message })
      })

      req.pipe(proxyReq)
    }

    const run = () => {
      if (injectedError) {
        counters.injectedErrors++
        respond(fault.status)
        return
      }
      counters.forwarded++
      forward()
    }

    if (delay > 0) setTimeout(run, delay)
    else run()
  })

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolvePromise({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        getFault: () => ({ ...fault }),
        setFault: (patch) => {
          fault = normalizeFault({ ...fault, ...patch })
          return { ...fault }
        },
        resetCounters: () => {
          for (const k of Object.keys(counters)) counters[k] = 0
        },
        counters: () => ({ ...counters }),
        close: () =>
          new Promise((res) => {
            server.close(() => res())
            server.closeAllConnections?.()
          }),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cliMain() {
  let values
  try {
    ;({ values } = parseArgs({
      options: {
        target: { type: "string" },
        listen: { type: "string" },
        latency: { type: "string" },
        jitter: { type: "string" },
        "error-rate": { type: "string" },
        status: { type: "string" },
        "timeout-ms": { type: "string" },
        match: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    }))
  } catch (err) {
    console.error(`[fault-proxy] ${err.message}\n\n${USAGE}`)
    process.exit(2)
  }

  if (values.help) {
    console.log(USAGE)
    return
  }
  if (!values.target || !values.listen) {
    console.error("[fault-proxy] --target and --listen are required\n")
    console.error(USAGE)
    process.exit(2)
  }

  const fault = normalizeFault({
    latencyMs: values.latency,
    jitterMs: values.jitter,
    errorRate: values["error-rate"],
    status: values.status,
    timeoutMs: values["timeout-ms"],
    match: values.match,
  })

  startFaultProxy({ target: values.target, port: Number(values.listen), fault })
    .then((proxy) => {
      console.log(
        `[fault-proxy] listening on ${proxy.url} -> ${values.target}` +
          ` fault=${JSON.stringify(proxy.getFault())}`,
      )
      const shutdown = () => {
        proxy.close().then(() => process.exit(0))
      }
      process.on("SIGINT", shutdown)
      process.on("SIGTERM", shutdown)
    })
    .catch((err) => {
      console.error(`[fault-proxy] failed to start: ${err.message}`)
      process.exit(2)
    })
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) cliMain()
