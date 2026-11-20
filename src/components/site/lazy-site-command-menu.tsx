"use client"

import dynamic from "next/dynamic"
import { Search } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"

import styles from "./site-command-menu.module.css"

function CommandMenuLoading() {
  const { t } = useLanguage()
  return (
    <button type="button" className={styles.trigger}>
      <Search aria-hidden="true" className={styles.triggerIcon} />
      <span className={styles.triggerLabel}>{t("common.search")}</span>
      <kbd className={styles.kbd} aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  )
}

/**
 * Lazy boundary for the site ⌘K palette. SiteHeader is a Client Component now,
 * but the `ssr: false` dynamic import still has to live in this wrapper so the
 * palette, search providers, and Radix dialog load as a separate chunk after
 * hydration instead of inflating every marketing page's initial bundle. The
 * loading fallback renders the same trigger button so the header does not
 * shift while the chunk arrives.
 */
const SiteCommandMenuImpl = dynamic(
  () => import("./site-command-menu").then((mod) => mod.SiteCommandMenu),
  {
    ssr: false,
    loading: () => <CommandMenuLoading />,
  },
)

export function SiteCommandMenu() {
  return <SiteCommandMenuImpl />
}
