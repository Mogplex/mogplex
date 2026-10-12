import { describe, expect, it } from "vitest";

import { resolveTriggerCliArgs } from "./cli-args";

function env(values: Record<string, string>) {
  return values as unknown as NodeJS.ProcessEnv;
}

const selfHosted = env({ TRIGGER_API_URL: " https://trigger.example.com " });

describe("resolveTriggerCliArgs", () => {
  it("should pass arguments through unchanged when TRIGGER_API_URL is unset", () => {
    expect(
      resolveTriggerCliArgs(["deploy", "--", "--dry-run"], env({}))
    ).toEqual(["deploy", "--dry-run"]);
  });

  it("should point deploy and dev at a self-hosted Trigger.dev instance", () => {
    expect(resolveTriggerCliArgs(["deploy", "--dry-run"], selfHosted)).toEqual([
      "deploy",
      "--api-url",
      "https://trigger.example.com",
      "--dry-run",
    ]);
    expect(resolveTriggerCliArgs(["dev"], selfHosted)).toEqual([
      "dev",
      "--api-url",
      "https://trigger.example.com",
    ]);
  });

  it("should keep an explicit --api-url argument", () => {
    expect(
      resolveTriggerCliArgs(
        ["deploy", "--api-url", "https://other.example.com"],
        selfHosted
      )
    ).toEqual(["deploy", "--api-url", "https://other.example.com"]);
    expect(
      resolveTriggerCliArgs(
        ["deploy", "--api-url=https://other.example.com"],
        selfHosted
      )
    ).toEqual(["deploy", "--api-url=https://other.example.com"]);
    expect(
      resolveTriggerCliArgs(
        ["login", "-a", "http://localhost:3040"],
        selfHosted
      )
    ).toEqual(["login", "-a", "http://localhost:3040"]);
  });

  it("should leave commands without --api-url support alone", () => {
    expect(resolveTriggerCliArgs(["update"], selfHosted)).toEqual(["update"]);
    expect(resolveTriggerCliArgs([], selfHosted)).toEqual([]);
  });

  it("should reject a TRIGGER_API_URL that is not an http(s) URL", () => {
    expect(() =>
      resolveTriggerCliArgs(
        ["deploy"],
        env({ TRIGGER_API_URL: "trigger.example.com" })
      )
    ).toThrow(/Invalid TRIGGER_API_URL/);
    expect(() =>
      resolveTriggerCliArgs(
        ["deploy"],
        env({ TRIGGER_API_URL: "ftp://trigger.example.com" })
      )
    ).toThrow(/Invalid TRIGGER_API_URL/);
  });
});
