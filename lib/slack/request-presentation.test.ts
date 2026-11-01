import { expect, it } from "vitest";
import { buildSlackRequestStatus } from "./request-presentation";

it("shows a short status and Stop only while a runtime is active", () => {
  const active = buildSlackRequestStatus(
    "Checking repositories…",
    "run_fixture"
  );
  expect(active).toHaveLength(2);
  expect(active[0]).toEqual({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Checking repositories…" }],
  });
  expect(active[1]).toEqual({
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: "mogplex_stop_request",
        value: "run_fixture",
        text: { type: "plain_text", text: "Stop request" },
      },
    ],
  });
  expect(JSON.stringify(active)).not.toContain("task_update");
  const done = buildSlackRequestStatus("Finished.");
  expect(done).toHaveLength(1);
  expect(JSON.stringify(done)).not.toContain("Stop request");
});
