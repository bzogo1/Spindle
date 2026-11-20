"use client"

import { useState } from "react"

import { isTutorialCompleted } from "./completion"
import { SAMPLE_TUTORIALS } from "./sample-tutorials"
import { TutorialRunner } from "./tutorial-engine"
import type { Tutorial } from "./types"

/**
 * Demo surface for the tutorial engine: renders fake "app" elements the
 * tours can spotlight, plus start buttons for each sample tutorial.
 */
export function TutorialDemo() {
  const [activeId, setActiveId] = useState<string | null>(null)
  // Re-read completion state whenever a tour closes so badges update.
  const [, setCompletionTick] = useState(0)

  const active: Tutorial | undefined = SAMPLE_TUTORIALS.find((t) => t.id === activeId)

  return (
    <div className="tutorial-demo">
      <div className="tutorial-demo-targets">
        <section className="duo-card tutorial-demo-card" aria-label="Demo workspace">
          <span className="duo-badge">DEMO WORKSPACE</span>
          <h3>Research workspace</h3>
          <p>
            A pretend project dashboard. The interactive tour below spotlights the stats row, the
            checklist, and the primary action.
          </p>

          <div id="tutorial-demo-stats" className="tutorial-demo-stats" aria-label="Project stats">
            <div>
              <strong>12</strong>
              <span>sources</span>
            </div>
            <div>
              <strong>4</strong>
              <span>automations</span>
            </div>
            <div>
              <strong>87%</strong>
              <span>coverage</span>
            </div>
          </div>

          <ul id="tutorial-demo-checklist" className="tutorial-demo-checklist">
            <li>Connect a data source</li>
            <li>Schedule your first automation</li>
            <li>Invite a collaborator</li>
          </ul>

          <div className="tutorial-demo-actions">
            <button
              id="tutorial-demo-cta"
              type="button"
              className="btn btn--primary"
              onClick={() => setActiveId("workspace-tour")}
            >
              Start workspace tour
            </button>
          </div>
        </section>
      </div>

      <div className="tutorial-demo-controls">
        <h3 className="tutorial-demo-controls-title">Available tours</h3>
        <ul className="tutorial-demo-tour-list">
          {SAMPLE_TUTORIALS.map((tutorial) => {
            const done = isTutorialCompleted(tutorial.id)
            const isActive = activeId === tutorial.id
            return (
              <li key={tutorial.id} className="tutorial-demo-tour">
                <div>
                  <strong>{tutorial.title}</strong>
                  <span className="tutorial-demo-tour-meta">
                    {tutorial.steps.length} steps
                    {done ? " · completed" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className={isActive ? "btn btn--primary" : "btn btn--ghost"}
                  onClick={() => setActiveId(tutorial.id)}
                  disabled={isActive}
                >
                  {done ? "Replay" : "Start"}
                </button>
              </li>
            )
          })}
        </ul>
        {active ? (
          <TutorialRunner
            key={active.id}
            tutorial={active}
            open
            onClose={() => {
              setActiveId(null)
              setCompletionTick((n) => n + 1)
            }}
            onComplete={() => setCompletionTick((n) => n + 1)}
          />
        ) : null}
      </div>
    </div>
  )
}
