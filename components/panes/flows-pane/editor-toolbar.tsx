"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  CheckCircle,
  Copy,
  Play,
  Plus,
  Redo,
  Trash,
  Undo,
} from "iconoir-react"
import type { FlowSaveStatus } from "@/lib/flows/save-presentation"
import type { Flow, FlowRunRecord } from "@/lib/types"
import type { FlowTab } from "./types"

export interface EditorToolbarProps {
  draft: { name: string; nodes: unknown[]; edges: unknown[] } | null
  selectedFlow: Flow | null
  flowRuns: FlowRunRecord[]
  flowSuccessRateLabel: string | null
  activeFlowTab: FlowTab
  onTabChange: (value: string) => void
  sidebarCollapsed: boolean
  dirty: boolean
  saveStatus: FlowSaveStatus
  saveStatusLabel: string
  saveStatusTitle: string
  quietSaveStatus: boolean
  saveStatusTone: { container: string; dot?: string }
  saveStatusAnnouncement: string | null
  saving: boolean
  publishing: boolean
  primaryModifierLabel: string
  primaryActionLabel: string
  primaryActionClassName: string
  shouldPublishLatestDraft: boolean
  canUndo: boolean
  canRedo: boolean
  effectiveLegacyAgentNodes: Array<{
    nodeId: string
    label: string
    modelId: string
    source: "override" | "missing"
  }>
  onFlowNameChange: (name: string) => void
  onAddAgent: () => void
  onUndo: () => void
  onRedo: () => void
  onDuplicateFlow: () => void
  onDeleteFlow: () => void
  onPersist: () => void
  onPublish: () => void
  onToggleStatus: () => void
}

export function EditorToolbarHeader({
  draft,
  selectedFlow,
  flowRuns,
  flowSuccessRateLabel,
  dirty,
  saveStatus,
  saveStatusLabel,
  saveStatusTitle,
  quietSaveStatus,
  saveStatusTone,
  saveStatusAnnouncement,
  saving,
  publishing,
  primaryModifierLabel,
  primaryActionLabel,
  primaryActionClassName,
  shouldPublishLatestDraft,
  canUndo,
  canRedo,
  onFlowNameChange,
  onAddAgent,
  onUndo,
  onRedo,
  onDuplicateFlow,
  onDeleteFlow,
  onPersist,
  onPublish,
  onToggleStatus,
}: Omit<EditorToolbarProps, "activeFlowTab" | "onTabChange" | "sidebarCollapsed" | "effectiveLegacyAgentNodes">) {
  if (!selectedFlow || !draft) return null

  return (
    <>
      <div className="col-start-1 row-start-1 flex min-w-0 items-center lg:col-auto lg:row-auto">
        <span
          role={saveStatus === "error" ? "alert" : "status"}
          data-testid="flow-save-status-live"
          className="sr-only"
        >
          {saveStatusAnnouncement}
        </span>
        <div
          data-testid="flow-save-status"
          title={saveStatusTitle}
          className={cn(
            "hidden items-center text-[11px] font-medium md:inline-flex",
            quietSaveStatus
              ? "gap-1.5 px-1 py-1"
              : "gap-2 rounded-full border px-2.5 py-1.5",
            saveStatusTone.container,
          )}
        >
          {quietSaveStatus ? (
            <CheckCircle aria-hidden="true" className="size-3.5" />
          ) : (
            <span className={cn("size-1.5 rounded-full", saveStatusTone.dot)} />
          )}
          <span aria-hidden="true">{saveStatusLabel}</span>
          {(dirty || saveStatus === "error") && !saving && (
            <button
              type="button"
              onClick={onPersist}
              title={`Save (${primaryModifierLabel}S)`}
              className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] text-inherit hover:bg-foreground/10"
            >
              Save
            </button>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 justify-center xl:flex">
        <div
          data-testid="flow-header-pill"
          className="flex min-w-0 max-w-[520px] items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 shadow-lg"
        >
          <span className={cn(
            "size-1.5 shrink-0 rounded-full",
            selectedFlow.status === "active" ? "bg-accent-green" : "bg-muted-foreground",
          )} />
          <input
            aria-label="Flow name"
            data-testid="flow-name-input-desktop"
            value={draft.name}
            onChange={(event) => onFlowNameChange(event.target.value)}
            className="h-5 min-w-0 max-w-[220px] border-0 bg-transparent p-0 text-center text-sm font-semibold text-foreground shadow-none outline-none"
          />
          <span className="text-xs text-muted-foreground">
            {selectedFlow.published_version?.version_number ? `v${selectedFlow.published_version.version_number}` : "draft"}
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {flowRuns.length} run{flowRuns.length === 1 ? "" : "s"}
          </span>
          {flowSuccessRateLabel && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{flowSuccessRateLabel}</span>
            </>
          )}
        </div>
      </div>

      <div
        data-testid="flow-header-actions"
        className="relative col-start-2 row-start-1 ml-auto flex min-w-0 items-center justify-end gap-1.5 lg:col-auto lg:row-auto"
      >
        <button
          type="button"
          onClick={onAddAgent}
          className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          title="Add agent"
          aria-label="Add agent"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title={`Undo (${primaryModifierLabel}Z)`}
          aria-label="Undo"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
        >
          <Undo className="size-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title={`Redo (${primaryModifierLabel}Shift+Z${primaryModifierLabel === "Ctrl+" ? " / Ctrl+Y" : ""})`}
          aria-label="Redo"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
        >
          <Redo className="size-4" />
        </button>
        <button
          type="button"
          onClick={onDuplicateFlow}
          title="Duplicate flow"
          aria-label="Duplicate flow"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <Copy className="size-4" />
        </button>
        <button
          type="button"
          onClick={onDeleteFlow}
          title="Delete flow"
          aria-label="Delete flow"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent-red/[0.08] hover:text-accent-red"
        >
          <Trash className="size-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          className="h-8 gap-1.5 border-border bg-foreground/[0.035] px-3 text-xs text-muted-foreground"
        >
          <Play className="size-3.5" />
          Test run
        </Button>
        <Button
          type="button"
          data-testid="flow-publish-button"
          onClick={() => {
            if (selectedFlow.status === "active" || shouldPublishLatestDraft) {
              onPublish()
            } else {
              onToggleStatus()
            }
          }}
          disabled={
            publishing
            || saving
            || (selectedFlow.status === "active" && !shouldPublishLatestDraft)
          }
          className={primaryActionClassName}
        >
          {primaryActionLabel}
        </Button>
      </div>
    </>
  )
}

export function EditorToolbarCompactName({
  draft,
  selectedFlow,
  onFlowNameChange,
}: {
  draft: { name: string } | null
  selectedFlow: Flow | null
  onFlowNameChange: (name: string) => void
}) {
  if (!selectedFlow || !draft) return null

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card/80 px-3 py-2 shadow-sm xl:hidden">
      <span className={cn(
        "size-1.5 shrink-0 rounded-full",
        selectedFlow.status === "active" ? "bg-accent-green" : "bg-muted-foreground",
      )} />
      <input
        aria-label="Flow name"
        data-testid="flow-name-input-compact"
        value={draft.name}
        onChange={(event) => onFlowNameChange(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-foreground shadow-none outline-none"
      />
      <span className="shrink-0 text-xs text-muted-foreground">
        {selectedFlow.published_version?.version_number ? `v${selectedFlow.published_version.version_number}` : "draft"}
      </span>
    </div>
  )
}

export function EditorToolbarLegacyBanner({
  effectiveLegacyAgentNodes,
}: {
  effectiveLegacyAgentNodes: Array<{
    nodeId: string
    label: string
    modelId: string
    source: "override" | "missing"
  }>
}) {
  if (effectiveLegacyAgentNodes.length === 0) return null

  return (
    <div
      data-testid="flows-legacy-model-banner"
      className="mt-2 rounded-md border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-800 dark:text-amber-100"
    >
      {effectiveLegacyAgentNodes.length} node{effectiveLegacyAgentNodes.length === 1 ? "" : "s"} use models that are not enabled for this account.
    </div>
  )
}
