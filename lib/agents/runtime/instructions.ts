/**
 * Renders an agent runtime into prompt text and sandbox files.
 *
 * Rules always apply, so they are inlined into the prompt. Skills are
 * reference material the agent reads on demand, so they are written as
 * files under `.mogplex/agent/skills/` (self-ignored by git, see
 * `lib/harness/mcp-config.ts`) and listed in the prompt by path. Surfaces
 * without a filesystem ask for `inline` skills instead.
 */
import type { AgentRuntime, AgentRuntimeSkill } from "./types";

export const AGENT_RUNTIME_DIR = ".mogplex/agent";
export const AGENT_SKILLS_DIR = `${AGENT_RUNTIME_DIR}/skills`;
export const AGENT_RULES_MAX_CHARS = 24_000;
export const AGENT_INLINE_SKILLS_MAX_CHARS = 32_000;
const TRUNCATION_MARKER = "\n[truncated]";

export type AgentRuntimeFile = { path: string; content: string };

export type AgentInstructionsMode = "files" | "inline";

export type RenderedAgentInstructions = {
  /** Prompt section describing the agent, its rules, and its skills. */
  prompt: string;
  /** Files to write into the sandbox checkout. Empty in inline mode. */
  files: AgentRuntimeFile[];
};

export function slugifyAgentName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "agent";
}

export function agentSkillPath(skill: Pick<AgentRuntimeSkill, "name">) {
  return `${AGENT_SKILLS_DIR}/${slugifyAgentName(skill.name)}/SKILL.md`;
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

function renderRules(runtime: AgentRuntime) {
  if (runtime.rules.length === 0) return null;
  let budget = AGENT_RULES_MAX_CHARS;
  const sections: string[] = [];
  for (const rule of runtime.rules) {
    const content = rule.content.trim();
    if (!content) continue;
    if (budget <= 0) {
      sections.push(`### ${rule.name}\n[omitted: rules budget exhausted]`);
      continue;
    }
    const body = truncate(content, budget);
    budget -= body.length;
    sections.push(`### ${rule.name}\n${body}`);
  }
  if (sections.length === 0) return null;
  return ["## Rules", "These rules always apply.", ...sections].join("\n\n");
}

function renderSkillList(runtime: AgentRuntime, mode: AgentInstructionsMode) {
  if (runtime.skills.length === 0) return null;
  if (mode === "files") {
    const lines = runtime.skills.map((skill) => {
      const summary = skill.description?.trim();
      return `- ${skill.name}${summary ? ` — ${summary}` : ""} (${agentSkillPath(skill)})`;
    });
    return [
      "## Skills",
      `Skill files live under ${AGENT_SKILLS_DIR}/ in this checkout. Read a skill before doing work it covers.`,
      lines.join("\n"),
    ].join("\n\n");
  }
  let budget = AGENT_INLINE_SKILLS_MAX_CHARS;
  const sections: string[] = [];
  for (const skill of runtime.skills) {
    const content = skill.content.trim();
    const summary = skill.description?.trim();
    const header = `### ${skill.name}${summary ? `\n${summary}` : ""}`;
    if (!content || budget <= 0) {
      sections.push(header);
      continue;
    }
    const body = truncate(content, budget);
    budget -= body.length;
    sections.push(`${header}\n\n${body}`);
  }
  return ["## Skills", "Apply these skills when relevant.", ...sections].join(
    "\n\n"
  );
}

/**
 * Builds the prompt block and sandbox files for an agent. The block is safe
 * to prepend to any task prompt and to append to a system prompt.
 */
export function renderAgentInstructions(
  runtime: AgentRuntime,
  mode: AgentInstructionsMode = "files"
): RenderedAgentInstructions {
  const systemPrompt = runtime.systemPrompt?.trim();
  const parts = [
    `You are running as the Mogplex agent "${runtime.name}".`,
    systemPrompt ? `## Agent instructions\n\n${systemPrompt}` : null,
    renderRules(runtime),
    renderSkillList(runtime, mode),
  ].filter(Boolean);
  const prompt = `<agent name="${runtime.name}">\n${parts.join("\n\n")}\n</agent>`;
  const files =
    mode === "files"
      ? runtime.skills
          .filter((skill) => skill.content.trim().length > 0)
          .map((skill) => ({
            path: agentSkillPath(skill),
            content: skill.content.trim().endsWith("\n")
              ? skill.content.trim()
              : `${skill.content.trim()}\n`,
          }))
      : [];
  return { prompt, files };
}

/** Prepends the agent block to a task prompt. */
export function prependAgentInstructions(prompt: string, block: string) {
  return `${block}\n\n${prompt.trim()}`;
}
