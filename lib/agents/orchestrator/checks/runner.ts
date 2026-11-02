import {
  controlToolOutcome,
  controlToolFailureDetail,
} from "@/lib/control/tool-outcome";
import { CHECK_KINDS, type PlannedRepositoryCheck } from "./plan";
import type { RepositoryCheckResult } from "./receipt";

export type { RepositoryCheckResult } from "./receipt";

const UNCONFIRMED =
  "Command completion could not be confirmed. Inspect its status before retrying.";

/** A failed check does not hide the other results. An unknown command outcome
 * stops the sequence: launching another check could overlap a live command. */
export async function runRepositoryChecks(
  plan: PlannedRepositoryCheck[],
  execute: (command: string) => Promise<unknown>,
  signal?: AbortSignal
): Promise<{ ok: boolean; checks: RepositoryCheckResult[] }> {
  const checks: RepositoryCheckResult[] = [];
  let unknownOutcome = false;
  for (const kind of CHECK_KINDS) {
    signal?.throwIfAborted();
    const planned = plan.find((check) => check.kind === kind);
    const command = planned?.command ?? null;
    if (!command) {
      checks.push({
        kind,
        command,
        status: "not_run",
        exitCode: null,
        reason: planned?.reason ?? `No ${kind} command was planned.`,
      });
      continue;
    }
    if (unknownOutcome) {
      checks.push({
        kind,
        command,
        status: "blocked",
        exitCode: null,
        reason:
          "The previous check has no confirmed result. Inspect it before starting another command.",
      });
      continue;
    }
    let output: unknown;
    try {
      output = await execute(command);
    } catch {
      signal?.throwIfAborted();
      // The boundary may have lost observation after starting the command.
      // Do not replay it or expose an infrastructure exception as user copy.
      output = undefined;
    }
    signal?.throwIfAborted();
    const record =
      output && typeof output === "object" && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : {};
    const exitCode =
      typeof record.exitCode === "number" && Number.isInteger(record.exitCode)
        ? record.exitCode
        : null;
    const stdout =
      typeof record.stdout === "string" ? record.stdout : undefined;
    const stderr =
      typeof record.stderr === "string" ? record.stderr : undefined;
    if (exitCode === null) {
      unknownOutcome = true;
      checks.push({
        kind,
        command,
        status: "blocked",
        exitCode,
        stdout,
        stderr,
        reason: UNCONFIRMED,
      });
      continue;
    }
    const passed = controlToolOutcome("output-available", record) === "done";
    checks.push({
      kind,
      command,
      status: passed ? "passed" : "failed",
      exitCode,
      stdout,
      stderr,
      ...(passed ? {} : { reason: controlToolFailureDetail(record) }),
    });
  }
  return { ok: checks.every((check) => check.status === "passed"), checks };
}
