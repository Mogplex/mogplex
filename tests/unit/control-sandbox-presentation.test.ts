import assert from "node:assert/strict";
import test from "node:test";
import {
  getSandboxPreviewPresentation,
  partitionControlSandboxes,
} from "../../lib/control/sandbox-presentation";

test("control sandbox inventory keeps stopped and failed attempts in history", () => {
  const records = [
    { id: "running", runtime_summary: { status: "running" } },
    { id: "paused", runtime_summary: { status: "paused" } },
    { id: "stopped", runtime_summary: { status: "stopped" } },
    { id: "failed", runtime_summary: { status: "error" } },
  ];

  const result = partitionControlSandboxes(records);
  assert.deepEqual(
    result.current.map((record) => record.id),
    ["running", "paused"]
  );
  assert.deepEqual(
    result.history.map((record) => record.id),
    ["stopped", "failed"]
  );
});

test("a stale preview URL never marks stopped compute as ready", () => {
  assert.deepEqual(
    getSandboxPreviewPresentation({
      status: "stopped",
      healthStatus: "running",
      previewUrl: "https://stale-preview.example",
    }),
    { label: "Unavailable", state: "unavailable", canOpen: false }
  );
});

test("preview readiness requires running compute and healthy preview", () => {
  assert.deepEqual(
    getSandboxPreviewPresentation({
      status: "running",
      healthStatus: "running",
      previewUrl: "https://preview.example",
    }),
    { label: "Ready", state: "ready", canOpen: true }
  );
  assert.deepEqual(
    getSandboxPreviewPresentation({
      status: "running",
      healthStatus: "app_error",
      previewUrl: "https://preview.example",
    }),
    { label: "App error", state: "error", canOpen: true }
  );
});
