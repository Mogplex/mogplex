import {
  defaultCandidateDecide,
  labelCandidates,
  observeQuietly,
  type CandidateDecideFn,
} from "./candidates";
import { clipText } from "./state";
import type { DecisionScope } from "./types";

const REQUEST_MAX_CHARS = 4000;
const SKILL_DESCRIPTION_MAX_CHARS = 400;
const SKILL_EXCERPT_MAX_CHARS = 600;

export type SelectableSkill = {
  id: string;
  name: string;
  description: string | null;
  content: string;
};

export type SkillSelectionInput = {
  /** The roster agent shaping the run, with the skills attached to it. */
  agent?: {
    id: string;
    name: string;
    skills: readonly SelectableSkill[];
  } | null;
  /**
   * The user's own catalog as it was offered to the agent, and the skills in
   * it they invoked by name. Offered skills reach the agent as an index; only
   * invoked ones are delivered in full.
   */
  catalog?: {
    skills: readonly SelectableSkill[];
    invokedIds: readonly string[];
  } | null;
  /** The task the agent was asked to do. */
  request: string;
  /** How skills reach the agent today: as files, or inline in the prompt. */
  delivery: "files" | "inline";
  scope: DecisionScope;
};

type Candidate = { skill: SelectableSkill; source: "agent" | "catalog" };

/** Attached skills first, then catalog skills the agent does not already carry. */
function collectCandidates(input: SkillSelectionInput): Candidate[] {
  const attached = input.agent?.skills ?? [];
  const seen = new Set(attached.map((skill) => skill.id));
  const candidates: Candidate[] = attached.map((skill) => ({
    skill,
    source: "agent",
  }));
  for (const skill of input.catalog?.skills ?? []) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    candidates.push({ skill, source: "catalog" });
  }
  return candidates;
}

/**
 * Record which of the skills in play the request needs. Nothing changes: an
 * agent's attached skills are all still loaded, and the user's catalog is
 * still offered as an index. This only observes, so loading a skill
 * automatically can be judged on evidence first. Never rejects, and a run
 * with no skills in play asks nothing.
 */
export function observeSkillSelection(
  input: SkillSelectionInput,
  decideFn: CandidateDecideFn = defaultCandidateDecide
): Promise<void> {
  return observeQuietly("skill selection", async () => {
    const request = input.request.trim();
    const candidates = collectCandidates(input);
    if (!request || candidates.length === 0) return;
    const invoked = new Set(input.catalog?.invokedIds);
    // Delivered in full: everything attached, plus what the user invoked.
    const loaded = candidates.filter(
      ({ skill, source }) => source === "agent" || invoked.has(skill.id)
    );
    const { labelled, omitted } = labelCandidates(candidates);
    await decideFn(
      "skill_selection",
      {
        request: clipText(request, REQUEST_MAX_CHARS),
        skills: Object.fromEntries(
          labelled.map(({ key, item }) => [
            key,
            {
              name: item.skill.name,
              description: clipText(
                item.skill.description ?? "",
                SKILL_DESCRIPTION_MAX_CHARS
              ),
              excerpt: clipText(
                item.skill.content.trim(),
                SKILL_EXCERPT_MAX_CHARS
              ),
            },
          ])
        ),
      },
      input.scope,
      {
        candidates: labelled.map(({ key }) => key),
        baseline: {
          loaded: loaded.length,
          offered: candidates.length,
          delivery: input.delivery,
          contentChars: loaded.reduce(
            (sum, { skill }) => sum + skill.content.length,
            0
          ),
        },
        metadata: {
          agent_id: input.agent?.id ?? null,
          agent_name: input.agent?.name ?? null,
          omitted,
          candidates: Object.fromEntries(
            labelled.map(({ key, item }) => [key, item.skill.id])
          ),
          sources: Object.fromEntries(
            labelled.map(({ key, item }) => [key, item.source])
          ),
          invoked: [...invoked],
        },
      }
    );
  });
}
