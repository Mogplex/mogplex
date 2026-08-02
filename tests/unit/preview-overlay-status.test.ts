import assert from "node:assert/strict";
import test from "node:test";
import { derivePreviewOverlayStatus } from "../../lib/sandbox/preview-overlay-status";

function buildRuntimeSummary(
  state: "build_failed" | "building",
  deploymentStatus: string,
  buildSummary: string
) {
  return {
    sandbox_id: "sbx_123",
    status: "running",
    health_status: "starting",
    preview_url: "https://preview.example.com",
    last_health_check_at: "2026-04-02T00:00:00.000Z",
    last_preview_http_status: 503,
    boot_attempts: 1,
    last_boot_started_at: "2026-04-02T00:00:00.000Z",
    last_boot_completed_at: null,
    vercel_diagnostics: {
      state,
      deploymentId: "dpl_123",
      deploymentUrl: "https://app.vercel.app",
      deploymentStatus,
      buildSummary,
      detectedAt: "2026-04-02T00:00:00.000Z",
    },
  } as const;
}

test("derivePreviewOverlayStatus surfaces build failures while preview health is still starting", () => {
  const result = derivePreviewOverlayStatus("starting", {
    runtime_summary: buildRuntimeSummary(
      "build_failed",
      "ERROR",
      "Build failed"
    ),
  });

  assert.equal(result, "build_failed");
});

test("derivePreviewOverlayStatus keeps building distinct while preview health is starting", () => {
  const result = derivePreviewOverlayStatus("starting", {
    runtime_summary: buildRuntimeSummary(
      "building",
      "BUILDING",
      "Queued on build machine"
    ),
  });

  assert.equal(result, "building");
});
