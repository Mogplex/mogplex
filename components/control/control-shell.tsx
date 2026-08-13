"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import type { UIMessage } from "ai";
import {
  MISSION_PERMISSION_OPTIONS,
  type Mission,
  type Worktree,
  type ControlSeedData,
} from "@/lib/control/types";
import type { SandboxRecord } from "@/lib/types";
import { NewMissionView } from "./new-mission-view";
import { usePendingInitialMessage } from "./use-pending-initial-message";
import type { ComposerSendOptions } from "./composer";
import { CONTROL_VIEW_EVENT, generateMissionId } from "@/lib/control/utils";
import { collectChangedFiles } from "@/lib/control/changed-files";
import { buildTranscriptMarkdown } from "@/lib/control/export-transcript";
import { scopedHref } from "@/lib/scoped-href";
import { useSandboxStore, useSandboxSync } from "@/hooks/use-sandbox";
import { useRepos } from "@/hooks/use-repos";
import { toast } from "@/hooks/use-toast";
import { SandboxLaunchProvider, useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { useToolApprovalHandler } from "./use-tool-approval-handler";
import { buildCombinedTimeline } from "./build-combined-timeline";
import { ControlTopBar } from "./control-top-bar";
import { WorkspaceTabs, type ControlView } from "./workspace-tabs";
import { WorktreesPanel } from "./worktrees-panel";
import { ChangedFilesCard } from "./changed-files-card";
import { Timeline } from "./timeline";
import { Composer } from "./composer";
import { ArtifactSidePanel } from "./artifact-side-panel";
import { SessionList } from "./session-list";
import { useControlSessions } from "./use-control-sessions";
import { useControlSend } from "./use-control-send";
import { useSessionUsage } from "./use-session-usage";
import { useControlSessionContext } from "./use-control-session-context";
import { canonicalizeControlSessionProjects } from "@/lib/control/session-project";

export type ControlShellProps = {
  initialData: ControlSeedData;
  initialMissionId?: string;
};

function downloadTextFile(filename: string, contents: string) {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/markdown" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ControlShellInner({ initialData, initialMissionId }: ControlShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { scope } = useParams<{ scope: string }>();

  const [missions, setMissions] = useState<Mission[]>(initialData.missions);
  const [worktrees] = useState<Worktree[]>(initialData.worktrees);
  const workspaces = initialData.workspaces;

  const [selectedMissionId, setSelectedMissionId] = useState<string>(
    initialMissionId || searchParams.get("mission") || missions[0]?.id || ""
  );
  const [view, setView] = useState<ControlView>("chat");
  const [focusSandboxId, setFocusSandboxId] = useState<string | null>(null);
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
  const sandboxesById = useSandboxStore((state) => state.sandboxesById);
  const allSandboxes = useMemo(
    () =>
      Object.values(sandboxesById).sort((a, b) =>
        (b.last_active_at ?? "").localeCompare(a.last_active_at ?? "")
      ),
    [sandboxesById]
  );
  const { repos } = useRepos();
  const { launchRepoSandbox } = useSandboxLaunchActions();

  const {
    sessions,
    selectSession,
    createSession,
    updateSession,
    persist,
  } = useControlSessions({
    sessionId,
    setSessionId,
    chatStatus: status,
    setMessages,
    deepLinkTarget: searchParams.get("mission"),
  });

  const activeSession = useMemo(
    () => sessions.find((entry) => entry.id === sessionId) ?? null,
    [sessions, sessionId]
  );
  const displaySessions = canonicalizeControlSessionProjects(sessions, repos);

  const { activeRepo, sandboxes, activeSandbox, requestContext } =
    useControlSessionContext({
      activeSession,
      repos,
      allSandboxes,
      sessionId,
      selectedMissionId,
      missionTitle: activeSession?.title ?? mission?.title ?? null,
    });

  const handleSelectSession = useCallback(
    (id: string) => {
      setView("chat");
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
    requestContext,
  });

  const handleSend = useControlSend({
    sendMessage,
    setChatError,
    clearComposer: () => setComposerInput(""),
    requestContext,
  });

  const handleToolApprovalResponse = useToolApprovalHandler(
    addToolApprovalResponse
  );

  const handleCreateMission = useCallback(
    async (
      text: string,
      project: string,
      repoId: string | null,
      options: ComposerSendOptions
    ) => {
      const id = generateMissionId();
      const missionTitle =
        text.slice(0, 80) || options.files[0]?.filename || "New mission";
      // Persist the chat session before re-keying useChat so the first
      // message streams straight into the durable session's chat. Every
      // session is tied to the project chosen in the composer (a connected
      // repo or a newly named project).
      await createSession(missionTitle, project, repoId);
      const newMissionObj: Mission = {
        id,
        title: missionTitle.slice(0, 80),
        ws: "",
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
        targets: [],
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
    [createSession, pendingInitialMessageRef]
  );

  // Live usage from the session's ai_calls (keyed by streamed ai_call_id
  // metadata); drives the composer's context ring.
  const sessionUsage = useSessionUsage(messages, chatPending);
  const usageTokens = sessionUsage.inputTokens + sessionUsage.outputTokens;

  const combinedTimeline = useMemo(
    () => buildCombinedTimeline(mission?.timeline, messages),
    [mission?.timeline, messages]
  );

  const hasChanges = useMemo(
    () => collectChangedFiles(messages).length > 0,
    [messages]
  );

  const previewUrl = useMemo(
    () =>
      sandboxes.find(
        (sandbox) =>
          sandbox.runtime_summary.status === "running" &&
          sandbox.runtime_summary.preview_url
      )?.runtime_summary.preview_url ?? null,
    [sandboxes]
  );
  const hasSession = Boolean(sessionId || mission);

  // Header/menus act through the agent: it runs in the mission sandbox, so
  // git and shell work is an instruction it executes, not a local call.
  const sendInstruction = useCallback(
    (text: string) => {
      setView("chat");
      void handleSend(text, "mission", "IMPLEMENT", {
        model: null,
        permissions: MISSION_PERMISSION_OPTIONS[0],
        mode: "run",
        files: [],
      });
    },
    [handleSend]
  );

  const handleSpawnWorktree = useCallback(() => {
    const repo = activeRepo;
    if (!repo) {
      toast({
        title: "No repository connected",
        description: "Connect a repository before spawning worktrees.",
        variant: "destructive",
      });
      return;
    }
    void launchRepoSandbox(repo, {
      source: "control",
      trigger: "spawn-worktree",
      intent: { kind: "start_fresh", interactive: true },
    });
  }, [activeRepo, launchRepoSandbox]);

  useEffect(() => {
    if (!sessionId || searchParams.get("mission") === sessionId) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("mission", sessionId);
    // Avoid an App Router remount racing the freshly created local session.
    window.history.replaceState(
      window.history.state,
      "",
      `${scopedHref(scope, "/control")}?${next.toString()}`
    );
  }, [scope, searchParams, sessionId]);

  const handleMergeSandbox = useCallback(
    (sandbox: SandboxRecord) => {
      sendInstruction(
        `Merge the \`${sandbox.working_branch}\` branch into \`${sandbox.base_branch}\`: commit any pending changes with a conventional commit message, switch to the base branch, merge, resolve any conflicts, and push.`
      );
    },
    [sendInstruction]
  );

  const handleCopyLink = useCallback(() => {
    const target = sessionId ?? selectedMissionId;
    if (!target) return;
    const url = `${window.location.origin}${scopedHref(scope, "/control")}?mission=${target}`;
    void navigator.clipboard.writeText(url);
  }, [sessionId, selectedMissionId, scope]);

  const handleExportTranscript = useCallback(() => {
    if (messages.length === 0) return;
    const title = activeSession?.title ?? mission?.title ?? "control-session";
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "control-session";
    downloadTextFile(
      `${slug}.md`,
      buildTranscriptMarkdown(title, messages)
    );
  }, [messages, activeSession?.title, mission?.title]);

  // Status bar "Sandbox checkout" jumps straight to the worktrees panel.
  useEffect(() => {
    const listener = () => setView("worktrees");
    window.addEventListener(CONTROL_VIEW_EVENT, listener);
    return () => window.removeEventListener(CONTROL_VIEW_EVENT, listener);
  }, []);

  // With no missions there is nothing to show but the composer — unless a
  // persisted session is selected, in which case its restored conversation
  // renders in the main view.
  if (newMission || (!mission && !sessionId)) {
    return (
      <NewMissionView
        repos={repos}
        sessions={displaySessions}
        sessionId={sessionId}
        canCancel={Boolean(mission || sessionId)}
        onCancel={() => setNewMission(false)}
        onCreate={handleCreateMission}
        onSelectSession={handleSelectSession}
        onNewSession={() => setNewMission(true)}
      />
    );
  }

  return (
    <div className="app-control-shell flex h-full overflow-hidden bg-ink-950 text-ink-100">
      <SessionList
        sessions={displaySessions}
        selectedId={sessionId}
        workingId={chatPending ? sessionId : null}
        onSelect={handleSelectSession}
        onNew={() => setNewMission(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ControlTopBar
          projectName={
            activeSession?.project ??
            (mission ? (getWorkspace(mission.ws)?.name ?? null) : null)
          }
          sessionTitle={activeSession?.title ?? mission?.title ?? null}
          branch={activeSandbox?.working_branch ?? mission?.base ?? "main"}
          hasSession={hasSession}
          chatPending={chatPending}
          previewUrl={previewUrl}
          repoFullName={activeRepo?.full_name ?? null}
          onSendInstruction={sendInstruction}
          onOpenTerminal={() =>
            router.push(scopedHref(scope, "/projects/workspace"))
          }
          onSpawnWorktree={handleSpawnWorktree}
          onScheduleAutomation={() =>
            router.push(scopedHref(scope, "/automations"))
          }
          onRename={(title) => {
            void updateSession({ title });
          }}
          onArchive={() => {
            void updateSession({ archived: true });
          }}
          onExportTranscript={handleExportTranscript}
          onCopyLink={handleCopyLink}
        />
        <WorkspaceTabs
          view={view}
          onViewChange={setView}
          sandboxes={sandboxes}
          onFocusSandbox={(id) => {
            setView("worktrees");
            setFocusSandboxId(id);
          }}
        />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {view === "worktrees" ? (
            <WorktreesPanel
              sandboxes={sandboxes}
              focusSandboxId={focusSandboxId}
              onClearFocus={() => setFocusSandboxId(null)}
              canMerge={hasSession && !chatPending}
              onMerge={handleMergeSandbox}
              onSpawn={handleSpawnWorktree}
            />
          ) : (
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <Timeline
                  events={combinedTimeline}
                  worktrees={worktrees}
                  getWorktree={getWorktree}
                  onSelectWorktree={() => setView("worktrees")}
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
                  trailing={
                    !chatPending && hasChanges ? (
                      <ChangedFilesCard messages={messages} />
                    ) : null
                  }
                />
                {chatError && (
                  <div className="mx-auto w-full max-w-5xl px-4 py-2 sm:px-6">
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
                  onStop={stop}
                  usageTokens={usageTokens}
                />
              </div>
              <ArtifactSidePanel messages={messages} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ControlShell(props: ControlShellProps) {
  return (
    <SandboxLaunchProvider>
      <ControlShellInner {...props} />
    </SandboxLaunchProvider>
  );
}
