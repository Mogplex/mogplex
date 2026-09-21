import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "ai";
import {
  type CapturedGenerateTextOptions,
  FILED_CLEAN_REVIEW,
  loadAutomationJobWorkflowModule,
  makeStep,
  mockGithubPullRequestFetch,
} from "./helpers/automation-job-fixtures";

const SUFFIX =
  "<skills>\n## Invoked skills\n\n### Deploy checklist\n\n1. Run the tests.\n</skills>";

function reviewContext() {
  return {
    metadata: { pr_number: 42 },
    assignmentType: "pr_review",
    skillId: null,
    agent: {
      model: "minimax/minimax-m2.5",
      system_prompt: "Review carefully. Follow $deploy-checklist.",
      timeout_ms: 18000,
    },
    repo: {
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      default_branch: "main",
      github_installation_id: 123,
    },
  };
}

async function runReview(
  resolveSkills: (
    context: unknown,
    mode: string
  ) => Promise<{
    instructionsSuffix: string | null;
    tools: Record<string, Tool>;
  }>
) {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const github = mockGithubPullRequestFetch([42]);
  let options: CapturedGenerateTextOptions | null = null;
  try {
    const run = createAutomationAgentRunner({
      resolveSkills: resolveSkills as never,
      generateText: async (input) => {
        options = input as unknown as CapturedGenerateTextOptions;
        return {
          text: "done",
          steps: [
            makeStep({
              text: "done",
              inputTokens: 1,
              outputTokens: 1,
              toolCalls: FILED_CLEAN_REVIEW,
            }),
          ],
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        } as never;
      },
    });
    await run(reviewContext() as never, "github-token");
  } finally {
    github.restore();
  }
  assert.ok(options, "the model was called");
  return options as CapturedGenerateTextOptions;
}

function instructionsText(options: CapturedGenerateTextOptions) {
  return typeof options.instructions === "string"
    ? options.instructions
    : (options.instructions?.content ?? "");
}

test("a native automation node hands the model its skills and the tools to load more", async () => {
  const calls: Array<{ mode: string; prompt: unknown }> = [];
  const options = await runReview(async (context, mode) => {
    calls.push({
      mode,
      prompt: (context as ReturnType<typeof reviewContext>).agent.system_prompt,
    });
    return {
      instructionsSuffix: SUFFIX,
      tools: { find_skills: {} as Tool, load_skill: {} as Tool },
    };
  });

  assert.deepEqual(calls, [
    { mode: "native", prompt: "Review carefully. Follow $deploy-checklist." },
  ]);
  const instructions = instructionsText(options);
  assert.ok(instructions.includes("Review carefully."));
  assert.ok(
    instructions.endsWith(SUFFIX),
    "the skills block follows the node's own instructions"
  );
  const tools = options.tools as Record<string, unknown>;
  assert.ok("find_skills" in tools);
  assert.ok("load_skill" in tools);
  assert.ok("reportReview" in tools, "the role's own tools are kept");
  assert.equal(options.prompt, "Review PR #42.");
});

test("a native automation node without skills runs exactly as before", async () => {
  const options = await runReview(async () => ({
    instructionsSuffix: null,
    tools: {},
  }));
  assert.ok(!instructionsText(options).includes("<skills>"));
  assert.equal(
    "load_skill" in (options.tools as Record<string, unknown>),
    false
  );
});
