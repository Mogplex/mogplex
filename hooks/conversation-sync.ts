import type { ConversationState, Message } from "./conversation-types";
import {
  normalizeHarnessState,
  normalizeLocalMessages,
} from "./conversation-normalizers";

export type PersistedConversation = {
  id?: unknown;
  messages?: unknown;
  local_msgs?: unknown;
  harness_state?: unknown;
  model?: unknown;
  mode?: unknown;
  title?: unknown;
  updated_at?: unknown;
};

function mergeById<T extends { id: string }>(server: T[], local: T[]): T[] {
  const serverIds = new Set(server.map((item) => item.id));
  return [...server, ...local.filter((item) => !serverIds.has(item.id))];
}

export function reconcileConversation(
  local: ConversationState,
  server: PersistedConversation
): ConversationState | null {
  if (
    (typeof server.id === "string" && server.id !== local.id) ||
    typeof server.updated_at !== "string" ||
    !server.updated_at
  ) {
    return null;
  }

  const serverMessages = Array.isArray(server.messages)
    ? (server.messages as Message[])
    : [];
  const serverLocalMessages = normalizeLocalMessages(server.local_msgs);
  const serverHarnessState = normalizeHarnessState(server.harness_state);
  const serverMode =
    server.mode === "AUTO" || server.mode === "YOLO" || server.mode === "SAFE"
      ? server.mode
      : local.mode;

  return {
    ...local,
    messages: mergeById(serverMessages, local.messages),
    localMsgs: mergeById(serverLocalMessages, local.localMsgs),
    harnessState: { ...local.harnessState, ...serverHarnessState },
    model:
      typeof server.model === "string" && server.model
        ? server.model
        : local.model,
    mode: serverMode,
    title:
      typeof server.title === "string" && server.title
        ? server.title
        : local.title,
    updatedAt: server.updated_at,
  };
}

export function buildConversationSyncBody(
  conv: ConversationState,
  title: string
) {
  return JSON.stringify({
    id: conv.id,
    repo_id: conv.repoId,
    workspace_session_id: conv.workspaceSessionId,
    sandbox_id: conv.sandboxId ?? null,
    model: conv.model,
    mode: conv.mode,
    messages: conv.messages,
    local_msgs: conv.localMsgs,
    harness_state: conv.harnessState,
    title,
    expected_updated_at: conv.updatedAt ?? null,
  });
}
