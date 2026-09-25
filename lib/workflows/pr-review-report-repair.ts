import type { ModelMessage, ToolSet } from "ai";
import type { AutomationAgentResult } from "./automation-job-types";
import { mergeAutomationAgentResults } from "./automation-job-metadata";
import { AutomationModelExecutionError } from "./automation-model-execution-errors";

export const REPORT_REVIEW_TOOL_NAME = "reportReview";

/** Asks for the record of the review that already happened, not a new one. */
export const PR_REVIEW_REPORT_REPAIR_PROMPT =
  "You finished this review without calling reportReview, so nothing was recorded and the pull request has no verdict. Call reportReview now with the verdict and findings from the review you just did. Do not start a new review and do not call any other tool.";

const FORCED_REPORT_CHOICE = {
  type: "tool",
  toolName: REPORT_REVIEW_TOOL_NAME,
} as const;

export type ReportRepairRequest = {
  tools: ToolSet;
  toolChoice: typeof FORCED_REPORT_CHOICE | "auto";
  messages: ModelMessage[];
};

export function hasFiledReviewReport(
  steps: AutomationAgentResult["steps"]
): boolean {
  return steps.some((step) =>
    (step.toolCalls ?? []).some(
      (toolCall) => toolCall.toolName === REPORT_REVIEW_TOOL_NAME
    )
  );
}

/**
 * The report tool alone, without its `execute`. A tool the SDK cannot run
 * ends the call as soon as the model has filled it in, so the forced call
 * below finishes by itself and needs no step limit, which the agent
 * execution policy forbids.
 */
export function buildReportOnlyTools(tools: ToolSet): ToolSet | null {
  const report = tools[REPORT_REVIEW_TOOL_NAME];
  if (!report) return null;
  const schemaOnly = { ...report };
  delete (schemaOnly as { execute?: unknown }).execute;
  return { [REPORT_REVIEW_TOOL_NAME]: schemaOnly };
}

/** The original task, everything the reviewer did, then the request. */
export function buildReportRepairMessages(input: {
  prompt: string;
  responseMessages: ModelMessage[] | undefined;
  text: string;
}): ModelMessage[] {
  const transcript: ModelMessage[] = input.responseMessages?.length
    ? input.responseMessages
    : [{ role: "assistant", content: input.text || "Review finished." }];
  return [
    { role: "user", content: input.prompt },
    ...transcript,
    { role: "user", content: PR_REVIEW_REPORT_REPAIR_PROMPT },
  ];
}

/**
 * True when the provider refused the request itself rather than failing to
 * serve it. Models that always think reject a forced tool choice this way
 * (a 400 such as "enable_thinking is restricted to True"), so the same
 * request can never succeed there. Timeouts, rate limits and outages are
 * left alone: asking again differently would not help and only delays the
 * review's publication.
 */
function isRejectedRequest(error: unknown): boolean {
  return (
    error instanceof AutomationModelExecutionError &&
    error.failure.classification === "configuration"
  );
}

/**
 * When a review ends without its structured report, ask the same model once
 * to file it from the work it already did. The report is forced where the
 * provider allows it; a provider that rejects a forced tool choice is asked
 * again with the report as the only tool on offer. The reviewer's own closing
 * text is kept. This never fails a review that otherwise completed: if the
 * request cannot be made or throws, the result is returned as it was and is
 * published as incomplete.
 */
export async function fileMissingReviewReport(input: {
  result: AutomationAgentResult;
  responseMessages: ModelMessage[] | undefined;
  prompt: string;
  tools: ToolSet;
  generate: (request: ReportRepairRequest) => Promise<AutomationAgentResult>;
}): Promise<AutomationAgentResult> {
  if (hasFiledReviewReport(input.result.steps)) return input.result;
  const tools = buildReportOnlyTools(input.tools);
  if (!tools) return input.result;

  const messages = buildReportRepairMessages({
    prompt: input.prompt,
    responseMessages: input.responseMessages,
    text: input.result.text,
  });
  const ask = (toolChoice: ReportRepairRequest["toolChoice"]) =>
    input.generate({ tools, toolChoice, messages });

  try {
    const repair = await ask(FORCED_REPORT_CHOICE).catch((error: unknown) => {
      if (!isRejectedRequest(error)) throw error;
      console.warn(
        "[pr-review] provider rejected a forced report; asking without forcing",
        { error }
      );
      return ask("auto");
    });
    return {
      ...mergeAutomationAgentResults([input.result, repair]),
      text: input.result.text,
    };
  } catch (error) {
    console.warn("[pr-review] could not recover the missing review report", {
      error,
    });
    return input.result;
  }
}
