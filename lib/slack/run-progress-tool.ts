import { tool } from "ai";
import { z } from "zod";
import type { HarnessProgressUpdate } from "@/lib/mogplex-api/harness-progress";
import { progressText } from "./run-progress-state";

export const runProgressSchema = z.object({
  phase: z.enum(["Investigating", "Implementing", "Verifying", "Delivering"]),
  summary: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Brief user-facing account of what you found or changed, grounded in observed results. No hidden reasoning or raw logs."
    ),
  next: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The next concrete action, or the remaining prerequisite to delivery."
    ),
});

export const SLACK_RUN_PROGRESS_INSTRUCTIONS = `This coding run is visible to the user in Slack.
Use report_progress at the start and when the phase or a meaningful finding changes. State what was found or accomplished and the next concrete action. Do not report every command, speculate about completion percentages or time remaining, or reveal hidden reasoning, credentials, internal paths, or raw diagnostics.
Before a long test/build, explain what it will verify. A command starting is not a successful test. Report failures honestly and explain the next recovery step.
Your final response must say what changed, exactly what verification ran and its result, and link the actual PR or preview if created. Clearly identify anything unverified or unfinished. Never claim a checkpoint, saved changes, or a recoverable workspace without verifying it. Do not claim a reply was applied unless it was supplied to you in this run.`;

export function createRunProgressTool(
  report: (update: HarnessProgressUpdate) => Promise<void>
) {
  return tool({
    description:
      "Update this run's Slack progress with a meaningful finding, current phase, and next action. This does not pause the run or request user input.",
    inputSchema: runProgressSchema,
    execute: async ({ phase, summary, next }) => {
      await report({
        kind: "phase",
        phase,
        summary: progressText(summary),
        next: progressText(next, 200),
      });
      return { recorded: true };
    },
  });
}
