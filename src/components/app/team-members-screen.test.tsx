import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MockSessionProvider } from "./mock-session-provider"
import type { MockSessionData } from "@/lib/auth/mock-session"
import { memberExportCsv, memberExportJson, TeamMembersScreen } from "./team-members-screen"

const ownerSession: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@northlight.dev" },
  workspace: { name: "Northlight Research", slug: "northlight" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function renderScreen(session: MockSessionData = ownerSession) {
  return render(
    <MockSessionProvider initialSession={session}>
      <TeamMembersScreen />
    </MockSessionProvider>,
  )
}

async function renderLoadedScreen(session?: MockSessionData) {
  renderScreen(session)
  // The members snapshot resolves through useApiQuery — wait for the seed.
  // Member names also appear in the activity log, so allow multiple matches.
  await screen.findAllByText("Bogdan Zogovic")
}

/** The "Members" panel — member names/emails also appear in the activity log. */
function membersSection() {
  return screen.getByRole("heading", { name: "Members" }).closest("section") as HTMLElement
}

describe("TeamMembersScreen", () => {
  it("renders mock members and pending invites", async () => {
    await renderLoadedScreen()

    expect(screen.getByRole("heading", { name: "Team members" })).toBeInTheDocument()
    expect(screen.getByText("mara@northlight.dev")).toBeInTheDocument()
    expect(screen.getByText("theo@northlight.dev")).toBeInTheDocument()
    expect(screen.getByText("ana@northlight.dev")).toBeInTheDocument()
  })

  it("changes a member role from the row dropdown", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "Change role for Mara Chen" }))
    await user.click(screen.getByRole("menuitem", { name: "Member" }))

    expect(screen.getByRole("button", { name: "Change role for Mara Chen" })).toHaveTextContent(
      "Member",
    )
    expect(screen.getByRole("status")).toHaveTextContent("Role for Mara Chen updated to Member.")
  })

  it("adds an invited email to pending invites", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "Invite member" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Email"), "new@northlight.dev")
    await user.selectOptions(within(dialog).getByLabelText("Role"), "admin")
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }))

    expect(await screen.findByText("new@northlight.dev")).toBeInTheDocument()
    // fetch is unreachable in jsdom, so the invite falls back to the local
    // preview — the announcement must say so rather than claim it was sent.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Invite for new@northlight.dev saved locally — the invitations API is unavailable.",
    )
  })

  it("surfaces API errors instead of faking a pending invite", async () => {
    const user = userEvent.setup()
    // Fresh Response per call: the screen issues several fetches (invites
    // list, analytics, the invite POST) and a Response body is single-use.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, code: "forbidden", message: "Sign in required." }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
      ),
    )
    try {
      await renderLoadedScreen()

      await user.click(screen.getByRole("button", { name: "Invite member" }))
      const dialog = await screen.findByRole("dialog")
      await user.type(within(dialog).getByLabelText("Email"), "blocked@northlight.dev")
      await user.click(within(dialog).getByRole("button", { name: "Send invite" }))

      // The server error is surfaced (announcement + toast) and NO fake
      // pending invite is created.
      expect((await screen.findAllByText("Sign in required.")).length).toBeGreaterThan(0)
      expect(screen.queryByText("blocked@northlight.dev")).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("uses the API invite when POST /api/invitations succeeds", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/invitations" && init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                invitation: {
                  id: "inv_api_1",
                  email: "api@northlight.dev",
                  role: "member",
                  status: "pending",
                  sentAt: "2026-11-20T12:00:00.000Z",
                  expiresAt: "2026-11-27T12:00:00.000Z",
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          )
        }
        // The pending-invites merge GET and anything else: empty list.
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, invitations: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }),
    )
    try {
      await renderLoadedScreen()

      await user.click(screen.getByRole("button", { name: "Invite member" }))
      const dialog = await screen.findByRole("dialog")
      await user.type(within(dialog).getByLabelText("Email"), "api@northlight.dev")
      await user.click(within(dialog).getByRole("button", { name: "Send invite" }))

      expect(await screen.findByText("api@northlight.dev")).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("Invite sent to api@northlight.dev.")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("surfaces resend API errors instead of faking a local resend", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/resend")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                code: "accept_failed",
                message: "Couldn't resend the invite. Try again.",
              }),
              { status: 500, headers: { "content-type": "application/json" } },
            ),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, invitations: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }),
    )
    try {
      await renderLoadedScreen()

      await user.click(screen.getByRole("button", { name: "Resend invite to theo@northlight.dev" }))

      // The server message is surfaced and NO local re-date is claimed.
      expect(
        (await screen.findAllByText("Couldn't resend the invite. Try again.")).length,
      ).toBeGreaterThan(0)
      expect(
        screen.queryByText(/Invite resend for theo@northlight\.dev saved locally/),
      ).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("falls back to the local preview when the resend API is unreachable", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    try {
      await renderLoadedScreen()

      await user.click(screen.getByRole("button", { name: "Resend invite to theo@northlight.dev" }))

      expect(screen.getByRole("status")).toHaveTextContent(
        "Invite resend for theo@northlight.dev saved locally — API unavailable.",
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("removes a member after confirmation", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "Remove Mara Chen" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Remove member" }))

    // The activity log keeps a "joined"/"removed" trail, so check the roster only.
    expect(within(membersSection()).queryByText("Mara Chen")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Mara Chen was removed")
  })

  it("paginates the members table", async () => {
    await renderLoadedScreen()

    // DataTable pagination is enabled by default; with four members it shows
    // a single page plus the rows-per-page control.
    expect(screen.getByText("Showing 1–4 of 4")).toBeInTheDocument()
    expect(screen.getByLabelText("Rows per page")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "First page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Last page" })).toBeDisabled()
  })

  it("filters members by role", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.selectOptions(screen.getByLabelText("Filter members by role"), "member")

    const members = within(membersSection())
    expect(members.queryByText("Mara Chen")).not.toBeInTheDocument()
    expect(members.getByText("Ilya Petrov")).toBeInTheDocument()
    expect(members.getByText("June Park")).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("Filter members by role"), "all")
    expect(members.getByText("Mara Chen")).toBeInTheDocument()
  })

  it("filters members by status", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.selectOptions(screen.getByLabelText("Filter members by status"), "away")

    const members = within(membersSection())
    expect(members.getByText("Ilya Petrov")).toBeInTheDocument()
    expect(members.queryByText("Bogdan Zogovic")).not.toBeInTheDocument()
    expect(members.queryByText("Mara Chen")).not.toBeInTheDocument()
    expect(members.queryByText("June Park")).not.toBeInTheDocument()

    // Status composes with the role filter: Ilya is the only away member,
    // and June is a member but offline, so both filters leave just Ilya.
    await user.selectOptions(screen.getByLabelText("Filter members by role"), "member")
    expect(members.getByText("Ilya Petrov")).toBeInTheDocument()
    expect(members.queryByText("June Park")).not.toBeInTheDocument()
    expect(members.queryByText("Bogdan Zogovic")).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("Filter members by status"), "all")
    await user.selectOptions(screen.getByLabelText("Filter members by role"), "all")
    expect(members.getByText("Bogdan Zogovic")).toBeInTheDocument()
  })

  it("searches members by name, email, and role", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    const members = within(membersSection())
    const search = screen.getByRole("searchbox", { name: "Search members…" })

    await user.type(search, "mara")
    expect(members.getByText("Mara Chen")).toBeInTheDocument()
    expect(members.queryByText("Ilya Petrov")).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, "june@northlight.dev")
    expect(members.getByText("June Park")).toBeInTheDocument()
    expect(members.queryByText("Mara Chen")).not.toBeInTheDocument()

    // Role labels are searchable too — "admin" matches Mara's role badge.
    await user.clear(search)
    await user.type(search, "admin")
    expect(members.getByText("Mara Chen")).toBeInTheDocument()
    expect(members.queryByText("Ilya Petrov")).not.toBeInTheDocument()

    // No match shows the filtered empty state.
    await user.clear(search)
    await user.type(search, "zzz")
    expect(members.getByText(/No members match the current search or filters/)).toBeInTheDocument()
  })

  it("revokes a pending invite after confirmation", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "Revoke invite to theo@northlight.dev" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }))

    expect(screen.queryByText("theo@northlight.dev")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Invite for theo@northlight.dev was revoked.",
    )
  })

  it("hides member-management actions for a member-role session", async () => {
    await renderLoadedScreen({
      user: { name: "June Park", email: "june@northlight.dev" },
      workspace: { name: "Northlight Research", slug: "northlight" },
      signedInAt: "2026-11-19T12:00:00.000Z",
    })

    // Members keep read access: the roster and invites still render, but no
    // mutating controls are offered.
    expect(within(membersSection()).getByText("Mara Chen")).toBeInTheDocument()
    expect(screen.getByText("theo@northlight.dev")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove Mara Chen" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Change role for Mara Chen" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Revoke invite to theo@northlight.dev" }),
    ).not.toBeInTheDocument()
  })

  it("shows a member activity log seeded from the snapshot", async () => {
    await renderLoadedScreen()

    const activity = screen.getByRole("heading", { name: "Activity" }).closest("section")
    expect(activity).not.toBeNull()
    // One "joined" event per seeded member plus one "invited" per pending invite.
    expect(within(activity as HTMLElement).getAllByText(/joined the workspace/)).toHaveLength(4)
    expect(within(activity as HTMLElement).getAllByText(/sent an invite to/)).toHaveLength(2)
  })

  it("appends role changes and removals to the activity log", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    const activity = () =>
      screen.getByRole("heading", { name: "Activity" }).closest("section") as HTMLElement

    await user.click(screen.getByRole("button", { name: "Change role for Mara Chen" }))
    await user.click(screen.getByRole("menuitem", { name: "Member" }))
    expect(within(activity()).getByText(/changed Mara Chen's role/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Remove Ilya Petrov" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Remove member" }))
    // The removed member's name also appears in their earlier "joined" event,
    // so match the removal target (name + email) specifically.
    expect(within(activity()).getByText(/Ilya Petrov \(ilya@northlight\.dev\)/)).toBeInTheDocument()
  })

  it("opens a member detail dialog with facts and their activity", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "View details for Mara Chen" }))
    const dialog = await screen.findByRole("dialog")

    // The email shows in both the dialog description and the facts list.
    expect(within(dialog).getAllByText("mara@northlight.dev").length).toBeGreaterThan(0)
    expect(within(dialog).getByText("Joined")).toBeInTheDocument()
    expect(within(dialog).getByText("Workspace role")).toBeInTheDocument()
    // Only Mara's own membership events are listed inside the dialog.
    expect(within(dialog).getByText(/joined the workspace/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/sent an invite to/)).not.toBeInTheDocument()
  })

  it("changes a member role from the detail dialog", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "View details for Ilya Petrov" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Change role for Ilya Petrov" }))
    await user.click(screen.getByRole("menuitem", { name: "Admin" }))

    // The live-region announcement sits outside the modal dialog, so it is
    // aria-hidden while the dialog is open — assert on the text instead.
    expect(screen.getByText("Role for Ilya Petrov updated to Admin.")).toBeInTheDocument()
    // The open dialog reflects the new role without reopening.
    expect(
      within(dialog).getByRole("button", { name: "Change role for Ilya Petrov" }),
    ).toHaveTextContent("Admin")
  })

  it("removes a member from the detail dialog after confirmation", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("button", { name: "View details for June Park" }))
    const detail = await screen.findByRole("dialog")
    await user.click(within(detail).getByRole("button", { name: "Remove member" }))

    // The detail dialog hands off to the shared removal confirmation; pick the
    // dialog that carries the confirmation copy in case the detail dialog is
    // still mounted during its exit animation.
    const dialogs = await screen.findAllByRole("dialog")
    const confirm = dialogs.find((candidate) =>
      within(candidate).queryByText(/will lose access/),
    ) as HTMLElement
    await user.click(within(confirm).getByRole("button", { name: "Remove member" }))

    expect(within(membersSection()).queryByText("June Park")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("June Park was removed")
  })

  it("limits an admin session to member rows and non-owner invite roles", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen({
      user: { name: "Mara Chen", email: "mara@northlight.dev" },
      workspace: { name: "Northlight Research", slug: "northlight" },
      signedInAt: "2026-11-19T12:00:00.000Z",
    })

    // Admins can manage member rows…
    expect(screen.getByRole("button", { name: "Remove Ilya Petrov" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change role for Ilya Petrov" })).toBeInTheDocument()
    // …but not owners, peer admins, or themselves.
    expect(screen.queryByRole("button", { name: "Remove Bogdan Zogovic" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove Mara Chen" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Change role for Bogdan Zogovic" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Change role for Mara Chen" }),
    ).not.toBeInTheDocument()

    // The invite dialog never offers the owner role to an admin.
    await user.click(screen.getByRole("button", { name: "Invite member" }))
    const dialog = await screen.findByRole("dialog")
    const roleSelect = within(dialog).getByLabelText("Role")
    expect(within(roleSelect).queryByRole("option", { name: "Owner" })).not.toBeInTheDocument()
    expect(within(roleSelect).getByRole("option", { name: "Admin" })).toBeInTheDocument()
    expect(within(roleSelect).getByRole("option", { name: "Member" })).toBeInTheDocument()
  })

  it("changes roles for selected members in bulk", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    // Select-all picks up the whole roster. Promoting everyone to Owner is
    // the only bulk change with more than one eligible target in the seed
    // data: Bogdan is already owner, and the last-owner guard blocks demoting
    // him to anything else.
    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }))

    const bar = screen.getByRole("toolbar", { name: "Selected members" })
    expect(within(bar).getByText(/4 selected/)).toBeInTheDocument()

    await user.click(within(bar).getByRole("button", { name: "Change role for selected members" }))
    await user.click(await screen.findByRole("menuitem", { name: /Owner/ }))

    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText(/Mara Chen, Ilya Petrov, June Park will be set to Owner/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Change roles" }))

    const members = within(membersSection())
    expect(members.getByRole("button", { name: "Change role for Mara Chen" })).toHaveTextContent(
      "Owner",
    )
    expect(members.getByRole("button", { name: "Change role for Ilya Petrov" })).toHaveTextContent(
      "Owner",
    )
    expect(screen.getByRole("status")).toHaveTextContent("Role updated to Owner for 3 members.")
    // Selection clears once the action completes.
    expect(screen.queryByRole("toolbar", { name: "Selected members" })).not.toBeInTheDocument()
  })

  it("removes selected members in bulk after confirmation", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen()

    await user.click(screen.getByRole("checkbox", { name: "Select row 2" }))
    await user.click(screen.getByRole("checkbox", { name: "Select row 3" }))

    const bar = screen.getByRole("toolbar", { name: "Selected members" })
    await user.click(within(bar).getByRole("button", { name: "Remove selected members" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/will lose access/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Remove members" }))

    const members = within(membersSection())
    expect(members.queryByText("Mara Chen")).not.toBeInTheDocument()
    expect(members.queryByText("Ilya Petrov")).not.toBeInTheDocument()
    expect(members.getByText("Bogdan Zogovic")).toBeInTheDocument()
    expect(members.getByText("June Park")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("2 members removed")
  })

  it("skips members the actor cannot manage during a bulk role change", async () => {
    const user = userEvent.setup()
    await renderLoadedScreen({
      user: { name: "Mara Chen", email: "mara@northlight.dev" },
      workspace: { name: "Northlight Research", slug: "northlight" },
      signedInAt: "2026-11-19T12:00:00.000Z",
    })

    // Select-all picks up the whole roster, including the owner and peer admin
    // rows the admin actor cannot touch.
    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }))

    const bar = screen.getByRole("toolbar", { name: "Selected members" })
    await user.click(within(bar).getByRole("button", { name: "Change role for selected members" }))
    // Admins can never grant Owner — the option is not even listed.
    expect(await screen.findByRole("menuitem", { name: /Admin/ })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: /Owner/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole("menuitem", { name: /Admin/ }))

    const dialog = await screen.findByRole("dialog")
    // Only the two member-role rows are eligible for an admin actor.
    expect(
      within(dialog).getByText(/Ilya Petrov, June Park will be set to Admin/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Change roles" }))

    // Promoted rows are now peer admins, so the admin actor gets a plain
    // badge (no menu trigger) — verify the change through the activity log
    // instead, which also proves the owner and peer admin were untouched.
    const activity = screen.getByRole("heading", { name: "Activity" }).closest("section")
    expect(activity).not.toBeNull()
    expect(
      within(activity as HTMLElement).getByText(/changed Ilya Petrov's role/),
    ).toBeInTheDocument()
    expect(
      within(activity as HTMLElement).getByText(/changed June Park's role/),
    ).toBeInTheDocument()
    expect(
      within(activity as HTMLElement).queryByText(/changed Mara Chen's role/),
    ).not.toBeInTheDocument()
    expect(
      within(activity as HTMLElement).queryByText(/changed Bogdan Zogovic's role/),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Role updated to Admin for 2 members.")
  })

  it("only names the owners a bulk action can actually touch when two owners are selected", async () => {
    const user = userEvent.setup()
    // The actor is an owner resolved from the session (not a roster row), so
    // the self-guard doesn't exclude them and both roster owners are eligible
    // per-member — the sequential last-owner budget is what limits the set.
    await renderLoadedScreen({
      user: { name: "Ops Owner", email: "ops@northlight.dev" },
      workspace: { name: "Northlight Research", slug: "northlight", role: "owner" },
      signedInAt: "2026-11-19T12:00:00.000Z",
    })

    // Promote Mara to a second owner so the roster has two owners.
    await user.click(screen.getByRole("button", { name: "Change role for Mara Chen" }))
    await user.click(screen.getByRole("menuitem", { name: /Owner/ }))
    expect(screen.getByRole("button", { name: "Change role for Mara Chen" })).toHaveTextContent(
      "Owner",
    )

    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }))
    const bar = screen.getByRole("toolbar", { name: "Selected members" })
    expect(within(bar).getByText(/4 selected · 3 removable/)).toBeInTheDocument()

    // The remove dialog must name only the three members that will actually
    // be removed — the second owner is skipped by the last-owner budget.
    await user.click(within(bar).getByRole("button", { name: "Remove selected members" }))
    let dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Bogdan Zogovic, Ilya Petrov, June Park will lose access")
    expect(dialog).not.toHaveTextContent("Mara Chen")
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))

    // Same for the bulk role-change dialog: Ilya and June are already
    // members, and only one owner can be demoted — so Bogdan is the sole
    // target and Mara is skipped by the last-owner budget.
    await user.click(within(bar).getByRole("button", { name: "Change role for selected members" }))
    await user.click(await screen.findByRole("menuitem", { name: /Member/ }))
    dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Bogdan Zogovic will be set to Member")
    expect(dialog).not.toHaveTextContent("Mara Chen")
    expect(dialog).not.toHaveTextContent("Ilya Petrov")
    await user.click(within(dialog).getByRole("button", { name: "Change roles" }))

    expect(screen.getByRole("status")).toHaveTextContent("Role updated to Member for 1 member.")
    const members = within(membersSection())
    // Mara keeps the owner role; Bogdan was demoted to member.
    expect(members.getByRole("button", { name: "Change role for Mara Chen" })).toHaveTextContent(
      "Owner",
    )
    expect(
      members.getByRole("button", { name: "Change role for Bogdan Zogovic" }),
    ).toHaveTextContent("Member")
  })

  it("hides row selection for a member-role session", async () => {
    await renderLoadedScreen({
      user: { name: "June Park", email: "june@northlight.dev" },
      workspace: { name: "Northlight Research", slug: "northlight" },
      signedInAt: "2026-11-19T12:00:00.000Z",
    })

    expect(screen.queryByRole("checkbox", { name: "Select all rows" })).not.toBeInTheDocument()
    expect(screen.queryByRole("toolbar", { name: "Selected members" })).not.toBeInTheDocument()
  })

  it("exports the members matching the current role filter as CSV", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    await renderLoadedScreen()
    await userEvent.selectOptions(screen.getByLabelText("Filter members by role"), "member")
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    expect(blob.type).toBe("text/csv;charset=utf-8")
    const csv = await blob.text()
    expect(csv).toContain('"name","email","role","status","joinedAt"')
    expect(csv).toContain('"Ilya Petrov","ilya@northlight.dev","Member","Away"')
    expect(csv).not.toContain("Bogdan Zogovic")
    expect(csv).not.toContain("Mara Chen")
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("exports the members as JSON", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    await renderLoadedScreen()
    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    expect(blob.type).toBe("application/json")
    expect(JSON.parse(await blob.text())).toEqual([
      {
        name: "Bogdan Zogovic",
        email: "bogdan@northlight.dev",
        role: "Owner",
        status: "Active",
        joinedAt: "2026-01-12T09:00:00.000Z",
      },
      {
        name: "Mara Chen",
        email: "mara@northlight.dev",
        role: "Admin",
        status: "Active",
        joinedAt: "2026-05-11T15:30:00.000Z",
      },
      {
        name: "Ilya Petrov",
        email: "ilya@northlight.dev",
        role: "Member",
        status: "Away",
        joinedAt: "2026-06-02T09:45:00.000Z",
      },
      {
        name: "June Park",
        email: "june@northlight.dev",
        role: "Member",
        status: "Offline",
        joinedAt: "2026-07-19T11:15:00.000Z",
      },
    ])
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })
})

describe("memberExportCsv", () => {
  it("writes one row per member with name, email, role, status, and joinedAt", () => {
    const csv = memberExportCsv([
      {
        id: "mem_01",
        name: 'Bogdan "Zogovic"',
        email: "bogdan@northlight.dev",
        role: "owner",
        status: "active",
        joinedAt: "2026-01-12T09:00:00.000Z",
      },
    ])

    expect(csv).toBe(
      '"name","email","role","status","joinedAt"\n' +
        '"Bogdan ""Zogovic""","bogdan@northlight.dev","Owner","Active","2026-01-12T09:00:00.000Z"',
    )
  })
})

describe("memberExportJson", () => {
  it("serializes the exported fields per member", () => {
    expect(
      JSON.parse(
        memberExportJson([
          {
            id: "mem_01",
            name: "Mara Chen",
            email: "mara@northlight.dev",
            role: "admin",
            status: "away",
            joinedAt: "2026-05-11T15:30:00.000Z",
          },
        ]),
      ),
    ).toEqual([
      {
        name: "Mara Chen",
        email: "mara@northlight.dev",
        role: "Admin",
        status: "Away",
        joinedAt: "2026-05-11T15:30:00.000Z",
      },
    ])
  })
})
