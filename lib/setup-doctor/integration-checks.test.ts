import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkGithubApp,
  checkSandboxes,
  checkTrigger,
  HOSTED_TRIGGER_PROJECT_REF,
} from "./integration-checks";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const githubApp = {
  GITHUB_APP_ID: "1",
  GITHUB_APP_NAME: "my-mogplex",
  GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, String.raw`\n`),
  GITHUB_WEBHOOK_SECRET: "w",
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "cs",
};

describe("checkGithubApp", () => {
  it("should pass with a signable key and both apps configured", () => {
    expect(checkGithubApp(githubApp).status).toBe("pass");
  });

  it("should warn when the App is not configured at all", () => {
    expect(checkGithubApp({}).status).toBe("warn");
  });

  it("should fail and name the missing variables when partly configured", () => {
    expect(
      checkGithubApp({ ...githubApp, GITHUB_WEBHOOK_SECRET: "" })
    ).toMatchObject({
      status: "fail",
      summary: "Missing GITHUB_WEBHOOK_SECRET",
    });
  });

  it("should fail a private key that cannot sign", () => {
    expect(
      checkGithubApp({ ...githubApp, GITHUB_APP_PRIVATE_KEY: "not-a-pem" })
        .summary
    ).toMatch(/not a usable PEM/);
  });

  it("should warn when the OAuth app credentials are missing", () => {
    expect(
      checkGithubApp({ ...githubApp, GITHUB_CLIENT_SECRET: "" })
    ).toMatchObject({
      status: "warn",
      summary: expect.stringMatching(/GITHUB_CLIENT_SECRET missing/),
    });
  });
});

describe("checkTrigger", () => {
  it("should warn when Trigger.dev is not configured", () => {
    expect(checkTrigger({}).status).toBe("warn");
  });

  it("should fail when the secret key or project ref is missing", () => {
    expect(checkTrigger({ TRIGGER_PROJECT_REF: "proj_mine" }).summary).toMatch(
      /SECRET_KEY/
    );
    expect(checkTrigger({ TRIGGER_SECRET_KEY: "tr" }).summary).toMatch(
      /hosted project/
    );
  });

  it("should warn when the ref is the hosted Mogplex project", () => {
    expect(
      checkTrigger({
        TRIGGER_SECRET_KEY: "tr",
        TRIGGER_PROJECT_REF: HOSTED_TRIGGER_PROJECT_REF,
      }).status
    ).toBe("warn");
  });

  it("should pass for an access token and an own project ref", () => {
    expect(
      checkTrigger({
        TRIGGER_ACCESS_TOKEN: "tr",
        TRIGGER_PROJECT_REF: "proj_mine",
      }).status
    ).toBe("pass");
  });
});

describe("checkSandboxes", () => {
  it("should warn when sandboxes are not configured", () => {
    expect(checkSandboxes({}).status).toBe("warn");
  });

  it("should fail when only one of token and project is set", () => {
    expect(checkSandboxes({ VERCEL_PROJECT_ID: "prj" }).summary).toMatch(
      /PLATFORM_VERCEL_TOKEN/
    );
    expect(checkSandboxes({ PLATFORM_VERCEL_TOKEN: "t" }).summary).toMatch(
      /PROJECT_ID/
    );
  });

  it("should accept either project ID variable", () => {
    expect(
      checkSandboxes({
        PLATFORM_VERCEL_TOKEN: "t",
        PLATFORM_VERCEL_PROJECT_ID: "prj",
      }).status
    ).toBe("pass");
  });
});
