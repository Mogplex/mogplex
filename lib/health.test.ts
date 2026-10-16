import { describe, expect, it } from "vitest";
import {
  buildHealthReport,
  probeDatabase,
  readSubsystemHealth,
} from "./health";

describe("probeDatabase", () => {
  it("should report unconfigured when no database URL is set", async () => {
    const result = await probeDatabase({
      databaseUrl: "  ",
      query: () => Promise.reject(new Error("must not run")),
    });
    expect(result).toBe("unconfigured");
  });

  it("should report ok when the query succeeds", async () => {
    const result = await probeDatabase({
      databaseUrl: "postgres://db",
      query: () => Promise.resolve({ rows: [{ "?column?": 1 }] }),
    });
    expect(result).toBe("ok");
  });

  it("should report error when the query fails", async () => {
    const result = await probeDatabase({
      databaseUrl: "postgres://db",
      query: () => Promise.reject(new Error("password authentication failed")),
    });
    expect(result).toBe("error");
  });

  it("should report error when the query exceeds the deadline", async () => {
    const result = await probeDatabase({
      databaseUrl: "postgres://db",
      query: () => new Promise(() => {}),
      timeoutMs: 5,
    });
    expect(result).toBe("error");
  });
});

describe("readSubsystemHealth", () => {
  it("should report every subsystem unconfigured for an empty environment", () => {
    expect(readSubsystemHealth({})).toEqual({
      githubApp: "unconfigured",
      trigger: "unconfigured",
      sandboxes: "unconfigured",
      models: "unconfigured",
      slack: "unconfigured",
    });
  });

  it("should require every GitHub App value before reporting it configured", () => {
    expect(
      readSubsystemHealth({ GITHUB_APP_ID: "1", GITHUB_APP_NAME: "app" })
        .githubApp
    ).toBe("unconfigured");
    expect(
      readSubsystemHealth({
        GITHUB_APP_ID: "1",
        GITHUB_APP_NAME: "app",
        GITHUB_APP_PRIVATE_KEY: "pem",
      }).githubApp
    ).toBe("configured");
  });

  it("should accept either sandbox project variable alongside the token", () => {
    expect(
      readSubsystemHealth({
        PLATFORM_VERCEL_TOKEN: "token",
        PLATFORM_VERCEL_PROJECT_ID: "prj",
      }).sandboxes
    ).toBe("configured");
    expect(
      readSubsystemHealth({ PLATFORM_VERCEL_TOKEN: "token" }).sandboxes
    ).toBe("unconfigured");
  });

  it("should report trigger, models, and slack from their credentials", () => {
    const health = readSubsystemHealth({
      TRIGGER_ACCESS_TOKEN: "tr_pat",
      AI_GATEWAY_API_KEY: "key",
      SLACK_CLIENT_ID: "id",
      SLACK_CLIENT_SECRET: "secret",
      SLACK_SIGNING_SECRET: "signing",
    });
    expect(health.trigger).toBe("configured");
    expect(health.models).toBe("configured");
    expect(health.slack).toBe("configured");
  });

  it("should report models configured from an OpenAI-compatible endpoint with models", () => {
    const endpoint = {
      MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "https://litellm.internal/v1",
    };

    expect(
      readSubsystemHealth({
        ...endpoint,
        MOGPLEX_OPENAI_COMPATIBLE_MODELS: "llama3",
      }).models
    ).toBe("configured");
    expect(readSubsystemHealth(endpoint).models).toBe("unconfigured");
  });
});

describe("buildHealthReport", () => {
  it("should be ok only when the database is ok", () => {
    expect(buildHealthReport("ok", {}).status).toBe("ok");
    expect(buildHealthReport("error", {}).status).toBe("degraded");
    expect(buildHealthReport("unconfigured", {}).status).toBe("degraded");
  });

  it("should never include environment values", () => {
    const report = buildHealthReport("ok", {
      AI_GATEWAY_API_KEY: "secret-gateway-value",
      GITHUB_APP_PRIVATE_KEY: "secret-pem-value",
    });
    expect(JSON.stringify(report)).not.toMatch(/secret-/);
  });
});
