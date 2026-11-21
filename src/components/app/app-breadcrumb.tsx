"use client"

import { Fragment } from "react"
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
import { NAV_ITEMS, isNavActive } from "./nav-items"
import styles from "./app-shell-features.module.css"

export type BreadcrumbCrumb = {
  label: string
  /** Present on every crumb except the current page (last) one. */
  href?: string
}

/** "agent-runs" -> "Agent Runs"; leaves already-clean segments untouched. */
function segmentLabel(segment: string) {
  const words = segment.split("-").filter(Boolean)
  if (words.length === 0) return segment
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
}

/**
 * Derives the breadcrumb trail for a route: the matching nav section first,
 * then one crumb per remaining path segment with accumulated hrefs. The
 * last crumb is always the current page and renders as plain text.
 */
export function breadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  const section = NAV_ITEMS.find((item) => isNavActive(pathname, item.href))
  if (!section) {
    // Unmatched routes (e.g. "/") still get a single-crumb trail.
    return [{ label: pathname === "/" ? "Dashboard" : "Spindle" }]
  }

  const rest = pathname.slice(section.href.length).split("/").filter(Boolean)
  const crumbs: BreadcrumbCrumb[] = [{ label: section.label, href: section.href }]
  rest.forEach((segment, index) => {
    crumbs.push({
      label: segmentLabel(segment),
      href: `${section.href}/${rest.slice(0, index + 1).join("/")}`,
    })
  })
  return crumbs
}

/**
 * Top-bar breadcrumb showing the current page hierarchy. Built on the
 * shadcn breadcrumb primitives; hidden below the 900px breakpoint (same as
 * the old `.app-topbar-title`) where the mobile drawer owns navigation.
 */
export function AppBreadcrumb() {
  const pathname = usePathname()
  const trail = breadcrumbTrail(pathname)

  return (
    <Breadcrumb className={styles.breadcrumb}>
      <BreadcrumbList>
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1
          return (
            <Fragment key={crumb.href ?? crumb.label}>
              <BreadcrumbItem>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
