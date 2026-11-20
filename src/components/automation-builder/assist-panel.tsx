"use client"

import { useState } from "react"
import { Sparkles, Wand2 } from "lucide-react"

import { buildGraphFromIntent } from "@/lib/automations/intent"
import type { AutomationGraph } from "@/lib/automation-graph"
import { getNodeType } from "@/lib/automation-graph"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface AssistPanelProps {
  /** Called with the generated graph when the user accepts the suggestion. */
  onApply: (graph: AutomationGraph) => void
}

/**
 * AI-assist panel: describe the automation in plain language and get a
 * suggested node graph (rule-based intent parsing — no external AI calls).
 * The preview lists the nodes that would be added before applying.
 */
export function AssistPanel({ onApply }: AssistPanelProps) {
  const [text, setText] = useState("")
  const [preview, setPreview] = useState<ReturnType<typeof buildGraphFromIntent> | null>(null)

  function suggest() {
    const trimmed = text.trim()
    if (!trimmed) {
      setPreview(null)
      return
    }
    setPreview(buildGraphFromIntent(trimmed))
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-assist-heading"
    >
      <h3
        id="builder-assist-heading"
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI assist
      </h3>

      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="e.g. Every Monday at 8am summarize new papers and post a digest to #updates"
        aria-label="Describe your automation"
        rows={3}
        className="text-xs"
      />

      <div className="flex gap-1.5">
        <Button type="button" variant="outline" size="sm" onClick={suggest} disabled={!text.trim()}>
          <Wand2 aria-hidden="true" />
          Suggest graph
        </Button>
        {preview ? (
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onApply(preview.graph)
                setPreview(null)
                setText("")
              }}
            >
              Apply to canvas
            </Button>
            <p className="text-muted-foreground text-[10px]">
              Applying replaces the current canvas.
            </p>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-[11px]">{preview.intent.triggerLabel}</p>
          <ul className="flex flex-col gap-1">
            {preview.graph.nodes.map((node) => (
              <li
                key={node.id}
                className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
              >
                <span className="bg-muted size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                {getNodeType(node.type)?.label ?? node.type}
              </li>
            ))}
          </ul>
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-[10px]">
            {preview.notes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-[11px]">
          Describe what the automation should do — the assistant builds a connected graph you can
          edit.
        </p>
      )}
    </section>
  )
}
