import type { RunGuidance } from "./run-guidance-store";
import { progressText } from "./run-progress-state";

/** A step receipt proves inclusion in context, not that the requested change is done. */
export function guidanceReceiptText(guidance: readonly RunGuidance[]): string {
  return guidance
    .slice(-3)
    .map((row) => {
      const status =
        row.status === "delivered"
          ? `Supplied to agent step ${(row.delivered_step ?? 0) + 1}`
          : row.status === "received"
            ? "Saved for the next agent step"
            : "Delivery not confirmed before the run stopped";
      return `${status}: ${progressText(row.body || "Image guidance", 180)}`;
    })
    .join("\n");
}
