import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

type Step = {
  name: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
  "continue-on-error"?: boolean;
};
type Workflow = {
  on: Record<string, unknown>;
  jobs: Record<string, { steps: Step[] }>;
};
function workflow(name: string): Workflow {
  return parse(
    readFileSync(`.github/workflows/${name}.yml`, "utf8")
  ) as Workflow;
}

test("the required test check exercises prior code for PRs, merge groups, and main pushes", () => {
  const ci = workflow("ci");
  for (const event of ["pull_request", "merge_group", "push"])
    assert.ok(event in ci.on);
  const gate = ci.jobs.test.steps.find((step) =>
    step.run?.includes("pnpm test:schema-compatibility")
  );
  assert.ok(gate, "The required test job must execute compatibility checks");
  assert.notEqual(gate["continue-on-error"], true);
  assert.equal(
    gate.if,
    undefined,
    "Compatibility must not silently skip a supported CI event"
  );
  assert.match(gate.env?.PREVIOUS_COMMIT ?? "", /pull_request\.base\.sha/);
  assert.match(gate.env?.PREVIOUS_COMMIT ?? "", /merge_group\.base_sha/);
  assert.match(gate.env?.PREVIOUS_COMMIT ?? "", /github\.event\.before/);
});

test("production verifies the actually deployed commit before applying migrations", () => {
  const steps = workflow("deploy-production").jobs["migrate-production"].steps;
  const resolve = steps.findIndex((step) =>
    step.run?.includes("node scripts/resolve-deployed-commit.mjs")
  );
  const guard = steps.findIndex((step) =>
    step.run?.includes("pnpm test:schema-compatibility")
  );
  const migrate = steps.findIndex((step) =>
    step.run?.includes("scripts/apply-neon-migrations.ts")
  );
  assert.ok(
    resolve !== -1 && guard > resolve && migrate > guard,
    "Resolve deployed release, check compatibility, then migrate"
  );
  assert.match(steps[guard].run ?? "", /\$PREVIOUS_PRODUCTION_COMMIT/);
  assert.notEqual(steps[guard]["continue-on-error"], true);
  assert.equal(steps[guard].if, steps[migrate].if);
  assert.equal(
    steps[guard].env?.VERCEL_TOKEN,
    undefined,
    "Old-code execution must not receive Vercel credentials"
  );
});
