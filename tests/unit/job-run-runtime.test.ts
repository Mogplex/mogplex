import assert from "node:assert/strict";
import test from "node:test";
import {
  getJobRunRuntimeProvider,
  getJobRunRuntimeRunId,
} from "../../lib/job-run-runtime";

test("job run runtime helpers prefer explicit runtime fields", () => {
  const job = {
    runtime_provider: "trigger" as const,
    runtime_run_id: "run_123",
    workflow_run_id: "wf_legacy",
  };

  assert.equal(getJobRunRuntimeProvider(job), "trigger");
  assert.equal(getJobRunRuntimeRunId(job), "run_123");
});

test("job run runtime helpers fall back to legacy workflow fields", () => {
  const job = {
    runtime_provider: null,
    runtime_run_id: null,
    workflow_run_id: "wf_legacy",
  };

  assert.equal(getJobRunRuntimeProvider(job), "workflow");
  assert.equal(getJobRunRuntimeRunId(job), "wf_legacy");
});
