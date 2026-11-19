"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { label: "Home", suffix: "" },
  { label: "Files", suffix: "/files" },
  { label: "Lab", suffix: "/lab" },
  { label: "Chat", suffix: "/chat" },
  { label: "Agent", suffix: "/agent" },
  { label: "Activity", suffix: "/activity" },
] as const

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/projects/${projectId}`

  return (
    <nav className="app-project-tabs" aria-label="Project sections">
      {TABS.map((tab) => {
        const href = `${base}${tab.suffix}`
        const active = tab.suffix
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === base
        return (
          <Link
            key={tab.label}
            href={href}
            className="app-project-tab"
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
