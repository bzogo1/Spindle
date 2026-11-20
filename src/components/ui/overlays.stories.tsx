import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { AsyncSelect } from "./async-select"
import { DatePicker } from "./date-picker"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"
import { Select } from "./select"
import { Button } from "./button"
import { Toaster, toast } from "./toast"

const meta = {
  title: "UI/Overlays",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const selectOptions = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "In review" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived", disabled: true },
]

export const Dialogs: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project?</DialogTitle>
          <DialogDescription>
            This removes the project and all of its files. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const Selects: Story = {
  render: function SelectsStory() {
    const [value, setValue] = useState<string | null>("review")
    return (
      <div className="grid max-w-xs gap-4">
        <Select
          options={selectOptions}
          value={value}
          onChange={(v) => setValue(v as string | null)}
          placeholder="Pick a status"
          aria-label="Status"
        />
        <Select
          options={selectOptions}
          multiple
          placeholder="Pick several"
          aria-label="Multiple statuses"
        />
        <Select
          options={[]}
          placeholder="Nothing here"
          emptyMessage="No statuses found."
          aria-label="Empty"
        />
      </div>
    )
  },
}

const PEOPLE = [
  { value: "ada", label: "Ada Lovelace", keywords: "ada engineer" },
  { value: "grace", label: "Grace Hopper", keywords: "grace admiral" },
  { value: "alan", label: "Alan Turing", keywords: "alan mathematician" },
  { value: "edsger", label: "Edsger Dijkstra", keywords: "edsger computer scientist" },
]

function searchPeople(query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return PEOPLE
  return PEOPLE.filter((p) => p.label.toLowerCase().includes(q) || p.keywords.includes(q))
}

export const AsyncSelects: Story = {
  render: function AsyncSelectsStory() {
    const [value, setValue] = useState<string | null>(null)
    return (
      <div className="grid max-w-xs gap-4">
        <AsyncSelect
          searchOptions={searchPeople}
          value={value}
          onChange={(v) => setValue(v as string | null)}
          placeholder="Search people…"
          minQueryLength={0}
          debounceMs={150}
          aria-label="Assignee"
        />
        <AsyncSelect
          searchOptions={async (query: string) => {
            await new Promise((r) => setTimeout(r, 600))
            return searchPeople(query)
          }}
          placeholder="Slow search (600ms)…"
          minQueryLength={1}
          aria-label="Slow assignee"
        />
      </div>
    )
  },
}

export const DatePickers: Story = {
  render: function DatePickersStory() {
    const [single, setSingle] = useState<Date | null>(null)
    const [range, setRange] = useState<{ from?: Date; to?: Date }>({})
    return (
      <div className="grid max-w-xs gap-4">
        <DatePicker
          mode="single"
          value={single}
          onChange={(v) => setSingle(v as Date | null)}
          placeholder="Pick a date"
        />
        <DatePicker
          mode="range"
          value={range}
          onChange={(v) => setRange(v as { from?: Date; to?: Date })}
          placeholder="Pick a range"
        />
      </div>
    )
  },
}

export const Toasts: Story = {
  render: () => (
    <div>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => toast("File uploaded successfully")}>
          Default
        </Button>
        <Button variant="outline" onClick={() => toast.success("Changes saved")}>
          Success
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast({
              title: "Sync failed",
              description: "Reconnect to the workspace and try again.",
              variant: "error",
            })
          }
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.promise(Promise.resolve("ok"), {
              loading: "Saving…",
              success: "Saved",
              error: "Save failed",
            })
          }
        >
          Promise
        </Button>
      </div>
      <Toaster />
    </div>
  ),
}
