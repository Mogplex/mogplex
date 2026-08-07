import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolApprovalContext } from "../../lib/flows/tool-approval";
import { BASE_CONTEXT } from "./helpers/flow-tool-approval-fixtures";

test("resolveToolApprovalContext returns null unless the node opted in with full flow identifiers", () => {
  const repo = {
    id: "repo-1",
    user_id: "user-1",
    full_name: "acme/widgets",
    github_installation_id: 42,
  };
  const agent = { name: "Reviewer" };

  assert.equal(resolveToolApprovalContext({ metadata: {}, agent, repo }), null);
  // Opted-in but incomplete metadata must fail the node, never silently run
  // the tools ungated.
  assert.throws(
    () =>
      resolveToolApprovalContext({
        metadata: { flow_require_approval: true, flow_id: "flow-1" },
        agent,
        repo,
      }),
    /refusing to execute tools without the gate/
  );

  const context = resolveToolApprovalContext({
    metadata: {
      flow_require_approval: true,
      flow_job_run_id: "job-run-1",
      flow_id: "flow-1",
      flow_version_id: "flow-version-1",
      flow_node_id: "node-1",
      flow_node_label: "Review",
    },
    agent,
    repo,
  });
  assert.deepEqual(context, BASE_CONTEXT);
});
