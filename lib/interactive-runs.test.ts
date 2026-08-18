import { describe, expect, it } from "vitest";
import { sanitizeAiCallEventInput } from "./interactive-runs";

describe("sanitizeAiCallEventInput", () => {
  const input = {
    aiCallId: "call-1",
    userId: "user-1",
    eventType: "log" as const,
    message: "Bearer secret-message",
    payload: { token: "secret-payload" },
  };

  it("redacts values before persistence or diagnostics", () => {
    expect(sanitizeAiCallEventInput(input)).toMatchObject({
      message: "Bearer [redacted]",
      payload: { token: "[redacted]" },
    });
  });
});
