import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useFilesWorkspace } from "@/lib/api"
import type { FilesWorkspace } from "@/lib/api/types"

import { FILES_NODE_DRAG_TYPE, FilesScreen } from "./files-screen"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: "",
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationMocks.push,
    // Emulate the URL catching up after a replace so search-param guards behave
    // like they do in the app.
    replace: vi.fn((href: string, options?: unknown) => {
      navigationMocks.replace(href, options)
      const queryIndex = href.indexOf("?")
      navigationMocks.search = queryIndex >= 0 ? href.slice(queryIndex + 1) : ""
    }),
  }),
  usePathname: () => "/projects/prj_01/files",
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, useFilesWorkspace: vi.fn() }
})

const filesQuery = vi.mocked(useFilesWorkspace)

function buildWorkspace(): FilesWorkspace {
  return {
    project: {
      id: "prj_01",
      name: "Coastal resilience",
      owner: "Mara",
      storageLimitBytes: 5 * 1024 ** 3,
    },
    files: [
      {
        id: "folder-data",
        name: "data",
        kind: "folder",
        parentId: null,
        mimeType: "inode/directory",
        sizeBytes: 0,
        owner: "Mara",
        updatedAt: "2026-11-18T16:20:00.000Z",
      },
      {
        id: "folder-raw",
        name: "raw",
        kind: "folder",
        parentId: "folder-data",
        mimeType: "inode/directory",
        sizeBytes: 0,
        owner: "Mara",
        updatedAt: "2026-11-18T16:25:00.000Z",
      },
      {
        id: "file-tidal",
        name: "tidal-2026.csv",
        kind: "file",
        parentId: null,
        mimeType: "text/csv",
        sizeBytes: 2_418_304,
        owner: "Mara",
        updatedAt: "2026-11-19T08:42:00.000Z",
        content: "site,salinity\nA-01,28.4",
      },
      {
        id: "file-notes",
        name: "notes.txt",
        kind: "file",
        parentId: null,
        mimeType: "text/plain",
        sizeBytes: 1_024,
        owner: "Theo",
        updatedAt: "2026-11-17T09:00:00.000Z",
      },
    ],
    uploads: [],
    storage: { usedBytes: 2_500_000, limitBytes: 5 * 1024 ** 3 },
  }
}

let lastActions: ReturnType<typeof useFilesWorkspace>["actions"]

function mockQuery(overrides: Partial<ReturnType<typeof useFilesWorkspace>> = {}) {
  lastActions = {
    createFolder: vi.fn().mockResolvedValue({ ok: true }),
    renameNode: vi.fn().mockResolvedValue({ ok: true }),
    moveNodes: vi.fn().mockResolvedValue({ ok: true }),
    trashNodes: vi.fn().mockResolvedValue({ ok: true }),
    restoreVersion: vi.fn().mockResolvedValue({ ok: true }),
    addUploads: vi.fn().mockResolvedValue({ ok: true, accepted: [], rejected: [] }),
    updateUpload: vi.fn().mockResolvedValue({ ok: true }),
  }
  filesQuery.mockReturnValue({
    status: "success",
    data: buildWorkspace(),
    error: undefined,
    isEmpty: false,
    isRetrying: false,
    refetch: vi.fn(),
    actions: lastActions,
    ...overrides,
  })
}

function createDataTransfer(initial: Record<string, string> = {}, files: File[] = []) {
  const store: Record<string, string> = { ...initial }
  return {
    types: [...Object.keys(store), ...(files.length > 0 ? ["Files"] : [])],
    files,
    effectAllowed: "",
    dropEffect: "",
    setData: (type: string, value: string) => {
      store[type] = value
    },
    getData: (type: string) => store[type] ?? "",
  }
}

/** Drag payload whose `types` already advertises the node drag type. */
function nodeDragDataTransfer() {
  return createDataTransfer({ [FILES_NODE_DRAG_TYPE]: "[]" })
}

function treeItemFor(name: string) {
  const tree = document.querySelector(".app-file-tree")
  if (!tree) throw new Error("folder tree not rendered")
  const button = within(tree as HTMLElement).getByRole("button", { name })
  const item = button.closest(".fm-tree-item")
  if (!item) throw new Error(`tree item for ${name} not found`)
  return item as HTMLElement
}

function rowFor(name: string) {
  const row = screen
    .getAllByText(name)
    .map((element) => element.closest(".fm-row"))
    .find((element) => element !== null)
  if (!row) throw new Error(`row for ${name} not found`)
  return row as HTMLElement
}

describe("FilesScreen", () => {
  beforeEach(() => {
    filesQuery.mockReset()
    navigationMocks.push.mockReset()
    navigationMocks.replace.mockReset()
    navigationMocks.search = ""
  })

  it("renders the breadcrumb, toolbar, and mock file rows", () => {
    mockQuery()

    const { container } = render(<FilesScreen projectId="prj_01" path={[]} />)

    expect(container.querySelector(".fm-breadcrumb")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New folder" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Filter this folder")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Grid" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sort/i })).toBeInTheDocument()

    expect(screen.getByText("tidal-2026.csv")).toBeInTheDocument()
    expect(screen.getByText("notes.txt")).toBeInTheDocument()
    expect(screen.getAllByText("data").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Mara").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Theo").length).toBeGreaterThan(0)
  })

  it("shows git badges, a branch indicator, and a changes panel", async () => {
    const workspace = buildWorkspace()
    workspace.git = {
      branch: "feature/tidal-survey",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    }
    const tidal = workspace.files.find((node) => node.id === "file-tidal")!
    const notes = workspace.files.find((node) => node.id === "file-notes")!
    const raw = workspace.files.find((node) => node.id === "folder-raw")!
    tidal.gitStatus = "modified"
    notes.gitStatus = "untracked"
    raw.gitStatus = "added"
    mockQuery({ data: workspace })

    render(<FilesScreen projectId="prj_01" path={[]} />)

    // Branch chip with ahead/behind sync counts.
    expect(screen.getByText("feature/tidal-survey")).toBeInTheDocument()
    expect(document.querySelector(".fm-git-branch-sync")).toHaveTextContent("↑2↓1")

    // Badges on dirty rows; the "data" folder aggregates its dirty child.
    expect(screen.getAllByLabelText("Git status: Modified").length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText("Git status: Untracked").length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText("Git status: Added").length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole("button", { name: /changes \(3\)/i }))

    const panel = document.querySelector(".fm-git-changes")
    expect(panel).toBeInTheDocument()
    const panelEl = panel as HTMLElement
    expect(within(panelEl).getByText("tidal-2026.csv")).toBeInTheDocument()
    expect(within(panelEl).getByText("notes.txt")).toBeInTheDocument()
    // folder-raw lives inside "data", so its row shows the directory path.
    expect(within(panelEl).getByText("data")).toBeInTheDocument()
    // Most severe status sorts first: modified before added before untracked.
    const names = Array.from(panelEl.querySelectorAll(".fm-git-change-name")).map(
      (element) => element.textContent,
    )
    expect(names).toEqual(["tidal-2026.csv", "raw", "notes.txt"])
  })

  it("hides git UI when the workspace has no VCS info", () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    expect(screen.queryByText("feature/tidal-survey")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /changes/i })).not.toBeInTheDocument()
    expect(document.querySelector(".fm-git-badge")).not.toBeInTheDocument()
  })

  it("shows owner avatars with initials in list and grid views", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const avatars = document.querySelectorAll(".fm-owner-avatar")
    expect(avatars.length).toBeGreaterThanOrEqual(3)
    expect(avatars[0]).toHaveTextContent("M")

    await userEvent.click(screen.getByRole("button", { name: "Grid" }))
    expect(document.querySelectorAll(".fm-owner-avatar").length).toBeGreaterThanOrEqual(3)
  })

  it("sorts via the toolbar sort menu", async () => {
    mockQuery()

    const { container } = render(<FilesScreen projectId="prj_01" path={[]} />)

    const rows = () =>
      Array.from(container.querySelectorAll(".fm-row")).map((row) => row.textContent ?? "")

    // Default sort is name ascending: data, notes.txt, tidal-2026.csv.
    expect(rows()[0]).toContain("data")
    expect(rows()[2]).toContain("tidal-2026.csv")

    await userEvent.click(screen.getByRole("button", { name: /sort/i }))
    const menu = screen.getByRole("menu")
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Owner" }))

    expect(screen.getByRole("button", { name: /sort/i })).toHaveTextContent("Owner")
    // Folders stay pinned first; files then sort by owner: Mara's tidal-2026.csv
    // before Theo's notes.txt.
    expect(rows()[0]).toContain("data")
    expect(rows()[1]).toContain("tidal-2026.csv")
    expect(rows()[2]).toContain("notes.txt")
  })

  it("reveals the bulk actions bar when rows are selected", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    expect(screen.queryByRole("toolbar", { name: "Selected items" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("checkbox", { name: "Select tidal-2026.csv" }))

    const bar = screen.getByRole("toolbar", { name: "Selected items" })
    expect(within(bar).getByText("1 selected")).toBeInTheDocument()
    expect(within(bar).getByRole("button", { name: "Download" })).toBeInTheDocument()
    expect(within(bar).getByRole("button", { name: "Move" })).toBeInTheDocument()
    expect(within(bar).getByRole("button", { name: "Trash" })).toBeInTheDocument()
  })

  it("opens the row actions menu with file operations", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    await userEvent.click(screen.getByRole("button", { name: "Actions for tidal-2026.csv" }))

    const menu = screen.getByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Download" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Move" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Trash" })).toBeInTheDocument()
  })

  it("shares a file with a workspace member and revokes the grant", async () => {
    window.localStorage.removeItem("spindle.files.shares:prj_01:v1")
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    await userEvent.click(screen.getByRole("button", { name: "Actions for tidal-2026.csv" }))
    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Share" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Share tidal-2026.csv")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Copy link" })).toBeInTheDocument()

    // The member roster resolves asynchronously from the mock adapter.
    const memberSelect = await within(dialog).findByLabelText("Add people")
    await userEvent.selectOptions(memberSelect, "usr_02")
    await userEvent.click(within(dialog).getByRole("button", { name: "Share" }))

    expect(within(dialog).getByText("Mara Chen")).toBeInTheDocument()
    const stored = window.localStorage.getItem("spindle.files.shares:prj_01:v1")
    expect(stored).toContain("usr_02")
    expect(stored).toContain("file-tidal")

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Revoke access for Mara Chen" }),
    )
    expect(within(dialog).getByText("No one has been added yet.")).toBeInTheDocument()
    window.localStorage.removeItem("spindle.files.shares:prj_01:v1")
  })

  it("navigates into folders through URL path segments", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const table = screen.getByRole("table", { name: "Files" })
    await userEvent.click(within(table).getByRole("button", { name: "data" }))

    expect(navigationMocks.push).toHaveBeenCalledWith("/projects/prj_01/files/data")
  })

  it("exposes tree semantics and supports arrow-key navigation", async () => {
    mockQuery()

    const { container } = render(<FilesScreen projectId="prj_01" path={[]} />)

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const rootItem = within(tree).getByRole("treeitem", { name: /project root/i })
    const folderItem = within(tree).getByRole("treeitem", { name: /data/i })
    expect(folderItem).toHaveAttribute("aria-expanded", "false")

    // Only the root treeitem is in the tab order (roving tabindex).
    expect(rootItem).toHaveAttribute("tabindex", "0")
    expect(folderItem).toHaveAttribute("tabindex", "-1")

    rootItem.focus()
    fireEvent.keyDown(rootItem, { key: "ArrowDown" })
    await waitFor(() => expect(folderItem).toHaveFocus())

    // ArrowRight expands the folder and reveals its child treeitem; a second
    // ArrowRight moves focus into the child, ArrowLeft returns to the parent.
    fireEvent.keyDown(folderItem, { key: "ArrowRight" })
    const childItem = await within(tree).findByRole("treeitem", { name: /raw/i })
    fireEvent.keyDown(folderItem, { key: "ArrowRight" })
    await waitFor(() => expect(childItem).toHaveFocus())
    fireEvent.keyDown(childItem, { key: "ArrowLeft" })
    await waitFor(() => expect(within(tree).getByRole("treeitem", { name: /data/i })).toHaveFocus())

    // Enter on a folder treeitem navigates into it.
    fireEvent.keyDown(folderItem, { key: "Enter" })
    expect(navigationMocks.push).toHaveBeenCalledWith("/projects/prj_01/files/data")

    // ArrowLeft on the expanded folder collapses it again.
    fireEvent.keyDown(folderItem, { key: "ArrowLeft" })
    await waitFor(() =>
      expect(container.querySelector(".fm-tree-children")).not.toBeInTheDocument(),
    )
  })

  it("supports Home/End and type-ahead in the folder tree", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const rootItem = within(tree).getByRole("treeitem", { name: /project root/i })
    const folderItem = () => within(tree).getByRole("treeitem", { name: /data/i })

    // Expand "data" so both "data" and its child "raw" are visible.
    await userEvent.click(within(tree).getByRole("button", { name: "Expand data" }))
    const rawItem = await within(tree).findByRole("treeitem", { name: /raw/i })

    // Home/End jump to the first and last visible treeitems.
    folderItem().focus()
    fireEvent.keyDown(folderItem(), { key: "End" })
    await waitFor(() => expect(rawItem).toHaveFocus())
    fireEvent.keyDown(rawItem, { key: "Home" })
    await waitFor(() => expect(rootItem).toHaveFocus())

    // Type-ahead: "d" moves to "data". The buffer resets after a short
    // window, so wait it out before the next sequence.
    fireEvent.keyDown(rootItem, { key: "d" })
    await waitFor(() => expect(folderItem()).toHaveFocus())
    await new Promise((resolve) => setTimeout(resolve, 800))
    fireEvent.keyDown(folderItem(), { key: "r" })
    await waitFor(() => expect(rawItem).toHaveFocus())

    // Buffered type-ahead: "da" still lands on "data" (search wraps around).
    await new Promise((resolve) => setTimeout(resolve, 800))
    fireEvent.keyDown(rawItem, { key: "Home" })
    await waitFor(() => expect(rootItem).toHaveFocus())
    fireEvent.keyDown(rootItem, { key: "d" })
    fireEvent.keyDown(rootItem, { key: "a" })
    await waitFor(() => expect(folderItem()).toHaveFocus())

    // Modified keys are not treated as type-ahead.
    fireEvent.keyDown(folderItem(), { key: "r", ctrlKey: true })
    expect(rawItem).not.toHaveFocus()
    expect(folderItem()).toHaveFocus()
  })

  it("opens the folder context menu from the treeitem via Shift+F10", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const folderItem = within(tree).getByRole("treeitem", { name: /data/i })
    folderItem.focus()
    fireEvent.keyDown(folderItem, { key: "F10", shiftKey: true })

    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Move" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Trash" })).toBeInTheDocument()
    // Folders have no Download action.
    expect(within(menu).queryByRole("menuitem", { name: "Download" })).not.toBeInTheDocument()
  })

  it("opens the root context menu via right-click and Shift+F10", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const rootItem = within(tree).getByRole("treeitem", { name: /project root/i })

    // Pointer path: right-clicking the root row opens its menu.
    fireEvent.contextMenu(rootItem.querySelector(".fm-tree-item") as HTMLElement)
    let menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "New folder" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Upload" })).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

    // Keyboard path: Shift+F10 on the focused root treeitem opens the same menu.
    rootItem.focus()
    fireEvent.keyDown(rootItem, { key: "F10", shiftKey: true })
    menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "New folder" })).toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "Upload" })).toBeInTheDocument()
  })

  it("moves a dragged file onto a folder in the tree", () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const dataTransfer = nodeDragDataTransfer()
    fireEvent.dragStart(rowFor("tidal-2026.csv"), { dataTransfer })
    const target = treeItemFor("data")
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(lastActions.moveNodes).toHaveBeenCalledWith(["file-tidal"], "folder-data")
  })

  it("moves a dragged file onto the current folder pane", () => {
    mockQuery()

    const { container } = render(<FilesScreen projectId="prj_01" path={[]} />)

    const dataTransfer = nodeDragDataTransfer()
    fireEvent.dragStart(rowFor("tidal-2026.csv"), { dataTransfer })
    const pane = container.querySelector(".app-file-pane") as HTMLElement
    fireEvent.drop(pane, { dataTransfer })

    expect(lastActions.moveNodes).toHaveBeenCalledWith(["file-tidal"], null)
  })

  it("drags a folder from the tree onto another folder", () => {
    const workspace = buildWorkspace()
    workspace.files.push({
      id: "folder-ops",
      name: "ops",
      kind: "folder",
      parentId: null,
      mimeType: "inode/directory",
      sizeBytes: 0,
      owner: "Mara",
      updatedAt: "2026-11-18T16:30:00.000Z",
    })
    mockQuery({ data: workspace })

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const dataTransfer = nodeDragDataTransfer()
    fireEvent.dragStart(treeItemFor("ops"), { dataTransfer })
    const target = treeItemFor("data")
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(lastActions.moveNodes).toHaveBeenCalledWith(["folder-ops"], "folder-data")
  })

  it("does not highlight a tree folder that cannot accept the dragged folder", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    // Expand "data" so its child "raw" is visible, then try dropping "data"
    // onto its own descendant — an invalid target.
    const tree = document.querySelector(".app-file-tree") as HTMLElement
    await userEvent.click(within(tree).getByRole("button", { name: "Expand data" }))

    const dataTransfer = nodeDragDataTransfer()
    fireEvent.dragStart(treeItemFor("data"), { dataTransfer })
    const target = treeItemFor("raw")
    fireEvent.dragOver(target, { dataTransfer })

    expect(target).not.toHaveClass("is-drop-target")
    expect(dataTransfer.dropEffect).toBe("none")

    fireEvent.drop(target, { dataTransfer })
    expect(lastActions.moveNodes).not.toHaveBeenCalled()
  })

  it("moves a folder onto an ancestor folder", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    // Expand "data" so its child "raw" is visible, then drop "raw" onto its
    // ancestor "data" — a valid move-up reparent.
    const tree = document.querySelector(".app-file-tree") as HTMLElement
    await userEvent.click(within(tree).getByRole("button", { name: "Expand data" }))

    const dataTransfer = nodeDragDataTransfer()
    fireEvent.dragStart(treeItemFor("raw"), { dataTransfer })
    const target = treeItemFor("data")
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(lastActions.moveNodes).toHaveBeenCalledWith(["folder-raw"], "folder-data")
  })

  it("refuses to drop a folder into itself", () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const dataTransfer = nodeDragDataTransfer()
    fireEvent.dragStart(rowFor("data"), { dataTransfer })
    const target = treeItemFor("data")
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(lastActions.moveNodes).not.toHaveBeenCalled()
  })

  it("opens the preview drawer for the ?preview= deep link", async () => {
    mockQuery()
    navigationMocks.search = "preview=file-tidal"

    render(<FilesScreen projectId="prj_01" path={[]} initialPreviewId="file-tidal" />)

    const drawer = await screen.findByRole("dialog")
    expect(within(drawer).getAllByText("tidal-2026.csv").length).toBeGreaterThan(0)
    // CSV files render the parsed-table preview, not the raw code view.
    expect(
      await within(drawer).findByRole("region", { name: "CSV parsed table preview" }),
    ).toBeInTheDocument()
    // The URL already carries the param, so no redundant navigation happens.
    expect(navigationMocks.replace).not.toHaveBeenCalled()
  })

  it("does not open the drawer for an unknown preview id", async () => {
    mockQuery()
    navigationMocks.search = "preview=missing-id"

    render(<FilesScreen projectId="prj_01" path={[]} initialPreviewId="missing-id" />)

    await waitFor(() => expect(screen.getByText("tidal-2026.csv")).toBeInTheDocument())
    expect(screen.queryByLabelText("File contents")).not.toBeInTheDocument()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
  })

  it("writes ?preview= when a file preview opens and removes it on close", async () => {
    mockQuery()
    navigationMocks.search = "filter=keep"

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const table = screen.getByRole("table", { name: "Files" })
    await userEvent.click(within(table).getByRole("button", { name: "tidal-2026.csv" }))

    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith(
        "/projects/prj_01/files?filter=keep&preview=file-tidal",
        { scroll: false },
      ),
    )

    const drawer = await screen.findByRole("dialog")
    await userEvent.click(within(drawer).getByRole("button", { name: "Close preview" }))

    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith("/projects/prj_01/files?filter=keep", {
        scroll: false,
      }),
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renames the previewed file from the drawer", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} initialPreviewId="file-tidal" />)

    const drawer = await screen.findByRole("dialog")
    await userEvent.click(within(drawer).getByRole("button", { name: "Rename file" }))
    const input = screen.getByLabelText("Rename file")
    await userEvent.clear(input)
    await userEvent.type(input, "renamed.csv")
    await userEvent.click(screen.getByRole("button", { name: "Save name" }))

    await waitFor(() =>
      expect(lastActions.renameNode).toHaveBeenCalledWith("file-tidal", "renamed.csv"),
    )
  })

  it("uploads OS files dropped onto a tree folder", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const file = new File(["site,salinity\n"], "new.csv", { type: "text/csv" })
    const dataTransfer = createDataTransfer({}, [file])
    const target = treeItemFor("data")
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    await waitFor(() => {
      expect(lastActions.addUploads).toHaveBeenCalledWith("folder-data", [
        expect.objectContaining({ name: "new.csv", sizeBytes: file.size }),
      ])
    })
  })

  it("filters the tree to matches plus their ancestors, force-expanding them", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const filterInput = screen.getByPlaceholderText("Filter files")

    // "raw" matches the nested folder; its parent "data" stays visible and is
    // force-expanded even though the user never expanded it.
    await userEvent.type(filterInput, "raw")

    const dataItem = within(tree).getByRole("treeitem", { name: "data" })
    expect(dataItem).toHaveAttribute("aria-expanded", "true")
    expect(within(tree).getByRole("treeitem", { name: "raw" })).toBeInTheDocument()
    // Non-matching nodes are hidden while the filter is active.
    expect(within(tree).queryByRole("treeitem", { name: "tidal-2026.csv" })).not.toBeInTheDocument()

    // File matches render as leaf treeitems too.
    await userEvent.clear(filterInput)
    await userEvent.type(filterInput, "tidal")
    expect(within(tree).getByRole("treeitem", { name: "tidal-2026.csv" })).toBeInTheDocument()
  })

  it("restores the user's expansion state when the tree filter clears", async () => {
    const workspace = buildWorkspace()
    workspace.files.push(
      {
        id: "folder-ops",
        name: "ops",
        kind: "folder",
        parentId: null,
        mimeType: "inode/directory",
        sizeBytes: 0,
        owner: "Mara",
        updatedAt: "2026-11-18T16:30:00.000Z",
      },
      {
        id: "folder-ops-archive",
        name: "archive",
        kind: "folder",
        parentId: "folder-ops",
        mimeType: "inode/directory",
        sizeBytes: 0,
        owner: "Mara",
        updatedAt: "2026-11-18T16:35:00.000Z",
      },
      {
        id: "file-ops-report",
        name: "ops-report.txt",
        kind: "file",
        parentId: "folder-ops-archive",
        mimeType: "text/plain",
        sizeBytes: 512,
        owner: "Mara",
        updatedAt: "2026-11-19T09:00:00.000Z",
        content: "report",
      },
    )
    mockQuery({ data: workspace })

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const tree = screen.getByRole("tree", { name: "Project folders" })
    // The user expands "data" before filtering; "ops" stays collapsed.
    await userEvent.click(within(tree).getByRole("button", { name: "Expand data" }))
    expect(within(tree).getByRole("treeitem", { name: "data" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )

    const filterInput = screen.getByPlaceholderText("Filter files")
    await userEvent.type(filterInput, "report")
    // "ops" and "archive" are forced ancestors of the match and expand while
    // filtering.
    expect(within(tree).getByRole("treeitem", { name: "ops" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(within(tree).getByRole("treeitem", { name: "ops-report.txt" })).toBeInTheDocument()

    await userEvent.clear(filterInput)

    // Clearing restores the user's expansion: "data" stays open, "ops" closes
    // (hiding its "archive" child again).
    expect(within(tree).getByRole("treeitem", { name: "data" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(within(tree).getByRole("treeitem", { name: "ops" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(within(tree).queryByRole("treeitem", { name: "archive" })).not.toBeInTheDocument()
  })

  it("opens the file preview from a filtered tree leaf via Enter and Space", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    await userEvent.type(screen.getByPlaceholderText("Filter files"), "tidal")

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const fileItem = () => within(tree).getByRole("treeitem", { name: "tidal-2026.csv" })

    fileItem().focus()
    fireEvent.keyDown(fileItem(), { key: "Enter" })
    const drawer = await screen.findByRole("dialog")
    expect(within(drawer).getAllByText("tidal-2026.csv").length).toBeGreaterThan(0)
    await userEvent.click(within(drawer).getByRole("button", { name: "Close preview" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    fileItem().focus()
    fireEvent.keyDown(fileItem(), { key: " " })
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("moves focus to the parent on ArrowLeft from a filter-forced ancestor", async () => {
    mockQuery()

    render(<FilesScreen projectId="prj_01" path={[]} />)

    await userEvent.type(screen.getByPlaceholderText("Filter files"), "raw")

    const tree = screen.getByRole("tree", { name: "Project folders" })
    const dataItem = () => within(tree).getByRole("treeitem", { name: "data" })
    const rootItem = within(tree).getByRole("treeitem", { name: /project root/i })

    // "data" is force-expanded as an ancestor of the "raw" match. Reach it via
    // keyboard navigation (like a real user) so the roving tabindex tracks it,
    // then ArrowLeft must skip the (ineffective) collapse and move to parent.
    rootItem.focus()
    fireEvent.keyDown(rootItem, { key: "ArrowDown" })
    await waitFor(() => expect(dataItem()).toHaveFocus())
    fireEvent.keyDown(dataItem(), { key: "ArrowLeft" })

    await waitFor(() => expect(rootItem).toHaveFocus())
    expect(dataItem()).toHaveAttribute("aria-expanded", "true")
    expect(within(tree).getByRole("treeitem", { name: "raw" })).toBeInTheDocument()
  })

  it("renders the upload queue with progress, summary, and controls", async () => {
    const workspace = buildWorkspace()
    workspace.uploads = [
      {
        id: "upload-1",
        parentId: null,
        name: "survey.csv",
        sizeBytes: 2048,
        mimeType: "text/csv",
        status: "uploading",
        progress: 40,
      },
      {
        id: "upload-2",
        parentId: null,
        name: "broken.bin",
        sizeBytes: 4096,
        mimeType: "application/octet-stream",
        status: "failed",
        progress: 10,
        error: "demo failure",
      },
    ]
    mockQuery({ data: workspace })

    render(<FilesScreen projectId="prj_01" path={[]} />)

    const bar = screen.getByRole("progressbar", { name: "survey.csv upload progress" })
    expect(bar).toHaveAttribute("aria-valuenow", "40")
    expect(screen.getByText(/2 uploads · 1 active · 1 failed/)).toBeInTheDocument()
    expect(screen.getByText("demo failure")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    expect(lastActions.updateUpload).toHaveBeenCalledWith("upload-1", "pause")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(lastActions.updateUpload).toHaveBeenCalledWith("upload-2", "retry")
  })

  it("does not flash an Uploaded row for uploads that were already done", () => {
    const workspace = buildWorkspace()
    workspace.uploads = [
      {
        id: "upload-old",
        parentId: null,
        name: "old.csv",
        sizeBytes: 1024,
        mimeType: "text/csv",
        status: "done",
        progress: 100,
      },
    ]
    mockQuery({ data: workspace })

    render(<FilesScreen projectId="prj_01" path={[]} />)

    expect(
      screen.queryByRole("progressbar", { name: "old.csv upload progress" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Uploaded/)).not.toBeInTheDocument()
  })

  it("shows a brief Uploaded row when a watched upload completes", async () => {
    const uploading = buildWorkspace()
    uploading.uploads = [
      {
        id: "upload-3",
        parentId: null,
        name: "done.csv",
        sizeBytes: 1024,
        mimeType: "text/csv",
        status: "uploading",
        progress: 90,
      },
    ]
    mockQuery({ data: uploading })

    const view = render(<FilesScreen projectId="prj_01" path={[]} />)
    expect(
      screen.getByRole("progressbar", { name: "done.csv upload progress" }),
    ).toBeInTheDocument()

    const completed = buildWorkspace()
    completed.uploads = [{ ...uploading.uploads[0], status: "done", progress: 100 }]
    mockQuery({ data: completed })
    view.rerender(<FilesScreen projectId="prj_01" path={[]} />)

    expect(await screen.findByText(/Uploaded · 100%/)).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "done.csv upload progress" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    )
  })
})
