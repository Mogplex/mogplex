import { describe, expect, it } from "vitest";
import { getSandboxStartMessage } from "./sandbox-start";

describe("sandbox start presentation", () => {
  it("reports a running sandbox as ready", () => {
    expect(
      getSandboxStartMessage({
        sandboxId: "sandbox-1",
        status: "running",
        source: "created",
      })
    ).toBe("Sandbox is ready to use.");
  });
});
