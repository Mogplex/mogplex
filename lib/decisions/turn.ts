import { decide, type DecisionHandle } from "./decide";
import { CLAIM_PAIRS } from "./definitions";
import { clipText, type DecisionState } from "./state";
import type { DecisionId, DecisionScope } from "./types";

const TOOL_INPUT_MAX_CHARS = 400;
const TOOL_OUTPUT_MAX_CHARS = 700;
const FINAL_MESSAGE_MAX_CHARS = 6000;
const CLAIM_LOG_MAX_CALLS = 40;
export const LOOP_WINDOW_SIZE = 6;

/** Structural view of an AI SDK step; only the fields the checks read. */
export type DecisionStep = {
  text?: string;
  toolCalls?: ReadonlyArray<{
    toolName: string;
    toolCallId?: string;
    input?: unknown;
  }>;
  toolResults?: ReadonlyArray<{
    toolName: string;
    toolCallId?: string;
    output?: unknown;
  }>;
  content?: ReadonlyArray<{
    type: string;
    toolCallId?: string;
    error?: unknown;
  }>;
};

export type ToolLogEntry = {
  tool: string;
  input: string;
  state: "success" | "error" | "unknown";
  output: string;
};

type TurnDecideFn = (
  id: DecisionId,
  state: DecisionState,
  scope: DecisionScope,
  options?: { baseline?: unknown; metadata?: Record<string, unknown> }
) => Promise<Pick<DecisionHandle, "act" | "answers" | "verdict" | "status">>;

function outputFailed(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const record = output as Record<string, unknown>;
  if (typeof record.error === "string" && record.error) return true;
  if (record.status === "policy_denied") return true;
  return typeof record.exitCode === "number" && record.exitCode !== 0;
}

/** Flatten steps into one ordered list of tool calls with their outcomes. */
export function buildToolLog(steps: readonly DecisionStep[]): ToolLogEntry[] {
  return steps.flatMap((step) => {
    const results = new Map(
      (step.toolResults ?? []).map((result) => [result.toolCallId, result])
    );
    const errors = new Map(
      (step.content ?? [])
        .filter((part) => part.type === "tool-error")
        .map((part) => [part.toolCallId, part.error])
    );
    return (step.toolCalls ?? []).map((call): ToolLogEntry => {
      const result = results.get(call.toolCallId);
      const thrown = errors.get(call.toolCallId);
      const failed = thrown !== undefined || outputFailed(result?.output);
      return {
        tool: call.toolName,
        input: clipText(call.input, TOOL_INPUT_MAX_CHARS),
        state: failed ? "error" : result ? "success" : "unknown",
        output: clipText(thrown ?? result?.output ?? "", TOOL_OUTPUT_MAX_CHARS),
      };
    });
  });
}

function finalMessage(steps: readonly DecisionStep[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const text = steps[index]?.text?.trim();
    if (text) return text;
  }
  return "";
}

export type ClaimVerificationResult = {
  unsupported: string[];
} | null;

/**
 * After a turn ends, compare what the final message claims with what the tool
 * log shows. Returns the unsupported claims when the mode acts, otherwise
 * null. A turn with no tools or no closing text has nothing to verify.
 */
export async function verifyTurnClaims(
  input: { steps: readonly DecisionStep[]; scope: DecisionScope },
  decideFn: TurnDecideFn = decide
): Promise<ClaimVerificationResult> {
  const message = finalMessage(input.steps);
  const toolLog = buildToolLog(input.steps);
  if (!message || toolLog.length === 0) return null;

  const outcome = await decideFn(
    "claim_verification",
    {
      final_message: clipText(message, FINAL_MESSAGE_MAX_CHARS),
      tool_results: toolLog.slice(-CLAIM_LOG_MAX_CALLS),
    },
    input.scope,
    { metadata: { toolCalls: toolLog.length } }
  );
  if (!outcome.act) return null;

  const probability = (key: string) => {
    const answer = outcome.answers?.[key];
    return answer?.type === "boolean" ? answer.probability : 0;
  };
  const unsupported = CLAIM_PAIRS.filter(
    ({ claim, evidence }) =>
      probability(claim) >= 0.5 && probability(evidence) < 0.5
  ).map(({ label }) => label);
  return { unsupported };
}

export function buildClaimNotice(unsupported: readonly string[]): string {
  const claims =
    unsupported.length > 0 ? unsupported.join(", ") : "its reported results";
  return `Verification check: the final message reports ${claims}, but the tool activity in this run does not show it. Review before relying on it.`;
}

/**
 * Observe whether the last few tool calls look like a loop. By policy this
 * never ends a run; it records the judgment and reports it to the caller.
 */
export async function checkForLoop(
  input: { steps: readonly DecisionStep[]; scope: DecisionScope },
  decideFn: TurnDecideFn = decide
): Promise<boolean> {
  const toolLog = buildToolLog(input.steps);
  if (toolLog.length < LOOP_WINDOW_SIZE) return false;
  const window = toolLog.slice(-LOOP_WINDOW_SIZE);
  const keys = window.map((entry) => `${entry.tool}:${entry.input}`);
  const maxRepeat = Math.max(
    ...keys.map((key) => keys.filter((other) => other === key).length)
  );
  const outcome = await decideFn("loop_check", window, input.scope, {
    baseline: {
      maxRepeat,
      errors: window.filter((entry) => entry.state === "error").length,
    },
    metadata: { toolCalls: toolLog.length },
  });
  return outcome.act;
}
