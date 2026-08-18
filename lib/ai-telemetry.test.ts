import { describe, expect, it } from "vitest";
import { redactSecretsInText, redactSecretsInValue } from "./ai-telemetry";

describe("redactSecretsInText", () => {
  it("redacts secret values embedded in text", () => {
    expect(
      redactSecretsInText(
        "ghs_installationToken123 https://x-access-token:token-value@github.com"
      )
    ).toBe("[redacted] https://x-access-token:[redacted]@github.com");
  });
});

describe("redactSecretsInValue", () => {
  it("preserves safe values while redacting nested secret-bearing values", () => {
    expect(
      redactSecretsInValue({
        text: "Bearer sensitive-value",
        token: "sensitive-value",
        nested: ["safe", 1, true, null],
      })
    ).toEqual({
      text: "Bearer [redacted]",
      token: "[redacted]",
      nested: ["safe", 1, true, null],
    });
  });

  it("bounds deeply nested untrusted values", () => {
    let value: unknown = "ghs_deepSecretToken";
    for (let index = 0; index < 24; index += 1) {
      value = { value };
    }

    expect(JSON.stringify(redactSecretsInValue(value))).toContain(
      "[truncated]"
    );
  });
});
