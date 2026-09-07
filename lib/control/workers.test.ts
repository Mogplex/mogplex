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

it.each([
  "HTTP 401",
  "HTTP/1.1 401",
  "status 401",
  "status code: 401",
  "status=401",
  "hTtP:401",
  "authentication failed",
])("recognizes a bounded authentication error: %s", (error) => {
  expect(workerFailureMessage("failed", error, [])).toContain(
    "could not authenticate"
  );
});

it.each(["HTTP 4017", "mystatus401", "status code 1401"])(
  "does not infer authentication from unrelated digits: %s",
  (error) => {
    expect(workerFailureMessage("failed", error, [])).toContain(
      "Inspect its recorded output"
    );
  }
);

it.each(["sandbox stopped", "sandbox gone", "session stopped", "session gone"])(
  "identifies a lost environment before authentication diagnostics: %s",
  (error) => {
    expect(workerFailureMessage("failed", `${error}: HTTP 401`, [])).toContain(
      "development environment stopped"
    );
  }
);

it("does not diagnose authentication from digits in a timestamp", () => {
  expect(
    workerFailureMessage(
      "failed",
      "The development environment stopped during this agent run. Start it again, then retry.",
      [
        {
          id: "event",
          type: "message",
          toolName: null,
          message:
            "2026-01-01T00:00:08.644019Z ERROR agent thread limit reached",
          payload: {},
          createdAt: "2026-01-01",
        },
      ]
    )
  ).toBe(
    "The development environment stopped before the worker finished. Restart it and retry the worker."
  );
});

it("does not treat a timestamp containing 401 as an HTTP failure", () => {
  expect(
    workerFailureMessage("failed", "exit 1", [
      {
        id: "event",
        type: "message",
        toolName: null,
        message: "2026-01-01T00:00:08.644019Z ERROR agent thread limit reached",
        payload: {},
        createdAt: "2026-01-01",
      },
    ])
  ).toContain("Inspect its recorded output");
});

it("identifies an internal runtime setup failure without blaming the user's credentials", () => {
  expect(
    workerFailureMessage(
      "failed",
      "Invalid request: duration should be >= 1000.",
      []
    )
  ).toBe(
    "The worker could not start because of a runtime error. Retry the worker."
  );
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

it("keeps running workers visible when another worker fails", () => {
  expect(
    workerSummary([worker("failed"), worker("streaming"), worker("pending")])
  ).toBe("1 worker running · 1 worker queued · 1 worker failed");
});

it("surfaces indeterminate command execution instead of suggesting an immediate retry", () => {
  expect(
    workerFailureMessage(
      "failed",
      "The worker lost its command connection and its command may still be running. Confirm it has stopped before retrying.",
      []
    )
  ).toBe(
    "Worker connection lost. Its command may still be running. Confirm it has stopped before continuing."
  );
});
