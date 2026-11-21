"use client"

/**
 * Upload settings dropdown — lets the user pick upload quality, target
 * format and destination for subsequent uploads. Reads/writes the shared
 * {@link UploadsContextValue.settings} state, which the provider persists
 * to localStorage. Real transports can consume the values via context;
 * the mock transport ignores them.
 */

import { Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  UPLOAD_DESTINATION_OPTIONS,
  UPLOAD_FORMAT_OPTIONS,
  UPLOAD_QUALITY_OPTIONS,
} from "@/lib/uploads/settings"

import { useUploadsQueue } from "./upload-provider"

function SettingGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string; hint?: string }[]
  onChange: (value: string) => void
}) {
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            <span className="flex flex-col">
              <span>{option.label}</span>
              {option.hint ? (
                <span className="text-muted-foreground text-xs">{option.hint}</span>
              ) : null}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  )
}

export function UploadSettingsMenu({ className }: { className?: string }) {
  const { settings, updateSettings } = useUploadsQueue()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={className}
          aria-label="Upload settings"
        >
          <Settings2 aria-hidden="true" />
          Settings
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <SettingGroup
          label="Quality"
          value={settings.quality}
          options={UPLOAD_QUALITY_OPTIONS}
          onChange={(value) =>
            updateSettings({ quality: value as typeof settings.quality })
          }
        />
        <SettingGroup
          label="Format"
          value={settings.format}
          options={UPLOAD_FORMAT_OPTIONS}
          onChange={(value) =>
            updateSettings({ format: value as typeof settings.format })
          }
        />
        <SettingGroup
          label="Destination"
          value={settings.destination}
          options={UPLOAD_DESTINATION_OPTIONS}
          onChange={(value) =>
            updateSettings({ destination: value as typeof settings.destination })
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
