import { expect, it } from "vitest";
import {
  installSandboxRows,
  OWNED_REPO_ID,
} from "../../../tests/support/sandbox-resolution-fixture";
import { createTerminalExec } from "./sandbox";
import type { SandboxRuntimeBinding } from "./sandbox-binding";

it("resumes the saved selection before executing against that same workspace", async () => {
  installSandboxRows([
    { id: "saved-workspace", status: "stopped", persistent: true },
  ]);
  const binding: SandboxRuntimeBinding = {
    sandboxId: "saved-workspace",
    status: "unavailable",
  };
  const requests: string[] = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    return new Response(
      'data: {"type":"ready","sandbox":{"id":"saved-workspace","status":"running"}}\n\n',
      { headers: { "Content-Type": "text/event-stream" } }
    );
  };
  const command = createTerminalExec(
    "saved-workspace",
    "owner",
    OWNED_REPO_ID,
    binding,
    {
      retryOnSandboxLoss: false,
      execute: async (sandboxId) => {
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatch(/\/sandbox\/saved-workspace\/resume$/);
        expect(sandboxId).toBe("saved-workspace");
        expect(binding.status).toBe("running");
        return Response.json({
          exitCode: 0,
          stdout: "saved-file-content",
          stderr: "",
        });
      },
    }
  );
  const result = await command.execute!(
    { command: "cat saved-work.txt" },
    { context: {}, toolCallId: "read", messages: [] }
  );
  expect(result).toMatchObject({
    sandboxId: "saved-workspace",
    stdout: "saved-file-content",
    exitCode: 0,
  });
});

it("never executes or replaces the selected workspace when resume fails", async () => {
  installSandboxRows([
    { id: "saved-workspace", status: "paused", persistent: true },
  ]);
  const binding: SandboxRuntimeBinding = {
    sandboxId: "saved-workspace",
    status: "unavailable",
  };
  let executed = false;
  global.fetch = async () =>
    Response.json({ error: "Resume unavailable" }, { status: 502 });
  const command = createTerminalExec(
    "saved-workspace",
    "owner",
    OWNED_REPO_ID,
    binding,
    {
      execute: async () => {
        executed = true;
        return Response.json({});
      },
    }
  );
  expect(
    await command.execute!(
      { command: "apply saved change" },
      { context: {}, toolCallId: "write", messages: [] }
    )
  ).toMatchObject({ error: "Resume unavailable" });
  expect(executed).toBe(false);
  expect(binding.sandboxId).toBe("saved-workspace");
});
