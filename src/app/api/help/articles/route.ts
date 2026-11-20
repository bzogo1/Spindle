import { NextResponse } from "next/server"

import { AUTH_LIMITS, clientIp, createAuthRateLimiter } from "@/lib/auth-endpoint-rate-limit"
import { isHelpCategoryId, listArticles, listCategories, searchArticles } from "@/lib/help-center"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Public read endpoint — hits the lenient `publicRead` preset like the other
 * unauthenticated read routes. Best-effort per-instance limiter; see
 * createRateLimiter for the multi-instance caveat.
 */
const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const MIN_QUERY_LENGTH = 2

function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LIMIT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.min(parsed, MAX_LIMIT)
}

/**
 * GET /api/help/articles — public help-center article list.
 *
 * Query params:
 *  - `q`        — free-text search (title, excerpt, keywords, slug).
 *  - `category` — one of the HELP_CATEGORY_IDS slugs.
 *  - `limit`    — 1..50, default 25.
 *
 * Returns `{ ok, articles, categories }` where articles are summaries only —
 * bodies are served by `/api/help/articles/[slug]` and never leak keywords.
 */
export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return NextResponse.json(
      { ok: false, message: "Too many requests. Try again later." },
      { status: 429 },
    )
  }

  const url = new URL(request.url)
  const rawQuery = url.searchParams.get("q") ?? ""
  const query = rawQuery.trim()
  const rawCategory = url.searchParams.get("category")
  const category = rawCategory && rawCategory !== "" ? rawCategory : undefined
  const limit = parseLimit(url.searchParams.get("limit"))

  if (category !== undefined && !isHelpCategoryId(category)) {
    return NextResponse.json({ ok: false, message: "Unknown help category." }, { status: 400 })
  }

  if (limit === null) {
    return NextResponse.json({ ok: false, message: "Invalid limit." }, { status: 400 })
  }

  // Tiny queries (single characters) match almost everything; treat them as
  // no search so the response stays useful.
  const effectiveQuery = query.length >= MIN_QUERY_LENGTH ? query : ""

  const articles = effectiveQuery
    ? searchArticles(effectiveQuery, { category, limit })
    : listArticles({ category }).slice(0, limit)

  return NextResponse.json({
    ok: true,
    articles,
    categories: listCategories(),
  })
}
