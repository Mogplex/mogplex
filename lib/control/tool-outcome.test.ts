import { expect, it } from "vitest";
import { controlToolOutcome, controlToolFailureDetail } from "./tool-outcome";

it("does not label suspected masked command failures or unknown exits complete", () => {
  expect(
    controlToolOutcome("output-available", {
      exitCode: 0,
      outputCheck: "Verify the failed subprocess.",
    })
  ).toBe("failed");
  expect(controlToolOutcome("output-available", { exitCode: null })).toBe(
    "failed"
  );
  expect(controlToolOutcome("output-available", { exitCode: 0 })).toBe("done");
  expect(
    controlToolOutcome("output-available", { exitCode: 0, failures: [137] })
  ).toBe("failed");
  expect(
    controlToolOutcome("output-available", { content: "file content" })
  ).toBe("done");
});

it("explains shell outcomes instead of inventing a generic tool error", () => {
  expect(controlToolFailureDetail({ exitCode: 1, stderr: "" })).toBe(
    "Command exited with code 1."
  );
  expect(
    controlToolFailureDetail({ exitCode: 0, failures: [137], stderr: "Killed" })
  ).toBe("Shell steps exited with code 137.\nKilled");
});
