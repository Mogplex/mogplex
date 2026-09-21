/**
 * The skills block for a conversational turn: the skills the user invoked
 * anywhere in the conversation, in full, plus an index of the rest when the
 * agent holds the tools to load one.
 */
import {
  resolveInvokedSkills,
  type SkillInvocationOptions,
} from "./invocations";
import { renderSkillCatalog, type SkillLoadHint } from "./render";
import { loadSkillCatalogOrEmpty, type LoadSkillCatalogInput } from "./store";
import type { CatalogSkill, SkillCatalog } from "./types";

export type ConversationMessage = {
  role?: string;
  content?: unknown;
  parts?: unknown;
};

export type ConversationSkills = {
  invoked: CatalogSkill[];
  available: CatalogSkill[];
};

export const NO_CONVERSATION_SKILLS: ConversationSkills = {
  invoked: [],
  available: [],
};

function partText(part: unknown): string {
  if (!part || typeof part !== "object") return "";
  const { type, text } = part as { type?: unknown; text?: unknown };
  return type === "text" && typeof text === "string" ? text : "";
}

/** Text the user typed, one entry per user message, oldest first. */
export function readUserTexts(
  messages: readonly ConversationMessage[]
): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message?.role !== "user") continue;
    const body = message.parts ?? message.content;
    const text =
      typeof body === "string"
        ? body
        : Array.isArray(body)
          ? body.map(partText).filter(Boolean).join("\n")
          : "";
    if (text.trim()) texts.push(text);
  }
  return texts;
}

export type ConversationSkillsInput = LoadSkillCatalogInput & {
  userTexts: readonly string[];
  invocation?: SkillInvocationOptions;
};

export type ConversationSkillsDeps = {
  loadCatalog: (input: LoadSkillCatalogInput) => Promise<SkillCatalog>;
};

const defaultDeps: ConversationSkillsDeps = {
  loadCatalog: (input) => loadSkillCatalogOrEmpty(input),
};

/** Never rejects: a turn runs without skills rather than not at all. */
export async function resolveConversationSkills(
  input: ConversationSkillsInput,
  deps: ConversationSkillsDeps = defaultDeps
): Promise<ConversationSkills> {
  try {
    const { skills } = await deps.loadCatalog({
      userId: input.userId,
      repoId: input.repoId ?? null,
    });
    if (skills.length === 0) return NO_CONVERSATION_SKILLS;
    const invoked = resolveInvokedSkills(
      input.userTexts,
      skills,
      input.invocation
    );
    return { invoked, available: skills };
  } catch (error) {
    console.warn(
      "[skills] conversation skills unavailable:",
      error instanceof Error ? error.message : error
    );
    return NO_CONVERSATION_SKILLS;
  }
}

/**
 * The prompt block for a turn, or null when there is nothing to say.
 * `loadHint` says how the agent on this surface loads a skill it was not
 * handed: pass "none" when it cannot, and only invoked skills are rendered.
 */
export function renderConversationSkills(
  skills: ConversationSkills,
  loadHint: SkillLoadHint
): string | null {
  return renderSkillCatalog({
    invoked: skills.invoked,
    available: skills.available,
    delivery: "inline",
    loadHint,
  }).prompt;
}

/** Drops skills another prompt section already delivers, by id. */
export function withoutSkills(
  skills: ConversationSkills,
  skillIds: readonly string[] | null | undefined
): ConversationSkills {
  if (!skillIds?.length) return skills;
  const dropped = new Set(skillIds);
  return {
    invoked: skills.invoked.filter((skill) => !dropped.has(skill.id)),
    available: skills.available.filter((skill) => !dropped.has(skill.id)),
  };
}
