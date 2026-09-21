/**
 * Skills and rules for an automation agent node.
 *
 * A node's instructions are where its author speaks, so a `$slug` written
 * there invokes a skill the same way it does in chat. So does a comment that
 * @mentions Mogplex, or the prompt of a signed webhook: someone addressed the
 * agent directly. Other payload text (PR bodies, diffs, third-party comments)
 * is task data and never invokes anything.
 *
 * A node that names a roster agent also gets the rules and skills attached to
 * that agent. Flow nodes read `agents.system_prompt` directly and never went
 * through the agent runtime, so those attachments were silently dropped.
 */
import type { Tool } from "ai";
import { renderAgentInstructions } from "@/lib/agents/runtime/instructions";
import {
  loadAgentLinkedRules,
  loadAgentLinkedSkills,
} from "@/lib/agents/runtime/store";
import { isPresetAgentId } from "@/lib/agents/runtime/types";
import { createSkillTools } from "@/lib/agents/tools/skills";
import { resolveInvokedSkills } from "@/lib/skill-catalog/invocations";
import { renderSkillCatalog } from "@/lib/skill-catalog/render";
import { loadSkillCatalogOrEmpty } from "@/lib/skill-catalog/store";
import { isUuid } from "@/lib/uuid";
import { normalizeAutomationAssignmentType } from "@/lib/workflows/automation-job-utils";
import type { JobContext } from "@/lib/workflows/automation-job-types";

export type AutomationSkillsMode =
  /** Mogplex runs the model: skills ride in the instructions, with tools. */
  | "native"
  /**
   * A CLI harness runs it. The harness route resolves the catalog from the
   * prompt and writes skill files, so only the agent's attachments are added.
   */
  | "harness";

export type AutomationSkills = {
  /** Appended to the node's instructions. Null when there is nothing to add. */
  instructionsSuffix: string | null;
  /** `find_skills` / `load_skill` for a native run with a catalog. */
  tools: Record<string, Tool>;
};

export type AutomationSkillsDeps = {
  loadCatalog: typeof loadSkillCatalogOrEmpty;
  loadLinkedSkills: typeof loadAgentLinkedSkills;
  loadLinkedRules: typeof loadAgentLinkedRules;
  createTools: typeof createSkillTools;
};

const defaultDeps: AutomationSkillsDeps = {
  loadCatalog: loadSkillCatalogOrEmpty,
  loadLinkedSkills: loadAgentLinkedSkills,
  loadLinkedRules: loadAgentLinkedRules,
  createTools: createSkillTools,
};

export const NO_AUTOMATION_SKILLS: AutomationSkills = {
  instructionsSuffix: null,
  tools: {},
};

/** Text written to the agent by a person, as opposed to data about the task. */
export function readAutomationInvocationTexts(context: JobContext): string[] {
  const texts = [context.agent.system_prompt];
  const type = normalizeAutomationAssignmentType(context.assignmentType);
  if (type === "mention") texts.push(context.metadata.comment_body as string);
  const webhook = context.metadata.webhook;
  if (type === "webhook" && webhook && typeof webhook === "object") {
    texts.push((webhook as Record<string, unknown>).prompt as string);
  }
  return texts.filter(
    (text): text is string => typeof text === "string" && text.trim().length > 0
  );
}

async function renderAgentAttachments(
  context: JobContext,
  deps: AutomationSkillsDeps
) {
  const agentId = context.agent.id;
  if (!agentId || isPresetAgentId(agentId) || !isUuid(agentId)) {
    return { block: null, skillIds: [] as string[] };
  }
  const [skills, rules] = await Promise.all([
    deps.loadLinkedSkills(agentId),
    deps.loadLinkedRules(agentId),
  ]);
  if (skills.length === 0 && rules.length === 0) {
    return { block: null, skillIds: [] as string[] };
  }
  // The node already carries the instructions; this adds what hangs off them.
  const { prompt } = renderAgentInstructions(
    {
      id: agentId,
      name: context.agent.name ?? "agent",
      slug: context.agent.slug ?? null,
      model: null,
      systemPrompt: null,
      skills,
      rules,
      preset: false,
      teamId: null,
      ownerUserId: null,
    },
    "inline"
  );
  return { block: prompt, skillIds: skills.map((skill) => skill.id) };
}

/**
 * Never rejects. An automation runs without skills rather than not at all.
 */
export async function resolveAutomationSkills(
  context: JobContext,
  mode: AutomationSkillsMode,
  deps: AutomationSkillsDeps = defaultDeps
): Promise<AutomationSkills> {
  try {
    const attachments = await renderAgentAttachments(context, deps);
    const blocks = [attachments.block];
    let tools: Record<string, Tool> = {};
    // Job fixtures and legacy rows can carry a non-UUID owner; nothing to load.
    if (mode === "native" && isUuid(context.repo.user_id)) {
      const scope = { userId: context.repo.user_id, repoId: context.repo.id };
      const { skills } = await deps.loadCatalog(scope);
      const attached = new Set(attachments.skillIds);
      const available = skills.filter((skill) => !attached.has(skill.id));
      if (available.length > 0) {
        tools = deps.createTools(scope);
        blocks.push(
          renderSkillCatalog({
            invoked: resolveInvokedSkills(
              readAutomationInvocationTexts(context),
              available
            ),
            available,
            delivery: "inline",
            loadHint: "tool",
          }).prompt
        );
      }
    }
    const suffix = blocks.filter(Boolean).join("\n\n");
    return { instructionsSuffix: suffix || null, tools };
  } catch (error) {
    console.warn(
      "[automation] skills skipped:",
      error instanceof Error ? error.message : error
    );
    return NO_AUTOMATION_SKILLS;
  }
}
