"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FlaskConical, Play, RotateCcw } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { SkeletonListItem } from "@/components/app/states/skeleton"
import { useToast } from "@/components/ui/toast"
import { ScreenState } from "@/components/app/states/screen-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  api,
  useLabSessions,
  useLabWorkspace,
  type LabSession,
  type LabEnvironment,
  type LabEnvironmentKind,
  type WorkspaceActionResult,
} from "@/lib/api"
import { useNow } from "./agent-run-log-shared"
import {
  SnapshotComparePanel,
  type SnapshotAnnotation,
  type SnapshotComparisonResult,
} from "./lab-snapshot-compare"
import {
  formatDiffRatioPercent,
  snapshotDiffStatusBadgeClass,
  snapshotDiffStatusLabel,
} from "./lab-snapshot-thresholds"
import { SnapshotHistoryPanel } from "./lab-snapshot-history"
import { LabBenchmarkPanel } from "./lab-benchmarks-panel"
import { SnapshotBrowserMatrix } from "./lab-snapshot-browser-matrix"
import { CopyButton } from "./copy-button"
import { formatBytes, formatDateTime, formatRelativeTime } from "./format"
import { formatDurationMs } from "./agent-run-log-utils"
import {
  LAB_BROWSER_REFERENCE_ID,
  LAB_BROWSERS,
  LAB_SNAPSHOT_APPROVALS,
  LAB_SNAPSHOT_BASELINES,
  LAB_SNAPSHOTS,
  LAB_TOOLS,
  labBrowserSnapshot,
  type LabSnapshot,
  type LabSnapshotApprovalStatus,
  type LabTool,
  type LabToolParam,
} from "./lab-mock"
import {
  labSnapshotShareHref,
  parseLabSnapshotShareParams,
  type LabSnapshotShareState,
} from "./lab-snapshot-share"
import {
  labSnapshotBaselineInput,
  labSnapshotDiffFailInput,
  labSnapshotReviewInput,
} from "./lab-notifications"
import { pushAppNotification } from "./notifications-provider"

function Icon({ name, className = "icon icon--xs" }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

function formatLastActive(value: string | null) {
  if (!value) return "Not active yet"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function isIdle(environment: LabEnvironment) {
  if (environment.status !== "running" || !environment.lastActiveAt) return false
  const last = new Date(environment.lastActiveAt).getTime()
  if (Number.isNaN(last)) return false
  return Date.now() - last > 10 * 60 * 1000
}

function EnvironmentPane({ kind }: { kind: LabEnvironmentKind }) {
  if (kind === "rstudio") {
    return (
      <div className="app-lab-pane">
        <div className="app-lab-pane-title">analysis.R — RStudio</div>
        <pre className="app-lab-code">
          {`tidal <- read.csv("data/tidal-2026.csv")
sites <- read_sf("data/sites.geojson")
model <- lm(salinity ~ turbidity + site, data = tidal)
summary(model)
plot(model)`}
        </pre>
        <div className="app-lab-output">
          <strong>Console</strong>
          <span>Coefficients stable. Residual plot looks clean.</span>
        </div>
      </div>
    )
  }

  if (kind === "jupyter") {
    return (
      <div className="app-lab-pane">
        <div className="app-lab-pane-title">analysis.ipynb — JupyterLab</div>
        <div className="app-notebook-cell">
          <span className="app-cell-badge">In [3]</span>
          <code>df = pd.read_csv("data/tidal-2026.csv")</code>
        </div>
        <div className="app-notebook-cell app-notebook-cell--output">
          <span className="app-cell-badge">Out[3]</span>
          <code>shape: (240, 3) · salinity mean 29.8 PSU</code>
        </div>
        <div className="app-notebook-plot" aria-label="Mock matplotlib output">
          <span className="app-plot-line" />
          <span className="app-plot-line app-plot-line--soft" />
          <span className="app-plot-line app-plot-line--dashed" />
        </div>
      </div>
    )
  }

  if (kind === "vscode") {
    return (
      <div className="app-lab-pane app-lab-pane--split">
        <div className="app-lab-files">
          <strong>Explorer</strong>
          <span>data/tidal-2026.csv</span>
          <span>notebooks/analysis.ipynb</span>
          <span>clean_data.py</span>
        </div>
        <div className="app-lab-editor">
          <div className="app-lab-pane-title">clean_data.py</div>
          <pre className="app-lab-code">
            {`def normalize_sites(frame):
    return frame.assign(site=frame.site.str.upper())

clean = normalize_sites(raw)
clean.to_csv("outputs/clean-sites.csv", index=False)`}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="app-lab-pane">
      <div className="app-lab-pane-title">Terminal — zsh</div>
      <pre className="app-lab-code app-lab-terminal">
        {`$ python -m pytest tests/test_cleaning.py -q
..............                                                           [100%]
14 passed in 2.31s

$ ls outputs
recovery-map.png  export_final_v3.csv`}
      </pre>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Lab tools: catalog, parameter forms, run history, snapshots                */
/* -------------------------------------------------------------------------- */

type LabRunStatus = "queued" | "running" | "completed" | "failed"

type LabParamValue = string | number | boolean

interface LabRunLogLine {
  id: string
  level: "info" | "warn" | "error"
  message: string
}

interface LabToolRun {
  id: string
  title: string
  toolId: string | null
  toolName: string | null
  params: Record<string, LabParamValue> | null
  paramsSummary: string
  status: LabRunStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  log: LabRunLogLine[]
  output: string | null
  /** Set once `api.lab.createLabSession` resolves, to dedupe the session list. */
  apiSessionId?: string
  /** Title sent to `createLabSession`, used to dedupe before the id arrives. */
  apiTitle?: string
}

function runStatusBadgeClass(status: LabRunStatus) {
  if (status === "completed") return "is-succeeded"
  return `is-${status}`
}

function runStatusLabel(status: LabRunStatus) {
  return status === "completed" ? "completed" : status
}

function isActiveLabRun(status: LabRunStatus) {
  return status === "queued" || status === "running"
}

function defaultParamValues(tool: LabTool): Record<string, LabParamValue> {
  const values: Record<string, LabParamValue> = {}
  for (const param of tool.params) {
    if (param.defaultValue !== undefined) values[param.key] = param.defaultValue
  }
  return values
}

function paramLabel(param: LabToolParam, value: LabParamValue | undefined) {
  if (param.kind === "checkbox") return value === true ? "yes" : "no"
  if (param.kind === "select" && typeof value === "string") {
    return param.options?.find((option) => option.value === value)?.label ?? value
  }
  if (value === undefined || value === "") return "—"
  return String(value)
}

function paramsSummary(tool: LabTool, values: Record<string, LabParamValue>) {
  const parts = tool.params
    .map((param) => {
      const value = values[param.key]
      if (
        (param.kind === "text" || param.kind === "textarea") &&
        (value === undefined || value === "")
      ) {
        return null
      }
      return `${param.label}: ${paramLabel(param, value)}`
    })
    .filter((part): part is string => part !== null)
  return parts.join(" · ")
}

function validateParams(
  tool: LabTool,
  values: Record<string, LabParamValue>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const param of tool.params) {
    const value = values[param.key]
    if (param.required && (value === undefined || value === "")) {
      errors[param.key] = `${param.label} is required.`
      continue
    }
    if (param.kind === "number" || param.kind === "slider") {
      const numeric = typeof value === "number" ? value : Number(value)
      if (value !== undefined && value !== "" && Number.isNaN(numeric)) {
        errors[param.key] = `${param.label} must be a number.`
      } else if (!Number.isNaN(numeric)) {
        if (param.min !== undefined && numeric < param.min) {
          errors[param.key] = `${param.label} must be at least ${param.min}.`
        } else if (param.max !== undefined && numeric > param.max) {
          errors[param.key] = `${param.label} must be at most ${param.max}.`
        }
      }
    }
  }
  return errors
}

function sessionToRun(session: LabSession): LabToolRun {
  const level = session.status === "failed" ? "error" : "info"
  const message =
    session.status === "queued"
      ? "Session queued."
      : session.status === "running"
        ? "Session running in the selected environment."
        : session.status === "completed"
          ? "Session completed."
          : "Session failed — see the environment pane for details."
  return {
    id: session.id,
    title: session.title,
    toolId: null,
    toolName: null,
    params: null,
    paramsSummary: "Parameters were not recorded for this session.",
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.createdAt,
    finishedAt: session.endedAt ?? null,
    log: [{ id: `${session.id}-log-1`, level, message }],
    output: null,
  }
}

function runDurationMs(run: LabToolRun, now = Date.now()) {
  if (!run.startedAt) return null
  const start = new Date(run.startedAt).getTime()
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.max(0, end - start)
}

function ToolParamField({
  param,
  value,
  error,
  onChange,
}: {
  param: LabToolParam
  value: LabParamValue | undefined
  error?: string
  onChange: (value: LabParamValue) => void
}) {
  const fieldId = `lab-param-${param.key}`
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`

  let control: React.ReactNode
  if (param.kind === "checkbox") {
    control = (
      <div className="app-lab-check">
        <Checkbox
          id={fieldId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : param.help ? hintId : undefined}
        />
        <Label htmlFor={fieldId} className="app-lab-check-label">
          {param.label}
        </Label>
      </div>
    )
  } else if (param.kind === "select") {
    control = (
      <Select
        id={fieldId}
        options={(param.options ?? []).map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={typeof value === "string" ? value : null}
        onChange={(next) => onChange(typeof next === "string" ? next : "")}
        invalid={Boolean(error)}
        aria-describedby={error ? errorId : param.help ? hintId : undefined}
      />
    )
  } else if (param.kind === "slider") {
    control = (
      <div className="app-lab-slider">
        <Slider
          value={typeof value === "number" ? value : (param.min ?? 0)}
          onValueChange={(next) => onChange(typeof next === "number" ? next : (next[0] ?? 0))}
          min={param.min ?? 0}
          max={param.max ?? 100}
          step={param.step ?? 1}
          showTooltip
          aria-label={param.label}
        />
        <span className="app-lab-slider-value">{String(value ?? param.min ?? 0)}</span>
      </div>
    )
  } else if (param.kind === "textarea") {
    control = (
      <Textarea
        id={fieldId}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={param.placeholder}
        rows={3}
        aria-required={param.required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : param.help ? hintId : undefined}
      />
    )
  } else {
    control = (
      <Input
        id={fieldId}
        type={param.kind === "number" ? "number" : "text"}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(event) =>
          onChange(param.kind === "number" ? event.target.valueAsNumber : event.target.value)
        }
        placeholder={param.placeholder}
        min={param.min}
        max={param.max}
        step={param.step}
        aria-required={param.required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : param.help ? hintId : undefined}
      />
    )
  }

  if (param.kind === "checkbox") {
    return (
      <div className="app-field">
        {control}
        {param.help ? (
          <p className="app-field-hint" id={hintId}>
            {param.help}
          </p>
        ) : null}
        {error ? (
          <p className="app-field-error" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="app-field">
      <label htmlFor={fieldId}>
        {param.label}
        {param.required ? " *" : ""}
      </label>
      {control}
      {param.help && !error ? (
        <p className="app-field-hint" id={hintId}>
          {param.help}
        </p>
      ) : null}
      {error ? (
        <p className="app-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function RunHistoryPanel({
  runs,
  loading,
  error,
  onRetry,
  selectedRunId,
  onSelect,
}: {
  runs: LabToolRun[]
  loading: boolean
  error: string | null
  onRetry: () => void
  selectedRunId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="app-panel" aria-labelledby="lab-runs-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="lab-runs-heading">Run history</h2>
          <p>Tool runs and lab sessions for this project, newest first.</p>
        </div>
      </div>

      {error ? (
        <InlineError
          title={null}
          message={error}
          action={
            <button type="button" className="fm-btn" onClick={onRetry}>
              Retry
            </button>
          }
        />
      ) : loading ? (
        <div className="app-lab-run-list" role="status" aria-label="Loading runs">
          {[0, 1, 2].map((index) => (
            <SkeletonListItem key={index} />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<FlaskConical aria-hidden="true" />}
          title="No runs yet"
          body="Pick a tool above, fill in its parameters, and run it to see results here."
          className="border-0 bg-transparent"
        />
      ) : (
        <ul className="app-lab-run-list">
          {runs.map((run) => {
            const selected = run.id === selectedRunId
            const duration = runDurationMs(run)
            return (
              <li key={run.id}>
                <button
                  type="button"
                  className={`app-lab-run-row${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(run.id)}
                >
                  <span className="app-lab-run-main">
                    <strong>{run.title}</strong>
                    <span className="app-lab-run-meta">
                      {formatRelativeTime(run.createdAt)} · {run.paramsSummary}
                    </span>
                  </span>
                  <span className="app-lab-run-side">
                    <span className={`app-badge ${runStatusBadgeClass(run.status)}`}>
                      {runStatusLabel(run.status)}
                    </span>
                    <span className="app-lab-run-duration">
                      {duration === null ? "—" : formatDurationMs(duration)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RunDetailPanel({ run, tool }: { run: LabToolRun | null; tool: LabTool | null }) {
  const now = useNow(run && isActiveLabRun(run.status) ? 1000 : 60_000)

  if (!run) {
    return (
      <section className="app-panel" aria-labelledby="lab-run-detail-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="lab-run-detail-heading">Run detail</h2>
            <p>Select a run from the history to inspect its log and output.</p>
          </div>
        </div>
        <EmptyState
          icon={<FlaskConical aria-hidden="true" />}
          title="No run selected"
          body="Run logs, parameters, and outputs appear here once a run is selected."
          className="border-0 bg-transparent"
        />
      </section>
    )
  }

  const duration = runDurationMs(run, now)
  const paramEntries =
    run.params && tool
      ? tool.params.map((param) => ({
          label: param.label,
          value: paramLabel(param, run.params?.[param.key]),
        }))
      : null

  return (
    <section className="app-panel" aria-labelledby="lab-run-detail-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="lab-run-detail-heading">{run.title}</h2>
          <p>
            {run.toolName ? `${run.toolName} · ` : ""}
            {formatDateTime(run.createdAt)}
          </p>
        </div>
        <span className={`app-badge ${runStatusBadgeClass(run.status)}`}>
          {runStatusLabel(run.status)}
        </span>
      </div>

      <dl className="app-lab-detail-meta">
        <div>
          <dt>Status</dt>
          <dd>{runStatusLabel(run.status)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{duration === null ? "—" : formatDurationMs(duration)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{run.startedAt ? formatDateTime(run.startedAt) : "—"}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</dd>
        </div>
      </dl>

      <div className="app-lab-detail-block">
        <h3>Parameters</h3>
        {paramEntries ? (
          <dl className="app-lab-params">
            {paramEntries.map((entry) => (
              <div key={entry.label} className="app-lab-params-row">
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="app-field-hint">{run.paramsSummary}</p>
        )}
      </div>

      <div className="app-lab-detail-block">
        <h3>Log</h3>
        <ul className="app-lab-log">
          {run.log.map((line) => (
            <li key={line.id} className={`app-lab-log-line is-${line.level}`}>
              {line.message}
            </li>
          ))}
        </ul>
      </div>

      {run.output ? (
        <div className="app-lab-detail-block">
          <h3>Output</h3>
          <pre className="app-lab-code">{run.output}</pre>
        </div>
      ) : null}
    </section>
  )
}

type SnapshotStatusFilter = "all" | LabSnapshotApprovalStatus

const SNAPSHOT_STATUS_FILTERS: { value: SnapshotStatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

function snapshotApprovalBadgeClass(status: LabSnapshotApprovalStatus) {
  return `is-${status}`
}

function snapshotApprovalLabel(status: LabSnapshotApprovalStatus) {
  if (status === "pending") return "Pending"
  return status === "approved" ? "Approved" : "Rejected"
}

/**
 * Map share-link params onto a compare selection. `?compare=A,B` opens that
 * pair directly; `?snapshot=<id>` opens the capture's comparison view —
 * against its environment baseline when one is set, otherwise as a lone
 * selection awaiting a second pick. Returns `null` when there is nothing to
 * apply.
 */
function resolveShareCompareIds(
  share: LabSnapshotShareState,
  baselineByEnvironment: Record<string, string>,
): string[] | null {
  if (share.compare) return [...share.compare]
  if (!share.snapshot) return null
  const snapshot = LAB_SNAPSHOTS.find((candidate) => candidate.id === share.snapshot)
  if (!snapshot) return null
  const baselineId = baselineByEnvironment[snapshot.environment]
  const baseline = LAB_SNAPSHOTS.find((candidate) => candidate.id === baselineId)
  if (baseline && baseline.id !== snapshot.id) return [baseline.id, snapshot.id]
  return [snapshot.id]
}

function SnapshotsPanel({
  projectId,
  restoredIds,
  onRestore,
}: {
  projectId: string
  restoredIds: Set<string>
  onRestore: (snapshot: LabSnapshot) => void
}) {
  const { toast } = useToast()
  // Shareable links (`?snapshot=`/`?compare=`) seed the comparison selection;
  // `useSearchParams` suspends to the route's Suspense boundary during
  // prerender, same as the dashboard share params.
  const searchParams = useSearchParams()
  const shareQuery = searchParams.toString()
  const shareParams = useMemo(
    () => parseLabSnapshotShareParams(new URLSearchParams(shareQuery)),
    [shareQuery],
  )
  // Reference snapshot per environment label, seeded from the mock catalog.
  // "Set baseline" swaps the entry, so switching baselines is client-side
  // state until a real snapshot backend exists.
  const [baselineByEnvironment, setBaselineByEnvironment] = useState<Record<string, string>>(
    () => ({ ...LAB_SNAPSHOT_BASELINES }),
  )
  // Up to two snapshots can be selected for side-by-side comparison; picking
  // a third replaces the oldest selection. Share params preselect the pair.
  const [compareIds, setCompareIds] = useState<string[]>(
    () => resolveShareCompareIds(shareParams, baselineByEnvironment) ?? [],
  )
  // Review notes pinned to a comparison, keyed by the ordered snapshot pair
  // ("A" vs "B") so they survive closing and reopening the compare panel.
  // Swapping A/B selects a different pair and starts with a fresh list.
  const [annotationsByPair, setAnnotationsByPair] = useState<Record<string, SnapshotAnnotation[]>>(
    {},
  )
  // Review status per snapshot, seeded from the mock catalog. Approve/Reject
  // flip entries here until a real snapshot backend exists.
  const [approvalById, setApprovalById] = useState<Record<string, LabSnapshotApprovalStatus>>(
    () => ({
      ...LAB_SNAPSHOT_APPROVALS,
    }),
  )
  const [statusFilter, setStatusFilter] = useState<SnapshotStatusFilter>("all")
  // Latest pixel-diff outcome per snapshot (keyed by the "B"/actual capture),
  // reported by SnapshotComparePanel — badges each capture with its status.
  const [diffResults, setDiffResults] = useState<Record<string, SnapshotComparisonResult>>({})
  // Last reported diff status per ordered pair ("A:B"), so the fail
  // notification fires on the transition into "fail" — not on every
  // re-report (threshold edits recompute the status for the same ratio).
  const lastDiffStatusByPair = useRef(new Map<string, SnapshotComparisonResult["status"]>())
  // Cross-browser test run: the source snapshot plus the per-browser captures
  // derived from it. Captures live outside `LAB_SNAPSHOTS`, so the compare
  // lookups below merge them in via `snapshotById`.
  const [browserTest, setBrowserTest] = useState<{
    source: LabSnapshot
    captures: LabSnapshot[]
  } | null>(null)
  // Re-apply share params when the query changes (client-side navigation);
  // the mount-time seed is the `compareIds` initializer above. Guarded so
  // baseline edits don't clobber the user's picks.
  const appliedShareQuery = useRef(shareQuery)
  useEffect(() => {
    if (appliedShareQuery.current === shareQuery) return
    appliedShareQuery.current = shareQuery
    const ids = resolveShareCompareIds(shareParams, baselineByEnvironment)
    if (ids) setCompareIds(ids)
  }, [shareQuery, shareParams, baselineByEnvironment])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((previous) => {
      if (previous.includes(id)) return previous.filter((candidate) => candidate !== id)
      const next = [...previous, id]
      return next.slice(Math.max(0, next.length - 2))
    })
  }, [])

  const baselineSnapshotFor = useCallback(
    (snapshot: LabSnapshot) => {
      const id = baselineByEnvironment[snapshot.environment]
      return LAB_SNAPSHOTS.find((candidate) => candidate.id === id) ?? null
    },
    [baselineByEnvironment],
  )

  const baselineIds = useMemo(
    () => new Set(Object.values(baselineByEnvironment)),
    [baselineByEnvironment],
  )

  const handleSetBaseline = useCallback(
    (snapshot: LabSnapshot) => {
      setBaselineByEnvironment((previous) => ({
        ...previous,
        [snapshot.environment]: snapshot.id,
      }))
      toast({
        variant: "success",
        title: "Baseline updated",
        description: `${snapshot.name} is now the ${snapshot.environment} baseline (mock).`,
      })
      pushAppNotification(labSnapshotBaselineInput(snapshot, projectId))
    },
    [projectId, toast],
  )

  const handleCompareToBaseline = useCallback(
    (snapshot: LabSnapshot) => {
      const baseline = baselineSnapshotFor(snapshot)
      if (!baseline || baseline.id === snapshot.id) return
      // Baseline always takes the "A" (reference) slot.
      setCompareIds([baseline.id, snapshot.id])
    },
    [baselineSnapshotFor],
  )

  // Seeded catalog plus any generated cross-browser captures, so the compare
  // selection can hold ids that are not in `LAB_SNAPSHOTS`.
  const snapshotById = useMemo(() => {
    const map = new Map<string, LabSnapshot>(LAB_SNAPSHOTS.map((s) => [s.id, s]))
    for (const capture of browserTest?.captures ?? []) map.set(capture.id, capture)
    return map
  }, [browserTest])

  const compareBase = compareIds[0] ? (snapshotById.get(compareIds[0]) ?? null) : null
  const compareOther = compareIds[1] ? (snapshotById.get(compareIds[1]) ?? null) : null
  const comparePairKey = compareBase && compareOther ? `${compareBase.id}:${compareOther.id}` : null

  const handleAddAnnotation = useCallback(
    (annotation: SnapshotAnnotation) => {
      if (!comparePairKey) return
      setAnnotationsByPair((previous) => ({
        ...previous,
        [comparePairKey]: [...(previous[comparePairKey] ?? []), annotation],
      }))
    },
    [comparePairKey],
  )

  const handleRemoveAnnotation = useCallback(
    (id: string) => {
      if (!comparePairKey) return
      setAnnotationsByPair((previous) => ({
        ...previous,
        [comparePairKey]: (previous[comparePairKey] ?? []).filter(
          (annotation) => annotation.id !== id,
        ),
      }))
    },
    [comparePairKey],
  )

  const handleDiffResult = useCallback(
    (result: SnapshotComparisonResult) => {
      setDiffResults((previous) => ({ ...previous, [result.otherId]: result }))
      const pairKey = `${result.baseId}:${result.otherId}`
      const previousStatus = lastDiffStatusByPair.current.get(pairKey)
      lastDiffStatusByPair.current.set(pairKey, result.status)
      if (result.status !== "fail" || previousStatus === "fail") return
      pushAppNotification(
        labSnapshotDiffFailInput(
          result,
          {
            base: snapshotById.get(result.baseId)?.name ?? result.baseId,
            other: snapshotById.get(result.otherId)?.name ?? result.otherId,
          },
          projectId,
        ),
      )
    },
    [projectId, snapshotById],
  )

  const handleReview = useCallback(
    (snapshot: LabSnapshot, status: "approved" | "rejected") => {
      setApprovalById((previous) => ({ ...previous, [snapshot.id]: status }))
      toast({
        variant: status === "rejected" ? "warning" : "success",
        title: status === "approved" ? "Snapshot approved" : "Snapshot rejected",
        description: `${snapshot.name} marked ${status} (mock).`,
      })
      pushAppNotification(labSnapshotReviewInput(snapshot, status, projectId))
    },
    [projectId, toast],
  )

  const handleBrowserTest = useCallback(
    (snapshot: LabSnapshot) => {
      // Reference browser first so the matrix reads Chromium → others.
      const captures = [...LAB_BROWSERS]
        .sort(
          (a, b) =>
            Number(b.id === LAB_BROWSER_REFERENCE_ID) - Number(a.id === LAB_BROWSER_REFERENCE_ID),
        )
        .map((browser) => labBrowserSnapshot(snapshot, browser))
      setBrowserTest({ source: snapshot, captures })
      toast({
        variant: "success",
        title: "Cross-browser test started",
        description: `${captures.length} browser captures generated for ${snapshot.name} (mock).`,
      })
    },
    [toast],
  )

  const visibleSnapshots = useMemo(
    () =>
      LAB_SNAPSHOTS.filter((snapshot) => {
        const status = approvalById[snapshot.id] ?? "pending"
        return statusFilter === "all" || status === statusFilter
      }),
    [approvalById, statusFilter],
  )

  return (
    <section className="app-panel" aria-labelledby="lab-snapshots-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="lab-snapshots-heading">Snapshots</h2>
          <p>
            Point-in-time workspace captures you can restore into an environment. Each environment
            keeps a baseline snapshot — select two captures, or one capture and its baseline, to
            compare.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Select
            id="lab-snapshot-status-filter"
            aria-label="Filter snapshots by review status"
            options={SNAPSHOT_STATUS_FILTERS}
            value={statusFilter}
            onChange={(next) =>
              setStatusFilter((typeof next === "string" ? next : "all") as SnapshotStatusFilter)
            }
          />
        </div>
      </div>
      {LAB_SNAPSHOTS.length === 0 ? (
        <EmptyState
          icon={<FlaskConical aria-hidden="true" />}
          title="No snapshots"
          body="Snapshots will appear here once environments start capturing state."
          className="border-0 bg-transparent"
        />
      ) : (
        <>
          {visibleSnapshots.length === 0 ? (
            <EmptyState
              icon={<FlaskConical aria-hidden="true" />}
              title="No snapshots match"
              body={`No snapshots have the "${SNAPSHOT_STATUS_FILTERS.find((filter) => filter.value === statusFilter)?.label}" review status.`}
              className="border-0 bg-transparent"
            />
          ) : (
            <ul className="app-lab-snapshot-list">
              {visibleSnapshots.map((snapshot) => {
                const restored = restoredIds.has(snapshot.id)
                const comparing = compareIds.includes(snapshot.id)
                const isBaseline = baselineByEnvironment[snapshot.environment] === snapshot.id
                const baseline = baselineSnapshotFor(snapshot)
                const canCompareBaseline = baseline !== null && baseline.id !== snapshot.id
                const approvalStatus = approvalById[snapshot.id] ?? "pending"
                const diffResult = diffResults[snapshot.id]
                return (
                  <li
                    key={snapshot.id}
                    className={`app-lab-snapshot-row${comparing ? "is-selected" : ""}`}
                  >
                    <div className="app-lab-snapshot-main">
                      <span className="app-lab-snapshot-title">
                        <strong>{snapshot.name}</strong>
                        {isBaseline ? (
                          <span className="app-badge is-baseline">Baseline</span>
                        ) : null}
                        <span className={`app-badge ${snapshotApprovalBadgeClass(approvalStatus)}`}>
                          {snapshotApprovalLabel(approvalStatus)}
                        </span>
                        {diffResult ? (
                          <span
                            className={`app-badge ${snapshotDiffStatusBadgeClass(diffResult.status)}`}
                            title={`Last pixel diff: ${formatDiffRatioPercent(diffResult.diffRatio)} changed`}
                          >
                            {snapshotDiffStatusLabel(diffResult.status)}
                          </span>
                        ) : null}
                      </span>
                      <span className="app-lab-snapshot-meta">
                        {snapshot.environment} · {formatBytes(snapshot.sizeBytes)} ·{" "}
                        {formatDateTime(snapshot.createdAt)}
                      </span>
                      <span className="app-field-hint">{snapshot.description}</span>
                    </div>
                    <div className="app-lab-snapshot-actions">
                      <button
                        type="button"
                        className="fm-btn"
                        aria-pressed={comparing}
                        onClick={() => toggleCompare(snapshot.id)}
                      >
                        Compare
                      </button>
                      <button
                        type="button"
                        className="fm-btn"
                        disabled={!canCompareBaseline}
                        onClick={() => handleCompareToBaseline(snapshot)}
                      >
                        Compare to baseline
                      </button>
                      <button
                        type="button"
                        className="fm-btn"
                        disabled={isBaseline}
                        onClick={() => handleSetBaseline(snapshot)}
                      >
                        Set baseline
                      </button>
                      <button
                        type="button"
                        className="fm-btn"
                        disabled={approvalStatus === "approved"}
                        onClick={() => handleReview(snapshot, "approved")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="fm-btn"
                        disabled={approvalStatus === "rejected"}
                        onClick={() => handleReview(snapshot, "rejected")}
                      >
                        Reject
                      </button>
                      <CopyButton
                        // Evaluated lazily on click so `window` is only touched
                        // in the browser; preserves unrelated query params.
                        text={() =>
                          labSnapshotShareHref(
                            { snapshot: snapshot.id },
                            window.location.pathname,
                            window.location.search,
                          )
                        }
                        label="Share"
                      />
                      <button
                        type="button"
                        className="fm-btn"
                        onClick={() => handleBrowserTest(snapshot)}
                      >
                        Test across browsers
                      </button>
                      <button
                        type="button"
                        className="fm-btn"
                        disabled={restored}
                        onClick={() => onRestore(snapshot)}
                      >
                        <RotateCcw aria-hidden="true" className="size-3.5" />
                        {restored ? "Restored" : "Restore"}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {compareIds.length === 1 ? (
            <p className="app-field-hint app-lab-compare-hint" role="status">
              {snapshotById.get(compareIds[0])?.name} selected — pick one more snapshot to compare.
            </p>
          ) : null}
          {compareBase && compareOther ? (
            <SnapshotComparePanel
              base={compareBase}
              other={compareOther}
              baselineIds={baselineIds}
              headerActions={
                <CopyButton
                  // Copies `?compare=A,B` — the ordered pair shown below.
                  text={() =>
                    labSnapshotShareHref(
                      { compare: [compareBase.id, compareOther.id] },
                      window.location.pathname,
                      window.location.search,
                    )
                  }
                  label="Copy link"
                />
              }
              annotations={comparePairKey ? (annotationsByPair[comparePairKey] ?? []) : []}
              onAddAnnotation={handleAddAnnotation}
              onRemoveAnnotation={handleRemoveAnnotation}
              onDiffResult={handleDiffResult}
              onSwap={() => setCompareIds([compareOther.id, compareBase.id])}
              onClose={() => setCompareIds([])}
            />
          ) : null}
          {browserTest ? (
            <SnapshotBrowserMatrix
              source={browserTest.source}
              captures={browserTest.captures}
              onComparePair={(base, other) => setCompareIds([base.id, other.id])}
              onClose={() => setBrowserTest(null)}
            />
          ) : null}
          {visibleSnapshots.length > 0 ? (
            <>
              <SnapshotHistoryPanel
                snapshots={visibleSnapshots}
                baselineIds={baselineIds}
                approvalById={approvalById}
                diffResults={diffResults}
                restoredIds={restoredIds}
                onComparePair={(base, other) => setCompareIds([base.id, other.id])}
                onRestore={onRestore}
              />
              <LabBenchmarkPanel snapshots={visibleSnapshots} />
            </>
          ) : null}
        </>
      )}
    </section>
  )
}

export function LabScreen({ projectId }: { projectId: string }) {
  const lab = useLabWorkspace(projectId)
  const { data, actions } = lab
  const { toast } = useToast()
  const sessions = useLabSessions(projectId)

  const environments = data.environments
  const active = useMemo(
    () =>
      environments.find((environment) => environment.id === data.activeEnvironmentId) ??
      environments[0] ??
      null,
    [environments, data.activeEnvironmentId],
  )
  const idle = active ? isIdle(active) : false

  const act = async (action: () => Promise<WorkspaceActionResult>) => {
    const result = await action()
    if (!result.ok) toast({ variant: "error", title: result.error })
  }

  /* ---- Tool runner state ---- */

  const [selectedToolId, setSelectedToolId] = useState(LAB_TOOLS[0]?.id ?? "")
  const selectedTool = LAB_TOOLS.find((tool) => tool.id === selectedToolId) ?? LAB_TOOLS[0] ?? null
  const [paramValues, setParamValues] = useState<Record<string, LabParamValue>>(() =>
    selectedTool ? defaultParamValues(selectedTool) : {},
  )
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<LabToolRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [restoredSnapshotIds, setRestoredSnapshotIds] = useState<Set<string>>(new Set())
  const runSeq = useRef(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer)
    }
  }, [])

  const selectTool = useCallback((toolId: string) => {
    setSelectedToolId(toolId)
    const tool = LAB_TOOLS.find((candidate) => candidate.id === toolId)
    setParamValues(tool ? defaultParamValues(tool) : {})
    setParamErrors({})
  }, [])

  const setParamValue = useCallback((key: string, value: LabParamValue) => {
    setParamValues((previous) => ({ ...previous, [key]: value }))
    setParamErrors((previous) => {
      if (!previous[key]) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }, [])

  const patchRun = useCallback((id: string, patch: Partial<LabToolRun>) => {
    setRuns((previous) => previous.map((run) => (run.id === id ? { ...run, ...patch } : run)))
  }, [])

  const appendLog = useCallback((id: string, line: Omit<LabRunLogLine, "id">) => {
    setRuns((previous) =>
      previous.map((run) =>
        run.id === id
          ? {
              ...run,
              log: [...run.log, { ...line, id: `${id}-log-${run.log.length + 1}` }],
            }
          : run,
      ),
    )
  }, [])

  const handleRun = useCallback(() => {
    if (!selectedTool) return
    const errors = validateParams(selectedTool, paramValues)
    if (Object.keys(errors).length > 0) {
      setParamErrors(errors)
      return
    }

    const id = `tool-run-${++runSeq.current}`
    const now = new Date().toISOString()
    const summary = paramsSummary(selectedTool, paramValues)
    const apiTitle = `${selectedTool.name} — ${summary}`
    const simulatedFailure = paramValues.simulateFailure === true
    const run: LabToolRun = {
      id,
      title: `${selectedTool.name} run`,
      toolId: selectedTool.id,
      toolName: selectedTool.name,
      params: { ...paramValues },
      paramsSummary: summary,
      status: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      log: [{ id: `${id}-log-1`, level: "info", message: `Run queued for ${selectedTool.name}.` }],
      output: null,
      apiTitle,
    }
    setRuns((previous) => [run, ...previous])
    setSelectedRunId(id)
    setParamErrors({})

    // Register the run with the sessions API so it shows up for other clients;
    // the richer params/log stay client-side until the API supports them.
    api.lab
      .createLabSession({ title: apiTitle, projectId })
      .then((session) => patchRun(id, { apiSessionId: session.id }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not register the run."
        patchRun(id, { status: "failed", finishedAt: new Date().toISOString() })
        appendLog(id, { level: "error", message: `Session registration failed: ${message}` })
        toast({ variant: "error", title: "Run registration failed", description: message })
      })

    timers.current.push(
      window.setTimeout(() => {
        patchRun(id, { status: "running", startedAt: new Date().toISOString() })
        appendLog(id, {
          level: "info",
          message: `Started ${selectedTool.name} with ${summary}.`,
        })
      }, 600),
    )
    timers.current.push(
      window.setTimeout(() => {
        const finishedAt = new Date().toISOString()
        if (simulatedFailure) {
          patchRun(id, { status: "failed", finishedAt })
          appendLog(id, { level: "error", message: "Run failed: simulated failure requested." })
          toast({
            variant: "error",
            title: `${selectedTool.name} failed`,
            description: "The run ended in a failed state (simulated).",
          })
        } else {
          patchRun(id, {
            status: "completed",
            finishedAt,
            output: `outputs/${selectedTool.id}-${id}.csv\n\nRows processed: 1,284\nWarnings: 3\nElapsed: mock run`,
          })
          appendLog(id, { level: "info", message: "Run completed successfully." })
          toast({
            variant: "success",
            title: `${selectedTool.name} completed`,
            description: summary,
          })
        }
      }, 2400),
    )
  }, [appendLog, paramValues, patchRun, projectId, selectedTool, toast])

  const handleRestoreSnapshot = useCallback(
    (snapshot: LabSnapshot) => {
      setRestoredSnapshotIds((previous) => new Set(previous).add(snapshot.id))
      toast({
        variant: "success",
        title: "Snapshot restored",
        description: `${snapshot.name} restored into ${snapshot.environment} (mock).`,
      })
    },
    [toast],
  )

  /* Merge locally-created runs with sessions reported by the API. */

  const displayRuns = useMemo(() => {
    const claimedIds = new Set(
      runs.map((run) => run.apiSessionId).filter((value): value is string => Boolean(value)),
    )
    const claimedTitles = new Set(runs.map((run) => run.apiTitle).filter(Boolean))
    const sessionRuns = (sessions.data ?? [])
      .filter((session) => !claimedIds.has(session.id) && !claimedTitles.has(session.title))
      .map(sessionToRun)
    return [...runs, ...sessionRuns].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [runs, sessions.data])

  const selectedRun = displayRuns.find((run) => run.id === selectedRunId) ?? null
  const selectedRunTool = selectedRun?.toolId
    ? (LAB_TOOLS.find((tool) => tool.id === selectedRun.toolId) ?? null)
    : null

  const sessionsError = sessions.error
    ? `${sessions.error.message} Run history may be incomplete.`
    : null

  return (
    <ScreenState
      screen="lab"
      status={lab.status}
      error={lab.error}
      isEmpty={lab.isEmpty}
      isRetrying={lab.isRetrying}
      onRetry={lab.refetch}
    >
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Lab</h1>
            <p className="app-page-subtitle">
              Mock compute environments for {data.project.name} (project {projectId}). Sessions
              never leave the browser.
            </p>
          </div>
          <div className="app-page-actions">
            {active ? (
              <>
                <button
                  type="button"
                  className="fm-btn"
                  disabled={active.status !== "stopped"}
                  onClick={() => void act(() => actions.startSession(active.id))}
                >
                  Start session
                </button>
                <button
                  type="button"
                  className="fm-btn fm-btn--danger"
                  disabled={active.status === "stopped"}
                  onClick={() => void act(() => actions.stopSession(active.id))}
                >
                  Stop session
                </button>
                <button
                  type="button"
                  className="fm-btn"
                  disabled={active.status !== "running"}
                  onClick={() => void act(() => actions.pingSession(active.id))}
                >
                  Ping
                </button>
              </>
            ) : null}
          </div>
        </div>

        {idle ? (
          <div className="app-alert app-alert--warning" role="status">
            <Icon name="i-clock" />
            <span>
              {active?.name} has been idle for a while. Ping it to keep the mock session warm, or
              stop it to free quota.
            </span>
          </div>
        ) : null}

        {environments.length === 0 ? (
          <EmptyState
            icon={<FlaskConical aria-hidden="true" />}
            title="No lab environments"
            body="The mock store did not seed any environments for this project."
          />
        ) : (
          <>
            <div
              className="app-lab-tabs"
              role="tablist"
              aria-label="Lab environments"
              onKeyDown={(event) => {
                if (
                  event.key !== "ArrowRight" &&
                  event.key !== "ArrowLeft" &&
                  event.key !== "Home" &&
                  event.key !== "End"
                ) {
                  return
                }
                const tabs = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                )
                const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
                if (index === -1 || tabs.length === 0) return
                event.preventDefault()
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
                tabs[next].focus()
                tabs[next].click()
              }}
            >
              {environments.map((environment) => {
                const selected = environment.id === active?.id
                return (
                  <button
                    key={environment.id}
                    type="button"
                    role="tab"
                    id={`lab-tab-${environment.id}`}
                    aria-selected={selected}
                    aria-controls="lab-panel"
                    className={`app-lab-tab${selected ? "is-active" : ""}`}
                    onClick={() => {
                      void actions.selectEnvironment(environment.id).then((result) => {
                        if (!result.ok) toast({ variant: "error", title: result.error })
                      })
                    }}
                  >
                    <span
                      className={`app-status-dot is-${environment.status}`}
                      aria-hidden="true"
                    />
                    {environment.name}
                    <span className="app-lab-tab-status">
                      {environment.status === "running"
                        ? "Running"
                        : environment.status === "starting"
                          ? "Starting"
                          : "Stopped"}
                    </span>
                  </button>
                )
              })}
            </div>

            {active ? (
              <section
                className="app-lab-panel"
                role="tabpanel"
                id="lab-panel"
                aria-labelledby={`lab-tab-${active.id}`}
              >
                <div className="app-lab-meta">
                  <div>
                    <strong>{active.title}</strong>
                    <span>{active.statusLabel}</span>
                  </div>
                  <div className="app-lab-meta-side">
                    <span>Last active: {formatLastActive(active.lastActiveAt)}</span>
                    <span className={`app-badge is-${active.status}`}>
                      {active.status === "running"
                        ? "Running"
                        : active.status === "starting"
                          ? "Starting"
                          : "Stopped"}
                    </span>
                  </div>
                </div>
                {active.status === "stopped" ? (
                  <EmptyState
                    icon={<FlaskConical aria-hidden="true" />}
                    title={`${active.name} is stopped`}
                    body="Start the mock session to inspect the static notebook, plot, or terminal pane."
                    primaryAction={{
                      label: "Start session",
                      onClick: () => void act(() => actions.startSession(active.id)),
                    }}
                    className="border-0 bg-transparent"
                  />
                ) : (
                  <EnvironmentPane kind={active.kind} />
                )}
              </section>
            ) : null}
          </>
        )}

        {/* ---- Tool grid ---- */}

        <section className="app-panel" aria-labelledby="lab-tools-heading">
          <div className="app-panel-head">
            <div>
              <h2 id="lab-tools-heading">Lab tools</h2>
              <p>Pick a tool to configure its parameters and queue a mock run.</p>
            </div>
          </div>
          {LAB_TOOLS.length === 0 ? (
            <EmptyState
              icon={<FlaskConical aria-hidden="true" />}
              title="No tools available"
              body="The tool catalog is empty for this workspace."
              className="border-0 bg-transparent"
            />
          ) : (
            <div className="app-lab-tools">
              {LAB_TOOLS.map((tool) => {
                const ToolIcon = tool.icon
                const selected = tool.id === selectedTool?.id
                return (
                  <button
                    key={tool.id}
                    type="button"
                    aria-pressed={selected}
                    className={`app-lab-tool-card${selected ? "is-selected" : ""}`}
                    onClick={() => selectTool(tool.id)}
                  >
                    <span className="app-lab-tool-icon" aria-hidden="true">
                      <ToolIcon className="size-4" />
                    </span>
                    <span className="app-lab-tool-text">
                      <strong>{tool.name}</strong>
                      <span>{tool.description}</span>
                    </span>
                    <span className="app-lab-tool-count">
                      {tool.params.length} {tool.params.length === 1 ? "param" : "params"}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* ---- Parameter form + run history + detail ---- */}

        {selectedTool ? (
          <div className="app-lab-cols">
            <section className="app-panel" aria-labelledby="lab-run-tool-heading">
              <div className="app-panel-head">
                <div>
                  <h2 id="lab-run-tool-heading">Run {selectedTool.name}</h2>
                  <p>{selectedTool.description}</p>
                </div>
              </div>
              <form
                className="app-lab-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  handleRun()
                }}
              >
                {selectedTool.params.map((param) => (
                  <ToolParamField
                    key={param.key}
                    param={param}
                    value={paramValues[param.key]}
                    error={paramErrors[param.key]}
                    onChange={(value) => setParamValue(param.key, value)}
                  />
                ))}
                <div className="app-form-actions">
                  <button type="submit" className="fm-btn fm-btn--solid">
                    <Play aria-hidden="true" className="size-3.5" />
                    Run tool
                  </button>
                </div>
              </form>
            </section>

            <RunHistoryPanel
              runs={displayRuns}
              loading={sessions.isLoading && runs.length === 0}
              error={sessionsError}
              onRetry={sessions.refetch}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
            />
          </div>
        ) : null}

        <RunDetailPanel run={selectedRun} tool={selectedRunTool} />

        <SnapshotsPanel
          projectId={projectId}
          restoredIds={restoredSnapshotIds}
          onRestore={handleRestoreSnapshot}
        />
      </div>
    </ScreenState>
  )
}
