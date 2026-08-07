"use client"
import "@xyflow/react/dist/style.css"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { useParams } from "next/navigation"
import { useTheme } from "next-themes"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type ColorMode,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react"
import { toast } from "@/hooks/use-toast"
import { useAgents } from "@/hooks/use-agents"
import { useModels } from "@/hooks/use-models"
import { useRepos } from "@/hooks/use-repos"
import { cn } from "@/lib/utils"
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider"
import { buildAgentModelOptions, getDefaultNewAgentModel } from "@/lib/agents/model-options"
import { shouldHydrateFlowDraftFromServer } from "@/lib/flows/draft-sync"
import { shouldIgnoreCanvasShortcut } from "@/lib/flows/canvas-shortcuts"
import {
  flowSaveStatusAnnouncement,
  type FlowSaveStatus,
} from "@/lib/flows/save-presentation"
import { isHiddenCatalogModelId } from "@/lib/models/catalog-visibility"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  CursorPointer,
  Github,
  Settings,
  SidebarCollapse,
  SidebarExpand,
  Xmark,
} from "iconoir-react"
import {
  CONDITION_HANDLE_IDS,
  eventLabel,
  FAILURE_HANDLE_ID,
  flowAgentRoleLabel,
  getStartConfig,
  getDefaultFlowAgentRole,
} from "@/lib/flows/graph"
import {
  clearFlowDraftSelection,
  cloneFlowDraftSnapshot,
  copySelectedFlowDraftItems,
  createFlowDraftSnapshot,
  deleteSelectedFlowDraftItems,
  draftToGraph,
  duplicateSelectedFlowDraftAgents,
  graphToCanvas,
  insertFlowDraftAgent,
  insertFlowDraftNodeOnEdge,
  insertFlowDraftNode,
  pasteFlowDraftItems,
  selectFlowDraftEdge,
  selectAllFlowDraftAgents,
  selectFlowDraftNode,
  straightenSelectedFlowDraftNodes,
  serializePersistedFlowDraft,
  serializePersistedFlowGraph,
  tidyFlowDraftLayout,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowDraftClipboard,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor"
import {
  flowRunStatusLabel,
  type FlowRunAction,
} from "@/lib/flows/run-presentation"
import type {
  Flow,
  FlowActionOperation,
  FlowAgentHarness,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  FlowRunDetail,
  FlowRunRecord,
  FlowStartFilter,
  PersonalFlowTemplate,
  PersonalFlowTemplatePage,
  Repo,
} from "@/lib/types"
import {
  FlowRunDetailsDialog,
  type ActiveRunActions,
} from "./flow-run-details"
import { FlowAssistantPanel } from "@/components/flows/flow-assistant-panel"
import { useFlowAssistantPanel } from "@/hooks/use-flow-assistant-panel"
import { scopedHref } from "@/lib/scoped-href"
import {
  FLOW_STARTER_TEMPLATES,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates"
// Extracted components
import {
  // Types
  type Installation,
  type AutomationSandboxTestResult,
  type AutomationHarnessesResponse,
  type SlackInstallation,
  type SlackChannel,
  type SlackChannelsPage,
  type FlowTab,
  type FlowRenderableEdgeData,
  type FlowContextMenuState,
  type PersistFlowOptions,
  // Constants
  TRIGGER_PRESETS,
  FLOW_FIT_VIEW_OPTIONS,
  FLOW_CANVAS_BACKGROUND,
  FLOW_CANVAS_VIGNETTE_BACKGROUND,
  FLOW_ACTION_OPTIONS,
  HISTORY_LIMIT,
  HISTORY_MERGE_WINDOW_MS,
  AUTOSAVE_DELAY_MS,
  PUBLISH_SUCCESS_STATE_MS,
  // Canvas utilities
  ResponsiveMiniMap,
  readFlowTabFromLocation,
  isMacPrimaryModifier,
  createDraftHistory,
  startDataForEvent,
  // Edge component
  FlowSemanticEdge,
  // Node components
  NODE_TYPES,
  // Inspector components
  WorkflowSelect,
  installationAccountTypeLabel,
  installationAccountLabel,
  buildFilter,
  RepositoryScopePicker,
  // Extracted child components
  CanvasContextMenu,
  SaveTemplateDialog,
  DeleteTemplateDialog,
  RunsTabContent,
  ExecutionBar,
  ConditionInspector,
  ParallelInspector,
  JoinInspector,
  DelayInspector,
  EndInspector,
  EditorToolbarHeader,
  EditorToolbarCompactName,
  EditorToolbarLegacyBanner,
  SetVariableInspector,
  TransformInspector,
  AwaitEventInspector,
  ActionInspector,
  NodeLibrarySidebar,
  AgentInspector,
  StartInspector,
} from "./flows-pane/index"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `API error: ${response.status}`)
  }
  return response.json()
}

type FlowDraftHistory = {
  past: FlowDraftSnapshot[]
  present: FlowDraftSnapshot
  future: FlowDraftSnapshot[]
}

export function FlowsPane() {
  const { scope } = useParams<{ scope: string }>()
  const { resolvedTheme } = useTheme()
  // React Flow needs an explicit mode — "system" would read the OS preference
  // and drift from the app theme the user picked. The pane renders client-only
  // (dynamic ssr:false), so there is no hydration mismatch to guard against.
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
  const { data: flows, mutate: mutateFlows, isLoading } = useSWR<Flow[]>("/api/flows", fetcher)
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
      if (!activeTeamId || (previousPage && !previousPage.next_cursor)) {
        return null
      }
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
  const personalTemplates = useMemo(() => {
    const templatesById = new Map<string, PersonalFlowTemplate>()
    for (const page of personalTemplatePages ?? []) {
      for (const template of page.templates) {
        templatesById.set(template.id, template)
      }
    }
    return [...templatesById.values()]
  }, [personalTemplatePages])
  const personalTemplatesHaveMore = Boolean(
    personalTemplatePages?.at(-1)?.next_cursor,
  )
  const personalTemplatesLoadingMore =
    personalTemplatesValidating && Boolean(personalTemplatePages?.length)
  const teamTemplates = useMemo(() => {
    const templatesById = new Map<string, PersonalFlowTemplate>()
    for (const page of teamTemplatePages ?? []) {
      for (const template of page.templates) {
        templatesById.set(template.id, template)
      }
    }
    return [...templatesById.values()]
  }, [teamTemplatePages])
  const teamTemplatesHaveMore = Boolean(
    teamTemplatePages?.at(-1)?.next_cursor,
  )
  const teamTemplatesLoadingMore =
    teamTemplatesValidating && Boolean(teamTemplatePages?.length)
  const teamTemplatesCanWrite = teamTemplatePages?.[0]?.can_write !== false
  const { data: installations } = useSWR<Installation[]>("/api/github/installations", fetcher)
  const { data: slackInstallationsResponse } = useSWR<{
    installations: SlackInstallation[]
  }>("/api/integrations/slack/installations", fetcher)
  const { agents } = useAgents()
  const { repos } = useRepos()
  const { models, defaultModelId, hiddenModelIds, isLoading: modelsLoading } = useModels()
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const { data: selectedFlow, mutate: mutateSelectedFlow } = useSWR<Flow>(
    selectedFlowId ? `/api/flows/${selectedFlowId}` : null,
    fetcher,
  )
  const { data: flowRunsResponse, mutate: mutateFlowRuns } = useSWR<{ runs: FlowRunRecord[] }>(
    selectedFlowId ? `/api/flows/${selectedFlowId}/runs?limit=12` : null,
    fetcher,
  )
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeFlowTab, setActiveFlowTabState] = useState<FlowTab>(readFlowTabFromLocation)
  useEffect(() => {
    const syncFlowTabFromLocation = () => setActiveFlowTabState(readFlowTabFromLocation())
    window.addEventListener("popstate", syncFlowTabFromLocation)
    return () => window.removeEventListener("popstate", syncFlowTabFromLocation)
  }, [])
  const setActiveFlowTab = useCallback(
    (value: string) => {
      const nextTab: FlowTab = value === "runs" ? "runs" : "editor"
      const url = new URL(window.location.href)
      const currentUrlTab: FlowTab = url.searchParams.get("tab") === "runs" ? "runs" : "editor"

      if (nextTab !== currentUrlTab) {
        if (nextTab === "runs") {
          url.searchParams.set("tab", "runs")
        } else {
          url.searchParams.delete("tab")
        }

        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
      }

      setActiveFlowTabState((current) => (current === nextTab ? current : nextTab))
    },
    [],
  )
  const {
    data: selectedRunDetailResponse,
    error: selectedRunDetailError,
    isLoading: selectedRunDetailLoading,
    mutate: mutateSelectedRunDetail,
  } = useSWR<{ run: FlowRunDetail }>(
    selectedFlowId && selectedRunId ? `/api/flows/${selectedFlowId}/runs/${selectedRunId}` : null,
    fetcher,
  )

  const [createInstallationId, setCreateInstallationId] = useState("")
  const [createRepository, setCreateRepository] = useState("all")
  const [browseInstallationId, setBrowseInstallationId] = useState("all")
  const [browseRepositories, setBrowseRepositories] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState("")
  const [saveTemplateScope, setSaveTemplateScope] = useState<"personal" | "team">("personal")
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateDeleteTarget, setTemplateDeleteTarget] = useState<{
    template: PersonalFlowTemplate
    scope: "personal" | "team"
  } | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Hydrate once on mount; persist on every subsequent change. Splitting these
  // avoids the race where a fast toggle during hydration could clobber the
  // stored value with the pre-hydration default.
  const sidebarHydratedRef = useRef(false)
  useEffect(() => {
    const stored = window.localStorage.getItem("mplex.flows.sidebarCollapsed")
    if (stored === "true") setSidebarCollapsed(true)
    sidebarHydratedRef.current = true
  }, [])
  useEffect(() => {
    if (!sidebarHydratedRef.current) return
    window.localStorage.setItem("mplex.flows.sidebarCollapsed", String(sidebarCollapsed))
  }, [sidebarCollapsed])
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const inspectorHydratedRef = useRef(false)
  useEffect(() => {
    const stored = window.localStorage.getItem("mplex.flows.inspectorCollapsed")
    if (stored === "true") setInspectorCollapsed(true)
    inspectorHydratedRef.current = true
  }, [])
  useEffect(() => {
    if (!inspectorHydratedRef.current) return
    window.localStorage.setItem("mplex.flows.inspectorCollapsed", String(inspectorCollapsed))
  }, [inspectorCollapsed])

  const [history, setHistory] = useState<FlowDraftHistory | null>(null)
  const [baselineDraft, setBaselineDraft] = useState<FlowDraftSnapshot | null>(null)
  const [reviewFindingIssueActionId, setReviewFindingIssueActionId] = useState<string | null>(null)
  const assistantPanelOpen = useFlowAssistantPanel((s) => s.open)
  const toggleAssistantPanel = useFlowAssistantPanel((s) => s.toggleOpen)
  const setAssistantPanelOpen = useFlowAssistantPanel((s) => s.setOpen)
  // Ref prevents async double-fires before React flushes state; state drives disabled UI.
  const activeRunActionsRef = useRef<ActiveRunActions>({})
  const [activeRunActions, setActiveRunActions] = useState<ActiveRunActions>({})
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishSucceeded, setPublishSucceeded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<FlowSaveStatus>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedInSessionFlowId, setSavedInSessionFlowId] = useState<string | null>(null)
  const [sandboxTestRepoId, setSandboxTestRepoId] = useState("")
  const [sandboxTestNodeId, setSandboxTestNodeId] = useState<string | null>(null)
  const [sandboxTestResult, setSandboxTestResult] = useState<AutomationSandboxTestResult | null>(null)
  const [sandboxTestError, setSandboxTestError] = useState<string | null>(null)
  const [sandboxTestRunning, setSandboxTestRunning] = useState(false)
  const [triggerTestRunning, setTriggerTestRunning] = useState(false)
  const webhookSecretGeneratingRef = useRef(false)
  const [webhookSecretGenerating, setWebhookSecretGenerating] = useState(false)
  const [generatedWebhookSecretState, setGeneratedWebhookSecretState] = useState<{
    flowId: string
    secret: string
  } | null>(null)
  const generatedWebhookSecret = generatedWebhookSecretState?.flowId === selectedFlowId
    ? generatedWebhookSecretState.secret
    : null
  const historyMergeRef = useRef<{ mergeKey: string | null; lastAt: number }>({ mergeKey: null, lastAt: 0 })
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const publishStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveAttemptSignatureRef = useRef<string | null>(null)
  const hydratedFlowIdRef = useRef<string | null>(null)
  const editorRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const reactFlowRef = useRef<ReactFlowInstance<FlowCanvasNode, FlowCanvasEdge> | null>(null)
  const fittedFlowIdRef = useRef<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const canvasClipboardRef = useRef<FlowDraftClipboard | null>(null)
  const canvasPasteCountRef = useRef(0)
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState | null>(null)
  const [flowSearch, setFlowSearch] = useState("")
  // Canvas is locked by default; holding Space turns the pointer into a grab handle
  // and enables left-button panning (Figma/tldraw-style). Released → back to locked.
  const [spacePanActive, setSpacePanActive] = useState(false)

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      if (isTypingTarget(event.target)) return
      // Stop Space from scrolling the page or activating a focused button — must
      // run on auto-repeat keydowns too, otherwise a held Space still scrolls.
      event.preventDefault()
      if (event.repeat) return
      setSpacePanActive(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      setSpacePanActive(false)
    }
    const reset = () => setSpacePanActive(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", reset)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", reset)
    }
  }, [])

  const browseRepositoryOptions = useMemo(() => {
    const candidates = (installations || []).filter(
      (installation) =>
        browseInstallationId === "all"
        || String(installation.installation_id) === browseInstallationId,
    )
    return candidates
      .flatMap((installation) =>
        installation.repositories.map((repository) => ({
          ...repository,
          installationId: installation.installation_id,
        })),
      )
      .sort((left, right) => left.full_name.localeCompare(right.full_name))
  }, [browseInstallationId, installations])
  const browseAccountLabel = useMemo(() => {
    if (browseInstallationId === "all") return "all connected accounts"
    const installation = (installations || []).find(
      (candidate) =>
        String(candidate.installation_id) === browseInstallationId,
    )
    return installation ? installationAccountLabel(installation) : "this account"
  }, [browseInstallationId, installations])

  const createRepositoryOptions = useMemo(() => {
    const installation = (installations || []).find(
      (candidate) =>
        String(candidate.installation_id) === createInstallationId,
    )
    return [...(installation?.repositories ?? [])].sort((left, right) =>
      left.full_name.localeCompare(right.full_name)
    )
  }, [createInstallationId, installations])

  useEffect(() => {
    if (
      createRepository !== "all" &&
      !createRepositoryOptions.some(
        (repository) => repository.full_name === createRepository,
      )
    ) {
      setCreateRepository("all")
    }
  }, [createRepository, createRepositoryOptions])

  const visibleFlows = useMemo(() => {
    const selectedRepositoryKeys = new Set(
      browseRepositories.map((repository) => repository.toLowerCase()),
    )
    const selectedRepositories = browseRepositoryOptions.filter((repository) =>
      selectedRepositoryKeys.has(repository.full_name.toLowerCase()),
    )

    return (flows || []).filter((flow) => {
      if (
        browseInstallationId !== "all"
        && String(flow.installation_id) !== browseInstallationId
      ) {
        return false
      }
      if (selectedRepositories.length === 0) return true
      const selectedForInstallation = selectedRepositories.filter(
        (repository) => repository.installationId === flow.installation_id,
      )
      if (selectedForInstallation.length === 0) return false
      const scopedRepos = getStartConfig(flow.draft_graph)?.filter?.repos ?? []
      if (scopedRepos.length === 0) return true
      const scopedRepositoryKeys = new Set(
        scopedRepos.map((repository) => repository.toLowerCase()),
      )
      return selectedForInstallation.some((repository) =>
        scopedRepositoryKeys.has(repository.full_name.toLowerCase()),
      )
    })
  }, [browseInstallationId, browseRepositories, browseRepositoryOptions, flows])

  useEffect(() => {
    const available = new Set(
      browseRepositoryOptions.map((repository) => repository.full_name),
    )
    setBrowseRepositories((current) => {
      const next = current.filter((repository) => available.has(repository))
      return next.length === current.length ? current : next
    })
  }, [browseRepositoryOptions])

  useEffect(() => {
    if (
      selectedFlowId
      && visibleFlows.some((flow) => flow.id === selectedFlowId)
    ) {
      return
    }
    setSelectedFlowId(visibleFlows[0]?.id ?? null)
  }, [selectedFlowId, visibleFlows])

  useEffect(() => {
    if (!createInstallationId && installations && installations.length > 0) {
      setCreateInstallationId(String(installations[0].installation_id))
    }
  }, [createInstallationId, installations])

  useEffect(() => {
    setSelectedRunId(null)
  }, [selectedFlowId])

  const draft = history?.present ?? null
  const dirty = useMemo(() => {
    return draft && baselineDraft
      ? serializePersistedFlowDraft(draft) !== serializePersistedFlowDraft(baselineDraft)
      : false
  }, [baselineDraft, draft])
  const baselineDraftSignature = useMemo(
    () => (baselineDraft ? serializePersistedFlowDraft(baselineDraft) : null),
    [baselineDraft],
  )
  const canUndo = (history?.past.length ?? 0) > 0
  const canRedo = (history?.future.length ?? 0) > 0
  const primaryModifierLabel = useMemo(
    () => (isMacPrimaryModifier() ? "⌘" : "Ctrl+"),
    [],
  )

  // Refs mirror local draft state so the hydration effect can read the latest values
  // without re-running on every keystroke or on intermediate renders during persistFlow
  // (e.g. after setBaselineDraft() but before mutateSelectedFlow() refreshes selectedFlow).
  const dirtyRef = useRef(dirty)
  const historyRef = useRef(history)
  const baselineDraftRef = useRef(baselineDraft)
  const baselineDraftSignatureRef = useRef(baselineDraftSignature)
  // ⚠️ Declaration order is load-bearing: this ref-sync effect MUST stay above the
  // hydration effect below. React fires effects in declaration order within a commit,
  // so if a render updates both `selectedFlow` and the mirrored draft state in the same
  // commit, the hydration effect would read stale ref values if this block were moved
  // or hoisted beneath it. (First render is safe because `useRef(value)` captures the
  // current value, but any subsequent co-change would race.)
  useEffect(() => {
    dirtyRef.current = dirty
    historyRef.current = history
    baselineDraftRef.current = baselineDraft
    baselineDraftSignatureRef.current = baselineDraftSignature
  })

  useEffect(() => {
    if (!selectedFlow) return
    const nextDraft = createFlowDraftSnapshot(selectedFlow)
    const flowChanged = hydratedFlowIdRef.current !== selectedFlow.id
    const shouldHydrate = shouldHydrateFlowDraftFromServer({
      currentFlowId: hydratedFlowIdRef.current,
      incomingFlowId: selectedFlow.id,
      hasDraftHistory: Boolean(historyRef.current),
      hasBaselineDraft: Boolean(baselineDraftRef.current),
      dirty: dirtyRef.current,
      currentBaselineSignature: baselineDraftSignatureRef.current,
      incomingSignature: serializePersistedFlowDraft(nextDraft),
    })
    hydratedFlowIdRef.current = selectedFlow.id
    if (flowChanged) {
      setSavedInSessionFlowId(null)
    }
    if (!shouldHydrate) {
      return
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    if (publishStateTimeoutRef.current) {
      clearTimeout(publishStateTimeoutRef.current)
      publishStateTimeoutRef.current = null
    }
    setHistory(createDraftHistory(nextDraft))
    setBaselineDraft(cloneFlowDraftSnapshot(nextDraft))
    setContextMenu(null)
    setSaving(false)
    setPublishing(false)
    setPublishSucceeded(false)
    setSaveStatus("saved")
    setSaveError(null)
    autosaveAttemptSignatureRef.current = null
    historyMergeRef.current = { mergeKey: null, lastAt: 0 }
  }, [selectedFlow])
  const saveStatusLabel = useMemo(() => {
    switch (saveStatus) {
      case "pending":
        return "Autosave queued"
      case "saving":
        return "Autosaving..."
      case "error":
        return "Save failed"
      default:
        return dirty ? "Unsaved changes" : "Saved"
    }
  }, [dirty, saveStatus])
  const saveStatusTitle = saveError ?? saveStatusLabel
  const quietSaveStatus = !dirty && (saveStatus === "saved" || saveStatus === "idle")
  const saveStatusTone = useMemo(() => {
    if (quietSaveStatus) {
      return { container: "text-muted-foreground" }
    }

    switch (saveStatus) {
      case "pending":
        return {
          container: "border-accent-amber/25 bg-accent-amber/[0.10] text-accent-amber",
          dot: "bg-accent-amber",
        }
      case "saving":
        return {
          container: "border-accent-blue/25 bg-accent-blue/[0.10] text-accent-blue",
          dot: "bg-accent-blue",
        }
      case "error":
        return {
          container: "border-accent-red/30 bg-accent-red/[0.08] text-accent-red",
          dot: "bg-accent-red",
        }
      case "saved":
      default:
        // Idle or saved can reach this branch only while the draft is dirty.
        return {
          container: "border-accent-amber/25 bg-accent-amber/[0.10] text-accent-amber",
          dot: "bg-accent-amber",
        }
    }
  }, [quietSaveStatus, saveStatus])
  const saveStatusAnnouncement = flowSaveStatusAnnouncement({
    status: saveStatus,
    error: saveError,
    dirty,
    savedInSession: savedInSessionFlowId === selectedFlowId,
  })
  const hasUnpublishedGraphChanges = useMemo(() => {
    if (
      dirty
      || !draft
      || !selectedFlow?.published_version_id
    ) {
      return false
    }
    if (!selectedFlow.published_version) return true
    return serializePersistedFlowGraph(draftToGraph(draft))
      !== serializePersistedFlowGraph(selectedFlow.published_version.graph)
  }, [dirty, draft, selectedFlow?.published_version, selectedFlow?.published_version_id])
  const shouldPublishLatestDraft = dirty
    || hasUnpublishedGraphChanges
    || !selectedFlow?.published_version_id
  const primaryActionLabel = useMemo(() => {
    if (publishSucceeded && !dirty) {
      return "Published"
    }
    if (publishing) {
      return shouldPublishLatestDraft ? "Publishing..." : "Activating..."
    }
    if (selectedFlow?.status === "active") {
      return "Publish changes"
    }
    return shouldPublishLatestDraft
      ? "Publish & activate"
      : "Activate"
  }, [dirty, publishSucceeded, publishing, selectedFlow?.status, shouldPublishLatestDraft])
  const primaryActionClassName = useMemo(() => cn(
    "h-8 min-w-[92px] whitespace-nowrap rounded-md px-3 text-xs font-semibold shadow-lg sm:min-w-[96px]",
    publishSucceeded && !dirty
      ? "bg-accent-green text-white shadow-accent-green/25 hover:bg-accent-green/90"
      : "bg-primary text-primary-foreground shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/30",
  ), [dirty, publishSucceeded])

  const selectedNode = useMemo(
    () => draft?.nodes.find((node) => node.id === draft.selectedNodeId) || null,
    [draft],
  )
  const inspectorOpen = Boolean(selectedFlow && selectedNode)
  const rightSheetOpen = assistantPanelOpen || inspectorOpen
  // Minimizing only applies to the idle docked panel; selecting a node or
  // opening the assistant always brings the inspector back.
  const inspectorDockCollapsed = inspectorCollapsed && !rightSheetOpen
  const [rightSheetAnimateOpen, setRightSheetAnimateOpen] = useState(false)
  useEffect(() => {
    if (!rightSheetOpen) {
      setRightSheetAnimateOpen(false)
      return
    }
    // Defer the "open" state by one frame so the slide transition runs
    // after the panel has flipped from display:none to display:block.
    const raf = requestAnimationFrame(() => setRightSheetAnimateOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [rightSheetOpen])
  useEffect(() => {
    if (!rightSheetAnimateOpen || !selectedFlowId) return
    const flowId = selectedFlowId
    let fitRaf: number | null = null
    const layoutRaf = requestAnimationFrame(() => {
      fitRaf = requestAnimationFrame(() => {
        if (hydratedFlowIdRef.current === flowId) {
          void reactFlowRef.current?.fitView(FLOW_FIT_VIEW_OPTIONS)
        }
      })
    })
    return () => {
      cancelAnimationFrame(layoutRaf)
      if (fitRaf !== null) cancelAnimationFrame(fitRaf)
    }
  }, [rightSheetAnimateOpen, selectedFlowId])
  const selectedAgentDefinition = useMemo(
    () => (
      selectedNode?.type === "agent"
        ? (agents || []).find((agent) => agent.id === selectedNode.data.agentId) || null
        : null
    ),
    [agents, selectedNode],
  )
  const selectedStartNode = selectedNode?.type === "start"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "start" }>["data"] }
    : null
  const selectedStartConfig = useMemo(
    () => (draft ? getStartConfig(draftToGraph(draft)) : null),
    [draft],
  )
  const scopedInstallationIds = selectedStartConfig?.filter?.installationIds
  const effectiveInstallationId = scopedInstallationIds?.length === 1
    ? scopedInstallationIds[0]
    : selectedFlow?.installation_id ?? null
  const selectedFlowInstallation = (installations || []).find(
    (installation) => installation.installation_id === effectiveInstallationId,
  ) ?? null
  const selectedAgentNode = selectedNode?.type === "agent"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "agent" }>["data"] }
    : null
  const selectedActionNode = selectedNode?.type === "action"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "action" }>["data"] }
    : null
  const selectedSlackTeamId = selectedActionNode?.data.operation === "slack.send_message"
    && selectedActionNode.data.destination !== "trigger_thread"
    ? selectedActionNode.data.teamId
    : selectedStartNode?.data.event === "slack_mention"
      ? selectedStartNode.data.slackTeamId ?? ""
      : ""
  const {
    data: slackChannelPages,
    isLoading: slackChannelsLoading,
    isValidating: slackChannelsValidating,
    size: slackChannelPageCount,
    setSize: setSlackChannelPageCount,
  } = useSWRInfinite<SlackChannelsPage>(
    (_pageIndex, previousPage) => {
      if (!selectedSlackTeamId || (previousPage && !previousPage.nextCursor)) {
        return null
      }
      const base = `/api/integrations/slack/installations/${encodeURIComponent(selectedSlackTeamId)}/channels`
      return previousPage?.nextCursor
        ? `${base}?cursor=${encodeURIComponent(previousPage.nextCursor)}`
        : base
    },
    fetcher,
  )
  const slackInstallations = slackInstallationsResponse?.installations ?? []
  const slackChannels = useMemo(() => {
    const channelsById = new Map<string, SlackChannel>()
    for (const page of slackChannelPages ?? []) {
      for (const channel of page.channels) {
        channelsById.set(channel.id, channel)
      }
    }
    return [...channelsById.values()]
  }, [slackChannelPages])
  const slackChannelsHaveMore = Boolean(
    slackChannelPages?.at(-1)?.nextCursor
  )
  const slackChannelsLoadingMore =
    slackChannelsValidating && Boolean(slackChannelPages?.length)
  const slackConnectionsHref = scope
    ? scopedHref(scope, "/settings?tab=connections")
    : "/settings?tab=connections"
  const selectedAgentHarness: FlowAgentHarness = selectedAgentNode?.data.harness ?? "mogplex"
  const apiKeysSettingsHref = scope
    ? scopedHref(scope, "/settings?tab=keys")
    : "/settings?tab=keys"
  const selectedConditionNode = selectedNode?.type === "condition"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "condition" }>["data"] }
    : null
  const selectedParallelNode = selectedNode?.type === "parallel"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "parallel" }>["data"] }
    : null
  const selectedJoinNode = selectedNode?.type === "join"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "join" }>["data"] }
    : null
  const selectedDelayNode = selectedNode?.type === "delay"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "delay" }>["data"] }
    : null
  const selectedAwaitEventNode = selectedNode?.type === "await_event"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "await_event" }>["data"] }
    : null
  const selectedSetVariableNode = selectedNode?.type === "set_variable"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "set_variable" }>["data"] }
    : null
  const selectedTransformNode = selectedNode?.type === "transform"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "transform" }>["data"] }
    : null
  const selectedEndNode = selectedNode?.type === "end"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "end" }>["data"] }
    : null
  // Pass the node's current model so a since-retired pin still renders as a
  // "Legacy · <id>" option. Without it the select has no matching option and
  // silently shows blank while the node keeps running the retired model.
  const availableModelOptions = useMemo(
    () => buildAgentModelOptions(models, selectedAgentNode?.data.modelOverride).map((option) => ({
      id: option.id,
      label: option.label,
    })),
    [models, selectedAgentNode?.data.modelOverride],
  )
  const enabledModelIds = useMemo(
    () => new Set(models.map((model) => model.id)),
    [models],
  )
  const quickReplaceFlowModelId = useMemo(
    () => getDefaultNewAgentModel(models, defaultModelId),
    [defaultModelId, models],
  )
  const quickReplaceFlowModelName = useMemo(
    () => models.find((model) => model.id === quickReplaceFlowModelId)?.name ?? quickReplaceFlowModelId,
    [models, quickReplaceFlowModelId],
  )
  const flowRuns = useMemo(
    () => flowRunsResponse?.runs ?? [],
    [flowRunsResponse?.runs],
  )
  const latestFlowRun = useMemo(() => flowRuns[0] ?? null, [flowRuns])
  const latestFlowRunStatus = latestFlowRun
    ? flowRunStatusLabel(latestFlowRun)
    : null
  const selectedRunSummary = useMemo(
    () => flowRuns.find((run) => run.id === selectedRunId) || null,
    [flowRuns, selectedRunId],
  )
  const selectedRunDetail = selectedRunDetailResponse?.run ?? null
  const flowSuccessRateLabel = useMemo(() => {
    if (flowRuns.length === 0) return null
    const completedRuns = flowRuns.filter((run) => run.status === "success" || run.status === "failed")
    if (completedRuns.length === 0) return null
    const successfulRuns = completedRuns.filter((run) => run.status === "success").length
    return `${Math.round((successfulRuns / completedRuns.length) * 100)}%`
  }, [flowRuns])

  const renderedCanvasNodes = useMemo(() => {
    if (!draft) return []
    const accountLabel = selectedFlowInstallation
      ? installationAccountLabel(selectedFlowInstallation)
      : undefined
    return draft.nodes.map((node) => node.type === "start"
      ? {
          ...node,
          data: {
            ...node.data,
            accountLabel,
          },
        }
      : node)
  }, [draft, selectedFlowInstallation])
  const currentTriggerNode = useMemo(() => {
    return draft?.nodes.find((node) => node.type === "start") ?? null
  }, [draft])
  const currentTriggerLabel = useMemo(() => {
    return selectedStartConfig ? eventLabel(selectedStartConfig.event) : "Trigger"
  }, [selectedStartConfig])
  const currentTriggerProvider = useMemo(() => {
    switch (selectedStartConfig?.event) {
      case "schedule":
        return "Cron"
      case "webhook":
        return "Signed webhook"
      case "slack_mention":
        return "Slack"
      default:
        return "GitHub"
    }
  }, [selectedStartConfig?.event])
  const sandboxTestRepos = useMemo<Repo[]>(() => {
    const scopedRepoNames = new Set(
      (selectedStartConfig?.filter?.repos || []).map((repo) => repo.toLowerCase()),
    )
    if (scopedRepoNames.size === 0) return repos
    const filtered = repos.filter((repo) => scopedRepoNames.has(repo.full_name.toLowerCase()))
    return filtered.length > 0 ? filtered : repos
  }, [repos, selectedStartConfig?.filter?.repos])
  useEffect(() => {
    if (!selectedAgentNode || selectedAgentNode.data.autofixSandbox !== true) {
      setSandboxTestNodeId(null)
      setSandboxTestResult(null)
      setSandboxTestError(null)
      return
    }

    if (sandboxTestNodeId !== selectedAgentNode.id) {
      setSandboxTestNodeId(selectedAgentNode.id)
      setSandboxTestResult(null)
      setSandboxTestError(null)
    }

    if (
      sandboxTestRepos.length > 0 &&
      (!sandboxTestRepoId || !sandboxTestRepos.some((repo) => repo.id === sandboxTestRepoId))
    ) {
      setSandboxTestRepoId(sandboxTestRepos[0]?.id ?? "")
    }
  }, [
    sandboxTestNodeId,
    sandboxTestRepoId,
    sandboxTestRepos,
    selectedAgentNode,
  ])
  const runAutomationSandboxTest = useCallback(async () => {
    if (!sandboxTestRepoId) return
    setSandboxTestRunning(true)
    setSandboxTestResult(null)
    setSandboxTestError(null)

    try {
      const response = await fetch("/api/automations/sandbox-test", {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId,
        ),
        body: JSON.stringify({ repoId: sandboxTestRepoId }),
      })
      const payload = await response.json().catch(() => null) as AutomationSandboxTestResult | { error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || `Sandbox test failed (${response.status})`)
      }
      setSandboxTestResult(payload as AutomationSandboxTestResult)
    } catch (error) {
      setSandboxTestError(error instanceof Error ? error.message : "Sandbox test failed")
    } finally {
      setSandboxTestRunning(false)
    }
  }, [activeTeamId, sandboxTestRepoId])
  const generateWebhookSecret = useCallback(async () => {
    if (!selectedFlow || webhookSecretGeneratingRef.current) return
    webhookSecretGeneratingRef.current = true
    setWebhookSecretGenerating(true)
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}/webhook-secret`, {
        method: "POST",
      })
      const payload = await response.json().catch(() => null) as {
        secret?: string
        error?: string
      } | null
      if (!response.ok || !payload?.secret) {
        throw new Error(payload?.error || "Failed to generate webhook secret")
      }
      setGeneratedWebhookSecretState({
        flowId: selectedFlow.id,
        secret: payload.secret,
      })
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      toast({
        title: selectedFlow.webhook_configured
          ? "Webhook secret rotated"
          : "Webhook secret generated",
        description: "Copy it now. The signing secret is only shown once.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate webhook secret",
        variant: "destructive",
      })
    } finally {
      webhookSecretGeneratingRef.current = false
      setWebhookSecretGenerating(false)
    }
  }, [mutateFlows, mutateSelectedFlow, selectedFlow])

  const copyWebhookValue = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: `${label} copied` })
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the value manually.",
        variant: "destructive",
      })
    }
  }, [])

  const runTriggerTest = useCallback(async (
    payload: Record<string, unknown>,
  ) => {
    if (!selectedFlow) return
    setTriggerTestRunning(true)
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}/test-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      })
      const resultPayload = await response.json().catch(() => null) as {
        error?: string
        jobRunId?: string | null
        outcome?: string
      } | null
      if (!response.ok) {
        throw new Error(resultPayload?.error || "Failed to send test event")
      }
      await mutateFlowRuns()
      toast({
        title: resultPayload?.outcome === "queued" ? "Test event queued" : "Test event received",
        description: resultPayload?.jobRunId
          ? `Run ${resultPayload.jobRunId.slice(0, 8)} started from the published trigger.`
          : "The event was deduplicated or suppressed.",
      })
    } catch (error) {
      toast({
        title: "Test event failed",
        description: error instanceof Error ? error.message : "Failed to send test event",
        variant: "destructive",
      })
    } finally {
      setTriggerTestRunning(false)
    }
  }, [mutateFlowRuns, selectedFlow])
  const hasCanvasSelection = Boolean(
    draft?.selectedNodeId
    || draft?.nodes.some((node) => node.selected)
    || draft?.edges.some((edge) => edge.selected),
  )
  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) return null
    const width = 240
    const height = contextMenu.kind === "node" ? 220 : contextMenu.kind === "edge" ? 180 : 480
    const padding = 12
    const rawX = Number.isFinite(contextMenu.x) ? contextMenu.x : padding
    const rawY = Number.isFinite(contextMenu.y) ? contextMenu.y : padding
    const maxLeft = typeof window === "undefined" ? rawX : window.innerWidth - width - padding
    const maxTop = typeof window === "undefined" ? rawY : window.innerHeight - height - padding
    return {
      left: Math.max(padding, Math.min(rawX, maxLeft)),
      top: Math.max(padding, Math.min(rawY, maxTop)),
    }
  }, [contextMenu])
  const edgeTypes = useMemo(() => ({
    semantic: FlowSemanticEdge,
  }), [])
  const canQuickReplaceFlowModel = quickReplaceFlowModelId.length > 0
  // Flag any agent node whose effective model isn't in the enabled set (covers both
  // hidden-from-catalog and disabled-but-visible models). Mirrors the per-node
  // `selectedAgentOverrideUsesUnavailableModel` / `selectedAgentBaseUsesUnavailableModel`
  // criterion so the top-of-page banner count stays consistent with per-node warnings.
  // While `/api/models` is still loading we fall back to the legacy hidden-only check
  // to avoid flagging every node as unavailable on initial render.
  const effectiveLegacyAgentNodes = useMemo(() => {
    if (!draft) return []

    const isUnavailableModelId = (modelId: string | null | undefined): modelId is string => {
      if (typeof modelId !== "string" || modelId.length === 0) return false
      if (modelsLoading) {
        return isHiddenCatalogModelId(modelId, hiddenModelIds)
      }
      return !enabledModelIds.has(modelId)
    }

    return draft.nodes.reduce<Array<{ nodeId: string; label: string; modelId: string; source: "override" | "missing" }>>((issues, node) => {
      if (node.type !== "agent") return issues
      const agentNode = node as Extract<FlowNode, { type: "agent" }>
      if ((agentNode.data.harness ?? "mogplex") !== "mogplex") return issues
      const label = typeof agentNode.data.label === "string" && agentNode.data.label.length > 0 ? agentNode.data.label : agentNode.id
      // Checked before the availability guard: that guard reports false for an
      // empty id, which would otherwise let a model-less node pass. There is no
      // agent fallback to consider any more — publish rejects this outright.
      const nodeModelId = agentNode.data.modelOverride?.trim() ?? ""
      if (!nodeModelId) {
        issues.push({ nodeId: agentNode.id, label, modelId: "", source: "missing" })
        return issues
      }
      if (isUnavailableModelId(nodeModelId)) {
        issues.push({ nodeId: agentNode.id, label, modelId: nodeModelId, source: "override" })
      }
      return issues
    }, [])
  }, [draft, enabledModelIds, hiddenModelIds, modelsLoading])

  const updateDraft = useCallback((
    updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
    options?: { recordHistory?: boolean; mergeKey?: string | null },
  ) => {
    const recordHistory = options?.recordHistory ?? true

    setHistory((current) => {
      if (!current) return current

      const nextPresent = updater(cloneFlowDraftSnapshot(current.present))
      if (!recordHistory) {
        return {
          ...current,
          present: nextPresent,
        }
      }

      const now = Date.now()
      const shouldMerge = Boolean(
        options?.mergeKey
          && historyMergeRef.current.mergeKey === options.mergeKey
          && now - historyMergeRef.current.lastAt < HISTORY_MERGE_WINDOW_MS,
      )

      historyMergeRef.current = {
        mergeKey: options?.mergeKey ?? null,
        lastAt: now,
      }

      return {
        past: shouldMerge
          ? current.past
          : [...current.past, cloneFlowDraftSnapshot(current.present)].slice(-HISTORY_LIMIT),
        present: nextPresent,
        future: [],
      }
    })
  }, [])

  const resetHistoryMerge = useCallback(() => {
    historyMergeRef.current = { mergeKey: null, lastAt: 0 }
  }, [])

  const handleFlowNameChange = useCallback((name: string) => {
    updateDraft((current) => ({
      ...current,
      name,
    }), { mergeKey: "flow-name" })
  }, [updateDraft])

  const undoDraft = useCallback(() => {
    resetHistoryMerge()
    setHistory((current) => {
      if (!current || current.past.length === 0) return current
      const previous = current.past[current.past.length - 1]
      return {
        past: current.past.slice(0, -1),
        present: cloneFlowDraftSnapshot(previous),
        future: [cloneFlowDraftSnapshot(current.present), ...current.future].slice(0, HISTORY_LIMIT),
      }
    })
  }, [resetHistoryMerge])

  const redoDraft = useCallback(() => {
    resetHistoryMerge()
    setHistory((current) => {
      if (!current || current.future.length === 0) return current
      const [next, ...rest] = current.future
      return {
        past: [...current.past, cloneFlowDraftSnapshot(current.present)].slice(-HISTORY_LIMIT),
        present: cloneFlowDraftSnapshot(next),
        future: rest,
      }
    })
  }, [resetHistoryMerge])

  const onNodesChange = useCallback((changes: NodeChange<FlowCanvasNode>[]) => {
    const flowId = selectedFlow?.id ?? null
    const shouldFitMeasuredGraph =
      Boolean(flowId) &&
      fittedFlowIdRef.current !== flowId &&
      changes.some((change) => change.type === "dimensions")
    const recordHistory = changes.some(
      (change) => change.type !== "select" && change.type !== "dimensions",
    )
    const mergeKey = changes.some((change) => change.type === "position")
      ? "node-position"
      : changes.some((change) => change.type === "remove")
        ? "node-remove"
        : changes.some((change) => change.type === "add")
          ? "node-add"
          : changes.some((change) => change.type === "replace")
            ? "node-replace"
            : changes.some((change) => change.type === "dimensions")
              ? "node-dimensions"
              : null

    updateDraft((current) => ({
      ...current,
      nodes: applyNodeChanges(changes, current.nodes),
    }), { recordHistory, mergeKey })
    if (shouldFitMeasuredGraph && flowId) {
      requestAnimationFrame(() => {
        const measuredNodes = reactFlowRef.current?.getNodes() ?? []
        if (
          hydratedFlowIdRef.current === flowId &&
          measuredNodes.length > 0 &&
          measuredNodes.every((node) => node.measured?.width && node.measured?.height)
        ) {
          fittedFlowIdRef.current = flowId
          void reactFlowRef.current?.fitView(FLOW_FIT_VIEW_OPTIONS)
        }
      })
    }
  }, [selectedFlow?.id, updateDraft])

  const onEdgesChange = useCallback((changes: EdgeChange<FlowCanvasEdge>[]) => {
    const recordHistory = changes.some((change) => change.type !== "select")
    const mergeKey = changes.some((change) => change.type === "remove")
      ? "edge-remove"
      : changes.some((change) => change.type === "add")
        ? "edge-add"
        : changes.some((change) => change.type === "replace")
          ? "edge-replace"
          : null

    updateDraft((current) => ({
      ...current,
      edges: applyEdgeChanges(changes, current.edges),
    }), { recordHistory, mergeKey })
  }, [updateDraft])

  const onConnect = useCallback((connection: Connection) => {
    updateDraft((current) => ({
      ...current,
      edges: addEdge(
        { ...connection, id: `${connection.source}-${connection.target}-${crypto.randomUUID().slice(0, 6)}` },
        current.edges,
      ),
    }), { mergeKey: "edge-add" })
  }, [updateDraft])

  const onSelectionChange = useCallback((selection: OnSelectionChangeParams) => {
    const node = selection.nodes?.[0]
    updateDraft((current) => ({
      ...current,
      selectedNodeId: node?.id ?? null,
    }), { recordHistory: false })
  }, [updateDraft])

  const updateNodeData = useCallback((
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => {
    updateDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: updater(node.data) }
          : node,
      ),
    }), { mergeKey: options?.mergeKey ?? `node-data-${nodeId}` })
  }, [updateDraft])

  const updateTriggerInstallation = useCallback((installationId: number) => {
    if (
      !selectedStartNode
      || !(installations || []).some(
        (installation) => installation.installation_id === installationId,
      )
    ) {
      return
    }
    const accountChanged = effectiveInstallationId !== installationId
    updateNodeData(
      selectedStartNode.id,
      (data) => {
        const filter = data.filter as FlowStartFilter | undefined
        return {
          ...data,
          filter: buildFilter(
            installationId,
            accountChanged ? [] : (filter?.repos ?? []),
            filter?.authorFilter ?? "any",
          ),
        }
      },
      { mergeKey: `start-account-${selectedStartNode.id}` },
    )
  }, [effectiveInstallationId, installations, selectedStartNode, updateNodeData])

  const getDefaultInsertionPosition = useCallback(() => {
    const instance = reactFlowRef.current
    if (!instance) {
      return { x: 320, y: 200 }
    }
    const bounds = instance.getViewport()
    return instance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: Math.max(200, window.innerHeight / 2),
    }) ?? { x: -bounds.x + 240, y: -bounds.y + 180 }
  }, [])

  const addNode = useCallback((
    type: Exclude<FlowNodeType, "start" | "end">,
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => {
    const fallbackAgent = agents?.[0] || null
    const insertionPosition = position ?? getDefaultInsertionPosition()
    const defaultAgentRole = getDefaultFlowAgentRole(selectedStartConfig?.event)

    updateDraft((current) => {
      const result = type === "agent"
        ? insertFlowDraftAgent(current, {
            position: insertionPosition,
            label: fallbackAgent?.name || null,
            agentId: fallbackAgent?.id ?? null,
            role: defaultAgentRole,
          })
        : insertFlowDraftNode(current, type, {
            position: insertionPosition,
            operation,
          })
      return result.snapshot
    }, { mergeKey: "node-add" })
  }, [agents, getDefaultInsertionPosition, selectedStartConfig?.event, updateDraft])

  const selectCanvasNode = useCallback((nodeId: string) => {
    updateDraft((current) => selectFlowDraftNode(current, nodeId), {
      recordHistory: false,
    })
  }, [updateDraft])

  const applyTriggerPreset = useCallback((preset: (typeof TRIGGER_PRESETS)[number]) => {
    if (!currentTriggerNode) return
    updateNodeData(
      currentTriggerNode.id,
      (data) => {
        const eventData = startDataForEvent(data, preset.event)
        const next = preset.canvasLabel
          ? { ...eventData, label: preset.canvasLabel }
          : eventData
        if (!preset.authorFilter) return next
        const filter = (next.filter as FlowStartFilter | undefined) ?? { scope: "all" }
        return {
          ...next,
          filter: { ...filter, authorFilter: preset.authorFilter },
        }
      },
      { mergeKey: `trigger-preset-${preset.id}` },
    )
    selectCanvasNode(currentTriggerNode.id)
  }, [currentTriggerNode, selectCanvasNode, updateNodeData])

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode || selectedNode.type === "start" || selectedNode.type === "end") return
    const result = draft ? deleteSelectedFlowDraftItems(draft) : null
    if (!result?.changed) return
    updateDraft(() => result.snapshot, { mergeKey: "node-remove" })
  }, [draft, selectedNode, updateDraft])

  const persistFlow = useCallback(async (options?: PersistFlowOptions) => {
    if (!selectedFlow || !draft) return false
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }

    const snapshot = cloneFlowDraftSnapshot(options?.snapshot ?? draft)
    const snapshotSignature = serializePersistedFlowDraft(snapshot)
    autosaveAttemptSignatureRef.current = snapshotSignature

    setSaving(true)
    setSaveStatus("saving")
    setSaveError(null)
    try {
      // Saving a draft can fork preset agents server-side; send the active
      // team scope so the fork's model matches what the canvas displayed.
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: "PUT",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId,
        ),
        body: JSON.stringify({
          name: snapshot.name,
          description: snapshot.description,
          notes: snapshot.notes,
          draft_graph: draftToGraph(snapshot),
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save flow")
      }

      setBaselineDraft(cloneFlowDraftSnapshot(snapshot))
      setSavedInSessionFlowId(selectedFlow.id)
      setSaveStatus("saved")
      autosaveAttemptSignatureRef.current = null
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      if (!options?.silentSuccess) {
        toast({
          title: "Draft saved",
          description: "The latest workflow changes are stored.",
        })
      }
      return true
    } catch (error) {
      const description = error instanceof Error ? error.message : "Failed to save flow"
      setSaveStatus("error")
      setSaveError(description)
      toast({
        title: "Error",
        description,
        variant: "destructive",
      })
      return false
    } finally {
      setSaving(false)
    }
  }, [
    activeTeamId,
    draft,
    mutateFlows,
    mutateSelectedFlow,
    selectedFlow,
  ])

  const createFlow = useCallback(async (
    templateId: FlowStarterTemplateId | null,
    savedTemplate?: PersonalFlowTemplate,
    savedTemplateScope: "personal" | "team" = "personal",
  ) => {
    if (!createInstallationId) return
    if (savedTemplate?.requires_repository && createRepository === "all") {
      toast({
        title: "Choose a repository",
        description: "This template uses a trigger that must target one repository.",
        variant: "destructive",
      })
      return
    }
    setIsCreating(true)
    try {
      const response = await fetch("/api/flows", {
        method: "POST",
        headers: savedTemplateScope === "team"
          ? getActiveTeamRequestHeaders(
              { "Content-Type": "application/json" },
              activeTeamId,
            )
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          installation_id: Number(createInstallationId),
          template_id: templateId,
          personal_template_id:
            savedTemplateScope === "personal" ? savedTemplate?.id ?? null : null,
          team_template_id:
            savedTemplateScope === "team" ? savedTemplate?.id ?? null : null,
          repo_full_name: createRepository === "all" ? null : createRepository,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create flow")
      }
      await mutateFlows()
      setBrowseInstallationId(createInstallationId)
      setBrowseRepositories(
        createRepository === "all" ? [] : [createRepository],
      )
      setSelectedFlowId(payload.id)
      setTemplatePickerOpen(false)
      const template = savedTemplate ?? FLOW_STARTER_TEMPLATES.find(
        (entry) => entry.id === templateId,
      )
      toast({
        title: "Workflow created",
        description: template ? `Started from ${template.name}.` : undefined,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create flow",
        variant: "destructive",
      })
    } finally {
      setIsCreating(false)
    }
  }, [activeTeamId, createInstallationId, createRepository, mutateFlows])

  const saveSelectedFlowAsTemplate = useCallback(async () => {
    if (!selectedFlow || !saveTemplateName.trim() || savingTemplate) return
    setSavingTemplate(true)
    try {
      const saved = dirty
        ? await persistFlow({
            reason: "template",
            silentSuccess: true,
            snapshot: draft ? cloneFlowDraftSnapshot(draft) : undefined,
          })
        : true
      if (!saved) return

      const savingToTeam = saveTemplateScope === "team"
      const response = await fetch("/api/flows/templates", {
        method: "POST",
        headers: savingToTeam
          ? getActiveTeamRequestHeaders(
              { "Content-Type": "application/json" },
              activeTeamId,
            )
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_id: selectedFlow.id,
          name: saveTemplateName.trim(),
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save workflow template")
      }
      if (savingToTeam) {
        await setTeamTemplatePageCount(1)
        await mutateTeamTemplates()
      } else {
        await setPersonalTemplatePageCount(1)
        await mutatePersonalTemplates()
      }
      setSaveTemplateOpen(false)
      setTemplatePickerOpen(true)
      toast({
        title: savingToTeam ? "Team template saved" : "Template saved",
        description: payload.reconnect?.length
          ? savingToTeam
            ? "Private agents and connection-specific settings were removed and will be requested when reused."
            : "Connection-specific settings were removed and will be requested when reused."
          : savingToTeam
            ? "This workflow is now available to your active team."
            : "This workflow can now be reused from Quick start.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error
          ? error.message
          : "Failed to save workflow template",
        variant: "destructive",
      })
    } finally {
      setSavingTemplate(false)
    }
  }, [
    activeTeamId,
    dirty,
    draft,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    persistFlow,
    saveTemplateName,
    saveTemplateScope,
    savingTemplate,
    selectedFlow,
    setPersonalTemplatePageCount,
    setTeamTemplatePageCount,
  ])

  const deleteSavedTemplate = useCallback(async () => {
    if (!templateDeleteTarget || deletingTemplate) return
    setDeletingTemplate(true)
    try {
      const response = await fetch(
        `/api/flows/templates/${encodeURIComponent(templateDeleteTarget.template.id)}`,
        {
          method: "DELETE",
          headers: templateDeleteTarget.scope === "team"
            ? getActiveTeamRequestHeaders(undefined, activeTeamId)
            : undefined,
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete workflow template")
      }
      if (templateDeleteTarget.scope === "team") {
        await mutateTeamTemplates()
      } else {
        await mutatePersonalTemplates()
      }
      toast({
        title: "Template deleted",
        description: `"${templateDeleteTarget.template.name}" was permanently deleted.`,
        variant: "destructive",
      })
      setTemplateDeleteTarget(null)
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error
          ? error.message
          : "Failed to delete workflow template",
        variant: "destructive",
      })
    } finally {
      setDeletingTemplate(false)
    }
  }, [
    activeTeamId,
    deletingTemplate,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    templateDeleteTarget,
  ])

  const publishFlow = useCallback(async () => {
    if (!selectedFlow || publishing || saving) return
    const wasActive = selectedFlow.status === "active"
    setPublishing(true)
    setPublishSucceeded(false)
    try {
      const saved = dirty
        ? await persistFlow({
            reason: "publish",
            silentSuccess: true,
            snapshot: draft ? cloneFlowDraftSnapshot(draft) : undefined,
          })
        : true
      if (!saved) return
      // Publish can fork legacy preset agents — carry the active team scope.
      const response = await fetch(`/api/flows/${selectedFlow.id}/publish`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to publish flow")
      }
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      setPublishSucceeded(true)
      if (publishStateTimeoutRef.current) {
        clearTimeout(publishStateTimeoutRef.current)
      }
      publishStateTimeoutRef.current = setTimeout(() => {
        setPublishSucceeded(false)
        publishStateTimeoutRef.current = null
      }, PUBLISH_SUCCESS_STATE_MS)
      toast({
        title: wasActive ? "Published to live workflow" : "Flow published and activated",
        description: wasActive
          ? "Webhook routing now points at the newest saved draft."
          : "This workflow is now live and will receive matching events.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to publish flow",
        variant: "destructive",
      })
    } finally {
      setPublishing(false)
    }
  }, [activeTeamId, dirty, draft, mutateFlows, mutateSelectedFlow, persistFlow, publishing, saving, selectedFlow])

  const toggleFlowStatus = useCallback(async () => {
    if (!selectedFlow) return
    try {
      const nextStatus = selectedFlow.status === "active" ? "inactive" : "active"
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update flow status")
      }
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      toast({
        title: nextStatus === "active" ? "Flow activated" : "Flow deactivated",
        description: nextStatus === "active"
          ? "Webhook routing is live for the current published version."
          : "Webhook routing is paused until you reactivate this flow.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update flow status",
        variant: "destructive",
      })
    }
  }, [mutateFlows, mutateSelectedFlow, selectedFlow])

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
      if (publishStateTimeoutRef.current) {
        clearTimeout(publishStateTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!publishSucceeded || !dirty) return
    setPublishSucceeded(false)
    if (publishStateTimeoutRef.current) {
      clearTimeout(publishStateTimeoutRef.current)
      publishStateTimeoutRef.current = null
    }
  }, [dirty, publishSucceeded])

  useEffect(() => {
    if (!selectedFlow || !draft || !dirty || saving || publishing) return

    const snapshot = cloneFlowDraftSnapshot(draft)
    const snapshotSignature = serializePersistedFlowDraft(snapshot)
    if (autosaveAttemptSignatureRef.current === snapshotSignature) return

    setSaveStatus("pending")
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }

    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveTimeoutRef.current = null
      void persistFlow({
        reason: "autosave",
        silentSuccess: true,
        snapshot,
      })
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
        autosaveTimeoutRef.current = null
      }
    }
  }, [dirty, draft, persistFlow, publishing, saving, selectedFlow])

  const duplicateSelectedFlow = useCallback(async () => {
    if (!selectedFlow) return
    try {
      // Duplication can fork legacy preset agents — carry the active team scope.
      const response = await fetch(`/api/flows/${selectedFlow.id}/duplicate`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to duplicate flow")
      }
      await mutateFlows()
      setSelectedFlowId(payload.id)
      toast({ title: "Flow duplicated" })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to duplicate flow",
        variant: "destructive",
      })
    }
  }, [activeTeamId, mutateFlows, selectedFlow])

  const setRunActionState = useCallback((jobId: string, action: FlowRunAction | null) => {
    const next = { ...activeRunActionsRef.current }

    if (action) {
      next[jobId] = action
    } else {
      delete next[jobId]
    }

    activeRunActionsRef.current = next
    setActiveRunActions(next)
  }, [])

  const runFlowJobAction = useCallback(async (jobId: string, action: FlowRunAction) => {
    if (activeRunActionsRef.current[jobId]) return

    setRunActionState(jobId, action)

    try {
      const response = await fetch(`/api/observability/jobs/${jobId}/${action}`, { method: "POST" })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || `Failed to ${action} flow run`)
      }
      await Promise.all([mutateFlowRuns(), mutateFlows(), mutateSelectedRunDetail()])
      toast({
        title: action === "repair"
          ? "Repair queued"
          : action === "requeue"
            ? "Retry queued"
            : "Run cancelled",
        description: action === "cancel"
          ? (payload.cancelError ? `Cancellation completed with warnings: ${payload.cancelError}` : "Run cancelled.")
          : (payload.jobRunId ? `Job ${payload.jobRunId} queued.` : undefined),
      })
    } catch (error) {
      toast({
        title: action === "repair"
          ? "Repair failed"
          : action === "requeue"
            ? "Retry failed"
            : "Cancel failed",
        description: error instanceof Error ? error.message : `Failed to ${action} flow run`,
        variant: "destructive",
      })
    } finally {
      setRunActionState(jobId, null)
    }
  }, [mutateFlowRuns, mutateFlows, mutateSelectedRunDetail, setRunActionState])

  const createReviewFindingIssue = useCallback(async (findingId: string) => {
    if (reviewFindingIssueActionId) return
    if (!selectedRunDetail) {
      toast({
        title: "No run selected",
        description: "Reload the run details and try again.",
        variant: "destructive",
      })
      return
    }

    setReviewFindingIssueActionId(findingId)

    try {
      const response = await fetch(
        `/api/observability/jobs/${selectedRunDetail.id}/review-findings/${findingId}/issue`,
        { method: "POST" },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create GitHub issue")
      }

      await mutateSelectedRunDetail()

      toast({
        title: payload?.created === false ? "Issue already linked" : "Issue created",
        description: typeof payload?.issueNumber === "number"
          ? `GitHub issue #${payload.issueNumber}`
          : undefined,
      })
    } catch (error) {
      toast({
        title: "Issue creation failed",
        description: error instanceof Error ? error.message : "Failed to create GitHub issue",
        variant: "destructive",
      })
    } finally {
      setReviewFindingIssueActionId(null)
    }
  }, [mutateSelectedRunDetail, reviewFindingIssueActionId, selectedRunDetail])

  const deleteSelectedFlow = useCallback(async () => {
    if (!selectedFlow) return
    if (!window.confirm(`Delete "${selectedFlow.name}"?`)) return

    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}`, { method: "DELETE" })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete flow")
      }
      await mutateFlows()
      setSelectedFlowId((current) => (current === selectedFlow.id ? null : current))
      toast({
        title: "Workflow deleted",
        description: `"${selectedFlow.name}" was permanently deleted.`,
        variant: "destructive",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete flow",
        variant: "destructive",
      })
    }
  }, [mutateFlows, selectedFlow])

  const deleteSelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const result = deleteSelectedFlowDraftItems(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-delete" })
    return true
  }, [draft, updateDraft])

  const duplicateSelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const result = duplicateSelectedFlowDraftAgents(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-duplicate" })
    return true
  }, [draft, updateDraft])

  const duplicateContextMenuNode = useCallback((nodeId: string) => {
    updateDraft((current) => {
      const selected = selectFlowDraftNode(current, nodeId)
      return duplicateSelectedFlowDraftAgents(selected).snapshot
    }, { mergeKey: "graph-duplicate" })
  }, [updateDraft])

  const deleteContextMenuNode = useCallback((nodeId: string) => {
    updateDraft((current) => {
      const selected = selectFlowDraftNode(current, nodeId)
      return deleteSelectedFlowDraftItems(selected).snapshot
    }, { mergeKey: "graph-delete" })
  }, [updateDraft])

  const copySelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const clipboard = copySelectedFlowDraftItems(draft)
    if (!clipboard) return false
    canvasClipboardRef.current = clipboard
    canvasPasteCountRef.current = 0
    return true
  }, [draft])

  const cutSelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const clipboard = copySelectedFlowDraftItems(draft)
    if (!clipboard) return false
    const result = deleteSelectedFlowDraftItems(draft)
    if (!result.changed) return false
    canvasClipboardRef.current = clipboard
    canvasPasteCountRef.current = 0
    updateDraft(() => result.snapshot)
    return true
  }, [draft, updateDraft])

  const pasteCanvasItems = useCallback(() => {
    const clipboard = canvasClipboardRef.current
    if (!draft || !clipboard) return false
    const pasteCount = canvasPasteCountRef.current + 1
    const result = pasteFlowDraftItems(draft, clipboard, {
      offset: { x: 48 * pasteCount, y: 48 * pasteCount },
    })
    if (!result.changed) return false
    canvasPasteCountRef.current = pasteCount
    updateDraft(() => result.snapshot)
    return true
  }, [draft, updateDraft])

  const clearCanvasSelection = useCallback(() => {
    if (!draft) return false
    const hasSelection = Boolean(
      draft.selectedNodeId
      || draft.nodes.some((node) => node.selected)
      || draft.edges.some((edge) => edge.selected),
    )
    if (!hasSelection) return false
    updateDraft(() => clearFlowDraftSelection(draft), { recordHistory: false })
    return true
  }, [draft, updateDraft])

  const selectAllCanvasAgents = useCallback(() => {
    if (!draft || !draft.nodes.some((node) => node.type !== "start" && node.type !== "end")) return false
    updateDraft(() => selectAllFlowDraftAgents(draft), { recordHistory: false })
    return true
  }, [draft, updateDraft])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const resolveContextMenuPoint = useCallback((clientX: number, clientY: number) => {
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      return { x: clientX, y: clientY }
    }

    const rect = editorRef.current?.getBoundingClientRect()
    if (!rect) {
      return { x: 24, y: 96 }
    }

    return {
      x: Math.min(rect.left + 320, rect.right - 24),
      y: Math.min(rect.top + 96, rect.bottom - 24),
    }
  }, [])

  const openCanvasContextMenu = useCallback((clientX: number, clientY: number) => {
    const point = resolveContextMenuPoint(clientX, clientY)
    setContextMenu({
      kind: "canvas",
      x: point.x,
      y: point.y,
      flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
      nodeId: null,
      nodeType: null,
      edgeId: null,
    })
  }, [resolveContextMenuPoint])

  const openNodeContextMenu = useCallback((node: FlowCanvasNode, clientX: number, clientY: number) => {
    const point = resolveContextMenuPoint(clientX, clientY)
    updateDraft((current) => selectFlowDraftNode(current, node.id), { recordHistory: false })
    setContextMenu({
      kind: "node",
      x: point.x,
      y: point.y,
      flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
      nodeId: node.id,
      nodeType: node.type,
      edgeId: null,
    })
  }, [resolveContextMenuPoint, updateDraft])

  const openEdgeContextMenu = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const point = resolveContextMenuPoint(clientX, clientY)
    updateDraft((current) => selectFlowDraftEdge(current, edgeId), { recordHistory: false })
    setContextMenu({
      kind: "edge",
      x: point.x,
      y: point.y,
      flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
      nodeId: null,
      nodeType: null,
      edgeId,
    })
  }, [resolveContextMenuPoint, updateDraft])

  const renderedEdges = useMemo<FlowCanvasEdge[]>(() => {
    if (!draft) return []

    return draft.edges.map((edge) => {
      const sourceNode = draft.nodes.find((node) => node.id === edge.source)
      const targetNode = draft.nodes.find((node) => node.id === edge.target)

      let label: string | null = null
      let tone: FlowRenderableEdgeData["tone"] = "default"

      if (edge.sourceHandle === FAILURE_HANDLE_ID) {
        label = "Error"
        tone = "danger"
      } else if (sourceNode?.type === "condition") {
        if (edge.sourceHandle === CONDITION_HANDLE_IDS.true) {
          label = "Then"
          tone = "condition"
        } else if (edge.sourceHandle === CONDITION_HANDLE_IDS.false) {
          label = "Else"
          tone = "alternate"
        }
      } else if (sourceNode?.type === "parallel") {
        label = "Branch"
        tone = "parallel"
      } else if (targetNode?.type === "join") {
        label = "Merge"
        tone = "join"
      } else if (sourceNode?.type === "delay") {
        label = "Resume"
      }

      return {
        ...edge,
        type: "semantic",
        data: {
          label,
          tone,
          edgeId: edge.id,
          onInsertMenu: openEdgeContextMenu,
        } as Record<string, unknown>,
      }
    })
  }, [draft, openEdgeContextMenu])

  const insertNodeOnEdge = useCallback((
    edgeId: string,
    type:
      | "agent"
      | "action"
      | "delay"
      | "await_event"
      | "set_variable"
      | "transform",
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => {
    if (!draft) return false
    const fallbackAgent = agents?.[0] || null
    const defaultAgentRole = getDefaultFlowAgentRole(selectedStartConfig?.event)
    const result = insertFlowDraftNodeOnEdge(draft, edgeId, type, type === "agent"
      ? {
          position,
          label: fallbackAgent?.name || null,
          agentId: fallbackAgent?.id ?? null,
          role: defaultAgentRole,
        }
      : { position, operation })

    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "edge-insert-node" })
    return true
  }, [agents, draft, selectedStartConfig?.event, updateDraft])

  const tidyCanvasLayout = useCallback(() => {
    if (!draft) return false
    const result = tidyFlowDraftLayout(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-tidy" })
    return true
  }, [draft, updateDraft])

  const straightenCanvasSelection = useCallback(() => {
    if (!draft) return false
    const result = straightenSelectedFlowDraftNodes(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-straighten" })
    return true
  }, [draft, updateDraft])

  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(".react-flow__node, .react-flow__edge")) return

    event.preventDefault()
    if ("stopPropagation" in event) {
      event.stopPropagation()
    }
    canvasRef.current?.focus()
    openCanvasContextMenu(event.clientX, event.clientY)
  }, [openCanvasContextMenu])

  const runContextMenuAction = useCallback((action: () => void | Promise<unknown>) => {
    closeContextMenu()
    const result = action()
    if (result instanceof Promise) {
      void result
    }
  }, [closeContextMenu])

  const applyAssistantGraph = useCallback((graph: FlowGraph) => {
    updateDraft((current) => ({
      ...current,
      ...graphToCanvas(graph),
      selectedNodeId: null,
    }), { mergeKey: "assistant-apply" })
  }, [updateDraft])

  const draftGraph = useMemo(() => (draft ? draftToGraph(draft) : null), [draft])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedFlow) return
      if (selectedRunId) return

      const isMac = isMacPrimaryModifier()
      const hasPrimaryModifier = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      if (hasPrimaryModifier && key === "s") {
        event.preventDefault()
        void persistFlow()
        return
      }

      // No menu action leaves this state set while another keyboard-owned surface is open.
      if (contextMenu && event.key === "Escape") {
        closeContextMenu()
        return
      }

      const activeElement = document.activeElement
      const eventElement = event.target instanceof Element ? event.target : null
      if (shouldIgnoreCanvasShortcut(activeElement, eventElement, document)) {
        return
      }

      if (contextMenu) {
        // Destructive canvas shortcuts dismiss the menu without reaching the
        // current selection. Editable fields retain their native behavior via
        // the guard above.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault()
          closeContextMenu()
        }
        return
      }

      if (hasPrimaryModifier && !event.shiftKey && key === "z") {
        event.preventDefault()
        undoDraft()
        return
      }

      if (
        (hasPrimaryModifier && event.shiftKey && key === "z")
        || (!isMac && event.ctrlKey && !event.shiftKey && key === "y")
      ) {
        event.preventDefault()
        redoDraft()
        return
      }

      if (hasPrimaryModifier && key === "d") {
        event.preventDefault()
        duplicateSelectedCanvasItems()
        return
      }

      const canvasOwnsFocus = activeFlowTab === "editor"
        && Boolean(activeElement && canvasRef.current?.contains(activeElement))
      const documentSelectionIsActive = window.getSelection()?.isCollapsed === false

      if (hasPrimaryModifier && key === "c") {
        if (canvasOwnsFocus && !documentSelectionIsActive && copySelectedCanvasItems()) {
          event.preventDefault()
        }
        return
      }

      if (hasPrimaryModifier && key === "x") {
        if (canvasOwnsFocus && !documentSelectionIsActive && cutSelectedCanvasItems()) {
          event.preventDefault()
        }
        return
      }

      if (hasPrimaryModifier && key === "v") {
        if (canvasOwnsFocus && pasteCanvasItems()) {
          event.preventDefault()
        }
        return
      }

      if (hasPrimaryModifier && key === "a") {
        event.preventDefault()
        selectAllCanvasAgents()
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        clearCanvasSelection()
        return
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        deleteSelectedCanvasItems()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    clearCanvasSelection,
    closeContextMenu,
    contextMenu,
    activeFlowTab,
    copySelectedCanvasItems,
    cutSelectedCanvasItems,
    deleteSelectedCanvasItems,
    duplicateSelectedCanvasItems,
    pasteCanvasItems,
    persistFlow,
    redoDraft,
    selectAllCanvasAgents,
    selectedFlow,
    selectedRunId,
    undoDraft,
  ])

  useEffect(() => {
    if (!contextMenu) return

    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      if (contextMenuRef.current?.contains(target)) return
      closeContextMenu()
    }

    const handleWindowContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      if (contextMenuRef.current?.contains(target)) return
      closeContextMenu()
    }

    const handleWindowChange = () => {
      closeContextMenu()
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("contextmenu", handleWindowContextMenu)
    window.addEventListener("resize", handleWindowChange)
    window.addEventListener("scroll", handleWindowChange, true)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("contextmenu", handleWindowContextMenu)
      window.removeEventListener("resize", handleWindowChange)
      window.removeEventListener("scroll", handleWindowChange, true)
    }
  }, [closeContextMenu, contextMenu])

  return (
    <div className="flows-pane relative flex h-full min-h-0 flex-col bg-background">
      <div
        data-testid="flow-browser-filters"
        className="flex h-12 min-h-12 min-w-[760px] items-center gap-2 border-b border-border bg-card px-3"
      >
        <div className="mr-1 hidden shrink-0 items-center gap-2 lg:flex">
          <Github className="size-3.5 text-muted-foreground" />
          <span className="text-[9px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Viewing
          </span>
        </div>
        <WorkflowSelect
          testId="flow-browser-account"
          ariaLabel="Filter workflows by GitHub account"
          value={browseInstallationId}
          onValueChange={(value) => {
            setBrowseInstallationId(value)
            setBrowseRepositories([])
          }}
          className="h-8 max-w-[220px] rounded-md border border-border bg-input px-2.5 text-[11px] font-medium text-foreground"
          options={[
            { value: "all", label: "All GitHub accounts" },
            ...(installations || []).map((installation) => ({
              value: String(installation.installation_id),
              label: `${installationAccountLabel(installation)} · ${installationAccountTypeLabel(installation.account_type)}`,
            })),
          ]}
        />
        <div className="min-w-0 max-w-[260px] flex-1">
          <RepositoryScopePicker
            accountLabel={browseAccountLabel}
            options={browseRepositoryOptions.map(
              (repository) => repository.full_name,
            )}
            selected={browseRepositories}
            onChange={setBrowseRepositories}
            ariaLabel="Filter workflows by repository"
            compact
            testId="flow-browser-repository"
            optionTestIdPrefix="flow-browser-repository-option"
            menuLabel="Repository filter"
            description="Choose which repositories are visible in the workflow list."
          />
        </div>
        <span
          className="ml-auto shrink-0 text-[10px] text-muted-foreground"
          title="These filters change what is visible, not when a workflow runs."
        >
          {visibleFlows.length} of {(flows || []).length} workflows
        </span>
      </div>
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          // z-30 sits above the editor section's z-20 sticky header, which
          // otherwise paints over the button because the section comes later
          // in the DOM. Inspector overlay at z-40 still wins.
          className="absolute left-3 top-[60px] z-30 grid size-8 place-items-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-foreground/25 hover:text-foreground"
        >
          <SidebarExpand className="size-4" />
        </button>
      )}
      {inspectorDockCollapsed && (
        <button
          type="button"
          onClick={() => setInspectorCollapsed(false)}
          aria-label="Expand inspector"
          title="Expand inspector"
          className="flows-inspector-dock-toggle absolute right-3 top-[60px] z-30 size-8 place-items-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-foreground/25 hover:text-foreground"
        >
          <SidebarExpand className="size-4 rotate-180" />
        </button>
      )}
      <div
        className={cn(
          "flows-pane-grid grid min-h-0 flex-1",
          inspectorOpen && "flows-pane-grid-inspector-open",
          assistantPanelOpen && "flows-pane-grid-assistant-open",
          sidebarCollapsed && "flows-pane-grid-sidebar-collapsed",
          inspectorDockCollapsed && "flows-pane-grid-inspector-collapsed",
        )}
      >
      <NodeLibrarySidebar
        sidebarCollapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        flowSearch={flowSearch}
        onSearchChange={setFlowSearch}
        draft={draft}
        visibleFlows={visibleFlows}
        selectedFlowId={selectedFlowId}
        onSelectFlow={setSelectedFlowId}
        isLoading={isLoading}
        templatePickerOpen={templatePickerOpen}
        onTemplatePickerOpenChange={(open) => {
          if (
            open
            && browseInstallationId !== "all"
            && browseInstallationId !== createInstallationId
          ) {
            setCreateInstallationId(browseInstallationId)
          }
          setTemplatePickerOpen(open)
        }}
        isCreating={isCreating}
        installations={installations ?? []}
        createInstallationId={createInstallationId}
        onCreateInstallationChange={setCreateInstallationId}
        createRepository={createRepository}
        onCreateRepositoryChange={setCreateRepository}
        createRepositoryOptions={createRepositoryOptions}
        personalTemplates={personalTemplates}
        personalTemplatesHaveMore={personalTemplatesHaveMore}
        personalTemplatesLoadingMore={personalTemplatesLoadingMore}
        personalTemplatePageCount={personalTemplatePageCount}
        onLoadMorePersonalTemplates={() => void setPersonalTemplatePageCount(personalTemplatePageCount + 1)}
        teamTemplates={teamTemplates}
        teamTemplatesHaveMore={teamTemplatesHaveMore}
        teamTemplatesLoadingMore={teamTemplatesLoadingMore}
        teamTemplatePageCount={teamTemplatePageCount}
        onLoadMoreTeamTemplates={() => void setTeamTemplatePageCount(teamTemplatePageCount + 1)}
        teamTemplatesCanWrite={teamTemplatesCanWrite}
        savingTemplate={savingTemplate}
        selectedFlow={selectedFlow ?? null}
        activeTeamId={activeTeamId}
        browseInstallationId={browseInstallationId}
        currentTriggerNode={currentTriggerNode ?? null}
        currentTriggerLabel={currentTriggerLabel}
        currentTriggerProvider={currentTriggerProvider}
        onCreateFlow={(templateId, savedTemplate, savedTemplateScope) =>
          void createFlow(templateId, savedTemplate, savedTemplateScope)
        }
        onDeleteTemplate={(template, scope) => {
          setTemplatePickerOpen(false)
          setTemplateDeleteTarget({ template, scope })
        }}
        onSaveAsTemplate={() => {
          if (!selectedFlow) return
          setSaveTemplateName(selectedFlow.name)
          setSaveTemplateScope(
            activeTeamId && teamTemplatesCanWrite ? "team" : "personal",
          )
          setTemplatePickerOpen(false)
          setSaveTemplateOpen(true)
        }}
        onSelectCanvasNode={selectCanvasNode}
        onApplyTriggerPreset={applyTriggerPreset}
        onAddNode={addNode}
      />

      <section
        ref={editorRef}
        tabIndex={0}
        onMouseDownCapture={() => editorRef.current?.focus()}
        className="min-w-0 min-h-0 flex flex-col bg-transparent outline-none"
      >
        {!selectedFlow || !draft ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select or create a flow to begin.
          </div>
        ) : (
          <Tabs
            value={activeFlowTab}
            onValueChange={setActiveFlowTab}
            className="relative flex min-h-0 flex-1 flex-col gap-0"
          >
            <div
              className={cn(
                "relative z-20 border-b border-border bg-card/92 py-2 pr-3",
                sidebarCollapsed ? "pl-14" : "pl-3",
              )}
            >
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 lg:flex lg:h-9 lg:justify-between">
                <EditorToolbarHeader
                  draft={draft}
                  selectedFlow={selectedFlow}
                  flowRuns={flowRuns}
                  flowSuccessRateLabel={flowSuccessRateLabel}
                  dirty={dirty}
                  saveStatus={saveStatus}
                  saveStatusLabel={saveStatusLabel}
                  saveStatusTitle={saveStatusTitle}
                  quietSaveStatus={quietSaveStatus}
                  saveStatusTone={saveStatusTone}
                  saveStatusAnnouncement={saveStatusAnnouncement}
                  saving={saving}
                  publishing={publishing}
                  primaryModifierLabel={primaryModifierLabel}
                  primaryActionLabel={primaryActionLabel}
                  primaryActionClassName={primaryActionClassName}
                  shouldPublishLatestDraft={shouldPublishLatestDraft}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onFlowNameChange={handleFlowNameChange}
                  onAddAgent={() => addNode("agent")}
                  onUndo={undoDraft}
                  onRedo={redoDraft}
                  onDuplicateFlow={() => void duplicateSelectedFlow()}
                  onDeleteFlow={() => void deleteSelectedFlow()}
                  onPersist={() => void persistFlow({ reason: "manual" })}
                  onPublish={() => void publishFlow()}
                  onToggleStatus={() => void toggleFlowStatus()}
                />
                <TabsList
                  data-testid="flow-view-tabs"
                  className="col-span-2 row-start-2 h-8 shrink-0 justify-self-start gap-1 border border-border bg-card/80 p-1 shadow-sm lg:col-auto lg:row-auto lg:justify-self-auto"
                >
                  <TabsTrigger value="editor" className="h-6 rounded-sm px-2.5 py-1 text-[11px]">
                    Canvas
                  </TabsTrigger>
                  <TabsTrigger
                    value="runs"
                    data-testid="flows-runs-tab"
                    className="h-6 rounded-sm px-2.5 py-1 text-[11px]"
                  >
                    Runs{flowRuns.length > 0 && <span className="ml-1.5 text-muted-foreground">({flowRuns.length})</span>}
                  </TabsTrigger>
                </TabsList>
              </div>
              <EditorToolbarCompactName
                draft={draft}
                selectedFlow={selectedFlow}
                onFlowNameChange={handleFlowNameChange}
              />
              <EditorToolbarLegacyBanner
                effectiveLegacyAgentNodes={effectiveLegacyAgentNodes}
              />
            </div>

              <TabsContent value="editor" forceMount className="flex-1 min-h-0 relative data-[state=inactive]:hidden">
                <div
                  data-testid="flow-insert-toolbar"
                  className="absolute left-3 right-3 top-3 z-10 flex justify-center"
                >
                  <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-card/80 px-1.5 py-1.5 shadow-lg backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <button
                      type="button"
                      onClick={() => tidyCanvasLayout()}
                      className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      Tidy graph
                    </button>
                    <button
                      type="button"
                      onClick={() => straightenCanvasSelection()}
                      className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      Straighten
                    </button>
                    <div className="mx-1 h-4 w-px shrink-0 bg-border/60" />
                    <button
                      type="button"
                      data-testid="flow-assistant-toggle"
                      onClick={() => toggleAssistantPanel()}
                      className={cn(
                        "shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
                        assistantPanelOpen ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground",
                      )}
                    >
                      Assistant
                    </button>
                  </div>
                </div>
                <div
                  ref={canvasRef}
                  tabIndex={-1}
                  onMouseDownCapture={() => canvasRef.current?.focus()}
                  className="relative h-full outline-none"
                >
                <ReactFlow
                  nodes={renderedCanvasNodes}
                  edges={renderedEdges}
                  nodeTypes={NODE_TYPES}
                  edgeTypes={edgeTypes}
                  colorMode={canvasColorMode}
                  // Canvas is fully locked unless Space is held. `false` (not an
                  // empty/partial button array) is what blocks pointer *and* touch
                  // panning — array forms like `[1]` still let middle-click / touch
                  // drags pan the viewport.
                  panOnDrag={spacePanActive ? [0, 1] : false}
                  selectionOnDrag={!spacePanActive}
                  panActivationKeyCode={null}
                  deleteKeyCode={null}
                  onPaneContextMenu={handlePaneContextMenu}
                  onPaneClick={() => {
                    closeContextMenu()
                    clearCanvasSelection()
                  }}
                  onInit={(instance) => {
                    reactFlowRef.current = instance
                  }}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={onSelectionChange}
                  onMoveStart={(event) => {
                    if (event) closeContextMenu()
                  }}
                  onMoveEnd={(_event, nextViewport) => {
                    updateDraft((current) => ({
                      ...current,
                      viewport: nextViewport,
                    }), { recordHistory: false })
                  }}
                  defaultViewport={draft.viewport}
                  onNodeContextMenu={(event, node) => {
                    event.preventDefault()
                    event.stopPropagation()
                    canvasRef.current?.focus()
                    openNodeContextMenu(node as FlowCanvasNode, event.clientX, event.clientY)
                  }}
                  onEdgeContextMenu={(event, edge) => {
                    event.preventDefault()
                    event.stopPropagation()
                    canvasRef.current?.focus()
                    openEdgeContextMenu(edge.id, event.clientX, event.clientY)
                  }}
                  minZoom={0.1}
                  fitView
                  fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
                  proOptions={{ hideAttribution: true }}
                  className={cn("flows-canvas bg-transparent", spacePanActive && "flows-canvas-pan")}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={FLOW_CANVAS_BACKGROUND.gap}
                    size={FLOW_CANVAS_BACKGROUND.dotSize}
                    color={FLOW_CANVAS_BACKGROUND.dotColor}
                    bgColor={FLOW_CANVAS_BACKGROUND.baseColor}
                  />
                  <div
                    aria-hidden="true"
                    data-testid="flow-canvas-vignette"
                    className="pointer-events-none absolute inset-0 z-[1]"
                    style={{ background: FLOW_CANVAS_VIGNETTE_BACKGROUND }}
                  />
                  <ResponsiveMiniMap />
                  <Controls />
                </ReactFlow>
                <ExecutionBar
                  latestFlowRun={latestFlowRun}
                  latestFlowRunStatus={latestFlowRunStatus}
                  onViewRuns={() => setActiveFlowTab("runs")}
                />
                {contextMenu && contextMenuPosition && (
                  <CanvasContextMenu
                    contextMenu={contextMenu}
                    contextMenuRef={contextMenuRef}
                    contextMenuPosition={contextMenuPosition}
                    hasCanvasSelection={hasCanvasSelection}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    saving={saving}
                    dirty={dirty}
                    draftNodes={draft?.nodes ?? []}
                    runContextMenuAction={runContextMenuAction}
                    addNode={addNode}
                    insertNodeOnEdge={insertNodeOnEdge}
                    tidyCanvasLayout={tidyCanvasLayout}
                    straightenCanvasSelection={straightenCanvasSelection}
                    undoDraft={undoDraft}
                    redoDraft={redoDraft}
                    persistFlow={persistFlow}
                    duplicateSelectedCanvasItems={duplicateSelectedCanvasItems}
                    deleteSelectedCanvasItems={deleteSelectedCanvasItems}
                    selectAllCanvasAgents={selectAllCanvasAgents}
                    clearCanvasSelection={clearCanvasSelection}
                    duplicateContextMenuNode={duplicateContextMenuNode}
                    deleteContextMenuNode={deleteContextMenuNode}
                  />
                )}
              </div>
              </TabsContent>

              <TabsContent value="runs" className="flex-1 min-h-0 overflow-y-auto">
                <RunsTabContent
                  flowRuns={flowRuns}
                  selectedRunId={selectedRunId}
                  onSelectRun={setSelectedRunId}
                  activeRunActions={activeRunActions}
                  onRunAction={(jobId, action) => {
                    void runFlowJobAction(jobId, action)
                  }}
                />
              </TabsContent>
            </Tabs>
        )}
      </section>

      <FlowRunDetailsDialog
        open={Boolean(selectedRunId)}
        runDetail={selectedRunDetail}
        runSummary={selectedRunSummary}
        loading={selectedRunDetailLoading}
        error={selectedRunDetailError}
        activeRunActions={activeRunActions}
        reviewFindingIssueActionId={reviewFindingIssueActionId}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId(null)
        }}
        onRunAction={(jobId, action) => {
          void runFlowJobAction(jobId, action)
        }}
        onCreateReviewFindingIssue={(findingId) => {
          void createReviewFindingIssue(findingId)
        }}
      />

      {rightSheetOpen && (
        <div
          className="flows-inspector-backdrop fixed inset-0 z-30 bg-black/40"
          onClick={() => {
            if (assistantPanelOpen) {
              setAssistantPanelOpen(false)
            } else {
              clearCanvasSelection()
            }
          }}
        />
      )}
      <aside
        data-testid="flows-right-sheet"
        data-state={rightSheetAnimateOpen ? "open" : "closed"}
        className={cn(
          "flows-inspector min-h-0 flex-col overflow-hidden border-l border-border bg-background p-2",
          rightSheetOpen && "flows-inspector-open",
        )}
      >
        {assistantPanelOpen && selectedFlow && draftGraph ? (
          <FlowAssistantPanel
            key={selectedFlow.id}
            flowId={selectedFlow.id}
            graph={draftGraph}
            onApplyGraph={applyAssistantGraph}
          />
        ) : !selectedFlow || !selectedNode ? (
          <div
            data-testid="flows-inspector-empty"
            className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card"
          >
            <div className="border-b border-border px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-input text-muted-foreground">
                  <Settings className="size-4" />
                </span>
                <div>
                  <div className="text-[11px] font-semibold tracking-[0.16em] text-foreground uppercase">
                    Inspector
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Workflow configuration
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorCollapsed(true)}
                  aria-label="Minimize inspector"
                  title="Minimize inspector"
                  className="flows-inspector-dock-toggle ml-auto size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                >
                  <SidebarCollapse className="size-3.5 rotate-180" />
                </button>
              </div>
            </div>
            {/* `min-h-0` is what makes this scroll: a flex child defaults to
                min-height:auto, so without it this refuses to shrink below its
                content and spills out of the card, which the overflow-hidden
                aside then clips with no way to reach the rest.
                `justify-center-safe` degrades to start alignment once the
                content overflows; plain `justify-center` would center the
                overflow and push the top out of reach too. */}
            <div
              data-testid="flows-inspector-empty-body"
              className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-10 text-center"
            >
              <div className="grid size-12 place-items-center rounded-full border border-dashed border-border bg-muted text-muted-foreground">
                <CursorPointer className="size-5" />
              </div>
              <div className="mt-4 text-sm font-medium text-foreground">
                Select a node
              </div>
              <p className="mt-1.5 max-w-[220px] text-[11px] leading-5 text-muted-foreground">
                Choose a canvas node or its library trigger to edit configuration,
                inputs, and runtime behavior.
              </p>
              {selectedFlow && draft ? (
                <div className="mt-6 grid w-full grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-left">
                    <div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                      Nodes
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {draft.nodes.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-left">
                    <div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                      Connections
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {draft.edges.length}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div
              data-testid="flows-inspector-header"
              className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card px-4 py-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="grid size-7 place-items-center rounded-md border border-accent-violet/20 bg-accent-violet/[0.08] text-accent-violet">
                    <Settings className="size-3.5" />
                  </span>
                  <span className="truncate">{selectedNode.type} · {selectedNode.id}</span>
                </div>
                <div className="mt-1.5 truncate text-base font-semibold text-foreground">
                  {selectedNode.type === "agent"
                    ? flowAgentRoleLabel(selectedAgentNode?.data.role || "review")
                    : selectedNode.type === "action"
                      ? FLOW_ACTION_OPTIONS.find(
                          (option) => option.value === selectedActionNode?.data.operation,
                        )?.label ?? "Action"
                    : selectedNode.type === "condition"
                      ? "If branch"
                      : selectedNode.type === "parallel"
                        ? "Parallel operator"
                        : selectedNode.type === "join"
                          ? "Merge operator"
                          : selectedNode.type === "delay"
                            ? "Wait operator"
                            : selectedNode.type === "await_event"
                              ? "Await event operator"
                              : selectedNode.type === "set_variable"
                                ? "Set variable operator"
                                : selectedNode.type === "transform"
                                  ? "Transform operator"
                                : selectedNode.type === "start"
                                  ? "Entry point"
                                : "Exit point"}
                </div>
              </div>
              <button
                type="button"
                data-testid="flows-inspector-close"
                onClick={() => {
                  clearCanvasSelection()
                }}
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                aria-label="Close node sheet"
                title="Close"
              >
                <Xmark className="size-4" />
              </button>
            </div>
            <div
              data-testid="flows-inspector-scroll"
              className="@container min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5"
            >
              <section className="space-y-3">
                <Textarea
                  value={draft?.description ?? ""}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }), { mergeKey: "flow-description" })
                  }}
                  rows={3}
                  placeholder="Describe what this flow should accomplish."
                  className="bg-input/40"
                />

              {selectedNode ? (
                <div className="space-y-4 rounded-lg border border-border/80 bg-background/60 p-4 shadow-sm">
                  {selectedAgentNode && (
                    <AgentInspector
                      node={selectedAgentNode}
                      draft={draft}
                      agents={agents ?? []}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                      selectedAgentDefinition={selectedAgentDefinition}
                      availableModelOptions={availableModelOptions}
                      enabledModelIds={enabledModelIds}
                      quickReplaceFlowModelId={quickReplaceFlowModelId}
                      quickReplaceFlowModelName={quickReplaceFlowModelName}
                      canQuickReplaceFlowModel={canQuickReplaceFlowModel}
                      harnessesResponse={harnessesResponse}
                      harnessesLoading={harnessesLoading}
                      harnessesError={harnessesError}
                      apiKeysSettingsHref={apiKeysSettingsHref}
                      sandboxTestRepoId={sandboxTestRepoId}
                      onSandboxTestRepoIdChange={setSandboxTestRepoId}
                      sandboxTestRepos={sandboxTestRepos}
                      sandboxTestResult={sandboxTestResult}
                      sandboxTestError={sandboxTestError}
                      sandboxTestRunning={sandboxTestRunning}
                      onRunSandboxTest={runAutomationSandboxTest}
                      onClearSandboxTest={() => {
                        setSandboxTestResult(null)
                        setSandboxTestError(null)
                      }}
                      selectedStartConfig={selectedStartConfig}
                    />
                  )}

                  {selectedStartNode && selectedFlow && (
                    <StartInspector
                      node={selectedStartNode}
                      selectedFlow={selectedFlow}
                      updateNodeData={updateNodeData}
                      installations={installations || []}
                      effectiveInstallationId={effectiveInstallationId}
                      updateTriggerInstallation={updateTriggerInstallation}
                      slackInstallations={slackInstallations}
                      slackChannels={slackChannels}
                      slackChannelsLoading={slackChannelsLoading}
                      slackChannelsLoadingMore={slackChannelsLoadingMore}
                      slackChannelsHaveMore={slackChannelsHaveMore}
                      slackChannelPageCount={slackChannelPageCount}
                      setSlackChannelPageCount={setSlackChannelPageCount}
                      slackConnectionsHref={slackConnectionsHref}
                      selectedSlackTeamId={selectedSlackTeamId}
                      generatedWebhookSecret={generatedWebhookSecret}
                      webhookSecretGenerating={webhookSecretGenerating}
                      generateWebhookSecret={generateWebhookSecret}
                      copyWebhookValue={copyWebhookValue}
                      dirty={dirty}
                      triggerTestRunning={triggerTestRunning}
                      runTriggerTest={runTriggerTest}
                    />
                  )}

                  {selectedActionNode && (
                    <ActionInspector
                      node={selectedActionNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                      slackInstallations={slackInstallations}
                      slackChannels={slackChannels}
                      slackChannelsLoading={slackChannelsLoading}
                      slackChannelsLoadingMore={slackChannelsLoadingMore}
                      slackChannelsHaveMore={slackChannelsHaveMore}
                      onLoadMoreSlackChannels={() => void setSlackChannelPageCount(slackChannelPageCount + 1)}
                      slackConnectionsHref={slackConnectionsHref}
                      selectedSlackTeamId={selectedSlackTeamId}
                    />
                  )}

                  {selectedConditionNode && (
                    <ConditionInspector
                      node={selectedConditionNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedParallelNode && (
                    <ParallelInspector
                      node={selectedParallelNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedJoinNode && (
                    <JoinInspector
                      node={selectedJoinNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedDelayNode && (
                    <DelayInspector
                      node={selectedDelayNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedAwaitEventNode && (
                    <AwaitEventInspector
                      node={selectedAwaitEventNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedSetVariableNode && (
                    <SetVariableInspector
                      node={selectedSetVariableNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedTransformNode && (
                    <TransformInspector
                      node={selectedTransformNode}
                      updateNodeData={updateNodeData}
                      onDelete={deleteSelectedNode}
                    />
                  )}

                  {selectedEndNode && (
                    <EndInspector
                      node={selectedEndNode}
                      updateNodeData={updateNodeData}
                    />
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Select a node to edit its properties. Agent overrides only change this flow node, never the master agent.
                </div>
              )}
            </section>

            <div className="space-y-5 border-t border-border pt-5">
              <div className="ui-kicker">Flow</div>

              <section className="space-y-2">
                <div className="ui-section-title">Notes</div>
                <Textarea
                  value={draft?.notes ?? ""}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }), { mergeKey: "flow-notes" })
                  }}
                  rows={8}
                  placeholder="Capture intent, guardrails, and context for this flow."
                />
              </section>

              <section>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toggleAssistantPanel()}
                  className="w-full"
                >
                  Open assistant
                </Button>
              </section>
            </div>
            </div>
          </div>
        )}
      </aside>
      </div>
      <SaveTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        saveTemplateName={saveTemplateName}
        onNameChange={setSaveTemplateName}
        saveTemplateScope={saveTemplateScope}
        onScopeChange={setSaveTemplateScope}
        savingTemplate={savingTemplate}
        onSave={() => void saveSelectedFlowAsTemplate()}
        activeTeamId={activeTeamId}
        teamTemplatesCanWrite={teamTemplatesCanWrite}
      />
      <DeleteTemplateDialog
        templateDeleteTarget={templateDeleteTarget}
        onOpenChange={setTemplateDeleteTarget}
        deletingTemplate={deletingTemplate}
        onDelete={() => void deleteSavedTemplate()}
      />
    </div>
  )
}
