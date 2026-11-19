"use client"

import { useEffect, useMemo, useState } from "react"

import { useMockStore } from "@/components/app/mock-store-provider"
import type { LabEnvironment, LabEnvironmentKind } from "@/lib/project-store"

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

export function LabScreen({ projectId }: { projectId: string }) {
  const { store, state, ready } = useMockStore()
  const [notice, setNotice] = useState("")

  const environments = state.lab.environments
  const active = useMemo(
    () =>
      environments.find((environment) => environment.id === state.lab.activeEnvironmentId) ??
      environments[0] ??
      null,
    [environments, state.lab.activeEnvironmentId],
  )
  const idle = active ? isIdle(active) : false

  useEffect(() => {
    if (active?.status !== "starting") return
    const timeout = window.setTimeout(() => {
      const result = store.completeLabSessionStart(active.id)
      if (!result.ok) setNotice(result.error)
    }, 900)
    return () => window.clearTimeout(timeout)
  }, [active?.id, active?.status, store])

  const act = (action: () => { ok: boolean; error?: string }) => {
    const result = action()
    setNotice(result.ok ? "" : (result.error ?? "The mock lab action failed."))
  }

  if (!ready) {
    return (
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Lab</h1>
            <p className="app-page-subtitle">Loading mock lab environments…</p>
          </div>
        </div>
        <div className="app-loading" aria-label="Loading lab environments">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1>Lab</h1>
          <p className="app-page-subtitle">
            Mock compute environments for {state.project.name} (project {projectId}). Sessions never
            leave the browser.
          </p>
        </div>
        <div className="app-page-actions">
          {active ? (
            <>
              <button
                type="button"
                className="fm-btn"
                disabled={active.status !== "stopped"}
                onClick={() => act(() => store.startLabSession(active.id))}
              >
                Start session
              </button>
              <button
                type="button"
                className="fm-btn fm-btn--danger"
                disabled={active.status === "stopped"}
                onClick={() => act(() => store.stopLabSession(active.id))}
              >
                Stop session
              </button>
              <button
                type="button"
                className="fm-btn"
                disabled={active.status !== "running"}
                onClick={() => act(() => store.pingLabSession(active.id))}
              >
                Ping
              </button>
            </>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="app-alert app-alert--error" role="alert">
          {notice}
        </div>
      ) : null}
      {idle ? (
        <div className="app-alert app-alert--warning" role="status">
          <Icon name="i-clock" />
          <span>
            {active?.name} has been idle for a while. Ping it to keep the mock session warm, or stop
            it to free quota.
          </span>
        </div>
      ) : null}

      {environments.length === 0 ? (
        <div className="app-state">
          <Icon name="i-flask" className="icon" />
          <h2>No lab environments</h2>
          <p>The mock store did not seed any environments for this project.</p>
        </div>
      ) : (
        <>
          <div className="app-lab-tabs" role="tablist" aria-label="Lab environments">
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
                  className={`app-lab-tab${selected ? " is-active" : ""}`}
                  onClick={() => {
                    const result = store.setActiveLabEnvironment(environment.id)
                    if (!result.ok) setNotice(result.error)
                  }}
                >
                  <span className={`app-status-dot is-${environment.status}`} aria-hidden="true" />
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
                <div className="app-state">
                  <Icon name="i-flask" className="icon" />
                  <h2>{active.name} is stopped</h2>
                  <p>
                    Start the mock session to inspect the static notebook, plot, or terminal pane.
                  </p>
                </div>
              ) : (
                <EnvironmentPane kind={active.kind} />
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
