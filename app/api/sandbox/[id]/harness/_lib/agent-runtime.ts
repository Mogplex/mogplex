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
 * Which skills the task needed is recorded beside this, never in front of it:
 * the check is handed to `runAfterResponse`, so the harness starts on time and
 * the function stays alive until the record is written.
 */
export async function setupAgentRuntime(
  deps: Pick<
    SandboxHarnessPostDeps,
    "safeAppendAiCallEvent" | "observeSkillSelection" | "runAfterResponse"
  >,
  sandbox: Pick<Sandbox, "writeFiles" | "readFile">,
  ctx: SandboxSetupContext,
  runtime: AgentRuntime,
  prompt: string,
  /** The task as the user wrote it, when `prompt` already carries a preamble. */
  request: string = prompt
): Promise<string> {
  const observed = deps.observeSkillSelection({
    agent: runtime,
    request,
    delivery: "files",
    scope: {
      surface: "harness",
      userId: ctx.userId,
      teamId: ctx.teamId,
      repoId: ctx.repoId,
      aiCallId: ctx.aiCallId,
      conversationId: ctx.conversationId,
    },
  });
  try {
    deps.runAfterResponse(() => observed);
  } catch {
    // Outside a request scope the check still runs; it just is not held open.
  }
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
