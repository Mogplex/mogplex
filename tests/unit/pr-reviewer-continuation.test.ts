import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import { buildPRReviewTools } from "../../lib/agents/pr-reviewer";
import { executeAutomationTextGeneration } from "../../lib/workflows/automation-model-execution";
import {
  createSuccessfulModelResult,
  createTestAutomationModel,
  type TestAutomationModel,
} from "./helpers/automation-model-execution-fixtures";

const config = {
  githubToken: "test-token",
  owner: "acme",
  repo: "widgets",
  headOwner: "contributor",
  headRepo: "widgets-fork",
  prNumber: 42,
  defaultRef: "review-head-sha",
};

function textResponse(content: string) {
  return new Response(
    JSON.stringify({
      type: "file",
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
    })
  );
}

test("review loop reads every chunk, another file, and demoted content again", async () => {
  const chunks = Array.from({ length: 7 }, (_, i) =>
    `chunk-${i}\n`.padEnd(20_000, String(i))
  );
  const source = chunks.join("") + "controller tail";
  const reads = [
    ...chunks.map((_, i) => ({
      path: "src/controller.ts",
      offset: i * 20_000,
      expected: chunks[i],
    })),
    { path: "src/controller.ts", offset: 140_000, expected: "controller tail" },
    { path: "src/reload-guard.ts", offset: 0, expected: "reload guard" },
    { path: "src/controller.ts", offset: 0, expected: chunks[0] },
  ];
  const tools = buildPRReviewTools({
    ...config,
    fetch: async (input) => {
      const url = new URL(input.toString());
      assert.equal(url.searchParams.get("ref"), config.defaultRef);
      assert.ok(
        url.pathname.startsWith("/repos/contributor/widgets-fork/contents/")
      );
      return textResponse(
        url.pathname.endsWith("reload-guard.ts") ? "reload guard" : source
      );
    },
  });
  let step = 0;
  let sawDemotedOutput = false;
  const model: TestAutomationModel = {
    ...createTestAutomationModel().model,
    async doGenerate({ prompt }) {
      if (step > 0) {
        const last = prompt.at(-1);
        assert.equal(last?.role, "tool");
        if (last?.role !== "tool") throw new Error("Missing file response");
        const part = last.content[0];
        assert.equal(part.type, "tool-result");
        if (part.type !== "tool-result") throw new Error("Missing tool result");
        const output = part.output;
        assert.equal(output.type, "text");
        if (output.type !== "text") throw new Error("Missing text response");
        assert.ok(output.value.startsWith(reads[step - 1].expected));
        assert.ok(output.value.length < 20_500);
      }
      sawDemotedOutput ||= JSON.stringify(prompt).includes(
        "[tool output demoted"
      );
      const result = createSuccessfulModelResult() as Awaited<
        ReturnType<TestAutomationModel["doGenerate"]>
      >;
      const next = reads[step++];
      if (!next) return result;
      return {
        ...result,
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        content: [
          {
            type: "tool-call",
            toolCallId: `read-${step}`,
            toolName: "fetchFile",
            input: JSON.stringify({ path: next.path, offset: next.offset }),
          },
        ],
      };
    },
  };
  const { result } = await executeAutomationTextGeneration({
    phase: "pr_review",
    generateText,
    request: {
      model,
      tools,
      prompt: "Review the controller and reload guard.",
      stopWhen: [],
    },
  });
  assert.equal(result.text, "done");
  assert.equal(step, reads.length + 1);
  assert.equal(sawDemotedOutput, true);
});

test("fetchFile validates continuation offsets and reports end-of-file", async () => {
  const tools = buildPRReviewTools({
    ...config,
    fetch: async () => textResponse("abc"),
  });
  const schema = tools.fetchFile.inputSchema as {
    safeParse: (input: unknown) => { success: boolean };
  };
  for (const offset of [-1, 1.5, "2", Number.POSITIVE_INFINITY]) {
    assert.equal(
      schema.safeParse({ path: "src/file.ts", offset }).success,
      false
    );
  }
  const execute = tools.fetchFile.execute!;
  const options = { toolCallId: "test", messages: [] };
  assert.equal(await execute({ path: "src/file.ts", offset: 3 }, options), "");
  const beyond = await execute({ path: "src/file.ts", offset: 4 }, options);
  assert.ok(typeof beyond === "string");
  assert.match(beyond, /beyond the end/);
});

test("fetchFile keeps explicit refs and propagates GitHub authorization errors", async () => {
  const tools = buildPRReviewTools({
    ...config,
    fetch: async (input) => {
      assert.equal(
        new URL(input.toString()).searchParams.get("ref"),
        "base-sha"
      );
      return new Response("forbidden", { status: 403 });
    },
  });
  await assert.rejects(
    async () =>
      tools.fetchFile.execute!(
        { path: "src/controller.ts", ref: "base-sha", offset: 20_000 },
        { toolCallId: "test", messages: [] }
      ),
    /GitHub API 403/
  );
});
