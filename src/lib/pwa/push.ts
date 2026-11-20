/**
 * Push notification subscription helpers.
 *
 * Every function degrades to a safe no-op when the Push API, Notifications
 * permission or service worker support is missing, so callers can invoke these
 * unconditionally. A VAPID application server key is required to subscribe;
 * pass it in (typically from NEXT_PUBLIC_* config once the backend issues one).
 */

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export type PushSubscriptionResult =
  | { status: "subscribed"; subscription: PushSubscription }
  | { status: "unsupported" }
  | { status: "denied" }
  | { status: "no-vapid-key" }

/**
 * Subscribe this device to push notifications.
 * Requests Notification permission first; resolves with a structured status
 * instead of throwing so UI code can stay branch-light.
 */
export async function subscribeToPush(vapidPublicKey?: string): Promise<PushSubscriptionResult> {
  if (!isPushSupported() || !navigator.serviceWorker) {
    return { status: "unsupported" }
  }
  if (!vapidPublicKey) {
    return { status: "no-vapid-key" }
  }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    return { status: "denied" }
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    })
    return { status: "subscribed", subscription }
  } catch {
    return { status: "unsupported" }
  }
}

/** Current push subscription, or null when none exists / unsupported. */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  try {
    const registration = await navigator.serviceWorker.ready
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

/** Unsubscribe and tell the push service to drop the subscription. */
export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await getCurrentPushSubscription()
  if (!subscription) return false
  try {
    await subscription.unsubscribe()
    return true
  } catch {
    return false
  }
}
