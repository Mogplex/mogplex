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
  agent: { id: string; name: string; skills: readonly SelectableSkill[] };
  /** The task the agent was asked to do. */
  request: string;
  /** How the skills reach the agent today: as files, or inline in the prompt. */
  delivery: "files" | "inline";
  scope: DecisionScope;
};

/**
 * Record which of an agent's skills the request needs. Every linked skill is
 * still loaded: this only observes, so trimming can be judged on evidence
 * first. Never rejects, and an agent without skills asks nothing.
 */
export function observeSkillSelection(
  input: SkillSelectionInput,
  decideFn: CandidateDecideFn = defaultCandidateDecide
): Promise<void> {
  return observeQuietly("skill selection", async () => {
    const request = input.request.trim();
    if (!request || input.agent.skills.length === 0) return;
    const { labelled, omitted } = labelCandidates(input.agent.skills);
    await decideFn(
      "skill_selection",
      {
        request: clipText(request, REQUEST_MAX_CHARS),
        skills: Object.fromEntries(
          labelled.map(({ key, item }) => [
            key,
            {
              name: item.name,
              description: clipText(
                item.description ?? "",
                SKILL_DESCRIPTION_MAX_CHARS
              ),
              excerpt: clipText(item.content.trim(), SKILL_EXCERPT_MAX_CHARS),
            },
          ])
        ),
      },
      input.scope,
      {
        candidates: labelled.map(({ key }) => key),
        baseline: {
          loaded: input.agent.skills.length,
          delivery: input.delivery,
          contentChars: input.agent.skills.reduce(
            (sum, skill) => sum + skill.content.length,
            0
          ),
        },
        metadata: {
          agent_id: input.agent.id,
          agent_name: input.agent.name,
          omitted,
          candidates: Object.fromEntries(
            labelled.map(({ key, item }) => [key, item.id])
          ),
        },
      }
    );
  });
}
