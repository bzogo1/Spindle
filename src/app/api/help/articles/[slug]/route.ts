import { NextResponse } from "next/server"

import { AUTH_LIMITS, clientIp, createAuthRateLimiter } from "@/lib/auth-endpoint-rate-limit"
import { getArticleBySlug, listCategories } from "@/lib/help-center"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Same publicRead budget as the article list endpoint. */
const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

type RouteContext = { params: Promise<{ slug: string }> }

/**
 * GET /api/help/articles/[slug] — one article including its structured body.
 * Returns 404 for unknown slugs; the body is block data, never raw HTML.
 */
export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) {
    return NextResponse.json(
      { ok: false, message: "Too many requests. Try again later." },
      { status: 429 },
    )
  }

  const { slug } = await context.params
  const article = getArticleBySlug(slug)
  if (!article) {
    return NextResponse.json({ ok: false, message: "Help article not found." }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    article,
    categories: listCategories(),
  })
}
