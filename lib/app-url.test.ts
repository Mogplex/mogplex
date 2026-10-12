import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAppUrl, readAppUrlEnv, readRuntimeEnv } from "./app-url";

describe("readRuntimeEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return the trimmed value when the variable is set", () => {
    vi.stubEnv("MOGPLEX_TEST_RUNTIME_ENV", "  value  ");
    expect(readRuntimeEnv("MOGPLEX_TEST_RUNTIME_ENV")).toBe("value");
  });

  it("should return undefined when the variable is blank or unset", () => {
    vi.stubEnv("MOGPLEX_TEST_RUNTIME_ENV", "   ");
    expect(readRuntimeEnv("MOGPLEX_TEST_RUNTIME_ENV")).toBeUndefined();
    expect(readRuntimeEnv("MOGPLEX_TEST_UNSET_ENV")).toBeUndefined();
  });

  it("should read a value that changes after the module loaded", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://first.example");
    expect(readRuntimeEnv("NEXT_PUBLIC_APP_URL")).toBe("https://first.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://second.example");
    expect(readRuntimeEnv("NEXT_PUBLIC_APP_URL")).toBe(
      "https://second.example"
    );
  });
});

describe("readAppUrlEnv", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should prefer APP_URL over NEXT_PUBLIC_APP_URL when both are set", () => {
    vi.stubEnv("APP_URL", "https://runtime.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://buildtime.example");
    expect(readAppUrlEnv()).toBe("https://runtime.example");
  });

  it("should fall back to NEXT_PUBLIC_APP_URL when APP_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://buildtime.example");
    expect(readAppUrlEnv()).toBe("https://buildtime.example");
  });

  it("should return undefined when neither variable is set", () => {
    expect(readAppUrlEnv()).toBeUndefined();
  });

  it("should build app URLs from APP_URL when it is set", () => {
    vi.stubEnv("APP_URL", "https://runtime.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://buildtime.example");
    expect(buildAppUrl("/api/auth/github/callback").toString()).toBe(
      "https://runtime.example/api/auth/github/callback"
    );
  });
});
