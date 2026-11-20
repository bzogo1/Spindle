import type { Meta, StoryObj } from "@storybook/react-vite"

import { DataGrid } from "@/components/data-grid"
import type { DataGridColumn } from "@/components/data-grid"

interface FileRow {
  id: string
  name: string
  size: number
  modified: string
  owner: string
}

const ROWS: FileRow[] = [
  { id: "f1", name: "thesis-draft.docx", size: 184_320, modified: "2025-11-18", owner: "Ada" },
  { id: "f2", name: "survey-results.csv", size: 42_000, modified: "2025-11-17", owner: "Grace" },
  { id: "f3", name: "pipeline.ipynb", size: 1_204_480, modified: "2025-11-15", owner: "Alan" },
  { id: "f4", name: "figures/fig1.svg", size: 96_000, modified: "2025-11-14", owner: "Ada" },
  { id: "f5", name: "references.bib", size: 12_800, modified: "2025-11-12", owner: "Edsger" },
  { id: "f6", name: "notes.md", size: 4_100, modified: "2025-11-10", owner: "Grace" },
  { id: "f7", name: "dataset.parquet", size: 8_400_000, modified: "2025-11-08", owner: "Alan" },
  { id: "f8", name: "README.txt", size: 2_200, modified: "2025-11-01", owner: "Ada" },
]

const columns: DataGridColumn<FileRow>[] = [
  {
    id: "name",
    header: "Name",
    pinned: "left",
    width: 220,
    sortValue: (r) => r.name,
    filterValue: (r) => r.name,
    cell: (r) => <span className="font-medium">{r.name}</span>,
  },
  {
    id: "owner",
    header: "Owner",
    width: 120,
    sortValue: (r) => r.owner,
    filterValue: (r) => r.owner,
    cell: (r) => r.owner,
  },
  {
    id: "size",
    header: "Size",
    width: 110,
    align: "right",
    sortValue: (r) => r.size,
    cell: (r) => `${(r.size / 1024).toFixed(1)} KB`,
  },
  {
    id: "modified",
    header: "Modified",
    width: 130,
    sortValue: (r) => r.modified,
    cell: (r) => r.modified,
  },
]

const meta = {
  title: "UI/DataGrid",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Files: Story = {
  render: () => (
    <DataGrid
      rows={ROWS}
      columns={columns}
      getRowId={(r) => r.id}
      height={360}
      rowHeight={40}
      selectionMode="multi"
      showColumnFilters
      aria-label="Project files"
    />
  ),
}

export const Loading: Story = {
  render: () => (
    <DataGrid
      rows={[]}
      columns={columns}
      loading
      loadingRows={6}
      height={240}
      rowHeight={40}
      aria-label="Loading files"
    />
  ),
}

export const Empty: Story = {
  render: () => (
    <DataGrid
      rows={[]}
      columns={columns}
      height={240}
      rowHeight={40}
      aria-label="Empty files"
      emptyState={<p className="text-muted-foreground py-8 text-center text-sm">No files yet.</p>}
    />
  ),
}
