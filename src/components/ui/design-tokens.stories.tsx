import type { Meta, StoryObj } from "@storybook/react-vite"

/**
 * Design-token reference. Swatches read the live `--ui-*` custom properties,
 * so they respond to the Dark/Light toolbar global in the preview decorator.
 */

const SURFACES = [
  "--ui-background",
  "--ui-card",
  "--ui-popover",
  "--ui-secondary",
  "--ui-muted",
  "--ui-accent",
] as const

const TEXT = ["--ui-foreground", "--ui-muted-foreground"] as const

const BRAND = ["--ui-primary", "--ui-primary-foreground", "--ui-ring"] as const

const SEMANTIC = ["--ui-destructive", "--ui-destructive-foreground"] as const

const CHART = [
  "--ui-chart-1",
  "--ui-chart-2",
  "--ui-chart-3",
  "--ui-chart-4",
  "--ui-chart-5",
] as const

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="border-border h-14 w-24 rounded-md border"
        style={{ background: `var(${token})` }}
      />
      <span className="text-muted-foreground font-mono text-[10px]">{label}</span>
    </div>
  )
}

function Row({ title, tokens }: { title: string; tokens: readonly string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-wrap gap-3">
        {tokens.map((token) => (
          <Swatch key={token} token={token} label={token.replace("--ui-", "")} />
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: "Design Tokens",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const ColorTokens: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <Row title="Surfaces" tokens={SURFACES} />
      <Row title="Text" tokens={TEXT} />
      <Row title="Brand" tokens={BRAND} />
      <Row title="Semantic" tokens={SEMANTIC} />
      <Row title="Chart" tokens={CHART} />
      <Row title="App surfaces (--app-*)" tokens={APP_TOKENS} />
    </div>
  ),
}

const APP_TOKENS = [
  "--app-bg",
  "--app-panel",
  "--app-panel-alt",
  "--app-border",
  "--app-text",
  "--app-text-muted",
  "--app-accent",
  "--app-accent-strong",
  "--app-accent-soft",
  "--app-sidebar-bg",
  "--app-shadow",
] as const

/** Tailwind v4 spacing is a single `--spacing` base (0.25rem) multiplied by the
 *  step number, so the scale below mirrors `p-<n>` / `m-<n>` utilities. */
const SPACING_STEPS = [0, 1, 2, 3, 4, 6, 8, 12, 16] as const

export const SpacingTokens: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-3">
      {SPACING_STEPS.map((step) => (
        <div key={step} className="flex items-center gap-4">
          <span className="text-muted-foreground w-10 font-mono text-[10px]">
            {step === 0 ? "0" : step}
          </span>
          <div
            className="bg-primary/70 h-4 rounded-sm"
            style={{ width: `calc(var(--spacing) * ${step})` }}
          />
          <span className="text-muted-foreground font-mono text-[10px]">{step * 0.25}rem</span>
        </div>
      ))}
      <p className="text-muted-foreground text-xs">
        Base token: <code className="font-mono">--spacing</code> ={" "}
        <code className="font-mono">0.25rem</code> (Tailwind v4 default; not overridden in{" "}
        <code className="font-mono">src/app/styles/index.css</code>).
      </p>
    </div>
  ),
}

const TYPE_SCALE = [
  { label: "text-xs", className: "text-xs" },
  { label: "text-sm", className: "text-sm" },
  { label: "text-base", className: "text-base" },
  { label: "text-lg", className: "text-lg" },
  { label: "text-xl", className: "text-xl" },
  { label: "text-2xl", className: "text-2xl" },
] as const

export const TypographyTokens: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Scale</h3>
        <div className="grid gap-2">
          {TYPE_SCALE.map(({ label, className }) => (
            <div key={label} className="flex items-baseline gap-4">
              <span className="text-muted-foreground w-16 font-mono text-[10px]">{label}</span>
              <span className={className}>The quick brown fox — 0123456789</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Families</h3>
        <div className="grid gap-3">
          <p style={{ fontFamily: "var(--font)" }}>
            <span className="text-muted-foreground font-mono text-[10px]">--font · </span>
            Inter — body copy and UI labels.
          </p>
          <p style={{ fontFamily: "var(--mono)" }}>
            <span className="text-muted-foreground font-mono text-[10px]">--mono · </span>
            IBM Plex Mono — code, IDs, and micro-labels.
          </p>
        </div>
      </div>
    </div>
  ),
}

const RADII = [
  { label: "--radius-sm", token: "--radius-sm", demo: "rounded-sm" },
  { label: "--radius-md", token: "--radius-md", demo: "rounded-md" },
  { label: "--radius-lg (--ui-radius)", token: "--radius-lg", demo: "rounded-lg" },
  { label: "--radius-xl", token: "--radius-xl", demo: "rounded-xl" },
  { label: "--app-radius", token: "--radius", demo: "rounded-[var(--radius)]" },
  { label: "--app-radius-lg", token: "--radius-lg", demo: "rounded-[var(--radius-lg)]" },
] as const

export const RadiusTokens: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-6">
      {RADII.map(({ label, token, demo }) => (
        <div key={label} className="flex flex-col items-center gap-2">
          <div
            className={`border-primary bg-primary/20 size-16 border-2 ${demo}`}
            style={{ borderRadius: `var(${token})` }}
          />
          <span className="text-muted-foreground max-w-32 text-center font-mono text-[10px]">
            {label}
          </span>
        </div>
      ))}
    </div>
  ),
}
