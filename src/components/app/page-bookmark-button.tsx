"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Bookmark } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

const STORAGE_KEY = "spindle:page-bookmarks"

export interface PageBookmark {
  href: string
  title: string
  createdAt: string
}

function readBookmarks(): PageBookmark[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as PageBookmark[]) : []
  } catch {
    return []
  }
}

function writeBookmarks(bookmarks: PageBookmark[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
  } catch {
    // Storage may be unavailable (private mode); the toggle still works in-memory.
  }
}

/** True when `href` is already bookmarked. Exported for sidebar surfaces. */
export function isBookmarked(href: string): boolean {
  return readBookmarks().some((bookmark) => bookmark.href === href)
}

/** All stored bookmarks, newest first. */
export function listBookmarks(): PageBookmark[] {
  return readBookmarks().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Bookmark toggle for the current page. Persisted to localStorage under
 * `spindle:page-bookmarks`; surfaces read via {@link listBookmarks} (e.g. a
 * sidebar "Saved pages" section when one exists).
 */
export function PageBookmarkButton({ title }: { title: string }) {
  const pathname = usePathname()
  const { toast } = useToast()
  const [bookmarked, setBookmarked] = useState(false)

  useEffect(() => {
    setBookmarked(isBookmarked(pathname))
  }, [pathname])

  const toggle = useCallback(() => {
    const bookmarks = readBookmarks()
    const exists = bookmarks.some((bookmark) => bookmark.href === pathname)
    const next = exists
      ? bookmarks.filter((bookmark) => bookmark.href !== pathname)
      : [
          ...bookmarks,
          { href: pathname, title, createdAt: new Date().toISOString() },
        ]
    writeBookmarks(next)
    setBookmarked(!exists)
    toast({
      variant: "success",
      title: exists ? `Removed “${title}” from bookmarks.` : `Bookmarked “${title}”.`,
    })
  }, [pathname, title, toast])

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "Remove page bookmark" : "Bookmark this page"}
    >
      <Bookmark aria-hidden="true" fill={bookmarked ? "currentColor" : "none"} />
      {bookmarked ? "Bookmarked" : "Bookmark"}
    </Button>
  )
}
