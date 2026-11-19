---
title: "Build inline previews for images, PDFs, CSV, and text files"
priority: High
estimate: 5
labels:
  - frontend
  - files
  - app
project: Spindle Website
status: Todo
---

## Summary

Third slice of 032. The site advertises "100+ inline previews", but clicking a file in the mock does
nothing. Ship the preview types that cover most research files, with honest fallbacks for the rest.

## Context

- 047 provides the browser and file rows; 048 provides uploads.
- `/docs#workspaces` and `/#files` both promise inline previews and format detection.
- Existing UI primitives are enough; do not add a heavy document viewer for this slice.
- Unknown files must remain downloadable even when no preview exists.

## Scope

- Preview surface: a detail pane on desktop and a full-screen sheet on mobile, opened from a file row
  with a shareable route or query (`/files/...?preview=<id>`).
- Supported types:
  - images (png/jpg/webp/gif/svg) with dimensions and alt text fallback;
  - PDFs using the browser's native viewer in an iframe, with a download fallback;
  - CSV/TSV parsed client-side, showing the header and first N rows (e.g. 100) with a row count and a
    clear "showing first N" note;
  - plain text, Markdown (rendered safely), JSON, and code with preserved whitespace.
- Unsupported/too-large files: a download card with type, size, and "Preview not available", never a
  blank pane.
- States: loading skeleton, parse error, too large, unsupported, and a failed fetch with retry.
- Security: sanitize Markdown/HTML (no `dangerouslySetInnerHTML` on unsanitized content), do not
  execute SVG scripts, and serve downloads with safe headers per the API.
- Keyboard: Escape closes, focus returns to the row, arrow keys move between files while the pane is
  open, and the preview has a labelled heading.
- Lazy-load parsers so the file list's initial bundle does not include CSV/Markdown code.

## Acceptance criteria

- Open each supported type from the browser and see real content, not mock data.
- CSV preview matches the parsed row/column count for a file with quoted commas and newlines.
- Unsupported file shows a download action that works; no request loop or blank state.
- Markdown with embedded HTML/script renders no executable content.
- Preview URL can be reloaded and lands on the same file.
- No file content is sent to analytics or Sentry; preview errors do not include file contents.
- Works at 360 px and with 200% zoom.

## Notes

Part of 032. Depends on 047 and 048. Large/binary formats (docx, xlsx, notebooks) can follow in a
separate issue; do not claim 100+ formats until they are actually supported.
