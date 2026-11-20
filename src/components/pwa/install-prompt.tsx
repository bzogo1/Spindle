"use client"

import { useEffect, useRef, useState } from "react"

import { clientEnv } from "@/lib/env"

/**
 * PWA install prompt.
 *
 * Three paths, in priority order:
 *
 * 1. `beforeinstallprompt` (Chromium/Edge/Android): we capture the deferred
 *    event, show a dismissible banner, and hand it to the browser's native
 *    install dialog on confirm.
 * 2. iOS Safari: that event never fires, so after a short grace period we
 *    detect iOS + Safari + not-standalone and show manual instructions
 *    (Share → Add to Home Screen).
 * 3. `appinstalled`: any successful install flips us to a brief welcome
 *    toast and permanently suppresses the install UI (localStorage flag +
 *    standalone display-mode check cover browsers that never fire the event).
 *
 * Dismissal is remembered in localStorage for seven days so the banner does
 * not nag on every visit.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const DISMISS_KEY = "spindle-pwa-install-dismissed-at"
const INSTALLED_KEY = "spindle-pwa-installed"
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000
/** How long to wait for beforeinstallprompt before trying the iOS path. */
const IOS_FALLBACK_DELAY_MS = 1500
/** How long the post-install welcome toast stays visible. */
const WELCOME_MS = 8000

type InstallMode = "hidden" | "native" | "ios-instructions" | "welcome"

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode) — degrade to session-only behaviour.
  }
}

function wasRecentlyDismissed(): boolean {
  const raw = readStorage(DISMISS_KEY)
  if (!raw) return false
  const at = Number(raw)
  return Number.isFinite(at) && Date.now() - at < DISMISS_MS
}

function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false
  // iOS Safari exposes navigator.standalone; the media query covers the rest.
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches === true
  } catch {
    return false
  }
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  // iPhone/iPod, plus iPadOS 13+ which reports as Macintosh.
  const iosDevice =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (!iosDevice) return false
  // Other iOS browsers (Chrome, Firefox, Edge) ship their own engines but
  // still can't fire beforeinstallprompt — however their UAs contain CriOS /
  // FxiOS / EdgiOS markers, and only stock Safari gets the reliable
  // Share → Add to Home Screen flow.
  if (/crios|fxios|edgios|opios/i.test(ua)) return false
  return /safari/i.test(ua)
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<InstallMode>("hidden")
  const iosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Production only, same rule as the service worker registration.
    if (clientEnv.NODE_ENV !== "production") return
    if (typeof window === "undefined") return

    // Already installed (flag from a previous appinstalled, or running in
    // standalone display-mode): never show install UI again.
    if (readStorage(INSTALLED_KEY) === "1" || isRunningStandalone()) {
      setMode("hidden")
      return
    }

    const clearIosTimer = () => {
      if (iosTimerRef.current !== null) {
        clearTimeout(iosTimerRef.current)
        iosTimerRef.current = null
      }
    }

    const onBeforeInstall = (event: Event) => {
      // Keep the browser from showing its own mini-infobar.
      event.preventDefault()
      clearIosTimer()
      // A recent dismissal snoozes the banner even if the browser re-fires
      // beforeinstallprompt on a later visit.
      if (wasRecentlyDismissed()) return
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      setMode("native")
    }

    const onInstalled = () => {
      clearIosTimer()
      setDeferredPrompt(null)
      writeStorage(INSTALLED_KEY, "1")
      setMode("welcome")
      welcomeTimerRef.current = setTimeout(() => setMode("hidden"), WELCOME_MS)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)

    // iOS Safari never fires beforeinstallprompt — if nothing arrived within
    // the grace period and this is an iPhone/iPad Safari session, offer the
    // manual instructions instead.
    iosTimerRef.current = setTimeout(() => {
      iosTimerRef.current = null
      setMode((current) => {
        if (current !== "hidden" || wasRecentlyDismissed() || !isIosSafari()) {
          return current
        }
        return "ios-instructions"
      })
    }, IOS_FALLBACK_DELAY_MS)

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
      clearIosTimer()
      if (welcomeTimerRef.current !== null) {
        clearTimeout(welcomeTimerRef.current)
        welcomeTimerRef.current = null
      }
    }
  }, [])

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Storage unavailable (private mode) — dismiss for this session only.
    }
    setMode("hidden")
  }

  const install = async () => {
    const prompt = deferredPrompt
    setDeferredPrompt(null)
    setMode("hidden")
    try {
      await prompt?.prompt()
      await prompt?.userChoice
      // Accepted installs fire `appinstalled` → welcome state. A dismissal
      // inside the native dialog stays hidden until the next prompt event.
    } catch {
      // Prompt can only be consumed once; ignore races.
    }
  }

  if (mode === "welcome") {
    return (
      <div
        role="status"
        className="border-border bg-card text-card-foreground fixed right-4 bottom-4 left-4 z-50 flex w-auto max-w-sm items-center justify-between gap-3 rounded-lg border p-4 text-sm shadow-lg sm:right-4 sm:left-auto"
      >
        <div>
          <p className="font-medium">Welcome to Spindle</p>
          <p className="text-muted-foreground mt-1">
            Spindle is installed — find it on your home screen anytime.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMode("hidden")}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded-md px-3 py-1.5 text-xs"
        >
          Got it
        </button>
      </div>
    )
  }

  if (mode === "native" && deferredPrompt) {
    return (
      <div
        role="dialog"
        aria-label="Install Spindle"
        className="border-border bg-card text-card-foreground fixed right-4 bottom-4 left-4 z-50 flex w-auto max-w-sm flex-col gap-3 rounded-lg border p-4 text-sm shadow-lg sm:right-4 sm:left-auto"
      >
        <div>
          <p className="font-medium">Install Spindle</p>
          <p className="text-muted-foreground mt-1">
            Add Spindle to your home screen for faster access, even offline.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-xs"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={install}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium"
          >
            Install
          </button>
        </div>
      </div>
    )
  }

  if (mode === "ios-instructions") {
    return (
      <div
        role="dialog"
        aria-label="Install Spindle"
        className="border-border bg-card text-card-foreground fixed right-4 bottom-4 left-4 z-50 flex w-auto max-w-sm flex-col gap-3 rounded-lg border p-4 text-sm shadow-lg sm:right-4 sm:left-auto"
      >
        <div>
          <p className="font-medium">Install Spindle</p>
          <p className="text-muted-foreground mt-1">
            To add Spindle to your Home Screen: tap the{" "}
            <span aria-label="Share icon" className="inline-block align-middle">
              Share
            </span>{" "}
            button in Safari, then choose{" "}
            <span className="text-foreground font-medium">Add to Home Screen</span>.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-xs"
          >
            Not now
          </button>
        </div>
      </div>
    )
  }

  return null
}
