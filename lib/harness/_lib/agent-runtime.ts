import type { Sandbox } from "@vercel/sandbox";
import {
  prependAgentInstructions,
  renderAgentInstructions,
} from "@/lib/agents/runtime/instructions";
import { materializeAgentRuntimeFiles } from "@/lib/agents/runtime/materialize";
import type { AgentRuntime } from "@/lib/agents/runtime/types";
import type { SandboxSetupContext } from "./setup";
import type { SandboxHarnessPostDeps } from "./types";

/**
 * Applies a roster agent to a harness run: skill files land in the checkout
 * under `.mogplex/agent/`, and the agent block (identity, system prompt,
 * rules, skill index) is prepended to the task prompt. The block goes ahead
 * of the memory and delivery sections so the harness reads its role first.
 *
 * Which skills the task needed is recorded separately, by
 * `observeHarnessSkills`, once the user's catalog is known too.
 */
export async function setupAgentRuntime(
  deps: Pick<SandboxHarnessPostDeps, "safeAppendAiCallEvent">,
  sandbox: Pick<Sandbox, "writeFiles" | "readFile">,
  ctx: SandboxSetupContext,
  runtime: AgentRuntime,
  prompt: string
): Promise<string> {
  const rendered = renderAgentInstructions(runtime, "files");
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
    message: `Loaded agent ${runtime.name}`,
    payload: {
      stage: "agent_runtime",
      agent_id: runtime.id,
      agent_name: runtime.name,
      skills: runtime.skills.map((skill) => skill.name),
      rules: runtime.rules.map((rule) => rule.name),
      files: written,
    },
  });
  return prependAgentInstructions(prompt, rendered.prompt);
}
