"use client"

import { useCallback, useEffect, useState, type ComponentProps } from "react"
import { RotateCcw } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import type { UsageSummary } from "@/lib/api/types"

/**
 * Usage alerts. The user sets an optional threshold per usage metric
 * (requests, tokens, cost) and the panel flags the metric once the billing
 * period total crosses it. Thresholds are client-side preferences persisted
 * to localStorage under a versioned key and synced across tabs via the
 * `storage` event, mirroring `useDashboardWidgets`.
 */

export const USAGE_ALERT_METRICS = ["requests", "tokens", "costUsd"] as const
export type UsageAlertMetric = (typeof USAGE_ALERT_METRICS)[number]

/** Per-metric alert threshold; `null` means no alert for that metric. */
export interface UsageAlertThresholds {
  requests: number | null
  tokens: number | null
  costUsd: number | null
}

/** Versioned localStorage key for the persisted thresholds. */
export const USAGE_ALERTS_STORAGE_KEY = "spindle-usage-alerts:v1"

export function defaultUsageAlerts(): UsageAlertThresholds {
  return { requests: null, tokens: null, costUsd: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sanitizeThreshold(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Merge an untrusted value (localStorage blob, cross-tab storage event) over
 * the defaults so a corrupt or partial payload can never produce an invalid
 * threshold set: non-numeric, non-finite, and non-positive entries become
 * `null` (alert off).
 */
export function sanitizeUsageAlerts(value: unknown): UsageAlertThresholds {
  const defaults = defaultUsageAlerts()
  if (!isRecord(value)) return defaults
  return {
    requests: sanitizeThreshold(value.requests) ?? defaults.requests,
    tokens: sanitizeThreshold(value.tokens) ?? defaults.tokens,
    costUsd: sanitizeThreshold(value.costUsd) ?? defaults.costUsd,
  }
}

function readStoredUsageAlerts(): UsageAlertThresholds {
  if (typeof window === "undefined") return defaultUsageAlerts()
  try {
    const raw = window.localStorage.getItem(USAGE_ALERTS_STORAGE_KEY)
    if (!raw) return defaultUsageAlerts()
    return sanitizeUsageAlerts(JSON.parse(raw))
  } catch {
    return defaultUsageAlerts()
  }
}

export type UsageAlertStatus = "off" | "ok" | "warning" | "exceeded"

export interface UsageAlertEvaluation {
  status: UsageAlertStatus
  /** usage / threshold * 100; 0 while the alert is off. */
  percent: number
}

/**
 * Compare a period total against its threshold. Mirrors `meterStatus` in
 * usage-screen: at or above 100% the alert is exceeded, at or above 80% it is
 * a warning, otherwise the metric is within its limit.
 */
export function evaluateUsageAlert(usage: number, threshold: number | null): UsageAlertEvaluation {
  if (threshold === null) return { status: "off", percent: 0 }
  const percent = (usage / threshold) * 100
  if (percent >= 100) return { status: "exceeded", percent }
  if (percent >= 80) return { status: "warning", percent }
  return { status: "ok", percent }
}

const ALERT_STATUS_LABEL: Record<UsageAlertStatus, string> = {
  off: "Off",
  ok: "Within limit",
  warning: "Near limit",
  exceeded: "Exceeded",
}

const ALERT_STATUS_CLASS: Record<UsageAlertStatus, string> = {
  off: "",
  ok: "is-ok",
  warning: "is-warning",
  exceeded: "is-blocked",
}

interface AlertMetricCopy {
  label: string
  unit: string
  step: string
  format: (value: number) => string
  hint: string
}

const ALERT_METRIC_COPY: Record<UsageAlertMetric, AlertMetricCopy> = {
  requests: {
    label: "Total requests",
    unit: "requests",
    step: "1",
    format: (value) => value.toLocaleString(),
    hint: "Alert when total requests this period reach this number. Leave empty for no alert.",
  },
  tokens: {
    label: "Total tokens",
    unit: "tokens",
    step: "1",
    format: (value) => value.toLocaleString(),
    hint: "Alert when total tokens this period reach this number. Leave empty for no alert.",
  },
  costUsd: {
    label: "Total cost",
    unit: "USD",
    step: "0.01",
    format: (value) => `$${value.toFixed(2)}`,
    hint: "Alert when estimated spend this period reaches this amount in USD. Leave empty for no alert.",
  },
}

export interface UsageAlertsApi {
  thresholds: UsageAlertThresholds
  /** Set a metric threshold; `null` (or a non-positive value) disables the alert. */
  setThreshold: (metric: UsageAlertMetric, threshold: number | null) => void
  reset: () => void
}

/**
 * Usage alert thresholds persisted to localStorage. Starts at the defaults on
 * both server and client so the first render hydrates cleanly; the stored
 * blob is applied in a mount effect, then persisted back on every change and
 * synced across tabs via the `storage` event.
 */
export function useUsageAlerts(): UsageAlertsApi {
  const [thresholds, setThresholds] = useState<UsageAlertThresholds>(defaultUsageAlerts)

  useEffect(() => {
    setThresholds(readStoredUsageAlerts())
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(USAGE_ALERTS_STORAGE_KEY, JSON.stringify(thresholds))
    } catch {
      // Storage can be unavailable (private mode); the thresholds still apply
      // for this session via React state.
    }
  }, [thresholds])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // `key === null` means localStorage.clear() ran in another tab — treat
      // it as a reset to defaults.
      if (event.key === null) {
        setThresholds(defaultUsageAlerts())
        return
      }
      if (event.key !== USAGE_ALERTS_STORAGE_KEY) return
      if (event.newValue === null) {
        setThresholds(defaultUsageAlerts())
        return
      }
      try {
        setThresholds(sanitizeUsageAlerts(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep current thresholds.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const setThreshold = useCallback((metric: UsageAlertMetric, threshold: number | null) => {
    setThresholds((current) => ({ ...current, [metric]: sanitizeThreshold(threshold) }))
  }, [])

  const reset = useCallback(() => setThresholds(defaultUsageAlerts()), [])

  return { thresholds, setThreshold, reset }
}

export interface UsageAlertsPanelProps {
  /** Loaded usage summary; while undefined the panel still renders the threshold inputs. */
  usage?: UsageSummary
}

function formatThreshold(value: number | null): string {
  return value === null ? "" : String(value)
}

/**
 * Threshold input backed by local string state. Intermediate keystrokes are
 * never round-tripped through the sanitized numeric threshold, so typing a
 * leading-zero decimal like "0.50" is not wiped when "0" parses to a
 * non-positive value. Each change commits the parsed number only when it is
 * a positive finite value (empty text commits `null` to disable the alert);
 * invalid text is kept locally and never reaches `onCommit`. The text
 * resyncs from `value` when the committed threshold changes externally
 * (storage sync, reset) and on blur.
 */
function ThresholdInput({
  value,
  onCommit,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "onBlur"> & {
  value: number | null
  onCommit: (value: number | null) => void
}) {
  const [text, setText] = useState(() => formatThreshold(value))

  useEffect(() => {
    setText((current) => {
      // Keep in-progress text that already parses to the committed value
      // (e.g. "0.50" vs 0.5, or "05" vs 5) instead of normalizing it away.
      if (current.trim() !== "" && Number(current) === value) return current
      return formatThreshold(value)
    })
  }, [value])

  return (
    <Input
      type="text"
      inputMode="decimal"
      {...inputProps}
      value={text}
      onChange={(event) => {
        const raw = event.target.value
        setText(raw)
        if (raw.trim() === "") {
          onCommit(null)
          return
        }
        const parsed = Number(raw)
        if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed)
      }}
      onBlur={() => setText(formatThreshold(value))}
    />
  )
}

/**
 * "Usage alerts" panel: one row per metric with the current period total, a
 * threshold input, a usage-vs-threshold progress bar, and a status badge that
 * flips to "Exceeded" once the total crosses the configured threshold. An
 * inline error banner summarizes any exceeded metrics.
 */
export function UsageAlertsPanel({ usage }: UsageAlertsPanelProps) {
  const alerts = useUsageAlerts()

  const rows = USAGE_ALERT_METRICS.map((metric) => {
    const copy = ALERT_METRIC_COPY[metric]
    const threshold = alerts.thresholds[metric]
    const evaluation = usage ? evaluateUsageAlert(usage[metric], threshold) : null
    const inputId = `usage-alert-${metric}`

    return { metric, copy, threshold, evaluation, inputId }
  })

  const exceededLabels = rows
    .filter((row) => row.evaluation?.status === "exceeded")
    .map((row) => row.copy.label.toLowerCase())

  return (
    <section className="app-panel" aria-labelledby="usage-alerts-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="usage-alerts-heading">Usage alerts</h2>
          <p>Warn when period totals cross the limits you set. Stored in this browser.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!rows.some((row) => row.threshold !== null)}
          onClick={alerts.reset}
        >
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
      </div>

      {exceededLabels.length > 0 ? (
        <InlineError
          title="Usage threshold exceeded"
          message={`${exceededLabels.join(" and ")} ${exceededLabels.length === 1 ? "is" : "are"} above the alert threshold${exceededLabels.length === 1 ? "" : "s"} you set for this billing period.`}
        />
      ) : null}

      <div className="app-usage-meters">
        {rows.map(({ metric, copy, threshold, evaluation, inputId }) => {
          const status = evaluation?.status ?? "off"
          const statusLabel = evaluation ? ALERT_STATUS_LABEL[status] : "—"
          const statusClass = evaluation ? ALERT_STATUS_CLASS[status] : ""
          const currentLabel = usage ? copy.format(usage[metric]) : "—"
          const thresholdLabel = threshold === null ? "No alert" : copy.format(threshold)

          return (
            <div className="app-usage-meter" key={metric}>
              <div className="app-usage-meter-head">
                <span className="app-usage-meter-label">{copy.label}</span>
                <span className={`app-usage-status${statusClass ? ` ${statusClass}` : ""}`}>
                  {statusLabel}
                </span>
              </div>
              <div className="app-usage-meter-values">
                {/* Single text node so the combined "used / limit" string never
                    collides with the bare totals rendered by UsageTotals. */}
                <strong>{`${currentLabel} / ${thresholdLabel}`}</strong>
                {evaluation && evaluation.status !== "off" ? (
                  <span>{Math.round(evaluation.percent)}%</span>
                ) : (
                  <span>—</span>
                )}
              </div>
              {evaluation && evaluation.status !== "off" ? (
                <Progress
                  value={Math.min(100, evaluation.percent)}
                  aria-label={`${copy.label} alert threshold usage`}
                />
              ) : null}
              <div className="app-field">
                <label htmlFor={inputId}>Alert threshold ({copy.unit})</label>
                <ThresholdInput
                  id={inputId}
                  placeholder="No alert"
                  value={threshold}
                  onCommit={(next) => alerts.setThreshold(metric, next)}
                />
                <p className="app-field-hint">{copy.hint}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
