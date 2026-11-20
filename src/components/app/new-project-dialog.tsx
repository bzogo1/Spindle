"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  FlaskConical,
  FolderKanban,
  MapPin,
  Rocket,
  type LucideIcon,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  RadioGroup,
  RadioGroupCard,
  RadioGroupCardDescription,
  RadioGroupCardIcon,
  RadioGroupCardTitle,
} from "@/components/ui/radio-group"
import { useToast } from "@/components/ui/toast"
import { api, useMutation } from "@/lib/api"
import type { CreateProjectInput, Project } from "@/lib/api/types"
import {
  DEFAULT_PROJECT_TEMPLATE_ID,
  PROJECT_TEMPLATES,
  type ProjectTemplateId,
} from "@/lib/project-templates"

const TEMPLATE_ICONS: Record<ProjectTemplateId, LucideIcon> = {
  blank: FolderKanban,
  research: FlaskConical,
  "field-study": MapPin,
  "product-launch": Rocket,
}

const WIZARD_STEPS = [
  { id: "template", label: "Starting point" },
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
] as const

const LAST_STEP = WIZARD_STEPS.length - 1

/**
 * Multi-step "New project" dialog shared by the dashboard and projects
 * screens. Walks template → details → review, then creates the project through
 * the same `api.projects.createProject` mutation the old single-step form used.
 * Creation errors toast inside the dialog; pass `onCreated` for a success
 * side effect (the projects screen shows a toast, the dashboard navigates only).
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (project: Project) => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [step, setStep] = useState(0)
  const [templateId, setTemplateId] = useState<ProjectTemplateId>(DEFAULT_PROJECT_TEMPLATE_ID)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const createProject = useMutation((input: CreateProjectInput) =>
    api.projects.createProject(input),
  )

  // Reopening the wizard always starts over at the template step.
  useEffect(() => {
    if (!open) return
    setStep(0)
    setTemplateId(DEFAULT_PROJECT_TEMPLATE_ID)
    setName("")
    setDescription("")
  }, [open])

  const template = PROJECT_TEMPLATES.find((option) => option.id === templateId)
  const isLastStep = step === LAST_STEP

  function pickTemplate(nextId: string) {
    setTemplateId(nextId as ProjectTemplateId)
    const next = PROJECT_TEMPLATES.find((option) => option.id === nextId)
    // The seed only applies while the description still matches a previous
    // seed (or is empty), so a manual edit is never clobbered.
    const isSeeded = PROJECT_TEMPLATES.some((option) => option.descriptionSeed === description)
    if (next && (description.trim() === "" || isSeeded)) {
      setDescription(next.descriptionSeed)
    }
  }

  function goBack() {
    setStep((current) => Math.max(current - 1, 0))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isLastStep) {
      setStep((current) => Math.min(current + 1, LAST_STEP))
      return
    }
    try {
      const project = await createProject.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        templateId,
      })
      onOpenChange(false)
      onCreated?.(project)
      router.push(`/projects/${project.id}`)
    } catch (error) {
      toast({
        variant: "error",
        title: "Couldn't create project",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            {step === 0 && "Pick a starting point — you can adjust everything later."}
            {step === 1 && "Name the project and describe what it is for."}
            {step === 2 && "Review the details, then create the project home."}
          </DialogDescription>
        </DialogHeader>

        <div className="app-wizard-progress">
          <Progress
            value={((step + 1) / WIZARD_STEPS.length) * 100}
            aria-label={`Step ${step + 1} of ${WIZARD_STEPS.length}`}
          />
          <p className="app-eyebrow">
            Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step].label}
          </p>
        </div>

        <form className="app-form" onSubmit={submit}>
          {step === 0 ? (
            <RadioGroup
              value={templateId}
              onValueChange={pickTemplate}
              aria-label="Project template"
              variant="card"
              className="app-wizard-templates"
            >
              {PROJECT_TEMPLATES.map((option) => {
                const Icon = TEMPLATE_ICONS[option.id]
                return (
                  <RadioGroupCard key={option.id} value={option.id}>
                    <RadioGroupCardIcon>
                      <Icon aria-hidden="true" />
                    </RadioGroupCardIcon>
                    <RadioGroupCardTitle>{option.label}</RadioGroupCardTitle>
                    <RadioGroupCardDescription>{option.hint}</RadioGroupCardDescription>
                  </RadioGroupCard>
                )
              })}
            </RadioGroup>
          ) : null}

          {step === 1 ? (
            <>
              <div className="app-field">
                <label htmlFor="new-project-name">Name</label>
                <Input
                  id="new-project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Coastal resilience"
                  required
                  maxLength={80}
                  autoFocus
                />
              </div>
              <div className="app-field">
                <label htmlFor="new-project-description">Description</label>
                <textarea
                  id="new-project-description"
                  className="app-textarea"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What is this project for?"
                  rows={3}
                  maxLength={240}
                />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <div className="app-wizard-review">
              <dl className="app-wizard-summary">
                <div>
                  <dt>Starting point</dt>
                  <dd>{template?.label ?? "Blank project"}</dd>
                </div>
                <div>
                  <dt>Name</dt>
                  <dd>{name.trim()}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>{description.trim() || "None"}</dd>
                </div>
              </dl>
              <p>
                {template && template.files.length > 0
                  ? `The ${template.label.toLowerCase()} template seeds ${template.folders.length} folders, ${template.files.length} starter files, and ${template.channels.length} chat threads.`
                  : "The new project home includes files, lab sessions, chat, and agent runs."}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={goBack}>
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
            ) : null}
            {isLastStep ? (
              <Button type="submit" disabled={createProject.isLoading || !name.trim()}>
                {createProject.isLoading ? "Creating…" : "Create project"}
              </Button>
            ) : (
              <Button type="submit">Continue</Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
