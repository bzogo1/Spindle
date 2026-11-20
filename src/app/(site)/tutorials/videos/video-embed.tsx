"use client"

import { useState } from "react"

import {
  EXAMPLE_VIDEO_ID,
  formatDuration,
  type VideoItem,
  type VideoTranscriptCue,
} from "./video-data"

export type VideoEmbedProps = {
  video: VideoItem
}

function youtubeEmbedUrl(videoId: string): string {
  // youtube-nocookie keeps third-party cookies off until the user presses play.
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`
}

function isCueList(transcript: VideoItem["transcript"]): transcript is VideoTranscriptCue[] {
  return Array.isArray(transcript)
}

function Transcript({ transcript }: { transcript: NonNullable<VideoItem["transcript"]> }) {
  if (isCueList(transcript)) {
    return (
      <ol className="video-transcript-cues">
        {transcript.map((cue, index) => (
          <li key={index} className="video-transcript-cue">
            <span className="video-transcript-time">{formatDuration(cue.startSeconds)}</span>
            <span>{cue.text}</span>
          </li>
        ))}
      </ol>
    )
  }
  return (
    <div className="video-transcript-text">
      {transcript.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

/**
 * Privacy-friendly video embed with a click-to-load facade.
 *
 * Nothing is fetched from the provider until the user presses play: the
 * facade is pure markup (gradient + play button + duration badge), and the
 * iframe/<video> is only mounted on demand. Entries that cannot play yet —
 * the placeholder YouTube id, or a local item without a `src` file — render
 * a disabled facade with an explanatory note instead of a broken embed.
 * Transcript and captions live in a collapsible slot under the player.
 */
export function VideoEmbed({ video }: VideoEmbedProps) {
  const [playing, setPlaying] = useState(false)

  const provider = video.provider ?? "youtube"
  const videoId = video.videoId ?? EXAMPLE_VIDEO_ID
  // Placeholder only applies to YouTube embeds — local items never carry a
  // provider video id, and an unset src is handled by `canPlay` below.
  const isPlaceholder = provider === "youtube" && videoId === EXAMPLE_VIDEO_ID
  const canPlay = provider === "local" ? Boolean(video.src) : !isPlaceholder

  const facade = (
    <>
      <span className="video-embed-play" aria-hidden="true">
        {canPlay ? "▶" : "—"}
      </span>
      {video.durationSeconds !== undefined ? (
        <span className="video-embed-duration">{formatDuration(video.durationSeconds)}</span>
      ) : null}
      {isPlaceholder ? (
        <span className="video-embed-placeholder-badge">Placeholder video</span>
      ) : null}
      {!canPlay && !isPlaceholder ? (
        <span className="video-embed-placeholder-badge">No video file</span>
      ) : null}
    </>
  )

  const facadeStyle = video.poster ? { backgroundImage: `url(${video.poster})` } : undefined

  return (
    <figure className="video-embed" data-video-id={video.id}>
      <div className="video-embed-frame">
        {playing && canPlay ? (
          provider === "local" ? (
            <video
              className="video-embed-player"
              controls
              autoPlay
              playsInline
              src={video.src}
              poster={video.poster}
              aria-label={video.title}
            >
              {video.captionsUrl ? (
                <track kind="captions" src={video.captionsUrl} label="Captions" />
              ) : null}
            </video>
          ) : (
            <iframe
              className="video-embed-player"
              src={youtubeEmbedUrl(videoId)}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          )
        ) : canPlay ? (
          <button
            type="button"
            className="video-embed-facade"
            onClick={() => setPlaying(true)}
            aria-label={`Play video: ${video.title}`}
            style={facadeStyle}
          >
            {facade}
          </button>
        ) : (
          <div
            className="video-embed-facade video-embed-facade--disabled"
            style={facadeStyle}
            aria-disabled="true"
          >
            {facade}
          </div>
        )}
      </div>

      <figcaption className="video-embed-meta">
        <h3 className="video-embed-title">{video.title}</h3>
        {video.description ? <p className="video-embed-desc">{video.description}</p> : null}
        {isPlaceholder ? (
          <p className="video-embed-note">
            Using the placeholder id <code>{EXAMPLE_VIDEO_ID}</code> — set <code>videoId</code> (or
            replace the constant) to embed a real video.
          </p>
        ) : null}
        {video.pendingNote ? <p className="video-embed-note">{video.pendingNote}</p> : null}
      </figcaption>

      {video.transcript || video.captionsUrl ? (
        <details className="video-transcript">
          <summary className="video-transcript-summary">Transcript &amp; captions</summary>
          {video.transcript ? <Transcript transcript={video.transcript} /> : null}
          {video.captionsUrl ? (
            <p className="video-transcript-captions">
              Captions track: <code>{video.captionsUrl}</code>
            </p>
          ) : null}
        </details>
      ) : null}
    </figure>
  )
}
