"use client"

import { useEffect, useMemo, useState } from "react"

import { API_ENDPOINTS, endpointsByGroup, getEndpoint } from "./catalog"
import {
  clearHistory,
  executeRequest,
  formatJson,
  historyEntryFromResponse,
  loadHistory,
  missingPathParams,
  pathParamNames,
  saveHistoryEntry,
  type ApiResponse,
  type HistoryEntry,
  type KeyValuePair,
  type PlaygroundRequest,
} from "./request"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

function emptyPair(): KeyValuePair {
  return { key: "", value: "" }
}

/**
 * Interactive API playground. Pick an endpoint (or build a request by hand),
 * set path params / query / headers / body / token, send it against the
 * same-origin `/api` routes, and inspect the response. Calls are recorded in
 * localStorage history.
 */
export function ApiPlayground() {
  const firstEndpoint = API_ENDPOINTS[0]
  const [endpointId, setEndpointId] = useState<string>(firstEndpoint?.id ?? "")
  const [method, setMethod] = useState<string>(firstEndpoint?.method ?? "GET")
  const [path, setPath] = useState<string>(firstEndpoint?.path ?? "/api/profile")
  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryRows, setQueryRows] = useState<KeyValuePair[]>([emptyPair()])
  const [headerRows, setHeaderRows] = useState<KeyValuePair[]>([emptyPair()])
  const [body, setBody] = useState("")
  const [token, setToken] = useState("")
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyTick, setHistoryTick] = useState(0)

  const groups = useMemo(() => endpointsByGroup(), [])
  const detectedParams = useMemo(() => pathParamNames(path), [path])
  const missingParams = useMemo(() => missingPathParams(path, pathParams), [path, pathParams])

  useEffect(() => {
    setHistory(loadHistory())
  }, [historyTick])

  function applyEndpoint(id: string) {
    setEndpointId(id)
    const endpoint = getEndpoint(id)
    if (!endpoint) return
    setMethod(endpoint.method)
    setPath(endpoint.path)
    setPathParams({})
    setBody(endpoint.bodyExample ? formatJson(endpoint.bodyExample) : "")
    setQueryRows(
      endpoint.queryParams?.length
        ? endpoint.queryParams.map((p) => ({ key: p.name, value: "" }))
        : [emptyPair()],
    )
    setResponse(null)
  }

  function updatePathParams(name: string, value: string) {
    setPathParams((prev) => ({ ...prev, [name]: value }))
  }

  function addRow(setter: React.Dispatch<React.SetStateAction<KeyValuePair[]>>) {
    setter((prev) => [...prev, emptyPair()])
  }

  function removeRow(setter: React.Dispatch<React.SetStateAction<KeyValuePair[]>>, index: number) {
    setter((prev) => (prev.length <= 1 ? [emptyPair()] : prev.filter((_, i) => i !== index)))
  }

  async function send() {
    setSending(true)
    const request: PlaygroundRequest = {
      method,
      path,
      pathParams,
      query: queryRows,
      headers: headerRows,
      body: body.trim() === "" ? undefined : body,
      token: token.trim() === "" ? undefined : token,
    }
    const result = await executeRequest(request)
    setResponse(result)
    saveHistoryEntry(historyEntryFromResponse(request, result))
    setHistoryTick((t) => t + 1)
    setSending(false)
  }

  function restore(entry: HistoryEntry) {
    // Best-effort restore: fill method + path; params are re-derived.
    setMethod(entry.method)
    const [pathname, search] = entry.url.split("?")
    setPath(pathname)
    if (search) {
      const params = new URLSearchParams(search)
      setQueryRows([...params.entries()].map(([key, value]) => ({ key, value })))
    }
    setEndpointId("")
  }

  const statusClass = response
    ? response.status === 0
      ? "playground-status--error"
      : response.ok
        ? "playground-status--ok"
        : "playground-status--warn"
    : ""

  return (
    <div className="api-playground">
      <div className="playground-grid">
        <div className="playground-request">
          <label className="playground-field">
            <span>Endpoint</span>
            <select value={endpointId} onChange={(e) => applyEndpoint(e.target.value)}>
              <option value="">— custom request —</option>
              {groups.map(({ group, endpoints }) => (
                <optgroup key={group} label={group}>
                  {endpoints.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.method} {endpoint.path}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="playground-row">
            <label className="playground-field playground-field--method">
              <span>Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="playground-field playground-field--path">
              <span>Path</span>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/api/profile"
                spellCheck={false}
              />
            </label>
          </div>

          {detectedParams.length > 0 ? (
            <fieldset className="playground-fieldset">
              <legend>Path parameters</legend>
              {detectedParams.map((name) => (
                <label key={name} className="playground-field">
                  <span>{name}</span>
                  <input
                    type="text"
                    value={pathParams[name] ?? ""}
                    onChange={(e) => updatePathParams(name, e.target.value)}
                    placeholder={name}
                  />
                </label>
              ))}
            </fieldset>
          ) : null}

          <KeyValueEditor
            legend="Query parameters"
            rows={queryRows}
            onChange={setQueryRows}
            onAdd={() => addRow(setQueryRows)}
            onRemove={(i) => removeRow(setQueryRows, i)}
            keyPlaceholder="key"
            valuePlaceholder="value"
          />

          <KeyValueEditor
            legend="Headers"
            rows={headerRows}
            onChange={setHeaderRows}
            onAdd={() => addRow(setHeaderRows)}
            onRemove={(i) => removeRow(setHeaderRows, i)}
            keyPlaceholder="header-name"
            valuePlaceholder="value"
          />

          <label className="playground-field">
            <span>Bearer token (optional)</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="sent as Authorization: Bearer …"
              autoComplete="off"
            />
            <small className="playground-hint">
              API routes authenticate with your session cookie automatically — sign in first in
              another tab. This field only adds an <code>Authorization: Bearer</code> header; the
              API does not verify bearer tokens today.
            </small>
          </label>

          <label className="playground-field">
            <span>Body (JSON)</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder='{"key": "value"}'
            />
          </label>

          {missingParams.length > 0 ? (
            <p className="playground-hint playground-hint--warn" role="status">
              Fill in path parameter{missingParams.length === 1 ? "" : "s"}:{" "}
              {missingParams.join(", ")}
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn--primary playground-send"
            onClick={send}
            disabled={sending || !path.trim() || missingParams.length > 0}
          >
            {sending ? "Sending…" : "Send request"}
          </button>
        </div>

        <div className="playground-response">
          <h3>Response</h3>
          {response ? (
            <>
              <p className={`playground-status ${statusClass}`}>
                <strong>
                  {response.status} {response.statusText}
                </strong>{" "}
                · {response.durationMs}ms · {response.url}
              </p>
              {Object.keys(response.headers).length > 0 ? (
                <details className="playground-details">
                  <summary>Response headers ({Object.keys(response.headers).length})</summary>
                  <pre>{formatJson(response.headers)}</pre>
                </details>
              ) : null}
              <pre className="playground-body">
                {response.bodyJson !== undefined
                  ? formatJson(response.bodyJson)
                  : response.bodyText || "(empty body)"}
              </pre>
            </>
          ) : (
            <p className="playground-empty">Send a request to see the response here.</p>
          )}

          <div className="playground-history">
            <div className="playground-history-head">
              <h3>History</h3>
              {history.length > 0 ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    clearHistory()
                    setHistoryTick((t) => t + 1)
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="playground-empty">No calls yet — history is stored locally.</p>
            ) : (
              <ul>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="playground-history-item"
                      onClick={() => restore(entry)}
                    >
                      <code>
                        {entry.method} {entry.url}
                      </code>
                      <span>
                        {entry.status ?? "ERR"} · {entry.durationMs ?? "?"}ms ·{" "}
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface KeyValueEditorProps {
  legend: string
  rows: KeyValuePair[]
  onChange: React.Dispatch<React.SetStateAction<KeyValuePair[]>>
  onAdd: () => void
  onRemove: (index: number) => void
  keyPlaceholder: string
  valuePlaceholder: string
}

function KeyValueEditor({
  legend,
  rows,
  onChange,
  onAdd,
  onRemove,
  keyPlaceholder,
  valuePlaceholder,
}: KeyValueEditorProps) {
  return (
    <fieldset className="playground-fieldset">
      <legend>{legend}</legend>
      {rows.map((row, index) => (
        <div className="playground-kv-row" key={index}>
          <input
            type="text"
            value={row.key}
            onChange={(e) => {
              const value = e.target.value
              onChange((prev) => prev.map((r, i) => (i === index ? { ...r, key: value } : r)))
            }}
            placeholder={keyPlaceholder}
            aria-label={`${legend} key ${index + 1}`}
            spellCheck={false}
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => {
              const value = e.target.value
              onChange((prev) => prev.map((r, i) => (i === index ? { ...r, value } : r)))
            }}
            placeholder={valuePlaceholder}
            aria-label={`${legend} value ${index + 1}`}
            spellCheck={false}
          />
          <button type="button" className="btn btn--ghost" onClick={() => onRemove(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--ghost" onClick={onAdd}>
        Add row
      </button>
    </fieldset>
  )
}
