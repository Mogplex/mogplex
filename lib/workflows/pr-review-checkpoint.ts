import { createHash } from "node:crypto";
import type { ModelMessage, ToolSet } from "ai";
import type { AutomationAgentResult, JobContext } from "./automation-job-types";
import type { GenerateTextRequest } from "./automation-model-execution-types";
import type {
  PrReviewCheckpoint,
  PrReviewCheckpointStore,
} from "./pr-review-checkpoint-store";
import { normalizeAutomationAgentResult } from "./automation-job-metadata";

export type ReviewGeneration = {
  normalized: AutomationAgentResult;
  responseMessages?: ModelMessage[];
};
export type ReviewCheckpointGenerate = (request: {
  tools: ToolSet;
  prompt?: string;
  messages?: ModelMessage[];
  onStepEnd?: GenerateTextRequest["onStepEnd"];
  abortSignal?: AbortSignal;
}) => Promise<ReviewGeneration>;

// Everything else is treated as potentially effectful. Mark it durably before
// execution so a worker dying between a write and its result cannot replay it.
const READ_ONLY_TOOLS = new Set([
  "getPullRequest",
  "listChangedFiles",
  "fetchFile",
  "reportReview",
  "web_search",
  "web_fetch",
  "find_skills",
  "load_skill",
  "listFlowReports",
  "readFlowReport",
]);

export async function runCheckpointedPrReview(input: {
  context: JobContext;
  instructions: unknown;
  prompt: string;
  tools: ToolSet;
  generate: ReviewCheckpointGenerate;
  store: PrReviewCheckpointStore;
  restoreReportState: (steps: AutomationAgentResult["steps"]) => void;
  validateResume: () => Promise<void>;
}): Promise<ReviewGeneration> {
  const { context } = input;
  const headSha = context.metadata.head_sha;
  if (!context.jobRunId || typeof headSha !== "string" || !headSha.trim()) {
    return input.generate({ tools: input.tools, prompt: input.prompt });
  }
  const scope = {
    jobRunId: context.jobRunId,
    userId: context.repo.user_id,
    nodeId: String(context.metadata.flow_node_id ?? "review"),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          repo: context.repo.id,
          pr: context.metadata.pr_number,
          head: headSha,
          base: context.metadata.base_sha,
          headRepo: context.metadata.head_repo_full_name,
          flowVersion: context.metadata.flow_version_id,
          team: context.metadata.team_id,
          model: context.agent.model,
          instructions: input.instructions,
          prompt: input.prompt,
          tools: Object.keys(input.tools).sort(),
        })
      )
      .digest("hex"),
  };
  let checkpoint: PrReviewCheckpoint = (await input.store.load(scope)) ?? {
    version: 1,
    messages: [],
    steps: [],
    text: "",
    complete: false,
    inFlightTools: [],
  };
  // Preserve the source even if validation fails before generation. A retry
  // of this retry must retain both evidence and any unresolved action marker.
  await input.store.save(scope, checkpoint);
  if (checkpoint.inFlightTools.length > 0) {
    throw new Error(
      "The saved review has an unfinished action. Check that action's result before a new review."
    );
  }
  if (checkpoint.steps.length > 0) await input.validateResume();
  input.restoreReportState(checkpoint.steps);
  const previousSteps = checkpoint.steps;
  const previousMessages = checkpoint.messages;
  if (checkpoint.complete) {
    return {
      normalized: { text: checkpoint.text, steps: previousSteps, usage: null },
      responseMessages: previousMessages,
    };
  }
  const controller = new AbortController();
  // Tool calls can run concurrently. Serialize their marker writes so an
  // earlier snapshot cannot overwrite the complete set of pending actions.
  let actionWrites = Promise.resolve();
  const tools = Object.fromEntries(
    Object.entries(input.tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute || READ_ONLY_TOOLS.has(name)) return [name, tool];
      return [
        name,
        {
          ...tool,
          execute: async (...args: Parameters<typeof execute>) => {
            checkpoint = {
              ...checkpoint,
              inFlightTools: [
                ...checkpoint.inFlightTools,
                {
                  toolName: name,
                  toolCallId: args[1].toolCallId,
                  input: args[0],
                },
              ],
            };
            const marked = checkpoint;
            try {
              actionWrites = actionWrites.then(() =>
                input.store.save(scope, marked)
              );
              await actionWrites;
              controller.signal.throwIfAborted();
            } catch (error) {
              controller.abort(error);
              throw error;
            }
            try {
              return await execute(...args);
            } catch (error) {
              const failure = new Error(
                "A review action did not return a result. Check the action before another review.",
                { cause: error }
              );
              controller.abort(failure);
              throw failure;
            }
          },
        },
      ];
    })
  ) as ToolSet;
  const result = await input.generate({
    tools,
    abortSignal: controller.signal,
    ...(previousMessages.length > 0
      ? {
          messages: [
            { role: "user" as const, content: input.prompt },
            ...previousMessages,
          ],
        }
      : { prompt: input.prompt }),
    onStepEnd: async (step) => {
      // The SDK can turn an execute error into a tool-error message. Do not
      // mistake an unknown write outcome for a safe, completed checkpoint.
      if (controller.signal.aborted) return;
      const normalized = normalizeAutomationAgentResult({
        text: step.text,
        steps: [step],
      });
      checkpoint = {
        version: 1,
        messages: [...checkpoint.messages, ...step.response.messages],
        steps: [...checkpoint.steps, ...normalized.steps],
        text: step.text,
        complete: step.finishReason === "stop" && step.toolCalls.length === 0,
        inFlightTools: [],
      };
      // Await durability before the SDK starts the next generation. Failure
      // leaves the last good checkpoint intact instead of continuing unsaved.
      try {
        await input.store.save(scope, checkpoint);
      } catch (error) {
        // AI SDK v7 deliberately swallows lifecycle callback errors. Abort
        // explicitly so a failed save cannot silently continue the tool loop.
        controller.abort(error);
      }
    },
  });
  controller.signal.throwIfAborted();
  checkpoint = { ...checkpoint, complete: true, text: result.normalized.text };
  await input.store.save(scope, checkpoint);
  return {
    normalized: {
      ...result.normalized,
      steps: [...previousSteps, ...result.normalized.steps],
      // Usage and execution describe only this attempt; the prior attempt was
      // already recorded and billed, even when it failed.
    },
    responseMessages: [...previousMessages, ...(result.responseMessages ?? [])],
  };
}
