import assert from "node:assert/strict";
import test from "node:test";
import { loadMemoriesClient } from "./helpers/memories-client-fixtures";

test("validateMetadata returns undefined for null/undefined", async () => {
  const { validateMetadata } = await loadMemoriesClient();
  assert.equal(validateMetadata(undefined), undefined);
  assert.equal(validateMetadata(null), undefined);
});

test("validateMetadata accepts plain objects", async () => {
  const { validateMetadata } = await loadMemoriesClient();
  const input = { source: "chat", nested: { ok: true } };
  assert.deepEqual(validateMetadata(input), input);
});

test("validateMetadata rejects arrays, primitives, and non-plain objects", async () => {
  const { validateMetadata, InvalidMetadataError } = await loadMemoriesClient();
  for (const bad of [[], "string", 42, true, new Date()]) {
    assert.throws(
      () => validateMetadata(bad),
      (err: unknown) => err instanceof InvalidMetadataError
    );
  }
});

test("validateMetadata rejects payloads over MAX_METADATA_BYTES", async () => {
  const { validateMetadata, MAX_METADATA_BYTES, InvalidMetadataError } =
    await loadMemoriesClient();
  const huge = { data: "x".repeat(MAX_METADATA_BYTES + 1) };
  assert.throws(
    () => validateMetadata(huge),
    (err: unknown) =>
      err instanceof InvalidMetadataError && err.message.includes("exceeds")
  );
});

test("getMemoryScopeForLane keeps conversation scope inside a workspace session", async () => {
  const { getMemoryScopeForLane } = await loadMemoriesClient();

  assert.deepEqual(
    getMemoryScopeForLane("session", {
      repoId: "repo-1",
      workspaceSessionId: "ws-1",
      conversationId: "conv-1",
      resourceScope: "team",
      productTeamId: "team-1",
      sandboxId: "sbx-1",
    }),
    {
      repoId: "repo-1",
      workspaceSessionId: "ws-1",
      conversationId: "conv-1",
      resourceScope: "team",
      productTeamId: "team-1",
    }
  );
});

test("buildLaneScopedMetadata applies lane-specific scope fields", async () => {
  const { buildLaneScopedMetadata } = await loadMemoriesClient();

  assert.deepEqual(
    buildLaneScopedMetadata(
      "session",
      { role: "user" },
      {
        repoId: "repo-1",
        workspaceSessionId: "ws-1",
        conversationId: "conv-1",
        sandboxId: "sbx-1",
        source: "native-chat",
        agent: "native",
      }
    ),
    {
      role: "user",
      repo_id: "repo-1",
      workspace_session_id: "ws-1",
      conversation_id: "conv-1",
      sandbox_id: "sbx-1",
      source: "native-chat",
      agent: "native",
    }
  );

  assert.deepEqual(
    buildLaneScopedMetadata(
      "episodic",
      { outcome: "completed" },
      {
        repoId: "repo-1",
        workspaceSessionId: "ws-1",
        conversationId: "conv-1",
      }
    ),
    {
      outcome: "completed",
      repo_id: "repo-1",
      workspace_session_id: "ws-1",
    }
  );

  assert.deepEqual(
    buildLaneScopedMetadata(
      "semantic",
      { topic: "repo" },
      {
        repoId: "repo-1",
        resourceScope: "team",
        productTeamId: "team-1",
        workspaceSessionId: "ws-1",
        conversationId: "conv-1",
      }
    ),
    {
      topic: "repo",
      repo_id: "repo-1",
      resource_scope: "team",
      product_team_id: "team-1",
    }
  );
});

test("buildLaneScopedMetadata enforces the final metadata size cap after scope fields are merged", async () => {
  const { buildLaneScopedMetadata, InvalidMetadataError, MAX_METADATA_BYTES } =
    await loadMemoriesClient();

  const almostTooLarge = {
    note: "x".repeat(MAX_METADATA_BYTES - 32),
  };

  assert.throws(
    () =>
      buildLaneScopedMetadata("session", almostTooLarge, {
        repoId: "repo-123",
        workspaceSessionId: "workspace-123",
        conversationId: "conversation-123",
        sandboxId: "sandbox-123",
        source: "native-chat",
        agent: "native",
      }),
    (error: unknown) => error instanceof InvalidMetadataError
  );
});
