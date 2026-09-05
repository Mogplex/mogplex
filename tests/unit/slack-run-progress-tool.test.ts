import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunProgressTool,
  runProgressSchema,
} from "../../lib/slack/run-progress-tool";
import type { HarnessProgressUpdate } from "../../lib/mogplex-api/harness-progress";

test("progress tool publishes a sanitized finding and next step", async () => {
  const updates: HarnessProgressUpdate[] = [];
  const progress = createRunProgressTool(async (update) => {
    updates.push(update);
  });
  const input = runProgressSchema.parse({
    phase: "Verifying",
    summary: "Found <!channel> overlap in /vercel/sandbox/header.tsx",
    next: "Test mobile and desktop.",
  });
  assert.ok(progress.execute);
  const result = await progress.execute(input, {
    toolCallId: "p1",
    messages: [],
  });
  assert.deepEqual(result, { recorded: true });
  assert.deepEqual(updates, [
    {
      kind: "phase",
      phase: "Verifying",
      summary: "Found overlap in header.tsx",
      next: "Test mobile and desktop.",
    },
  ]);
});

test("progress schema rejects invented phases and empty progress", () => {
  for (const input of [
    { phase: "100% complete", summary: "Done", next: "Ship" },
    { phase: "Verifying", summary: " ", next: "Ship" },
    { phase: "Verifying", summary: "Fixed", next: "" },
  ])
    assert.equal(runProgressSchema.safeParse(input).success, false);
});

test("a reporting failure is not claimed as recorded", async () => {
  const progress = createRunProgressTool(async () => {
    throw new Error("Unavailable");
  });
  assert.ok(progress.execute);
  await assert.rejects(
    Promise.resolve(
      progress.execute(
        {
          phase: "Investigating",
          summary: "Inspecting the header",
          next: "Read the layout",
        },
        { toolCallId: "p1", messages: [] }
      )
    ),
    /Unavailable/
  );
});
