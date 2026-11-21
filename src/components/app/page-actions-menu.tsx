"use client"

import { usePathname } from "next/navigation"
import { ChevronDown, Download, Link2, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/toast"
import { pageMetaFor } from "@/components/app/page-meta"

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * "Actions" dropdown grouping page-level operations: export the current page
 * as JSON, copy a shareable link, or jump to the section settings dialog.
 * Mock-backed until the real export/share endpoints exist.
 */
export function PageActionsMenu({
  section,
  onOpenSettings,
}: {
  section: string
  onOpenSettings: () => void
}) {
  const pathname = usePathname()
  const { toast } = useToast()

  function handleExport() {
    const meta = pageMetaFor(pathname)
    downloadJson(`spindle-${section.toLowerCase()}-${Date.now()}.json`, {
      exportedAt: new Date().toISOString(),
      page: { title: meta.title, path: pathname },
      // Placeholder payload — the real export will stream server data.
      data: [],
    })
    toast({ variant: "success", title: `Exported ${meta.title} data.` })
  }

  async function handleShare() {
    const url = `${window.location.origin}${pathname}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ variant: "success", title: "Link copied to clipboard." })
    } catch {
      // Clipboard API needs a secure context; fall back to selecting nothing
      // and telling the user the URL so they can copy it manually.
      toast({ variant: "info", title: "Could not copy automatically.", description: url })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Page actions">
          Actions
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{section}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleExport}>
          <Download aria-hidden="true" />
          Export page data
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleShare}>
          <Link2 aria-hidden="true" />
          Copy share link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings2 aria-hidden="true" />
          Page settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
