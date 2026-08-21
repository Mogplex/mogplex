import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveControlPromptSandboxContext,
  resolveControlToolSandboxId,
} from "../../app/api/control/chat/_lib/sandbox-context";

test("control prompt labels an inactive selected sandbox and withholds tool binding", async () => {
  const context = await resolveControlPromptSandboxContext(
    new Request("https://app.mogplex.com/api/control/chat"),
    "user-1",
    { messages: [], repoId: "repo-1", sandboxId: "sandbox-record-1" },
    {
      listRepoSandboxes: async () => [],
      loadSandboxRecord: async () => ({
        ok: true,
        auth: {} as never,
        record: {
          id: "sandbox-record-1",
          sandbox_id: "sbx-runtime-1",
          repo_id: "repo-1",
          working_branch: "main",
          status: "stopped",
        },
        repo: null,
        rootDirectory: null,
      }),
    }
  );

  assert.deepEqual(context, {
    decisionSource: "server_validated_request",
    rejectionReason: "sandbox_inactive",
    selectionRequired: false,
    selected: null,
    sandboxes: [{ id: "sandbox-record-1", branch: "main", status: "stopped" }],
  });
  assert.equal(resolveControlToolSandboxId(context), null);
});

test("control tool binding independently rejects an inconsistent inactive selection", () => {
  assert.equal(
    resolveControlToolSandboxId({
      decisionSource: "server_validated_request",
      rejectionReason: null,
      selectionRequired: false,
      selected: { recordId: "sandbox-record-1", runtimeId: "runtime-1" },
      sandboxes: [
        { id: "sandbox-record-1", branch: "main", status: "stopped" },
      ],
    }),
    null
  );
});
