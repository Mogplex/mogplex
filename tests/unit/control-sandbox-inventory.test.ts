import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveControlPromptSandboxContext,
  resolveControlToolSandboxId,
} from "../../app/api/control/chat/_lib/context";

const request = new Request("https://app.mogplex.com/api/control/chat");

test("control prompt inventories multiple running repo sandboxes and requires selection", async () => {
  const context = await resolveControlPromptSandboxContext(
    request,
    "user-1",
    { messages: [], repoId: "repo-1" },
    {
      listRepoSandboxes: async () => [
        {
          id: "sandbox-record-1",
          sandbox_id: "sbx-runtime-1",
          repo_id: "repo-1",
          working_branch: "main",
          status: "running",
        },
        {
          id: "sandbox-record-2",
          sandbox_id: "sbx-runtime-2",
          repo_id: "repo-1",
          working_branch: "feat/two",
          status: "running",
        },
      ],
      loadSandboxRecord: async () => {
        throw new Error("selection lookup should not run");
      },
    }
  );

  assert.deepEqual(context, {
    decisionSource: "none",
    rejectionReason: "multiple_sandboxes",
    selectionRequired: true,
    selected: null,
    sandboxes: [
      { id: "sandbox-record-1", branch: "main", status: "running" },
      {
        id: "sandbox-record-2",
        branch: "feat/two",
        status: "running",
      },
    ],
  });
  assert.equal(resolveControlToolSandboxId(context), null);
});

test("control prompt clears selection requirement after validating an explicit choice", async () => {
  const selected = {
    id: "sandbox-record-2",
    sandbox_id: "sbx-runtime-2",
    repo_id: "repo-1",
    working_branch: "feat/two",
    status: "running",
  };
  const context = await resolveControlPromptSandboxContext(
    request,
    "user-1",
    {
      messages: [],
      repoId: "repo-1",
      sandboxId: selected.id,
    },
    {
      listRepoSandboxes: async () => [
        {
          id: "sandbox-record-1",
          sandbox_id: "sbx-runtime-1",
          repo_id: "repo-1",
          working_branch: "main",
          status: "running",
        },
        selected,
      ],
      loadSandboxRecord: async () => ({
        ok: true,
        auth: {} as never,
        record: selected,
        repo: null,
        rootDirectory: null,
      }),
    }
  );

  assert.deepEqual(context, {
    decisionSource: "server_validated_request",
    rejectionReason: null,
    selectionRequired: false,
    selected: {
      recordId: "sandbox-record-2",
      runtimeId: "sbx-runtime-2",
    },
    sandboxes: [
      { id: "sandbox-record-2", branch: "feat/two", status: "running" },
    ],
  });
  assert.equal(resolveControlToolSandboxId(context), "sandbox-record-2");
});

test("control prompt server-selects exactly one running repo sandbox", async () => {
  const context = await resolveControlPromptSandboxContext(
    request,
    "user-1",
    { messages: [], repoId: "repo-1" },
    {
      listRepoSandboxes: async () => [
        {
          id: "sandbox-record-1",
          sandbox_id: "sbx-runtime-1",
          repo_id: "repo-1",
          working_branch: "main",
          status: "running",
        },
      ],
      loadSandboxRecord: async () => {
        throw new Error("selection lookup should not run");
      },
    }
  );

  assert.deepEqual(context, {
    decisionSource: "server_selected",
    rejectionReason: null,
    selectionRequired: false,
    selected: {
      recordId: "sandbox-record-1",
      runtimeId: "sbx-runtime-1",
    },
    sandboxes: [{ id: "sandbox-record-1", branch: "main", status: "running" }],
  });
  assert.equal(resolveControlToolSandboxId(context), "sandbox-record-1");
});

test("control prompt validates but does not bind a stopped sandbox for execution", async () => {
  const stopped = {
    id: "sandbox-record-stopped",
    sandbox_id: "sbx-runtime-stopped",
    repo_id: "repo-1",
    working_branch: "main",
    status: "stopped",
  };
  const context = await resolveControlPromptSandboxContext(
    request,
    "user-1",
    {
      messages: [],
      repoId: "repo-1",
      sandboxId: stopped.id,
    },
    {
      listRepoSandboxes: async () => [],
      loadSandboxRecord: async () => ({
        ok: true,
        auth: {} as never,
        record: stopped,
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
    sandboxes: [
      { id: "sandbox-record-stopped", branch: "main", status: "stopped" },
    ],
  });
  assert.equal(resolveControlToolSandboxId(context), null);
});
