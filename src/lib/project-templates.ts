/**
 * Project template definitions shared by the new-project wizard and the mock
 * data layer.
 *
 * A template is pure data: display copy plus the starter workspace structure
 * (folders/files, chat threads, lab environments) that `createProject`
 * applies when the project is created. The mock adapter seeds a
 * {@link MockStore} from the template; a real backend would apply the same
 * `templateId` server-side.
 */

import type { LabEnvironmentKind } from "./api/types"

export type ProjectTemplateId = "blank" | "research" | "field-study" | "product-launch"

/** A starter file seeded into the project workspace by a template. */
export interface ProjectTemplateFile {
  /** Slash-separated path relative to the project root, e.g. "data/notes.md". */
  path: string
  content?: string
  mimeType?: string
  /** Display size used by file lists; defaults to the content length. */
  sizeBytes?: number
}

export interface ProjectTemplate {
  id: ProjectTemplateId
  /** Card title shown in the wizard. */
  label: string
  /** One-line card hint shown under the title. */
  hint: string
  /** Text seeded into the description field when the template is picked. */
  descriptionSeed: string
  /** Folder names pre-created at the project root. */
  folders: string[]
  /** Starter files placed by `path`; parent folders are created as needed. */
  files: ProjectTemplateFile[]
  /** Chat thread names seeded for the project. */
  channels: string[]
  /** Lab environment kinds seeded; defaults to all four when omitted. */
  labEnvironments?: LabEnvironmentKind[]
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "blank",
    label: "Blank project",
    hint: "Start from scratch with just a name and description.",
    descriptionSeed: "",
    folders: [],
    files: [],
    channels: ["general"],
  },
  {
    id: "research",
    label: "Research project",
    hint: "Questions, datasets, methods, and findings in one place.",
    descriptionSeed: "Track research questions, datasets, methods, and findings for this project.",
    folders: ["data", "notebooks", "methods"],
    files: [
      {
        path: "research-questions.md",
        content: "# Research questions\n\n- What are we trying to find out?\n- How will we know?\n",
      },
      {
        path: "data/dataset-notes.md",
        content: "# Dataset notes\n\nRecord sources, licences, and cleaning steps here.\n",
      },
      {
        path: "notebooks/analysis.ipynb",
        mimeType: "application/x-ipynb+json",
        content:
          '{\n  "cells": [\n    {"cell_type": "markdown", "source": ["# Analysis", "Start here."]},\n    {"cell_type": "code", "source": ["# import pandas as pd"], "outputs": []}\n  ],\n  "metadata": {"kernelspec": {"name": "python3"}}\n}',
      },
      {
        path: "methods/protocol.md",
        content: "# Protocol\n\nOutline the study design, measures, and analysis plan.\n",
      },
    ],
    channels: ["general", "data", "writing"],
    labEnvironments: ["jupyter", "rstudio", "terminal"],
  },
  {
    id: "field-study",
    label: "Field study",
    hint: "Sites, observations, samples, and survey data.",
    descriptionSeed: "Organize field sites, observations, samples, and survey data for this study.",
    folders: ["sites", "observations", "samples"],
    files: [
      {
        path: "field-protocol.md",
        content: "# Field protocol\n\nSampling design, equipment checklist, and safety notes.\n",
      },
      {
        path: "sites/sites.geojson",
        mimeType: "application/geo+json",
        content: '{\n  "type": "FeatureCollection",\n  "features": []\n}\n',
      },
      {
        path: "observations/log.csv",
        content: "date,site,observer,notes\n",
      },
      {
        path: "samples/inventory.csv",
        content: "sample_id,site,collected_at,storage\n",
      },
    ],
    channels: ["general", "field-crew", "logistics"],
    labEnvironments: ["jupyter", "vscode", "terminal"],
  },
  {
    id: "product-launch",
    label: "Product launch",
    hint: "Goals, milestones, assets, and the launch checklist.",
    descriptionSeed:
      "Coordinate goals, milestones, assets, and the launch checklist for this product.",
    folders: ["goals", "milestones", "assets"],
    files: [
      {
        path: "launch-plan.md",
        content: "# Launch plan\n\nAudience, positioning, channels, and timeline.\n",
      },
      {
        path: "goals/okrs.md",
        content: "# Goals\n\n- Objective:\n  - Key result:\n",
      },
      {
        path: "milestones/timeline.csv",
        content: "milestone,owner,target_date,status\n",
      },
      {
        path: "assets/README.md",
        content: "# Assets\n\nLogos, screenshots, copy, and press kit live here.\n",
      },
    ],
    channels: ["general", "launch", "assets"],
    labEnvironments: ["vscode", "jupyter", "terminal"],
  },
] as const

export const DEFAULT_PROJECT_TEMPLATE_ID: ProjectTemplateId = "blank"

export function getProjectTemplate(id?: string | null): ProjectTemplate {
  return (
    PROJECT_TEMPLATES.find((template) => template.id === id) ??
    PROJECT_TEMPLATES.find((template) => template.id === DEFAULT_PROJECT_TEMPLATE_ID)!
  )
}
