"use client"

import { useEffect, useMemo, useState } from "react"
import { FlaskConical, Play } from "lucide-react"

import {
  readTestCases,
  runAutomationTests,
  starterTestCase,
  writeTestCases,
  type AutomationTestCase,
  type TestRunReport,
} from "@/lib/automation-graph"
import type { AutomationGraph } from "@/lib/automation-graph"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface TestRunnerPanelProps {
  graph: AutomationGraph
  /** localStorage scope for persisted test cases (defaults to graph id). */
  scope: string
}

function parseCases(raw: string): { cases?: AutomationTestCase[]; error?: string } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { error: "Expected a JSON array of test cases." }
    const cases = parsed.filter(
      (item): item is AutomationTestCase =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as AutomationTestCase).id === "string" &&
        typeof (item as AutomationTestCase).name === "string",
    )
    if (cases.length !== parsed.length) {
      return { error: "Every case needs string `id` and `name` fields." }
    }
    return { cases }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid JSON." }
  }
}

/**
 * Test runner for the automation: define cases (trigger payloads → expected
 * outcomes) as JSON, run them against the dry-run engine, and see pass/fail
 * results plus node coverage.
 */
export function TestRunnerPanel({ graph, scope }: TestRunnerPanelProps) {
  const stored = useMemo(() => readTestCases(scope), [scope])
  const storedJson = useMemo(() => (stored.length ? JSON.stringify(stored, null, 2) : ""), [stored])
  const [casesJson, setCasesJson] = useState(storedJson)
  const [report, setReport] = useState<TestRunReport | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  // Re-sync the editor when the persisted cases change (scope switch or an
  // external write). `stored` only recomputes on scope change, so typing is
  // not clobbered by our own writeTestCases on run.
  useEffect(() => {
    setCasesJson(storedJson)
    setReport(null)
    setParseError(null)
  }, [storedJson])

  function loadSample() {
    const sample = starterTestCase(graph)
    setCasesJson(JSON.stringify([sample], null, 2))
    setParseError(null)
    setReport(null)
  }

  function run() {
    const { cases, error } = parseCases(casesJson)
    if (error || !cases) {
      setParseError(error ?? "Invalid cases.")
      setReport(null)
      return
    }
    setParseError(null)
    writeTestCases(scope, cases)
    setReport(runAutomationTests(graph, cases))
  }

  const coveragePct = report ? Math.round(report.summary.nodeCoverage * 100) : 0

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-test-runner-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-test-runner-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <FlaskConical className="size-3.5" aria-hidden="true" />
          Test runner
        </h3>
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={loadSample}>
            Sample
          </Button>
          <Button type="button" size="sm" onClick={run} disabled={!casesJson.trim()}>
            <Play aria-hidden="true" />
            Run tests
          </Button>
        </div>
      </div>

      <Textarea
        value={casesJson}
        onChange={(event) => {
          setCasesJson(event.target.value)
          setParseError(null)
        }}
        placeholder={
          '[\n  { "id": "case-1", "name": "Happy path", "expect": { "status": "success" } }\n]'
        }
        aria-label="Test cases JSON"
        rows={5}
        className="font-mono text-[10px]"
      />
      {parseError ? <p className="text-destructive text-[11px]">{parseError}</p> : null}

      {report ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px]">
            <Badge
              variant="outline"
              className={cn(
                report.summary.failed === 0
                  ? "border-emerald-500/40 text-emerald-600"
                  : "border-red-500/40 text-red-600",
              )}
            >
              {report.summary.passed}/{report.summary.total} passed
            </Badge>
            <span className="text-muted-foreground">{coveragePct}% node coverage</span>
          </div>
          <div
            className="bg-muted h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={coveragePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Node coverage"
          >
            <div className="h-full bg-emerald-500" style={{ width: `${coveragePct}%` }} />
          </div>
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {report.results.map((result) => (
              <li
                key={result.caseId}
                className="border-border/70 bg-background rounded-md border p-2"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px]",
                      result.passed
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/15 text-red-600 dark:text-red-400",
                    )}
                  >
                    {result.passed ? "pass" : "fail"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{result.name}</span>
                </div>
                {result.failures.length > 0 ? (
                  <ul className="text-destructive mt-1 flex flex-col gap-0.5 text-[10px]">
                    {result.failures.map((failure) => (
                      <li key={failure}>· {failure}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-[11px]">
          Cases run against the dry-run engine — define trigger payloads and expected node
          statuses/outputs as JSON.
        </p>
      )}
    </section>
  )
}
