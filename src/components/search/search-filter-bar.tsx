"use client"

import { useId } from "react"

import type { SearchFilters } from "@/lib/search/filters"
import { facetToFilters, type FacetDimension, type SearchFacets } from "@/lib/search/facets"
import styles from "./search-ui.module.css"

/**
 * Filter + facet UI for search results.
 *
 * `SearchFilterBar` renders type checkboxes (page / doc / api / …), a section
 * select, and a last-updated select. `SearchFacetList` renders clickable
 * facet counts (type / section / tag) computed over the *unfiltered* result
 * set — clicking a value toggles it in `SearchFilters` via `facetToFilters`,
 * so facets stay explorable while a filter is active.
 */

export type SearchFilterBarProps = {
  /** Available type values with labels (typically from `facets.type`). */
  types?: { value: string; label?: string; count?: number }[]
  /** Available section values. */
  sections?: { value: string; count?: number }[]
  /** Current filters (controlled). */
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  /** Show the last-updated select. Default true. */
  showUpdated?: boolean
  className?: string
}

const UPDATED_OPTIONS: { value: string; label: string; days?: number }[] = [
  { value: "", label: "Any time" },
  { value: "7", label: "Past week", days: 7 },
  { value: "30", label: "Past month", days: 30 },
  { value: "90", label: "Past quarter", days: 90 },
]

const DAY_MS = 24 * 60 * 60 * 1000

export function SearchFilterBar({
  types = [],
  sections = [],
  filters,
  onFiltersChange,
  showUpdated = true,
  className,
}: SearchFilterBarProps) {
  const baseId = useId()

  function toggleType(type: string) {
    const active = filters.types ?? []
    const next = active.includes(type) ? active.filter((t) => t !== type) : [...active, type]
    onFiltersChange({ ...filters, types: next.length > 0 ? next : undefined })
  }

  function setSections(section: string) {
    onFiltersChange({ ...filters, sections: section ? [section] : undefined })
  }

  function setUpdated(value: string) {
    const option = UPDATED_OPTIONS.find((o) => o.value === value)
    onFiltersChange({
      ...filters,
      updatedAfter: option?.days ? Date.now() - option.days * DAY_MS : undefined,
    })
  }

  const updatedValue =
    UPDATED_OPTIONS.find(
      (o) =>
        o.days &&
        filters.updatedAfter &&
        Date.now() - filters.updatedAfter <= o.days * DAY_MS + 1000,
    )?.value ?? ""

  return (
    <div
      className={`${styles.filterBar} ${className ?? ""}`}
      role="group"
      aria-label="Search filters"
    >
      {types.length > 0 ? (
        <div className={styles.filterGroup} role="group" aria-label="Filter by type">
          {types.map((type) => {
            const checked = (filters.types ?? []).includes(type.value)
            return (
              <label key={type.value} className={styles.filterCheck}>
                <input type="checkbox" checked={checked} onChange={() => toggleType(type.value)} />
                <span>
                  {type.label ?? type.value}
                  {type.count !== undefined ? (
                    <span className={styles.filterCount}> ({type.count})</span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className={styles.filterGroup}>
          <label htmlFor={`${baseId}-section`} className={styles.filterLabel}>
            Section
          </label>
          <select
            id={`${baseId}-section`}
            className={styles.filterSelect}
            value={(filters.sections ?? [])[0] ?? ""}
            onChange={(event) => setSections(event.target.value)}
          >
            <option value="">All sections</option>
            {sections.map((section) => (
              <option key={section.value} value={section.value}>
                {section.value}
                {section.count !== undefined ? ` (${section.count})` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {showUpdated ? (
        <div className={styles.filterGroup}>
          <label htmlFor={`${baseId}-updated`} className={styles.filterLabel}>
            Updated
          </label>
          <select
            id={`${baseId}-updated`}
            className={styles.filterSelect}
            value={updatedValue}
            onChange={(event) => setUpdated(event.target.value)}
          >
            {UPDATED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}

export type SearchFacetListProps = {
  facets: SearchFacets
  /** Current filter selections (controlled). */
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  /** Which dimensions to render. Default all three. */
  dimensions?: readonly FacetDimension[]
  /** Optional heading. */
  title?: string
  className?: string
}

const DIMENSION_LABELS: Record<FacetDimension, string> = {
  type: "Type",
  section: "Section",
  tag: "Tags",
}

export function SearchFacetList({
  facets,
  filters,
  onFiltersChange,
  dimensions = ["type", "section", "tag"],
  title = "Facets",
  className,
}: SearchFacetListProps) {
  const baseId = useId()

  const currentSelections: { types?: string[]; sections?: string[]; tags?: string[] } = {
    types: filters.types ? [...filters.types] : undefined,
    sections: filters.sections ? [...filters.sections] : undefined,
    tags: filters.tags ? [...filters.tags] : undefined,
  }

  const visible = dimensions
    .map((dimension) => ({ dimension, counts: facets[dimension] ?? [] }))
    .filter(({ counts }) => counts.length > 0)

  if (visible.length === 0) return null

  return (
    <div className={`${styles.facetList} ${className ?? ""}`}>
      <div className={styles.facetTitle} id={`${baseId}-title`}>
        {title}
      </div>
      {visible.map(({ dimension, counts }) => {
        const key = dimension === "type" ? "types" : dimension === "section" ? "sections" : "tags"
        const active = new Set(currentSelections[key] ?? [])
        return (
          <div
            key={dimension}
            className={styles.facetGroup}
            role="group"
            aria-label={DIMENSION_LABELS[dimension]}
          >
            <div className={styles.facetGroupLabel}>{DIMENSION_LABELS[dimension]}</div>
            <ul className={styles.facetItems}>
              {counts.slice(0, 8).map((facet) => {
                const isActive = active.has(facet.value)
                return (
                  <li key={facet.value}>
                    <button
                      type="button"
                      className={`${styles.facet} ${isActive ? styles.facetActive : ""}`}
                      aria-pressed={isActive}
                      onClick={() =>
                        onFiltersChange({
                          ...filters,
                          ...facetToFilters(dimension, facet.value, currentSelections),
                        })
                      }
                    >
                      <span className={styles.facetValue}>{facet.value}</span>
                      <span className={styles.facetCount}>{facet.count}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
