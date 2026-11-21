"use client"

import { useState } from "react"
import {
  ArrowRight,
  ArrowUpRight,
  FileUp,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  Layers3,
  LockKeyhole,
  MessagesSquare,
  NotebookPen,
  Plus,
  Search,
  Zap,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/* Homepage islands, ported from the Vite entry point's mount() calls. */

export function HeroBadge() {
  return (
    <Badge asChild variant="outline" className="ui-hero-badge">
      <a href="/sign-up">
        <i className="ui-live-dot" aria-hidden="true" />
        Early access is open
        <ArrowRight className="size-3" />
      </a>
    </Badge>
  )
}

export function HeroStatus() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="ui-status-badge">
          <i className="ui-status-dot" aria-hidden="true" />
          All systems synced
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="ui-tooltip">Synced 2 minutes ago</TooltipContent>
    </Tooltip>
  )
}

export function HeroActions() {
  return (
    <div className="ui-hero-actions">
      <Button asChild size="lg" className="ui-btn-primary">
        <a href="/sign-up">
          Start free — 5 GB included <ArrowRight className="size-4" />
        </a>
      </Button>
      <Button asChild variant="ghost" size="lg" className="ui-btn-quiet">
        <a href="/#platform">
          Explore the platform <ArrowUpRight className="size-4" />
        </a>
      </Button>
    </div>
  )
}

const features = [
  {
    icon: Layers3,
    title: "One home per project",
    body: "Data, notes, notebooks, results, and conversations stay together in one workspace.",
    href: "/#files",
  },
  {
    icon: Zap,
    title: "Automations",
    body: "Describe a workflow in plain language, or write a cron job yourself. Both live in the project.",
    href: "/automations",
  },
  {
    icon: FlaskConical,
    title: "A lab that boots with it",
    body: "RStudio, JupyterLab, VS Code, and a terminal, already connected to your project files.",
    href: "/#lab",
  },
  {
    icon: Search,
    title: "Local search",
    body: "Academic and Basic modes run through a SearXNG instance hosted alongside Spindle.",
    href: "/#search",
  },
  {
    icon: FolderOpen,
    title: "Files, viewed in place",
    body: "5 GB free, a clean file manager, and inline previews for more than 100 formats.",
    href: "/#files",
  },
  {
    icon: MessagesSquare,
    title: "Team chat",
    body: "Channels live inside each project, with an optional Anonymous mode (Nym Mixnet routing planned).",
    href: "/#chat",
  },
]

export function FeatureCards() {
  return (
    <>
      {features.map((feature) => {
        const Icon = feature.icon
        return (
          <a key={feature.title} href={feature.href} className="ui-card-link">
            <Card className="ui-feature-card">
              <CardHeader className="ui-feature-header">
                <span className="card-icon">
                  <Icon className="size-4" />
                </span>
                <CardTitle className="ui-feature-title">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent className="ui-feature-content">
                <CardDescription className="ui-feature-desc">{feature.body}</CardDescription>
              </CardContent>
            </Card>
          </a>
        )
      })}
    </>
  )
}

export function LocalSearchNote() {
  return (
    <Alert className="ui-alert">
      <LockKeyhole className="size-3.5" />
      <AlertDescription className="ui-alert-desc">
        Searches don&apos;t leave Spindle to build an advertising profile.
        <Button variant="link" className="h-auto p-0 text-base underline">
          Learn More
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function FileActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="fm-btn ui-fm-btn">
          <Plus className="size-3" /> New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="ui-menu">
        <DropdownMenuLabel className="ui-menu-label">Create in /data</DropdownMenuLabel>
        <DropdownMenuSeparator className="ui-menu-separator" />
        <DropdownMenuItem className="ui-menu-item" data-fm-action="folder">
          <FolderPlus className="size-3.5" /> New folder
        </DropdownMenuItem>
        <DropdownMenuItem className="ui-menu-item" data-fm-action="upload">
          <FileUp className="size-3.5" /> Upload file
        </DropdownMenuItem>
        <DropdownMenuItem className="ui-menu-item" data-fm-action="notebook">
          <NotebookPen className="size-3.5" /> New notebook
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StorageProgress() {
  return <Progress value={36} className="ui-progress" aria-label="1.8 of 5 GB used" />
}

export function AnonymousSwitch() {
  const [checked, setChecked] = useState(false)

  function toggle(value: boolean) {
    setChecked(value)
    document.getElementById("anonToggle")?.click()
  }

  return (
    // No aria-pressed here: the wrapper is a plain div (aria-pressed is only
    // valid on certain roles), and the Switch inside already exposes the
    // toggle state to assistive tech.
    <div className="anon-toggle ui-anon-toggle">
      <Switch
        checked={checked}
        onCheckedChange={toggle}
        className="ui-switch"
        aria-label="Anonymous mode"
      />
      <div>
        <strong>Anonymous mode</strong>
        <small>{checked ? "On · pseudonymous display" : "Off · normal project chat"}</small>
      </div>
    </div>
  )
}

export function PresenceAvatar() {
  return (
    <Avatar className="ui-avatar">
      <AvatarFallback className="ui-avatar-fallback">MR</AvatarFallback>
    </Avatar>
  )
}

const plans = [
  {
    name: "Hobby",
    price: "$0",
    tag: null,
    description: "For a single researcher or a project that's just getting started.",
    features: [
      "5 GB storage",
      "Lab, Search, Files, Agent, and Chat",
      "Automations and cron jobs",
      "20 agent requests per day",
    ],
    cta: "Create your workspace",
    href: "/sign-up",
    featured: true,
  },
  {
    name: "Enterprise",
    price: null,
    tag: "TALK TO US",
    description: "Custom features, dedicated support, and anything your organization needs.",
    features: [
      "Custom integrations and workflows",
      "Dedicated infrastructure and SLA",
      "Onboarding and training for your team",
    ],
    cta: "Contact us",
    href: "/about#contact",
    featured: false,
  },
]

export function PlanCards() {
  return (
    <>
      {plans.map((plan) => (
        <Card
          key={plan.name}
          className={`ui-plan-card${plan.featured ? "ui-plan-card--featured" : ""}`}
        >
          <CardHeader className="ui-plan-header">
            <CardTitle className="ui-plan-name">{plan.name}</CardTitle>
            {plan.price ? (
              <span className="ui-plan-price">{plan.price}</span>
            ) : (
              <span className="ui-plan-tag">{plan.tag}</span>
            )}
          </CardHeader>
          <CardContent className="ui-plan-content">
            <CardDescription className="ui-plan-desc">{plan.description}</CardDescription>
            <ul className="ui-plan-list">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="ui-plan-footer">
            <Button asChild className="ui-btn-primary ui-btn-full">
              <a href={plan.href}>{plan.cta}</a>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </>
  )
}
