import { expect, it } from "vitest";
import { tool, jsonSchema } from "ai";
import { serializeSandboxCommandTools } from "./serialized-commands";

it("serializes shared-sandbox reads without delaying unrelated worker dispatch", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starts: string[] = [];
  const commands = serializeSandboxCommandTools({
    diff_worktree: tool({
      inputSchema: jsonSchema<{ id: string }>({ type: "object" }),
      execute: async ({ id }) => {
        starts.push(id);
        if (id === "one") await gate;
        return { diff: id };
      },
    }),
    spawn_subagent: tool({
      inputSchema: jsonSchema<{}>({ type: "object" }),
      execute: async () => {
        starts.push("worker");
        return "started";
      },
    }),
  });
  const options = { toolCallId: "call", messages: [] };
  const first = commands.diff_worktree.execute!({ id: "one" }, options);
  const second = commands.diff_worktree.execute!({ id: "two" }, options);
  await commands.spawn_subagent.execute!({}, options);
  expect(starts).toEqual(["worker", "one"]);
  release();
  expect(await Promise.all([first, second])).toEqual([
    { diff: "one" },
    { diff: "two" },
  ]);
  expect(starts).toEqual(["worker", "one", "two"]);
});

it("does not replay a failed command or poison the next queued read", async () => {
  const attempts: string[] = [];
  const commands = serializeSandboxCommandTools({
    run_command: tool({
      inputSchema: jsonSchema<{ id: string }>({ type: "object" }),
      execute: async ({ id }) => {
        attempts.push(id);
        if (id === "bad") throw new Error("Command failed");
        return "ok";
      },
    }),
  });
  const options = { toolCallId: "call", messages: [] };
  const first = commands.run_command.execute!({ id: "bad" }, options);
  const second = commands.run_command.execute!({ id: "good" }, options);
  await expect(first).rejects.toThrow("Command failed");
  expect(await second).toBe("ok");
  expect(attempts).toEqual(["bad", "good"]);
});

it("does not execute queued commands after the user cancels", async () => {
  let called = false;
  const controller = new AbortController();
  const commands = serializeSandboxCommandTools({
    run_command: tool({
      inputSchema: jsonSchema<{}>({ type: "object" }),
      execute: async () => {
        called = true;
        return "done";
      },
    }),
  });
  controller.abort(new Error("Cancelled"));
  await expect(
    commands.run_command.execute!(
      {},
      { toolCallId: "call", messages: [], abortSignal: controller.signal }
    )
  ).rejects.toThrow("Cancelled");
  expect(called).toBe(false);
});
