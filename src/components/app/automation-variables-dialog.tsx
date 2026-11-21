"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Braces, Plus, Trash2 } from "lucide-react"

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

export type AutomationVariables = Record<string, string>

interface VariableRow {
  key: string
  value: string
}

const VARIABLE_KEY_PATTERN = /^[A-Za-z_][\w.-]*$/

function rowsFromVariables(variables?: AutomationVariables): VariableRow[] {
  const entries = Object.entries(variables ?? {})
  return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]
}

function validateRows(rows: VariableRow[]): string | null {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = row.key.trim()
    if (!key && !row.value.trim()) continue
    if (!key) return "Every variable needs a name."
    if (!VARIABLE_KEY_PATTERN.test(key)) {
      return `"${key}" isn't a valid variable name — use letters, numbers, _ or -.`
    }
    if (seen.has(key)) return `"${key}" is defined more than once.`
    seen.add(key)
  }
  return null
}

/**
 * "Automation variables" panel: define name/value pairs that are injected
 * into the automation's prompts and log output as `{{name}}` placeholders.
 */
export function AutomationVariablesDialog({
  automationName,
  variables,
  open,
  onOpenChange,
  onSave,
}: {
  automationName: string
  variables?: AutomationVariables
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (variables: AutomationVariables) => void
}) {
  const [rows, setRows] = useState<VariableRow[]>([{ key: "", value: "" }])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setRows(rowsFromVariables(variables))
      setError(null)
    }
  }, [open, variables])

  function updateRow(index: number, patch: Partial<VariableRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setError(null)
  }

  function addRow() {
    setRows((current) => [...current, { key: "", value: "" }])
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = validateRows(rows)
    if (problem) {
      setError(problem)
      return
    }
    const next: AutomationVariables = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (key) next[key] = row.value
    }
    onSave(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Braces aria-hidden="true" className="size-4" />
              Variables — {automationName}
            </span>
          </DialogTitle>
          <DialogDescription>
            Define values the automation can reference as{" "}
            <code className="text-xs">{"{{name}}"}</code> in prompts, webhook payloads, and log
            output. Stored in local state only.
          </DialogDescription>
        </DialogHeader>

        <form className="app-form" onSubmit={submit} noValidate>
          <div className="app-field">
            <span className="app-field-label" id="automation-variables-label">
              Variable definitions
            </span>
            <div className="flex flex-col gap-2" role="group" aria-labelledby="automation-variables-label">
              {rows.map((row, index) => (
                <div key={index} className="app-automation-interval">
                  <Input
                    value={row.key}
                    onChange={(event) => updateRow(index, { key: event.target.value })}
                    placeholder="channel"
                    aria-label={`Variable ${index + 1} name`}
                    spellCheck={false}
                  />
                  <Input
                    value={row.value}
                    onChange={(event) => updateRow(index, { value: event.target.value })}
                    placeholder="#project-updates"
                    aria-label={`Variable ${index + 1} value`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove variable ${index + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus aria-hidden="true" />
              Add variable
            </Button>
            {error ? <p className="app-field-error">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save variables</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
