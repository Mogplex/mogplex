import assert from "node:assert/strict";
import test from "node:test";
import { buildControlSessionRequestContext } from "../../components/control/use-control-session-context";

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
