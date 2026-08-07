"use client"

import { Asterisk, GitMerge, Plus, Trash } from "iconoir-react"
import { eventLabel } from "@/lib/flows/graph"
import {
  FLOW_STARTER_TEMPLATES,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates"
import type { PersonalFlowTemplate } from "@/lib/types"
import { FLOW_STARTER_TEMPLATE_ICONS } from "./constants"
import type { Installation } from "./types"
import { WorkflowSelect } from "./inspector-shared"
import { installationAccountTypeLabel, installationAccountLabel } from "./start-filter-fields"

export interface TemplatePickerHeaderProps {
  installations: Installation[]
  createInstallationId: string
  onCreateInstallationChange: (value: string) => void
  createRepositoryOptions: Array<{ full_name: string }>
  createRepository: string
  onCreateRepositoryChange: (value: string) => void
}

export function TemplatePickerHeader({
  installations,
  createInstallationId,
  onCreateInstallationChange,
  createRepositoryOptions,
  createRepository,
  onCreateRepositoryChange,
}: TemplatePickerHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        Quick start
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">
        Start from a working graph
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        Every starter is an editable draft. Nothing runs until you publish it.
      </p>
      {installations && installations.length > 1 ? (
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Create in
          </span>
          <WorkflowSelect
            value={createInstallationId}
            onValueChange={(value) => {
              onCreateInstallationChange(value)
              onCreateRepositoryChange("all")
            }}
            className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-[11px] text-foreground"
            ariaLabel="New workflow GitHub account"
            options={installations.map((installation) => ({
              value: String(installation.installation_id),
              label: `${installationAccountLabel(installation)} · ${installationAccountTypeLabel(installation.account_type)}`,
            }))}
          />
        </label>
      ) : null}
      {createRepositoryOptions.length > 0 ? (
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Target repository
          </span>
          <WorkflowSelect
            value={createRepository}
            onValueChange={onCreateRepositoryChange}
            className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-[11px] text-foreground"
            ariaLabel="New workflow repository"
            options={[
              { value: "all", label: "All repositories" },
              ...createRepositoryOptions.map((repository) => ({
                value: repository.full_name,
                label: repository.full_name,
              })),
            ]}
          />
        </label>
      ) : null}
    </div>
  )
}

export interface TemplateSectionProps {
  scope: "team" | "personal"
  templates: PersonalFlowTemplate[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  isCreating: boolean
  createRepository: string
  canDelete: boolean
  onCreateFlow: (template: PersonalFlowTemplate) => void
  onDeleteTemplate: (template: PersonalFlowTemplate) => void
}

export function TemplateSection({
  scope,
  templates,
  hasMore,
  loadingMore,
  onLoadMore,
  isCreating,
  createRepository,
  canDelete,
  onCreateFlow,
  onDeleteTemplate,
}: TemplateSectionProps) {
  const isTeam = scope === "team"
  const titleClassName = isTeam
    ? "text-sky-700 dark:text-sky-300/75"
    : "text-orange-700 dark:text-orange-300/70"
  const iconClassName = isTeam
    ? "border-sky-400/20 bg-sky-400/[0.06] text-sky-700 dark:text-sky-300"
    : "border-orange-400/20 bg-orange-400/[0.06] text-orange-700 dark:text-orange-300"
  const hoverClassName = isTeam
    ? "hover:border-sky-400/20 hover:bg-sky-400/[0.045]"
    : "hover:border-orange-400/20 hover:bg-orange-400/[0.045]"
  const Icon = isTeam ? GitMerge : Asterisk

  return (
    <div className="border-b border-border p-2">
      <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
        <span className={`text-[9px] font-semibold tracking-[0.17em] uppercase ${titleClassName}`}>
          {isTeam ? "Team templates" : "Your templates"}
        </span>
        {isTeam ? (
          <span className="text-[9px] text-muted-foreground">Shared</span>
        ) : null}
      </div>
      <div className="space-y-1">
        {templates.map((template) => (
          <div
            key={template.id}
            className={`group flex items-stretch rounded-lg border border-transparent transition-colors ${hoverClassName}`}
          >
            <button
              type="button"
              data-testid={`flow-${scope}-template-${template.id}`}
              onClick={() => onCreateFlow(template)}
              disabled={
                isCreating ||
                (template.requires_repository && createRepository === "all")
              }
              className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left disabled:opacity-45"
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-md border ${iconClassName}`}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-semibold text-foreground">
                    {template.name}
                  </span>
                  <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                    {eventLabel(template.trigger_event)}
                  </span>
                </span>
                <span className="mt-1 block text-[10.5px] leading-4 text-muted-foreground">
                  {template.description || (isTeam ? "Reusable team workflow" : "Reusable personal workflow")}
                </span>
                {template.reconnect.length > 0 ? (
                  <span className="mt-1.5 block text-[9px] font-medium tracking-[0.08em] text-amber-700 dark:text-amber-300/75 uppercase">
                    Reconnect {template.reconnect.join(" + ")}
                  </span>
                ) : template.requires_repository && createRepository === "all" ? (
                  <span className="mt-1.5 block text-[9px] font-medium tracking-[0.08em] text-amber-700 dark:text-amber-300/75 uppercase">
                    Choose a repository
                  </span>
                ) : null}
              </span>
            </button>
            {canDelete ? (
              <button
                type="button"
                aria-label={`Delete ${template.name} template`}
                onClick={() => onDeleteTemplate(template)}
                className="mr-1 grid w-8 shrink-0 place-items-center self-stretch text-muted-foreground/60 transition-colors hover:text-red-600 dark:hover:text-red-300"
              >
                <Trash className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mt-1 w-full rounded-md px-3 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.035] hover:text-foreground disabled:opacity-50"
        >
          {loadingMore
            ? "Loading templates..."
            : "Load more templates"}
        </button>
      ) : null}
    </div>
  )
}

export interface StarterTemplatesListProps {
  isCreating: boolean
  onCreateFlow: (templateId: FlowStarterTemplateId) => void
}

export function StarterTemplatesList({
  isCreating,
  onCreateFlow,
}: StarterTemplatesListProps) {
  return (
    <div className="space-y-1 p-2">
      <div className="px-3 pt-1 pb-1.5 text-[9px] font-semibold tracking-[0.17em] text-muted-foreground uppercase">
        Built-in starters
      </div>
      {FLOW_STARTER_TEMPLATES.map((template) => {
        const TemplateIcon = FLOW_STARTER_TEMPLATE_ICONS[template.id]
        return (
          <button
            key={template.id}
            type="button"
            data-testid={`flow-template-${template.id}`}
            onClick={() => onCreateFlow(template.id)}
            disabled={isCreating}
            className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-foreground/[0.045] disabled:opacity-50"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-foreground/[0.035] text-muted-foreground transition-colors group-hover:border-orange-400/25 group-hover:text-orange-700 dark:group-hover:text-orange-300">
              <TemplateIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-foreground">
                  {template.name}
                </span>
                <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                  {template.trigger}
                </span>
              </span>
              <span className="mt-1 block text-[10.5px] leading-4 text-muted-foreground">
                {template.description}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export interface SaveTemplateButtonProps {
  selectedFlow: { id: string; name: string } | null
  savingTemplate: boolean
  activeTeamId: string | null
  teamTemplatesCanWrite: boolean
  onSaveAsTemplate: () => void
}

export function SaveTemplateButton({
  selectedFlow,
  savingTemplate,
  activeTeamId,
  teamTemplatesCanWrite,
  onSaveAsTemplate,
}: SaveTemplateButtonProps) {
  return (
    <div className="shrink-0 border-t border-border p-2">
      <button
        type="button"
        data-testid="flow-save-personal-template"
        disabled={!selectedFlow || savingTemplate}
        onClick={onSaveAsTemplate}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground disabled:opacity-40"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-dashed border-border">
          <Plus className="size-4" />
        </span>
        <span>
          <span className="block text-xs font-semibold">
            Save current as template
          </span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {activeTeamId && teamTemplatesCanWrite
              ? "Choose personal or team ownership before saving"
              : "Connections and repository scope are removed"}
          </span>
        </span>
      </button>
    </div>
  )
}
