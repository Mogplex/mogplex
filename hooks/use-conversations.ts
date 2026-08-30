"use client";
import { create } from "zustand";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";
import type {
  ConversationListItem,
  ConversationState,
  HarnessId,
  HarnessSessionState,
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
import { createConversationState } from "./conversation-state";

export type * from "./conversation-types";
export { getHarnessResumeSessionId } from "./conversation-state";

type ConversationsStore = {
  conversations: Record<string, ConversationState>;
  conversationList: ConversationListItem[];
  userId: string | null;
  defaultModel: string;
  setUserId: (id: string | null) => void;
  setDefaultModel: (model: string) => void;
  getConversation: (paneId: string) => ConversationState;
  loadConversation: (
    paneId: string,
    conversationId?: string,
    expectedRepoId?: string | null,
    signal?: AbortSignal
  ) => Promise<ConversationState | null>;
  startConversation: (
    paneId: string,
    context: {
      id: string;
      repoId: string | null;
      workspaceSessionId: string | null;
    }
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
  syncToSupabase: (paneId: string) => Promise<boolean>;
  fetchConversationList: (repoId?: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
};

export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  conversations: {},
  conversationList: [],
  userId: null,
  defaultModel: DEFAULT_NEW_AGENT_MODEL_ID,

  setUserId: (id) => set({ userId: id }),
  setDefaultModel: (model) => set({ defaultModel: model }),

  getConversation: (paneId) =>
    get().conversations[paneId] ||
    createConversationState(get().defaultModel, paneId),

  loadConversation: async (paneId, conversationId, expectedRepoId, signal) => {
    const requestedConversationId = conversationId ?? paneId;
    try {
      const res = await fetch(
        `/api/conversations?id=${requestedConversationId}`,
        { headers: getActiveTeamRequestHeaders(), signal }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (signal?.aborted) return null;

      if (data) {
        const repoId = data.repo_id ?? null;
        if (expectedRepoId !== undefined && repoId !== expectedRepoId) {
          return null;
        }
        const loadedConversation: ConversationState = {
          id: data.id,
          repoId,
          workspaceSessionId: data.workspace_session_id ?? null,
          messages: data.messages || [],
          localMsgs: normalizeLocalMessages(data.local_msgs),
          harnessState: normalizeHarnessState(data.harness_state),
          model: data.model || get().defaultModel,
          mode: data.mode || "AUTO",
          title: data.title || undefined,
          updatedAt: data.updated_at || null,
        };
        set((state) => ({
          conversations: {
            ...state.conversations,
            [paneId]: loadedConversation,
          },
        }));
        return loadedConversation;
      }
    } catch (error) {
      if (signal?.aborted) return null;
      console.warn("Failed to load conversation", {
        paneId,
        conversationId: requestedConversationId,
        error,
      });
    }
    return null;
  },

  startConversation: (paneId, context) => {
    set((state) => {
      const current =
        state.conversations[paneId] ||
        createConversationState(get().defaultModel, context.id, context);
      return {
        conversations: {
          ...state.conversations,
          [paneId]: {
            ...createConversationState(current.model, context.id, context),
            mode: current.mode,
          },
        },
      };
    });
  },

  syncToSupabase: async (paneId) => {
    let succeeded = false;
    await queueConversationSync(paneId, async () => {
      const { userId } = get();
      if (!userId) return;

      const conv = get().conversations[paneId];
      if (!conv) return;

      const title = conv.title || extractTitle(conv.messages) || "";

      try {
        const res = await fetch("/api/conversations", {
          method: "PUT",
          headers: getActiveTeamRequestHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            id: conv.id,
            repo_id: conv.repoId,
            workspace_session_id: conv.workspaceSessionId,
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
          console.warn("Conversation sync skipped due to version conflict", {
            paneId,
            conversationId: conv.id,
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
          if (current?.id !== conv.id) return state;
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
        succeeded = true;
      } catch (error) {
        console.warn("Failed to sync conversation", {
          paneId,
          conversationId: conv.id,
          error,
        });
      }
    });
    return succeeded;
  },

  setMessages: (paneId, messages) => {
    let changed = false;
    set((state) => {
      const current =
        state.conversations[paneId] ||
        createConversationState(get().defaultModel, paneId);
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
        state.conversations[paneId] ||
        createConversationState(get().defaultModel, paneId);
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
        state.conversations[paneId] ||
        createConversationState(get().defaultModel, paneId);
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
          ...(state.conversations[paneId] ||
            createConversationState(get().defaultModel, paneId)),
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
          ...(state.conversations[paneId] ||
            createConversationState(get().defaultModel, paneId)),
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
          ...(state.conversations[paneId] ||
            createConversationState(get().defaultModel, paneId)),
          mode,
        },
      },
    }));
    void get().syncToSupabase(paneId);
  },

  removeConversation: async (paneId) => {
    const conversationId = get().conversations[paneId]?.id;
    set((state) => {
      const { [paneId]: _, ...rest } = state.conversations;
      return { conversations: rest };
    });
    if (!conversationId) return;
    await fetch(`/api/conversations?id=${conversationId}`, {
      method: "DELETE",
      headers: getActiveTeamRequestHeaders(),
    });
  },

  fetchConversationList: async (repoId) => {
    try {
      const query = new URLSearchParams();
      if (repoId) query.set("repo_id", repoId);
      else if (repoId === null) query.set("projectless", "true");
      const res = await fetch(
        `/api/conversations${query.size > 0 ? `?${query}` : ""}`,
        { headers: getActiveTeamRequestHeaders() }
      );
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
      await fetch(`/api/conversations?id=${id}`, {
        method: "DELETE",
        headers: getActiveTeamRequestHeaders(),
      });
    } catch (error) {
      console.warn("Failed to delete conversation", { id, error });
    }
  },
}));
