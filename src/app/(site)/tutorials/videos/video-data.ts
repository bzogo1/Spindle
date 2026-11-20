/**
 * Data model for the video documentation framework.
 *
 * IMPORTANT: `EXAMPLE_VIDEO_ID` is a clearly-marked placeholder. Replace it
 * with a real provider video id (e.g. a YouTube video id) before shipping —
 * no real video URLs are fabricated here.
 */

/**
 * PLACEHOLDER — replace with the id of a real video on your provider
 * (YouTube video id, Vimeo id, …) or pass `videoId`/`src` per item instead.
 */
export const EXAMPLE_VIDEO_ID = "REPLACE_WITH_YOUR_VIDEO_ID"

export type VideoTranscriptCue = {
  /** Start time in seconds. */
  startSeconds: number
  /** Optional end time in seconds. */
  endSeconds?: number
  text: string
}

export type VideoProvider = "youtube" | "local"

export type VideoItem = {
  id: string
  title: string
  description?: string
  provider?: VideoProvider
  /**
   * Provider video id (YouTube id for provider "youtube"). Defaults to
   * `EXAMPLE_VIDEO_ID` — the placeholder constant above.
   */
  videoId?: string
  /** Local file path under /public for provider "local" (e.g. "/videos/demo.mp4"). */
  src?: string
  /**
   * Explanatory note shown under the entry when it cannot play yet — e.g. a
   * local item whose file has not been added to /public yet.
   */
  pendingNote?: string
  /** Poster image URL shown on the facade before playback. */
  poster?: string
  /** Total duration in seconds; rendered as a badge on the facade. */
  durationSeconds?: number
  /**
   * Transcript slot: either plain text (rendered as paragraphs) or timed
   * cues (rendered with timestamps). Also surfaced for captions/a11y.
   */
  transcript?: string | VideoTranscriptCue[]
  /** Optional WebVTT captions track URL for the <video> element. */
  captionsUrl?: string
}

export const VIDEO_DOCS: VideoItem[] = [
  {
    id: "workspace-overview",
    title: "Workspace overview (placeholder)",
    description:
      "A five-minute tour of projects, automations, and the agent. Swap EXAMPLE_VIDEO_ID for a real id to light this up.",
    provider: "youtube",
    durationSeconds: 5 * 60,
    transcript: [
      {
        startSeconds: 0,
        endSeconds: 45,
        text: "Projects group every file, source, and automation.",
      },
      { startSeconds: 45, endSeconds: 120, text: "Automations run on a schedule or on events." },
      { startSeconds: 120, endSeconds: 300, text: "The agent answers questions with citations." },
    ],
  },
  {
    id: "local-demo",
    title: "Local video example",
    description:
      'Provider "local" plays a file from /public with native controls — useful for offline or self-hosted docs.',
    provider: "local",
    // No src on purpose: there is no demo video asset in /public yet, so the
    // facade renders disabled with `pendingNote` instead of a 404.
    pendingNote: "Add an .mp4 under public/videos/ and set `src` on this entry to enable playback.",
    durationSeconds: 92,
    transcript:
      "This slot accepts plain-text transcripts. Timed cues are supported too — see VideoTranscriptCue.",
  },
]

/** Formats seconds as m:ss (or h:mm:ss for long videos). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes)
  const ss = String(secs).padStart(2, "0")
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
