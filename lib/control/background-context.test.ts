import { expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { guardControlBackgroundTools } from "./background-context";

it("preserves foreground tools and checks every background execution, including reads", async () => {
  let allowed = true;
  let executions = 0;
  const tools = {
    read: tool({
      inputSchema: z.object({}),
      execute: async () => ++executions,
    }),
    approval: tool({ inputSchema: z.object({}), needsApproval: true }),
  };
  expect(guardControlBackgroundTools(tools)).toBe(tools);
  const guarded = guardControlBackgroundTools(tools, async () => {
    if (!allowed) throw new Error("Superseded");
  });
  expect(guarded.approval).toBe(tools.approval);
  expect(
    await guarded.read.execute!({}, { toolCallId: "first", messages: [] })
  ).toBe(1);
  allowed = false;
  await expect(
    guarded.read.execute!({}, { toolCallId: "second", messages: [] })
  ).rejects.toThrow("Superseded");
  expect(executions).toBe(1);
  const signal = AbortSignal.abort(new Error("Stopped"));
  await expect(
    guarded.read.execute!(
      {},
      { toolCallId: "third", messages: [], abortSignal: signal }
    )
  ).rejects.toThrow("Stopped");
  expect(executions).toBe(1);
});
