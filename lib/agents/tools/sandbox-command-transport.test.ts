import { afterEach, expect, it, vi } from "vitest";
import { createTerminalExec } from "./sandbox";
import { buildTools } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("the assembled tool set uses the transport without bypassing capability filtering", async () => {
  const http = vi.fn(async () => {
    throw new Error("unexpected HTTP call");
  });
  vi.stubGlobal("fetch", http);
  const sandboxExecution = {
    execute: async () =>
      Response.json({ exitCode: 0, stdout: "in-process", stderr: "" }),
    retryOnSandboxLoss: false,
  };
  const allowed = await buildTools({
    sandboxId: "sandbox-1",
    sandboxExecution,
    capabilities: new Set(["tools.bash"]),
  });
  await expect(
    allowed.tools.bash.execute!(
      { command: "echo test" },
      { toolCallId: "test", messages: [] }
    )
  ).resolves.toMatchObject({ exitCode: 0, stdout: "in-process" });
  const denied = await buildTools({
    sandboxId: "sandbox-1",
    sandboxExecution,
    capabilities: new Set(),
  });
  expect(denied.tools.bash).toBeUndefined();
  expect(http).not.toHaveBeenCalled();
});

it("background execution waits for the provider without a second HTTP request", async () => {
  vi.stubEnv("INTERNAL_API_SECRET", "fixture-secret");
  const http = vi.fn(
    async () => new Response("FUNCTION_INVOCATION_TIMEOUT", { status: 504 })
  );
  vi.stubGlobal("fetch", http);
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const tool = createTerminalExec("sandbox-1", "user-1", "repo-1", undefined, {
    execute: () => pending,
    retryOnSandboxLoss: false,
  });
  const result = tool.execute!(
    { command: "sleep 330 && printf done" },
    { toolCallId: "test", messages: [] }
  );
  finish(Response.json({ exitCode: 0, stdout: "done", stderr: "" }));
  await expect(result).resolves.toMatchObject({
    exitCode: 0,
    stdout: "done",
    sandboxId: "sandbox-1",
  });
  expect(http).not.toHaveBeenCalled();
});

it("does not provision or replay a native command when its sandbox is lost", async () => {
  vi.stubEnv("INTERNAL_API_SECRET", "fixture-secret");
  const http = vi.fn(async () =>
    Response.json({ error: "Sandbox is gone" }, { status: 410 })
  );
  vi.stubGlobal("fetch", http);
  let executions = 0;
  const tool = createTerminalExec("sandbox-1", "user-1", "repo-1", undefined, {
    execute: async () => {
      executions++;
      return Response.json({ error: "Sandbox is gone" }, { status: 410 });
    },
    retryOnSandboxLoss: false,
  });
  await expect(
    tool.execute!({ command: "do-work" }, { toolCallId: "test", messages: [] })
  ).resolves.toMatchObject({
    error: "Sandbox is gone",
    sandboxId: "sandbox-1",
  });
  expect(executions).toBe(1);
  expect(http).not.toHaveBeenCalled();
});
