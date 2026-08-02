import { describe, expect, it } from "vitest";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";
import { derivePreviewOverlayStopReasonText } from "@/lib/sandbox/preview-overlay-status";
import type { StopReason } from "@/lib/types";

describe("derivePreviewOverlayStopReasonText", () => {
  it.each([
    ["idle_timeout", "Idle for too long"],
    ["lifetime_timeout", "Reached its lifetime limit"],
    ["manual", "You stopped this sandbox"],
    ["stuck_boot", "Boot didn't complete"],
    ["vm_gone", "The VM expired"],
    ["unknown", null],
    [null, null],
  ] as const)("resolves stopped overlay copy for %s", (reason, expected) => {
    const record = sandboxRecord({
      status: "stopped",
      healthStatus: "stopped",
      stopReason: reason as StopReason | null,
    });

    expect(derivePreviewOverlayStopReasonText("stopped", record)).toBe(
      expected
    );
  });

  it("omits stop reason text when the overlay is not stopped", () => {
    const record = sandboxRecord({
      status: "running",
      healthStatus: "running",
      stopReason: "idle_timeout",
    });

    expect(derivePreviewOverlayStopReasonText("running", record)).toBeNull();
  });
});
