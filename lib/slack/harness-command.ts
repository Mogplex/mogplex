import {
  MOGPLEX_API_RUN_HARNESSES as MOGPLEX_API_HARNESSES,
  type MogplexApiRunHarness as MogplexApiHarness,
} from "@/lib/mogplex-api/runs-types";
import type {
  getSlackHarnessPreference,
  upsertSlackHarnessPreference,
  SlackHarnessScope,
} from "./harness-preferences";

export type SlackHarnessCommandDeps = {
  getHarnessPreference: typeof getSlackHarnessPreference;
  saveHarnessPreference: typeof upsertSlackHarnessPreference;
};

/** Called only after the signed command's Slack actor has been authorized. */
export async function slackHarnessCommandText(
  deps: SlackHarnessCommandDeps,
  scope: SlackHarnessScope,
  argument: string
): Promise<string> {
  const harness = argument.trim().toLowerCase();
  const usage =
    "Usage: `/harness [mogplex|codex|claude-code]` or `/mogplex harness [mogplex|codex|claude-code]`.";
  if (!harness) {
    const saved = await deps.getHarnessPreference(scope);
    return `Current harness: ${saved ?? "mogplex"} (${saved ? "selected for you in this channel" : "default"}).\n${usage}\nApplies to new repository runs, not conversational replies. Existing runs are unchanged.`;
  }
  if (!MOGPLEX_API_HARNESSES.includes(harness as MogplexApiHarness))
    return usage;
  await deps.saveHarnessPreference({
    ...scope,
    harness: harness as MogplexApiHarness,
  });
  return `Harness set to ${harness} for your next repository run in this channel. Existing runs are unchanged.`;
}
