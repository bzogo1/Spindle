#!/usr/bin/env node
import { Buffer } from "node:buffer"
import { createServer } from "node:http"
import { pathToFileURL } from "node:url"

import {
  buildRotationSignatureHeader,
  buildSignatureHeader,
  freshenPayload,
  listFixtures,
  loadFixture,
  parseArgs,
  verifySignatureHeader,
} from "./lib.mjs"

/**
 * Local webhook receiver + inspector + simulator.
 *
 *   node scripts/webhooks/test-tools/serve.mjs --port 4100 --secret whsec_test
 *   node scripts/webhooks/test-tools/serve.mjs --port 4100 --secret whsec_test --demo
 *
 * Endpoints:
 *   POST /<any path>   webhook receiver (verifies signature, records delivery)
 *   GET  /             HTML inspector (deliveries table + send/reset buttons)
 *   GET  /_deliveries  JSON dump of recorded deliveries
 *   POST /_reset       clear deliveries + seen idempotency keys
 *   POST /_send        simulator: {"event":"newsletter.subscribed","secret":"…","mode":"valid"}
 *   GET  /healthz      liveness
 *
 * Secrets come from --secret args only (repo ESLint forbids process.env in
 * scripts). Repeat --secret for rotation testing.
 */

const MAX_BODY = 256 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error("payload_too_large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(raw),
  })
  res.end(raw)
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" })
  res.end(html)
}

const INSPECTOR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Webhook Inspector</title>
<style>
 body{font-family:ui-monospace,monospace;margin:2rem;background:#0d1117;color:#c9d1d9}
 h1{font-size:1.2rem} table{border-collapse:collapse;width:100%;font-size:.8rem}
 td,th{border:1px solid #30363d;padding:.3rem .5rem;text-align:left;vertical-align:top}
 .ok{color:#3fb950}.bad{color:#f85149}.dup{color:#d29922}
 button,select,input{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:.3rem .6rem;font:inherit;cursor:pointer}
 pre{background:#161b22;padding:.6rem;overflow:auto;max-width:60rem}
 .bar{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0;align-items:center}
</style></head><body>
<h1>Webhook Inspector</h1>
<div class="bar">
 <select id="ev"></select>
 <select id="mode">
  <option>valid</option><option>wrong-secret</option><option>stale</option>
  <option>tampered</option><option>malformed</option><option>missing</option><option>rotation</option>
 </select>
 <button onclick="send()">Send event</button>
 <button onclick="reset()">Reset</button>
 <span id="msg"></span>
</div>
<table><thead><tr><th>time</th><th>event</th><th>signature</th><th>result</th><th>idempotency</th><th>payload</th></tr></thead>
<tbody id="rows"></tbody></table>
<pre id="detail"></pre>
<script>
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function load(){
 const r=await fetch('/_deliveries');const {deliveries}=await r.json();
 document.getElementById('rows').innerHTML=deliveries.slice().reverse().map(d=>{
  const p=d.payload||{};const sig=d.signature||{};
  const cls=sig.ok===true?'ok':sig.ok===false?'bad':'';
  const res=sig.ok===true?(d.duplicate?'<span class="dup">duplicate</span>':'accepted'):'<span class="bad">rejected</span>';
  return '<tr onclick="show('+JSON.stringify(d.receivedAt)+')" style="cursor:pointer"><td>'+esc(d.receivedAt)+'</td><td>'+esc(p.type||'?')+'</td><td class="'+cls+'">'+esc(sig.reason||'ok')+'</td><td>'+res+'</td><td>'+esc(d.idempotencyKey||'')+'</td><td>'+esc((d.rawBody||'').slice(0,120))+'</td></tr>';
 }).join('');
}
window.show=async ts=>{const r=await fetch('/_deliveries');const {deliveries}=await r.json();
 const d=deliveries.find(x=>x.receivedAt===ts);document.getElementById('detail').textContent=JSON.stringify(d,null,2)};
async function send(){const ev=document.getElementById('ev').value,mode=document.getElementById('mode').value;
 const r=await fetch('/_send',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({event:ev,mode,secret:new URLSearchParams(location.search).get('secret')||undefined})});
 const j=await r.json();document.getElementById('msg').textContent=j.status+' '+j.body;load()}
async function reset(){await fetch('/_reset',{method:'POST'});load()}
(async()=>{const r=await fetch('/_fixtures');const {fixtures}=await r.json();
 document.getElementById('ev').innerHTML=fixtures.map(f=>'<option>'+f+'</option>').join('');load()})();
</script></body></html>`

export function createInspectorServer({ secrets }) {
  const deliveries = []
  const seenIdempotencyKeys = new Set()

  async function handleWebhook(req, res) {
    let rawBody
    try {
      rawBody = await readBody(req)
    } catch {
      sendJson(res, 413, { error: "payload_too_large" })
      return
    }

    const signatureHeader = req.headers["webhook-signature"]
    const verification = verifySignatureHeader({ rawBody, signatureHeader, secrets })
    const record = {
      receivedAt: new Date().toISOString(),
      remoteAddress: req.socket.remoteAddress,
      method: req.method,
      path: new URL(req.url ?? "/", "http://localhost").pathname,
      headers: req.headers,
      rawBody,
      signature: verification.ok
        ? { ok: true, timestamp: verification.timestamp }
        : { ok: false, reason: verification.reason },
    }

    if (!verification.ok) {
      record.payload = undefined
      deliveries.push(record)
      sendJson(res, 400, { error: "invalid_signature", reason: verification.reason })
      return
    }

    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      record.payload = undefined
      deliveries.push(record)
      sendJson(res, 400, { error: "invalid_json" })
      return
    }
    record.payload = payload
    record.type = payload?.type
    record.id = payload?.id

    const idempotencyKey =
      (typeof req.headers["idempotency-key"] === "string"
        ? req.headers["idempotency-key"]
        : undefined) ?? payload?.idempotencyKey
    record.idempotencyKey = idempotencyKey
    record.duplicate = seenIdempotencyKeys.has(idempotencyKey)
    seenIdempotencyKeys.add(idempotencyKey)

    deliveries.push(record)
    sendJson(res, 200, {
      received: true,
      duplicate: record.duplicate,
      eventId: payload?.id,
      deliveries: deliveries.length,
    })
  }

  /** Sends one event to this server itself — the built-in simulator. */
  async function simulate({ event = "newsletter.subscribed", mode = "valid", secret, repeat = 1 }) {
    const results = []
    for (let i = 0; i < repeat; i += 1) {
      const payload = freshenPayload(loadFixture(event))
      const rawBody = JSON.stringify(payload)
      const now = Math.floor(Date.now() / 1000)
      const staleTs = now - 3600

      let signatureHeader
      let body = rawBody
      switch (mode) {
        case "valid":
          signatureHeader = buildSignatureHeader(secret ?? secrets[0], rawBody)
          break
        case "rotation":
          signatureHeader = buildRotationSignatureHeader(secret ?? secrets[0], rawBody)
          break
        case "wrong-secret":
          signatureHeader = buildSignatureHeader("whsec_definitely_wrong", rawBody)
          break
        case "stale":
          signatureHeader = buildSignatureHeader(secret ?? secrets[0], rawBody, staleTs)
          break
        case "tampered":
          signatureHeader = buildSignatureHeader(secret ?? secrets[0], rawBody)
          body = rawBody.replace(/"consent":\s*true/, '"consent":false')
          if (body === rawBody) body = `${rawBody} `
          break
        case "malformed":
          signatureHeader = "not-a-signature-header"
          break
        case "missing":
          signatureHeader = undefined
          break
        default:
          return { error: `unknown mode "${mode}"` }
      }

      const headers = { "content-type": "application/json" }
      if (signatureHeader !== undefined) headers["webhook-signature"] = signatureHeader
      if (payload.idempotencyKey) headers["idempotency-key"] = payload.idempotencyKey
      if (payload.id) headers["webhook-id"] = payload.id

      const res = await fetch(`http://127.0.0.1:${server.address().port}/demo-target`, {
        method: "POST",
        headers,
        body,
      })
      results.push({ event, mode, status: res.status, body: await res.text() })
    }
    return { results }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    const path = url.pathname

    if (req.method === "GET" && path === "/_deliveries") {
      sendJson(res, 200, { deliveries })
      return
    }
    if (req.method === "GET" && path === "/_fixtures") {
      sendJson(res, 200, { fixtures: listFixtures() })
      return
    }
    if (req.method === "POST" && path === "/_reset") {
      deliveries.length = 0
      seenIdempotencyKeys.clear()
      sendJson(res, 200, { reset: true })
      return
    }
    if (req.method === "GET" && path === "/healthz") {
      sendJson(res, 200, { ok: true })
      return
    }
    if (req.method === "GET" && path === "/") {
      sendHtml(res, 200, INSPECTOR_HTML)
      return
    }
    if (req.method === "POST" && path === "/_send") {
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: "invalid_json" })
        return
      }
      try {
        const out = await simulate(body)
        sendJson(res, out.error ? 400 : 200, out)
      } catch (err) {
        sendJson(res, 500, { error: String(err?.message ?? err) })
      }
      return
    }

    if (req.method === "POST") {
      await handleWebhook(req, res)
      return
    }
    sendJson(res, 405, { error: "method_not_allowed" })
  })

  return { server, deliveries }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = parseArgs(process.argv.slice(2), {
    booleanFlags: ["demo"],
    repeatableFlags: ["secret"],
  })
  const port = Number.parseInt(args.port ?? "4100", 10)
  const secrets = args.secret ?? []
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid --port: ${args.port}`)
    process.exit(1)
  }
  if (secrets.length === 0) {
    console.error("No secrets configured. Pass --secret <value> (repeat for rotation).")
    process.exit(1)
  }

  const { server, deliveries } = createInspectorServer({ secrets })
  server.listen(port, "0.0.0.0", async () => {
    console.log(`[webhook-inspector] listening on http://0.0.0.0:${port}`)
    console.log(`  inspector:  http://localhost:${port}/`)
    console.log(`  deliveries: curl localhost:${port}/_deliveries`)
    console.log(`  secrets:    ${secrets.length} configured`)

    if (args.demo) {
      // Self-test burst: valid events, then the failure modes a receiver must reject.
      const send = async (event, mode) => {
        const payload = freshenPayload(loadFixture(event))
        const rawBody = JSON.stringify(payload)
        const now = Math.floor(Date.now() / 1000)
        const headers = {
          "content-type": "application/json",
          "webhook-id": payload.id,
          "idempotency-key": payload.idempotencyKey,
        }
        if (mode !== "missing") {
          const ts = mode === "stale" ? now - 3600 : now
          const sigSecret = mode === "wrong-secret" ? "whsec_wrong" : secrets[0]
          headers["webhook-signature"] =
            mode === "malformed" ? "garbage" : buildSignatureHeader(sigSecret, rawBody, ts)
        }
        let body = rawBody
        if (mode === "tampered") {
          const mutated = rawBody.replace(/"consent":\s*true/, '"consent":false')
          body = mutated === rawBody ? `${rawBody} ` : mutated
        }
        const r = await fetch(`http://127.0.0.1:${port}/api/webhooks/test`, {
          method: "POST",
          headers,
          body,
        })
        console.log(`  demo ${mode.padEnd(13)} ${event.padEnd(32)} → ${r.status}`)
      }
      await send("contact.form.submitted", "valid")
      await send("newsletter.subscribed", "valid")
      await send("newsletter.subscribed", "valid")
      await send("feedback.submitted", "wrong-secret")
      await send("auth.user.signup.completed", "stale")
      await send("notification.delivered", "tampered")
      await send("newsletter.subscribed", "missing")
      console.log(`  demo done — ${deliveries.length} deliveries recorded, open / to inspect`)
    }
  })
  process.on("SIGINT", () => server.close(() => process.exit(0)))
  process.on("SIGTERM", () => server.close(() => process.exit(0)))
}
