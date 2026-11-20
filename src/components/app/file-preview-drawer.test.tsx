import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { FileNode } from "@/lib/api/types"

import { FilePreviewDrawer } from "./file-preview-drawer"

const folder: FileNode = {
  id: "folder-notebooks",
  name: "notebooks",
  kind: "folder",
  parentId: null,
  mimeType: "inode/directory",
  sizeBytes: 0,
  owner: "Theo",
  updatedAt: "2026-11-18T15:10:00.000Z",
}

const markdownFile: FileNode = {
  id: "file-field-notes",
  name: "field-notes.md",
  kind: "file",
  parentId: "folder-notebooks",
  mimeType: "text/markdown",
  sizeBytes: 12_904,
  owner: "Mara",
  updatedAt: "2026-11-19T09:21:00.000Z",
  content:
    "# Field notes\n\nTransect **04** is ready for the next pass.\n\n- Check gauge\n- Log salinity",
}

const codeFile: FileNode = {
  id: "file-tidal",
  name: "tidal-2026.txt",
  kind: "file",
  parentId: "folder-data",
  mimeType: "text/plain",
  sizeBytes: 2_418_304,
  owner: "Mara",
  updatedAt: "2026-11-19T08:42:00.000Z",
  content: "site,salinity\nA-01,28.4",
}

const csvFile: FileNode = {
  id: "file-readings",
  name: "readings.csv",
  kind: "file",
  parentId: "folder-data",
  mimeType: "text/csv",
  sizeBytes: 1_204,
  owner: "Mara",
  updatedAt: "2026-11-19T08:50:00.000Z",
  content: 'site,salinity,note\nA-01,28.4,"intake, north"\nB-02,31.0,ok',
}

const tsvFile: FileNode = {
  id: "file-export",
  name: "export.tsv",
  kind: "file",
  parentId: "folder-data",
  mimeType: "text/tab-separated-values",
  sizeBytes: 640,
  owner: "Jules",
  updatedAt: "2026-11-19T09:00:00.000Z",
  content: "site\tsalinity\nA-01\t28.4",
}

const imageFile: FileNode = {
  id: "file-figure",
  name: "recovery-map.png",
  kind: "file",
  parentId: "folder-outputs",
  mimeType: "image/png",
  sizeBytes: 1_204_736,
  owner: "Jules",
  updatedAt: "2026-11-18T17:05:00.000Z",
}

const files = [folder, markdownFile, codeFile, csvFile, tsvFile, imageFile]

function renderDrawer(
  file: FileNode,
  overrides: Partial<Parameters<typeof FilePreviewDrawer>[0]> = {},
) {
  const props = {
    file,
    files,
    projectId: "coastal-resilience",
    onClose: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<FilePreviewDrawer {...props} />)
  return props
}

describe("FilePreviewDrawer", () => {
  it("shows the file metadata header and folder path", async () => {
    renderDrawer(markdownFile)

    expect(screen.getByText("field-notes.md")).toBeInTheDocument()
    expect(screen.getByText(/Text ·/)).toBeInTheDocument()
    expect(screen.getByText("notebooks")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Field notes" })).toBeInTheDocument(),
    )
  })

  it("renders markdown content as formatted blocks", async () => {
    renderDrawer(markdownFile)

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Field notes" })).toBeInTheDocument(),
    )
    expect(screen.getByText("04")).toBeInTheDocument()
    expect(screen.getByText("Check gauge")).toBeInTheDocument()
  })

  it("renders safe markdown links as anchors", async () => {
    const linkedFile: FileNode = {
      ...markdownFile,
      id: "file-links",
      name: "links.md",
      content: "See [the docs](https://example.com/docs) and [mail](mailto:a@b.c).",
    }
    renderDrawer(linkedFile)

    const docs = await screen.findByRole("link", { name: "the docs" })
    expect(docs).toHaveAttribute("href", "https://example.com/docs")
    expect(screen.getByRole("link", { name: "mail" })).toHaveAttribute("href", "mailto:a@b.c")
  })

  it("does not render javascript: or data: markdown links as anchors", async () => {
    const hostileFile: FileNode = {
      ...markdownFile,
      id: "file-hostile",
      name: "hostile.md",
      content:
        "Click [here](javascript:alert(1)) or [payload](data:text/html,<script>alert(1)</script>) now.",
    }
    renderDrawer(hostileFile)

    await waitFor(() => expect(screen.getByText("here")).toBeInTheDocument())
    expect(screen.queryByRole("link", { name: "here" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "payload" })).not.toBeInTheDocument()
    // The label text is still rendered, just not as a clickable link.
    expect(screen.getByText("payload")).toBeInTheDocument()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(document.querySelector('a[href^="data:"]')).toBeNull()
  })

  it("does not navigate to a javascript: version download URL", async () => {
    const user = userEvent.setup()
    const props = renderDrawer(markdownFile, {
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Mara",
          url: "javascript:alert(1)",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    await user.click(within(history).getAllByRole("button", { name: /Download/ })[1])

    // Unsafe version URLs fall back to the regular download handler instead of
    // being assigned to an anchor href.
    expect(props.onDownload).toHaveBeenCalledWith(markdownFile)
  })

  it("renders text files in a code block", async () => {
    renderDrawer(codeFile)

    await waitFor(() => expect(screen.getByText("A-01,28.4")).toBeInTheDocument())
    expect(screen.getByLabelText("File contents")).toBeInTheDocument()
  })

  it("renders CSV content as an accessible table", async () => {
    renderDrawer(csvFile)

    const region = await screen.findByRole("region", {
      name: "CSV parsed table preview",
    })
    expect(within(region).getByRole("columnheader", { name: "site" })).toBeInTheDocument()
    expect(within(region).getByRole("columnheader", { name: "salinity" })).toBeInTheDocument()
    // Quoted field keeps its embedded comma as a single cell.
    expect(within(region).getByRole("cell", { name: "intake, north" })).toBeInTheDocument()
    expect(within(region).getByRole("cell", { name: "B-02" })).toBeInTheDocument()
  })

  it("renders TSV content as a table using tab delimiters", async () => {
    renderDrawer(tsvFile)

    const region = await screen.findByRole("region", {
      name: "TSV parsed table preview",
    })
    expect(within(region).getByRole("columnheader", { name: "site" })).toBeInTheDocument()
    expect(within(region).getByRole("cell", { name: "28.4" })).toBeInTheDocument()
  })

  it("truncates large delimited files and notes the limit", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => `S-${index},1.0`).join("\n")
    const bigCsv: FileNode = {
      ...csvFile,
      id: "file-big",
      name: "big.csv",
      content: `site,salinity\n${rows}`,
    }
    renderDrawer(bigCsv)

    const region = await screen.findByRole("region", {
      name: "CSV parsed table preview",
    })
    expect(screen.getByText(/Showing the first 200 rows/)).toBeInTheDocument()
    expect(within(region).getAllByRole("row")).toHaveLength(201)
  })

  it("shows a placeholder for image files without content", async () => {
    renderDrawer(imageFile)

    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "recovery-map.png image preview placeholder" }),
      ).toBeInTheDocument(),
    )
  })

  it("shows a fallback note for files without previewable content", async () => {
    const binary: FileNode = { ...imageFile, id: "file-parquet", name: "survey.parquet" }
    renderDrawer(binary)

    await waitFor(() => expect(screen.getByText(/Preview is not available/)).toBeInTheDocument())
  })

  it("invokes the download and delete actions", async () => {
    const user = userEvent.setup()
    const props = renderDrawer(markdownFile)

    await user.click(await screen.findByRole("button", { name: /Download/ }))
    expect(props.onDownload).toHaveBeenCalledWith(markdownFile)

    await user.click(screen.getByRole("button", { name: /Delete/ }))
    expect(props.onDelete).toHaveBeenCalledWith(markdownFile)
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    const props = renderDrawer(markdownFile)

    await user.keyboard("{Escape}")
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it("renders version history and previews a selected version", async () => {
    const user = userEvent.setup()
    renderDrawer(markdownFile, {
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Mara",
          sizeBytes: 9_000,
          content: "# Field notes\n\nOld draft body.",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    expect(history).toHaveTextContent("v1")

    await user.click(within(history).getByRole("button", { name: "View" }))

    // The preview swaps to the historical content and shows the banner.
    expect(await screen.findByText(/Viewing version v1/)).toBeInTheDocument()
    expect(await screen.findByText("Old draft body.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Back to current" }))
    await waitFor(() => expect(screen.queryByText(/Viewing version v1/)).not.toBeInTheDocument())
  })

  it("shows a line diff between a version and the current content", async () => {
    const user = userEvent.setup()
    renderDrawer(markdownFile, {
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Mara",
          sizeBytes: 9_000,
          content: "# Field notes\n\nOld draft body.\n- Check gauge",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    await user.click(within(history).getByRole("button", { name: "Diff" }))

    const diff = await screen.findByRole("region", { name: "File diff" })
    expect(diff).toHaveTextContent("Old draft body.")
    expect(diff).toHaveTextContent("Transect")
    await user.click(within(history).getByRole("button", { name: "Hide diff" }))
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "File diff" })).not.toBeInTheDocument(),
    )
  })

  it("does not offer Diff or Restore for versions without a snapshot", async () => {
    renderDrawer(markdownFile, {
      onRestore: vi.fn(),
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Mara",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    expect(within(history).queryByRole("button", { name: "Diff" })).not.toBeInTheDocument()
    expect(within(history).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument()
  })

  it("restores a version through the onRestore handler", async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn().mockResolvedValue(undefined)
    const version = {
      id: "v1",
      label: "v1",
      createdAt: "2026-11-10T10:00:00.000Z",
      author: "Mara",
      sizeBytes: 9_000,
      content: "# Field notes\n\nOld draft body.",
    }
    renderDrawer(markdownFile, { onRestore, versions: [version] })

    const history = screen.getByLabelText("Version history")
    await user.click(within(history).getByRole("button", { name: "Restore" }))

    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith(
        markdownFile,
        expect.objectContaining({ id: "v1", label: "v1" }),
      ),
    )
  })

  it("previews a CSV version as a table distinct from the current content", async () => {
    const user = userEvent.setup()
    renderDrawer(csvFile, {
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Mara",
          sizeBytes: 900,
          content: "site,salinity\nA-01,28.4",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    await user.click(within(history).getByRole("button", { name: "View" }))

    // The historical snapshot renders through the same table preview path.
    const region = await screen.findByRole("region", {
      name: "CSV parsed table preview",
    })
    expect(within(region).getByRole("cell", { name: "A-01" })).toBeInTheDocument()
    // Current-only rows are absent while the old version is displayed.
    expect(within(region).queryByRole("cell", { name: "B-02" })).not.toBeInTheDocument()
    expect(screen.getByText(/Viewing version v1/)).toBeInTheDocument()
  })

  it("does not offer View for a version without content or URL", async () => {
    renderDrawer(markdownFile, {
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Mara",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    expect(within(history).getByText("v1")).toBeInTheDocument()
    expect(within(history).queryByRole("button", { name: "View" })).not.toBeInTheDocument()
    // Both the current row and the snapshot-less version still offer Download.
    expect(within(history).getAllByRole("button", { name: /Download/ })).toHaveLength(2)
  })

  it("does not show current content while viewing a URL-only version", async () => {
    const user = userEvent.setup()
    const pdfVersionFile: FileNode = {
      ...imageFile,
      id: "file-report",
      name: "report.pdf",
      mimeType: "application/pdf",
    }
    renderDrawer(pdfVersionFile, {
      versions: [
        {
          id: "v1",
          label: "v1",
          createdAt: "2026-11-10T10:00:00.000Z",
          author: "Jules",
          url: "https://files.example.com/report-v1.pdf",
        },
      ],
    })

    const history = screen.getByLabelText("Version history")
    await user.click(within(history).getByRole("button", { name: "View" }))

    const frame = await screen.findByTitle("report.pdf PDF preview")
    expect(frame).toHaveAttribute("src", "https://files.example.com/report-v1.pdf")
    expect(screen.getByText(/Viewing version v1/)).toBeInTheDocument()
  })

  it("renders a PDF inline when a preview URL is available", async () => {
    const pdfFile: FileNode = {
      ...imageFile,
      id: "file-report",
      name: "report.pdf",
      mimeType: "application/pdf",
    }
    renderDrawer(pdfFile, { previewUrl: "https://files.example.com/report.pdf" })

    const frame = await screen.findByTitle("report.pdf PDF preview")
    expect(frame).toHaveAttribute("src", "https://files.example.com/report.pdf")
  })

  it("renders a video player when a preview URL is available", async () => {
    const videoFile: FileNode = {
      ...imageFile,
      id: "file-clip",
      name: "transect.mp4",
      mimeType: "video/mp4",
    }
    renderDrawer(videoFile, { previewUrl: "https://files.example.com/transect.mp4" })

    const video = await screen.findByLabelText("transect.mp4 video preview")
    expect(video.tagName).toBe("VIDEO")
    expect(video).toHaveAttribute("src", "https://files.example.com/transect.mp4")
  })
})
