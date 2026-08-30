import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlChatSessionContextError,
  resolveControlChatSessionContext,
} from "../../app/api/control/chat/_lib/context";

test("control chat rehydrates repository identity from the owned session", async () => {
  const resolved = await resolveControlChatSessionContext(
    "user-1",
    {
      messages: [],
      conversationId: "session-1",
      missionId: "client-mission",
      missionTitle: "Client title",
      model: "openai/gpt-5.6-sol",
      repoId: "client-repo",
      repoFullName: "attacker/spoofed",
      repoOwner: "attacker",
      repoName: "spoofed",
      repoBranch: "client-branch",
      repoBaseBranch: "client-base",
    },
    {
      loadSession: async () => ({
        id: "session-1",
        user_id: "user-1",
        title: "Review recent PRs",
        repo_id: "repo-1",
        model_id: "zai/glm-5.3-flash",
      }),
      loadRepo: async () => ({
        id: "repo-1",
        full_name: "Mogplex/mogplex",
        owner: "Mogplex",
        name: "mogplex",
        default_branch: "main",
      }),
    }
  );

  assert.deepEqual(resolved, {
    messages: [],
    conversationId: "session-1",
    missionId: "session-1",
    missionTitle: "Review recent PRs",
    model: "zai/glm-5.3-flash",
    repoId: "repo-1",
    repoFullName: "Mogplex/mogplex",
    repoOwner: "Mogplex",
    repoName: "mogplex",
    repoBranch: "main",
    repoBaseBranch: "main",
  });
});

test("control chat clears client repo hints for an unlinked session", async () => {
  const resolved = await resolveControlChatSessionContext(
    "user-1",
    {
      messages: [],
      conversationId: "session-2",
      model: "openai/gpt-5.6-sol",
      repoId: "client-repo",
      repoFullName: "attacker/spoofed",
    },
    {
      loadSession: async () => ({
        id: "session-2",
        user_id: "user-1",
        title: "General chat",
        repo_id: null,
        model_id: null,
      }),
      loadRepo: async () => {
        throw new Error("repo lookup should not run");
      },
    }
  );

  assert.equal(resolved.missionId, "session-2");
  assert.equal(resolved.missionTitle, "General chat");
  assert.equal(resolved.model, "openai/gpt-5.6-sol");
  assert.equal(resolved.repoId, null);
  assert.equal(resolved.repoFullName, null);
});

test("control chat rejects a conversation outside the authenticated user", async () => {
  await assert.rejects(
    resolveControlChatSessionContext(
      "user-1",
      { messages: [], conversationId: "session-3" },
      {
        loadSession: async () => null,
        loadRepo: async () => null,
      }
    ),
    (error) =>
      error instanceof ControlChatSessionContextError && error.status === 404
  );
});
