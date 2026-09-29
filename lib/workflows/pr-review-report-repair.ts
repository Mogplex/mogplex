import type { ModelMessage, ToolSet } from "ai";
import type { AutomationAgentResult } from "./automation-job-types";
import { mergeAutomationAgentResults } from "./automation-job-metadata";
import { AutomationModelExecutionError } from "./automation-model-execution-errors";
import {
  readReviewReportState,
  REPORT_REVIEW_TOOL_NAME,
  type ReviewReportState,
} from "./pr-review-report-state";

/** Asks for the record of the review that already happened, not a new one. */
export const PR_REVIEW_REPORT_REPAIR_PROMPT =
  "You finished this review without calling reportReview, so nothing was recorded and the pull request has no verdict. Call reportReview now with the verdict and findings from the review you just did. Do not start a new review and do not call any other tool.";

/** Asks for the findings a report claimed and then dropped. */
export const PR_REVIEW_DROPPED_FINDINGS_PROMPT =
  "Your review said it found issues, but no report you filed lists them, so the pull request has no verdict. Call reportReview now with every issue from the review you just did as an entry in findings, each with severity, title, body, and path; non-blocking ones are severity suggestion and can go with hasIssues=false. Do not start a new review and do not call any other tool.";

const REPAIR_PROMPTS: Record<
  Exclude<ReviewReportState["kind"], "filed">,
  string
> = {
  missing: PR_REVIEW_REPORT_REPAIR_PROMPT,
  dropped_findings: PR_REVIEW_DROPPED_FINDINGS_PROMPT,
};

const FORCED_REPORT_CHOICE = {
  type: "tool",
  toolName: REPORT_REVIEW_TOOL_NAME,
} as const;

export type ReportRepairRequest = {
  tools: ToolSet;
  toolChoice: typeof FORCED_REPORT_CHOICE | "auto";
  messages: ModelMessage[];
};

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
  request: string;
}): ModelMessage[] {
  const transcript: ModelMessage[] = input.responseMessages?.length
    ? input.responseMessages
    : [{ role: "assistant", content: input.text || "Review finished." }];
  return [
    { role: "user", content: input.prompt },
    ...transcript,
    { role: "user", content: input.request },
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
 * When a review ends without a structured report it can trust (none was
 * accepted, or the accepted one dropped the issues it claimed), ask the same
 * model once to file it from the work it already did. The report is forced where the
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
  const state = readReviewReportState(input.result.steps);
  if (state.kind === "filed") return input.result;
  const tools = buildReportOnlyTools(input.tools);
  if (!tools) return input.result;

  const messages = buildReportRepairMessages({
    prompt: input.prompt,
    responseMessages: input.responseMessages,
    text: input.result.text,
    request: REPAIR_PROMPTS[state.kind],
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
