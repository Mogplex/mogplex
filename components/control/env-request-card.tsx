"use client"

import { useProjectSettingsDrawer } from "@/hooks/use-project-settings-drawer"
import { useRepos } from "@/hooks/use-repos"
import type { EnvRequestEvent } from "@/lib/control/types"

/**
 * Names Control asked for, with a button that opens Project settings ready
 * to fill them. Values go straight from the operator to the project; they
 * never pass through the chat.
 */
export function EnvRequestCard({ event }: { event: EnvRequestEvent }) {
  const open = useProjectSettingsDrawer((state) => state.open)
  const { repos } = useRepos({ showHidden: true })
  // Read the project live, so the card turns to "set" once the operator saves;
  // the tool's snapshot covers the moment before the project list loads.
  const repo = repos.find((candidate) => candidate.id === event.repoId)
  const stored = repo?.sandbox_env_vars ?? {}
  const missingNames = repo
    ? event.names.filter((name) => !Object.hasOwn(stored, name))
    : event.missing
  const missing = new Set(missingNames)
  return (
    <div className="mt-2 space-y-2">
      <ul aria-label="Requested variables" className="flex flex-wrap gap-1.5">
        {event.names.map((name) => (
          <li key={name} className="rounded border border-ink-800 px-1.5 py-0.5 font-mono text-[11px]">
            {name}
            <span className="sr-only">{missing.has(name) ? " (not set)" : " (set)"}</span>
            {missing.has(name) ? null : <span aria-hidden="true" className="ml-1 text-muted-foreground">✓</span>}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => open({ repoId: event.repoId, tab: "env", requestedEnvNames: missingNames })}
        className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-brand-accent-hover"
      >
        {missingNames.length > 0 ? "Set variables" : "Review variables"}
      </button>
    </div>
  )
}
