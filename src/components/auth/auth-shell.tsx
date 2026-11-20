"use client"

import type { ReactNode } from "react"

import { useLanguage } from "@/components/i18n/language-provider"

import { AuthBrand } from "./auth-brand"

/** Centered account screen: brand mark, form card, and small print only. */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <main id="main-content" tabIndex={-1} className="auth-main">
      <div className="auth-shell">
        <AuthBrand />

        <section className="auth-card">{children}</section>

        {footer ? <div className="auth-card-foot">{footer}</div> : null}

        <p className="auth-legal">
          <a href="/privacy">{t("footer.privacy")}</a>
          <span aria-hidden="true">·</span>
          <a href="/terms">{t("auth.shell.terms")}</a>
          <span aria-hidden="true">·</span>
          <a href="/about#contact">{t("auth.contactSupport")}</a>
        </p>
      </div>
    </main>
  )
}
