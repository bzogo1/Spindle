"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"

import type { CitationItem } from "@/lib/citation-export"
import { relatedArticles } from "@/lib/help-center"
import type { HelpArticleSummary, HelpCategoryWithCount } from "@/lib/help-center"
import { siteUrl } from "@/lib/site-url"

import { CitationExportMenu } from "./citation-export-menu"
import styles from "./help-search.module.css"

type Status = "loading" | "ready" | "error"

const DEBOUNCE_MS = 250
const RESULT_LIMIT = 25

type ApiResponse = {
  ok?: boolean
  articles?: HelpArticleSummary[]
  categories?: HelpCategoryWithCount[]
  message?: string
}

/**
 * Help center search + article browser. Fetches the public
 * `/api/help/articles` endpoint with a debounced `?q=` so typing doesn't fire
 * a request per keystroke; the category `<select>` maps to `?category=`.
 * The server page passes the full article list as `initialArticles` so the
 * first paint already shows every article — this component takes over once
 * hydrated.
 */
export function HelpSearch({
  initialArticles,
  categories,
}: {
  initialArticles: HelpArticleSummary[]
  categories: HelpCategoryWithCount[]
}) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [articles, setArticles] = useState<HelpArticleSummary[]>(initialArticles)
  const [status, setStatus] = useState<Status>("ready")
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const baseId = useId()
  const inputId = `${baseId}-input`
  const statusId = `${baseId}-status`
  const categoryId = `${baseId}-category`
  const relatedTitleId = `${baseId}-related-title`

  const trimmed = query.trim()

  // Current result set as citable items for the export dropdown.
  const citationItems = useMemo<CitationItem[]>(
    () =>
      articles.map((article) => ({
        title: article.title,
        url: `${siteUrl}/help/${article.slug}`,
        excerpt: article.excerpt,
        author: "Spindle",
        publisher: "Spindle",
        date: article.updatedAt,
        type: article.categoryTitle,
      })),
    [articles],
  )

  useEffect(() => {
    const seq = ++requestSeq.current
    const controller = new AbortController()

    const timer = setTimeout(async () => {
      setStatus("loading")
      try {
        const params = new URLSearchParams()
        if (trimmed) params.set("q", trimmed)
        if (category) params.set("category", category)
        params.set("limit", String(RESULT_LIMIT))

        const response = await fetch(`/api/help/articles?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        })
        const data = (await response.json().catch(() => null)) as ApiResponse | null

        // A newer keystroke/category change already superseded this request.
        if (seq !== requestSeq.current) return
        if (response.ok && data?.ok && Array.isArray(data.articles)) {
          setArticles(data.articles)
          setStatus("ready")
        } else {
          setStatus("error")
        }
      } catch {
        if (controller.signal.aborted || seq !== requestSeq.current) return
        setStatus("error")
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, category])

  // The "selected" result is whatever card the pointer or keyboard focus is
  // on; it falls back to the top hit so the related-articles section is always
  // populated while results are visible.
  const selected = useMemo(() => {
    if (articles.length === 0) return undefined
    return articles.find((article) => article.slug === selectedSlug) ?? articles[0]
  }, [articles, selectedSlug])

  const related = useMemo(
    () =>
      status === "ready" && selected
        ? relatedArticles(selected, initialArticles, { limit: 4 })
        : [],
    [status, selected, initialArticles],
  )

  const resultLabel =
    status === "loading"
      ? "Searching…"
      : status === "error"
        ? "Search is unavailable right now."
        : articles.length === 0
          ? `No articles match${trimmed ? ` “${trimmed}”` : ""}.`
          : `${articles.length} ${articles.length === 1 ? "article" : "articles"}${
              trimmed ? ` for “${trimmed}”` : ""
            }`

  return (
    <div role="search">
      <div className={styles.controls}>
        <div className={styles.field}>
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            id={inputId}
            type="search"
            aria-label="Search help articles"
            value={query}
            placeholder="Search help articles…"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={statusId}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="doc-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <svg className="icon icon--xs" aria-hidden="true">
                <use href="#i-close" />
              </svg>
            </button>
          ) : null}
        </div>
        <div>
          <label className={styles.categoryLabel} htmlFor={categoryId}>
            Category
          </label>
          <select
            id={categoryId}
            className={styles.categorySelect}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title} ({entry.count})
              </option>
            ))}
          </select>
        </div>
        <CitationExportMenu items={citationItems} fileName="help-articles" />
      </div>

      <p className={styles.hint} id={statusId} role="status" aria-live="polite">
        {resultLabel}
      </p>

      {status === "error" ? (
        <p className={styles.error} role="alert">
          We couldn&apos;t load help articles. Check your connection and try again.
        </p>
      ) : null}

      {articles.length > 0 ? (
        <div className={styles.results}>
          {articles.map((article) => (
            <a
              key={article.slug}
              className={styles.card}
              href={`/help/${article.slug}`}
              onMouseEnter={() => setSelectedSlug(article.slug)}
              onFocus={() => setSelectedSlug(article.slug)}
            >
              <span className={styles.cardBody}>
                <span className={styles.cardTitle}>{article.title}</span>
                <span className={styles.cardExcerpt}>{article.excerpt}</span>
                <span className={styles.cardMeta}>
                  {article.categoryTitle} · Updated {article.updatedAt}
                </span>
              </span>
              <svg className={`icon ${styles.cardIcon}`} aria-hidden="true">
                <use href="#i-arrow-right" />
              </svg>
            </a>
          ))}
        </div>
      ) : status === "ready" && (trimmed || category) ? (
        <div className={styles.empty} role="status">
          <p>
            No matches
            {trimmed ? (
              <>
                {" "}
                for <strong>{trimmed}</strong>
              </>
            ) : null}
            .
          </p>
          <p>
            Try different keywords, or <a href="/contact">contact support</a> and we&apos;ll point
            you to the right article.
          </p>
        </div>
      ) : null}

      {related.length > 0 && selected ? (
        <section className={styles.related} aria-labelledby={relatedTitleId}>
          <h2 id={relatedTitleId} className={styles.relatedTitle}>
            Related articles
          </h2>
          <p className={styles.relatedFor}>
            Related to <strong>{selected.title}</strong>
          </p>
          <ul className={styles.relatedList}>
            {related.map((article) => (
              <li key={article.slug} className={styles.relatedItem}>
                <a href={`/help/${article.slug}`} className={styles.relatedLink}>
                  {article.title}
                </a>
                <span className={styles.relatedMeta}>{article.categoryTitle}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
