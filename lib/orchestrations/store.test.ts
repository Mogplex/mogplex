import { describe, expect, it } from "vitest";
import { OrchestrationTransitionError } from "./state-machine";
import {
  transitionOrchestrationRun,
  transitionOrchestrationTask,
} from "./store";

/**
 * Transition legality is enforced in TypeScript BEFORE any DB access — an
 * illegal transition must throw OrchestrationTransitionError synchronously,
 * never reaching supabaseAdmin (whose lazy proxy would explode without env
 * config; these tests double as proof the DB is untouched).
 */
describe("store transition legality gate", () => {
  it("should reject an illegal run transition before touching the DB", async () => {
    await expect(
      transitionOrchestrationRun({
        runId: "00000000-0000-4000-8000-000000000001",
        from: "completed",
        to: "running_tasks",
      })
    ).rejects.toBeInstanceOf(OrchestrationTransitionError);
  });

  it("should reject an illegal task transition before touching the DB", async () => {
    await expect(
      transitionOrchestrationTask({
        taskId: "00000000-0000-4000-8000-000000000002",
        from: "merged",
        to: "running",
      })
    ).rejects.toBeInstanceOf(OrchestrationTransitionError);
  });
});
