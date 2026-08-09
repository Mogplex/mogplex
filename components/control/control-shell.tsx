"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai"
import type {
  Mission,
  MissionPermissions,
  Worktree,
  Changeset,
  Deployment,
  TimelineEvent,
  ControlSeedData,
} from "@/lib/control/types"
import type { ComposerSendOptions } from "./composer"
import { generateMissionId } from "@/lib/control/utils"
import { useToolApprovalHandler } from "./use-tool-approval-handler"
import { buildCombinedTimeline } from "./build-combined-timeline"
import { useMissionDerived } from "./use-mission-derived"
import { MissionHeader } from "./mission-header"
import { Timeline } from "./timeline"
import { Canvas } from "./canvas"
import { Inspector } from "./inspector"
import { Composer } from "./composer"
import { ConsoleDrawer } from "./console-drawer"
import { NeedsAttentionBanner } from "./needs-attention-banner"
import { AgentSummaryStrip } from "./agent-summary-strip"
import { NewMissionComposer } from "./new-mission-composer"
import { PendingApprovalsBanner } from "./pending-approvals-banner"
import { SandboxRail } from "./sandbox-rail"

type ControlMode = "conversation" | "canvas" | "review"

export type ControlShellProps = {
  initialData: ControlSeedData
  initialMissionId?: string
}

export function ControlShell({ initialData, initialMissionId }: ControlShellProps) {
  const searchParams = useSearchParams()

  // Core data state (server-provided, then mutated locally)
  const [missions, setMissions] = useState<Mission[]>(initialData.missions)
  const [worktrees, setWorktrees] = useState<Worktree[]>(initialData.worktrees)
  const [changesets] = useState<Changeset[]>(initialData.changesets)
  const [deployments] = useState<Deployment[]>(initialData.deployments)
  const workspaces = initialData.workspaces

  // UI state
  const [selectedMissionId, setSelectedMissionId] = useState<string>(
    initialMissionId || searchParams.get("mission") || missions[0]?.id || ""
  )
  const [mode, setMode] = useState<ControlMode>("conversation")
  const [selection, setSelection] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState("summary")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<"terminal" | "logs" | "tests" | "events">("terminal")
  const [drawerHeight, setDrawerHeight] = useState(0) // index into [140, 232, 380]
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [newMission, setNewMission] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // Selected mission
  const mission = useMemo(
    () => missions.find((m) => m.id === selectedMissionId) || missions[0],
    [missions, selectedMissionId]
  )

  // Get workspace by id
  const getWorkspace = useCallback(
    (id: string) => workspaces.find((w) => w.id === id),
    [workspaces]
  )

  // Get worktree by id
  const getWorktree = useCallback(
    (id: string) => worktrees.find((w) => w.id === id),
    [worktrees]
  )

  // Worktrees for current mission
  const missionWorktrees = useMemo(
    () => worktrees.filter((w) => w.mission === mission?.id),
    [worktrees, mission?.id]
  )

  // Changesets for current mission
  const missionChangesets = useMemo(
    () => changesets.filter((c) => c.mission === mission?.id),
    [changesets, mission?.id]
  )

  // Deployments for current mission workspace
  const missionDeployments = useMemo(
    () => deployments.filter((d) => d.ws === mission?.ws),
    [deployments, mission?.ws]
  )

  // Chat integration using DefaultChatTransport
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/control/chat",
      }),
    []
  )

  const { messages, sendMessage, status, addToolApprovalResponse } = useChat({
    transport,
    id: `control-${selectedMissionId}`,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => {
      setChatError(error.message || "Chat error")
    },
  })

  const chatPending = status === "streaming" || status === "submitted"

  // Local input state (useChat v6 doesn't provide input/setInput)
  const [composerInput, setComposerInput] = useState("")

  // A mission's first message can't go through sendMessage directly from the
  // create handler: useChat is keyed by mission id, so the send would hit the
  // instance of the mission we're navigating away from. Park it and send once
  // the re-keyed chat is live.
  const [pendingInitialMessage, setPendingInitialMessage] = useState<{
    missionId: string
    text: string
  } | null>(null)
  useEffect(() => {
    if (!pendingInitialMessage) return
    if (pendingInitialMessage.missionId !== selectedMissionId) return
    if (status !== "ready") return
    const { text } = pendingInitialMessage
    setPendingInitialMessage(null)
    sendMessage({ text }).catch((err: unknown) => {
      setChatError(err instanceof Error ? err.message : "Chat error")
    })
  }, [pendingInitialMessage, selectedMissionId, status, sendMessage])

  // Push a timeline event to the current mission
  const pushTimelineEvent = useCallback(
    (event: TimelineEvent) => {
      setMissions((prev) =>
        prev.map((m) =>
          m.id === selectedMissionId
            ? { ...m, timeline: [...m.timeline, event] }
            : m
        )
      )
    },
    [selectedMissionId]
  )

  // Patch a worktree
  const patchWorktree = useCallback((id: string, patch: Partial<Worktree>) => {
    setWorktrees((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  }, [])

  // Select a node (worktree/changeset/env)
  const selectNode = useCallback((id: string | null, tab?: string) => {
    setSelection(id)
    if (tab) setInspectorTab(tab)
    if (id && mode === "conversation") setMode("canvas")
  }, [mode])

  // Handle message send
  const handleSend = useCallback(
    async (text: string, target: string, scopeLevel: string, options: ComposerSendOptions) => {
      if (!text.trim()) return

      // The user's message renders as a chat turn, not a dispatch card: the
      // agent's streamed reply and tool calls are the response.
      pushTimelineEvent({
        kind: "user",
        label: target === "mission" ? "YOU" : `YOU → ${target.toUpperCase()}`,
        time: "now",
        body: text,
      })

      setChatError(null)
      // The route resolves a missing model to the user's default server-side.
      try {
        await sendMessage(
          { text },
          {
            body: {
              model: options.model ?? undefined,
              scope: scopeLevel,
              target,
              permissions: options.permissions,
            },
          }
        )
        setComposerInput("")
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat error"
        if (message.includes("404") || message.includes("Not Found")) {
          setChatError("Control chat endpoint not yet deployed.")
        } else {
          setChatError(message)
        }
      }
    },
    [sendMessage, pushTimelineEvent]
  )

  // Handle tool approval response from timeline cards
  const handleToolApprovalResponse = useToolApprovalHandler(addToolApprovalResponse)

  // Create new mission
  const handleCreateMission = useCallback(
    (text: string, targets: string[], permissions: MissionPermissions) => {
      const id = generateMissionId()
      const newMissionObj: Mission = {
        id,
        title: text.slice(0, 80),
        ws: targets[0] ?? "",
        status: "active",
        pinned: false,
        age: "now",
        cost: 0,
        base: "main",
        env: "-",
        permissions,
        approval: "Human merge",
        sandbox: "container-med",
        archived: false,
        targets,
        timeline: [{ kind: "user", label: "YOU", time: "now", body: text }],
      }
      setMissions((prev) => [newMissionObj, ...prev])
      setSelectedMissionId(id)
      setNewMission(false)
      setChatError(null)
      // Sent via effect once useChat re-keys to the new mission; sending here
      // would stream the reply into the previous mission's discarded chat.
      setPendingInitialMessage({ missionId: id, text })
    },
    []
  )

  // Derived mission data (filtered list, attention items, stats)
  const { needsAttention, agentStats } = useMissionDerived(
    missions,
    "active",
    "",
    missionWorktrees,
    changesets,
    mission?.cost
  )

  // Drawer heights
  const drawerHeights = [140, 232, 380]
  const cycleDrawerHeight = useCallback(() => {
    setDrawerHeight((h) => (h + 1) % 3)
  }, [])

  // Combined timeline: mission events + chat messages interleaved
  const combinedTimeline = useMemo(
    () => buildCombinedTimeline(mission?.timeline, messages),
    [mission?.timeline, messages]
  )

  // With no missions there is nothing to show but the composer; cancel only
  // makes sense when there is a mission view to return to.
  if (newMission || !mission) {
    return (
      <div className="app-control-shell flex h-full overflow-hidden">
        <main className="app-chat-column flex min-w-0 flex-1 flex-col" aria-label="Command Center">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
            <h1 className="text-xl font-semibold">Command Center</h1>
            <span className="inline-flex h-6 items-center gap-2 rounded-md bg-secondary px-2 text-xs text-secondary-foreground">
              <span className="size-1.5 rounded-full bg-accent-blue" />
              Orchestrator
            </span>
          </div>
          <NewMissionComposer
            workspaces={workspaces}
            onCancel={mission ? () => setNewMission(false) : undefined}
            onCreate={handleCreateMission}
          />
        </main>
        <SandboxRail worktrees={[]} changesets={[]} />
      </div>
    )
  }

  return (
    <div className="app-control-shell flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        {mission && (
          <MissionHeader
            mission={mission}
            workspace={getWorkspace(mission.ws)}
            mode={mode}
            onModeChange={setMode}
          />
        )}

        {/* Content area */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Conversation / Canvas area */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Needs attention banner */}
            {needsAttention.length > 0 && mode === "conversation" && (
              <NeedsAttentionBanner
                item={needsAttention[0]}
                onAction={() => {
                  const item = needsAttention[0]
                  if (item.kind === "APPROVE" && item.changeset) {
                    patchWorktree(item.worktree.id, { state: "implementing" })
                    pushTimelineEvent({
                      kind: "git",
                      label: "APPROVED",
                      time: "now",
                      body: `${item.changeset.id} approved for merge.`,
                    })
                  } else if (item.kind === "FAILED") {
                    patchWorktree(item.worktree.id, { state: "implementing", action: "retrying..." })
                  } else {
                    selectNode(item.worktree.id, "files")
                  }
                }}
                onSecondary={() => selectNode(needsAttention[0].worktree.id)}
              />
            )}

            {/* Agent summary strip */}
            {mode === "conversation" && (
              <AgentSummaryStrip
                stats={agentStats}
                isOpen={agentsOpen}
                onToggle={() => setAgentsOpen(!agentsOpen)}
                worktrees={missionWorktrees}
                onSelectWorktree={selectNode}
                changesets={missionChangesets}
                deployments={missionDeployments}
              />
            )}

            {/* Canvas mode */}
            {mode === "canvas" && (
              <Canvas
                mission={mission}
                worktrees={missionWorktrees}
                changesets={missionChangesets}
                deployments={missionDeployments}
                selection={selection}
                onSelectNode={selectNode}
              />
            )}

            {/* Conversation mode */}
            {mode === "conversation" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <PendingApprovalsBanner runId={null} />
                <Timeline
                  events={combinedTimeline}
                  worktrees={worktrees}
                  getWorktree={getWorktree}
                  onSelectWorktree={selectNode}
                  onApprove={(idx) => {
                    // Mark approval as resolved
                    const event = combinedTimeline[idx]
                    if (event?.kind === "approval") {
                      setMissions((prev) =>
                        prev.map((m) =>
                          m.id === selectedMissionId
                            ? {
                                ...m,
                                timeline: m.timeline.map((e, i) =>
                                  i === idx && e.kind === "approval"
                                    ? { ...e, resolved: "Approved by you - merge unblocked" }
                                    : e
                                ),
                              }
                            : m
                        )
                      )
                    }
                  }}
                  onToolApprovalResponse={handleToolApprovalResponse}
                  pending={chatPending}
                />
                {chatError && (
                  <div className="mx-auto max-w-2xl px-4 py-2">
                    <div className="rounded border border-accent-amber/30 bg-accent-amber/5 px-3 py-2 text-xs text-accent-amber">
                      {chatError}
                    </div>
                  </div>
                )}
                <Composer
                  value={composerInput}
                  onChange={setComposerInput}
                  onSend={handleSend}
                  pending={chatPending}
                  mission={mission}
                  worktrees={missionWorktrees}
                />
              </div>
            )}

            {/* Review mode placeholder */}
            {mode === "review" && (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                Review tab coming soon
              </div>
            )}
          </div>

          {/* Inspector panel (right side when node selected) */}
          {selection && mode === "canvas" && (
            <Inspector
              selection={selection}
              tab={inspectorTab}
              onTabChange={setInspectorTab}
              onClose={() => setSelection(null)}
              worktrees={worktrees}
              changesets={changesets}
              deployments={deployments}
              mission={mission}
              onPatchWorktree={patchWorktree}
              onPushEvent={pushTimelineEvent}
              onOpenDrawer={(tab) => {
                setDrawerOpen(true)
                setDrawerTab(tab)
              }}
            />
          )}
        </div>

        {/* Console drawer */}
        <ConsoleDrawer
          open={drawerOpen}
          onToggle={() => setDrawerOpen(!drawerOpen)}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          height={drawerHeights[drawerHeight]}
          onCycleHeight={cycleDrawerHeight}
          selection={selection}
          worktrees={worktrees}
          getWorktree={getWorktree}
        />
      </div>
      <SandboxRail worktrees={missionWorktrees} changesets={missionChangesets} />
    </div>
  )
}
