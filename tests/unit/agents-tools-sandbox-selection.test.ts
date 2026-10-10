import assert from "node:assert/strict";
import test from "node:test";
import {
  loadToolsModule,
  withEnv,
  withPatchedFetch,
  withPatchedSandboxLookup,
} from "./helpers/agents-tools-fixtures";

test("terminal_exec refuses to guess when multiple repo sandboxes are running", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      [{ id: "sandbox-record-1" }, { id: "sandbox-record-2" }],
      async () => {
        let fetched = false;
        await withPatchedFetch(
          async () => {
            fetched = true;
            return Response.json({ exitCode: 0 });
          },
          async () => {
            const { createTerminalExec } = await loadToolsModule();
            const tool = createTerminalExec(
              undefined,
              "user-123",
              "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b"
            ) as unknown as {
              execute: (input: { command: string }) => Promise<unknown>;
            };

            assert.deepEqual(await tool.execute({ command: "pwd" }), {
              error:
                "Multiple running sandboxes are available for this repository. Call start_sandbox with one of the listed sandboxId values. Use the branch and directory to identify the intended workspace; ask the user if it is unclear. Keep the other sandboxes running.",
              reason: "multiple_sandboxes",
              sandboxes: [
                { id: "sandbox-record-1" },
                { id: "sandbox-record-2" },
              ],
              command: "pwd",
            });
          }
        );
        assert.equal(fetched, false);
      }
    );
  });
});
