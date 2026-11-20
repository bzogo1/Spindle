"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Keyboard } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { NAV_ITEMS } from "./nav-items"
import { OPEN_NEW_PROJECT_EVENT, OPEN_NEW_PROJECT_STORAGE_KEY } from "./new-project-events"

/** How long a leading "g" stays armed for the follow-up navigation key. */
const GOTO_TIMEOUT_MS = 1000

/**
 * `g <key>` targets, keyed by the second keystroke. Mirrors the sidebar
 * (NAV_ITEMS) so the palette, sidebar, and shortcuts always agree.
 */
const GOTO_TARGETS: Record<string, string> = {
  d: "/dashboard",
  p: "/projects",
  f: "/app/files",
  l: "/app/lab",
  c: "/app/chat",
  a: "/app/agent",
  m: "/app/automations",
  s: "/app/settings",
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  )
}

/**
 * True while a modal surface (command palette, drawer, dialog) owns the
 * keyboard. Shortcuts must not steal keys from open overlays; Escape and
 * overlay-local keys still work because Radix handles them itself.
 */
function hasOpenOverlay() {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <span className="app-shortcuts-keys">
      {keys.map((key) => (
        <kbd key={key} className="app-search-kbd" aria-hidden="true">
          {key}
        </kbd>
      ))}
    </span>
  )
}

/**
 * App-wide keyboard shortcuts for navigation, mounted once in the app shell:
 *
 * - `g` then a key jumps to a section (`g d` dashboard, `g p` projects, …)
 * - `n` opens the "New project" flow via the same event the command menu uses
 * - `?` toggles a help overlay listing every shortcut
 *
 * Shortcuts never fire while typing in form fields or while a modal overlay
 * (command palette, drawer, dialog) is open.
 */
export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const [helpOpen, setHelpOpen] = useState(false)
  /** Timestamp of the last bare "g"; expires after GOTO_TIMEOUT_MS. */
  const gotoArmedAt = useRef(0)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Modified chords belong to the browser / other handlers (⌘K etc.).
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      const key = event.key.toLowerCase()

      // "?" toggles the help overlay even while it is open; every other
      // shortcut is suppressed while any modal owns the keyboard.
      if (key === "?") {
        setHelpOpen((open) => !open)
        event.preventDefault()
        return
      }
      if (hasOpenOverlay()) return

      // `g <key>` navigation. A second "g" re-arms the sequence.
      const gotoArmed = Date.now() - gotoArmedAt.current < GOTO_TIMEOUT_MS
      if (key === "g" && !gotoArmed) {
        gotoArmedAt.current = Date.now()
        event.preventDefault()
        return
      }
      if (gotoArmed) {
        gotoArmedAt.current = 0
        const href = GOTO_TARGETS[key]
        if (href) {
          event.preventDefault()
          if (pathname !== href) router.push(href)
          return
        }
        // Unknown follow-up key: fall through so "n"/other keys still work.
      }

      if (key === "n") {
        event.preventDefault()
        // Same cross-component signal the command menu's "New project" action
        // uses: storage flag survives navigation, the event covers an
        // already-mounted dashboard.
        try {
          sessionStorage.setItem(OPEN_NEW_PROJECT_STORAGE_KEY, "1")
        } catch {
          // Private mode: the in-page event below still covers this case.
        }
        window.dispatchEvent(new Event(OPEN_NEW_PROJECT_EVENT))
        if (pathname !== "/dashboard") router.push("/dashboard")
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [pathname, router])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="app-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle className="app-shortcuts-title">
            <Keyboard aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>Navigate the app without reaching for the mouse.</DialogDescription>
        </DialogHeader>

        <section className="app-shortcuts-section" aria-labelledby="shortcuts-goto">
          <h3 id="shortcuts-goto">Go to</h3>
          <ul className="app-shortcuts-list">
            {NAV_ITEMS.map((item) => {
              const key = Object.keys(GOTO_TARGETS).find(
                (candidate) => GOTO_TARGETS[candidate] === item.href,
              )
              if (!key) return null
              return (
                <li key={item.href} className="app-shortcuts-row">
                  <span>{item.label}</span>
                  <ShortcutKeys keys={["g", key]} />
                </li>
              )
            })}
          </ul>
        </section>

        <section className="app-shortcuts-section" aria-labelledby="shortcuts-actions">
          <h3 id="shortcuts-actions">Actions</h3>
          <ul className="app-shortcuts-list">
            <li className="app-shortcuts-row">
              <span>New project</span>
              <ShortcutKeys keys={["n"]} />
            </li>
            <li className="app-shortcuts-row">
              <span>Command menu</span>
              <ShortcutKeys keys={["⌘", "K"]} />
            </li>
            <li className="app-shortcuts-row">
              <span>This help</span>
              <ShortcutKeys keys={["?"]} />
            </li>
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  )
}
