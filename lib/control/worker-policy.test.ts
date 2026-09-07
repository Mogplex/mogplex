import { describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_WORKERS_PER_SANDBOX,
  WORKER_NO_DELEGATION_FOOTER,
  applyWorkerPromptPolicy,
  sandboxWorkerLimitMessage,
} from "./worker-policy";

describe("worker prompt policy", () => {
  it("appends the footer once, even when the prompt already carries it", () => {
    const once = applyWorkerPromptPolicy("Fix the bug.  \n");
    expect(once).toBe(`Fix the bug.\n\n${WORKER_NO_DELEGATION_FOOTER}`);
    expect(applyWorkerPromptPolicy(once)).toBe(once);
  });

  it("names the live count in the limit message", () => {
    expect(sandboxWorkerLimitMessage(MAX_CONCURRENT_WORKERS_PER_SANDBOX)).toBe(
      "Sandbox already runs 2 workers. Wait for one to finish or start another sandbox."
    );
  });
});
