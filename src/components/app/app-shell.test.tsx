import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { useToast } from "@/components/ui/toast"
import type { MockSessionData } from "@/lib/auth/mock-session"

import { AppShell } from "./app-shell"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/components/app/command-menu", () => ({
  CommandMenu: () => <div data-testid="command-menu" />,
}))

vi.mock("@/components/app/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}))

// The real bell polls /api/messages for the unread badge; the shell only
// owns its placement in the top bar.
vi.mock("@/components/app/messages-bell", () => ({
  MessagesBell: () => <div data-testid="messages-bell" />,
}))

vi.mock("@/components/auth/forced-reset-banner", () => ({
  ForcedResetBanner: () => <div data-testid="forced-reset-banner" />,
}))

vi.mock("@/components/admin/impersonation-banner", () => ({
  ImpersonationBanner: () => <div data-testid="impersonation-banner" />,
}))

// The real switcher fetches /api/workspaces; the shell only owns placement.
vi.mock("@/components/workspaces/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}))

const session: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function ToastProbe() {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast({ variant: "error", title: "Shell toast works" })}>
      fire-toast
    </button>
  )
}

function renderShell() {
  return render(
    <MockSessionProvider initialSession={session}>
      <AppShell>
        <ToastProbe />
      </AppShell>
    </MockSessionProvider>,
  )
}

beforeEach(() => {
  // The toast store is module-level; clear leftovers from earlier tests.
  const { result } = renderHook(() => useToast())
  act(() => result.current.dismiss())
})

describe("AppShell", () => {
  it("renders navigation, top bar, and page content", async () => {
    renderShell()

    expect(screen.getByRole("navigation", { name: "App navigation" })).toBeInTheDocument()
    expect(screen.getByRole("main")).toBeInTheDocument()
    // CommandMenu is code-split via next/dynamic, so it resolves asynchronously.
    expect(await screen.findByTestId("command-menu")).toBeInTheDocument()
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument()
    expect(screen.getByTestId("messages-bell")).toBeInTheDocument()
    expect(screen.getByTestId("forced-reset-banner")).toBeInTheDocument()
    // Mounted shell-wide so the impersonation banner follows the admin
    // onto non-admin pages once the session becomes the target user.
    expect(screen.getByTestId("impersonation-banner")).toBeInTheDocument()
    expect(screen.getByTestId("workspace-switcher")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "fire-toast" })).toBeInTheDocument()
  })

  it("mounts the Toaster so useToast calls render into a portal", async () => {
    renderShell()

    fireEvent.click(screen.getByRole("button", { name: "fire-toast" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Shell toast works")
    expect(alert).toHaveAttribute("data-slot", "toast")
    // Portaled to document.body, outside the shell markup.
    await waitFor(() => {
      expect(alert.closest(".app-shell")).toBeNull()
    })
  })
})
