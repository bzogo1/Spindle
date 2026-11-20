"use client"

import { useState } from "react"
import { MessageSquare, Send, Trash2 } from "lucide-react"

import type { NodeComment } from "@/lib/automation-graph"
import { formatRelativeTime } from "@/components/app/format"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface CommentsPanelProps {
  /** Node the comments belong to, or null when nothing is selected. */
  nodeId: string | null
  /** Display label of the selected node (for the heading). */
  nodeLabel?: string
  /** Comments for the selected node, oldest first. */
  comments: NodeComment[]
  /** Id of the local collaborator — their comments get a delete affordance. */
  localAuthorId?: string
  onAddComment: (body: string) => void
  onDeleteComment: (commentId: string) => void
}

/**
 * Per-node comment thread for the automation builder. Comments persist to
 * localStorage via `src/lib/automation-graph/collaboration.ts` and sync
 * across tabs, so they double as lightweight review annotations.
 */
export function CommentsPanel({
  nodeId,
  nodeLabel,
  comments,
  localAuthorId,
  onAddComment,
  onDeleteComment,
}: CommentsPanelProps) {
  const [draft, setDraft] = useState("")

  function handleSubmit() {
    const body = draft.trim()
    if (!body || !nodeId) return
    onAddComment(body)
    setDraft("")
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-comments-heading"
    >
      <h3
        id="builder-comments-heading"
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <MessageSquare className="size-3" aria-hidden="true" />
        Comments{nodeLabel ? ` · ${nodeLabel}` : ""}
      </h3>

      {!nodeId ? (
        <p className="border-border/60 text-muted-foreground border-t pt-2 text-[11px]">
          Select a node on the canvas to view or add comments.
        </p>
      ) : (
        <>
          {comments.length === 0 ? (
            <p className="border-border/60 text-muted-foreground border-t pt-2 text-[11px]">
              No comments on this node yet.
            </p>
          ) : (
            <ul className="border-border/60 mt-1 flex max-h-48 flex-col gap-1.5 overflow-y-auto border-t pt-2">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="border-border/60 flex flex-col gap-0.5 rounded border px-1.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                      {comment.authorName}
                    </span>
                    <span className="text-muted-foreground text-[10px]" title={comment.createdAt}>
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                    {comment.authorId === localAuthorId ? (
                      <button
                        type="button"
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded p-0.5"
                        aria-label={`Delete comment by ${comment.authorName}`}
                        onClick={() => onDeleteComment(comment.id)}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[11px] whitespace-pre-wrap">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 flex flex-col gap-1.5">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a comment for collaborators…"
              aria-label="New comment"
              rows={2}
              maxLength={500}
              className="text-xs"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!draft.trim()}
                onClick={handleSubmit}
              >
                <Send aria-hidden="true" />
                Add comment
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
