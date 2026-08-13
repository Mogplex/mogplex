import assert from "node:assert/strict";
import test from "node:test";
import {
  buildControlSessionRequestContext,
  selectControlActiveSandbox,
  selectControlSessionSandboxes,
} from "../../components/control/use-control-session-context";

test("selectControlSessionSandboxes requires the session repository", () => {
  const sandboxes = [
    { id: "sandbox-1", repo_id: "repo-1" },
    { id: "sandbox-2", repo_id: "repo-2" },
  ];

  assert.deepEqual(selectControlSessionSandboxes(null, sandboxes), []);
  assert.deepEqual(selectControlSessionSandboxes({ id: "repo-1" }, sandboxes), [
    sandboxes[0],
  ]);
});

test("selectControlActiveSandbox prefers a running sandbox and honors an explicit selection", () => {
  const sandboxes = [
    {
      id: "sandbox-paused",
      runtime_summary: { status: "paused" },
    },
    {
      id: "sandbox-running",
      runtime_summary: { status: "running" },
    },
  ];

  assert.equal(selectControlActiveSandbox(sandboxes, null), sandboxes[1]);
  assert.equal(
    selectControlActiveSandbox(sandboxes, "sandbox-paused"),
    sandboxes[0]
  );
  assert.equal(
    selectControlActiveSandbox(sandboxes, "sandbox-from-another-repo"),
    sandboxes[1]
  );
});

test("buildControlSessionRequestContext omits mission and branch context without a repo", () => {
  assert.deepEqual(
    buildControlSessionRequestContext({
      activeRepo: null,
      activeSandbox: null,
      sessionId: null,
      selectedMissionId: "",
      missionTitle: null,
    }),
    {
      conversationId: null,
      missionId: null,
      missionTitle: null,
      repoId: null,
      repoFullName: null,
      repoOwner: null,
      repoName: null,
      repoBranch: null,
      repoBaseBranch: null,
      sandboxId: null,
    }
  );
});

test("buildControlSessionRequestContext uses the active repo and sandbox", () => {
  const repo = {
    id: "repo-1",
    full_name: "acme/widgets",
    owner: "acme",
    name: "widgets",
    default_branch: "trunk",
  };
  const sandbox = {
    id: "sandbox-record-1",
    working_branch: "feat/context",
    base_branch: "trunk",
  };

  assert.deepEqual(
    buildControlSessionRequestContext({
      activeRepo: repo,
      activeSandbox: sandbox,
      sessionId: "session-1",
      selectedMissionId: "mission-1",
      missionTitle: "Fix context",
    }),
    {
      conversationId: "session-1",
      missionId: "session-1",
      missionTitle: "Fix context",
      repoId: "repo-1",
      repoFullName: "acme/widgets",
      repoOwner: "acme",
      repoName: "widgets",
      repoBranch: "feat/context",
      repoBaseBranch: "trunk",
      sandboxId: "sandbox-record-1",
    }
  );
});
