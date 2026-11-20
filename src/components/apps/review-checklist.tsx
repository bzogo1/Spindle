"use client"

import { useEffect, useMemo, useState } from "react"

import {
  getReviewCategories,
  summarizeReview,
  type ReviewCategory,
  type ReviewCheck,
  type ReviewCheckStatus,
  type ReviewSummary,
} from "@/lib/apps/review"

const STATUS_OPTIONS: { value: ReviewCheckStatus; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "na", label: "N/A" },
]

export interface ReviewChecklistProps {
  /** Optional override for the criteria set (defaults to the portal model). */
  categories?: readonly ReviewCategory[]
  onChange?: (checks: ReviewCheck[], summary: ReviewSummary) => void
}

/**
 * Interactive review checklist. Criteria start unchecked; reviewers pick
 * pass / fail / n/a per criterion. Required criteria must pass for approval.
 */
export function ReviewChecklist({ categories, onChange }: ReviewChecklistProps) {
  const cats = useMemo(() => categories ?? getReviewCategories(), [categories])
  const [checks, setChecks] = useState<ReadonlyMap<string, ReviewCheckStatus>>(new Map())

  const reviewChecks: ReviewCheck[] = useMemo(
    () => [...checks.entries()].map(([criterionId, status]) => ({ criterionId, status })),
    [checks],
  )

  const summary = useMemo(() => summarizeReview(reviewChecks, cats), [reviewChecks, cats])

  useEffect(() => {
    onChange?.(reviewChecks, summary)
  }, [reviewChecks, summary, onChange])

  function setStatus(criterionId: string, status: ReviewCheckStatus) {
    setChecks((prev) => {
      const next = new Map(prev)
      // Clicking the active status clears it back to unchecked.
      if (prev.get(criterionId) === status) next.delete(criterionId)
      else next.set(criterionId, status)
      return next
    })
  }

  return (
    <div className="review-checklist">
      <div className="review-checklist-summary" role="status">
        <strong>{summary.approved ? "Approved" : "In review"}</strong>
        <span>
          {summary.passed} passed · {summary.failed} failed · {summary.unchecked} unchecked ·{" "}
          {summary.requiredPassed}/{summary.requiredTotal} required
        </span>
        <progress value={summary.percent} max={100} aria-label="Review progress" />
      </div>
      {cats.map((category) => (
        <section
          key={category.id}
          className="review-category"
          aria-labelledby={`rc-${category.id}`}
        >
          <header className="review-category-head">
            <h3 id={`rc-${category.id}`}>{category.title}</h3>
            <p>{category.summary}</p>
          </header>
          <ul className="review-criteria">
            {category.criteria.map((criterion) => {
              const status = checks.get(criterion.id)
              return (
                <li key={criterion.id} className="review-criterion">
                  <div className="review-criterion-body">
                    <span className="review-criterion-title">
                      {criterion.title}
                      {criterion.required ? (
                        <em className="review-required">required</em>
                      ) : (
                        <em className="review-optional">optional</em>
                      )}
                    </span>
                    <span className="review-criterion-desc">{criterion.description}</span>
                  </div>
                  <div
                    className="review-status"
                    role="radiogroup"
                    aria-label={`Status for ${criterion.title}`}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={status === option.value}
                        className={`review-status-btn review-status-btn--${option.value}${
                          status === option.value ? "is-active" : ""
                        }`}
                        onClick={() => setStatus(criterion.id, option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
