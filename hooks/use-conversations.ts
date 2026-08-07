"use client";
import { create } from "zustand";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";
import type {
  ConversationListItem,
  ConversationState,
  HarnessId,
  HarnessSessionState,
  HarnessState,
  LocalMessage,
  Message,
} from "./conversation-types";
import {
  normalizeHarnessState,
  normalizeLocalMessages,
} from "./conversation-normalizers";
import {
  extractTitle,
  messagesEqual,
  queueConversationSync,
} from "./conversation-utils";

export type {
  ConversationListItem,
  ConversationState,
  HarnessId,
  HarnessSessionState,
  HarnessState,
  LocalMessage,
  LocalMessageSegment,
  LocalToolCall,
  LocalToolCallState,
  Message,
} from "./conversation-types";

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
