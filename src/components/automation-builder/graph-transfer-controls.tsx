"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { Download, Upload } from "lucide-react"

import {
  GRAPH_TRANSFER_MAX_BYTES,
  graphTransferFormatForFileName,
  parseGraphImport,
  serializeGraphJson,
  serializeGraphYaml,
  type GraphTransferFormat,
} from "@/lib/automation-graph"
import type { AutomationGraph } from "@/lib/automation-graph"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/toast"

interface GraphTransferControlsProps {
  graph: AutomationGraph
  /** Called with a validated imported graph; the parent commits it. */
  onImport: (graph: AutomationGraph) => void
}

function slugifyFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "automation"
}

function downloadGraph(graph: AutomationGraph, format: GraphTransferFormat) {
  const source = format === "yaml" ? serializeGraphYaml(graph) : serializeGraphJson(graph)
  const mime = format === "yaml" ? "application/yaml" : "application/json"
  const blob = new Blob([source], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${slugifyFileName(graph.name)}.${format === "yaml" ? "yaml" : "json"}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Export/import controls for the builder header. Export downloads the graph
 * DSL (`{ version, graph }`) as JSON or YAML; import reads a `.json`/`.yaml`
 * file, validates it with `parseGraphImport`, and hands the graph to the
 * parent — same size-limit and Blob conventions as the settings
 * import/export card.
 */
export function GraphTransferControls({ graph, onImport }: GraphTransferControlsProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    event.target.value = ""
    if (!file) return

    try {
      if (file.size > GRAPH_TRANSFER_MAX_BYTES) {
        toast({
          variant: "error",
          title: "File too large",
          description: "Automation files must be 256 KB or smaller.",
        })
        return
      }
      setImporting(true)
      const result = parseGraphImport(await file.text(), graphTransferFormatForFileName(file.name))
      if (!result.ok) {
        toast({ variant: "error", title: "Import failed", description: result.error })
        return
      }
      const warnings = result.issues.filter((issue) => issue.severity === "warning").length
      onImport(result.graph)
      toast({
        variant: "success",
        title: "Automation imported",
        description:
          warnings > 0
            ? `"${result.graph.name}" loaded with ${warnings} warning${warnings === 1 ? "" : "s"}.`
            : `"${result.graph.name}" was loaded onto the canvas.`,
      })
    } catch (cause) {
      toast({
        variant: "error",
        title: "Import failed",
        description: cause instanceof Error ? cause.message : "Could not read that file.",
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Download aria-hidden="true" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => downloadGraph(graph, "json")}>
            Export JSON
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadGraph(graph, "yaml")}>
            Export YAML
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload aria-hidden="true" />
        {importing ? "Importing…" : "Import"}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.yaml,.yml,application/json"
        className="sr-only"
        aria-label="Choose an automation file to import"
        onChange={onFileChange}
      />
    </>
  )
}
