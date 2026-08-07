"use client";
import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import type { PaneNode } from "@/hooks/use-split-panes";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useSessionsStore } from "@/hooks/use-sessions";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import {
  useAiCallEvents,
  useConversationRuns,
} from "@/hooks/use-observability";
import { useCustomCommands } from "@/hooks/use-custom-commands";
import { useConversationsStore } from "@/hooks/use-conversations";
import { CommandInput } from "@/components/command-input";
import { parseSlashCommand, buildBuiltinCommands } from "@/lib/slash-commands";
import { useModels } from "@/hooks/use-models";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { usePreviewFeedbackStore } from "@/hooks/use-preview-feedback";
import { buildChatRequestBody } from "@/lib/agents/chat-request-body";
import type { Repo } from "@/lib/types";
import { useHarnessRun } from "./use-harness-run";
import { EMPTY_LOCAL_MESSAGES, estimateTokens } from "../utils";
import { AgentHeader } from "./agent-header";
import { ConversationHistory } from "./conversation-history";
import { ChatMessageList } from "./chat-message-list";

interface AgentPaneProps {
  pane: PaneNode;
  repoPath?: string;
  activeRepo?:
    | (Pick<Repo, "id" | "full_name" | "root_directory" | "default_branch"> & {
        working_branch?: string | null;
      })
    | null;
  activeSandbox?: { id: string } | null;
  onStreamingChange?: (s: boolean) => void;
}

export function AgentPane({
  pane,
  repoPath,
  activeRepo,
  activeSandbox,
  onStreamingChange,
}: AgentPaneProps) {
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
  const liveConversationRuns = useMemo(
    () =>
      conversationRuns.filter(
        (run) => run.status === "pending" || run.status === "streaming"
      ),
    [conversationRuns]
  );

  const {
    isHarnessRunning,
    activeHarnessCallId,
    activeHarnessCallIdRef,
    stopError,
    setStopError,
    submitToHarness,
    abortHarnessRun,
  } = useHarnessRun({
    paneId: pane.id,
    model,
    mode,
    activeRepo,
    activeSandboxId: activeSandbox?.id,
  });

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
      abortHarnessRun();
      return;
    }

    stop();
  }, [
    activeHarnessCallId,
    activeHarnessCallIdRef,
    activeHarnessRun?.id,
    addLocalMsg,
    isHarnessRunning,
    pane.id,
    setStopError,
    stop,
    abortHarnessRun,
  ]);

  const activeSessionId = useSessionsStore((state) => state.activeSessionId);

  const handleSubmit = useCallback(
    (input: string) => {
      if (isAgentRunning) return;

      const result = parseSlashCommand(
        input,
        builtinCommands,
        asSlashCommands(),
        { allowUnknown: model.startsWith("harness:") }
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
      <AgentHeader
        showHistory={showHistory}
        isAgentRunning={isAgentRunning}
        status={status}
        stopError={stopError}
        onToggleHistory={handleToggleHistory}
        onNewChat={handleNewChat}
        onStopRun={() => void handleStopRun()}
      />
      {showHistory ? (
        <ConversationHistory
          items={historyItems}
          onResumeConversation={(id) => void handleResumeConversation(id)}
          onDeleteConversation={(id) => void deleteConversation(id)}
        />
      ) : (
        <>
          <ChatMessageList
            endRef={endRef}
            localMsgs={localMsgs}
            messages={messages}
            liveConversationRuns={liveConversationRuns}
            activeCallEvents={activeCallEvents}
            isAgentRunning={isAgentRunning}
          />
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
