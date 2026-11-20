"use client"

import { useEffect, useRef, useState } from "react"

import { REFERRAL_OWN_CODE_KEY } from "@/lib/referral"
import {
  buildShareUrl,
  canUseNativeShare,
  SHARE_TARGETS,
  trackShareClick,
  type SharePlatformId,
  type ShareTarget,
  type UrlSharePlatform,
} from "@/lib/social-share"

/**
 * Referral share panel.
 *
 * TODO(referral-attribution): the share URL is still built client-side from a
 * per-browser code generated once and persisted in localStorage — the API has
 * no referral endpoints for the *visitor's own* code yet (account codes live
 * behind `/api/referral/program` for signed-in users). `/r/<code>` stores the
 * code via `storeReferralCode`; share clicks are reported to
 * `POST /api/share/track` (bounded in-memory counters, see
 * `src/lib/share-tracking.ts`). When the backend lands, replace
 * `getOrCreateCode` with the account's referral code.
 */

const CODE_STORAGE_KEY = REFERRAL_OWN_CODE_KEY

type CopyStatus = "idle" | "copied" | "error"

const RESET_DELAY = 2000

const SHARE_TEXT =
  "Spindle gives every research project files, a live lab, local search, and an agent — free to start."
const SHARE_SUBJECT = "Try Spindle for your research"
const SHARE_HASHTAGS = ["spindle", "research"] as const

/** Sprite icon per share target — the sprite has no brand glyphs for most. */
const TARGET_ICONS: Record<UrlSharePlatform | "native", string> = {
  x: "#i-x-social",
  linkedin: "#i-arrow-up-right",
  facebook: "#i-users",
  whatsapp: "#i-message",
  telegram: "#i-send",
  email: "#i-pen",
  native: "#i-globe",
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
  return `SPN-${raw.slice(0, 4)}-${raw.slice(4)}`
}

function getOrCreateCode() {
  try {
    const existing = window.localStorage.getItem(CODE_STORAGE_KEY)
    if (existing) return existing
    const code = generateCode()
    window.localStorage.setItem(CODE_STORAGE_KEY, code)
    return code
  } catch {
    // Private mode / storage disabled — fall back to a session-only code.
    return generateCode()
  }
}

function legacyCopy(text: string) {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)

  try {
    textarea.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export function ReferralShare({ siteUrl }: { siteUrl: string }) {
  const [link, setLink] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [canNative, setCanNative] = useState(false)
  const [status, setStatus] = useState<CopyStatus>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const ownCode = getOrCreateCode()
    setCode(ownCode)
    setLink(`${siteUrl}/r/${encodeURIComponent(ownCode)}`)
    setCanNative(canUseNativeShare())
  }, [siteUrl])

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  async function copyLink() {
    if (!link) return
    trackShareClick("copy", code)

    let copied = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link)
        copied = true
      } catch {
        copied = false
      }
    }
    if (!copied) copied = legacyCopy(link)

    setStatus(copied ? "copied" : "error")
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setStatus("idle"), RESET_DELAY)
  }

  /** Share-intent href for a url platform; undefined while the link is unset. */
  function shareHref(platform: UrlSharePlatform): string | undefined {
    if (!link) return undefined
    try {
      return buildShareUrl(platform, {
        url: link,
        text: SHARE_TEXT,
        subject: SHARE_SUBJECT,
        hashtags: SHARE_HASHTAGS,
      })
    } catch {
      // siteUrl should always be https; degrade to a disabled button.
      return undefined
    }
  }

  function handleTargetClick(platform: SharePlatformId) {
    trackShareClick(platform, code)
  }

  async function nativeShare() {
    if (!link || !canNative) return
    trackShareClick("native", code)
    try {
      await navigator.share({ title: "Spindle referral", text: SHARE_TEXT, url: link })
    } catch {
      // User dismissed the sheet or share failed — nothing to report.
    }
  }

  const urlTargets = SHARE_TARGETS.filter(
    (target): target is Extract<ShareTarget, { kind: "url" }> => target.kind === "url",
  )

  return (
    <div className="referral-share" data-reveal>
      <div className="share-link-row">
        <input
          type="text"
          readOnly
          value={link ?? ""}
          placeholder="Your referral link"
          aria-label="Your referral link"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void copyLink()}
          disabled={!link}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href={status === "copied" ? "#i-check" : "#i-copy"} />
          </svg>
          {status === "copied" ? "Copied" : status === "error" ? "Copy failed" : "Copy link"}
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "copied"
          ? "Referral link copied to clipboard."
          : status === "error"
            ? "Copy failed. Select the link text and copy it manually."
            : ""}
      </span>
      <div className="share-targets">
        {urlTargets.map((target) => {
          const href = shareHref(target.id)
          return (
            <a
              key={target.id}
              className="share-btn"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!href}
              tabIndex={href ? undefined : -1}
              onClick={(event) => {
                if (!href) {
                  event.preventDefault()
                  return
                }
                handleTargetClick(target.id)
              }}
            >
              <svg className="icon icon--xs" aria-hidden="true">
                <use href={TARGET_ICONS[target.id]} />
              </svg>
              {target.label}
            </a>
          )
        })}
        {canNative && (
          <button
            type="button"
            className="share-btn"
            onClick={() => void nativeShare()}
            disabled={!link}
          >
            <svg className="icon icon--xs" aria-hidden="true">
              <use href={TARGET_ICONS.native} />
            </svg>
            {SHARE_TARGETS.find((t) => t.id === "native")?.label}
          </button>
        )}
      </div>
      <p className="share-note">
        Your link is tied to this browser for now — referral codes move into your account when
        attribution ships. Read the <a href="/terms">terms</a> and{" "}
        <a href="/acceptable-use">acceptable use</a> rules before you start sharing.
      </p>
    </div>
  )
}
