"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, Search, Star, X } from "lucide-react"

import { NODE_TYPES, type NodeCategory, type NodeTypeDef } from "@/lib/automation-graph"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: "Triggers",
  transform: "Transforms",
  logic: "Logic",
  action: "Actions",
}

const CATEGORY_ORDER: NodeCategory[] = ["trigger", "transform", "logic", "action"]

/** localStorage key for the user's pinned node types. */
const FAVORITES_KEY = "spindle:automation-palette-favorites"

function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === "string"))
  } catch {
    return new Set()
  }
}

function matchesQuery(def: NodeTypeDef, query: string): boolean {
  if (!query) return true
  const haystack = [def.label, def.description, def.type, CATEGORY_LABELS[def.category]]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

interface NodePaletteProps {
  onAddNode: (type: string) => void
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const [query, setQuery] = useState("")
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Favorites live in localStorage, so they are loaded after mount to keep the
  // server-rendered markup stable.
  useEffect(() => {
    setFavorites(loadFavorites())
  }, [])

  function toggleFavorite(type: string) {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
      } catch {
        // Storage unavailable (private mode, quota) — favorites stay session-only.
      }
      return next
    })
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(
    () => NODE_TYPES.filter((def) => matchesQuery(def, normalizedQuery)),
    [normalizedQuery],
  )
  const favoriteTypes = useMemo(
    () => filtered.filter((def) => favorites.has(def.type)),
    [filtered, favorites],
  )

  function renderNodeButton(def: NodeTypeDef) {
    const favorite = favorites.has(def.type)
    return (
      <div key={def.type} className="group/row flex items-stretch gap-1">
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-automation-node", def.type)
            event.dataTransfer.effectAllowed = "copy"
          }}
          onClick={() => onAddNode(def.type)}
          className={cn(
            "group border-border bg-background flex min-w-0 flex-1 items-start gap-2 rounded-md border px-2.5 py-2 text-left",
            "hover:border-primary/50 hover:bg-accent/50 transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          )}
          aria-label={`Add ${def.label} node`}
        >
          <Plus
            className="text-muted-foreground group-hover:text-primary mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{def.label}</span>
            <span className="text-muted-foreground block truncate text-[10px]">
              {def.description}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => toggleFavorite(def.type)}
          className={cn(
            "border-border text-muted-foreground flex w-7 shrink-0 items-center justify-center rounded-md border transition-colors hover:border-amber-500/50 hover:text-amber-500",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            favorite && "border-amber-500/40 text-amber-500",
          )}
          aria-label={
            favorite ? `Remove ${def.label} from favorites` : `Favorite ${def.label} node`
          }
          aria-pressed={favorite}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={cn("size-3.5", favorite && "fill-amber-400 text-amber-400")}
            aria-hidden="true"
          />
        </button>
      </div>
    )
  }

  return (
    <div className="border-border bg-card flex w-52 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
      <div>
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Node palette
        </h3>
        <p className="text-muted-foreground mt-1 text-[11px]">
          Click to add, or drag onto the canvas.
        </p>
      </div>

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              setQuery("")
            }
          }}
          placeholder="Filter nodes…"
          aria-label="Filter nodes"
          className="h-8 pl-7 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
            aria-label="Clear node filter"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground px-1 py-2 text-xs">
          No nodes match “{query.trim()}”.{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => setQuery("")}
          >
            Clear filter
          </button>
        </p>
      ) : (
        <>
          {favoriteTypes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground/70 flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase">
                <Star className="size-2.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                Favorites
              </p>
              {favoriteTypes.map(renderNodeButton)}
            </div>
          )}
          {CATEGORY_ORDER.map((category) => {
            const types = filtered.filter((def) => def.category === category)
            if (types.length === 0) return null
            return (
              <div key={category} className="flex flex-col gap-1.5">
                <p className="text-muted-foreground/70 text-[10px] font-semibold tracking-wider uppercase">
                  {CATEGORY_LABELS[category]}
                </p>
                {types.map(renderNodeButton)}
              </div>
            )
          })}
        </>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-auto"
        onClick={() => onAddNode(NODE_TYPES[0].type)}
      >
        Quick add trigger
      </Button>
    </div>
  )
}
