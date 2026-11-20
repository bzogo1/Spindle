"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Webhook, Send, Trash2, CheckCircle2, XCircle } from "lucide-react"

import {
  AGENT_RUN_WEBHOOK_EVENTS,
  fireTestWebhook,
  listAgentRunWebhooks,
  listWebhookDeliveries,
  loadWebhookStore,
  removeAgentRunWebhook,
  saveNewAgentRunWebhook,
  saveWebhookStore,
  setAgentRunWebhookEnabled,
  validateWebhookInput,
  type AgentRunWebhook,
  type AgentRunWebhookDelivery,
  type AgentRunWebhookEvent,
  type WebhookFetchImpl,
} from "@/lib/agent-runs/ops/webhooks"

/**
 * Webhook management panel for agent runs: register endpoints (global or
 * scoped to `runId`), pick lifecycle events, optionally set an HMAC secret,
 * toggle/delete endpoints, test-fire, and inspect the delivery log.
 * All state lives in localStorage via the ops webhook store.
 */
export function AgentRunWebhookPanel({
  runId,
  fetchImpl,
}: {
  runId?: string
  /** Test seam — override the delivery transport (defaults to global fetch). */
  fetchImpl?: WebhookFetchImpl
}) {
  const [webhooks, setWebhooks] = useState<AgentRunWebhook[]>(() => listAgentRunWebhooks())
  const [deliveries, setDeliveries] = useState<AgentRunWebhookDelivery[]>(() =>
    listWebhookDeliveries(),
  )
  const [testingId, setTestingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  // Form state
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<AgentRunWebhookEvent[]>([
    "run.completed",
    "run.failed",
  ])
  const [secret, setSecret] = useState("")
  const [scope, setScope] = useState<"global" | "run">("global")

  const refresh = useCallback(() => {
    setWebhooks(listAgentRunWebhooks())
    setDeliveries(listWebhookDeliveries())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const visibleWebhooks = useMemo(
    () => webhooks.filter((w) => !runId || w.runId === undefined || w.runId === runId),
    [webhooks, runId],
  )

  const toggleEvent = (event: AgentRunWebhookEvent) => {
    setSelectedEvents((current) =>
      current.includes(event) ? current.filter((e) => e !== event) : [...current, event],
    )
  }

  const addWebhook = (event: FormEvent) => {
    event.preventDefault()
    const input = {
      name: name.trim() || undefined,
      url,
      events: selectedEvents,
      secret: secret.trim() || undefined,
      runId: scope === "run" && runId ? runId : undefined,
    }
    const validation = validateWebhookInput(input)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }
    const created = saveNewAgentRunWebhook(input)
    if (!created.ok || !created.webhook) {
      setErrors([created.error ?? "Could not create webhook."])
      return
    }
    setName("")
    setUrl("")
    setSecret("")
    setScope("global")
    setErrors([])
    refresh()
  }

  const toggleEnabled = (webhook: AgentRunWebhook) => {
    setAgentRunWebhookEnabled(webhook.id, !webhook.enabled)
    refresh()
  }

  const remove = (webhook: AgentRunWebhook) => {
    removeAgentRunWebhook(webhook.id)
    refresh()
  }

  const testFire = async (webhook: AgentRunWebhook) => {
    setTestingId(webhook.id)
    try {
      await fireTestWebhook(webhook, { fetchImpl })
    } finally {
      setTestingId(null)
      refresh()
    }
  }

  const clearLog = () => {
    // Preserve webhooks; reset only the delivery log.
    const store = loadWebhookStore()
    store.deliveries = []
    saveWebhookStore(store)
    refresh()
  }

  return (
    <section className="app-panel" aria-labelledby="webhooks-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="webhooks-heading">
            <Webhook aria-hidden="true" className="app-panel-icon" /> Run webhooks
          </h2>
          <p>
            {visibleWebhooks.length} endpoint{visibleWebhooks.length === 1 ? "" : "s"} ·{" "}
            {deliveries.length} deliver{deliveries.length === 1 ? "y" : "ies"} logged.
          </p>
        </div>
        <div className="app-share-actions">
          <button type="button" className="fm-btn" onClick={clearLog}>
            Clear log
          </button>
        </div>
      </div>

      <form className="app-sched-form" onSubmit={addWebhook} aria-label="Add webhook">
        <div className="app-form-grid">
          <div className="app-field">
            <label htmlFor="wh-name">Name (optional)</label>
            <input
              id="wh-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="CI notifications"
              maxLength={120}
            />
          </div>
          <div className="app-field">
            <label htmlFor="wh-url">Endpoint URL</label>
            <input
              id="wh-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/hooks/spindle"
              required
            />
          </div>
        </div>

        <fieldset className="app-field">
          <legend>Events</legend>
          <div className="app-share-actions">
            {AGENT_RUN_WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="app-badge" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(event)}
                  onChange={() => toggleEvent(event)}
                  style={{ marginRight: 4 }}
                />
                <code>{event}</code>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="app-form-grid">
          <div className="app-field">
            <label htmlFor="wh-secret">Signing secret (optional)</label>
            <input
              id="wh-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="HMAC-SHA256 secret"
              autoComplete="off"
            />
            <p className="app-field-hint">
              Sent as <code>X-Spindle-Signature: t=&lt;ts&gt;,v1=&lt;hmac&gt;</code>.
            </p>
          </div>
          {runId ? (
            <div className="app-field">
              <label htmlFor="wh-scope">Scope</label>
              <select
                id="wh-scope"
                className="app-select"
                value={scope}
                onChange={(event) => setScope(event.target.value as "global" | "run")}
              >
                <option value="global">All runs</option>
                <option value="run">Only run {runId}</option>
              </select>
            </div>
          ) : null}
        </div>

        {errors.length > 0 ? (
          <ul className="app-sched-errors" role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        <div className="app-share-actions">
          <button type="submit" className="fm-btn fm-btn--solid">
            Add webhook
          </button>
        </div>
      </form>

      {visibleWebhooks.length === 0 ? (
        <p className="app-runlog-empty-steps">
          No webhooks yet — add an endpoint above to get notified when runs finish.
        </p>
      ) : (
        <table className="app-analytics-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Events</th>
              <th>Scope</th>
              <th>Signed</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleWebhooks.map((webhook) => (
              <tr key={webhook.id}>
                <td>{webhook.name ?? webhook.id}</td>
                <td>
                  <code>{webhook.url}</code>
                </td>
                <td>
                  {webhook.events.map((e) => (
                    <code key={e}>{e} </code>
                  ))}
                </td>
                <td>{webhook.runId ? <code>{webhook.runId}</code> : "all runs"}</td>
                <td>{webhook.secret ? "yes" : "no"}</td>
                <td>
                  <button
                    type="button"
                    className={`app-badge ${webhook.enabled ? "is-done" : ""}`}
                    onClick={() => toggleEnabled(webhook)}
                    aria-pressed={webhook.enabled}
                  >
                    {webhook.enabled ? "enabled" : "disabled"}
                  </button>
                </td>
                <td>
                  <div className="app-share-actions">
                    <button
                      type="button"
                      className="fm-btn"
                      onClick={() => void testFire(webhook)}
                      disabled={testingId === webhook.id}
                    >
                      <Send aria-hidden="true" className="size-3" />
                      {testingId === webhook.id ? "Testing…" : "Test"}
                    </button>
                    <button
                      type="button"
                      className="fm-btn"
                      onClick={() => remove(webhook)}
                      aria-label={`Delete webhook ${webhook.name ?? webhook.id}`}
                    >
                      <Trash2 aria-hidden="true" className="size-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Delivery log</h3>
      {deliveries.length === 0 ? (
        <p className="app-runlog-empty-steps">No deliveries yet.</p>
      ) : (
        <table className="app-analytics-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Webhook</th>
              <th>Run</th>
              <th>Status</th>
              <th>Code</th>
              <th>ms</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td>{delivery.attemptedAt}</td>
                <td>
                  <code>{delivery.event}</code>
                </td>
                <td>
                  <code title={delivery.url}>{delivery.webhookId}</code>
                </td>
                <td>{delivery.runId ?? "—"}</td>
                <td>
                  {delivery.status === "success" ? (
                    <span className="app-badge is-done">
                      <CheckCircle2 aria-hidden="true" className="size-3" /> ok
                    </span>
                  ) : (
                    <span className="app-badge is-failed">
                      <XCircle aria-hidden="true" className="size-3" /> failed
                    </span>
                  )}
                </td>
                <td>{delivery.statusCode ?? "—"}</td>
                <td>{delivery.durationMs}</td>
                <td>{delivery.error ?? delivery.responseSnippet ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
