"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NotificationPreferencesScreen } from "@/components/app/notification-preferences-screen"

/**
 * "Notification preferences" settings modal opened from the user menu. It
 * embeds the same `NotificationPreferencesScreen` used at
 * `/app/account/notifications` in `embedded` mode (cards only, no page
 * header), so every control writes through the same
 * `AppNotificationsProvider` preferences store.
 */
export function NotificationPreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Notification preferences</DialogTitle>
          <DialogDescription>
            Choose which updates reach you and how often. Changes apply immediately and are stored
            in this browser.
          </DialogDescription>
        </DialogHeader>
        <NotificationPreferencesScreen embedded />
      </DialogContent>
    </Dialog>
  )
}
