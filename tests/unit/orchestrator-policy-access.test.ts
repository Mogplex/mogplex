import assert from "node:assert/strict";
import test from "node:test";
import {
  checkToolPolicy,
  getApprovalRequiredTools,
} from "../../lib/agents/orchestrator/policy";
import {
  getToolDef,
  ORCHESTRATOR_TOOLS,
  type OrchestratorToolContext,
} from "../../lib/agents/orchestrator/registry";

const ctx: OrchestratorToolContext = {
  userId: "user-1",
  controlMode: "run",
  repoBranch: "feat/work",
};

test("opening a PR requires approval even on a working branch", () => {
  const def = getToolDef("open_pr");
  assert.ok(def);
  assert.equal(def.access, "approval");
  const result = checkToolPolicy(def, ctx, { base: "feat/work" });
  assert.equal(result.allowed, false);
  assert.ok(!result.allowed && result.reason === "approval_required");
  assert.ok(
    getApprovalRequiredTools(ctx).some((item) => item.name === "open_pr")
  );
});

test("protected pushes still require approval and working-branch pushes do not", () => {
  const def = getToolDef("git_push");
  assert.ok(def);
  const protectedResult = checkToolPolicy(def, ctx, { branch: "main" });
  assert.ok(
    !protectedResult.allowed && protectedResult.reason === "approval_required"
  );
  assert.deepEqual(checkToolPolicy(def, ctx, { branch: "feat/work" }), {
    allowed: true,
  });
});

test("consequential tool definitions declare their approval requirement", () => {
  const actions = ORCHESTRATOR_TOOLS.filter(
    (def) =>
      def.access !== "read" &&
      /merge|deploy|promote|rollback|delete|secrets|grant|revoke|open_pr|feature_flag_set/.test(
        def.name
      )
  );
  assert.ok(actions.length > 0);
  for (const def of actions) {
    assert.equal(def.access, "approval", def.name);
    const result = checkToolPolicy(def, ctx);
    assert.ok(
      !result.allowed && result.reason === "approval_required",
      def.name
    );
  }
});

test("approval metadata preserves every previously gated action", () => {
  assert.deepEqual(
    getApprovalRequiredTools(ctx)
      .map((def) => def.name)
      .sort(),
    [
      "delete_file",
      "deploy",
      "feature_flag_set",
      "mcp_grant",
      "mcp_revoke",
      "merge_changeset",
      "open_pr",
      "promote",
      "prune_worktree",
      "rebase_worktree",
      "rollback",
      "secrets_read",
    ]
  );
});

test("approval is determined by access, without a parallel name policy", () => {
  const def = getToolDef("deploy");
  assert.ok(def);
  assert.deepEqual(checkToolPolicy({ ...def, access: "mutation" }, ctx), {
    allowed: true,
  });
  const result = checkToolPolicy(
    { ...def, name: "new_consequential_action", access: "approval" },
    ctx
  );
  assert.ok(!result.allowed && result.reason === "approval_required");
});
