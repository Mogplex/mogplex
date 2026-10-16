import { HOSTED_TRIGGER_PROJECT_REF } from "@/lib/trigger/project-ref";
import { describe, expect, it } from "vitest";
import {
  checkAccess,
  checkAppConfig,
  checkAuth,
  checkModels,
  checkSecrets,
} from "./core-checks";

const HEX_KEY = "a".repeat(64);
const secrets = {
  CRON_SECRET: "c",
  INTERNAL_API_SECRET: "i",
  CONNECTIONS_ENCRYPTION_KEY: HEX_KEY,
  EMAIL_UNSUBSCRIBE_SECRET: "e",
};

describe("checkAppConfig", () => {
  const base = {
    NEXT_PUBLIC_APP_URL: "https://mogplex.example.com/",
    MOGPLEX_DATA_BACKEND: "neon",
    NEXT_PUBLIC_MOGPLEX_DATA_BACKEND: "neon",
  };

  it("should pass for a valid URL and agreeing neon flags", () => {
    expect(checkAppConfig(base)).toMatchObject({
      status: "pass",
      summary: "App URL https://mogplex.example.com",
    });
  });

  it("should fail when the app URL is missing or invalid", () => {
    expect(checkAppConfig({ ...base, NEXT_PUBLIC_APP_URL: "" }).status).toBe(
      "fail"
    );
    expect(
      checkAppConfig({ ...base, NEXT_PUBLIC_APP_URL: "not a url" }).summary
    ).toMatch(/not a valid URL/);
  });

  it("should accept APP_URL alone and prefer it over NEXT_PUBLIC_APP_URL", () => {
    const { NEXT_PUBLIC_APP_URL: _unused, ...withoutPublicUrl } = base;

    expect(
      checkAppConfig({
        ...withoutPublicUrl,
        APP_URL: "https://runtime.example.com",
      })
    ).toMatchObject({
      status: "pass",
      summary: "App URL https://runtime.example.com",
    });
    expect(checkAppConfig({ ...base, APP_URL: "not a url" }).summary).toMatch(
      /^APP_URL is not a valid URL/
    );
  });

  it("should fail when the backend flags disagree", () => {
    expect(
      checkAppConfig({ ...base, NEXT_PUBLIC_MOGPLEX_DATA_BACKEND: "supabase" })
    ).toMatchObject({
      status: "fail",
      summary: expect.stringMatching(/disagree/),
    });
  });
});

describe("checkSecrets", () => {
  it("should pass when every secret is set and the key is 64 hex", () => {
    expect(checkSecrets(secrets).status).toBe("pass");
    expect(
      checkSecrets({ ...secrets, CONNECTIONS_ENCRYPTION_KEY: `"${HEX_KEY}"` })
        .status
    ).toBe("pass");
  });

  it("should name each missing secret", () => {
    expect(
      checkSecrets({
        ...secrets,
        CRON_SECRET: "",
        EMAIL_UNSUBSCRIBE_SECRET: " ",
      })
    ).toMatchObject({
      status: "fail",
      summary: "Missing CRON_SECRET, EMAIL_UNSUBSCRIBE_SECRET",
    });
  });

  it("should fail a key that is not 64 hex characters without echoing it", () => {
    const result = checkSecrets({
      ...secrets,
      CONNECTIONS_ENCRYPTION_KEY: "short-secret",
    });
    expect(result.status).toBe("fail");
    expect(result.summary).not.toContain("short-secret");
  });
});

describe("checkAuth", () => {
  it("should fail without BETTER_AUTH_SECRET", () => {
    expect(checkAuth({ RESEND_API_KEY: "r" }).status).toBe("fail");
  });

  it("should fail when no sign-in method is configured", () => {
    expect(checkAuth({ BETTER_AUTH_SECRET: "s" }).summary).toMatch(
      /No sign-in method/
    );
  });

  it("should list complete providers and email", () => {
    expect(
      checkAuth({
        BETTER_AUTH_SECRET: "s",
        AUTH_GITHUB_CLIENT_ID: "id",
        AUTH_GITHUB_CLIENT_SECRET: "secret",
        RESEND_API_KEY: "r",
      })
    ).toMatchObject({ status: "pass", summary: "Sign-in: GitHub, email" });
  });

  it("should warn about a provider with only one of its values", () => {
    expect(
      checkAuth({
        BETTER_AUTH_SECRET: "s",
        RESEND_API_KEY: "r",
        AUTH_GOOGLE_CLIENT_ID: "id",
      })
    ).toMatchObject({
      status: "warn",
      summary: expect.stringMatching(/Google has only one/),
    });
  });
});

describe("checkModels", () => {
  it("should pass with a gateway key and warn without one", () => {
    expect(checkModels({ AI_GATEWAY_API_KEY: "k" }).status).toBe("pass");
    expect(checkModels({}).status).toBe("warn");
  });

  it("should pass with an OpenAI-compatible endpoint that lists models", () => {
    expect(
      checkModels({
        MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "https://litellm.internal/v1",
        MOGPLEX_OPENAI_COMPATIBLE_MODELS: "llama3",
      }).status
    ).toBe("pass");
  });

  it("should warn when the OpenAI-compatible endpoint lists no models", () => {
    expect(
      checkModels({
        MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "https://litellm.internal/v1",
      })
    ).toMatchObject({
      status: "warn",
      summary: expect.stringContaining("MOGPLEX_OPENAI_COMPATIBLE_MODELS"),
    });
  });
});

describe("checkAccess", () => {
  it("should fail when self-host mode is refused in the hosted Trigger project", () => {
    expect(
      checkAccess({
        MOGPLEX_SELF_HOSTED: "1",
        TRIGGER_PROJECT_REF: HOSTED_TRIGGER_PROJECT_REF,
      })
    ).toMatchObject({ status: "fail" });
  });

  it("should warn when nothing grants platform access", () => {
    expect(checkAccess({}).status).toBe("warn");
    expect(checkAccess({ MOGPLEX_SELF_HOSTED: "0" }).status).toBe("warn");
  });

  it("should pass for Stripe, self-host mode, or an allowlist", () => {
    expect(checkAccess({ STRIPE_SECRET_KEY: "sk" }).status).toBe("pass");
    expect(checkAccess({ MOGPLEX_SELF_HOSTED: "true" }).status).toBe("pass");
    expect(
      checkAccess({ PLATFORM_ACCESS_EMAIL_DOMAINS: "example.com" })
    ).toMatchObject({
      status: "pass",
      summary: "Access allowlist: PLATFORM_ACCESS_EMAIL_DOMAINS",
    });
  });
});
