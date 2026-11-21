"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpen, History, LogIn, Search, UserPlus } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import {
  createActionsProvider,
  createChangelogProvider,
  createDocsProvider,
  createPagesProvider,
  type SearchActionSpec,
} from "@/lib/search/providers"
import { useLanguage } from "@/components/i18n/language-provider"
import { recentIds, recordUse } from "@/lib/search/recency"
import { useSearchIndex } from "@/lib/search/use-search-index"
import type { SearchItem } from "@/lib/search"
import { SITE_PAGES, SITE_SEARCH_OPEN_EVENT } from "@/lib/site-search"

import styles from "./site-command-menu.module.css"

const MAX_RECENTS = 5

const GROUP_ORDER = ["Pages", "Docs", "Changelog", "Actions"] as const

/**
 * Event that opens the palette from outside the component — the mobile nav
 * "Search" entry dispatches it so there is still only one command menu.
 * Re-exported from `@/lib/site-search`, the single source of truth, so
 * dispatchers do not have to import this lazily-loaded module.
 */
export { SITE_SEARCH_OPEN_EVENT }

type CommandGroup = { label: string; items: SearchItem[] }

/** Search-index group labels stay English internally; these map them to i18n keys. */
const GROUP_LABEL_KEYS: Record<string, string> = {
  Pages: "search.group.pages",
  Docs: "nav.docs",
  Changelog: "nav.changelog",
  Actions: "search.group.actions",
  Recent: "search.group.recent",
}

/**
 * Site ⌘K/Ctrl+K command menu: searches marketing pages, docs guides, and
 * changelog releases through the shared pluggable search index, plus a few
 * shortcuts to the sign-in and sign-up pages.
 */
export function SiteCommandMenu() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoveredOccurrence, setHoveredOccurrence] = useState<string | null>(null)
  const [recentsTick, setRecentsTick] = useState(0)
  const { t } = useLanguage()
  const router = useRouter()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (open) setRecentsTick((tick) => tick + 1)
  }, [open])

  useEffect(() => {
    function onOpenRequest() {
      setQuery("")
      setActiveId(null)
      setOpen(true)
    }
    window.addEventListener(SITE_SEARCH_OPEN_EVENT, onOpenRequest)
    return () => window.removeEventListener(SITE_SEARCH_OPEN_EVENT, onOpenRequest)
  }, [])

  const actionSpecs = useMemo<SearchActionSpec[]>(
    () => [
      {
        id: "action:sign-in",
        title: t("auth.signIn"),
        subtitle: t("search.action"),
        keywords: "login account",
        icon: <LogIn aria-hidden="true" />,
        action: "sign-in",
        href: "/sign-in",
      },
      {
        id: "action:create-workspace",
        title: t("auth.createWorkspace"),
        subtitle: t("search.action"),
        keywords: "sign up register",
        icon: <UserPlus aria-hidden="true" />,
        action: "create-workspace",
        href: "/sign-up",
      },
    ],
    [t],
  )

  const providers = useMemo(
    () => [
      createPagesProvider(SITE_PAGES),
      createDocsProvider(),
      createChangelogProvider(),
      createActionsProvider(actionSpecs),
    ],
    [actionSpecs],
  )

  const { results, debouncedQuery, loading, searchNow } = useSearchIndex({
    providers,
    query,
    enabled: open,
  })

  const groups = useMemo<CommandGroup[]>(() => {
    const q = debouncedQuery.trim()
    const result: CommandGroup[] = []

    if (!q) {
      const byId = new Map(results.map((hit) => [hit.item.id, hit.item]))
      const recentItems = recentIds(MAX_RECENTS)
        .map((id) => byId.get(id))
        .filter((item): item is SearchItem => item !== undefined)
      if (recentItems.length > 0) result.push({ label: "Recent", items: recentItems })
    }

    for (const label of GROUP_ORDER) {
      const items = results.filter((hit) => hit.item.group === label).map((hit) => hit.item)
      if (items.length > 0) result.push({ label, items })
    }
    return result
    // recentsTick re-derives the Recent group after recordUse().
  }, [results, debouncedQuery, recentsTick])

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

  // With an empty query the Recent group duplicates items from Pages/etc., so
  // an id-based active highlight would mark the same item twice. Only show the
  // selection highlight while searching; otherwise hover alone highlights.
  const showActiveHighlight = debouncedQuery.trim() !== ""

  const activeOptionId = useMemo(() => {
    if (!activeId) return undefined
    for (const group of groups) {
      if (group.items.some((item) => item.id === activeId)) {
        return `site-command-option-${group.label}:${activeId}`
      }
    }
    return undefined
  }, [groups, activeId])

  useEffect(() => {
    setActiveId((current) =>
      current && flatItems.some((item) => item.id === current)
        ? current
        : (flatItems[0]?.id ?? null),
    )
  }, [flatItems])

  useEffect(() => {
    if (!activeId || !listRef.current) return
    const element = listRef.current.querySelector(`[data-command-id="${CSS.escape(activeId)}"]`)
    element?.scrollIntoView?.({ block: "nearest" })
  }, [activeId])

  function moveActive(direction: 1 | -1) {
    if (flatItems.length === 0) return
    const index = flatItems.findIndex((item) => item.id === activeId)
    const nextIndex =
      index === -1
        ? direction === 1
          ? 0
          : flatItems.length - 1
        : (index + direction + flatItems.length) % flatItems.length
    setActiveId(flatItems[nextIndex]?.id ?? null)
  }

  function runItem(item: SearchItem) {
    if (item.href) {
      router.push(item.href)
    }
  }

  function activateItem(item: SearchItem | undefined) {
    if (!item) return
    recordUse(item.id)
    setRecentsTick((tick) => tick + 1)
    setOpen(false)
    runItem(item)
  }

  function activateActive() {
    const hits = query.trim() === debouncedQuery.trim() ? results : searchNow(query)
    const items = hits.map((hit) => hit.item)
    activateItem(items.find((item) => item.id === activeId) ?? items[0])
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      activateActive()
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery("")
      setActiveId(null)
    }
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => handleOpenChange(true)}>
        <Search aria-hidden="true" className={styles.triggerIcon} />
        <span className={styles.triggerLabel}>{t("common.search")}</span>
        <kbd className={styles.kbd} aria-hidden="true">
          ⌘K
        </kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={styles.overlay} />
          <DialogPrimitive.Content className={styles.dialog} aria-modal="true">
            <DialogPrimitive.Title className={styles.srOnly}>
              {t("search.title")}
            </DialogPrimitive.Title>
            <div className={styles.inputRow}>
              <Search aria-hidden="true" className={styles.inputIcon} />
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls="site-command-list"
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={t("search.placeholder")}
                aria-label={t("nav.searchSite")}
                className={styles.input}
              />
              <kbd className={styles.kbd} aria-hidden="true">
                esc
              </kbd>
            </div>
            <div className={styles.list} role="listbox" id="site-command-list" ref={listRef}>
              {flatItems.length === 0 ? (
                loading ? (
                  <p className={styles.empty} role="status">
                    {t("common.loading")}
                  </p>
                ) : (
                  <p className={styles.empty}>{t("search.noResults", { query: query.trim() })}</p>
                )
              ) : (
                groups.map((group) => (
                  <div
                    key={group.label}
                    className={styles.group}
                    role="group"
                    aria-label={t(GROUP_LABEL_KEYS[group.label] ?? group.label)}
                  >
                    <div className={styles.groupLabel}>
                      {t(GROUP_LABEL_KEYS[group.label] ?? group.label)}
                    </div>
                    {group.items.map((item) => {
                      const occurrenceId = `${group.label}:${item.id}`
                      const isActive = hoveredOccurrence
                        ? hoveredOccurrence === occurrenceId
                        : showActiveHighlight && item.id === activeId
                      return (
                      <div
                        key={occurrenceId}
                        id={`site-command-option-${occurrenceId}`}
                        role="option"
                        aria-selected={isActive}
                        data-command-id={item.id}
                        className={`${styles.item}${isActive ? ` ${styles.itemActive}` : ""}`}
                        onMouseEnter={() => setHoveredOccurrence(occurrenceId)}
                        onMouseLeave={() => setHoveredOccurrence(null)}
                        onMouseMove={() => setActiveId(item.id)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => activateItem(item)}
                      >
                        <span className={styles.itemIcon} aria-hidden="true">
                          {item.icon ??
                            (item.group === "Docs" ? (
                              <BookOpen aria-hidden="true" />
                            ) : item.group === "Changelog" ? (
                              <History aria-hidden="true" />
                            ) : null)}
                        </span>
                        <span className={styles.itemText}>
                          <span className={styles.itemLabel}>{item.title}</span>
                          {item.subtitle ? (
                            <span className={styles.itemHint}>{item.subtitle}</span>
                          ) : null}
                        </span>
                      </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <div className={styles.footer}>
              <span>
                <kbd className={styles.kbd} aria-hidden="true">
                  ↑↓
                </kbd>{" "}
                {t("common.navigate")}
              </span>
              <span>
                <kbd className={styles.kbd} aria-hidden="true">
                  ↵
                </kbd>{" "}
                {t("common.select")}
              </span>
              <span>
                <kbd className={styles.kbd} aria-hidden="true">
                  esc
                </kbd>{" "}
                {t("common.close")}
              </span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
