"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { Download, Upload } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

const SETTINGS_FILE_MAX_BYTES = 256 * 1024

export type SettingsImportValidation<TSettings> =
  { ok: true; settings: TSettings } | { ok: false; error: string }

/**
 * Shared "Import & export" card for settings screens. Export downloads the
 * current settings as a JSON file (same Blob/createObjectURL pattern as the
 * files and usage screens); import reads a `.json` file, validates it with the
 * caller-supplied `validateImport`, then hands the parsed settings to
 * `onImport`. There is no settings transfer API yet, so import only fills the
 * local form — the user still saves through the regular flow.
 */
export function SettingsImportExportCard<TSettings>({
  headingId,
  description,
  exportFilename,
  buildExportPayload,
  validateImport,
  onImport,
}: {
  headingId: string
  description: string
  exportFilename: string
  buildExportPayload: () => unknown
  validateImport: (value: unknown) => SettingsImportValidation<TSettings>
  onImport: (settings: TSettings) => void
}) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")

  function exportSettings() {
    const blob = new Blob([JSON.stringify(buildExportPayload(), null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = exportFilename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    event.target.value = ""
    if (!file) return

    setError("")
    try {
      if (file.size > SETTINGS_FILE_MAX_BYTES) {
        setError("Settings files must be 256 KB or smaller.")
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        setError("The file is not valid JSON.")
        return
      }
      const result = validateImport(parsed)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onImport(result.settings)
      toast({
        title: "Settings imported",
        description: "Review the form and save to apply the imported values.",
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that file.")
    }
  }

  return (
    <section className="app-page-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Import &amp; export</h2>
      <p className="app-page-subtitle">{description}</p>
      <div className="app-form-actions">
        <Button type="button" variant="outline" onClick={exportSettings}>
          <Download aria-hidden="true" />
          Export JSON
        </Button>
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload aria-hidden="true" />
          Import JSON
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Choose a settings file to import"
          onChange={onFileChange}
        />
      </div>
      {error ? <InlineError title={null} message={error} /> : null}
    </section>
  )
}
