import { decide, type DecisionHandle } from "./decide";
import { clipText, type DecisionState } from "./state";
import type { DecisionId, DecisionScope } from "./types";

const COMMAND_MAX_CHARS = 4000;
const OUTPUT_MAX_CHARS = 5000;

export type ShellDecisionScope = DecisionScope & {
  /**
   * False when a caller already gates risk elsewhere. Control does: its
   * policy wrapper turns a risky command into an operator approval.
   */
  riskGate?: boolean;
};

export type DecideFn = (
  id: DecisionId,
  state: DecisionState,
  scope: DecisionScope,
  options?: { baseline?: unknown }
) => Promise<Pick<DecisionHandle, "act" | "mode" | "verdict">>;

export const COMMAND_RISK_BLOCK_MESSAGE =
  "This command was not run. It appears to irreversibly change a remote system, for example a force push, a remote deletion, or dropping data. Tell the user what you intended and let them confirm or run it themselves, or use a safer alternative.";

export const OUTPUT_CHECK_NOTE =
  "The output suggests a step in this command failed even though the exit code was 0. Verify the result before relying on it.";

/** True when the command looks remote-destructive and the mode acts on it. */
export async function isRemoteDestructiveCommand(
  command: string,
  scope: DecisionScope,
  decideFn: DecideFn = decide
): Promise<boolean> {
  if (!command.trim()) return false;
  const outcome = await decideFn(
    "command_risk",
    { command: clipText(command, COMMAND_MAX_CHARS) },
    scope,
    { baseline: { guardBlocked: false } }
  );
  return outcome.act;
}

/**
 * Pre-execution gate for shell tools that have no approval path. Only blocks
 * in enforce mode; shadow and advise record the judgment and let the command
 * run.
 */
export async function checkCommandRisk(
  command: string,
  scope: ShellDecisionScope,
  decideFn: DecideFn = decide
): Promise<{ error: string; reason: "command_risk" } | null> {
  if (scope.riskGate === false || !command.trim()) return null;
  const outcome = await decideFn(
    "command_risk",
    { command: clipText(command, COMMAND_MAX_CHARS) },
    scope,
    { baseline: { guardBlocked: false } }
  );
  if (!(outcome.act && outcome.mode === "enforce")) return null;
  return { error: COMMAND_RISK_BLOCK_MESSAGE, reason: "command_risk" };
}

type ShellResult = {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  command?: string;
};

/**
 * A zero exit code is not proof of success: `set +e`, `|| true`, and piped
 * commands hide failed steps. When the output reads as a failure, say so on
 * the result the model sees.
 */
export async function annotateShellResult<T extends ShellResult>(
  result: T,
  scope: DecisionScope,
  decideFn: DecideFn = decide
): Promise<T | (T & { outputCheck: string })> {
  if (result.exitCode !== 0) return result;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (!output.trim()) return result;
  const outcome = await decideFn(
    "tool_result_failed",
    {
      command: clipText(result.command ?? "", COMMAND_MAX_CHARS),
      output: clipText(output, OUTPUT_MAX_CHARS),
    },
    scope,
    { baseline: { exitCode: 0 } }
  );
  return outcome.act ? { ...result, outputCheck: OUTPUT_CHECK_NOTE } : result;
}
