"use client"

import { useEffect, useState } from "react"
import { Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"

/**
 * Per-section settings persisted to localStorage under `spindle:page-settings`.
 * Values are booleans/strings keyed by setting id; unknown ids fall back to
 * their defaults below.
 */
const SETTINGS_KEY = "spindle:page-settings"

interface SectionSettings {
  /** Show compact rows instead of cards on list-style pages. */
  compactView: boolean
  /** Confirm before destructive actions on this page. */
  confirmDestructive: boolean
  /** Default export format for the actions menu. */
  exportFormat: "json" | "csv"
}

const DEFAULTS: SectionSettings = {
  compactView: false,
  confirmDestructive: true,
  exportFormat: "json",
}

function storageKey(section: string) {
  return `${SETTINGS_KEY}:${section}`
}

function readSettings(section: string): SectionSettings {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = window.localStorage.getItem(storageKey(section))
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SectionSettings>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

/**
 * "Page settings" dialog for the current section. Mock-backed: preferences
 * persist to localStorage until the real per-section settings endpoints land.
 */
export function PageSettingsDialog({
  open,
  onOpenChange,
  section,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: string
}) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SectionSettings>(DEFAULTS)
  const [dirty, setDirty] = useState(false)

  // Load the stored preferences whenever the dialog opens for a section.
  useEffect(() => {
    if (open) {
      setSettings(readSettings(section))
      setDirty(false)
    }
  }, [open, section])

  function update<K extends keyof SectionSettings>(key: K, value: SectionSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  function handleSave() {
    try {
      window.localStorage.setItem(storageKey(section), JSON.stringify(settings))
    } catch {
      // Storage may be unavailable (private mode); the toast still confirms.
    }
    setDirty(false)
    toast({ variant: "success", title: "Page settings saved." })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" aria-hidden="true" />
            {section} settings
          </DialogTitle>
          <DialogDescription>
            Preferences for this page. Saved locally until per-section settings ship.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="page-settings-compact">Compact view</Label>
              <p className="text-muted-foreground text-xs">
                Denser rows and smaller cards on list pages.
              </p>
            </div>
            <Switch
              id="page-settings-compact"
              checked={settings.compactView}
              onCheckedChange={(checked) => update("compactView", checked)}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="page-settings-confirm">Confirm destructive actions</Label>
              <p className="text-muted-foreground text-xs">
                Ask before deletes, archives, and other irreversible steps.
              </p>
            </div>
            <Switch
              id="page-settings-confirm"
              checked={settings.confirmDestructive}
              onCheckedChange={(checked) => update("confirmDestructive", checked)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="page-settings-export">Default export format</Label>
            <select
              id="page-settings-export"
              value={settings.exportFormat}
              onChange={(event) =>
                update("exportFormat", event.target.value as SectionSettings["exportFormat"])
              }
              className="app-select"
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="page-settings-notes">Page notes</Label>
            <Input
              id="page-settings-notes"
              placeholder="Notes for yourself — not saved yet"
              disabled
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!dirty}>
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Small toolbar button that opens the settings dialog. */
export function PageSettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onOpen}>
      <Settings2 aria-hidden="true" />
      Settings
    </Button>
  )
}
