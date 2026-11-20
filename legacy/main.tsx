import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
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
  ShieldCheck,
  Zap,
} from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
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
import { Checkbox } from "@/components/ui/checkbox"
import { DitherField } from "@/components/ui/dither-field"
import { Globe } from "@/components/ui/globe"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import "./index.css"
import "./ui.css"

/* -------------------------------------------------------------------------- */
/*  Mount helper — each island is dropped into a placeholder in index.html    */
/* -------------------------------------------------------------------------- */

function mount(id: string, node: ReactNode) {
  const el = document.getElementById(id)
  if (!el) return
  try {
    createRoot(el).render(
      <StrictMode>
        <TooltipProvider delayDuration={180}>{node}</TooltipProvider>
      </StrictMode>
    )
  } catch (error) {
    console.error("Could not mount " + id, error)
  }
}

/* -------------------------------------------------------------------------- */
/*  Hero                                                                       */
/* -------------------------------------------------------------------------- */

function HeroBadge() {
  return (
    <Badge asChild variant="outline" className="ui-hero-badge">
      <a href="#get-started">
        <i className="ui-live-dot" aria-hidden="true" />
        Early access is open
        <ArrowRight className="size-3" />
      </a>
    </Badge>
  )
}

function HeroStatus() {
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

function HeroActions() {
  return (
    <div className="ui-hero-actions">
      <Button asChild size="lg" className="ui-btn-primary">
        <a href="#get-started">Start free — 5 GB included <ArrowRight className="size-4" /></a>
      </Button>
      <Button asChild variant="ghost" size="lg" className="ui-btn-quiet">
        <a href="#platform">Explore the platform <ArrowUpRight className="size-4" /></a>
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Header — sign-in dialog with tabs, inputs, checkbox                        */
/* -------------------------------------------------------------------------- */

function AuthDialog() {
  const [notice, setNotice] = useState("")
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState("signin")

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      setTab(detail?.tab === "create" ? "create" : "signin")
      setOpen(true)
    }

    window.addEventListener("spindle:open-auth", handleOpen)
    return () => window.removeEventListener("spindle:open-auth", handleOpen)
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice("Preview only — no account is created.")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" className="ui-signin-trigger" onClick={() => setTab("signin")}>Sign in</Button>
      </DialogTrigger>
      <DialogContent className="ui-dialog">
        <DialogHeader>
          <DialogTitle className="ui-dialog-title">Welcome to Spindle</DialogTitle>
          <DialogDescription className="ui-dialog-desc">
            One workspace for every research project.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="ui-auth-tabs">
          <TabsList className="ui-auth-tabs-list">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="create">Create workspace</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit}>
            <TabsContent value="signin" className="ui-auth-form">
              <div className="ui-field">
                <Label htmlFor="ui-email">Work email</Label>
                <Input id="ui-email" type="email" placeholder="you@lab.edu" required />
              </div>
              <div className="ui-field">
                <Label htmlFor="ui-password">Password</Label>
                <Input id="ui-password" type="password" placeholder="••••••••" required />
              </div>
              <div className="ui-check-row">
                <Checkbox id="ui-remember" defaultChecked />
                <Label htmlFor="ui-remember">Keep me signed in</Label>
              </div>
              <Button type="submit" className="ui-btn-primary ui-dialog-submit">Continue</Button>
            </TabsContent>

            <TabsContent value="create" className="ui-auth-form">
              <div className="ui-field">
                <Label htmlFor="ui-name">Workspace name</Label>
                <Input id="ui-name" placeholder="coastal-resilience" required />
              </div>
              <div className="ui-field">
                <Label htmlFor="ui-new-email">Work email</Label>
                <Input id="ui-new-email" type="email" placeholder="you@lab.edu" required />
              </div>
              <p className="ui-inline-note"><ShieldCheck className="size-3.5" /> 5 GB free. No credit card.</p>
              <Button type="submit" className="ui-btn-primary ui-dialog-submit">Create free workspace</Button>
            </TabsContent>
          </form>
        </Tabs>

        {notice && <p className="ui-form-notice" role="status">{notice}</p>}

        <DialogFooter className="ui-dialog-footer">
          <Separator />
          <DialogClose asChild>
            <Button variant="ghost" size="sm" className="ui-btn-quiet">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/*  Platform cards                                                             */
/* -------------------------------------------------------------------------- */

const features = [
  { icon: Layers3, title: "One home per project", body: "Data, notes, notebooks, results, and conversations stay together in a single workspace.", href: "#files" },
  { icon: Zap, title: "Automations", body: "Describe a workflow in plain language, or write a cron job yourself. Both live in the project.", href: "automations.html" },
  { icon: FlaskConical, title: "A lab that boots with it", body: "RStudio, JupyterLab, VS Code, and a terminal, already connected to your project files.", href: "#lab" },
  { icon: Search, title: "Local search", body: "Academic and Basic modes run through a SearXNG instance hosted alongside Spindle.", href: "#search" },
  { icon: FolderOpen, title: "Files, viewed in place", body: "5 GB free, a clean file manager, and inline previews for more than 100 formats.", href: "#files" },
  { icon: MessagesSquare, title: "Team chat", body: "Channels live inside each project, with an optional Anonymous mode (Nym Mixnet routing planned).", href: "#chat" },
]

function FeatureCards() {
  return (
    <>
      {features.map((feature) => {
        const Icon = feature.icon
        return (
          <a key={feature.title} href={feature.href} className="ui-card-link">
            <Card className="ui-feature-card">
              <CardHeader className="ui-feature-header">
                <span className="card-icon"><Icon className="size-4" /></span>
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

/* -------------------------------------------------------------------------- */
/*  Search — shadcn alert                                                      */
/* -------------------------------------------------------------------------- */

function LocalSearchNote() {
  return (
    <Alert className="ui-alert">
      <LockKeyhole className="size-3.5" />
      <AlertDescription className="ui-alert-desc">
        Searches don't leave Spindle to build an advertising profile.
        <Button variant="link" className="p-0 h-auto text-base underline">
          Learn More
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/* -------------------------------------------------------------------------- */
/*  Files — dropdown + progress                                                */
/* -------------------------------------------------------------------------- */

function FileActions() {
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
        <DropdownMenuItem className="ui-menu-item" data-fm-action="folder"><FolderPlus className="size-3.5" /> New folder</DropdownMenuItem>
        <DropdownMenuItem className="ui-menu-item" data-fm-action="upload"><FileUp className="size-3.5" /> Upload file</DropdownMenuItem>
        <DropdownMenuItem className="ui-menu-item" data-fm-action="notebook"><NotebookPen className="size-3.5" /> New notebook</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StorageProgress() {
  return <Progress value={36} className="ui-progress" aria-label="1.8 of 5 GB used" />
}

/* -------------------------------------------------------------------------- */
/*  Chat — switch wired to the existing demo toggle                           */
/* -------------------------------------------------------------------------- */

function AnonymousSwitch() {
  const [checked, setChecked] = useState(false)

  function toggle(value: boolean) {
    setChecked(value)
    document.getElementById("anonToggle")?.click()
  }

  return (
    <div className="anon-toggle ui-anon-toggle" aria-pressed={checked}>
      <Switch checked={checked} onCheckedChange={toggle} className="ui-switch" aria-label="Anonymous mode" />
      <div>
        <strong>Anonymous mode</strong>
        <small>{checked ? "On · pseudonymous display" : "Off · normal project chat"}</small>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Collaboration — avatar                                                    */
/* -------------------------------------------------------------------------- */

function PresenceAvatar() {
  return (
    <Avatar className="ui-avatar">
      <AvatarFallback className="ui-avatar-fallback">MR</AvatarFallback>
    </Avatar>
  )
}

/* -------------------------------------------------------------------------- */
/*  Pricing — shadcn cards                                                     */
/* -------------------------------------------------------------------------- */

const plans = [
  {
    name: "Hobby",
    price: "$0",
    tag: null,
    description: "For a single researcher or a project that's just getting started.",
    features: ["5 GB storage", "Lab, Search, Files, Agent, and Chat", "Automations and cron jobs", "20 agent requests per day"],
    cta: "Create your workspace",
    href: "#get-started",
    featured: true,
  },
  {
    name: "Enterprise",
    price: null,
    tag: "TALK TO US",
    description: "Custom features, dedicated support, and anything your organization needs.",
    features: ["Custom integrations and workflows", "Dedicated infrastructure and SLA", "Onboarding and training for your team"],
    cta: "Contact us",
    href: "about.html#contact",
    featured: false,
  },
]

function PlanCards() {
  return (
    <>
      {plans.map((plan) => (
        <Card key={plan.name} className={`ui-plan-card${plan.featured ? " ui-plan-card--featured" : ""}`}>
          <CardHeader className="ui-plan-header">
            <CardTitle className="ui-plan-name">{plan.name}</CardTitle>
            {plan.price ? <span className="ui-plan-price">{plan.price}</span> : <span className="ui-plan-tag">{plan.tag}</span>}
          </CardHeader>
          <CardContent className="ui-plan-content">
            <CardDescription className="ui-plan-desc">{plan.description}</CardDescription>
            <ul className="ui-plan-list">
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
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

/* -------------------------------------------------------------------------- */
/*  FAQ — accordion                                                            */
/* -------------------------------------------------------------------------- */

const questions = [
  {
    q: "What happens when I run out of free storage?",
    a: "Nothing is deleted. You can add storage on a team plan, or move older project outputs to your own archive. Spindle keeps the file tree and previews intact either way.",
  },
  {
    q: "Where does local search actually run?",
    a: "Academic and Basic modes query a SearXNG instance hosted alongside your Spindle workspace. Results, citations, and notes stay with the project instead of a browser profile.",
  },
  {
    q: "Can my whole lab work in one notebook?",
    a: "Yes. Lab sessions support shared kernels, live cursors, and comments in context, so a team can pair on an analysis without passing files back and forth.",
  },
]

function FaqAccordion() {
  return (
    <Accordion type="single" collapsible className="ui-faq">
      {questions.map((item, index) => (
        <AccordionItem key={item.q} value={`item-${index}`} className="ui-faq-item">
          <AccordionTrigger className="ui-faq-trigger">{item.q}</AccordionTrigger>
          <AccordionContent className="ui-faq-content">{item.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

/* -------------------------------------------------------------------------- */
/*  Footer — tooltips on social links                                          */
/* -------------------------------------------------------------------------- */

const socials = [
  { label: "GitHub", icon: "i-github", href: "#github" },
  { label: "X", icon: "i-x-social", href: "#x" },
  { label: "Discord", icon: "i-discord", href: "#discord" },
]

function SocialLinks() {
  return (
    <>
      {socials.map((social) => (
        <Tooltip key={social.label}>
          <TooltipTrigger asChild>
            <a href={social.href} aria-label={social.label}>
              <svg className="icon icon--sm" aria-hidden="true"><use href={`#${social.icon}`} /></svg>
            </a>
          </TooltipTrigger>
          <TooltipContent className="ui-tooltip">{social.label}</TooltipContent>
        </Tooltip>
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*  Boot                                                                       */
/* -------------------------------------------------------------------------- */

mount("ui-hero-badge", <HeroBadge />)
mount("ui-hero-status", <HeroStatus />)
mount("ui-hero-actions", <HeroActions />)
mount("ui-signin", <AuthDialog />)
mount("ui-feature-grid", <FeatureCards />)
mount("ui-local-note", <LocalSearchNote />)
mount("ui-fm-new", <FileActions />)
mount("ui-storage-progress", <StorageProgress />)
mount("ui-anon-switch", <AnonymousSwitch />)
mount("ui-globe-avatar", <PresenceAvatar />)
mount("ui-plan-cards", <PlanCards />)
mount("ui-faq", <FaqAccordion />)
mount("ui-socials", <SocialLinks />)

/* -------------------------------------------------------------------------- */
/*  Lab page — animated green dither fields                                    */
/* -------------------------------------------------------------------------- */

const labRamp = ["rgba(52, 78, 48, 0.4)", "#8fbb6c", "#dcf7ab"] as const

function LabHeroField() {
  return (
    <DitherField
      className="lab-dither"
      pattern="horizon"
      color={labRamp}
      dotSize={1.3}
      intensity={0.92}
      speed={0.7}
      fps={30}
    />
  )
}

function LabCtaField() {
  return (
    <DitherField
      className="lab-dither"
      pattern="glow"
      color={labRamp}
      dotSize={1.4}
      intensity={0.7}
      speed={0.45}
      fps={24}
    />
  )
}

mount("ui-lab-hero-field", <LabHeroField />)
mount("ui-lab-cta-field", <LabCtaField />)

/* -------------------------------------------------------------------------- */
/*  Globes — Magic UI canvas globe, recoloured for Spindle's green palette     */
/* -------------------------------------------------------------------------- */

mount("ui-home-globe", <Globe />)
mount("ui-collab-globe", <Globe />)
mount("ui-collab-bottom-globe", <Globe />)
