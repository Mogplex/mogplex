import { expect, it } from "vitest";
import { signingVerificationResult } from "./verify-workspace";

it.each([
  [0, "verified", "This sandbox signed and verified"],
  [10, "inactive", "This sandbox is not configured"],
  [11, "different_key", "This sandbox has a different signing key"],
  [12, "failed", "The sandbox could not sign and verify"],
] as const)(
  "describes the checked sandbox for exit code %s",
  (code, status, message) => {
    expect(signingVerificationResult(code)).toMatchObject({
      status,
      message: expect.stringContaining(message),
    });
  }
);
