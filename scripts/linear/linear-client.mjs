// Minimal Linear GraphQL client.
// Usage: import { gql } from "./linear-client.mjs"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")

function readKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY.trim()
  const env = readFileSync(resolve(root, ".env.local"), "utf8")
  const line = env.split(/\r?\n/).find((l) => l.startsWith("LINEAR_API_KEY="))
  if (!line) throw new Error("LINEAR_API_KEY not found")
  return line.slice("LINEAR_API_KEY=".length).trim().replace(/^["']|["']$/g, "")
}

const KEY = readKey()
const ENDPOINT = "https://api.linear.app/graphql"

export async function gql(query, variables = {}, attempt = 0) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`Linear API ${res.status} after retries`)
    const retryAfter = Number(res.headers.get("retry-after") || 0)
    const wait = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt
    await new Promise((r) => setTimeout(r, wait))
    return gql(query, variables, attempt + 1)
  }
  const json = await res.json()
  if (json.errors?.length) {
    const err = new Error(json.errors.map((e) => e.message).join("; "))
    err.errors = json.errors
    throw err
  }
  return json.data
}
