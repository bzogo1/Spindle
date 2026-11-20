#!/usr/bin/env node
/**
 * Minimal dependency-free static file server for `storybook-static/`.
 *
 * Used by `playwright.storybook.visual.config.ts` to serve the built
 * Storybook during visual regression runs — no `serve`/`http-server`
 * dependency required.
 *
 * Usage:
 *   node scripts/serve-static.mjs [directory] [--port <port>]
 *
 * Environment:
 *   STORYBOOK_VISUAL_PORT  port to listen on (default 3200)
 *
 * Defaults to serving `storybook-static/` from the repo root.
 */

import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const args = process.argv.slice(2)
const directoryArg = args.find((arg) => !arg.startsWith("--"))
const portFlagIndex = args.indexOf("--port")
const portFlag = portFlagIndex !== -1 ? Number(args[portFlagIndex + 1]) : undefined

const root = path.resolve(repoRoot, directoryArg ?? "storybook-static")
const port = Number(process.env.STORYBOOK_VISUAL_PORT ?? portFlag ?? 3200)

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
}

function resolveSafePath(urlPath) {
  // Decode once; malformed escapes fall back to the raw path which will 404.
  let decoded = urlPath
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    // keep raw
  }
  // Strip query/hash remnants and normalise.
  const clean = decoded.split(/[?#]/, 1)[0]
  const resolved = path.resolve(root, `.${clean}`)
  // Path traversal guard: the resolved path must stay inside `root`.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null
  }
  return resolved
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost")
    let filePath = resolveSafePath(url.pathname)
    if (!filePath) {
      res.writeHead(403, { "content-type": "text/plain" })
      res.end("Forbidden")
      return
    }

    let fileStat = await stat(filePath).catch(() => null)
    if (fileStat?.isDirectory()) {
      // Directory → index.html (SPA-style fallback not needed; storybook
      // output has real index.html files).
      const indexPath = path.join(filePath, "index.html")
      const indexStat = await stat(indexPath).catch(() => null)
      if (indexStat?.isFile()) {
        filePath = indexPath
        fileStat = indexStat
      } else {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("Not found")
        return
      }
    }

    if (!fileStat?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("Not found")
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const body = await readFile(filePath)
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
      "content-length": body.length,
      // Static build output never changes between runs; allow caching.
      "cache-control": "no-cache",
    })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" })
    res.end(`Server error: ${error instanceof Error ? error.message : String(error)}`)
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://localhost:${port}`)
})
