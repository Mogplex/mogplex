import { tool } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { finishPrReview } from "./pr-review-self-revision";
import {
  extractPrReviewHarnessResult,
  isPrReviewVerdictMissing,
} from "./pr-review-harness-extraction";
import { buildPrReviewCheckTitle } from "./pr-review-harness-formatting";

it.each([{ steps: [] }, { steps: [{ toolCalls: [], toolResults: [] }] }])(
  "keeps an unstarted review incomplete instead of forcing a clean report (%j)",
  async ({ steps }) => {
    let requests = 0;
    const result = await finishPrReview({
      result: {
        text: "Review not started; no diff was read.",
        steps,
        usage: null,
      },
      responseMessages: undefined,
      prompt: "Review PR #625.",
      tools: {
        reportReview: tool({
          inputSchema: z.object({ hasIssues: z.boolean() }),
        }),
      },
      generate: async () => {
        requests++;
        return {
          text: "",
          steps: [
            {
              toolCalls: [
                {
                  toolName: "reportReview",
                  input: {
                    hasIssues: false,
                    summary: "No findings because no diff was read.",
                  },
                },
              ],
            },
          ],
          usage: null,
        };
      },
      judge: async () => [],
    });
    const harnessResult = extractPrReviewHarnessResult(result);
    expect(requests).toBe(0);
    expect(isPrReviewVerdictMissing(harnessResult)).toBe(true);
    expect(
      buildPrReviewCheckTitle({ harnessResult, conclusion: "neutral" })
    ).toBe("Review incomplete");
  }
);
