"use client"

import { useEffect, useState } from "react"
import { Facebook, Link2, Linkedin, Mail, MessageCircle, Send, Share2, Twitter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { buildReferralShareUrl } from "@/lib/referral"
import { siteUrl } from "@/lib/site-url"
import {
  buildShareUrl,
  canUseNativeShare,
  SHARE_TARGETS,
  trackShareClick,
  type SharePlatformId,
  type UrlSharePlatform,
} from "@/lib/social-share"

/**
 * Compact social share buttons for the in-app referral screen
 * (`/app/referral`). Mount next to the share-link input — the orchestrator
 * owns placement inside `referral-screen.tsx`.
 *
 * `code` is the caller's `SPN-…` referral code; `shareUrl` may be passed
 * when the caller already built it via `buildReferralShareUrl` (otherwise
 * it is derived here). Share clicks are reported to `POST /api/share/track`
 * through `trackShareClick` — fire-and-forget, never blocks sharing.
 */

const SHARE_TEXT =
  "Spindle gives every research project files, a live lab, local search, and an agent — free to start."
const SHARE_HASHTAGS = ["spindle", "research"] as const

const PLATFORM_ICONS: Record<UrlSharePlatform | "native" | "copy", typeof Twitter> = {
  x: Twitter,
  linkedin: Linkedin,
  facebook: Facebook,
  whatsapp: MessageCircle,
  telegram: Send,
  email: Mail,
  native: Share2,
  copy: Link2,
}

/** Short labels for the compact row (full labels live in SHARE_TARGETS). */
const COMPACT_LABELS: Partial<Record<SharePlatformId, string>> = {
  x: "X",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
}

export interface ReferralShareButtonsProps {
  /** Referral code (`SPN-…`) — used for tracking and default link building. */
  code: string
  /** Prebuilt share URL; derived from `code` + `siteUrl` when omitted. */
  shareUrl?: string
  /** Optional share pitch; defaults to the standard Spindle blurb. */
  text?: string
}

export function ReferralShareButtons({ code, shareUrl, text }: ReferralShareButtonsProps) {
  const [canNative, setCanNative] = useState(false)

  useEffect(() => {
    setCanNative(canUseNativeShare())
  }, [])

  const link = shareUrl ?? buildReferralShareUrl(siteUrl, code)
  const pitch = text ?? SHARE_TEXT

  function hrefFor(platform: UrlSharePlatform): string | undefined {
    try {
      return buildShareUrl(platform, {
        url: link,
        text: pitch,
        subject: "Try Spindle for your research",
        hashtags: SHARE_HASHTAGS,
      })
    } catch {
      return undefined
    }
  }

  async function nativeShare() {
    trackShareClick("native", code)
    try {
      await navigator.share({ title: "Spindle referral", text: pitch, url: link })
    } catch {
      // Dismissed or failed — tracking already recorded the attempt.
    }
  }

  async function copyLink() {
    trackShareClick("copy", code)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // Clipboard denied — the adjacent CopyButton on the screen still works.
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Share your referral link"
    >
      {SHARE_TARGETS.map((target) => {
        if (target.kind === "url") {
          const href = hrefFor(target.id)
          const Icon = PLATFORM_ICONS[target.id]
          const label = COMPACT_LABELS[target.id] ?? target.label
          if (!href) {
            return (
              <Button key={target.id} type="button" variant="outline" size="sm" disabled>
                <Icon aria-hidden="true" />
                {label}
              </Button>
            )
          }
          return (
            <Button key={target.id} asChild variant="outline" size="sm">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={target.label}
                onClick={() => trackShareClick(target.id, code)}
              >
                <Icon aria-hidden="true" />
                {label}
              </a>
            </Button>
          )
        }
        if (target.kind === "native" && canNative) {
          const Icon = PLATFORM_ICONS.native
          return (
            <Button
              key={target.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void nativeShare()}
            >
              <Icon aria-hidden="true" />
              {target.label}
            </Button>
          )
        }
        if (target.kind === "clipboard") {
          const Icon = PLATFORM_ICONS.copy
          return (
            <Button
              key={target.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyLink()}
            >
              <Icon aria-hidden="true" />
              {target.label}
            </Button>
          )
        }
        return null
      })}
    </div>
  )
}
