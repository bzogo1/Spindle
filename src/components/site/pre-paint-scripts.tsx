"use client"

import { useSyncExternalStore } from "react"

import { LOCALE_BOOT_SCRIPT } from "@/lib/i18n/locale"
import { SITE_THEME_SCRIPT } from "@/components/site/site-theme"

const subscribe = () => () => {}

const DEFAULT_SCRIPTS = [SITE_THEME_SCRIPT, LOCALE_BOOT_SCRIPT]

/**
 * Pre-paint boot scripts (theme + locale).
 *
 * These must exist in the server-rendered HTML so the browser executes them
 * before first paint. They must NOT be created during client-side rendering:
 * React never executes `<script>` elements mounted on the client and warns
 * "Encountered a script tag while rendering React component" in development.
 *
 * `useSyncExternalStore` returns `true` only for the server render and the
 * hydration pass (via `getServerSnapshot`), so the scripts are present in the
 * SSR HTML and claimed during hydration — but a fresh client-side mount
 * (e.g. navigating into this route group) renders nothing.
 *
 * Defaults to the site theme + locale boot scripts; pass `scripts` to render
 * a different set (rendered in order) for layouts with custom theme logic.
 */
export function PrePaintScripts({ scripts = DEFAULT_SCRIPTS }: { scripts?: readonly string[] }) {
  const isServerRender = useSyncExternalStore(
    subscribe,
    () => false,
    () => true,
  )

  if (!isServerRender) return null

  return (
    <>
      {scripts.map((code, index) => (
        <script key={index} dangerouslySetInnerHTML={{ __html: code }} />
      ))}
    </>
  )
}
