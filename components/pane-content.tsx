"use client";
import {
  createTerminalSessionKey,
  getPaneSandboxBinding,
  getTerminalSessionKey,
  type PaneNode,
  type PaneType,
  type TerminalSessionSummary,
} from "@/hooks/use-split-panes";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { useSessionsStore } from "@/hooks/use-sessions";
import { resolveSandboxRootDirectory } from "@/lib/repo-settings";
import {
  presentSandboxError,
  type SandboxError,
} from "@/lib/sandbox/error-state";
import {
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
  type SandboxUiState,
} from "@/lib/sandbox/ui-state";
import { resolveSandboxLaunchIntentFromUiState } from "@/lib/sandbox/launch-intent";
import {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  Component,
  type ReactNode,
  type ErrorInfo,
} from "react";
import {
  useAiCallEvents,
  useConversationRuns,
  useLiveInteractiveCalls,
} from "@/hooks/use-observability";
import { useCustomCommands } from "@/hooks/use-custom-commands";
import {
  getHarnessResumeSessionId,
  useConversationsStore,
  type LocalMessage as ConversationLocalMessage,
  type LocalMessageSegment,
  type LocalToolCall,
} from "@/hooks/use-conversations";
import { CommandInput } from "./command-input";
import { AsciiLoader } from "./ascii-loader";
import { SandboxChip } from "./sandbox-chip";
import { parseSlashCommand, buildBuiltinCommands } from "@/lib/slash-commands";
import { useModels } from "@/hooks/use-models";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { usePreviewFeedbackStore } from "@/hooks/use-preview-feedback";
import { buildChatRequestBody } from "@/lib/agents/chat-request-body";
import { createHarnessOutputRenderer } from "@/lib/harness/output-renderer";
import {
  buildHarnessResumeRetryNotice,
  isRecoverableHarnessResumeFailure,
} from "@/lib/harness/resume-recovery";
import { resolvePaneSandboxId } from "@/lib/sandbox/pane-binding";
import { resolvePreviewPaneUrl } from "@/lib/sandbox/preview-url";
import type { Repo } from "@/lib/types";
import { ensureSessionSandboxBinding } from "@/lib/sandbox/session-retarget";
import dynamic from "next/dynamic";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { PatchViewer } from "@/components/diffs/patch-viewer";
import { detectPatch } from "@/lib/diffs/detect";
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Plus,
  Xmark,
  Home,
  ChatBubble,
  Terminal as TerminalIcon,
  EditPencil,
  Eye,
  Folder,
  Activity,
  Brain,
  Cube,
  Play,
  Timer,
  GitCompare,
  Flash,
  Network,
  ListSelect,
  Sparks,
  Settings,
  DragSolid,
} from "iconoir-react";
import { useDraggable } from "@dnd-kit/core";
import { PaneDropZones } from "./pane-drop-zones";
import { useIsMobile } from "@/hooks/use-mobile";

const HomePane = dynamic(
  () => import("./panes/home-pane").then((m) => m.HomePane),
  { ssr: false }
);
const AgentRosterPane = dynamic(
  () => import("./panes/agent-roster-pane").then((m) => m.AgentRosterPane),
  { ssr: false }
);
const OutputPane = dynamic(
  () => import("./panes/output-pane").then((m) => m.OutputPane),
  { ssr: false }
);
const CronPane = dynamic(
  () => import("./panes/cron-pane").then((m) => m.CronPane),
  { ssr: false }
);
const DiffPane = dynamic(
  () => import("./panes/diff-pane").then((m) => m.DiffPane),
  { ssr: false }
);
const FlowsPane = dynamic(
  () => import("./panes/flows-pane").then((m) => m.FlowsPane),
  { ssr: false }
);
const ConnectionsPane = dynamic(
  () => import("./panes/connections-pane").then((m) => m.ConnectionsPane),
  { ssr: false }
);
const XTermPane = dynamic(
  () => import("./xterm-pane").then((m) => m.XTermPane),
  { ssr: false }
);
const MonacoPane = dynamic(
  () => import("./monaco-pane").then((m) => m.MonacoPane),
  { ssr: false }
);
const FileManagerPane = dynamic(
  () => import("./file-manager-pane").then((m) => m.FileManagerPane),
  { ssr: false }
);
const SkillsPane = dynamic(
  () => import("./skills-pane").then((m) => m.SkillsPane),
  { ssr: false }
);
const ObservabilityPane = dynamic(
  () => import("./observability-pane").then((m) => m.ObservabilityPane),
  { ssr: false }
);
const FileTreePane = dynamic(
  () => import("./file-tree-pane").then((m) => m.FileTreePane),
  { ssr: false }
);
const PreviewPane = dynamic(
  () => import("./preview-pane").then((m) => m.PreviewPane),
  { ssr: false }
);
const MessageContent = dynamic(
  () => import("./message-content").then((m) => m.MessageContent),
  {
    ssr: false,
    loading: () => <span className="text-muted-foreground">...</span>,
  }
);

interface Props {
  pane: PaneNode;
  active: boolean;
  onSelect: () => void;
  onUpdatePane?: (updates: Partial<PaneNode>) => void;
  onUpdateTerminalSession?: (
    terminalSessionKey: string,
    updates: Partial<PaneNode>
  ) => void;
  terminalSessions?: TerminalSessionSummary[];
  activeRepo?:
    | (Pick<Repo, "id" | "full_name" | "root_directory" | "default_branch"> & {
        working_branch?: string | null;
      })
    | null;
  activeSandbox?: { id: string } | null;
  sandboxCreating?: boolean;
  sandboxError?: SandboxError | null;
  onOpenFile?: (filePath: string, sandboxId?: string) => void;
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void;
  onClearFilePath?: (targetPath: string, sandboxId: string) => void;
  onSplit?: (
    dir: "horizontal" | "vertical",
    type: PaneType,
    overrides?: Partial<PaneNode>
  ) => void;
  onClose?: () => void;
  onPopOutIDE?: (filePath?: string) => void;
}

const EMPTY_LOCAL_MESSAGES: ConversationLocalMessage[] = [];

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const ICON_CLASS = "size-3.5";

const PANE_ICONS: Record<string, ReactNode> = {
  home: <Home className={ICON_CLASS} />,
  agent: <ChatBubble className={ICON_CLASS} />,
  terminal: <TerminalIcon className={ICON_CLASS} />,
  editor: <EditPencil className={ICON_CLASS} />,
  tools: <Settings className={ICON_CLASS} />,
  stats: <Activity className={ICON_CLASS} />,
  memories: <Brain className={ICON_CLASS} />,
  rules: <ListSelect className={ICON_CLASS} />,
  skills: <Sparks className={ICON_CLASS} />,
  files: <Folder className={ICON_CLASS} />,
  preview: <Eye className={ICON_CLASS} />,
  roster: <Cube className={ICON_CLASS} />,
  output: <Play className={ICON_CLASS} />,
  cron: <Timer className={ICON_CLASS} />,
  diff: <GitCompare className={ICON_CLASS} />,
  triggers: <Flash className={ICON_CLASS} />,
  connections: <Network className={ICON_CLASS} />,
};

const PANE_TYPE_GROUPS: {
  label: string;
  items: { type: PaneType; icon: ReactNode; name: string }[];
}[] = [
  {
    label: "Workspace",
    items: [
      {
        type: "agent",
        icon: <ChatBubble className={ICON_CLASS} />,
        name: "Agent Chat",
      },
      {
        type: "terminal",
        icon: <TerminalIcon className={ICON_CLASS} />,
        name: "Terminal",
      },
      {
        type: "editor",
        icon: <EditPencil className={ICON_CLASS} />,
        name: "Editor",
      },
      {
        type: "preview",
        icon: <Eye className={ICON_CLASS} />,
        name: "Preview",
      },
      { type: "files", icon: <Folder className={ICON_CLASS} />, name: "Files" },
    ],
  },
  {
    label: "System",
    items: [
      {
        type: "stats",
        icon: <Activity className={ICON_CLASS} />,
        name: "Stats",
      },
      {
        type: "memories",
        icon: <Brain className={ICON_CLASS} />,
        name: "Memories",
      },
      { type: "roster", icon: <Cube className={ICON_CLASS} />, name: "Agents" },
      { type: "output", icon: <Play className={ICON_CLASS} />, name: "Output" },
      { type: "cron", icon: <Timer className={ICON_CLASS} />, name: "Cron" },
      {
        type: "diff",
        icon: <GitCompare className={ICON_CLASS} />,
        name: "Diff",
      },
      {
        type: "triggers",
        icon: <Flash className={ICON_CLASS} />,
        name: "Workflows",
      },
      {
        type: "connections",
        icon: <Network className={ICON_CLASS} />,
        name: "Connections",
      },
    ],
  },
];

function buildSplitSandboxOverrides(
  pane: PaneNode,
  resolvedSandboxId?: string
): Partial<PaneNode> | undefined {
  const sandboxBinding = getPaneSandboxBinding(pane);
  if (sandboxBinding === "pinned") {
    return {
      sandboxBinding: "pinned",
      ...(resolvedSandboxId ? { sandboxId: resolvedSandboxId } : {}),
    };
  }

  if (pane.sandboxBinding === "session") {
    return { sandboxBinding: "session" };
  }

  return undefined;
}

/**
 * Subtle monospaced tag advertising the workspace path the sandbox is
 * actually running at. Renders only when the path is a non-empty string —
 * `null` (explicit repo root) and missing/legacy values are hidden so the
 * pane title bar stays clean for the common case (whole-repo sandboxes).
 *
 * The `:` prefix matches the established repo-card convention
 * (components/repo-dashboard.tsx) so users see one path-display idiom.
 */
function SandboxPathTag({ path }: { path: string | null }) {
  if (!path) return null;
  const lastSegment = path.split("/").filter(Boolean).pop() ?? path;
  return (
    <span
      className="text-muted-foreground hidden font-mono text-[11px] sm:inline"
      title={`Sandbox path: ${path}`}
    >
      :{lastSegment}
    </span>
  );
}

function SandboxIndicator({
  sandbox,
  creating,
}: {
  sandbox?: { id: string } | null;
  creating?: boolean;
}) {
  const sandboxRecord = useSandboxStore((s) => {
    if (!sandbox) return null;
    return s.getSandboxById(sandbox.id);
  });
  const sandboxUiState = resolveSandboxUiState({
    session: null,
    record: sandboxRecord,
  });

  if (creating) {
    const creatingState: SandboxUiState = {
      kind: "booting",
      sandboxId: sandbox?.id ?? "pending",
      phase: "creating",
    };
    return <SandboxChip state={creatingState} />;
  }

  return <SandboxChip state={sandboxUiState} />;
}

function PaneBadge({ status }: { status?: string }) {
  if (!status || status === "idle") return null;
  const isLive = status === "running" || status === "streaming";
  const isError = status === "error";
  return (
    <span
      className={`rounded-[3px] border px-2 py-0.5 font-mono text-[11px] ${
        isLive
          ? "text-accent-green border-accent-green/20 bg-accent-green/[0.06]"
          : isError
            ? "text-accent-red border-accent-red/20 bg-accent-red/[0.06]"
            : "text-muted-foreground border-border-dim bg-background"
      }`}
    >
      {status}
    </span>
  );
}

function AgentPane({
  pane,
  repoPath,
  activeRepo,
  activeSandbox,
  onStreamingChange,
}: {
  pane: PaneNode;
  repoPath?: string;
  activeRepo?:
    | (Pick<Repo, "id" | "full_name" | "root_directory" | "default_branch"> & {
        working_branch?: string | null;
      })
    | null;
  activeSandbox?: { id: string } | null;
  onStreamingChange?: (s: boolean) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const { asSlashCommands } = useCustomCommands();
  const { modelIds, contextLimits } = useModels();
  const [loaded, setLoaded] = useState(false);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const hydratedConversationRef = useRef<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);

  const conversation = useConversationsStore(
    useCallback((state) => state.conversations[pane.id], [pane.id])
  );
  const setUserId = useConversationsStore((state) => state.setUserId);
  const loadConversation = useConversationsStore(
    (state) => state.loadConversation
  );
  const hydrateConversation = useConversationsStore(
    (state) => state.hydrateConversation
  );
  const syncMessages = useConversationsStore((state) => state.setMessages);
  const syncConversation = useConversationsStore(
    (state) => state.syncToSupabase
  );
  const addLocalMsg = useConversationsStore((state) => state.addLocalMsg);
  const clearMessages = useConversationsStore((state) => state.clearMessages);
  const setModel = useConversationsStore((state) => state.setModel);
  const setMode = useConversationsStore((state) => state.setMode);
  const fetchConversationList = useConversationsStore(
    (state) => state.fetchConversationList
  );
  const conversationList = useConversationsStore(
    (state) => state.conversationList
  );
  const deleteConversation = useConversationsStore(
    (state) => state.deleteConversation
  );

  const storeDefaultModel = useConversationsStore(
    (state) => state.defaultModel
  );
  const setDefaultModel = useConversationsStore(
    (state) => state.setDefaultModel
  );
  const model = conversation?.model || storeDefaultModel;
  const mode = conversation?.mode || "AUTO";
  const builtinCommands = useMemo(
    () => buildBuiltinCommands({ models: modelIds, selectedModel: model }),
    [model, modelIds]
  );
  const localMsgs = conversation?.localMsgs ?? EMPTY_LOCAL_MESSAGES;
  const harnessState = useMemo(
    () => conversation?.harnessState ?? {},
    [conversation?.harnessState]
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoaded(false);
      setInitialMessages([]);

      try {
        const [authRes, settingsRes] = await Promise.all([
          fetch("/api/auth/user"),
          fetch("/api/settings"),
        ]);
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (settings.default_model) {
            setDefaultModel(settings.default_model);
          }
        }
        if (authRes.ok) {
          const { user } = await authRes.json();
          if (user?.id) {
            setUserId(user.id);
            await loadConversation(pane.id);
          }
        }
      } catch (error) {
        console.warn("Failed to load pane context", { paneId: pane.id, error });
      }

      if (cancelled) return;

      const storedConversation = useConversationsStore
        .getState()
        .getConversation(pane.id);
      setInitialMessages(storedConversation.messages);
      setLoaded(true);
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [loadConversation, pane.id, setDefaultModel, setUserId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => getActiveTeamRequestHeaders(),
      }),
    []
  );
  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport,
    id: pane.id,
    messages: initialMessages,
  });
  const { calls: conversationRuns } = useConversationRuns(pane.id);
  const [activeHarnessCallId, setActiveHarnessCallId] = useState<string | null>(
    null
  );
  const activeHarnessCallIdRef = useRef<string | null>(null);
  const liveConversationRuns = useMemo(
    () =>
      conversationRuns.filter(
        (run) => run.status === "pending" || run.status === "streaming"
      ),
    [conversationRuns]
  );
  const activeHarnessRun = useMemo(
    () =>
      liveConversationRuns.find(
        (run) =>
          run.type === "agent" &&
          (!activeHarnessCallId || run.id === activeHarnessCallId)
      ) ||
      liveConversationRuns.find((run) => run.type === "agent") ||
      null,
    [activeHarnessCallId, liveConversationRuns]
  );
  const activeCallId =
    activeHarnessRun?.id || liveConversationRuns[0]?.id || null;
  const { events: activeCallEvents } = useAiCallEvents(activeCallId);
  const [stopError, setStopError] = useState<string | null>(null);
  const [isHarnessRunning, setIsHarnessRunning] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    if (hydratedConversationRef.current === pane.id) return;

    const storedConversation = useConversationsStore
      .getState()
      .getConversation(pane.id);
    setMessages(storedConversation.messages);
    hydratedConversationRef.current = pane.id;
  }, [loaded, pane.id, setMessages]);

  useEffect(() => {
    if (!loaded) return;
    syncMessages(pane.id, messages);
  }, [loaded, messages, pane.id, syncMessages]);

  const isStreaming = status === "streaming" || status === "submitted";
  const isAgentRunning =
    isStreaming || isHarnessRunning || Boolean(activeHarnessRun);

  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (!loaded) return;

    if (wasStreamingRef.current && !isAgentRunning) {
      void syncConversation(pane.id);
      void useSandboxStore.getState().refresh();
    }

    wasStreamingRef.current = isAgentRunning;
  }, [isAgentRunning, loaded, pane.id, syncConversation]);

  const usedTokens = useMemo(() => {
    return messages.reduce((acc, m) => {
      const text =
        m.parts
          ?.filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          )
          .map((p) => p.text)
          .join("") || "";
      return acc + estimateTokens(text);
    }, 0);
  }, [messages]);

  const maxTokens = contextLimits[model] || 128000;
  const contextPct = Math.max(
    0,
    Math.round((1 - usedTokens / maxTokens) * 100)
  );

  useEffect(() => {
    onStreamingChange?.(isAgentRunning);
  }, [isAgentRunning, onStreamingChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveConversationRuns, localMsgs, activeCallEvents]);

  const harnessAbortRef = useRef<AbortController | null>(null);
  const updateLocalMsg = useConversationsStore((state) => state.updateLocalMsg);
  const setHarnessState = useConversationsStore(
    (state) => state.setHarnessState
  );
  const activeSessionId = useSessionsStore((state) => state.activeSessionId);

  const { launchRepoSandbox } = useSandboxLaunchActions();

  const executeHarnessRun = useCallback(
    async (input: string) => {
      const harnessId = model.replace("harness:", "") as
        | "claude-code"
        | "codex";

      const sessionsSnapshot = useSessionsStore.getState();
      const activeSession =
        sessionsSnapshot.sessions.find(
          (session) => session.id === sessionsSnapshot.activeSessionId
        ) ?? null;
      const currentSandboxRecord = activeSandbox?.id
        ? useSandboxStore.getState().getSandboxById(activeSandbox.id)
        : activeRepo?.id
          ? useSandboxStore.getState().getSandboxForRepo(activeRepo.id)
          : null;
      const currentSandboxState = resolveSandboxUiState({
        session: activeSession,
        record: currentSandboxRecord,
      });
      const sandboxUsable = Boolean(
        currentSandboxRecord && isSandboxUiRuntimeRunning(currentSandboxState)
      );
      let sandboxId = sandboxUsable ? activeSandbox?.id : undefined;
      const previousSandboxId =
        currentSandboxRecord?.id ?? activeSandbox?.id ?? null;

      if (!sandboxId) {
        if (!activeRepo?.id) {
          addLocalMsg(pane.id, {
            id: crypto.randomUUID(),
            text: "No repo selected. Open a workspace first.",
          });
          return;
        }
        addLocalMsg(pane.id, {
          id: crypto.randomUUID(),
          text: "Starting sandbox...",
        });
        const launchOutcome = await launchRepoSandbox(activeRepo, {
          source: "pane_content",
          trigger: "harness_auto_launch",
          intent: resolveSandboxLaunchIntentFromUiState(
            currentSandboxState,
            currentSandboxRecord?.id
          ),
        });
        if (launchOutcome.status === "cancelled") {
          addLocalMsg(pane.id, {
            id: crypto.randomUUID(),
            text: "Sandbox start cancelled.",
          });
          return;
        }
        if (launchOutcome.status !== "launched") {
          addLocalMsg(pane.id, {
            id: crypto.randomUUID(),
            text: "Sandbox failed to start. Check Settings for Vercel connection.",
          });
          return;
        }
        ensureSessionSandboxBinding(
          activeSessionId,
          previousSandboxId,
          launchOutcome.sandbox.id
        );
        // Re-check after launch
        sandboxId = launchOutcome.sandbox.id;
      }

      const initialResumeSessionId = getHarnessResumeSessionId(
        harnessState,
        harnessId,
        sandboxId ?? null
      );

      addLocalMsg(pane.id, { id: crypto.randomUUID(), text: `you: ${input}` });
      const outputMsgId = crypto.randomUUID();
      addLocalMsg(pane.id, { id: outputMsgId, text: "▸ running..." });

      const runHarnessAttempt = async (
        resumeSessionId: string | null,
        options?: { allowResumeRetry?: boolean; retryNotice?: string }
      ): Promise<void> => {
        const controller = new AbortController();
        harnessAbortRef.current = controller;
        setStopError(null);

        try {
          const prepareRes = await fetch(`/api/sandbox/${sandboxId}/harness`, {
            method: "POST",
            headers: getActiveTeamRequestHeaders({
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              harness: harnessId,
              prompt: input,
              conversationId: pane.id,
              workspaceSessionId: activeSessionId,
              resumeSessionId,
              mode,
              prepareOnly: true,
            }),
            signal: controller.signal,
          });
          const prepared = (await prepareRes.json().catch(() => ({}))) as {
            aiCallId?: string;
            error?: string;
          };
          if (!prepareRes.ok || !prepared.aiCallId) {
            updateLocalMsg(
              pane.id,
              outputMsgId,
              prepared.error || "Harness initialization failed"
            );
            return;
          }

          activeHarnessCallIdRef.current = prepared.aiCallId;
          setActiveHarnessCallId(prepared.aiCallId);

          const res = await fetch(`/api/sandbox/${sandboxId}/harness`, {
            method: "POST",
            headers: getActiveTeamRequestHeaders({
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              harness: harnessId,
              prompt: input,
              conversationId: pane.id,
              workspaceSessionId: activeSessionId,
              resumeSessionId,
              mode,
              aiCallId: prepared.aiCallId,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const errorText =
              typeof data.error === "string"
                ? data.error
                : "Harness request failed";

            if (
              options?.allowResumeRetry &&
              resumeSessionId &&
              isRecoverableHarnessResumeFailure(harnessId, errorText)
            ) {
              setHarnessState(
                pane.id,
                harnessId as "claude-code" | "codex",
                null
              );
              return runHarnessAttempt(null, {
                allowResumeRetry: false,
                retryNotice: buildHarnessResumeRetryNotice(harnessId),
              });
            }

            updateLocalMsg(pane.id, outputMsgId, errorText);
            return;
          }

          if (!res.body) {
            updateLocalMsg(pane.id, outputMsgId, "No response stream");
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const outputRenderer = createHarnessOutputRenderer(harnessId);
          let buffer = "";
          const preludeText = options?.retryNotice
            ? `${options.retryNotice}\n\n`
            : "";
          let output = preludeText;
          let installText = "";
          let trailerText = "";
          let renderedSegments: LocalMessageSegment[] = [];
          let toolCalls: LocalToolCall[] | undefined;
          let finalExitCode: number | null = null;
          let finalError: string | null = null;
          let wasCancelled = false;

          const buildSegments = (): LocalMessageSegment[] => {
            const segments: LocalMessageSegment[] = [];
            if (preludeText.trim()) {
              segments.push({ type: "text", text: preludeText.trim() });
            }
            if (installText.trim()) {
              segments.push({ type: "text", text: installText.trim() });
            }
            for (const segment of renderedSegments) {
              segments.push(
                segment.type === "text"
                  ? { type: "text", text: segment.text }
                  : { type: "tool-call", toolCall: { ...segment.toolCall } }
              );
            }
            if (trailerText.trim()) {
              segments.push({ type: "text", text: trailerText.trim() });
            }
            return segments;
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6)) as {
                  type: string;
                  stream?: string;
                  data?: string;
                  exitCode?: number | null;
                  error?: string | null;
                  failureCode?: string | null;
                  ai_call_id?: string;
                  sessionId?: string;
                };
                if (event.type === "run" && event.ai_call_id) {
                  activeHarnessCallIdRef.current = event.ai_call_id;
                  setActiveHarnessCallId(event.ai_call_id);
                } else if (event.type === "session" && event.sessionId) {
                  setHarnessState(
                    pane.id,
                    harnessId as "claude-code" | "codex",
                    {
                      sessionId: event.sessionId,
                      sandboxId: sandboxId ?? null,
                    }
                  );
                } else if (event.type === "install" && event.data) {
                  const chunk = `[installing...]\n${event.data}\n`;
                  installText += chunk;
                  output += chunk;
                } else if (event.type === "log" && event.data) {
                  const rendered = outputRenderer.push(
                    event.stream ?? "stdout",
                    event.data
                  );
                  output += rendered.text;
                  if (rendered.toolCalls) {
                    toolCalls = rendered.toolCalls;
                  }
                  if (rendered.segments) {
                    renderedSegments = rendered.segments;
                  }
                } else if (event.type === "cancelled") {
                  const rendered = outputRenderer.flush();
                  output += rendered.text;
                  if (rendered.toolCalls) {
                    toolCalls = rendered.toolCalls;
                  }
                  if (rendered.segments) {
                    renderedSegments = rendered.segments;
                  }
                  trailerText = trailerText
                    ? `${trailerText}\n[cancelled]`
                    : "[cancelled]";
                  output += "\n[cancelled]";
                  wasCancelled = true;
                  activeHarnessCallIdRef.current = null;
                  setActiveHarnessCallId(null);
                } else if (event.type === "done") {
                  const rendered = outputRenderer.flush();
                  output += rendered.text;
                  if (rendered.toolCalls) {
                    toolCalls = rendered.toolCalls;
                  }
                  if (rendered.segments) {
                    renderedSegments = rendered.segments;
                  }
                  finalExitCode = event.exitCode ?? null;
                  finalError = event.error ?? null;
                  const doneMarker = event.error
                    ? `[error: ${event.error}]`
                    : event.exitCode === 0
                      ? "[done]"
                      : `[exit ${event.exitCode ?? "unknown"}]`;
                  trailerText = trailerText
                    ? `${trailerText}\n${doneMarker}`
                    : doneMarker;
                  output += `\n${doneMarker}`;
                  activeHarnessCallIdRef.current = null;
                  setActiveHarnessCallId(null);
                } else if (event.type === "error") {
                  const rendered = outputRenderer.flush();
                  output += rendered.text;
                  if (rendered.toolCalls) {
                    toolCalls = rendered.toolCalls;
                  }
                  if (rendered.segments) {
                    renderedSegments = rendered.segments;
                  }
                  finalError = event.data ?? "[error]";
                  const errorMarker = event.data
                    ? `[error: ${event.data}]`
                    : "[error]";
                  trailerText = trailerText
                    ? `${trailerText}\n${errorMarker}`
                    : errorMarker;
                  output += `\n${errorMarker}`;
                  activeHarnessCallIdRef.current = null;
                  setActiveHarnessCallId(null);
                }
              } catch {
                // Skip malformed SSE chunks.
              }
            }

            updateLocalMsg(pane.id, outputMsgId, {
              text: output.trimEnd() || "▸ running...",
              toolCalls,
              segments: buildSegments(),
            });
          }

          const flushed = outputRenderer.flush();
          output += flushed.text;
          if (flushed.toolCalls) {
            toolCalls = flushed.toolCalls;
          }
          if (flushed.segments) {
            renderedSegments = flushed.segments;
          }

          const renderedOutput = output.trim() || "[no output]";
          const resumeFailureMessage = finalError
            ? `${renderedOutput}\n${finalError}`
            : renderedOutput;

          if (
            !wasCancelled &&
            options?.allowResumeRetry &&
            resumeSessionId &&
            (finalExitCode !== 0 || finalError !== null) &&
            isRecoverableHarnessResumeFailure(harnessId, resumeFailureMessage)
          ) {
            setHarnessState(
              pane.id,
              harnessId as "claude-code" | "codex",
              null
            );
            return runHarnessAttempt(null, {
              allowResumeRetry: false,
              retryNotice: buildHarnessResumeRetryNotice(harnessId),
            });
          }

          updateLocalMsg(pane.id, outputMsgId, {
            text: renderedOutput,
            toolCalls,
            segments: buildSegments(),
          });
          await syncConversation(pane.id);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            updateLocalMsg(pane.id, outputMsgId, {
              text: "[cancelled]",
              segments: undefined,
              toolCalls: undefined,
            });
            await syncConversation(pane.id);
            return;
          }
          const msg = err instanceof Error ? err.message : "Stream error";
          updateLocalMsg(pane.id, outputMsgId, {
            text: msg,
            segments: undefined,
            toolCalls: undefined,
          });
          await syncConversation(pane.id);
        } finally {
          harnessAbortRef.current = null;
        }
      };

      await runHarnessAttempt(initialResumeSessionId, {
        allowResumeRetry: Boolean(initialResumeSessionId),
      });
    },
    [
      activeRepo,
      activeSandbox?.id,
      activeSessionId,
      addLocalMsg,
      harnessState,
      launchRepoSandbox,
      mode,
      model,
      pane.id,
      setHarnessState,
      syncConversation,
      updateLocalMsg,
    ]
  );

  const submitToHarness = useCallback(
    async (input: string) => {
      setIsHarnessRunning(true);
      try {
        await executeHarnessRun(input);
      } finally {
        setIsHarnessRunning(false);
        activeHarnessCallIdRef.current = null;
        setActiveHarnessCallId(null);
      }
    },
    [executeHarnessRun]
  );

  const handleStopRun = useCallback(async () => {
    setStopError(null);

    const harnessCallId =
      activeHarnessCallIdRef.current ??
      activeHarnessCallId ??
      activeHarnessRun?.id;
    if (harnessCallId) {
      const res = await fetch(
        `/api/observability/calls/${harnessCallId}/cancel`,
        {
          method: "POST",
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error || "Failed to cancel harness run";
        setStopError(message);
        addLocalMsg(pane.id, { id: crypto.randomUUID(), text: message });
        return;
      }

      addLocalMsg(pane.id, {
        id: crypto.randomUUID(),
        text: "Harness cancellation requested...",
      });
      return;
    }

    if (isHarnessRunning) {
      harnessAbortRef.current?.abort();
      return;
    }

    stop();
  }, [
    activeHarnessCallId,
    activeHarnessRun?.id,
    addLocalMsg,
    isHarnessRunning,
    pane.id,
    stop,
  ]);

  const handleSubmit = useCallback(
    (input: string) => {
      if (isAgentRunning) return;

      const result = parseSlashCommand(
        input,
        builtinCommands,
        asSlashCommands(),
        {
          allowUnknown: model.startsWith("harness:"),
        }
      );
      if (result) {
        if (result.action === "set_model") {
          setModel(pane.id, result.payload as string);
          addLocalMsg(pane.id, {
            id: crypto.randomUUID(),
            text: `Model set to ${result.payload}`,
          });
        } else if (result.action === "set_mode") {
          const m = (result.payload as string).toUpperCase() as
            | "AUTO"
            | "YOLO"
            | "SAFE";
          setMode(pane.id, m);
          addLocalMsg(pane.id, {
            id: crypto.randomUUID(),
            text: `Mode set to ${m}`,
          });
        } else if (result.action === "clear") {
          setMessages([]);
          clearMessages(pane.id);
        } else if (result.action === "help") {
          const help = builtinCommands
            .map((c) => `/${c.name} - ${c.description}`)
            .join("\n");
          addLocalMsg(pane.id, { id: crypto.randomUUID(), text: help });
        } else if (
          result.action === "passthrough" &&
          model.startsWith("harness:")
        ) {
          void submitToHarness(input);
        }
        return;
      }

      if (model.startsWith("harness:")) {
        void submitToHarness(input);
        return;
      }

      sendMessage(
        { text: input },
        {
          body: buildChatRequestBody(
            model,
            activeRepo,
            activeSandbox,
            pane.id,
            activeSessionId
          ),
        }
      );
    },
    [
      activeRepo,
      activeSandbox,
      activeSessionId,
      addLocalMsg,
      asSlashCommands,
      builtinCommands,
      clearMessages,
      isAgentRunning,
      model,
      pane.id,
      sendMessage,
      setMessages,
      setMode,
      setModel,
      submitToHarness,
    ]
  );

  // Consume preview feedback and auto-send to agent
  const pendingFeedback = usePreviewFeedbackStore((s) => s.pending);
  const consumeFeedback = usePreviewFeedbackStore((s) => s.consume);

  useEffect(() => {
    if (!pendingFeedback || !loaded) return;
    const feedback = consumeFeedback();
    if (feedback) {
      handleSubmit(feedback.text);
    }
  }, [pendingFeedback, loaded, consumeFeedback, handleSubmit]);

  const getText = (msg: { parts?: Array<{ type: string; text?: string }> }) => {
    if (!msg.parts) return "";
    return msg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  };

  const handleNewChat = useCallback(() => {
    setMessages([]);
    clearMessages(pane.id);
    setShowHistory(false);
  }, [clearMessages, pane.id, setMessages]);

  const handleResumeConversation = useCallback(
    async (convId: string) => {
      await loadConversation(convId);
      const conv = useConversationsStore.getState().getConversation(convId);
      hydrateConversation(pane.id, {
        messages: conv.messages,
        localMsgs: conv.localMsgs,
        harnessState: conv.harnessState,
        model: conv.model,
        mode: conv.mode,
        title: conv.title,
      });
      setInitialMessages(conv.messages);
      setMessages(conv.messages);
      setShowHistory(false);
    },
    [hydrateConversation, loadConversation, pane.id, setMessages]
  );

  const handleToggleHistory = useCallback(() => {
    if (!showHistory) {
      void fetchConversationList();
    }
    setShowHistory((v) => !v);
  }, [showHistory, fetchConversationList]);

  // Filter out current pane and empty conversations
  const historyItems = conversationList.filter(
    (c) => c.id !== pane.id && c.updated_at
  );

  return (
    <>
      <div className="border-border-dim flex h-8 items-center gap-1 border-b px-2">
        <button
          onClick={handleToggleHistory}
          className={`rounded px-2 py-0.5 text-[11px] transition-colors ${showHistory ? "bg-muted text-foreground" : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted"}`}
        >
          History
        </button>
        <button
          onClick={handleNewChat}
          className="text-muted-foreground hover:text-secondary-foreground hover:bg-muted rounded px-2 py-0.5 text-[11px] transition-colors"
        >
          New chat
        </button>
        {isAgentRunning && (
          <button
            onClick={() => void handleStopRun()}
            className="rounded px-2 py-0.5 text-[11px] text-accent-red transition-colors hover:bg-accent-red/10"
          >
            Stop
          </button>
        )}
        {stopError && (
          <span className="max-w-[220px] truncate text-[11px] text-accent-red">
            {stopError}
          </span>
        )}
        {(status === "streaming" || status === "submitted") && (
          <span className="ml-auto">
            <AsciiLoader
              variant={status === "streaming" ? undefined : "bars"}
            />
          </span>
        )}
      </div>
      {showHistory ? (
        <div className="flex-1 space-y-1 overflow-auto p-2">
          {historyItems.length === 0 && (
            <div className="text-muted-foreground py-8 text-center">
              No past conversations
            </div>
          )}
          {historyItems.map((c) => (
            <div
              key={c.id}
              className="hover:bg-muted group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
              onClick={() => handleResumeConversation(c.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="text-secondary-foreground truncate text-sm">
                  {c.title || c.id.slice(0, 12)}
                </div>
                <div className="text-muted-foreground flex gap-2 text-[11px]">
                  <span>{c.model.split("/").pop()}</span>
                  <span>{timeAgo(c.updated_at)}</span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteConversation(c.id);
                }}
                className="text-muted-foreground hover:text-accent-red flex h-5 w-5 items-center justify-center rounded text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-auto p-2 leading-relaxed">
            {localMsgs.map((m) => (
              <LocalMessage key={m.id} message={m} />
            ))}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "text-secondary-foreground"
                    : "text-foreground"
                }
              >
                {m.role === "user" ? (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0 select-none">
                      you
                    </span>
                    <span className="whitespace-pre-wrap">{getText(m)}</span>
                  </div>
                ) : (
                  <MessageContent message={m} />
                )}
              </div>
            ))}
            {liveConversationRuns.map((run) => (
              <div
                key={run.id}
                className="border-border text-muted-foreground rounded border px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${run.status === "streaming" ? "animate-pulse bg-accent-blue" : "bg-accent-amber"}`}
                  />
                  <span className="tracking-wide uppercase">{run.type}</span>
                  <span>{run.status}</span>
                  <span className="ml-auto font-mono">
                    {run.id.slice(0, 8)}
                  </span>
                </div>
              </div>
            ))}
            {activeCallEvents.length > 0 && (
              <div className="border-border-dim bg-background/60 space-y-1.5 rounded border px-2 py-2">
                <div className="text-muted-foreground text-[11px] tracking-wide uppercase">
                  Live timeline
                </div>
                {activeCallEvents.slice(-6).map((event) => (
                  <div
                    key={event.id}
                    className="text-muted-foreground text-[11px]"
                  >
                    <span className="text-secondary-foreground">
                      {event.event_type.replaceAll("_", " ")}
                    </span>
                    {event.tool_name ? ` · ${event.tool_name}` : ""}
                    {event.message ? ` · ${event.message}` : ""}
                  </div>
                ))}
              </div>
            )}
            {isAgentRunning && (
              <div className="py-2">
                <AsciiLoader />
              </div>
            )}
            <div ref={endRef} />
          </div>
          <CommandInput
            onSubmit={handleSubmit}
            isRunning={isAgentRunning}
            runningLabel={
              model.startsWith("harness:")
                ? `${model === "harness:claude-code" ? "Claude Code" : "Codex"} is working`
                : "Agent is working"
            }
            onStop={() => void handleStopRun()}
            builtinCommands={builtinCommands}
            customCommands={asSlashCommands()}
            models={modelIds}
            mode={mode}
            contextPct={contextPct}
            repoPath={repoPath}
            repoId={activeRepo?.id}
            model={model}
            onModelSelect={(m) => setModel(pane.id, m)}
          />
        </>
      )}
    </>
  );
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function LocalMessage({ message }: { message: ConversationLocalMessage }) {
  const detectedPatch = useMemo(
    () => detectPatch(message.text),
    [message.text]
  );
  const hasToolCallSegment =
    message.segments?.some((s) => s.type === "tool-call") ?? false;
  const hasToolCalls =
    hasToolCallSegment || (message.toolCalls?.length ?? 0) > 0;

  if (detectedPatch && !hasToolCalls) {
    return <PatchViewer detectedPatch={detectedPatch} />;
  }

  if (message.segments && message.segments.length > 0) {
    return (
      <div className="space-y-2">
        {message.segments.map((segment, index) =>
          segment.type === "text" ? (
            <div
              key={`text-${index}`}
              className="text-foreground whitespace-pre-wrap"
            >
              {segment.text}
            </div>
          ) : (
            <LocalToolCalls
              key={`tool-${segment.toolCall.id}`}
              toolCalls={[segment.toolCall]}
            />
          )
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.text ? (
        <div className="text-foreground whitespace-pre-wrap">
          {message.text}
        </div>
      ) : null}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <LocalToolCalls toolCalls={message.toolCalls} />
      ) : null}
    </div>
  );
}

function LocalToolCalls({ toolCalls }: { toolCalls: LocalToolCall[] }) {
  return (
    <Accordion
      type="multiple"
      className="border-border-dim bg-background/40 rounded border px-2"
    >
      {toolCalls.map((toolCall) => (
        <AccordionItem
          key={toolCall.id}
          value={toolCall.id}
          className="border-border-dim"
        >
          <AccordionTrigger className="py-2 text-[11px] hover:no-underline">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-accent-blue font-mono">
                {toolCall.name}
              </span>
              <ToolCallStateBadge state={toolCall.state} />
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pb-2">
            {toolCall.input !== undefined ? (
              <div>
                <div className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
                  Input
                </div>
                <StructuredValueViewer
                  value={toolCall.input}
                  className="my-0"
                  stringLanguage="language-json"
                />
              </div>
            ) : null}
            {toolCall.output !== undefined ? (
              <div>
                <div className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
                  Output
                </div>
                <StructuredValueViewer
                  value={toolCall.output}
                  className="my-0"
                  stringLanguage="language-json"
                />
              </div>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ToolCallStateBadge({ state }: { state: LocalToolCall["state"] }) {
  const className =
    state === "done"
      ? "text-accent-green border-accent-green/20 bg-accent-green/[0.06]"
      : state === "denied" || state === "error"
        ? "text-accent-red border-accent-red/20 bg-accent-red/[0.06]"
        : "text-accent-amber border-accent-amber/20 bg-accent-amber/[0.06]";

  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${className}`}
    >
      {state}
    </span>
  );
}

function ToolsPane() {
  const { calls } = useLiveInteractiveCalls();
  const activeCall = calls[0] || null;
  const { events } = useAiCallEvents(activeCall?.id || null);
  return (
    <div className="flex-1 space-y-1 overflow-auto p-2">
      {!activeCall && (
        <div className="text-muted-foreground">No active interactive runs</div>
      )}
      {activeCall && (
        <div className="border-border rounded-md border">
          <div className="bg-secondary flex items-center gap-2 rounded-t-md px-2 py-1.5">
            <span className="text-accent-blue">{activeCall.type}</span>
            <span className="text-muted-foreground text-[11px]">
              {activeCall.model}
            </span>
            <span className="text-muted-foreground ml-auto text-[11px]">
              {timeAgo(activeCall.started_at)}
            </span>
          </div>
          <div className="space-y-2 p-2 text-[11px]">
            {events.length === 0 && (
              <div className="text-muted-foreground">
                Waiting for run events...
              </div>
            )}
            {events.map((event) => (
              <div
                key={event.id}
                className="border-border-dim space-y-1 rounded border px-2 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-secondary-foreground">
                    {event.event_type.replaceAll("_", " ")}
                  </span>
                  {event.tool_name && (
                    <span className="text-accent-blue">{event.tool_name}</span>
                  )}
                  <span className="text-muted-foreground ml-auto">
                    {timeAgo(event.created_at)}
                  </span>
                </div>
                {event.message && (
                  <div className="text-muted-foreground">{event.message}</div>
                )}
                {event.payload && Object.keys(event.payload).length > 0 && (
                  <StructuredValueViewer
                    value={event.payload}
                    className="my-0"
                    stringLanguage="language-json"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ContextSection = dynamic(
  () =>
    import("@/components/library/context-section").then(
      (m) => m.ContextSection
    ),
  { ssr: false }
);

class PaneErrorBoundary extends Component<
  { children: ReactNode; paneName: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[PaneError] ${this.props.paneName}:`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-muted-foreground text-sm">Pane crashed</div>
          <div className="text-muted-foreground/70 max-w-xs font-mono text-[11px] break-all">
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function MemoriesPane({
  repoId,
  repoName,
  workspaceSessionId,
}: {
  repoId?: string | null;
  repoName?: string | null;
  workspaceSessionId?: string | null;
}) {
  return (
    <ContextSection
      compact
      repoId={repoId}
      repoName={repoName}
      workspaceSessionId={workspaceSessionId}
    />
  );
}

const CREATING_MESSAGES: Record<string, string> = {
  preview: "Starting live preview...",
  files: "Preparing project files...",
  terminal: "Connecting terminal...",
  editor: "Loading code editor...",
};

function SandboxPendingOverlay({
  creating,
  error,
  paneType,
}: {
  creating?: boolean;
  error?: SandboxError | null;
  paneType: string;
}) {
  if (error) {
    const errorState = presentSandboxError(error);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="text-accent-red h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">
            {errorState?.title || "Sandbox launch failed"}
          </div>
          <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
            {errorState?.message || error.message}
          </div>
        </div>
        {errorState?.cta && (
          <a
            href={errorState.cta.href}
            className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
          >
            {errorState.cta.label}
          </a>
        )}
      </div>
    );
  }

  if (creating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AsciiLoader />
        <span className="text-muted-foreground text-sm">
          {CREATING_MESSAGES[paneType] || "Starting sandbox..."}
        </span>
      </div>
    );
  }

  return null;
}

export function PaneContent({
  pane,
  active,
  onSelect,
  onUpdatePane,
  onUpdateTerminalSession,
  terminalSessions,
  activeRepo,
  activeSandbox,
  sandboxCreating,
  sandboxError,
  onOpenFile,
  onRetargetFilePath,
  onClearFilePath,
  onSplit,
  onClose,
  onPopOutIDE,
}: Props) {
  const [streaming, setStreaming] = useState(false);
  const borderClass = streaming || active ? "ring-1 ring-border" : "";
  const isMobile = useIsMobile();
  const {
    setNodeRef: setDragHandleRef,
    listeners: dragListeners,
    attributes: dragAttributes,
    isDragging,
  } = useDraggable({ id: pane.id, disabled: isMobile });
  const pendingSandboxBranch = useSessionsStore((state) => {
    const session =
      state.sessions.find((sess) => sess.id === state.activeSessionId) ||
      state.sessions[0];
    return session?.pendingSandboxBranch ?? null;
  });
  const currentWorkspaceSessionId = useSessionsStore(
    (state) => state.activeSessionId
  );
  const resolvedSandboxId = resolvePaneSandboxId(pane, activeSandbox?.id);
  const splitSandboxOverrides = buildSplitSandboxOverrides(
    pane,
    resolvedSandboxId
  );
  const resolvedSandboxRecord = useSandboxStore((s) =>
    resolvedSandboxId ? s.getSandboxById(resolvedSandboxId) : null
  );
  const resolvedSandbox = resolvedSandboxId ? { id: resolvedSandboxId } : null;
  const resolvedPreviewUrl = resolvePreviewPaneUrl(pane, resolvedSandboxRecord);
  // Prefer the running sandbox's launch-time path over the repo's
  // persistent default. Otherwise the agent / files panel / editor
  // hint silently lie when the sandbox was launched at a workspace
  // different from `repos.root_directory`. Same three-way contract
  // as `loadOwnedSandboxRouteContext` server-side.
  const effectivePathForActiveSandbox = resolveSandboxRootDirectory(
    resolvedSandboxRecord,
    activeRepo
  );
  // Guard against transient hydration windows where a sandbox record
  // (with a non-null root_directory) is already in the store but
  // activeRepo hasn't loaded yet — the template would otherwise render
  // "undefined:apps/web" in the chat composer footer.
  const repoPath = !activeRepo?.full_name
    ? undefined
    : effectivePathForActiveSandbox
      ? `${activeRepo.full_name}:${effectivePathForActiveSandbox}`
      : activeRepo.full_name;
  const currentTerminalSessionKey =
    pane.type === "terminal" ? getTerminalSessionKey(pane) : null;
  const currentTerminalSession = useMemo(
    () =>
      currentTerminalSessionKey
        ? (terminalSessions?.find(
            (session) =>
              session.terminalSessionKey === currentTerminalSessionKey
          ) ?? null)
        : null,
    [currentTerminalSessionKey, terminalSessions]
  );
  const otherTerminalSessions = useMemo(
    () =>
      (terminalSessions ?? []).filter(
        (session) => session.terminalSessionKey !== currentTerminalSessionKey
      ),
    [currentTerminalSessionKey, terminalSessions]
  );

  const attachTerminalSession = useCallback(
    (dir: "horizontal" | "vertical", session: TerminalSessionSummary) => {
      if (!onSplit) return;
      onSplit(dir, "terminal", {
        name: session.name,
        terminalSessionKey: session.terminalSessionKey,
        sandboxBinding: session.sandboxBinding,
        sandboxId:
          session.sandboxBinding === "pinned" ? session.sandboxId : undefined,
      });
    },
    [onSplit]
  );

  const renameTerminalSession = useCallback(() => {
    if (!currentTerminalSession || !onUpdateTerminalSession) return;
    const nextName = window.prompt(
      "Rename terminal session",
      currentTerminalSession.name
    );
    const trimmed = nextName?.trim();
    if (!trimmed || trimmed === currentTerminalSession.name) return;
    onUpdateTerminalSession(currentTerminalSession.terminalSessionKey, {
      name: trimmed.slice(0, 80),
    });
  }, [currentTerminalSession, onUpdateTerminalSession]);

  const resetTerminalSession = useCallback(async () => {
    if (
      !currentTerminalSession ||
      !resolvedSandboxId ||
      !onUpdateTerminalSession
    )
      return;
    const confirmed = window.confirm(
      `Reset terminal session "${currentTerminalSession.name}"?`
    );
    if (!confirmed) return;

    const response = await fetch(
      `/api/sandbox/${resolvedSandboxId}/terminal/session`,
      {
        method: "POST",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          action: "kill",
          terminalSessionKey: currentTerminalSession.terminalSessionKey,
        }),
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      window.alert(payload?.error || "Failed to reset terminal session");
      return;
    }

    onUpdateTerminalSession(currentTerminalSession.terminalSessionKey, {
      terminalSessionKey: createTerminalSessionKey(),
    });
  }, [currentTerminalSession, onUpdateTerminalSession, resolvedSandboxId]);

  return (
    <div
      onClick={onSelect}
      data-testid={`pane-${pane.id}`}
      data-pane-type={pane.type}
      className={`bg-card relative flex h-full flex-col overflow-hidden rounded-md text-[13px] ${borderClass} ${isDragging ? "opacity-50" : ""}`}
      style={{ animation: "pane-enter 0.2s ease-out" }}
    >
      <PaneDropZones paneId={pane.id} />
      <div className="bg-secondary border-border-dim flex h-10 items-center gap-2.5 border-b px-3">
        {!isMobile && (
          <button
            ref={setDragHandleRef}
            {...dragListeners}
            {...dragAttributes}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Drag ${pane.name}`}
            title="Drag to reorder"
            className="text-muted-foreground hover:text-secondary-foreground -ml-1 flex h-6 w-5 cursor-grab items-center justify-center active:cursor-grabbing"
          >
            <DragSolid className="size-3.5" />
          </button>
        )}
        <span className="text-muted-foreground text-sm">
          {PANE_ICONS[pane.type] || "◻"}
        </span>
        <span className="text-secondary-foreground flex-1 text-[13px] font-medium">
          {pane.name}
        </span>
        {(pane.type === "agent" || pane.type === "preview") && (
          <>
            <SandboxPathTag path={effectivePathForActiveSandbox} />
            <SandboxIndicator
              sandbox={resolvedSandbox}
              creating={sandboxCreating}
            />
          </>
        )}
        <PaneBadge status={pane.status} />
        <div className="flex items-center gap-1">
          {onSplit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`pane-add-${pane.id}`}
                  className="text-muted-foreground hover:bg-muted hover:text-secondary-foreground flex h-6 w-6 items-center justify-center rounded-[4px] text-sm"
                  title={
                    pane.type === "terminal"
                      ? "Pane and session actions"
                      : "Add pane"
                  }
                >
                  <Plus className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {pane.type === "terminal" && currentTerminalSession && (
                  <>
                    <DropdownMenuLabel className="text-[11px] tracking-wider uppercase">
                      Session
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() =>
                        attachTerminalSession(
                          "horizontal",
                          currentTerminalSession
                        )
                      }
                      className="gap-2 text-[13px]"
                    >
                      <span className="text-muted-foreground w-4 text-center">
                        <TerminalIcon className="size-3.5" />
                      </span>
                      Attach Right
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        attachTerminalSession(
                          "vertical",
                          currentTerminalSession
                        )
                      }
                      className="gap-2 text-[13px]"
                    >
                      <span className="text-muted-foreground w-4 text-center">
                        <TerminalIcon className="size-3.5" />
                      </span>
                      Attach Below
                    </DropdownMenuItem>
                    {otherTerminalSessions.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2 text-[13px]">
                          <span className="text-muted-foreground w-4 text-center">
                            <ListSelect className="size-3.5" />
                          </span>
                          Attach Existing
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                          {otherTerminalSessions.map((session) => (
                            <DropdownMenuItem
                              key={session.terminalSessionKey}
                              onSelect={() =>
                                attachTerminalSession("horizontal", session)
                              }
                              className="flex items-center gap-2 text-[13px]"
                            >
                              <span className="truncate">{session.name}</span>
                              <span className="text-muted-foreground ml-auto text-[11px]">
                                {session.paneIds.length} pane
                                {session.paneIds.length === 1 ? "" : "s"}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuItem
                      onSelect={renameTerminalSession}
                      className="gap-2 text-[13px]"
                    >
                      <span className="text-muted-foreground w-4 text-center">
                        <EditPencil className="size-3.5" />
                      </span>
                      Rename Session
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        void resetTerminalSession();
                      }}
                      className="gap-2 text-[13px] text-red-500 focus:text-red-500"
                    >
                      <span className="w-4 text-center text-red-500">
                        <Xmark className="size-3.5" />
                      </span>
                      Reset Session
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {PANE_TYPE_GROUPS.map((group, gi) => (
                  <div key={group.label}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[11px] tracking-wider uppercase">
                      {group.label}
                    </DropdownMenuLabel>
                    {group.items.map((item) => (
                      <DropdownMenuItem
                        key={item.type}
                        onSelect={() =>
                          onSplit(
                            "horizontal",
                            item.type,
                            splitSandboxOverrides
                          )
                        }
                        className="gap-2 text-[13px]"
                      >
                        <span className="text-muted-foreground w-4 text-center">
                          {item.icon}
                        </span>
                        {item.name}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] tracking-wider uppercase">
                  Split below
                </DropdownMenuLabel>
                {PANE_TYPE_GROUPS.flatMap((group) => group.items).map(
                  (item) => (
                    <DropdownMenuItem
                      key={`v-${item.type}`}
                      onSelect={() =>
                        onSplit("vertical", item.type, splitSandboxOverrides)
                      }
                      className="gap-2 text-[13px]"
                    >
                      <span className="text-muted-foreground w-4 text-center">
                        {item.icon}
                      </span>
                      {item.name}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              data-testid={`pane-close-${pane.id}`}
              className="text-muted-foreground hover:bg-muted hover:text-secondary-foreground flex h-6 w-6 items-center justify-center rounded-[4px] text-sm"
              title="Close pane"
            >
              <Xmark className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <PaneErrorBoundary paneName={pane.name}>
        {pane.type === "home" && <HomePane />}
        {pane.type === "agent" && (
          <AgentPane
            pane={pane}
            repoPath={repoPath}
            activeRepo={activeRepo}
            activeSandbox={resolvedSandbox}
            onStreamingChange={setStreaming}
          />
        )}
        {pane.type === "terminal" && (
          <div className="flex-1 overflow-hidden">
            <XTermPane
              paneId={pane.id}
              sandboxId={resolvedSandboxId}
              repoId={activeRepo?.id}
              workingBranch={!resolvedSandboxId ? pendingSandboxBranch : null}
              terminalSessionKey={pane.terminalSessionKey ?? pane.id}
            />
          </div>
        )}
        {pane.type === "editor" &&
          (pane.filePath ? (
            <div className="flex-1 overflow-hidden">
              <MonacoPane
                language="typescript"
                sandboxId={resolvedSandboxId}
                filePath={pane.filePath}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center">
              {!resolvedSandboxId && (sandboxCreating || sandboxError) ? (
                <SandboxPendingOverlay
                  creating={sandboxCreating}
                  error={sandboxError}
                  paneType="editor"
                />
              ) : (
                <span className="text-muted-foreground text-sm">
                  Open a file from Project Files
                  {effectivePathForActiveSandbox
                    ? ` under ${effectivePathForActiveSandbox}`
                    : ""}{" "}
                  to start editing.
                </span>
              )}
            </div>
          ))}
        {pane.type === "tools" && <ToolsPane />}
        {pane.type === "stats" && <ObservabilityPane />}
        {pane.type === "memories" && (
          <MemoriesPane
            repoId={activeRepo?.id ?? null}
            repoName={activeRepo?.full_name ?? null}
            workspaceSessionId={currentWorkspaceSessionId}
          />
        )}
        {pane.type === "rules" && <FileManagerPane type="rules" />}
        {pane.type === "skills" && <SkillsPane />}
        {pane.type === "files" && resolvedSandboxId && (
          <div className="flex-1 overflow-hidden">
            <FileTreePane
              sandboxId={resolvedSandboxId}
              rootLabel={effectivePathForActiveSandbox || "/"}
              onOpenFile={(filePath) =>
                onOpenFile?.(filePath, resolvedSandboxId)
              }
              onRetargetFilePath={onRetargetFilePath}
              onClearFilePath={onClearFilePath}
            />
          </div>
        )}
        {pane.type === "files" && !resolvedSandboxId && (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <SandboxPendingOverlay
              creating={sandboxCreating}
              error={sandboxError}
              paneType="files"
            />
            {!sandboxCreating && !sandboxError && (
              <span className="text-muted-foreground text-sm">
                Start Preview for the selected repo to browse project files.
              </span>
            )}
          </div>
        )}
        {pane.type === "preview" && (
          <div className="flex-1 overflow-hidden">
            <PreviewPane
              previewUrl={resolvedPreviewUrl}
              sandboxRecordId={resolvedSandboxId}
              sandboxCreating={sandboxCreating}
              sandboxError={sandboxError}
              sandboxId={resolvedSandboxId}
              workingBranch={!resolvedSandboxId ? pendingSandboxBranch : null}
              rootLabel={effectivePathForActiveSandbox || undefined}
              activeRepo={activeRepo}
              initialTab={pane.previewTab}
              activeFilePath={pane.filePath ?? null}
              onActiveFileChange={(filePath) =>
                onUpdatePane?.({ filePath: filePath ?? undefined })
              }
              onRetargetFilePath={onRetargetFilePath}
              onClearFilePath={onClearFilePath}
              onTabChange={(tab) => onUpdatePane?.({ previewTab: tab })}
              onPopOut={onPopOutIDE}
            />
          </div>
        )}
        {pane.type === "roster" && <AgentRosterPane />}
        {pane.type === "output" && <OutputPane />}
        {pane.type === "cron" && <CronPane />}
        {pane.type === "diff" && <DiffPane />}
        {pane.type === "triggers" && <FlowsPane />}
        {pane.type === "connections" && <ConnectionsPane />}
      </PaneErrorBoundary>
    </div>
  );
}
