"use client"

import { Github } from "iconoir-react"
import { WorkflowSelect } from "./inspector-shared"
import {
  installationAccountLabel,
  installationAccountTypeLabel,
  RepositoryScopePicker,
} from "./start-filter-fields"
import type { Installation } from "./types"

export function FlowBrowseFilters({
  browseInstallationId,
  onInstallationChange,
  browseAccountLabel,
  repositoryOptions,
  repositories,
  onRepositoriesChange,
  installations,
  visibleCount,
  totalCount,
}: {
  browseInstallationId: string
  onInstallationChange: (value: string) => void
  browseAccountLabel: string
  repositoryOptions: string[]
  repositories: string[]
  onRepositoriesChange: (repositories: string[]) => void
  installations: Installation[]
  visibleCount: number
  totalCount: number
}) {
  return (
    <div data-testid="flow-browser-filters" className="flex h-12 min-h-12 items-center gap-2 border-b border-border bg-card px-3">
      <div className="mr-1 hidden shrink-0 items-center gap-2 @5xl/flows:flex">
        <Github className="size-3.5 text-muted-foreground" />
        <span className="text-[9px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Viewing</span>
      </div>
      <div className="min-w-0 max-w-[220px] flex-1">
        <WorkflowSelect
          testId="flow-browser-account"
          ariaLabel="Filter workflows by GitHub account"
          value={browseInstallationId}
          onValueChange={onInstallationChange}
          className="h-8 w-full min-w-0 rounded-md border border-border bg-input px-2.5 text-[11px] font-medium text-foreground"
          options={[
            { value: "all", label: "All GitHub accounts" },
            ...installations.map((installation) => ({
              value: String(installation.installation_id),
              label: `${installationAccountLabel(installation)} · ${installationAccountTypeLabel(installation.account_type)}`,
            })),
          ]}
        />
      </div>
      <div className="min-w-0 max-w-[260px] flex-1">
        <RepositoryScopePicker
          accountLabel={browseAccountLabel}
          options={repositoryOptions}
          selected={repositories}
          onChange={onRepositoriesChange}
          ariaLabel="Filter workflows by repository"
          compact
          testId="flow-browser-repository"
          optionTestIdPrefix="flow-browser-repository-option"
          menuLabel="Repository filter"
          description="Choose which repositories are visible in the workflow list."
        />
      </div>
      <span className="ml-auto hidden shrink-0 text-[10px] text-muted-foreground @3xl/flows:inline" title="These filters change what is visible, not when a workflow runs.">
        {visibleCount} of {totalCount} workflows
      </span>
    </div>
  )
}
