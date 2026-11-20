"use client"

import { useMemo, useState } from "react"
import { Play, Sparkles } from "lucide-react"

import {
  groupAgentRunTemplatesByCategory,
  instantiateRunFromTemplate,
  listAgentRunTemplates,
  type AgentRunTemplate,
} from "@/lib/agent-runs/ops/templates"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

/**
 * Template gallery: builtin (and installed) run templates grouped by
 * category. "Instantiate" creates a queued `AgentRunRecord` from the
 * template and hands it to `onInstantiate`; without a handler the created
 * run id is shown inline so the gallery still demonstrates the flow.
 */
export function AgentRunTemplateGallery({
  templates,
  onInstantiate,
}: {
  templates?: readonly AgentRunTemplate[]
  onInstantiate?: (run: AgentRunRecord, template: AgentRunTemplate) => void
}) {
  const all = useMemo(() => templates ?? listAgentRunTemplates(), [templates])
  const groups = useMemo(() => groupAgentRunTemplatesByCategory(all), [all])
  const [lastRun, setLastRun] = useState<AgentRunRecord | null>(null)

  const instantiate = (template: AgentRunTemplate) => {
    const run = instantiateRunFromTemplate(template)
    setLastRun(run)
    onInstantiate?.(run, template)
  }

  return (
    <section className="app-panel" aria-labelledby="tpl-gallery-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="tpl-gallery-heading">
            <Sparkles aria-hidden="true" className="app-panel-icon" /> Run templates
          </h2>
          <p>Prompt + config presets. Instantiating creates a queued run record.</p>
        </div>
      </div>

      {[...groups.entries()].map(([category, list]) => (
        <div key={category} className="app-tpl-category">
          <h3 className="app-tpl-category-title">{category}</h3>
          <ul className="app-tpl-grid">
            {list.map((template) => (
              <li key={template.id} className="app-tpl-card">
                <div className="app-tpl-card-head">
                  <strong>{template.name}</strong>
                  <span className="app-badge">v{template.version}</span>
                  {template.featured ? (
                    <span className="app-badge is-running">featured</span>
                  ) : null}
                </div>
                <p className="app-tpl-card-desc">{template.description}</p>
                <div className="app-tpl-card-meta">
                  {template.config.model ? <span>{template.config.model}</span> : null}
                  {template.config.maxSteps ? <span>≤{template.config.maxSteps} steps</span> : null}
                  {(template.config.tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag} className="app-badge">
                      {tag}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="fm-btn fm-btn--solid"
                  onClick={() => instantiate(template)}
                >
                  <Play aria-hidden="true" className="size-3.5" /> Instantiate
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {lastRun ? (
        <p className="app-tpl-last-run" role="status">
          Instantiated run <code>{lastRun.id}</code> from template <code>{lastRun.templateId}</code>{" "}
          — status {lastRun.status}.
        </p>
      ) : null}
    </section>
  )
}
