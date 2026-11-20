"use client"

import { Trash2 } from "lucide-react"

import { getNodeType, type ConfigField, type GraphNode } from "@/lib/automation-graph"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface InspectorPanelProps {
  node: GraphNode | null
  onUpdateNode: (
    nodeId: string,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => void
  onDeleteNode: (nodeId: string) => void
}

function ConfigInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `node-config-${field.key}`
  const stringValue = value === undefined || value === null ? "" : String(value)

  switch (field.kind) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={stringValue}
          placeholder={field.placeholder}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case "select":
      return (
        <select
          id={id}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    case "boolean":
      return (
        <div className="flex items-center gap-2 pt-1">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
          {/* Plain text, not a <label>: the field label above already points
              at this switch via htmlFor — a second label would double the
              accessible name. */}
          <span className="text-muted-foreground text-xs font-normal">
            {field.hint ?? "Enabled"}
          </span>
        </div>
      )
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={stringValue}
          placeholder={field.placeholder}
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
        />
      )
    case "text":
    default:
      return (
        <Input
          id={id}
          value={stringValue}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

export function InspectorPanel({ node, onUpdateNode, onDeleteNode }: InspectorPanelProps) {
  if (!node) {
    return (
      <div className="border-border bg-card text-muted-foreground flex w-64 shrink-0 flex-col gap-2 rounded-lg border p-3 text-sm">
        <h3 className="text-xs font-semibold tracking-wide uppercase">Inspector</h3>
        <p className="text-xs">Select a node on the canvas to edit its configuration.</p>
      </div>
    )
  }

  const def = getNodeType(node.type)

  return (
    <div className="border-border bg-card flex w-64 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Inspector
          </h3>
          <p className="truncate text-sm font-medium">{def?.label ?? node.type}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete node ${node.label}`}
          onClick={() => onDeleteNode(node.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="inspector-node-label" className="text-xs">
          Label
        </Label>
        <Input
          id="inspector-node-label"
          value={node.label}
          onChange={(event) => onUpdateNode(node.id, { label: event.target.value })}
        />
      </div>

      {def && def.configFields.length > 0 ? (
        <div className="grid gap-3">
          {def.configFields.map((field) => (
            <div key={field.key} className="grid gap-1.5">
              <Label htmlFor={`node-config-${field.key}`} className="text-xs">
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </Label>
              <ConfigInput
                field={field}
                value={node.config[field.key]}
                onChange={(value) =>
                  onUpdateNode(node.id, {
                    config: { ...node.config, [field.key]: value },
                  })
                }
              />
              {field.hint ? (
                <p className="text-muted-foreground text-[11px]">{field.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">This node type has no configuration.</p>
      )}

      <div className="bg-muted/60 text-muted-foreground mt-auto rounded-md p-2 text-[11px]">
        <p className="text-foreground font-medium">Ports</p>
        <p>Inputs: {def?.inputs.map((p) => p.label ?? p.id).join(", ") || "none"}</p>
        <p>Outputs: {def?.outputs.map((p) => p.label ?? p.id).join(", ") || "none"}</p>
      </div>
    </div>
  )
}
