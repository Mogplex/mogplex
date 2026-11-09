import { loadControlMemoryContextForUser } from "@/lib/agents/control-memory-context";
import {
  readUserTexts,
  resolveConversationSkills,
  type ConversationMessage,
  type ConversationSkills,
} from "@/lib/skill-catalog/chat";

type MemoryInput = Parameters<typeof loadControlMemoryContextForUser>[0];

export type ControlKnowledgeContext = {
  /** Rendered durable memories, or null when none are prompt-worthy. */
  memoryContext: string | null;
  /** Skills the operator invoked in this conversation, and their catalog. */
  skills: ConversationSkills;
};

export type ControlKnowledgeDeps = {
  loadMemoryContext: typeof loadControlMemoryContextForUser;
  resolveSkills: typeof resolveConversationSkills;
};

const defaultDeps: ControlKnowledgeDeps = {
  loadMemoryContext: loadControlMemoryContextForUser,
  resolveSkills: resolveConversationSkills,
};

/**
 * What the operator already knows and keeps, loaded together for one turn:
 * their durable memories and their skills. Both loaders fail open, so a
 * turn never waits on, or dies from, either store.
 */
export async function loadControlKnowledgeContext(
  input: {
    userId: string;
    repoId: string | null;
    latestUserText: string;
    messages: readonly ConversationMessage[];
    onMemoriesSelected?: MemoryInput["onSelected"];
    /** Told which skills this turn has in play, so they can be observed. */
    onSkillsResolved?: (skills: ConversationSkills) => void;
  },
  deps: ControlKnowledgeDeps = defaultDeps
): Promise<ControlKnowledgeContext> {
  const [memoryContext, skills] = await Promise.all([
    deps.loadMemoryContext({
      userId: input.userId,
      repoId: input.repoId,
      query: input.latestUserText,
      onSelected: input.onMemoriesSelected,
    }),
    deps.resolveSkills({
      userId: input.userId,
      repoId: input.repoId,
      userTexts: readUserTexts(input.messages),
    }),
  ]);
  try {
    input.onSkillsResolved?.(skills);
  } catch {
    // An observer must never cost the operator their turn.
  }
  return { memoryContext, skills };
}
