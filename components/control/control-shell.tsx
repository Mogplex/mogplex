"use client";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import {
  MISSION_PERMISSION_OPTIONS,
  type Mission,
  type ControlSeedData,
} from "@/lib/control/types";
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
import {
  SandboxLaunchProvider,
  useSandboxLaunchActions,
} from "@/components/sandbox-launch-provider";
import { useToolApprovalHandler } from "./use-tool-approval-handler";
import { buildCombinedTimeline } from "./build-combined-timeline";
import { ControlTopBar } from "./control-top-bar";
import { WorkspaceTabs, type ControlView } from "./workspace-tabs";
import { SandboxesPanel } from "./sandboxes-panel";
import { ChangedFilesCard } from "./changed-files-card";
import { Timeline } from "./timeline";
import { Composer } from "./composer";
import { ArtifactSidePanel } from "./artifact-side-panel";
import { SessionList } from "./session-list";
import { useControlSessions } from "./use-control-sessions";
import { useControlSend } from "./use-control-send";
import { useSessionUsage } from "./use-session-usage";
import { useControlSessionContext } from "./use-control-session-context";
import { useControlSessionUrl } from "./use-control-session-url";
import { canonicalizeControlSessionProjects } from "@/lib/control/session-project";
import { useControlWorktrees } from "./use-control-worktrees";
import { WorktreesPanel } from "./worktrees-panel";
import { downloadTextFile } from "./download-text-file";
import { useControlChats } from "./use-control-chats";
import { useControlChatError } from "./use-control-chat-error";
import { useControlChatComposer } from "./use-control-chat-composer";

export type ControlShellProps = {
  initialData: ControlSeedData;
  initialMissionId?: string;
};
function ControlShellInner({
  initialData,
  initialMissionId,
}: ControlShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { scope } = useParams<{ scope: string }>();

  const [missions, setMissions] = useState<Mission[]>(initialData.missions);
  const workspaces = initialData.workspaces;

  const [selectedMissionId, setSelectedMissionId] = useState<string>(
    initialMissionId || searchParams.get("mission") || missions[0]?.id || ""
  );
  const [view, setView] = useState<ControlView>("chat");
  const [focusSandboxId, setFocusSandboxId] = useState<string | null>(null);
  const [newMission, setNewMission] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const persistRef = useRef<
    (sessionId: string, messages: UIMessage[]) => Promise<void>
  >(async () => {});
  const mission = useMemo(
    () => missions.find((m) => m.id === selectedMissionId) || missions[0],
    [missions, selectedMissionId]
  );
  const getWorkspace = useCallback(
    (id: string) => workspaces.find((w) => w.id === id),
    [workspaces]
  );

  const getWorktree = (id: string) =>
    initialData.worktrees.find((worktree) => worktree.id === id);
  const activeChatId =
    (sessionId ?? selectedMissionId) || "unselected-control-session";
  const persistChat = useCallback((id: string, finished: UIMessage[]) => {
    return persistRef.current(id, finished);
  }, []);
  const {
    messages,
    sendMessage,
    status,
    stop,
    error: activeChatError,
    persistError,
    clearError: clearActiveChatError,
    activeChat,
    runningSessionIds,
    setSessionMessages,
    removeSession,
    addToolApprovalResponse,
  } = useControlChats({
    activeChatId,
    onPersist: persistChat,
  });
  const {
    error: localChatError,
    setError: setChatError,
    removeError: removeChatError,
  } = useControlChatError(activeChatId);
  const [composerInput, setComposerInput, removeComposerDraft] =
    useControlChatComposer(activeChatId);
  const removeSessionState = useCallback(
    (id: string) => {
      removeSession(id);
      removeChatError(id);
      removeComposerDraft(id);
    },
    [removeChatError, removeComposerDraft, removeSession]
  );
  const getActiveChatError = useCallback(() => activeChat.error, [activeChat]);
  const chatPending = status === "streaming" || status === "submitted";
  const controlWorktrees = useControlWorktrees({ sessionId, chatPending });

  const { loading: sandboxesLoading } = useSandboxSync();
  const sandboxesById = useSandboxStore((state) => state.sandboxesById);
  const allSandboxes = useMemo(
    () =>
      Object.values(sandboxesById).sort((a, b) =>
        (b.last_active_at ?? "").localeCompare(a.last_active_at ?? "")
      ),
    [sandboxesById]
  );
  const { repos, mutate: mutateRepos } = useRepos();
  const { launchRepoSandbox } = useSandboxLaunchActions();
  const {
    sessions,
    sessionsLoaded,
    selectSession,
    createSession,
    updateSession,
    persistSession,
  } = useControlSessions({
    sessionId,
    setSessionId,
    setSessionMessages,
    removeSessionMessages: removeSessionState,
    deepLinkTarget: searchParams.get("mission"),
  });

  const displaySessions = useMemo(
    () => canonicalizeControlSessionProjects(sessions, repos),
    [repos, sessions]
  );
  const activeSession =
    displaySessions.find((entry) => entry.id === sessionId) ?? null;

  const {
    activeRepo,
    sandboxes,
    activeSandbox,
    requestContext,
    selectSandbox,
  } = useControlSessionContext({
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
    persistRef.current = persistSession;
  }, [persistSession]);
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
    clearChatError: clearActiveChatError,
    getChatError: getActiveChatError,
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
      options: ComposerSendOptions,
      createdRepo?: (typeof repos)[number]
    ) => {
      if (createdRepo)
        await mutateRepos(
          [createdRepo, ...repos.filter((repo) => repo.id !== createdRepo.id)],
          { revalidate: false }
        );
      const id = generateMissionId();
      const missionTitle =
        text.slice(0, 80) || options.files[0]?.filename || "New mission";
      const createdSessionId = await createSession(
        missionTitle,
        project,
        repoId,
        text
      );
      if (!createdSessionId) {
        if (!createdRepo)
          setChatError(
            "Could not create the mission session. Please try again."
          );
        return false;
      }
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
      pendingInitialMessageRef.current = { missionId: id, text, options };
      return true;
    },
    [createSession, mutateRepos, pendingInitialMessageRef, repos, setChatError]
  );

  const sessionUsage = useSessionUsage(messages, chatPending);
  const usageTokens = sessionUsage.inputTokens + sessionUsage.outputTokens;
  const combinedTimeline = buildCombinedTimeline(mission?.timeline, messages);

  const hasChanges = useMemo(
    () => collectChangedFiles(messages).length > 0,
    [messages]
  );

  const previewUrl =
    activeSandbox?.runtime_summary.status === "running"
      ? (activeSandbox.runtime_summary.preview_url ?? null)
      : null;
  const hasSession = Boolean(sessionId || mission);
  const chatError =
    localChatError ?? activeChatError?.message ?? persistError ?? null;

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

  const handleStartSandbox = useCallback(() => {
    const repo = activeRepo;
    if (!repo) {
      toast({
        title: "No repository connected",
        description: "Connect a repository before starting a sandbox.",
        variant: "destructive",
      });
      return;
    }
    void launchRepoSandbox(repo, {
      source: "control",
      trigger: "control-start-sandbox",
      intent: { kind: "start_fresh", interactive: true },
    });
  }, [activeRepo, launchRepoSandbox]);

  useControlSessionUrl({
    scope,
    searchParams,
    sessionId,
    sessions,
    sessionsLoaded,
  });

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
    downloadTextFile(`${slug}.md`, buildTranscriptMarkdown(title, messages));
  }, [messages, activeSession?.title, mission?.title]);

  useEffect(() => {
    const listener = () => setView("sandboxes");
    window.addEventListener(CONTROL_VIEW_EVENT, listener);
    return () => window.removeEventListener(CONTROL_VIEW_EVENT, listener);
  }, []);

  if (newMission || (!mission && !sessionId)) {
    return (
      <NewMissionView
        repos={repos}
        sessions={displaySessions}
        sessionId={sessionId}
        workingIds={runningSessionIds}
        canCancel={Boolean(mission || sessionId)}
        onCancel={() => setNewMission(false)}
        onCreate={handleCreateMission}
        onSelectSession={handleSelectSession}
        onNewSession={() => setNewMission(true)}
      />
    );
  }

  return (
    <div className="app-control-shell bg-ink-950 text-ink-100 flex h-full overflow-hidden">
      <SessionList
        sessions={displaySessions}
        selectedId={sessionId}
        workingIds={runningSessionIds}
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
          onStartSandbox={handleStartSandbox}
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
          worktrees={controlWorktrees.worktrees}
          selectedSandboxId={activeSandbox?.id ?? null}
          onFocusSandbox={(id) => {
            selectSandbox(id);
            setView("sandboxes");
            setFocusSandboxId(id);
          }}
        />

        <div
          id={`control-${view}-panel`}
          role="tabpanel"
          aria-labelledby={`control-${view}-tab`}
          className="relative flex min-h-0 flex-1 overflow-hidden"
        >
          {view === "sandboxes" ? (
            <SandboxesPanel
              sandboxes={sandboxes}
              loading={sandboxesLoading}
              hasRepository={Boolean(activeRepo)}
              selectedSandboxId={activeSandbox?.id ?? null}
              focusSandboxId={focusSandboxId}
              onClearFocus={() => setFocusSandboxId(null)}
              onSelectSandbox={selectSandbox}
              onStartSandbox={handleStartSandbox}
            />
          ) : view === "worktrees" ? (
            <WorktreesPanel
              worktrees={controlWorktrees.worktrees}
              loading={controlWorktrees.loading}
              error={controlWorktrees.error}
              onRefresh={controlWorktrees.refresh}
              onAction={controlWorktrees.act}
              onDiff={controlWorktrees.loadDiff}
            />
          ) : (
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <Timeline
                  key={activeChatId}
                  events={combinedTimeline}
                  worktrees={initialData.worktrees}
                  getWorktree={getWorktree}
                  onApprove={(idx) => {
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
