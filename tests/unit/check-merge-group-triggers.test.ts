import assert from "node:assert/strict";
import test from "node:test";
import { findMergeGroupViolations } from "../../scripts/check-merge-group-triggers.mjs";

const COMPLIANT_WORKFLOW = `name: ci
on:
  pull_request:
  merge_group:
  push:
    branches:
      - main
jobs: {}
`;

const PR_ONLY_WORKFLOW = `name: broken
on:
  pull_request:
    types: [opened, synchronize]
jobs: {}
`;

const PR_ARRAY_FORM_WORKFLOW = `name: array-form
on: [push, pull_request]
jobs: {}
`;

const PUSH_ONLY_WORKFLOW = `name: deploy
on:
  push:
    branches:
      - main
jobs: {}
`;

test("passes a workflow that triggers on both pull_request and merge_group", () => {
  const violations = findMergeGroupViolations(
    [{ file: "ci.yml", source: COMPLIANT_WORKFLOW }],
    {}
  );
  assert.deepEqual(violations, []);
});

test("flags a pull_request workflow that is missing merge_group", () => {
  const violations = findMergeGroupViolations(
    [{ file: "broken.yml", source: PR_ONLY_WORKFLOW }],
    {}
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "broken.yml");
  assert.match(violations[0].reason, /merge_group/);
});

test("flags array-form triggers that include pull_request without merge_group", () => {
  const violations = findMergeGroupViolations(
    [{ file: "array-form.yml", source: PR_ARRAY_FORM_WORKFLOW }],
    {}
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "array-form.yml");
});

test("ignores workflows that never trigger on pull_request", () => {
  const violations = findMergeGroupViolations(
    [{ file: "deploy.yml", source: PUSH_ONLY_WORKFLOW }],
    {}
  );
  assert.deepEqual(violations, []);
});

test("allowlisted workflows may omit merge_group", () => {
  const violations = findMergeGroupViolations(
    [{ file: "mutation.yml", source: PR_ONLY_WORKFLOW }],
    { "mutation.yml": "advisory check, not required by the ruleset" }
  );
  assert.deepEqual(violations, []);
});

test("flags stale allowlist entries so the exemption list cannot rot", () => {
  const violations = findMergeGroupViolations(
    [{ file: "ci.yml", source: COMPLIANT_WORKFLOW }],
    { "ci.yml": "stale reason", "gone.yml": "file no longer exists" }
  );
  assert.equal(violations.length, 2);
  const files = violations
    .map((violation: { file: string }) => violation.file)
    .toSorted((left: string, right: string) => left.localeCompare(right));
  assert.deepEqual(files, ["ci.yml", "gone.yml"]);
  for (const violation of violations) {
    assert.match(violation.reason, /allowlist/i);
  }
});
