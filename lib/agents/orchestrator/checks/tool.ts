import type { Tool } from "ai";
import { z } from "zod";
import { defineTool } from "@/lib/agents/tools/shared";
import {
  createTerminalExec,
  type SandboxCommandExecution,
} from "@/lib/agents/tools/sandbox";
import { postSandboxExec } from "@/lib/agents/tools/sandbox-http-execution";
import { controlToolOutcome } from "@/lib/control/tool-outcome";
import type { OrchestratorToolContext } from "../types";
import { controlDecisionScope } from "../decision-scope";
import { CHECK_KINDS, buildRepositoryCheckPlan, type CheckKind } from "./plan";
import {
  buildCheckProbeCommand,
  repositoryCheckProbeSchema,
  type RepositoryCheckProbe,
} from "./probe";
import { runRepositoryChecks } from "./runner";
import { repositoryChecksModelOutput } from "./model-output";
import type { RepositoryCheckReceipt } from "./receipt";

export const runChecksSchema = z
  .object({
    skip: z.array(z.enum(CHECK_KINDS)).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .refine(
    (input) => !input.skip?.length || Boolean(input.reason),
    "Explain the operator's explicit request to skip checks."
  );

export type { RepositoryCheckReceipt } from "./receipt";

type ExecutionOptions = Parameters<NonNullable<Tool["execute"]>>[1];
type CheckObservation =
  | ({ ok: true; sandboxId: string } & RepositoryCheckProbe)
  | { ok: false; error: string; commandCompletion: "confirmed" | "unknown" };

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
    let commandConfirmed = false;
    const failure = (error: string): CheckObservation => ({
      ok: false,
      error,
      commandCompletion: commandConfirmed ? "confirmed" : "unknown",
    });
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
      commandConfirmed = Boolean(
        output &&
        typeof output === "object" &&
        (("commandStarted" in output && output.commandStarted === false) ||
          ("exitCode" in output &&
            typeof output.exitCode === "number" &&
            Number.isInteger(output.exitCode) &&
            controlToolOutcome("output-available", output) !== "running"))
      );
      if (
        !output ||
        typeof output !== "object" ||
        !("exitCode" in output) ||
        output.exitCode !== 0 ||
        controlToolOutcome("output-available", output) !== "done"
      ) {
        return failure(
          "Could not inspect the workspace revision and repository check commands."
        );
      }
      const record = output as Record<string, unknown>;
      const parsed = repositoryCheckProbeSchema.safeParse(
        JSON.parse(typeof record.stdout === "string" ? record.stdout : "")
      );
      if (!parsed.success || typeof record.sandboxId !== "string") {
        return failure(
          "Could not validate the workspace revision and repository check commands."
        );
      }
      return { ok: true, sandboxId: record.sandboxId, ...parsed.data };
    } catch {
      options.abortSignal?.throwIfAborted();
      return failure(
        "Could not inspect the workspace revision and repository check commands."
      );
    }
  };
}

export function createRunChecksTool(context: OrchestratorToolContext) {
  const observe = createRepositoryCheckProbe(context);
  const terminal = createCheckTerminal(context, false);
  return defineTool({
    toModelOutput: repositoryChecksModelOutput,
    description:
      "Run the repository's full typecheck, lint, build, and test scripts in the selected workspace. Discovers the package manager and CI scripts, records each command's exit evidence, and verifies that source contents stayed unchanged. Missing, interrupted, failed, or skipped checks never count as full verification. Use skip only when the operator explicitly limits checks, and include their reason so every omission stays visible.",
    inputSchema: runChecksSchema,
    execute: async (
      input: { skip?: CheckKind[]; reason?: string },
      options: ExecutionOptions
    ): Promise<RepositoryCheckReceipt> => {
      const before = await observe(options);
      if (!before.ok) {
        return {
          ok: false,
          verified: false,
          error: before.error,
          receiptVersion: 1,
          commandCompletion: before.commandCompletion,
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
      const skipped = new Set(input.skip);
      const result = await runRepositoryChecks(
        plan.map((check) =>
          skipped.has(check.kind) ? { ...check, command: null } : check
        ),
        async (command) => terminal.execute!({ command }, options),
        options.abortSignal
      );
      result.checks = result.checks.map((check) =>
        skipped.has(check.kind)
          ? {
              ...check,
              status: "skipped",
              reason: `Omitted with the agent-reported reason: ${input.reason}`,
            }
          : check
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
        ok:
          result.checks.every(
            (check) => check.status === "passed" || check.status === "skipped"
          ) && sameSource,
        verified:
          result.checks.every((check) => check.status === "passed") &&
          sameSource,
        sandboxId: before.sandboxId,
        receiptVersion: 1,
        commandCompletion: after?.ok
          ? "confirmed"
          : after
            ? after.commandCompletion
            : "unknown",
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
