"use client"

import { useMemo } from "react"
import {
  Github,
  Plus,
  Search,
  Settings,
  SidebarCollapse,
} from "iconoir-react"
import type { FlowStarterTemplateId } from "@/lib/flows/templates"
import type { FlowActionOperation, FlowNodeType, PersonalFlowTemplate } from "@/lib/types"
import {
  FLOW_NODE_LIBRARY_GROUPS,
  TRIGGER_PRESETS,
} from "./constants"
import type { Installation } from "./types"
import { WorkflowSelect } from "./inspector-shared"
import { FlowLibraryNodeButton } from "./node-shells"
import {
  FlowTemplatePicker,
} from "./template-picker-popover"

export interface NodeLibrarySidebarProps {
  sidebarCollapsed: boolean
  onCollapse: (collapsed: boolean) => void
  flowSearch: string
  onSearchChange: (value: string) => void
  draft: { nodes: unknown[]; edges: unknown[] } | null
  visibleFlows: Array<{ id: string; name: string; status: string }>
  selectedFlowId: string | null
  onSelectFlow: (flowId: string | null) => void
  isLoading: boolean
  templatePickerOpen: boolean
  onTemplatePickerOpenChange: (open: boolean) => void
  isCreating: boolean
  installations: Installation[]
  createInstallationId: string
  onCreateInstallationChange: (value: string) => void
  createRepository: string
  onCreateRepositoryChange: (value: string) => void
  createRepositoryOptions: Array<{ full_name: string }>
  personalTemplates: PersonalFlowTemplate[]
  personalTemplatesHaveMore: boolean
  personalTemplatesLoadingMore: boolean
  personalTemplatePageCount: number
  onLoadMorePersonalTemplates: () => void
  teamTemplates: PersonalFlowTemplate[]
  teamTemplatesHaveMore: boolean
  teamTemplatesLoadingMore: boolean
  teamTemplatePageCount: number
  onLoadMoreTeamTemplates: () => void
  teamTemplatesCanWrite: boolean
  savingTemplate: boolean
  selectedFlow: { id: string; name: string } | null
  activeTeamId: string | null
  browseInstallationId: string
  currentTriggerNode: { id: string } | null
  currentTriggerLabel: string
  currentTriggerProvider: string
  onCreateFlow: (
    templateId: FlowStarterTemplateId | null,
    savedTemplate?: PersonalFlowTemplate,
    savedTemplateScope?: "personal" | "team",
  ) => void
  onDeleteTemplate: (template: PersonalFlowTemplate, scope: "personal" | "team") => void
  onSaveAsTemplate: () => void
  onSelectCanvasNode: (nodeId: string) => void
  onApplyTriggerPreset: (preset: (typeof TRIGGER_PRESETS)[number]) => void
  onAddNode: (
    type: Exclude<FlowNodeType, "start" | "end">,
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => void
}

export function NodeLibrarySidebar({
  sidebarCollapsed,
  onCollapse,
  flowSearch,
  onSearchChange,
  draft,
  visibleFlows,
  selectedFlowId,
  onSelectFlow,
  isLoading,
  templatePickerOpen,
  onTemplatePickerOpenChange,
  isCreating,
  installations,
  createInstallationId,
  onCreateInstallationChange,
  createRepository,
  onCreateRepositoryChange,
  createRepositoryOptions,
  personalTemplates,
  personalTemplatesHaveMore,
  personalTemplatesLoadingMore,
  onLoadMorePersonalTemplates,
  teamTemplates,
  teamTemplatesHaveMore,
  teamTemplatesLoadingMore,
  onLoadMoreTeamTemplates,
  teamTemplatesCanWrite,
  savingTemplate,
  selectedFlow,
  activeTeamId,
  currentTriggerNode,
  currentTriggerLabel,
  currentTriggerProvider,
  onCreateFlow,
  onDeleteTemplate,
  onSaveAsTemplate,
  onSelectCanvasNode,
  onApplyTriggerPreset,
  onAddNode,
}: NodeLibrarySidebarProps) {
  const filteredNodeLibraryGroups = useMemo(() => {
    const query = flowSearch.trim().toLowerCase()
    if (!query) return FLOW_NODE_LIBRARY_GROUPS

    return FLOW_NODE_LIBRARY_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const searchable = `${item.label} ${item.description} ${group.label}`.toLowerCase()
        return searchable.includes(query)
      }),
    })).filter((group) => group.items.length > 0)
  }, [flowSearch])

  const filteredTriggerPresets = useMemo(() => {
    const query = flowSearch.trim().toLowerCase()
    if (!query) return TRIGGER_PRESETS
    return TRIGGER_PRESETS.filter((preset) =>
      `${preset.label} ${preset.description} trigger`
        .toLowerCase()
        .includes(query),
    )
  }, [flowSearch])

  if (sidebarCollapsed) return null

  return (
    <aside
      data-testid="flow-node-library"
      className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-sidebar"
    >
      <div className="border-b border-border px-3 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Nodes
          </span>
          <button
            type="button"
            onClick={() => onCollapse(true)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            <SidebarCollapse className="size-3.5" />
          </button>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label
              htmlFor="flow-library-workflow"
              className="block text-[9px] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
            >
              Workflow
            </label>
            {visibleFlows.length > 0 ? (
              <span
                data-testid="flow-active-count"
                className="text-[9px] text-muted-foreground"
              >
                {visibleFlows.filter((flow) => flow.status === "active").length}
                /{visibleFlows.length} active
              </span>
            ) : null}
          </div>
          <div className="flex gap-1.5">
            <WorkflowSelect
              id="flow-library-workflow"
              ariaLabel="Select workflow"
              value={selectedFlowId ?? ""}
              onValueChange={(value) => onSelectFlow(value || null)}
              disabled={isLoading || visibleFlows.length === 0}
              className="min-w-0 flex-1 rounded-md border border-border bg-input px-2.5 py-2 text-xs font-medium text-foreground"
              options={
                visibleFlows.length === 0
                  ? [{
                      value: "",
                      label: isLoading
                        ? "Loading workflows..."
                        : "No matching workflows",
                    }]
                  : visibleFlows.map((flow) => ({
                      value: flow.id,
                      label: flow.name,
                      active: flow.status === "active",
                    }))
              }
            />
            <FlowTemplatePicker
              open={templatePickerOpen}
              onOpenChange={onTemplatePickerOpenChange}
              isCreating={isCreating}
              installations={installations}
              createInstallationId={createInstallationId}
              onCreateInstallationChange={onCreateInstallationChange}
              createRepository={createRepository}
              onCreateRepositoryChange={onCreateRepositoryChange}
              createRepositoryOptions={createRepositoryOptions}
              personalTemplates={personalTemplates}
              personalTemplatesHaveMore={personalTemplatesHaveMore}
              personalTemplatesLoadingMore={personalTemplatesLoadingMore}
              onLoadMorePersonalTemplates={onLoadMorePersonalTemplates}
              teamTemplates={teamTemplates}
              teamTemplatesHaveMore={teamTemplatesHaveMore}
              teamTemplatesLoadingMore={teamTemplatesLoadingMore}
              onLoadMoreTeamTemplates={onLoadMoreTeamTemplates}
              teamTemplatesCanWrite={teamTemplatesCanWrite}
              savingTemplate={savingTemplate}
              selectedFlow={selectedFlow}
              activeTeamId={activeTeamId}
              onCreateFlow={onCreateFlow}
              onDeleteTemplate={onDeleteTemplate}
              onSaveAsTemplate={onSaveAsTemplate}
              trigger={(
                <button
                  type="button"
                  disabled={!createInstallationId || isCreating}
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-input text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:opacity-40"
                  aria-label={isCreating ? "Creating workflow" : "New workflow"}
                  title={isCreating ? "Creating..." : "New workflow"}
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            />
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-md border border-border bg-input px-2.5 py-2 text-muted-foreground focus-within:border-ring focus-within:text-foreground">
          <Search className="size-3.5 shrink-0" />
          <input
            value={flowSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search nodes…"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-foreground shadow-none outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {!flowSearch.trim() ||
        `trigger github schedule webhook slack dependabot ${currentTriggerLabel}`
          .toLowerCase()
          .includes(flowSearch.trim().toLowerCase()) ||
        filteredTriggerPresets.length > 0 ? (
          <div className="border-b border-border pb-2">
            <div className="flows-library-group-label">Trigger</div>
            <button
              type="button"
              data-testid="flow-library-current-trigger"
              onClick={() => {
                if (currentTriggerNode) onSelectCanvasNode(currentTriggerNode.id)
              }}
              disabled={!currentTriggerNode}
              className="flows-library-item group"
            >
              <span className="flows-library-icon flows-library-tone-trigger" aria-hidden>
                <Github className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">
                  {currentTriggerLabel}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {currentTriggerProvider} trigger · configured
                </span>
              </span>
              <Settings className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
            </button>
            {filteredTriggerPresets.length > 0 ? (
              <>
                <div className="mx-3 my-1.5 border-t border-border" />
                {filteredTriggerPresets.map((preset) => {
                  const Icon = preset.icon
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`flow-trigger-preset-${preset.id}`}
                      onClick={() => onApplyTriggerPreset(preset)}
                      disabled={!currentTriggerNode}
                      className="flows-library-item group"
                    >
                      <span className="flows-library-icon flows-library-tone-trigger" aria-hidden>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {preset.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {preset.description}
                        </span>
                      </span>
                      <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                    </button>
                  )
                })}
              </>
            ) : null}
          </div>
        ) : null}

        {filteredNodeLibraryGroups.map((group) => (
          <div
            key={group.label}
            className="border-b border-border pb-2 last:border-b-0"
          >
            <div className="flows-library-group-label">{group.label}</div>
            {group.items.map((item) => (
              <FlowLibraryNodeButton
                key={item.testId}
                item={item}
                onAdd={onAddNode}
              />
            ))}
          </div>
        ))}

        {filteredNodeLibraryGroups.length === 0 && (
          <div className="mx-3 mt-3 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            No nodes match "{flowSearch.trim()}".
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2.5 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>{draft?.nodes.length ?? 0} nodes</span>
          <span>{draft?.edges.length ?? 0} connections</span>
        </div>
        <div className="mt-1.5 truncate text-muted-foreground">
          Click to add · right-click canvas for more
        </div>
      </div>
    </aside>
  )
}
