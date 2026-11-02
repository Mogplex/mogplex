import type { Tool, ToolSet } from "ai";
import { isSafeRepoPath } from "@/lib/sandbox/changes";
import { controlToolOutcome } from "@/lib/control/tool-outcome";
import type { OrchestratorToolContext } from "../types";
import { createRepositoryVerificationState } from "./state";
import { createRepositoryCheckProbe } from "./tool";
import { repositoryCheckReceiptSchema } from "./receipt";
import { buildRepositoryCheckPlan } from "./plan";
import { matchRepositoryCheckCommand } from "./manual";
import { runRepositoryChecks } from "./runner";

type ExecuteOptions = Parameters<NonNullable<Tool["execute"]>>[1];
const SOURCE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "run_command",
  "rebase_worktree",
]);
const DELIVERY_TOOLS = new Set(["open_pr", "git_push", "deploy"]);
const UNCONFIRMED =
  "Command completion could not be confirmed. Inspect its status before starting another command.";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Request-local evidence, inside authorization and outside protected-write
 * idempotency. A declined delivery must remain available after checks finish. */
export function createControlVerificationGate(
  context: OrchestratorToolContext,
  inspect = createRepositoryCheckProbe(context)
) {
  const state = createRepositoryVerificationState();
  context.verificationPaths ??= new Set();
  let uncertainCommand = false;
  let inFlight = 0;

  const block = (reason: string, uncertain = false) => {
    uncertainCommand ||= uncertain;
    state.block(reason);
    return { ok: false, error: reason, reason: "verification_unconfirmed" };
  };
  const observe = async (options: ExecuteOptions) => {
    try {
      const result = await inspect(options);
      if (result.ok) state.observe(result);
      else block(result.error, result.commandCompletion === "unknown");
      return result;
    } catch (error) {
      block(UNCONFIRMED, true);
      throw error;
    }
  };
  const onToolEnd = (event: {
    toolCall: { toolName: string };
    output?: unknown;
  }) => {
    if (event.toolCall.toolName !== "run_checks") return;
    const receipt = repositoryCheckReceiptSchema.safeParse(event.output);
    if (receipt.success) {
      state.recordReceipt(receipt.data);
      if (receipt.data.commandCompletion === "unknown") uncertainCommand = true;
    } else
      block(
        "Repository checks did not run. Review the tool's permission or execution result before retrying."
      );
  };

  const executeObserved = async (
    name: string,
    execute: NonNullable<Tool["execute"]>,
    input: unknown,
    options: ExecuteOptions
  ) => {
    options.abortSignal?.throwIfAborted();
    if (uncertainCommand) return block(UNCONFIRMED, true);
    if (name === "run_checks") {
      try {
        const output = await execute(input, options);
        options.abortSignal?.throwIfAborted();
        onToolEnd({ toolCall: { toolName: name }, output });
        return output;
      } catch (error) {
        block(UNCONFIRMED, true);
        throw error;
      }
    }
    // GitHub-only work never provisions a VM just to open a pull request.
    if (
      DELIVERY_TOOLS.has(name) &&
      context.sandboxBinding?.status !== "running"
    )
      return execute(input, options);
    const args = record(input);
    if (
      (name === "write_file" || name === "edit_file") &&
      typeof args.path === "string"
    ) {
      const path = args.path
        .trim()
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "");
      if (isSafeRepoPath(path)) context.verificationPaths!.add(path);
    }
    const before = await observe(options);
    if (!before.ok && uncertainCommand) return block(before.error, true);
    if (DELIVERY_TOOLS.has(name)) {
      state.requireChecks();
      if (state.summary().required)
        return {
          ok: false,
          reason: "verification_required",
          error:
            "Run the repository checks before delivering these workspace contents. Continue edits first if needed.",
        };
      return execute(input, options);
    }
    let output: unknown;
    try {
      options.abortSignal?.throwIfAborted();
      output = await execute(input, options);
      options.abortSignal?.throwIfAborted();
    } catch (error) {
      block(UNCONFIRMED, true);
      throw error;
    }
    const result = record(output);
    if (
      name === "run_command" &&
      (typeof result.exitCode !== "number" ||
        !Number.isInteger(result.exitCode) ||
        controlToolOutcome("output-available", result) === "running")
    ) {
      block(UNCONFIRMED, true);
      return output;
    }
    // A confirmed failed inspection (e.g. Node is unavailable) must not stop
    // useful file edits, nor manufacture a passing verification receipt.
    if (!before.ok) return output;
    const after = await observe(options);
    if (
      after.ok &&
      before.sandboxId === after.sandboxId &&
      before.revision === after.revision &&
      name === "run_command" &&
      typeof args.command === "string"
    ) {
      const kind = matchRepositoryCheckCommand(
        args.command,
        typeof args.cwd === "string" ? args.cwd : undefined,
        buildRepositoryCheckPlan(before.manifest)
      );
      if (kind) {
        const formatted = await runRepositoryChecks(
          [{ kind, command: args.command }],
          async () => output
        );
        state.recordManual(
          formatted.checks.find((check) => check.kind === kind)!
        );
      }
    }
    return output;
  };

  return {
    wrapTools(tools: ToolSet): ToolSet {
      return Object.fromEntries(
        Object.entries(tools).map(([name, current]) => {
          const execute = current.execute;
          if (
            !execute ||
            !(
              SOURCE_TOOLS.has(name) ||
              DELIVERY_TOOLS.has(name) ||
              name === "run_checks"
            )
          )
            return [name, current];
          return [
            name,
            {
              ...current,
              execute: async (input: unknown, options: ExecuteOptions) => {
                const observesSource =
                  SOURCE_TOOLS.has(name) || name === "run_checks";
                if (observesSource) inFlight++;
                try {
                  return await executeObserved(name, execute, input, options);
                } finally {
                  if (observesSource) inFlight--;
                }
              },
            },
          ];
        })
      );
    },
    prepareStep: (assertCurrent?: () => Promise<void>) => async () => {
      await assertCurrent?.();
      return state.summary().required
        ? { toolChoice: "required" as const }
        : {};
    },
    onToolEnd,
    interrupt() {
      if (inFlight > 0)
        block(
          "Verification was interrupted. Workspace files are preserved.",
          true
        );
      else if (state.summary().required)
        block("Checks were not completed before this turn stopped.");
    },
    metadata() {
      const summary = state.summary();
      return summary.changed ||
        summary.error ||
        summary.checks.some((check) => check.status !== "not_run")
        ? { version: 1 as const, ...summary }
        : undefined;
    },
    checkpoint:
      (capture: (name: string) => Promise<void>) => async (name: string) => {
        if (!uncertainCommand) await capture(name);
      },
    summary: state.summary,
  };
}
