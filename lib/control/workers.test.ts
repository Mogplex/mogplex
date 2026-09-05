import { expect, it } from "vitest";
import {
  workerFailureMessage,
  workerSummary,
  type ControlWorker,
} from "./workers";

const worker = (status: ControlWorker["status"]): ControlWorker => ({
  id: "w",
  worktreeId: "wt",
  branch: "fix/tests",
  status,
  error: null,
  updatedAt: "2026-09-05",
  events: [],
});

it("distinguishes failed, waiting and active workers from integration completion", () => {
  expect(workerSummary([worker("success"), worker("failed")])).toBe(
    "1 worker failed"
  );
  expect(workerSummary([worker("failed"), worker("failed")])).toBe(
    "2 workers failed"
  );
  expect(workerSummary([worker("awaiting_input")])).toContain("need input");
  expect(workerSummary([worker("streaming")])).toBe("1 worker running");
  expect(workerSummary([worker("pending")])).toBe("1 worker queued");
  expect(workerSummary([worker("cancelled")])).toBe("1 worker cancelled");
  expect(workerSummary([worker("success")])).toContain(
    "Integration and verification are separate"
  );
});

it("explains worker auth failures without exposing diagnostic credentials", () => {
  const message = workerFailureMessage(
    "failed",
    "Incorrect API key provided: secret-fixture",
    []
  );
  expect(message).toContain("Check its AI connection");
  expect(message).not.toContain("secret-fixture");
  expect(workerFailureMessage("streaming", "old 401", [])).toBeNull();
  expect(workerFailureMessage("failed", "exit 1", [])).toContain(
    "Inspect its recorded output"
  );
  expect(
    workerFailureMessage("failed", null, [
      {
        id: "e",
        type: "message",
        toolName: null,
        message: "401 Unauthorized",
        payload: {},
        createdAt: "2026-09-05",
      },
    ])
  ).toContain("could not authenticate");
});
