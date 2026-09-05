import assert from "node:assert/strict";
import test from "node:test";
import {
  JOB_RUNS_REALTIME_SPEC,
  OBSERVABILITY_ACTIVITY_REALTIME_SPECS,
  OBSERVABILITY_JOBS_REALTIME_SPECS,
  OBSERVABILITY_STATS_REALTIME_SPECS,
  USER_AI_CALLS_REALTIME_SPEC,
  USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC,
  USER_LIMIT_EVENTS_REALTIME_SPEC,
  USER_SANDBOXES_REALTIME_SPEC,
} from "../../lib/observability/realtime-specs";

test("observability stats realtime specs cover every summary-backed table", () => {
  assert.deepEqual(OBSERVABILITY_STATS_REALTIME_SPECS, [
    USER_AI_CALLS_REALTIME_SPEC,
    USER_SANDBOXES_REALTIME_SPEC,
    JOB_RUNS_REALTIME_SPEC,
    USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC,
    USER_LIMIT_EVENTS_REALTIME_SPEC,
  ]);
});

test("observability activity realtime stays user scoped", () => {
  assert.deepEqual(OBSERVABILITY_ACTIVITY_REALTIME_SPECS, [
    USER_AI_CALLS_REALTIME_SPEC,
  ]);
});

test("observability jobs realtime covers job rows and user-owned side tables", () => {
  assert.deepEqual(OBSERVABILITY_JOBS_REALTIME_SPECS, [
    { table: "external_agent_runs", filter: "user_id=eq.$USER_ID" },
    JOB_RUNS_REALTIME_SPEC,
    USER_AI_CALLS_REALTIME_SPEC,
    USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC,
  ]);
});
