import assert from "node:assert/strict";
import test from "node:test";
import { buildScopedWorkflowsHref } from "../../lib/flows/workflows-route";

test("buildScopedWorkflowsHref targets the scoped canonical route", () => {
  assert.equal(buildScopedWorkflowsHref("alex"), "/alex/workflows");
});

test("buildScopedWorkflowsHref preserves legacy route search parameters", () => {
  assert.equal(
    buildScopedWorkflowsHref("alex", {
      tab: "runs",
      flow: "flow-1",
      filter: ["failed", "running"],
      omitted: undefined,
    }),
    "/alex/workflows?tab=runs&flow=flow-1&filter=failed&filter=running"
  );
});
