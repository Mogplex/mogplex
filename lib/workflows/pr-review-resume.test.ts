import type { ToolSet } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { validatePrReviewResume } from "./automation-pr-review-tools";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import type { JobContext } from "./automation-job-types";

afterEach(() => vi.unstubAllGlobals());
const context: JobContext = {
  assignmentType: "pr_review",
  skillId: null,
  agent: { model: "test/model", system_prompt: null },
  repo: { id: "repo", full_name: "acme/widgets", user_id: "owner" },
  metadata: { head_sha: "head", base_sha: "base" },
};

it.each([
  { head: { sha: "changed" }, base: { sha: "base" } },
  { head: { sha: "head" }, base: { sha: "changed" } },
  {},
])(
  "rejects saved evidence when the live PR refs no longer match: %j",
  async (body) => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(validatePrReviewResume(context, "fixture", 1)).rejects.toThrow(
      "pull request changed"
    );
  }
);

it("permits recovery for the exact live head and base", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ head: { sha: "head" }, base: { sha: "base" } })
  );
  await expect(
    validatePrReviewResume(context, "fixture", 1)
  ).resolves.toBeUndefined();
});

it("retains rejected issue claims from a saved review before allowing a merge", async () => {
  let requests = 0;
  const tools: ToolSet = buildPRReviewTools({
    owner: "acme",
    repo: "widgets",
    prNumber: 1,
    githubToken: "fixture",
    allowPrLifecycle: true,
    previousSteps: () => [
      {
        toolCalls: [
          {
            toolName: "reportReview",
            input: { hasIssues: true },
            invalid: true,
          },
        ],
      },
    ],
    fetch: async () => {
      requests++;
      throw new Error("must not merge");
    },
  });
  await tools.reportReview.execute!(
    { hasIssues: false, summary: "Clean" },
    { toolCallId: "report", messages: [], context: undefined }
  );
  const result = await tools.mergePullRequest.execute!(
    {},
    { toolCallId: "merge", messages: [], context: undefined }
  );
  expect(result).toMatchObject({ success: false });
  expect(requests).toBe(0);
});
