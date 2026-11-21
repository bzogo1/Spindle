"use client"

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import type { DocsNavSection } from "@/lib/docs"

import { DocsSearch } from "./docs-search"

type DocsNavProps = {
  groups: DocsNavSection[]
  currentId?: string
  currentLinkRef?: RefObject<HTMLAnchorElement | null>
  onNavigate?: () => void
}

function subtreeHasGuide(group: DocsNavSection, currentId?: string): boolean {
  if (!currentId) return false
  return (
    group.guides.some((guide) => guide.id === currentId) ||
    (group.children ?? []).some((child) => subtreeHasGuide(child, currentId))
  )
}

function NavDirectory({
  group,
  currentId,
  currentLinkRef,
  onNavigate,
}: {
  group: DocsNavSection
  currentId?: string
  currentLinkRef?: RefObject<HTMLAnchorElement | null>
  onNavigate?: () => void
}) {
  const panelId = useId()
  const children = group.children ?? []
  // Directories start closed; ancestors of the current guide open so the
  // reader can see where they are without the whole tree expanding.
  const [open, setOpen] = useState(() => subtreeHasGuide(group, currentId))
  const isEmpty = group.guides.length === 0 && children.length === 0

  return (
    <div className="doc-nav-group">
      <button
        type="button"
        className="doc-nav-dir"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="icon icon--xs doc-nav-dir-icon" aria-hidden="true">
          <use href="#i-folder" />
        </svg>
        <span className="doc-nav-dir-title">{group.title}</span>
        {group.guides.length > 0 ? (
          <span className="doc-nav-count">{group.guides.length}</span>
        ) : null}
        <svg className="icon icon--xs doc-nav-dir-chevron" aria-hidden="true">
          <use href="#i-chevron-down" />
        </svg>
      </button>

      {open ? (
        <div className="doc-nav-panel" id={panelId}>
          {group.guides.length > 0 ? (
            <ul className="doc-nav-list">
              {group.guides.map((guide) => {
                const current = guide.id === currentId

                return (
                  <li key={guide.id}>
                    <a
                      href={`/docs/${guide.id}`}
                      className={`doc-nav-link${current ? "is-current" : ""}`}
                      aria-current={current ? "page" : undefined}
                      ref={current ? currentLinkRef : undefined}
                      onClick={onNavigate}
                    >
                      {guide.title}
                    </a>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {children.length > 0 ? (
            <div className="doc-nav-subdirs">
              {children.map((child, index) => (
                <NavDirectory
                  key={`${child.title}:${index}`}
                  group={child}
                  currentId={currentId}
                  currentLinkRef={currentLinkRef}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ) : null}

          {isEmpty ? <p className="doc-nav-empty">No pages yet</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function DocsNav({ groups, currentId, currentLinkRef, onNavigate }: DocsNavProps) {
  return (
    <nav className="doc-nav" aria-label="Documentation guides">
      {groups.map((group) => (
        <NavDirectory
          key={group.title}
          group={group}
          currentId={currentId}
          currentLinkRef={currentLinkRef}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  )
}

/**
 * The docs sidebar. On desktop it is a sticky aside; below 900px it collapses
 * into a trigger that opens the same navigation in a dialog drawer, so there
 * is one guide list rather than a second mobile-only copy.
 */
export function DocsSidebar({
  groups,
  currentId,
}: {
  groups: DocsNavSection[]
  currentId?: string
}) {
  const [open, setOpen] = useState(false)
  const currentLinkRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    if (!open) return

    // The drawer may open below the fold on a short screen; keep the guide the
    // reader is already on in view.
    const frame = requestAnimationFrame(() => {
      currentLinkRef.current?.scrollIntoView({ block: "nearest" })
    })

    return () => cancelAnimationFrame(frame)
  }, [open])

  const currentTitle = currentId
    ? (groups
        .flatMap((group) => group.guides)
        .find((guide) => guide.id === currentId)?.title ?? "Documentation")
    : "Documentation"

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* Registered with the dialog so Radix restores focus to it on close. */}
      <DialogPrimitive.Trigger className="doc-drawer-trigger">
        <svg className="icon icon--sm" aria-hidden="true">
          <use href="#i-menu" />
        </svg>
        <span className="doc-drawer-trigger-label">Browse guides</span>
        <span className="doc-drawer-trigger-current">{currentTitle}</span>
      </DialogPrimitive.Trigger>

      <aside className="doc-sidebar">
        <DocsSearch />
        <DocsNav groups={groups} currentId={currentId} />
      </aside>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="doc-drawer-overlay" />
        <DialogPrimitive.Content
          id="docs-guide-drawer"
          className="doc-drawer"
          aria-modal="true"
          aria-describedby={undefined}
        >
          <div className="doc-drawer-head">
            <DialogPrimitive.Title className="doc-drawer-title">
              Documentation
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="doc-drawer-close" aria-label="Close guide navigation">
              <svg className="icon icon--sm" aria-hidden="true">
                <use href="#i-close" />
              </svg>
            </DialogPrimitive.Close>
          </div>
          <DocsSearch onNavigate={() => setOpen(false)} />
          <DocsNav
            groups={groups}
            currentId={currentId}
            currentLinkRef={currentLinkRef}
            onNavigate={() => setOpen(false)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
