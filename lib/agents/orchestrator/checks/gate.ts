import type { Instructions, Tool, ToolSet } from "ai";
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
const PENDING_PROMPT = `<repository_verification_pending>
Checks are pending for the current workspace contents. A final answer or an unrelated/no-op command does not record check results. Finish any necessary source edits first, then call run_checks before ending this turn. Report the recorded outcomes honestly. Only use skip with the operator's explicit scope limit and reason.
</repository_verification_pending>`;

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
  const recordedCheckCalls = new Set<string>();

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
      // A broken connection is not proof the POST never started a command.
      // Read-only tools remain available; do not replay uncertain execution.
      block(UNCONFIRMED, true);
      throw error;
    }
  };
  const onToolEnd = (event: {
    toolCall: { toolName: string; toolCallId?: string };
    output?: unknown;
  }) => {
    if (event.toolCall.toolName !== "run_checks") return;
    const id = event.toolCall.toolCallId;
    if (id && recordedCheckCalls.has(id)) return;
    if (id) recordedCheckCalls.add(id);
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
    if (uncertainCommand)
      return {
        ok: false,
        error: UNCONFIRMED,
        reason: "verification_unconfirmed",
      };
    if (name === "run_checks") {
      // Fresh checks bind to their own first probe, including external edits
      // made after an earlier command was observed.
      state.invalidate();
      try {
        const output = await execute(input, options);
        options.abortSignal?.throwIfAborted();
        // Record before a queued edit starts; deduplicate the later SDK event.
        onToolEnd({
          toolCall: { toolName: name, toolCallId: options.toolCallId },
          output,
        });
        return output;
      } catch (error) {
        recordedCheckCalls.add(options.toolCallId);
        block(UNCONFIRMED, true);
        throw error;
      }
    }
    // GitHub-only work never provisions a VM just to open a pull request.
    if (
      DELIVERY_TOOLS.has(name) &&
      context.sandboxBinding?.status !== "running" &&
      !state.summary().changed
    )
      return execute(input, options);
    const args = record(input);
    const fileEdit = name === "write_file" || name === "edit_file";
    if (fileEdit && typeof args.path === "string") {
      const path = args.path
        .trim()
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "");
      if (isSafeRepoPath(path)) context.verificationPaths!.add(path);
    }
    const before = fileEdit ? null : await observe(options);
    if (before && !before.ok && uncertainCommand)
      return block(before.error, true);
    if (DELIVERY_TOOLS.has(name)) {
      // Inspection failure may allow repairs, never delivery without evidence.
      if (!before?.ok) return block(before?.error ?? UNCONFIRMED);
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
    if (fileEdit) {
      if (controlToolOutcome("output-available", output) === "done")
        state.invalidate();
      return output;
    }
    const result = record(output);
    if (
      name === "run_command" &&
      result.commandStarted !== false &&
      (typeof result.exitCode !== "number" ||
        !Number.isInteger(result.exitCode) ||
        controlToolOutcome("output-available", result) === "running")
    ) {
      block(UNCONFIRMED, true);
      return output;
    }
    // A confirmed failed inspection (e.g. Node is unavailable) must not stop
    // useful file edits, nor manufacture a passing verification receipt.
    const after = await observe(options);
    if (
      before?.ok &&
      after.ok &&
      before.sandboxId === after.sandboxId &&
      before.revision === after.revision &&
      name === "run_command" &&
      typeof args.command === "string"
    ) {
      const kind = matchRepositoryCheckCommand(
        args.command,
        typeof args.cwd === "string" ? args.cwd : undefined,
        buildRepositoryCheckPlan(before.manifest),
        before.directory
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
    prepareStep:
      (assertCurrent?: () => Promise<void>) =>
      async (step?: {
        initialInstructions?: Instructions;
        instructions?: Instructions;
      }) => {
        await assertCurrent?.();
        const required = state.summary().required;
        // Instructions are leading system content on every provider. Build
        // from the original instructions because SDK overrides carry forward.
        const original = step?.initialInstructions;
        const instructions =
          typeof original === "string"
            ? [{ role: "system" as const, content: original }]
            : Array.isArray(original)
              ? original
              : original
                ? [original]
                : [];
        return {
          ...(step
            ? {
                instructions: required
                  ? [
                      ...instructions,
                      { role: "system" as const, content: PENDING_PROMPT },
                    ]
                  : instructions,
              }
            : {}),
          ...(required ? { toolChoice: "required" as const } : {}),
        };
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
