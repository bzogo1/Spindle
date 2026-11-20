"use client"

import { useLanguage } from "@/components/i18n/language-provider"
import { siteName } from "@/lib/seo"
import { cn } from "@/lib/utils"

type AuthBrandProps = {
  className?: string
  /**
   * Overrides the product wordmark — used by workspace-branded sign-in
   * pages. Falls back to {@link siteName} when empty.
   */
  name?: string
  /** Optional workspace logo image URL (http/https, already validated upstream). */
  logoUrl?: string
}

/** Shared Spindle brand mark used by the standalone auth screens. */
export function AuthBrand({ className, name, logoUrl }: AuthBrandProps) {
  const { t } = useLanguage()
  const label = name?.trim() || siteName
  return (
    <a href="/" className={cn("auth-brand", className)} aria-label={t("nav.home")}>
      <span className="auth-brand-mark" aria-hidden="true">
        {logoUrl ? (
          // Admin-supplied branding URL; plain img avoids next/image domain config.
          <img src={logoUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <svg viewBox="0 0 32 32" fill="none">
            <path
              d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="8" cy="22" r="2.2" fill="currentColor" />
          </svg>
        )}
      </span>
      <span className="auth-brand-name">{label}</span>
    </a>
  )
}
