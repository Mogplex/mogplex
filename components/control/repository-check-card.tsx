"use client"

import { CheckCircle, InfoCircle, NavArrowDown, XmarkCircle } from "iconoir-react"
import type { VerificationEvent } from "@/lib/control/types"

const LABELS = { typecheck: "Typecheck", lint: "Lint", build: "Build", test: "Tests" }
const STATUSES = { passed: "Passed", failed: "Failed", blocked: "Unconfirmed", not_run: "Not run", skipped: "Skipped" }

export function RepositoryCheckCard({ event }: { event: VerificationEvent }) {
  const { verification } = event
  return <section aria-label="Workspace check results" className="rounded-lg border border-border bg-card p-3 text-sm" data-testid="repository-checks">
    <h3 className="font-medium text-foreground">{event.body}</h3>
    {verification.error && <p className="mt-1 text-xs text-muted-foreground">{verification.error}</p>}
    <ul aria-label="Repository checks" className="mt-2 divide-y divide-border">
      {verification.checks.map(check => {
        const Icon = check.status === "passed" ? CheckCircle : check.status === "failed" ? XmarkCircle : InfoCircle
        return <li key={check.kind}>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
              <span className="text-foreground">{LABELS[check.kind]}</span>
              <span className="ml-auto text-xs text-foreground">{STATUSES[check.status]}</span>
              <NavArrowDown aria-hidden="true" className="size-3 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="space-y-2 pb-3 text-xs text-muted-foreground">
              {check.command && <code className="block break-words font-mono">{check.command}</code>}
              {check.exitCode !== null && <p>Exit code: {check.exitCode}</p>}
              {check.reason && <p>{check.reason}</p>}
              {(check.stdout || check.stderr) && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs text-foreground">{[check.stdout, check.stderr].filter(Boolean).join("\n")}</pre>}
            </div>
          </details>
        </li>
      })}
    </ul>
  </section>
}
