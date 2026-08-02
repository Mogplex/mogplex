"use client";
import { create } from "zustand";
import type { UIMessage } from "ai";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";

type Message = UIMessage;
type HarnessId = "claude-code" | "codex";

export type LocalToolCallState = "running" | "done" | "error" | "denied";

export type LocalToolCall = {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  state: LocalToolCallState;
};

export type LocalMessageSegment =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCall: LocalToolCall };

export type LocalMessage = {
  id: string;
  text: string;
  toolCalls?: LocalToolCall[];
  segments?: LocalMessageSegment[];
};

type HarnessSessionState = {
  sessionId: string;
  sandboxId?: string | null;
};

type HarnessState = Partial<Record<HarnessId, HarnessSessionState>>;

type ConversationState = {
  messages: Message[];
  localMsgs: LocalMessage[];
  harnessState: HarnessState;
  model: string;
  mode: "AUTO" | "YOLO" | "SAFE";
  title?: string;
  updatedAt?: string | null;
};

export type ConversationListItem = {
  id: string;
  model: string;
  mode: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type ConversationsStore = {
  conversations: Record<string, ConversationState>;
  conversationList: ConversationListItem[];
  userId: string | null;
  defaultModel: string;
  setUserId: (id: string | null) => void;
  setDefaultModel: (model: string) => void;
  getConversation: (paneId: string) => ConversationState;
  loadConversation: (paneId: string) => Promise<void>;
  hydrateConversation: (
    paneId: string,
    payload: Partial<ConversationState>
  ) => void;
  setMessages: (paneId: string, messages: Message[]) => void;
  addLocalMsg: (paneId: string, msg: LocalMessage) => void;
  updateLocalMsg: (
    paneId: string,
    msgId: string,
    update: string | Partial<LocalMessage>
  ) => void;
  retargetHarnessSandboxIds: (
    paneIds: string[],
    previousSandboxId: string,
    nextSandboxId: string | null
  ) => void;
  setHarnessState: (
    paneId: string,
    harnessId: HarnessId,
    session: HarnessSessionState | null
  ) => void;
  removeLocalMsg: (paneId: string, msgId: string) => void;
  clearMessages: (paneId: string) => void;
  setModel: (paneId: string, model: string) => void;
  setMode: (paneId: string, mode: "AUTO" | "YOLO" | "SAFE") => void;
  removeConversation: (paneId: string) => void;
  syncToSupabase: (paneId: string) => Promise<void>;
  fetchConversationList: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
};

const defaultState = (model: string): ConversationState => ({
  messages: [],
  localMsgs: [],
  harnessState: {},
  model,
  mode: "AUTO",
  updatedAt: null,
});

const syncChains = new Map<string, Promise<void>>();

async function queueConversationSync(
  paneId: string,
  task: () => Promise<void>
) {
  const previous = syncChains.get(paneId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);

  syncChains.set(paneId, next);

  try {
    await next;
  } finally {
    if (syncChains.get(paneId) === next) {
      syncChains.delete(paneId);
    }
  }
}

function messagesEqual(a: Message[], b: Message[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function extractTitle(messages: Message[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.parts) return undefined;
  const text = firstUser.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function normalizeLocalToolCall(value: unknown): LocalToolCall | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string")
    return null;

  const { state } = record;
  const normalizedState: LocalToolCallState =
    state === "done" || state === "error" || state === "denied"
      ? state
      : "running";

  return {
    id: record.id,
    name: record.name,
    input: record.input,
    output: record.output,
    state: normalizedState,
  };
}

function normalizeLocalMessageSegment(
  value: unknown
): LocalMessageSegment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type === "text") {
    return {
      type: "text",
      text: typeof record.text === "string" ? record.text : "",
    };
  }
  if (record.type === "tool-call") {
    const toolCall = normalizeLocalToolCall(record.toolCall);
    if (!toolCall) return null;
    return { type: "tool-call", toolCall };
  }
  return null;
}

function normalizeLocalMessage(value: unknown): LocalMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;

  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls
        .map(normalizeLocalToolCall)
        .filter((toolCall): toolCall is LocalToolCall => toolCall !== null)
    : undefined;

  const segments = Array.isArray(record.segments)
    ? record.segments
        .map(normalizeLocalMessageSegment)
        .filter((segment): segment is LocalMessageSegment => segment !== null)
    : undefined;

  return {
    id: record.id,
    text: typeof record.text === "string" ? record.text : "",
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(segments && segments.length > 0 ? { segments } : {}),
  };
}

function normalizeLocalMessages(value: unknown): LocalMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map(normalizeLocalMessage)
    .filter((message): message is LocalMessage => message !== null);
}

function normalizeHarnessSessionState(
  value: unknown
): HarnessSessionState | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim())
    return null;

  return {
    sessionId: record.sessionId.trim(),
    sandboxId:
      typeof record.sandboxId === "string"
        ? record.sandboxId.trim() || null
        : null,
  };
}

function normalizeHarnessState(value: unknown): HarnessState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: HarnessState = {};
  for (const harnessId of ["claude-code", "codex"] as const) {
    const session = normalizeHarnessSessionState(
      (value as Record<string, unknown>)[harnessId]
    );
    if (session) {
      normalized[harnessId] = session;
    }
  }

  return normalized;
}

export function getHarnessResumeSessionId(
  harnessState: HarnessState,
  harnessId: HarnessId,
  sandboxId?: string | null
) {
  if (!sandboxId) return null;

  const session = harnessState[harnessId];
  if (!session?.sessionId) return null;
  if (session.sandboxId !== sandboxId) return null;

  return session.sessionId;
}

export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  conversations: {},
  conversationList: [],
  userId: null,
  defaultModel: DEFAULT_NEW_AGENT_MODEL_ID,

  setUserId: (id) => set({ userId: id }),
  setDefaultModel: (model) => set({ defaultModel: model }),

  getConversation: (paneId) =>
    get().conversations[paneId] || defaultState(get().defaultModel),

  loadConversation: async (paneId) => {
    try {
      const res = await fetch(`/api/conversations?id=${paneId}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data) {
        set((state) => ({
          conversations: {
            ...state.conversations,
            [paneId]: {
              messages: data.messages || [],
              localMsgs: normalizeLocalMessages(data.local_msgs),
              harnessState: normalizeHarnessState(data.harness_state),
              model: data.model || get().defaultModel,
              mode: data.mode || "AUTO",
              title: data.title || undefined,
              updatedAt: data.updated_at || null,
            },
          },
        }));
      }
    } catch (error) {
      console.warn("Failed to load conversation", { paneId, error });
    }
  },

  hydrateConversation: (paneId, payload) => {
    set((state) => {
      const current =
        state.conversations[paneId] || defaultState(get().defaultModel);
      return {
        conversations: {
          ...state.conversations,
          [paneId]: {
            ...current,
            ...payload,
            updatedAt: current.updatedAt ?? null,
          },
        },
      };
    });
    void get().syncToSupabase(paneId);
  },

  syncToSupabase: async (paneId) => {
    await queueConversationSync(paneId, async () => {
      const { userId } = get();
      if (!userId) return;

      const conv = get().conversations[paneId];
      if (!conv) return;

      const title = conv.title || extractTitle(conv.messages);

      try {
        const res = await fetch("/api/conversations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: paneId,
            model: conv.model,
            mode: conv.mode,
            messages: conv.messages,
            local_msgs: conv.localMsgs,
            harness_state: conv.harnessState,
            title,
            expected_updated_at: conv.updatedAt ?? null,
          }),
        });

        if (res.status === 409) {
          const data = (await res.json().catch(() => null)) as {
            conversation?: { updated_at?: string | null };
          } | null;
          const latestUpdatedAt = data?.conversation?.updated_at ?? null;
          set((state) => {
            const current = state.conversations[paneId];
            if (!current) return state;
            return {
              conversations: {
                ...state.conversations,
                [paneId]: {
                  ...current,
                  updatedAt: latestUpdatedAt,
                },
              },
            };
          });
          console.warn("Conversation sync skipped due to version conflict", {
            paneId,
          });
          return;
        }

        if (!res.ok) {
          throw new Error(`Sync failed with status ${res.status}`);
        }

        const data = (await res.json()) as {
          conversation?: {
            updated_at?: string | null;
            title?: string | null;
          };
        };

        set((state) => {
          const current = state.conversations[paneId];
          if (!current) return state;
          return {
            conversations: {
              ...state.conversations,
              [paneId]: {
                ...current,
                title:
                  current.title ||
                  title ||
                  data.conversation?.title ||
                  undefined,
                updatedAt:
                  data.conversation?.updated_at ?? current.updatedAt ?? null,
              },
            },
          };
        });
      } catch (error) {
        console.warn("Failed to sync conversation", { paneId, error });
      }
    });
  },

  setMessages: (paneId, messages) => {
    let changed = false;
    set((state) => {
      const current =
        state.conversations[paneId] || defaultState(get().defaultModel);
      if (messagesEqual(current.messages, messages)) {
        return state;
      }
      changed = true;
      return {
        conversations: {
          ...state.conversations,
          [paneId]: { ...current, messages },
        },
      };
    });
    if (!changed) return;
  },

  addLocalMsg: (paneId, msg) => {
    set((state) => {
      const conv =
        state.conversations[paneId] || defaultState(get().defaultModel);
      return {
        conversations: {
          ...state.conversations,
          [paneId]: { ...conv, localMsgs: [...conv.localMsgs, msg] },
        },
      };
    });
    void get().syncToSupabase(paneId);
  },

  updateLocalMsg: (paneId, msgId, update) => {
    set((state) => {
      const conv = state.conversations[paneId];
      if (!conv) return state;
      return {
        conversations: {
          ...state.conversations,
          [paneId]: {
            ...conv,
            localMsgs: conv.localMsgs.map((m) => {
              if (m.id !== msgId) return m;
              if (typeof update === "string") {
                return {
                  ...m,
                  text: update,
                  segments: undefined,
                  toolCalls: undefined,
                };
              }
              return { ...m, ...update };
            }),
          },
        },
      };
    });
  },

  retargetHarnessSandboxIds: (paneIds, previousSandboxId, nextSandboxId) => {
    const changedPaneIds: string[] = [];

    set((state) => {
      const nextConversations = { ...state.conversations };
      let changed = false;

      for (const paneId of new Set(paneIds)) {
        const conversation = state.conversations[paneId];
        if (!conversation) continue;

        let harnessChanged = false;
        const nextHarnessState = { ...conversation.harnessState };

        for (const harnessId of ["claude-code", "codex"] as const) {
          const session = nextHarnessState[harnessId];
          if (session?.sandboxId !== previousSandboxId) continue;

          nextHarnessState[harnessId] = {
            ...session,
            sandboxId: nextSandboxId,
          };
          harnessChanged = true;
        }

        if (!harnessChanged) continue;

        nextConversations[paneId] = {
          ...conversation,
          harnessState: nextHarnessState,
        };
        changedPaneIds.push(paneId);
        changed = true;
      }

      if (!changed) return state;

      return {
        conversations: nextConversations,
      };
    });

    for (const paneId of changedPaneIds) {
      void get().syncToSupabase(paneId);
    }
  },

  setHarnessState: (paneId, harnessId, session) => {
    set((state) => {
      const conv =
        state.conversations[paneId] || defaultState(get().defaultModel);
      const nextHarnessState = { ...conv.harnessState };

      if (session) {
        nextHarnessState[harnessId] = session;
      } else {
        delete nextHarnessState[harnessId];
      }

      return {
        conversations: {
          ...state.conversations,
          [paneId]: { ...conv, harnessState: nextHarnessState },
        },
      };
    });
    void get().syncToSupabase(paneId);
  },

  removeLocalMsg: (paneId, msgId) => {
    set((state) => {
      const conv = state.conversations[paneId];
      if (!conv) return state;
      return {
        conversations: {
          ...state.conversations,
          [paneId]: {
            ...conv,
            localMsgs: conv.localMsgs.filter((m) => m.id !== msgId),
          },
        },
      };
    });
  },

  clearMessages: (paneId) => {
    set((state) => ({
      conversations: {
        ...state.conversations,
        [paneId]: {
          ...(state.conversations[paneId] || defaultState(get().defaultModel)),
          messages: [],
          localMsgs: [],
          harnessState: {},
          title: undefined,
        },
      },
    }));
    void get().syncToSupabase(paneId);
  },

  setModel: (paneId, model) => {
    set((state) => ({
      conversations: {
        ...state.conversations,
        [paneId]: {
          ...(state.conversations[paneId] || defaultState(get().defaultModel)),
          model,
        },
      },
    }));
    void get().syncToSupabase(paneId);
  },

  setMode: (paneId, mode) => {
    set((state) => ({
      conversations: {
        ...state.conversations,
        [paneId]: {
          ...(state.conversations[paneId] || defaultState(get().defaultModel)),
          mode,
        },
      },
    }));
    void get().syncToSupabase(paneId);
  },

  removeConversation: async (paneId) => {
    set((state) => {
      const { [paneId]: _, ...rest } = state.conversations;
      return { conversations: rest };
    });
    await fetch(`/api/conversations?id=${paneId}`, { method: "DELETE" });
  },

  fetchConversationList: async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      set({ conversationList: data || [] });
    } catch (error) {
      console.warn("Failed to fetch conversation list", error);
    }
  },

  deleteConversation: async (id) => {
    set((state) => ({
      conversationList: state.conversationList.filter((c) => c.id !== id),
    }));
    try {
      await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
    } catch (error) {
      console.warn("Failed to delete conversation", { id, error });
    }
  },
}));
