import assert from "node:assert/strict";
import test from "node:test";
import {
  loadToolsModule,
  withEnv,
  withPatchedFetch,
} from "./helpers/agents-tools-fixtures";

function stream(events: unknown[]) {
  return new Response(
    ": keepalive\n\n" +
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

async function execute(response: Response) {
  let requests = 0;
  let accept: string | null = null;
  const result = await withEnv(
    { INTERNAL_API_SECRET: "internal-secret" },
    async () =>
      withPatchedFetch(
        async (_url, init) => {
          requests++;
          accept = new Headers(init?.headers).get("accept");
          return response;
        },
        async () => {
          const { createTerminalExec } = await loadToolsModule();
          const tool = createTerminalExec(
            "sandbox-record-1",
            "user-123"
          ) as unknown as {
            execute: (input: { command: string }) => Promise<unknown>;
          };
          return tool.execute({ command: "pwd" });
        }
      )
  );
  assert.equal(
    requests,
    1,
    "a disconnected observation must never replay the command"
  );
  return { result, accept };
}

test("agent bash consumes SSE and returns bounded command output", async () => {
  const { result, accept } = await execute(
    stream([
      { type: "run", cmdId: "cmd-test" },
      { type: "log", stream: "stdout", data: "x".repeat(12_000) },
      { type: "log", stream: "stderr", data: "y".repeat(6000) },
      { type: "done", exitCode: 7, cwd: "/workspace" },
    ])
  );
  assert.equal(accept, "text/event-stream");
  assert.deepEqual(result, {
    command: "pwd",
    sandboxId: "sandbox-record-1",
    sandboxResolution: "selected",
    exitCode: 7,
    stdout: "x".repeat(10_000),
    stderr: "y".repeat(5000),
  });
});

test("agent bash surfaces premature EOF instead of claiming success", async () => {
  const { result } = await execute(
    stream([{ type: "run", cmdId: "cmd-test" }])
  );
  assert.match(
    (result as { error: string }).error,
    /before command completion/
  );
});

for (const event of [
  { type: "error", data: "Command transport failed" },
  { type: "cancelled" },
]) {
  test(`agent bash preserves ${event.type} as failure without replay`, async () => {
    const { result } = await execute(stream([event]));
    assert.match(
      (result as { error: string }).error,
      event.type === "error" ? /Command transport failed/ : /cancelled/i
    );
    assert.equal("exitCode" in (result as object), false);
  });
}

for (const status of [400, 401, 403]) {
  test(`agent bash preserves HTTP ${status} errors`, async () => {
    const { result } = await execute(
      Response.json({ error: "Request rejected" }, { status })
    );
    assert.equal((result as { error: string }).error, "Request rejected");
  });
}
