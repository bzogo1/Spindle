"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Trash2, Users, X } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Segments" screen for `/app/admin/segments`: a list of stored rule
 * segments backed by `GET /api/admin/segments`, a create form posting to the
 * same endpoint, and a per-segment detail panel (match count + sample emails)
 * backed by `GET /api/admin/segments/[id]`. All endpoints are admin-only;
 * the store behind them is the in-memory dev seam in `src/lib/segments.ts`.
 *
 * The rule builder mirrors the server-side field/operator matrix in
 * `src/lib/segments.ts` (`FIELD_OPERATORS`): each field only offers the
 * operators the server accepts, and boolean predicates (`isTrue`/`isFalse`)
 * carry no value.
 */

const SEGMENTS_API = "/api/admin/segments"
const NAME_MAX = 120
const DESCRIPTION_MAX = 500
const MAX_RULES = 20

export interface SegmentRuleRow {
  field: "emailDomain" | "emailVerified" | "createdAfter" | "createdBefore" | "hasSession" | "role"
  operator: "equals" | "notEquals" | "contains" | "isTrue" | "isFalse" | "is"
  value: string
}

export interface SegmentRow {
  id: string
  name: string
  description?: string
  rules: SegmentRuleRow[]
  combinator: "all" | "any"
  createdAt: string
}

interface SegmentDetail {
  segment: SegmentRow
  matchCount: number
  sample: string[]
  evaluatedUsers: number
}

interface ApiResponse {
  ok: boolean
  segments?: SegmentRow[]
  segment?: SegmentRow
  matchCount?: number
  sample?: string[]
  evaluatedUsers?: number
  deleted?: boolean
  message?: string
}

const FIELD_OPTIONS = [
  { value: "emailDomain", label: "Email domain" },
  { value: "emailVerified", label: "Email verified" },
  { value: "createdAfter", label: "Created after" },
  { value: "createdBefore", label: "Created before" },
  { value: "hasSession", label: "Has active session" },
  { value: "role", label: "Role" },
]

const OPERATORS_BY_FIELD: Record<
  SegmentRuleRow["field"],
  { value: SegmentRuleRow["operator"]; label: string }[]
> = {
  emailDomain: [
    { value: "equals", label: "equals" },
    { value: "notEquals", label: "does not equal" },
    { value: "contains", label: "contains" },
  ],
  emailVerified: [
    { value: "isTrue", label: "is true" },
    { value: "isFalse", label: "is false" },
  ],
  createdAfter: [{ value: "is", label: "is after" }],
  createdBefore: [{ value: "is", label: "is before" }],
  hasSession: [
    { value: "isTrue", label: "is true" },
    { value: "isFalse", label: "is false" },
  ],
  role: [
    { value: "equals", label: "equals" },
    { value: "notEquals", label: "does not equal" },
  ],
}

const ROLE_OPTIONS = [
  { value: "admin", label: "admin" },
  { value: "member", label: "member" },
]

const COMBINATOR_OPTIONS = [
  { value: "all", label: "Match ALL rules" },
  { value: "any", label: "Match ANY rule" },
]

interface RuleDraft {
  field: SegmentRuleRow["field"]
  operator: SegmentRuleRow["operator"]
  value: string
}

function emptyRule(): RuleDraft {
  return { field: "emailDomain", operator: "equals", value: "" }
}

function needsValue(rule: RuleDraft): boolean {
  return rule.operator !== "isTrue" && rule.operator !== "isFalse"
}

function isDateField(field: SegmentRuleRow["field"]): boolean {
  return field === "createdAfter" || field === "createdBefore"
}

/** `datetime-local` input value → ISO string, or null when empty/invalid. */
function toIso(local: string): string | null {
  if (!local) return null
  const time = new Date(local).getTime()
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function ruleSummary(rule: SegmentRuleRow): string {
  const field = FIELD_OPTIONS.find((option) => option.value === rule.field)?.label ?? rule.field
  const operator =
    OPERATORS_BY_FIELD[rule.field].find((option) => option.value === rule.operator)?.label ??
    rule.operator
  if (rule.operator === "isTrue" || rule.operator === "isFalse") {
    return `${field} ${operator}`
  }
  const display = isDateField(rule.field) ? formatDateTime(rule.value) : rule.value
  return `${field} ${operator} ${display}`
}

export function SegmentsScreen() {
  const [segments, setSegments] = useState<SegmentRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [combinator, setCombinator] = useState<"all" | "any">("all")
  const [rules, setRules] = useState<RuleDraft[]>([emptyRule()])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNotice, setCreateNotice] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SegmentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    const current = ++seq.current
    setSegments(null)
    setListError(null)
    try {
      const response = await fetch(SEGMENTS_API, { cache: "no-store" })
      const data = (await response.json()) as ApiResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load segments.")
        setSegments([])
        return
      }
      setSegments(data.segments ?? [])
    } catch {
      if (current !== seq.current) return
      setListError("Could not load segments. Check your connection and try again.")
      setSegments([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const response = await fetch(`${SEGMENTS_API}/${id}`, { cache: "no-store" })
      const data = (await response.json()) as ApiResponse
      if (!response.ok || !data.ok || !data.segment) {
        setDetailError(data.message ?? "Could not load segment matches.")
        return
      }
      setDetail({
        segment: data.segment,
        matchCount: data.matchCount ?? 0,
        sample: data.sample ?? [],
        evaluatedUsers: data.evaluatedUsers ?? 0,
      })
    } catch {
      setDetailError("Could not load segment matches. Check your connection and try again.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const selectSegment = useCallback(
    (id: string) => {
      setSelectedId(id)
      void loadDetail(id)
    },
    [loadDetail],
  )

  const updateRule = useCallback((index: number, patch: Partial<RuleDraft>) => {
    setRules((current) =>
      current.map((rule, i) => {
        if (i !== index) return rule
        const next = { ...rule, ...patch }
        // Keep operator/value consistent with the field: switching fields
        // resets to the field's first operator and clears the value.
        if (patch.field && patch.field !== rule.field) {
          next.operator = OPERATORS_BY_FIELD[patch.field][0].value
          next.value = ""
        }
        return next
      }),
    )
  }, [])

  const removeRule = useCallback((index: number) => {
    setRules((current) => current.filter((_, i) => i !== index))
  }, [])

  const create = useCallback(async () => {
    setCreating(true)
    setCreateError(null)
    setCreateNotice(null)
    try {
      const serializedRules = rules.map((rule) => {
        if (!needsValue(rule)) return { field: rule.field, operator: rule.operator, value: "" }
        if (isDateField(rule.field)) {
          const iso = toIso(rule.value)
          return { field: rule.field, operator: rule.operator, value: iso ?? rule.value }
        }
        return { field: rule.field, operator: rule.operator, value: rule.value.trim() }
      })
      const response = await fetch(SEGMENTS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          combinator,
          rules: serializedRules,
        }),
      })
      const data = (await response.json()) as ApiResponse
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not create the segment.")
        return
      }
      setName("")
      setDescription("")
      setCombinator("all")
      setRules([emptyRule()])
      setCreateNotice("Segment created.")
      setReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not create the segment. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [name, description, combinator, rules])

  const remove = useCallback(async () => {
    if (!selectedId) return
    setDeleting(true)
    setDetailError(null)
    try {
      const response = await fetch(`${SEGMENTS_API}/${selectedId}`, { method: "DELETE" })
      const data = (await response.json()) as ApiResponse
      if (!response.ok || !data.ok) {
        setDetailError(data.message ?? "Could not delete the segment.")
        return
      }
      setSelectedId(null)
      setDetail(null)
      setReloadKey((key) => key + 1)
    } catch {
      setDetailError("Could not delete the segment. Check your connection and try again.")
    } finally {
      setDeleting(false)
    }
  }, [selectedId])

  const rulesValid =
    rules.length > 0 &&
    rules.length <= MAX_RULES &&
    rules.every((rule) => {
      if (!needsValue(rule)) return true
      if (rule.field === "role") return rule.value === "admin" || rule.value === "member"
      if (isDateField(rule.field)) return toIso(rule.value) !== null
      return rule.value.trim().length > 0
    })

  const canSubmit = name.trim().length > 0 && rulesValid && !creating

  const loading = segments === null && listError === null
  const empty = segments !== null && segments.length === 0

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="admin-segments-list-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-segments-list-heading">Saved segments</h2>
            <p>
              Rule-based user groups evaluated against the auth backend. Select a segment to see its
              live match count and a sample of matching emails.
            </p>
          </div>
        </div>

        {listError ? (
          <InlineError
            title="Segments unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{listError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}

        {loading ? (
          <LoadingPanel label="Loading segments" variant="table" />
        ) : empty ? (
          <EmptyState
            icon={<Users aria-hidden="true" />}
            title="No segments yet"
            body="Create your first segment with the form below."
          />
        ) : listError ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Rules</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(segments ?? []).map((segment) => (
                <TableRow key={segment.id}>
                  <TableCell className="font-medium">
                    {segment.name}
                    {segment.description ? (
                      <span className="text-muted-foreground block text-xs font-normal">
                        {segment.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline">
                        {segment.combinator === "all" ? "ALL" : "ANY"} of {segment.rules.length}{" "}
                        rules
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {segment.rules
                          .map(ruleSummary)
                          .join(segment.combinator === "all" ? " AND " : " OR ")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(segment.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant={selectedId === segment.id ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => selectSegment(segment.id)}
                    >
                      Matches
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {selectedId ? (
          <div className="border-t pt-4" aria-live="polite">
            <h3 className="text-sm font-medium">Match details</h3>
            {detailLoading ? (
              <LoadingPanel label="Evaluating segment" variant="table" className="mt-2" />
            ) : detailError ? (
              <InlineError title="Matches unavailable" message={detailError} />
            ) : detail ? (
              <div className="mt-2 flex flex-col gap-3">
                <p className="text-sm">
                  <span className="font-medium">{detail.matchCount}</span> matching user
                  {detail.matchCount === 1 ? "" : "s"} out of {detail.evaluatedUsers} evaluated.
                </p>
                {detail.sample.length > 0 ? (
                  <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
                    {detail.sample.map((email) => (
                      <li key={email}>{email}</li>
                    ))}
                  </ul>
                ) : null}
                <div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={() => void remove()}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    {deleting ? "Deleting…" : "Delete segment"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="app-panel" aria-labelledby="admin-segments-create-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-segments-create-heading">New segment</h2>
            <p>
              Combine up to {MAX_RULES} rules. Rules within a segment are combined with the chosen
              combinator; each rule matches users on the auth backend.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            void create()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="segment-name" className="text-muted-foreground text-xs">
              Name
            </label>
            <Input
              id="segment-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Segment name"
              maxLength={NAME_MAX}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="segment-description" className="text-muted-foreground text-xs">
              Description (optional)
            </label>
            <Textarea
              id="segment-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this segment for?"
              rows={2}
              maxLength={DESCRIPTION_MAX}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-muted-foreground text-xs">Rules</legend>
            {rules.map((rule, index) => {
              const operators = OPERATORS_BY_FIELD[rule.field]
              return (
                <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`segment-rule-field-${index}`}
                      className="text-muted-foreground text-xs"
                    >
                      Field
                    </label>
                    <Select
                      id={`segment-rule-field-${index}`}
                      aria-label={`Rule ${index + 1} field`}
                      options={FIELD_OPTIONS}
                      value={rule.field}
                      onChange={(value) =>
                        updateRule(index, { field: value as RuleDraft["field"] })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`segment-rule-operator-${index}`}
                      className="text-muted-foreground text-xs"
                    >
                      Operator
                    </label>
                    <Select
                      id={`segment-rule-operator-${index}`}
                      aria-label={`Rule ${index + 1} operator`}
                      options={operators}
                      value={rule.operator}
                      onChange={(value) =>
                        updateRule(index, { operator: value as RuleDraft["operator"] })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    {needsValue(rule) ? (
                      <>
                        <label
                          htmlFor={`segment-rule-value-${index}`}
                          className="text-muted-foreground text-xs"
                        >
                          Value
                        </label>
                        {rule.field === "role" ? (
                          <Select
                            id={`segment-rule-value-${index}`}
                            aria-label={`Rule ${index + 1} value`}
                            options={ROLE_OPTIONS}
                            value={rule.value || "member"}
                            onChange={(value) => updateRule(index, { value: String(value) })}
                          />
                        ) : isDateField(rule.field) ? (
                          <Input
                            id={`segment-rule-value-${index}`}
                            type="datetime-local"
                            value={rule.value}
                            onChange={(event) => updateRule(index, { value: event.target.value })}
                            required
                          />
                        ) : (
                          <Input
                            id={`segment-rule-value-${index}`}
                            value={rule.value}
                            onChange={(event) => updateRule(index, { value: event.target.value })}
                            placeholder={rule.field === "emailDomain" ? "example.com" : "value"}
                            required
                          />
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground pb-2 text-xs">—</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove rule ${index + 1}`}
                    disabled={rules.length <= 1}
                    onClick={() => removeRule(index)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              )
            })}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rules.length >= MAX_RULES}
                onClick={() => setRules((current) => [...current, emptyRule()])}
              >
                <Plus aria-hidden="true" className="size-4" />
                Add rule
              </Button>
              <Select
                aria-label="Rule combinator"
                options={COMBINATOR_OPTIONS}
                value={combinator}
                onChange={(value) => setCombinator(value === "any" ? "any" : "all")}
                className="w-44"
              />
            </div>
          </fieldset>

          {createError ? <p className="text-destructive text-sm">{createError}</p> : null}
          {createNotice ? <p className="text-muted-foreground text-sm">{createNotice}</p> : null}
          <div>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              <Plus aria-hidden="true" className="size-4" />
              {creating ? "Creating…" : "Create segment"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
