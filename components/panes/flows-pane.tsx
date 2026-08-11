"use client"
import "@xyflow/react/dist/style.css"
import { useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { useTheme } from "next-themes"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import { Background, BackgroundVariant, Controls, ReactFlow, type ColorMode, type ReactFlowInstance } from "@xyflow/react"
import { useAgents } from "@/hooks/use-agents"
import { useModels } from "@/hooks/use-models"
import { useRepos } from "@/hooks/use-repos"
import { cn } from "@/lib/utils"
import { getActiveTeamRequestHeaders, useActiveTeamId } from "@/components/active-scope-provider"
import { flowAgentRoleLabel } from "@/lib/flows/graph"
import { cloneFlowDraftSnapshot, serializePersistedFlowDraft, type FlowCanvasEdge, type FlowCanvasNode, type FlowDraftClipboard } from "@/lib/flows/editor"
import type { PersonalFlowTemplate, PersonalFlowTemplatePage } from "@/lib/types"
import { FlowRunDetailsDialog } from "./flow-run-details"
import { FlowAssistantPanel } from "@/components/flows/flow-assistant-panel"
import { useFlowAssistantPanel } from "@/hooks/use-flow-assistant-panel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { CursorPointer, Github, Settings, SidebarCollapse, SidebarExpand, Xmark } from "iconoir-react"
import {
  type AutomationHarnessesResponse,
  FLOW_FIT_VIEW_OPTIONS, FLOW_CANVAS_BACKGROUND, FLOW_CANVAS_VIGNETTE_BACKGROUND, FLOW_ACTION_OPTIONS, AUTOSAVE_DELAY_MS, PUBLISH_SUCCESS_STATE_MS,
  ResponsiveMiniMap, NODE_TYPES, WorkflowSelect, installationAccountTypeLabel, installationAccountLabel, RepositoryScopePicker,
  CanvasContextMenu, SaveTemplateDialog, DeleteTemplateDialog, RunsTabContent, ExecutionBar,
  ConditionInspector, ParallelInspector, JoinInspector, DelayInspector, EndInspector,
  EditorToolbarHeader, EditorToolbarCompactName, EditorToolbarLegacyBanner,
  SetVariableInspector, TransformInspector, AwaitEventInspector, ActionInspector, NodeLibrarySidebar, AgentInspector, StartInspector,
  useFlowSelectionState, useFlowCreateBrowseState, useFlowTemplateState, useFlowChromeState, useFlowSavePublishState, useFlowSandboxTestState, useFlowRunActionsState,
  useFlowSavePublishHandlers, useFlowCrudHandlers, useFlowTemplateHandlers, useFlowCanvasHandlers, useFlowDraftMutations, useFlowContextMenuHandlers, useFlowGraphOperations, useFlowRunHandlers, useFlowTestHandlers, useFlowKeyboardEffects,
  useFlowDerivedSelection, useFlowSlackChannels, useFlowDerivedStatus,
  useFlowDerivedOptions,
  useFlowDerivedRuns,
  useFlowDerivedCanvas,
} from "./flows-pane/index"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `API error: ${response.status}`)
  }
  return response.json()
}

export function FlowsPane() {
  const { scope } = useParams<{ scope: string }>()
  const { resolvedTheme } = useTheme()
  const canvasColorMode: ColorMode = resolvedTheme === "dark" ? "dark" : "light"
  const activeTeamId = useActiveTeamId()
  const harnessesKey = activeTeamId
    ? `/api/automations/harnesses?team=${encodeURIComponent(activeTeamId)}`
    : "/api/automations/harnesses"
  const {
    data: harnessesResponse,
    error: harnessesError,
    isLoading: harnessesLoading,
  } = useSWR<AutomationHarnessesResponse>(
    harnessesKey,
    async (url: string) => {
      const response = await fetch(url, {
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `API error: ${response.status}`)
      }
      return response.json()
    },
  )
  const { data: flows, mutate: mutateFlows, isLoading } = useSWR<import("@/lib/types").Flow[]>("/api/flows", fetcher)
  const {
    data: personalTemplatePages,
    isValidating: personalTemplatesValidating,
    size: personalTemplatePageCount,
    setSize: setPersonalTemplatePageCount,
    mutate: mutatePersonalTemplates,
  } = useSWRInfinite<PersonalFlowTemplatePage>(
    (_pageIndex, previousPage) => {
      if (previousPage && !previousPage.next_cursor) return null
      return previousPage?.next_cursor
        ? `/api/flows/templates?cursor=${encodeURIComponent(previousPage.next_cursor)}`
        : "/api/flows/templates"
    },
    fetcher,
  )
  const {
    data: teamTemplatePages,
    isValidating: teamTemplatesValidating,
    size: teamTemplatePageCount,
    setSize: setTeamTemplatePageCount,
    mutate: mutateTeamTemplates,
  } = useSWRInfinite<PersonalFlowTemplatePage>(
    (_pageIndex, previousPage) => {
      if (!activeTeamId || (previousPage && !previousPage.next_cursor)) return null
      const scopeQuery = `team_scope=${encodeURIComponent(activeTeamId)}`
      return previousPage?.next_cursor
        ? `/api/flows/templates?${scopeQuery}&cursor=${encodeURIComponent(previousPage.next_cursor)}`
        : `/api/flows/templates?${scopeQuery}`
    },
    async (url: string) => {
      const response = await fetch(url, {
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `API error: ${response.status}`)
      }
      return response.json()
    },
  )
  const personalTemplates = (personalTemplatePages ?? []).flatMap((page) => page.templates)
    .reduce<PersonalFlowTemplate[]>((acc, t) => acc.some((x) => x.id === t.id) ? acc : [...acc, t], [])
  const personalTemplatesHaveMore = Boolean(personalTemplatePages?.at(-1)?.next_cursor)
  const personalTemplatesLoadingMore = personalTemplatesValidating && Boolean(personalTemplatePages?.length)
  const teamTemplates = (teamTemplatePages ?? []).flatMap((page) => page.templates)
    .reduce<PersonalFlowTemplate[]>((acc, t) => acc.some((x) => x.id === t.id) ? acc : [...acc, t], [])
  const teamTemplatesHaveMore = Boolean(teamTemplatePages?.at(-1)?.next_cursor)
  const teamTemplatesLoadingMore = teamTemplatesValidating && Boolean(teamTemplatePages?.length)
  const teamTemplatesCanWrite = teamTemplatePages?.[0]?.can_write !== false
  const { data: installations } = useSWR<import("./flows-pane/types").Installation[]>("/api/github/installations", fetcher)
  const { data: slackInstallationsResponse } = useSWR<{
    installations: import("./flows-pane/types").SlackInstallation[]
  }>("/api/integrations/slack/installations", fetcher)
  const { agents } = useAgents()
  const { repos } = useRepos()
  const { models, defaultModelId, hiddenModelIds, isLoading: modelsLoading } = useModels()

  // State hooks
  const {
    selectedFlowId, setSelectedFlowId, selectedFlow, mutateSelectedFlow,
    selectedRunId, setSelectedRunId, flowRunsResponse, mutateFlowRuns,
    selectedRunDetailResponse, selectedRunDetailError, selectedRunDetailLoading,
    mutateSelectedRunDetail, activeFlowTab, setActiveFlowTab,
  } = useFlowSelectionState()
  const {
    createInstallationId, setCreateInstallationId, createRepository, setCreateRepository,
    createRepositoryOptions, isCreating, setIsCreating, browseInstallationId, setBrowseInstallationId,
    browseRepositories, setBrowseRepositories, browseRepositoryOptions, browseAccountLabel,
    flowSearch, setFlowSearch, visibleFlows,
  } = useFlowCreateBrowseState({ installations, flows })
  const {
    templatePickerOpen, setTemplatePickerOpen, saveTemplateOpen, setSaveTemplateOpen,
    saveTemplateName, setSaveTemplateName, saveTemplateScope, setSaveTemplateScope,
    savingTemplate, setSavingTemplate, templateDeleteTarget, setTemplateDeleteTarget,
    deletingTemplate, setDeletingTemplate,
  } = useFlowTemplateState()
  const {
    sidebarCollapsed, setSidebarCollapsed, inspectorCollapsed, setInspectorCollapsed,
    contextMenu, setContextMenu, spacePanActive, rightSheetAnimateOpen, setRightSheetAnimateOpen,
  } = useFlowChromeState()
  const {
    history, setHistory, baselineDraft, setBaselineDraft, saving, setSaving, saveStatus, setSaveStatus,
    saveError, setSaveError, savedInSessionFlowId, setSavedInSessionFlowId, publishing, setPublishing,
    publishSucceeded, setPublishSucceeded, draft, dirty, canUndo, canRedo, historyMergeRef,
    autosaveTimeoutRef, publishStateTimeoutRef, autosaveAttemptSignatureRef, hydratedFlowIdRef,
  } = useFlowSavePublishState({ selectedFlow, setContextMenu })
  const { activeRunActionsRef, activeRunActions, setActiveRunActions, reviewFindingIssueActionId, setReviewFindingIssueActionId } = useFlowRunActionsState()
  const assistantPanelOpen = useFlowAssistantPanel((s) => s.open)
  const toggleAssistantPanel = useFlowAssistantPanel((s) => s.toggleOpen)
  const setAssistantPanelOpen = useFlowAssistantPanel((s) => s.setOpen)
  const {
    sandboxTestRepoId, setSandboxTestRepoId, sandboxTestNodeId, setSandboxTestNodeId,
    sandboxTestResult, setSandboxTestResult, sandboxTestError, setSandboxTestError,
    sandboxTestRunning, setSandboxTestRunning, triggerTestRunning, setTriggerTestRunning,
    webhookSecretGeneratingRef, webhookSecretGenerating, setWebhookSecretGenerating,
    generatedWebhookSecretState, setGeneratedWebhookSecretState, generatedWebhookSecret,
  } = useFlowSandboxTestState({ selectedFlowId })

  // Derived value hooks
  const derivedSelection = useFlowDerivedSelection({
    draft, selectedFlow, agents, installations, slackInstallationsResponse, scope,
  })
  // Slack channels page through the team id of the selected action/start node,
  // so the SWR key must derive from the selection, not the draft's start node.
  const { slackChannels, slackChannelsLoading, slackChannelsHaveMore, slackChannelsLoadingMore,
    slackChannelPageCount, setSlackChannelPageCount } = useFlowSlackChannels({
    selectedSlackTeamId: derivedSelection.selectedSlackTeamId, fetcher,
  })
  const derivedStatus = useFlowDerivedStatus({
    draft, selectedFlow, selectedFlowId, dirty, saveStatus, saveError,
    savedInSessionFlowId, publishing, publishSucceeded,
  })
  const derivedOptions = useFlowDerivedOptions({
    draft, models, defaultModelId, hiddenModelIds, modelsLoading,
    selectedAgentModelOverride: derivedSelection.selectedAgentNode?.data.modelOverride,
  })
  const derivedRuns = useFlowDerivedRuns({ flowRunsResponse, selectedRunId })
  const derivedCanvas = useFlowDerivedCanvas({
    draft, selectedFlowInstallation: derivedSelection.selectedFlowInstallation,
    selectedStartConfig: derivedSelection.selectedStartConfig, repos, contextMenu,
    openEdgeContextMenu: (edgeId, x, y) => setContextMenu({ kind: "edge", x, y, flowPosition: null, nodeId: null, nodeType: null, edgeId }),
  })

  const { selectedNode, selectedStartConfig, selectedAgentNode, selectedStartNode, selectedActionNode,
    selectedConditionNode, selectedParallelNode, selectedJoinNode, selectedDelayNode,
    selectedAwaitEventNode, selectedSetVariableNode, selectedTransformNode, selectedEndNode,
    selectedAgentDefinition, effectiveInstallationId, slackInstallations,
    slackConnectionsHref, apiKeysSettingsHref, selectedSlackTeamId } = derivedSelection
  const { primaryModifierLabel, saveStatusLabel, saveStatusTitle, quietSaveStatus, saveStatusTone,
    saveStatusAnnouncement, shouldPublishLatestDraft, primaryActionLabel, primaryActionClassName } = derivedStatus
  const { availableModelOptions, enabledModelIds, quickReplaceFlowModelId, quickReplaceFlowModelName,
    canQuickReplaceFlowModel, effectiveLegacyAgentNodes } = derivedOptions
  const { flowRuns, latestFlowRun, latestFlowRunStatus, selectedRunSummary, flowSuccessRateLabel } = derivedRuns
  const { renderedCanvasNodes, currentTriggerNode, currentTriggerLabel, currentTriggerProvider,
    sandboxTestRepos, hasCanvasSelection, contextMenuPosition, edgeTypes, renderedEdges, draftGraph } = derivedCanvas

  const inspectorOpen = Boolean(selectedFlow && selectedNode)
  const rightSheetOpen = assistantPanelOpen || inspectorOpen
  const inspectorDockCollapsed = inspectorCollapsed && !rightSheetOpen
  const selectedRunDetail = selectedRunDetailResponse?.run ?? null

  // Handler hooks
  const { persistFlow, publishFlow, toggleFlowStatus, undoDraft, redoDraft, resetHistoryMerge } = useFlowSavePublishHandlers({
    setHistory, setBaselineDraft, setSaving, setSaveStatus, setSaveError, setSavedInSessionFlowId,
    setPublishing, setPublishSucceeded, autosaveTimeoutRef, publishStateTimeoutRef,
    autosaveAttemptSignatureRef, historyMergeRef, selectedFlow, draft, dirty, publishing, saving,
    activeTeamId, mutateFlows, mutateSelectedFlow, publishSuccessStateMs: PUBLISH_SUCCESS_STATE_MS,
  })
  const { createFlow, duplicateSelectedFlow, deleteSelectedFlow } = useFlowCrudHandlers({
    createInstallationId, createRepository, setIsCreating, setBrowseInstallationId,
    setBrowseRepositories, setSelectedFlowId, setTemplatePickerOpen, selectedFlow, activeTeamId, mutateFlows,
  })
  const { saveSelectedFlowAsTemplate, deleteSavedTemplate } = useFlowTemplateHandlers({
    saveTemplateName, saveTemplateScope, savingTemplate, setSavingTemplate, setSaveTemplateOpen,
    setTemplatePickerOpen, templateDeleteTarget, setTemplateDeleteTarget, deletingTemplate,
    setDeletingTemplate, setPersonalTemplatePageCount, setTeamTemplatePageCount, mutatePersonalTemplates,
    mutateTeamTemplates, selectedFlow, draft, dirty, activeTeamId, persistFlow,
  })
  const editorRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const reactFlowRef = useRef<ReactFlowInstance<FlowCanvasNode, FlowCanvasEdge> | null>(null)
  const fittedFlowIdRef = useRef<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const canvasClipboardRef = useRef<FlowDraftClipboard | null>(null)
  const canvasPasteCountRef = useRef(0)

  const { updateDraft, handleFlowNameChange, onNodesChange, onEdgesChange, onConnect, onSelectionChange,
    updateNodeData, updateTriggerInstallation } = useFlowCanvasHandlers({
    setHistory, historyMergeRef, selectedFlow, reactFlowRef, fittedFlowIdRef, hydratedFlowIdRef,
    installations, effectiveInstallationId, selectedStartNode,
  })
  const { getDefaultInsertionPosition, addNode, selectCanvasNode, applyTriggerPreset, deleteSelectedNode,
    deleteSelectedCanvasItems, duplicateSelectedCanvasItems, duplicateContextMenuNode, deleteContextMenuNode,
    copySelectedCanvasItems, cutSelectedCanvasItems, pasteCanvasItems, clearCanvasSelection, selectAllCanvasAgents } = useFlowDraftMutations({
    draft, updateDraft, updateNodeData, agents, selectedStartConfigEvent: selectedStartConfig?.event,
    currentTriggerNode, selectedNode, reactFlowRef, canvasClipboardRef, canvasPasteCountRef,
  })
  const { closeContextMenu, resolveContextMenuPoint, openCanvasContextMenu, openNodeContextMenu,
    openEdgeContextMenu, handlePaneContextMenu, runContextMenuAction } = useFlowContextMenuHandlers({
    setContextMenu, updateDraft, editorRef, canvasRef, reactFlowRef,
  })
  const { insertNodeOnEdge, tidyCanvasLayout, straightenCanvasSelection, applyAssistantGraph } = useFlowGraphOperations({
    draft, updateDraft, agents, selectedStartConfigEvent: selectedStartConfig?.event,
  })
  const { setRunActionState, runFlowJobAction, createReviewFindingIssue } = useFlowRunHandlers({
    activeRunActionsRef, setActiveRunActions, reviewFindingIssueActionId, setReviewFindingIssueActionId,
    selectedRunDetail, mutateFlowRuns, mutateFlows, mutateSelectedRunDetail,
  })
  const { runAutomationSandboxTest, generateWebhookSecret, copyWebhookValue, runTriggerTest } = useFlowTestHandlers({
    sandboxTestRepoId, setSandboxTestRunning, setSandboxTestResult, setSandboxTestError,
    webhookSecretGeneratingRef, setWebhookSecretGenerating, setGeneratedWebhookSecretState, setTriggerTestRunning,
    selectedFlow, activeTeamId, mutateFlows, mutateSelectedFlow, mutateFlowRuns,
  })

  // Effects
  useEffect(() => {
    if (selectedFlowId && visibleFlows.some((f) => f.id === selectedFlowId)) return
    setSelectedFlowId(visibleFlows[0]?.id ?? null)
  }, [selectedFlowId, setSelectedFlowId, visibleFlows])

  useEffect(() => {
    if (!rightSheetOpen) { setRightSheetAnimateOpen(false); return }
    const raf = requestAnimationFrame(() => setRightSheetAnimateOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [rightSheetOpen, setRightSheetAnimateOpen])

  useEffect(() => {
    if (!rightSheetAnimateOpen || !selectedFlowId) return
    const flowId = selectedFlowId
    let fitRaf: number | null = null
    const layoutRaf = requestAnimationFrame(() => {
      fitRaf = requestAnimationFrame(() => {
        if (hydratedFlowIdRef.current === flowId) void reactFlowRef.current?.fitView(FLOW_FIT_VIEW_OPTIONS)
      })
    })
    return () => { cancelAnimationFrame(layoutRaf); if (fitRaf !== null) cancelAnimationFrame(fitRaf) }
  }, [rightSheetAnimateOpen, selectedFlowId])

  useEffect(() => {
    if (!selectedAgentNode || selectedAgentNode.data.autofixSandbox !== true) {
      setSandboxTestNodeId(null); setSandboxTestResult(null); setSandboxTestError(null); return
    }
    if (sandboxTestNodeId !== selectedAgentNode.id) {
      setSandboxTestNodeId(selectedAgentNode.id); setSandboxTestResult(null); setSandboxTestError(null)
    }
    if (sandboxTestRepos.length > 0 && (!sandboxTestRepoId || !sandboxTestRepos.some((r) => r.id === sandboxTestRepoId))) {
      setSandboxTestRepoId(sandboxTestRepos[0]?.id ?? "")
    }
  }, [sandboxTestNodeId, sandboxTestRepoId, sandboxTestRepos, selectedAgentNode])

  useEffect(() => {
    if (!selectedFlow || !draft || !dirty || saving || publishing) return
    const snapshot = cloneFlowDraftSnapshot(draft)
    const sig = serializePersistedFlowDraft(snapshot)
    if (autosaveAttemptSignatureRef.current === sig) return
    setSaveStatus("pending")
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current)
    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveTimeoutRef.current = null
      void persistFlow({ reason: "autosave", silentSuccess: true, snapshot })
    }, AUTOSAVE_DELAY_MS)
    return () => { if (autosaveTimeoutRef.current) { clearTimeout(autosaveTimeoutRef.current); autosaveTimeoutRef.current = null } }
  }, [dirty, draft, persistFlow, publishing, saving, selectedFlow])

  useFlowKeyboardEffects({
    selectedFlow, selectedRunId, activeFlowTab, contextMenu, closeContextMenu, contextMenuRef, canvasRef,
    persistFlow, undoDraft, redoDraft, duplicateSelectedCanvasItems, copySelectedCanvasItems, cutSelectedCanvasItems,
    pasteCanvasItems, selectAllCanvasAgents, clearCanvasSelection, deleteSelectedCanvasItems,
  })

  return (
    <div className="flows-pane relative flex h-full min-h-0 flex-col bg-background">
      <div data-testid="flow-browser-filters" className="flex h-12 min-h-12 min-w-[760px] items-center gap-2 border-b border-border bg-card px-3">
        <div className="mr-1 hidden shrink-0 items-center gap-2 lg:flex">
          <Github className="size-3.5 text-muted-foreground" />
          <span className="text-[9px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Viewing</span>
        </div>
        <WorkflowSelect testId="flow-browser-account" ariaLabel="Filter workflows by GitHub account" value={browseInstallationId}
          onValueChange={(v) => { setBrowseInstallationId(v); setBrowseRepositories([]) }}
          className="h-8 max-w-[220px] rounded-md border border-border bg-input px-2.5 text-[11px] font-medium text-foreground"
          options={[{ value: "all", label: "All GitHub accounts" }, ...(installations || []).map((i) => ({ value: String(i.installation_id), label: `${installationAccountLabel(i)} · ${installationAccountTypeLabel(i.account_type)}` }))]} />
        <div className="min-w-0 max-w-[260px] flex-1">
          <RepositoryScopePicker accountLabel={browseAccountLabel} options={browseRepositoryOptions.map((r) => r.full_name)} selected={browseRepositories} onChange={setBrowseRepositories}
            ariaLabel="Filter workflows by repository" compact testId="flow-browser-repository" optionTestIdPrefix="flow-browser-repository-option" menuLabel="Repository filter" description="Choose which repositories are visible in the workflow list." />
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground" title="These filters change what is visible, not when a workflow runs.">{visibleFlows.length} of {(flows || []).length} workflows</span>
      </div>
      {sidebarCollapsed && <button type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar" className="absolute left-3 top-[60px] z-30 grid size-8 place-items-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-foreground/25 hover:text-foreground"><SidebarExpand className="size-4" /></button>}
      {inspectorDockCollapsed && <button type="button" onClick={() => setInspectorCollapsed(false)} aria-label="Expand inspector" title="Expand inspector" className="flows-inspector-dock-toggle absolute right-3 top-[60px] z-30 size-8 place-items-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-foreground/25 hover:text-foreground"><SidebarExpand className="size-4 rotate-180" /></button>}
      <div className={cn("flows-pane-grid grid min-h-0 flex-1", inspectorOpen && "flows-pane-grid-inspector-open", assistantPanelOpen && "flows-pane-grid-assistant-open", sidebarCollapsed && "flows-pane-grid-sidebar-collapsed", inspectorDockCollapsed && "flows-pane-grid-inspector-collapsed")}>
        <NodeLibrarySidebar sidebarCollapsed={sidebarCollapsed} onCollapse={setSidebarCollapsed} flowSearch={flowSearch} onSearchChange={setFlowSearch} draft={draft} visibleFlows={visibleFlows} selectedFlowId={selectedFlowId}
          onSelectFlow={setSelectedFlowId} isLoading={isLoading} templatePickerOpen={templatePickerOpen} onTemplatePickerOpenChange={(open) => { if (open && browseInstallationId !== "all" && browseInstallationId !== createInstallationId) setCreateInstallationId(browseInstallationId); setTemplatePickerOpen(open) }}
          isCreating={isCreating} installations={installations ?? []} createInstallationId={createInstallationId} onCreateInstallationChange={setCreateInstallationId} createRepository={createRepository} onCreateRepositoryChange={setCreateRepository}
          createRepositoryOptions={createRepositoryOptions} personalTemplates={personalTemplates} personalTemplatesHaveMore={personalTemplatesHaveMore} personalTemplatesLoadingMore={personalTemplatesLoadingMore} personalTemplatePageCount={personalTemplatePageCount}
          onLoadMorePersonalTemplates={() => void setPersonalTemplatePageCount(personalTemplatePageCount + 1)} teamTemplates={teamTemplates} teamTemplatesHaveMore={teamTemplatesHaveMore} teamTemplatesLoadingMore={teamTemplatesLoadingMore}
          teamTemplatePageCount={teamTemplatePageCount} onLoadMoreTeamTemplates={() => void setTeamTemplatePageCount(teamTemplatePageCount + 1)} teamTemplatesCanWrite={teamTemplatesCanWrite} savingTemplate={savingTemplate}
          selectedFlow={selectedFlow ?? null} activeTeamId={activeTeamId} browseInstallationId={browseInstallationId} currentTriggerNode={currentTriggerNode ?? null} currentTriggerLabel={currentTriggerLabel} currentTriggerProvider={currentTriggerProvider}
          onCreateFlow={(tid, st, ss) => void createFlow(tid, st, ss)} onDeleteTemplate={(t, s) => { setTemplatePickerOpen(false); setTemplateDeleteTarget({ template: t, scope: s }) }}
          onSaveAsTemplate={() => { if (!selectedFlow) return; setSaveTemplateName(selectedFlow.name); setSaveTemplateScope(activeTeamId && teamTemplatesCanWrite ? "team" : "personal"); setTemplatePickerOpen(false); setSaveTemplateOpen(true) }}
          onSelectCanvasNode={selectCanvasNode} onApplyTriggerPreset={applyTriggerPreset} onAddNode={addNode} />
        <section ref={editorRef} tabIndex={0} onMouseDownCapture={() => editorRef.current?.focus()} className="min-w-0 min-h-0 flex flex-col bg-transparent outline-none">
          {!selectedFlow || !draft ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select or create a flow to begin.</div> : (
            <Tabs value={activeFlowTab} onValueChange={setActiveFlowTab} className="relative flex min-h-0 flex-1 flex-col gap-0">
              <div className={cn("relative z-20 border-b border-border bg-card/92 py-2 pr-3", sidebarCollapsed ? "pl-14" : "pl-3")}>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 lg:flex lg:h-9 lg:justify-between">
                  <EditorToolbarHeader draft={draft} selectedFlow={selectedFlow} flowRuns={flowRuns} flowSuccessRateLabel={flowSuccessRateLabel} dirty={dirty} saveStatus={saveStatus} saveStatusLabel={saveStatusLabel} saveStatusTitle={saveStatusTitle}
                    quietSaveStatus={quietSaveStatus} saveStatusTone={saveStatusTone} saveStatusAnnouncement={saveStatusAnnouncement} saving={saving} publishing={publishing} primaryModifierLabel={primaryModifierLabel} primaryActionLabel={primaryActionLabel}
                    primaryActionClassName={primaryActionClassName} shouldPublishLatestDraft={shouldPublishLatestDraft} canUndo={canUndo} canRedo={canRedo} onFlowNameChange={handleFlowNameChange} onAddAgent={() => addNode("agent")} onUndo={undoDraft}
                    onRedo={redoDraft} onDuplicateFlow={() => void duplicateSelectedFlow()} onDeleteFlow={() => void deleteSelectedFlow()} onPersist={() => void persistFlow({ reason: "manual" })} onPublish={() => void publishFlow()} onToggleStatus={() => void toggleFlowStatus()} />
                  <TabsList data-testid="flow-view-tabs" className="col-span-2 row-start-2 h-8 shrink-0 justify-self-start gap-1 border border-border bg-card/80 p-1 shadow-sm lg:col-auto lg:row-auto lg:justify-self-auto">
                    <TabsTrigger value="editor" className="h-6 rounded-sm px-2.5 py-1 text-[11px]">Canvas</TabsTrigger>
                    <TabsTrigger value="runs" data-testid="flows-runs-tab" className="h-6 rounded-sm px-2.5 py-1 text-[11px]">Runs{flowRuns.length > 0 && <span className="ml-1.5 text-muted-foreground">({flowRuns.length})</span>}</TabsTrigger>
                  </TabsList>
                </div>
                <EditorToolbarCompactName draft={draft} selectedFlow={selectedFlow} onFlowNameChange={handleFlowNameChange} />
                <EditorToolbarLegacyBanner effectiveLegacyAgentNodes={effectiveLegacyAgentNodes} />
              </div>
              <TabsContent value="editor" forceMount className="flex-1 min-h-0 relative data-[state=inactive]:hidden">
                <div data-testid="flow-insert-toolbar" className="absolute left-3 right-3 top-3 z-10 flex justify-center">
                  <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-card/80 px-1.5 py-1.5 shadow-lg backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <button type="button" onClick={() => tidyCanvasLayout()} className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">Tidy graph</button>
                    <button type="button" onClick={() => straightenCanvasSelection()} className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">Straighten</button>
                    <div className="mx-1 h-4 w-px shrink-0 bg-border/60" />
                    <button type="button" data-testid="flow-assistant-toggle" onClick={() => toggleAssistantPanel()} className={cn("shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium transition-colors hover:bg-foreground/[0.06] hover:text-foreground", assistantPanelOpen ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground")}>Assistant</button>
                  </div>
                </div>
                <div ref={canvasRef} tabIndex={-1} onMouseDownCapture={() => canvasRef.current?.focus()} className="relative h-full outline-none">
                  <ReactFlow nodes={renderedCanvasNodes} edges={renderedEdges} nodeTypes={NODE_TYPES} edgeTypes={edgeTypes} colorMode={canvasColorMode} panOnDrag={spacePanActive ? [0, 1] : false} selectionOnDrag={!spacePanActive}
                    panActivationKeyCode={null} deleteKeyCode={null} onPaneContextMenu={handlePaneContextMenu} onPaneClick={() => { closeContextMenu(); clearCanvasSelection() }} onInit={(i) => { reactFlowRef.current = i }}
                    onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onSelectionChange={onSelectionChange} onMoveStart={(e) => { if (e) closeContextMenu() }}
                    onMoveEnd={(_e, v) => updateDraft((c) => ({ ...c, viewport: v }), { recordHistory: false })} defaultViewport={draft.viewport}
                    onNodeContextMenu={(e, n) => { e.preventDefault(); e.stopPropagation(); canvasRef.current?.focus(); openNodeContextMenu(n as FlowCanvasNode, e.clientX, e.clientY) }}
                    onEdgeContextMenu={(e, ed) => { e.preventDefault(); e.stopPropagation(); canvasRef.current?.focus(); openEdgeContextMenu(ed.id, e.clientX, e.clientY) }}
                    minZoom={0.1} fitView fitViewOptions={FLOW_FIT_VIEW_OPTIONS} proOptions={{ hideAttribution: true }} className={cn("flows-canvas bg-transparent", spacePanActive && "flows-canvas-pan")}>
                    <Background variant={BackgroundVariant.Dots} gap={FLOW_CANVAS_BACKGROUND.gap} size={FLOW_CANVAS_BACKGROUND.dotSize} color={FLOW_CANVAS_BACKGROUND.dotColor} bgColor={FLOW_CANVAS_BACKGROUND.baseColor} />
                    <div aria-hidden="true" data-testid="flow-canvas-vignette" className="pointer-events-none absolute inset-0 z-[1]" style={{ background: FLOW_CANVAS_VIGNETTE_BACKGROUND }} />
                    <ResponsiveMiniMap /><Controls />
                  </ReactFlow>
                  <ExecutionBar latestFlowRun={latestFlowRun} latestFlowRunStatus={latestFlowRunStatus} onViewRuns={() => setActiveFlowTab("runs")} />
                  {contextMenu && contextMenuPosition && <CanvasContextMenu contextMenu={contextMenu} contextMenuRef={contextMenuRef} contextMenuPosition={contextMenuPosition} hasCanvasSelection={hasCanvasSelection} canUndo={canUndo} canRedo={canRedo}
                    saving={saving} dirty={dirty} draftNodes={draft?.nodes ?? []} runContextMenuAction={runContextMenuAction} addNode={addNode} insertNodeOnEdge={insertNodeOnEdge} tidyCanvasLayout={tidyCanvasLayout} straightenCanvasSelection={straightenCanvasSelection}
                    undoDraft={undoDraft} redoDraft={redoDraft} persistFlow={persistFlow} duplicateSelectedCanvasItems={duplicateSelectedCanvasItems} deleteSelectedCanvasItems={deleteSelectedCanvasItems} selectAllCanvasAgents={selectAllCanvasAgents}
                    clearCanvasSelection={clearCanvasSelection} duplicateContextMenuNode={duplicateContextMenuNode} deleteContextMenuNode={deleteContextMenuNode} />}
                </div>
              </TabsContent>
              <TabsContent value="runs" className="flex-1 min-h-0 overflow-y-auto"><RunsTabContent flowRuns={flowRuns} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} activeRunActions={activeRunActions} onRunAction={(j, a) => { void runFlowJobAction(j, a) }} /></TabsContent>
            </Tabs>
          )}
        </section>
        <FlowRunDetailsDialog open={Boolean(selectedRunId)} runDetail={selectedRunDetail} runSummary={selectedRunSummary} loading={selectedRunDetailLoading} error={selectedRunDetailError} activeRunActions={activeRunActions} reviewFindingIssueActionId={reviewFindingIssueActionId}
          onOpenChange={(o) => { if (!o) setSelectedRunId(null) }} onRunAction={(j, a) => { void runFlowJobAction(j, a) }} onCreateReviewFindingIssue={(f) => { void createReviewFindingIssue(f) }} />
        {rightSheetOpen && <div className="flows-inspector-backdrop fixed inset-0 z-30 bg-overlay" onClick={() => { if (assistantPanelOpen) setAssistantPanelOpen(false); else clearCanvasSelection() }} />}
        <aside data-testid="flows-right-sheet" data-state={rightSheetAnimateOpen ? "open" : "closed"} className={cn("flows-inspector min-h-0 flex-col overflow-hidden border-l border-border bg-background p-2", rightSheetOpen && "flows-inspector-open")}>
          {assistantPanelOpen && selectedFlow && draftGraph ? <FlowAssistantPanel key={selectedFlow.id} flowId={selectedFlow.id} graph={draftGraph} onApplyGraph={applyAssistantGraph} /> : !selectedFlow || !selectedNode ? (
            <div data-testid="flows-inspector-empty" className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg border border-border bg-input text-muted-foreground"><Settings className="size-4" /></span><div><div className="text-[11px] font-semibold tracking-[0.16em] text-foreground uppercase">Inspector</div><div className="mt-0.5 text-[10px] text-muted-foreground">Workflow configuration</div></div><button type="button" onClick={() => setInspectorCollapsed(true)} aria-label="Minimize inspector" title="Minimize inspector" className="flows-inspector-dock-toggle ml-auto size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"><SidebarCollapse className="size-3.5 rotate-180" /></button></div></div>
              <div data-testid="flows-inspector-empty-body" className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-10 text-center">
                <div className="grid size-12 place-items-center rounded-full border border-dashed border-border bg-muted text-muted-foreground"><CursorPointer className="size-5" /></div><div className="mt-4 text-sm font-medium text-foreground">Select a node</div>
                <p className="mt-1.5 max-w-[220px] text-[11px] leading-5 text-muted-foreground">Choose a canvas node or its library trigger to edit configuration, inputs, and runtime behavior.</p>
                {selectedFlow && draft ? <div className="mt-6 grid w-full grid-cols-2 gap-2"><div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-left"><div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">Nodes</div><div className="mt-1 text-sm font-semibold text-foreground">{draft.nodes.length}</div></div><div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-left"><div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">Connections</div><div className="mt-1 text-sm font-semibold text-foreground">{draft.edges.length}</div></div></div> : null}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
              <div data-testid="flows-inspector-header" className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card px-4 py-4">
                <div className="min-w-0"><div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"><span className="grid size-7 place-items-center rounded-md border border-accent-violet/20 bg-accent-violet/[0.08] text-accent-violet"><Settings className="size-3.5" /></span><span className="truncate">{selectedNode.type} · {selectedNode.id}</span></div><div className="mt-1.5 truncate text-base font-semibold text-foreground">{selectedNode.type === "agent" ? flowAgentRoleLabel(selectedAgentNode?.data.role || "review") : selectedNode.type === "action" ? FLOW_ACTION_OPTIONS.find((o) => o.value === selectedActionNode?.data.operation)?.label ?? "Action" : selectedNode.type === "condition" ? "If branch" : selectedNode.type === "parallel" ? "Parallel operator" : selectedNode.type === "join" ? "Merge operator" : selectedNode.type === "delay" ? "Wait operator" : selectedNode.type === "await_event" ? "Await event operator" : selectedNode.type === "set_variable" ? "Set variable operator" : selectedNode.type === "transform" ? "Transform operator" : selectedNode.type === "start" ? "Entry point" : "Exit point"}</div></div>
                <button type="button" data-testid="flows-inspector-close" onClick={() => clearCanvasSelection()} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" aria-label="Close node sheet" title="Close"><Xmark className="size-4" /></button>
              </div>
              <div data-testid="flows-inspector-scroll" className="@container min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
                <section className="space-y-3">
                  <Textarea value={draft?.description ?? ""} onChange={(e) => updateDraft((c) => ({ ...c, description: e.target.value }), { mergeKey: "flow-description" })} rows={3} placeholder="Describe what this flow should accomplish." className="bg-input/40" />
                  {selectedNode ? <div className="space-y-4 rounded-lg border border-border/80 bg-background/60 p-4 shadow-sm">
                    {selectedAgentNode && <AgentInspector node={selectedAgentNode} draft={draft} agents={agents ?? []} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} selectedAgentDefinition={selectedAgentDefinition} availableModelOptions={availableModelOptions} enabledModelIds={enabledModelIds} quickReplaceFlowModelId={quickReplaceFlowModelId} quickReplaceFlowModelName={quickReplaceFlowModelName} canQuickReplaceFlowModel={canQuickReplaceFlowModel} harnessesResponse={harnessesResponse} harnessesLoading={harnessesLoading} harnessesError={harnessesError} apiKeysSettingsHref={apiKeysSettingsHref} sandboxTestRepoId={sandboxTestRepoId} onSandboxTestRepoIdChange={setSandboxTestRepoId} sandboxTestRepos={sandboxTestRepos} sandboxTestResult={sandboxTestResult} sandboxTestError={sandboxTestError} sandboxTestRunning={sandboxTestRunning} onRunSandboxTest={runAutomationSandboxTest} onClearSandboxTest={() => { setSandboxTestResult(null); setSandboxTestError(null) }} selectedStartConfig={selectedStartConfig} />}
                    {selectedStartNode && selectedFlow && <StartInspector node={selectedStartNode} selectedFlow={selectedFlow} updateNodeData={updateNodeData} installations={installations || []} effectiveInstallationId={effectiveInstallationId} updateTriggerInstallation={updateTriggerInstallation} slackInstallations={slackInstallations} slackChannels={slackChannels} slackChannelsLoading={slackChannelsLoading} slackChannelsLoadingMore={slackChannelsLoadingMore} slackChannelsHaveMore={slackChannelsHaveMore} slackChannelPageCount={slackChannelPageCount} setSlackChannelPageCount={setSlackChannelPageCount} slackConnectionsHref={slackConnectionsHref} selectedSlackTeamId={selectedSlackTeamId} generatedWebhookSecret={generatedWebhookSecret} webhookSecretGenerating={webhookSecretGenerating} generateWebhookSecret={generateWebhookSecret} copyWebhookValue={copyWebhookValue} dirty={dirty} triggerTestRunning={triggerTestRunning} runTriggerTest={runTriggerTest} />}
                    {selectedActionNode && <ActionInspector node={selectedActionNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} slackInstallations={slackInstallations} slackChannels={slackChannels} slackChannelsLoading={slackChannelsLoading} slackChannelsLoadingMore={slackChannelsLoadingMore} slackChannelsHaveMore={slackChannelsHaveMore} onLoadMoreSlackChannels={() => void setSlackChannelPageCount(slackChannelPageCount + 1)} slackConnectionsHref={slackConnectionsHref} selectedSlackTeamId={selectedSlackTeamId} />}
                    {selectedConditionNode && <ConditionInspector node={selectedConditionNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedParallelNode && <ParallelInspector node={selectedParallelNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedJoinNode && <JoinInspector node={selectedJoinNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedDelayNode && <DelayInspector node={selectedDelayNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedAwaitEventNode && <AwaitEventInspector node={selectedAwaitEventNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedSetVariableNode && <SetVariableInspector node={selectedSetVariableNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedTransformNode && <TransformInspector node={selectedTransformNode} updateNodeData={updateNodeData} onDelete={deleteSelectedNode} />}
                    {selectedEndNode && <EndInspector node={selectedEndNode} updateNodeData={updateNodeData} />}
                  </div> : <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">Select a node to edit its properties. Agent overrides only change this flow node, never the master agent.</div>}
                </section>
                <div className="space-y-5 border-t border-border pt-5"><div className="ui-kicker">Flow</div><section className="space-y-2"><div className="ui-section-title">Notes</div><Textarea value={draft?.notes ?? ""} onChange={(e) => updateDraft((c) => ({ ...c, notes: e.target.value }), { mergeKey: "flow-notes" })} rows={8} placeholder="Capture intent, guardrails, and context for this flow." /></section><section><Button type="button" variant="outline" size="sm" onClick={() => toggleAssistantPanel()} className="w-full">Open assistant</Button></section></div>
              </div>
            </div>
          )}
        </aside>
      </div>
      <SaveTemplateDialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen} saveTemplateName={saveTemplateName} onNameChange={setSaveTemplateName} saveTemplateScope={saveTemplateScope} onScopeChange={setSaveTemplateScope} savingTemplate={savingTemplate} onSave={() => void saveSelectedFlowAsTemplate()} activeTeamId={activeTeamId} teamTemplatesCanWrite={teamTemplatesCanWrite} />
      <DeleteTemplateDialog templateDeleteTarget={templateDeleteTarget} onOpenChange={setTemplateDeleteTarget} deletingTemplate={deletingTemplate} onDelete={() => void deleteSavedTemplate()} />
    </div>
  )
}
