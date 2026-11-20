"use client"

import { useMemo, useState } from "react"
import { Download, Search, Star, Store } from "lucide-react"

import {
  TEMPLATE_CATEGORIES,
  categoryLabel,
  formatInstalls,
  searchMarketplace,
  type MarketplaceTemplate,
  type TemplateCategory,
} from "@/lib/automation-graph"
import { getNodeType } from "@/lib/automation-graph"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface MarketplacePanelProps {
  /** Called with the chosen template; the parent builds and loads its graph. */
  onInstall: (template: MarketplaceTemplate) => void
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-0.5 text-[10px]"
      title={`${rating} out of 5`}
    >
      <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
      {rating.toFixed(1)}
    </span>
  )
}

function TemplateCard({
  template,
  onInstall,
}: {
  template: MarketplaceTemplate
  onInstall: (template: MarketplaceTemplate) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Preview builds the graph lazily on expand — build() is cheap and pure.
  const previewNodes = useMemo(() => (expanded ? template.build().nodes : []), [expanded, template])

  return (
    <li className="border-border/70 flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{template.name}</span>
            <Badge variant="secondary" className="text-[9px]">
              {categoryLabel(template.category)}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
            {template.description}
          </p>
        </div>
        <RatingStars rating={template.rating} />
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
        <span>{formatInstalls(template.installs)} installs</span>
        <button
          type="button"
          className="hover:text-foreground underline underline-offset-2"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide preview" : "Preview"}
        </button>
      </div>

      {expanded ? (
        <div className="bg-muted/50 flex flex-col gap-1 rounded p-1.5">
          <p className="text-muted-foreground text-[10px] font-medium">
            {previewNodes.length} nodes in this template:
          </p>
          <ul className="flex flex-col gap-0.5">
            {previewNodes.map((node) => (
              <li
                key={node.id}
                className="text-muted-foreground flex items-center gap-1.5 text-[10px]"
              >
                <span
                  className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                {getNodeType(node.type)?.label ?? node.type}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-[11px]"
        onClick={() => onInstall(template)}
      >
        <Download aria-hidden="true" />
        Install template
      </Button>
    </li>
  )
}

/**
 * Browsable template marketplace: search, category filter, preview, and
 * install (which loads the template graph onto the canvas via `onInstall`).
 * Ratings/install counts are local mock data.
 */
export function MarketplacePanel({ onInstall }: MarketplacePanelProps) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<TemplateCategory | "all">("all")

  const results = useMemo(() => searchMarketplace(query, category), [query, category])

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-marketplace-heading"
    >
      <h3
        id="builder-marketplace-heading"
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <Store className="size-3.5" aria-hidden="true" />
        Template marketplace
      </h3>

      <div className="relative">
        <Search
          className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search templates…"
          aria-label="Search templates"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Template categories">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px]",
            category === "all"
              ? "border-foreground/40 bg-foreground/10 font-medium"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={category === "all"}
        >
          All
        </button>
        {TEMPLATE_CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setCategory(entry.id)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              category === entry.id
                ? "border-foreground/40 bg-foreground/10 font-medium"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={category === entry.id}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <p className="text-muted-foreground text-[11px]">No templates match your search.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {results.map((template) => (
            <TemplateCard key={template.id} template={template} onInstall={onInstall} />
          ))}
        </ul>
      )}
    </section>
  )
}
