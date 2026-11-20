/**
 * Notification sound playback via the Web Audio API — no audio asset needed.
 * Everything here is client-only and defensive: jsdom and SSR have no
 * `AudioContext`, so `playNotificationSound` silently no-ops there. The
 * `AudioContext` is created lazily on first playback (browsers may also keep
 * it suspended until a user gesture; we attempt `resume()` and schedule
 * anyway so the first real interaction unlocks it).
 */

export const APP_NOTIFICATION_SOUND_TONES = ["chime", "bell", "blip"] as const
export type AppNotificationSoundTone = (typeof APP_NOTIFICATION_SOUND_TONES)[number]

/** Sound delivery preference — nested under `AppNotificationPreferences.sound`. */
export interface AppNotificationSoundPreferences {
  /** Play a short sound when a notification is delivered to the in-app feed. */
  enabled: boolean
  /** Which tone to play. */
  tone: AppNotificationSoundTone
}

/**
 * Frequency sequence per tone, played as short sine notes 120ms apart.
 * Values are Hz; kept low enough to stay pleasant on laptop speakers.
 */
const TONE_SEQUENCES: Record<AppNotificationSoundTone, readonly number[]> = {
  chime: [880, 1174.66, 1567.98], // A5, D6, G6 — ascending sparkle
  bell: [659.25, 523.25], // E5 then C5 — two-note knock
  blip: [987.77], // single B5 blip
}

const NOTE_GAP_SECONDS = 0.12
const NOTE_DURATION_SECONDS = 0.22
const MASTER_GAIN = 0.12

let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sharedContext) {
    try {
      sharedContext = new Ctor()
    } catch {
      return null
    }
  }
  if (sharedContext.state === "suspended") {
    // Autoplay policy: resume is best-effort — if it stays suspended the
    // scheduled notes are silent and the next user gesture retries.
    void sharedContext.resume().catch(() => {})
  }
  return sharedContext
}

function playNote(context: AudioContext, frequency: number, startAt: number) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = "sine"
  oscillator.frequency.value = frequency
  // Quick attack, exponential decay — reads as a soft chime rather than a beep.
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(MASTER_GAIN, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + NOTE_DURATION_SECONDS)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + NOTE_DURATION_SECONDS + 0.05)
}

/**
 * Play the configured notification tone. No-ops when sound is disabled, when
 * there is no `window` (SSR), or when `AudioContext` is unavailable/fails —
 * notification delivery must never break because audio did.
 */
export function playNotificationSound(sound: AppNotificationSoundPreferences) {
  if (!sound.enabled || typeof window === "undefined") return
  const context = getAudioContext()
  if (!context) return
  try {
    const startAt = context.currentTime + 0.01
    TONE_SEQUENCES[sound.tone].forEach((frequency, index) => {
      playNote(context, frequency, startAt + index * NOTE_GAP_SECONDS)
    })
  } catch {
    // Audio scheduling failed (closed context, etc.) — ignore.
  }
}
