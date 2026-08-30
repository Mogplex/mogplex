import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatSessionContextError,
  resolveChatSessionContext,
} from "../../app/api/chat/_lib/session-context";

test("native chat rehydrates repository, branch, model, and workspace scope from the owned conversation", async () => {
  const resolved = await resolveChatSessionContext(
    new Request("https://app.mogplex.com/api/chat"),
    "user-1",
    {
      messages: [],
      conversationId: "conversation-1",
      model: "client/model",
      workspaceSessionId: "client-workspace",
      repoId: "client-repo",
      repoFullName: "attacker/spoofed",
      repoOwner: "attacker",
      repoName: "spoofed",
      repoBranch: "client-branch",
      repoBaseBranch: "client-base",
      sandboxId: "sandbox-1",
    },
    {
      loadConversation: async () => ({
        id: "conversation-1",
        user_id: "user-1",
        repo_id: "repo-1",
        workspace_session_id: "workspace-1",
        sandbox_id: "sandbox-1",
        model: "anthropic/claude-sonnet-4.6",
      }),
      loadRepo: async () => ({
        id: "repo-1",
        full_name: "Mogplex/mogplex",
        owner: "Mogplex",
        name: "mogplex",
        default_branch: "main",
      }),
      loadSandbox: async () => ({
        id: "sandbox-1",
        repo_id: "repo-1",
        working_branch: "fix/server-owned",
      }),
    }
  );

  assert.deepEqual(resolved, {
    messages: [],
    conversationId: "conversation-1",
    model: "anthropic/claude-sonnet-4.6",
    workspaceSessionId: "workspace-1",
    repoId: "repo-1",
    repoFullName: "Mogplex/mogplex",
    repoOwner: "Mogplex",
    repoName: "mogplex",
    repoBranch: "fix/server-owned",
    repoBaseBranch: "main",
    sandboxId: "sandbox-1",
  });
});

test("native chat clears project hints for a projectless saved conversation", async () => {
  const resolved = await resolveChatSessionContext(
    new Request("https://app.mogplex.com/api/chat"),
    "user-1",
    {
      messages: [],
      conversationId: "conversation-2",
      repoId: "client-repo",
      repoFullName: "attacker/spoofed",
      sandboxId: "sandbox-client",
    },
    {
      loadConversation: async () => ({
        id: "conversation-2",
        user_id: "user-1",
        repo_id: null,
        workspace_session_id: null,
        sandbox_id: null,
        model: "openai/gpt-5.6-sol",
      }),
      loadRepo: async () => {
        throw new Error("repo lookup should not run");
      },
      loadSandbox: async () => {
        throw new Error("sandbox lookup should not run");
      },
    }
  );

  assert.equal(resolved.repoId, null);
  assert.equal(resolved.repoFullName, null);
  assert.equal(resolved.sandboxId, null);
  assert.equal(resolved.workspaceSessionId, null);
});

test("native chat rejects a missing conversation and a mismatched sandbox", async () => {
  await assert.rejects(
    resolveChatSessionContext(
      new Request("https://app.mogplex.com/api/chat"),
      "user-1",
      { messages: [], conversationId: "missing" },
      {
        loadConversation: async () => null,
        loadRepo: async () => null,
        loadSandbox: async () => null,
      }
    ),
    (error) => error instanceof ChatSessionContextError && error.status === 404
  );

  await assert.rejects(
    resolveChatSessionContext(
      new Request("https://app.mogplex.com/api/chat"),
      "user-1",
      {
        messages: [],
        conversationId: "conversation-1",
        sandboxId: "sandbox-other",
      },
      {
        loadConversation: async () => ({
          id: "conversation-1",
          user_id: "user-1",
          repo_id: "repo-1",
          workspace_session_id: null,
          sandbox_id: "sandbox-other",
          model: "openai/gpt-5.6-sol",
        }),
        loadRepo: async () => ({
          id: "repo-1",
          full_name: "Mogplex/mogplex",
          owner: "Mogplex",
          name: "mogplex",
          default_branch: "main",
        }),
        loadSandbox: async () => ({
          id: "sandbox-other",
          repo_id: "repo-2",
          working_branch: "main",
        }),
      }
    ),
    (error) => error instanceof ChatSessionContextError && error.status === 404
  );
});

test("native chat ignores a stale browser sandbox hint and uses the saved conversation sandbox", async () => {
  let loadedSandboxId: string | null = null;

  const resolved = await resolveChatSessionContext(
    new Request("https://app.mogplex.com/api/chat"),
    "user-1",
    {
      messages: [],
      conversationId: "conversation-workspace-a",
      sandboxId: "sandbox-workspace-b",
    },
    {
      loadConversation: async () => ({
        id: "conversation-workspace-a",
        user_id: "user-1",
        repo_id: "repo-1",
        workspace_session_id: "workspace-a",
        sandbox_id: "sandbox-workspace-a",
        model: "openai/gpt-5.6-sol",
      }),
      loadRepo: async () => ({
        id: "repo-1",
        full_name: "Mogplex/mogplex",
        owner: "Mogplex",
        name: "mogplex",
        default_branch: "main",
      }),
      loadSandbox: async ({ sandboxId }) => {
        loadedSandboxId = sandboxId;
        return {
          id: sandboxId,
          repo_id: "repo-1",
          working_branch: "fix/workspace-a",
        };
      },
    }
  );

  assert.equal(loadedSandboxId, "sandbox-workspace-a");
  assert.equal(resolved.sandboxId, "sandbox-workspace-a");
  assert.equal(resolved.workspaceSessionId, "workspace-a");
  assert.equal(resolved.repoBranch, "fix/workspace-a");
});
