import { z } from "zod";
import type { Tool } from "ai";
import { defineTool } from "@/lib/agents/tools/shared";
import {
  createTerminalExec,
  type SandboxCommandExecution,
} from "@/lib/agents/tools/sandbox";
import { postSandboxExec } from "@/lib/agents/tools/sandbox-http-execution";
import { controlToolOutcome } from "@/lib/control/tool-outcome";
import type { OrchestratorToolContext } from "../types";
import { controlDecisionScope } from "../decision-scope";
import { CHECK_KINDS, buildRepositoryCheckPlan } from "./plan";
import {
  buildCheckProbeCommand,
  repositoryCheckProbeSchema,
  type RepositoryCheckProbe,
} from "./probe";
import { runRepositoryChecks, type RepositoryCheckResult } from "./runner";

export type RepositoryCheckReceipt = {
  ok: boolean;
  checks: RepositoryCheckResult[];
  sandboxId?: string;
  receiptVersion: 1;
  workspaceRevisionBefore: string | null;
  workspaceRevisionAfter: string | null;
  error?: string;
};

type ExecutionOptions = Parameters<NonNullable<Tool["execute"]>>[1];
type CheckObservation =
  | ({ ok: true; sandboxId: string } & RepositoryCheckProbe)
  | { ok: false; error: string };

function createCheckTerminal(
  context: OrchestratorToolContext,
  inspection: boolean
) {
  const execution: SandboxCommandExecution = {
    ...context.sandboxExecution,
    execute: context.sandboxExecution?.execute ?? postSandboxExec,
    // Lost observation is never permission to repeat a possibly live check.
    retryOnSandboxLoss: false,
  };
  return createTerminalExec(
    context.sandboxId ?? undefined,
    context.userId,
    context.repoId ?? undefined,
    context.sandboxBinding,
    execution,
    inspection
      ? undefined
      : { ...controlDecisionScope(context), riskGate: false }
  );
}

export function createRepositoryCheckProbe(context: OrchestratorToolContext) {
  const terminal = createCheckTerminal(context, true);
  return async (options: ExecutionOptions): Promise<CheckObservation> => {
    options.abortSignal?.throwIfAborted();
    try {
      const output = await terminal.execute!(
        {
          command: buildCheckProbeCommand([
            ...(context.verificationPaths ?? []),
          ]),
        },
        options
      );
      options.abortSignal?.throwIfAborted();
      if (
        !output ||
        typeof output !== "object" ||
        !("exitCode" in output) ||
        output.exitCode !== 0 ||
        controlToolOutcome("output-available", output) !== "done"
      ) {
        return {
          ok: false,
          error:
            "Could not inspect the workspace revision and repository check commands.",
        };
      }
      const record = output as Record<string, unknown>;
      const parsed = repositoryCheckProbeSchema.safeParse(
        JSON.parse(typeof record.stdout === "string" ? record.stdout : "")
      );
      if (!parsed.success || typeof record.sandboxId !== "string") {
        return {
          ok: false,
          error:
            "Could not validate the workspace revision and repository check commands.",
        };
      }
      return { ok: true, sandboxId: record.sandboxId, ...parsed.data };
    } catch {
      options.abortSignal?.throwIfAborted();
      return {
        ok: false,
        error:
          "Could not inspect the workspace revision and repository check commands.",
      };
    }
  };
}

export function createRunChecksTool(context: OrchestratorToolContext) {
  const observe = createRepositoryCheckProbe(context);
  const terminal = createCheckTerminal(context, false);
  return defineTool({
    description:
      "Run the repository's full typecheck, lint, build, and test scripts in the selected workspace. Discovers the package manager and CI scripts, records each command's exit evidence, and verifies that source contents stayed unchanged. Missing, interrupted, or failed checks are never passing verification.",
    inputSchema: z.object({}),
    execute: async (
      _input: unknown,
      options: ExecutionOptions
    ): Promise<RepositoryCheckReceipt> => {
      const before = await observe(options);
      if (!before.ok) {
        return {
          ok: false,
          error: before.error,
          receiptVersion: 1,
          workspaceRevisionBefore: null,
          workspaceRevisionAfter: null,
          checks: CHECK_KINDS.map((kind) => ({
            kind,
            command: null,
            status: "blocked",
            exitCode: null,
            reason: before.error,
          })),
        };
      }
      const plan = before.manifest.available
        ? buildRepositoryCheckPlan(before.manifest)
        : CHECK_KINDS.map((kind) => ({
            kind,
            command: null,
            reason:
              "No package.json was found. Inspect repository instructions and CI to identify the applicable checks.",
          }));
      const result = await runRepositoryChecks(
        plan,
        async (command) => terminal.execute!({ command }, options),
        options.abortSignal
      );
      // A probe is another command too. Do not launch it after losing track
      // of a check that may still be running.
      const unknownOutcome = result.checks.some(
        (check) => check.status === "blocked"
      );
      const after = unknownOutcome ? null : await observe(options);
      const sameSource =
        after?.ok === true &&
        before.sandboxId === after.sandboxId &&
        before.revision === after.revision;
      return {
        ...result,
        ok: result.ok && sameSource,
        sandboxId: before.sandboxId,
        receiptVersion: 1,
        workspaceRevisionBefore: before.revision,
        workspaceRevisionAfter: after?.ok ? after.revision : null,
        ...(!unknownOutcome && !sameSource
          ? {
              error:
                "Workspace contents changed or could not be confirmed after verification. Check the final contents before declaring the work verified.",
            }
          : {}),
      };
    },
  });
}
