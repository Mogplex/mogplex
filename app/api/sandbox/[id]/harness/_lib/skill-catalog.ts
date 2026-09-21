import type { Sandbox } from "@vercel/sandbox";
import { materializeAgentRuntimeFiles } from "@/lib/agents/runtime/materialize";
import type { AgentRuntime } from "@/lib/agents/runtime/types";
import { buildHarnessSlashCommands } from "@/lib/harness/slash-commands";
import type { HarnessId } from "@/lib/harness/config";
import { resolveInvokedSkills } from "@/lib/skill-catalog/invocations";
import { renderSkillCatalog } from "@/lib/skill-catalog/render";
import type { SandboxSetupContext } from "./setup";
import type { SandboxHarnessPostDeps } from "./types";

/**
 * Applies the user's skill catalog to a harness run. Skills the prompt
 * invokes by name, and an index of the rest, are written under
 * `.mogplex/skills/` (self-ignored by git) and named in a block ahead of the
 * task. A CLI harness owns its slash commands, so `/compact` stays the CLI's;
 * `$slug` always reaches the catalog.
 *
 * The block leads the prompt, which also keeps a task that opens with
 * `/slug` from being read by the CLI as one of its own commands.
 *
 * Skills add to a run. Any failure here leaves the prompt as it was.
 */
export async function setupSkillCatalog(
  deps: Pick<
    SandboxHarnessPostDeps,
    "safeAppendAiCallEvent" | "loadSkillCatalog" | "recordSkillUse"
  >,
  sandbox: Pick<Sandbox, "writeFiles" | "readFile">,
  ctx: SandboxSetupContext,
  input: {
    harnessId: HarnessId;
    /** The task as the user wrote it. */
    prompt: string;
    agentRuntime: AgentRuntime | null;
  }
): Promise<string> {
  try {
    const { skills } = await deps.loadSkillCatalog({
      userId: ctx.userId,
      repoId: ctx.repoId,
    });
    if (skills.length === 0) return input.prompt;
    const invoked = resolveInvokedSkills(input.prompt, skills, {
      reservedSlashNames: new Set(
        buildHarnessSlashCommands(input.harnessId).map(
          (command) => command.name
        )
      ),
    });
    // The agent block already lists the skills attached to the agent.
    const attached = new Set(
      input.agentRuntime?.skills.map((skill) => skill.id)
    );
    const rendered = renderSkillCatalog({
      invoked,
      available: skills.filter((skill) => !attached.has(skill.id)),
      delivery: "files",
      loadHint: "files",
    });
    if (!rendered.prompt) return input.prompt;
    void deps.recordSkillUse(ctx.userId, invoked);
    const written = await materializeAgentRuntimeFiles({
      sandbox,
      rootDirectory: ctx.rootDirectory,
      files: rendered.files,
    });
    await deps.safeAppendAiCallEvent({
      aiCallId: ctx.aiCallId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      repoId: ctx.repoId,
      eventType: "log",
      message:
        invoked.length > 0
          ? `Invoked skills: ${invoked.map((skill) => skill.name).join(", ")}`
          : "Loaded skill catalog",
      payload: {
        stage: "skill_catalog",
        invoked: invoked.map((skill) => skill.slug),
        available: skills.length,
        files: written,
      },
    });
    return `${rendered.prompt}\n\n${input.prompt.trim()}`;
  } catch (error) {
    console.warn(
      "[harness] skill catalog skipped:",
      error instanceof Error ? error.message : error
    );
    return input.prompt;
  }
}
