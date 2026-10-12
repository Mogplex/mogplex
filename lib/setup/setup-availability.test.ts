import { describe, expect, it } from "vitest";
import { getGithubSetupAvailability } from "./setup-availability";

const APP_ENV = {
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "pem",
  GITHUB_APP_NAME: "mogplex",
};

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("getGithubSetupAvailability", () => {
  it("should be available outside production when no App is configured", () => {
    expect(
      getGithubSetupAvailability(
        env({ NODE_ENV: "development", BETTER_AUTH_SECRET: "secret" })
      )
    ).toEqual({ status: "available", signingSecret: "secret" });
  });

  it("should be off in production unless the operator opts in", () => {
    expect(
      getGithubSetupAvailability(
        env({ NODE_ENV: "production", BETTER_AUTH_SECRET: "secret" })
      )
    ).toEqual({ status: "disabled" });
    expect(
      getGithubSetupAvailability(
        env({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "secret",
          MOGPLEX_SETUP_ENABLED: "1",
        })
      ).status
    ).toBe("available");
  });

  it("should refuse to create a second App", () => {
    expect(
      getGithubSetupAvailability(
        env({
          NODE_ENV: "production",
          MOGPLEX_SETUP_ENABLED: "1",
          BETTER_AUTH_SECRET: "secret",
          ...APP_ENV,
        })
      )
    ).toEqual({ status: "already_configured" });
  });

  it("should require a signing secret", () => {
    expect(
      getGithubSetupAvailability(env({ NODE_ENV: "development" }))
    ).toEqual({ status: "missing_signing_secret" });
  });
});
