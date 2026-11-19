// Minimal WebSocket echo check used by scripts/hosting/verify-topology.sh.
// Node's built-in WebSocket keeps the probe dependency-free on a fresh host.

const url = process.argv[2]

if (!url) {
  console.error("Usage: node scripts/hosting/ws-probe.mjs <ws-url>")
  process.exit(2)
}

const message = `spindle-probe-${Date.now()}`
const timeout = setTimeout(() => {
  console.error("FAIL: no echoed frame within 10 seconds")
  process.exit(1)
}, 10_000)

const socket = new globalThis.WebSocket(url)

socket.addEventListener("open", () => {
  socket.send(message)
})

socket.addEventListener("message", (event) => {
  const received = typeof event.data === "string" ? event.data : String(event.data)

  if (received.includes(message)) {
    clearTimeout(timeout)
    console.log(`PASS: WebSocket upgrade and echo at ${url}`)
    socket.close()
    process.exit(0)
  }
})

socket.addEventListener("error", () => {
  clearTimeout(timeout)
  console.error(`FAIL: WebSocket error at ${url}`)
  process.exit(1)
})

socket.addEventListener("close", (event) => {
  if (event.code !== 1000) {
    clearTimeout(timeout)
    console.error(`FAIL: socket closed with code ${event.code}`)
    process.exit(1)
  }
})
