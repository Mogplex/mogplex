import type {
  ConversationContext,
  ConversationState,
  HarnessId,
  HarnessState,
} from "./conversation-types";

export function createConversationState(
  model: string,
  id: string,
  context?: Partial<Omit<ConversationContext, "id">>
): ConversationState {
  return {
    id,
    repoId: context?.repoId ?? null,
    workspaceSessionId: context?.workspaceSessionId ?? null,
    sandboxId: context?.sandboxId ?? null,
    messages: [],
    localMsgs: [],
    harnessState: {},
    model,
    mode: "AUTO",
    updatedAt: null,
  };
}

export function getHarnessResumeSessionId(
  harnessState: HarnessState,
  harnessId: HarnessId,
  sandboxId?: string | null
) {
  if (!sandboxId) return null;
  const session = harnessState[harnessId];
  if (!session?.sessionId || session.sandboxId !== sandboxId) return null;
  return session.sessionId;
}
