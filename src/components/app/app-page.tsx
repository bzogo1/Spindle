"use client"

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { helpTopicsFor, pageMetaFor } from "@/components/app/page-meta"
import { PageActionsMenu } from "@/components/app/page-actions-menu"
import { PageBookmarkButton } from "@/components/app/page-bookmark-button"
import { PageFeedbackButton, PageFeedbackDialog } from "@/components/app/page-feedback-dialog"
import { PageHelpButton, PageHelpDialog } from "@/components/app/page-help-dialog"
import { PageHistoryButton, PageHistoryDialog } from "@/components/app/page-history-dialog"
import { PageSettingsButton, PageSettingsDialog } from "@/components/app/page-settings-dialog"

/**
 * Shared scaffold for the app screens. The header chrome — breadcrumbs, title,
 * lede, and the page action toolbar — is resolved from the current pathname so
 * every screen gets consistent navigation, settings, help, history, bookmark,
 * and feedback affordances. `title`/`lede` props still win when provided (the
 * per-page metadata stays the source of truth for those screens).
 */
export function AppPage({
  title,
  lede,
  children,
}: {
  title?: string
  lede?: string
  children?: ReactNode
}) {
  const pathname = usePathname()
  const meta = useMemo(() => pageMetaFor(pathname), [pathname])
  const topics = useMemo(() => helpTopicsFor(pathname), [pathname])

  const resolvedTitle = title ?? meta.title
  const resolvedLede = lede ?? meta.lede
  // Dialogs key off the nav section when we can find one, else the title.
  const section = meta.crumbs[meta.crumbs.length - 1]?.label ?? resolvedTitle

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  // Keep the browser tab title in sync with the resolved page title.
  useEffect(() => {
    document.title = `${resolvedTitle} — Spindle`
  }, [resolvedTitle])

  return (
    <div className="app-page">
      {/* Responsive header grid: title block and toolbar stack on narrow
          screens and sit side-by-side once there is room (sm+). */}
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <div className="min-w-0">
          <Breadcrumb className="mb-1">
            <BreadcrumbList>
              {meta.crumbs.map((crumb, index) => {
                const isLast = index === meta.crumbs.length - 1
                return (
                  <Fragment key={`${crumb.label}-${index}`}>
                    {index > 0 ? <BreadcrumbSeparator /> : null}
                    <BreadcrumbItem>
                      {isLast || !crumb.href ? (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link href={crumb.href}>{crumb.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="app-page-title">{resolvedTitle}</h1>
          <p className="app-page-lede">{resolvedLede}</p>
        </div>

        <div className="app-page-actions justify-self-start sm:justify-self-end">
          <PageBookmarkButton title={resolvedTitle} />
          <PageActionsMenu section={section} onOpenSettings={() => setSettingsOpen(true)} />
          <PageSettingsButton onOpen={() => setSettingsOpen(true)} />
          <PageHistoryButton onOpen={() => setHistoryOpen(true)} />
          <PageHelpButton onOpen={() => setHelpOpen(true)} />
          <PageFeedbackButton onOpen={() => setFeedbackOpen(true)} />
        </div>
      </div>

      {children}

      <PageSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={section}
      />
      <PageHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        section={section}
        topics={topics}
      />
      <PageHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        section={section}
      />
      <PageFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        pageTitle={resolvedTitle}
        pagePath={pathname}
      />
    </div>
  )
}
