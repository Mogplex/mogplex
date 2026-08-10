"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import type { UIMessage } from "ai";
import type {
  Mission,
  Worktree,
  Changeset,
  Deployment,
  TimelineEvent,
  ControlSeedData,
} from "@/lib/control/types";
import { NewMissionView } from "./new-mission-view";
import { usePendingInitialMessage } from "./use-pending-initial-message";
import type { ComposerSendOptions } from "./composer";
import { generateMissionId } from "@/lib/control/utils";
import { useSandboxSync } from "@/hooks/use-sandbox";
import { useToolApprovalHandler } from "./use-tool-approval-handler";
import { buildCombinedTimeline } from "./build-combined-timeline";
import { useMissionDerived } from "./use-mission-derived";
import { MissionHeader } from "./mission-header";
import { Timeline } from "./timeline";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { Composer } from "./composer";
import { ConsoleDrawer } from "./console-drawer";
import { NeedsAttentionBanner } from "./needs-attention-banner";
import { AgentSummaryStrip } from "./agent-summary-strip";
import { PendingApprovalsBanner } from "./pending-approvals-banner";
import { SandboxRail } from "./sandbox-rail";
import { ArtifactSidePanel } from "./artifact-side-panel";
import { SessionList } from "./session-list";
import { useControlSessions } from "./use-control-sessions";
import { useControlSend } from "./use-control-send";

type ControlMode = "conversation" | "canvas" | "review";

export type ControlShellProps = {
  initialData: ControlSeedData;
  initialMissionId?: string;
};

export function ControlShell({
  initialData,
  initialMissionId,
}: ControlShellProps) {
  const searchParams = useSearchParams();

  const [missions, setMissions] = useState<Mission[]>(initialData.missions);
  const [worktrees, setWorktrees] = useState<Worktree[]>(initialData.worktrees);
  const [changesets] = useState<Changeset[]>(initialData.changesets);
  const [deployments] = useState<Deployment[]>(initialData.deployments);
  const workspaces = initialData.workspaces;

  const [selectedMissionId, setSelectedMissionId] = useState<string>(
    initialMissionId || searchParams.get("mission") || missions[0]?.id || ""
  );
  const [mode, setMode] = useState<ControlMode>("conversation");
  const [selection, setSelection] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState("summary");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<
    "terminal" | "logs" | "tests" | "events"
  >("terminal");
  const [drawerHeight, setDrawerHeight] = useState(0); // index into [140, 232, 380]
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [newMission, setNewMission] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const persistRef = useRef<(messages: UIMessage[]) => void>(() => {});

  const mission = useMemo(
    () => missions.find((m) => m.id === selectedMissionId) || missions[0],
    [missions, selectedMissionId]
  );

  const getWorkspace = useCallback(
    (id: string) => workspaces.find((w) => w.id === id),
    [workspaces]
  );

  const getWorktree = useCallback(
    (id: string) => worktrees.find((w) => w.id === id),
    [worktrees]
  );

  const missionWorktrees = useMemo(
    () => worktrees.filter((w) => w.mission === mission?.id),
    [worktrees, mission?.id]
  );

  const missionChangesets = useMemo(
    () => changesets.filter((c) => c.mission === mission?.id),
    [changesets, mission?.id]
  );

  const missionDeployments = useMemo(
    () => deployments.filter((d) => d.ws === mission?.ws),
    [deployments, mission?.ws]
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/control/chat",
      }),
    []
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    addToolApprovalResponse,
  } = useChat({
    transport,
    id: `control-${sessionId ?? selectedMissionId}`,
    sendAutomaticallyWhen:
      lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages: finishedMessages }) => {
      persistRef.current(finishedMessages);
    },
    onError: (error) => {
      setChatError(error.message || "Chat error");
    },
  });

  const chatPending = status === "streaming" || status === "submitted";

  useSandboxSync();

  const { sessions, selectSession, createSession, persist } =
    useControlSessions({
      sessionId,
      setSessionId,
      chatStatus: status,
      setMessages,
      deepLinkTarget: searchParams.get("mission"),
    });

  const handleSelectSession = useCallback(
    (id: string) => {
      setMode("conversation");
      void selectSession(id);
    },
    [selectSession]
  );

  useEffect(() => {
    persistRef.current = (finished) => {
      void persist(finished);
    };
  }, [persist]);

  const [composerInput, setComposerInput] = useState("");

  const pendingInitialMessageRef = usePendingInitialMessage({
    selectedMissionId,
    status,
    sendMessage,
    onError: (message) => setChatError(message),
  });

  const pushTimelineEvent = useCallback(
    (event: TimelineEvent) => {
      setMissions((prev) =>
        prev.map((m) =>
          m.id === selectedMissionId
            ? { ...m, timeline: [...m.timeline, event] }
            : m
        )
      );
    },
    [selectedMissionId]
  );

  const patchWorktree = useCallback((id: string, patch: Partial<Worktree>) => {
    setWorktrees((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w))
    );
  }, []);

  const selectNode = useCallback(
    (id: string | null, tab?: string) => {
      setSelection(id);
      if (tab) setInspectorTab(tab);
      if (id && mode === "conversation") setMode("canvas");
    },
    [mode]
  );

  const handleSend = useControlSend({
    sendMessage,
    setChatError,
    clearComposer: () => setComposerInput(""),
  });

  const handleToolApprovalResponse = useToolApprovalHandler(
    addToolApprovalResponse
  );

  const handleCreateMission = useCallback(
    async (text: string, targets: string[], options: ComposerSendOptions) => {
      const id = generateMissionId();
      const missionTitle =
        text.slice(0, 80) || options.files[0]?.filename || "New mission";
      // Persist the chat session before re-keying useChat so the first
      // message streams straight into the durable session's chat. The
      // session inherits the mission's workspace as its project group.
      await createSession(missionTitle, getWorkspace(targets[0] ?? "")?.name);
      const newMissionObj: Mission = {
        id,
        title: missionTitle.slice(0, 80),
        ws: targets[0] ?? "",
        status: "active",
        pinned: false,
        age: "now",
        cost: 0,
        base: "main",
        env: "-",
        permissions: options.permissions,
        approval: "Human merge",
        sandbox: "container-med",
        archived: false,
        targets,
        timeline: [],
      };
      setMissions((prev) => [newMissionObj, ...prev]);
      setSelectedMissionId(id);
      setNewMission(false);
      setChatError(null);
      // Sent via effect once useChat re-keys to the new mission; sending here
      // would stream the reply into the previous mission's discarded chat.
      pendingInitialMessageRef.current = { missionId: id, text, options };
    },
    [createSession, getWorkspace]
  );

  const { needsAttention, agentStats } = useMissionDerived(
    missions,
    "active",
    "",
    missionWorktrees,
    changesets,
    mission?.cost
  );

  const drawerHeights = [140, 232, 380];
  const cycleDrawerHeight = useCallback(() => {
    setDrawerHeight((h) => (h + 1) % 3);
  }, []);

  const combinedTimeline = useMemo(
    () => buildCombinedTimeline(mission?.timeline, messages),
    [mission?.timeline, messages]
  );

  // With no missions there is nothing to show but the composer — unless a
  // persisted session is selected, in which case its restored conversation
  // renders in the main view. Cancel only makes sense when there is a view
  // to return to.
  if (newMission || (!mission && !sessionId)) {
    return (
      <NewMissionView
        workspaces={workspaces}
        sessions={sessions}
        sessionId={sessionId}
        messages={messages}
        chatPending={chatPending}
        canCancel={Boolean(mission || sessionId)}
        onCancel={() => setNewMission(false)}
        onCreate={handleCreateMission}
        onSelectSession={handleSelectSession}
        onNewSession={() => setNewMission(true)}
      />
    );
  }

  return (
    <div className="app-control-shell flex h-full overflow-hidden">
      <SessionList
        sessions={sessions}
        selectedId={sessionId}
        onSelect={handleSelectSession}
        onNew={() => setNewMission(true)}
      />
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
                  const item = needsAttention[0];
                  if (item.kind === "APPROVE" && item.changeset) {
                    patchWorktree(item.worktree.id, { state: "implementing" });
                    pushTimelineEvent({
                      kind: "git",
                      label: "APPROVED",
                      time: "now",
                      body: `${item.changeset.id} approved for merge.`,
                    });
                  } else if (item.kind === "FAILED") {
                    patchWorktree(item.worktree.id, {
                      state: "implementing",
                      action: "retrying...",
                    });
                  } else {
                    selectNode(item.worktree.id, "files");
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
                    const event = combinedTimeline[idx];
                    if (event?.kind === "approval") {
                      setMissions((prev) =>
                        prev.map((m) =>
                          m.id === selectedMissionId
                            ? {
                                ...m,
                                timeline: m.timeline.map((e, i) =>
                                  i === idx && e.kind === "approval"
                                    ? {
                                        ...e,
                                        resolved:
                                          "Approved by you - merge unblocked",
                                      }
                                    : e
                                ),
                              }
                            : m
                        )
                      );
                    }
                  }}
                  onToolApprovalResponse={handleToolApprovalResponse}
                  pending={chatPending}
                />
                {chatError && (
                  <div className="mx-auto max-w-2xl px-4 py-2">
                    <div className="border-accent-amber/30 bg-accent-amber/5 text-accent-amber rounded border px-3 py-2 text-xs">
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
                  onStop={stop}
                />
              </div>
            )}

            {/* Review mode placeholder */}
            {mode === "review" && (
              <div className="text-muted-foreground flex flex-1 items-center justify-center">
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
                setDrawerOpen(true);
                setDrawerTab(tab);
              }}
            />
          )}
          {mode === "conversation" && <ArtifactSidePanel messages={messages} />}
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
      <SandboxRail messages={messages} streaming={chatPending} />
    </div>
  );
}
