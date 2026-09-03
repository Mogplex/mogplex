import { afterEach, describe, expect, it, vi } from "vitest";
import { isTriggerRuntimeConfigured } from "./runtime-providers";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isTriggerRuntimeConfigured", () => {
  it("should be configured with a secret key alone, as inside a deployed worker", () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_prod_test");
    vi.stubEnv("TRIGGER_PROJECT_REF", "");
    expect(isTriggerRuntimeConfigured()).toBe(true);
  });

  it("should accept an access token in place of a secret key", () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "");
    vi.stubEnv("TRIGGER_ACCESS_TOKEN", "tr_pat_test");
    expect(isTriggerRuntimeConfigured()).toBe(true);
  });

  it("should not be configured without any credential", () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "");
    vi.stubEnv("TRIGGER_ACCESS_TOKEN", "");
    vi.stubEnv("TRIGGER_PROJECT_REF", "proj_test");
    expect(isTriggerRuntimeConfigured()).toBe(false);
  });
});
