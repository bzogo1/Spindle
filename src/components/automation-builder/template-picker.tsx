"use client"

import { LayoutTemplate } from "lucide-react"

import { AUTOMATION_TEMPLATES, type AutomationTemplate } from "@/lib/automation-graph"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface TemplatePickerProps {
  /** Called with the chosen template; the parent builds and loads its graph. */
  onLoadTemplate: (template: AutomationTemplate) => void
}

export function TemplatePicker({ onLoadTemplate }: TemplatePickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <LayoutTemplate aria-hidden="true" />
          Templates
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Start from a template — this replaces the current canvas.
        </DropdownMenuLabel>
        {AUTOMATION_TEMPLATES.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onSelect={() => onLoadTemplate(template)}
            className="items-start"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-medium">{template.name}</span>
              <span className="text-muted-foreground text-[11px] leading-snug">
                {template.description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
